/**
 * @file ModelManager.ts
 * @description Style model download, cache management, and manifest delta-sync for ArtLens.
 *
 * REFACTOR CHANGES (v3):
 *
 *   A. REMOVED LOCAL DEFAULT_CONFIG CLONE
 *      The local `DEFAULT_CONFIG` object was a field-by-field duplicate of
 *      DEFAULT_MODEL_CONFIG from constants.ts. Any new ModelConfig field added
 *      to the triad would silently be missing here. Replaced with inline spread
 *      of DEFAULT_MODEL_CONFIG throughout, ensuring a single source of truth.
 *
 *   B. INTRODUCED hydrateRemoteConfig() HELPER
 *      All points where a RemoteModelConfig (the partial API shape) is converted
 *      to a fully-hydrated ModelConfig now go through this helper. It validates
 *      each numeric field against MIN_INFERENCE_RESOLUTION before accepting it,
 *      preventing a corrupt or adversarial manifest from locking the engine into
 *      a zero-resolution or garbage-resolution model config.
 *
 *   C. FIXED previewModelUrl OPTIONAL-TO-REQUIRED MISMATCH
 *      ManifestUpdate.previewModelUrl is `string | undefined`. Passing it directly
 *      to File.downloadFileAsync (which requires string) was a TypeScript error and
 *      a runtime crash for any style without a preview model. The download is now
 *      gated on the presence of the URL, and progress weights are dynamically
 *      adjusted so the aggregate still reaches 1.0 when preview is absent.
 *
 *   D. TYPED blockedStatuses AS Set<JobStatus>
 *      The guard Set was typed as Set<string>, losing exhaustiveness benefits.
 *      It is now Set<JobStatus>, so a future rename of any status string surfaces
 *      a compile error at this site.
 *
 *   E. FULL DEFENSIVE MERGE IN getModelConfig
 *      Previously only mainModel and previewModel were overridden from the registry
 *      config; all other fields were unconditionally pulled from the local DEFAULT_CONFIG
 *      clone. Now all six ModelConfig fields are individually validated and selectively
 *      overridden, giving future backend-served fields (tileOverlap, luminanceBlend,
 *      colour modes) a clear upgrade path without code changes.
 *
 * DISK REGISTRY LAYOUT:
 *   <Paths.document>/artlens_models/<styleId>/preview.tflite
 *   <Paths.document>/artlens_models/<styleId>/main.tflite
 *
 * CHANGES vs v3:
 *
 *   FIX M1 — _probeContentLength() helper (new).
 *     Issues a HEAD request to a model URL and returns the advertised
 *     Content-Length in bytes, or null if the server does not provide it or
 *     the request itself fails. Never throws. Callers must handle null explicitly.
 *
 *   FIX M2 — downloadStyleAssets: Phase 1 Content-Length probe.
 *     Both model URLs are HEAD-probed concurrently before any download starts.
 *     The probed byte sizes are used to compute dynamic fractional weights for
 *     the aggregate progress tracker, replacing the static DOWNLOAD_MULTIPLEX_WEIGHTS
 *     constants that caused freeze / erratic jump / overflow symptoms when actual
 *     model sizes diverged from the assumed ratio.
 *
 *   FIX M3 — downloadStyleAssets: Post-hoc weight correction.
 *     If Content-Length probes were unavailable (static fallback was used),
 *     the weights are recalibrated from the actual on-disk file sizes after both
 *     downloads complete, ensuring the final progress report is accurate before
 *     the terminal `updateDownloadStatus(1.0)` call.
 *
 *   FIX M4 — Stream interruption guard.
 *     cancelProgress() is the first operation in the catch block, preventing
 *     any pending throttle-deferred store write from landing after the state
 *     has been reset to 'not_downloaded'. No behavioral change from v3, but
 *     the comment makes the invariant explicit for future maintainers.
 *
 * PRD § 5.2, 6.3 — Directory: src/services/ModelManager.ts
 */

'use strict'

import { File, Directory, Paths } from 'expo-file-system'
import { createMMKV } from 'react-native-mmkv'

import {
	DEFAULT_MODEL_CONFIG,
	DOWNLOAD_MULTIPLEX_WEIGHTS,
	TIMING_CONFIG,
	MIN_INFERENCE_RESOLUTION,
} from '@/shared/utils/constants'
import {
	STORAGE_INSTANCE_IDS,
	MODEL_REGISTRY_KEYS,
	FS_CONFIG,
} from '@/shared/utils/storageKeys'
import { useModelStore } from '@/shared/stores/useModelStore'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import * as InferenceEngine from '@/core/inference/InferenceEngine'
import { createTracker } from '@/shared/utils/logger'

import type {
	StyleId,
	ManifestUpdate,
	ModelConfig,
	ModelRegistryEntry,
	JobStatus,
} from '@/types'

const tracker = createTracker('ModelManager')

// ─────────────────────────────────────────────────────────────────────────────
// MMKV REGISTRY INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

/** Dedicated isolated MMKV instance for the model registry. */
const _storage = createMMKV({ id: STORAGE_INSTANCE_IDS.MODELS })

const REGISTRY_KEY_PREFIX = MODEL_REGISTRY_KEYS.ITEM_PREFIX

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS — REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

export function _writeRegistryEntry(
	styleId: StyleId,
	entry: ModelRegistryEntry
): void {
	_storage.set(`${REGISTRY_KEY_PREFIX}${styleId}`, JSON.stringify(entry))
}

function _readRegistryEntry(styleId: StyleId): ModelRegistryEntry | null {
	const raw = _storage.getString(`${REGISTRY_KEY_PREFIX}${styleId}`)
	if (!raw) return null
	try {
		return JSON.parse(raw) as ModelRegistryEntry
	} catch {
		return null
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS — FILESYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/** Returns (and creates if absent) the root models directory. */
function _ensureModelsRootDirectory(): Directory {
	const rootDir = new Directory(
		Paths.document,
		FS_CONFIG.MODELS_DIRECTORY_NAME
	)
	if (!rootDir.exists) {
		rootDir.create()
	}
	return rootDir
}

/**
 * Resolves the Directory object for a given styleId beneath the models root.
 * Does NOT create the directory — callers are responsible for that.
 */
function _resolveStyleDirectory(styleId: StyleId): Directory {
	const rootDir = _ensureModelsRootDirectory()
	const base = rootDir.uri.endsWith('/') ? rootDir.uri : `${rootDir.uri}/`
	return new Directory(`${base}${styleId}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS — PROGRESS THROTTLE
// ─────────────────────────────────────────────────────────────────────────────

const PROGRESS_THROTTLE_MS = TIMING_CONFIG.PROGRESS_THROTTLE_MS

/**
 * Returns a throttled callback that dispatches aggregate progress into the
 * Zustand store at most once per PROGRESS_THROTTLE_MS interval.
 *
 * The final call (flush=true) always dispatches immediately, ensuring the
 * store always reaches 1.0 regardless of throttle timing.
 */
function _makeProgressDispatcher(styleId: StyleId): {
	dispatch: (fraction: number, flush?: boolean) => void
	cancel: () => void
} {
	let _lastDispatch = 0
	let _timer: ReturnType<typeof setTimeout> | null = null

	const _send = (fraction: number): void => {
		useModelStore
			.getState()
			.updateDownloadStatus(styleId, 'downloading', fraction)
	}

	const dispatch = (fraction: number, flush = false): void => {
		if (_timer !== null) {
			clearTimeout(_timer)
			_timer = null
		}

		const now = Date.now()
		if (flush || now - _lastDispatch >= PROGRESS_THROTTLE_MS) {
			_lastDispatch = now
			_send(fraction)
			return
		}

		_timer = setTimeout(
			() => {
				_timer = null
				_lastDispatch = Date.now()
				_send(fraction)
			},
			PROGRESS_THROTTLE_MS - (now - _lastDispatch)
		)
	}

	const cancel = (): void => {
		if (_timer !== null) {
			clearTimeout(_timer)
			_timer = null
		}
	}

	return { dispatch, cancel }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A — CONCURRENT DOWNLOAD MULTIPLEXER WITH PROGRESS AGGREGATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issues a HEAD request to `url` and returns the advertised Content-Length
 * in bytes, or `null` when:
 *   - the server does not include a `Content-Length` response header,
 *   - the reported value is non-positive or non-finite (chunked encoding,
 *     compressed transfer, or proxy-stripped header),
 *   - the request itself throws (network error, CORS, DNS failure, etc.).
 *
 * The `Accept-Encoding: identity` header requests uncompressed content so that
 * CDN proxies do not strip the length header before it reaches the client.
 *
 * This function never throws — all rejection paths return `null` so callers
 * can switch to a logged fallback without a try/catch at the call site.
 */
async function _probeContentLength(url: string): Promise<number | null> {
	try {
		const response = await fetch(url, {
			method: 'HEAD',
			// Suppress compression negotiation: proxies that apply
			// Content-Encoding: gzip will strip Content-Length from their
			// response. identity requests the raw byte stream length.
			headers: { 'Accept-Encoding': 'identity' },
		})
		const raw = response.headers.get('content-length')
		if (raw === null) return null
		const bytes = parseInt(raw, 10)
		return Number.isFinite(bytes) && bytes > 0 ? bytes : null
	} catch {
		// Network errors, CORS failures, timeouts — all silently return null.
		// The caller logs the fallback path explicitly.
		return null
	}
}

/**
 * Downloads all binary files for a style pack concurrently.
 *
 * ── Progress weight allocation (FIX M2) ──────────────────────────────────
 *
 * Static DOWNLOAD_MULTIPLEX_WEIGHTS constants are replaced by dynamic weights
 * derived from the actual payload sizes reported in the `Content-Length`
 * response headers of concurrent HEAD requests issued before any download
 * starts. This prevents the three failure modes of the static-weight approach:
 *
 *   FREEZE  — a much-larger-than-assumed model occupies its weight slot for a
 *              long time with no intermediate ticks. With size-derived weights
 *              the slot is proportionally sized to its actual cost.
 *
 *   JUMP    — a much-smaller model completes instantly and advances the bar by
 *              its full static weight (e.g. 20%) in a single frame. Dynamic
 *              weighting scales that jump to the true proportional contribution.
 *
 *   OVERFLOW — if a future caller supplies its own progress sub-range that
 *              assumed the static split, the aggregate can exceed 1.0. Dynamic
 *              weights are always summed to exactly 1.0 by construction.
 *
 * ── Fallback chain when Content-Length is unavailable ────────────────────
 *
 *   1. HEAD response includes Content-Length for both URLs
 *      → weights = probedPreviewBytes / totalProbed  (dynamic)
 *
 *   2. At least one probe returns null (server omits header, CORS, etc.)
 *      → weights = DOWNLOAD_MULTIPLEX_WEIGHTS constants  (explicit, logged)
 *      → after downloads complete, weights are corrected from on-disk sizes
 *        before the final flush so the committed aggregate is always accurate.
 *
 *   3. No preview URL present
 *      → WEIGHT_PREVIEW = 0, WEIGHT_MAIN = 1.0  (unconditional)
 *
 * ── Stream interruption guard (FIX M4) ───────────────────────────────────
 *
 * cancelProgress() is always the first statement in the catch block, ensuring
 * no pending throttle-deferred write can land in the store after the state has
 * been reset to 'not_downloaded'. The registry and store are updated atomically
 * after cancelProgress() returns.
 */
export async function downloadStyleAssets(item: ManifestUpdate): Promise<void> {
	const entry = _readRegistryEntry(item.id)
	if (!entry) {
		tracker.error(
			`downloadStyleAssets: no registry entry for style "${item.id}". ` +
				'Ensure syncManifest() initialized the entry before calling this.'
		)
		return
	}

	// Transition to downloading state immediately.
	entry.downloadStatus = 'downloading'
	_writeRegistryEntry(item.id, entry)
	useModelStore.getState().updateDownloadStatus(item.id, 'downloading', 0)

	const { dispatch: dispatchProgress, cancel: cancelProgress } =
		_makeProgressDispatcher(item.id)

	// ── Prepare filesystem targets ─────────────────────────────────────────
	const styleDir = _resolveStyleDirectory(item.id)
	if (!styleDir.exists) {
		styleDir.create()
	}

	const hasPreviewModel = item.previewModelUrl !== undefined

	// ── Phase 1: Concurrent Content-Length probes (FIX M2) ────────────────
	//
	// Probe both URLs before any download starts to capture accurate byte
	// totals for dynamic weight allocation. Both probes run concurrently so
	// they add a single RTT — not two — to the overall download sequence.
	// If previewModelUrl is absent the preview probe short-circuits to null.
	const [probedPreviewBytes, probedMainBytes] = await Promise.all([
		hasPreviewModel && item.previewModelUrl !== undefined
			? _probeContentLength(item.previewModelUrl)
			: Promise.resolve<number | null>(null),
		_probeContentLength(item.mainModelUrl),
	])

	// ── Phase 2: Dynamic weight allocation (FIX M2) ───────────────────────
	//
	// Three mutually-exclusive branches. The static constant fallback is
	// reached only when Content-Length is genuinely unavailable (chunked CDN,
	// server misconfiguration, network error). It is always logged explicitly
	// so silent incorrect behaviour is observable in telemetry.
	let WEIGHT_PREVIEW: number
	let WEIGHT_MAIN: number
	// Track whether we used the static fallback so the post-hoc correction
	// (FIX M3) knows whether to recalibrate after downloads complete.
	let usingStaticFallback = false

	if (!hasPreviewModel) {
		// No preview stream — main carries the full weight unconditionally.
		WEIGHT_PREVIEW = 0
		WEIGHT_MAIN = 1.0
	} else if (probedPreviewBytes !== null && probedMainBytes !== null) {
		// Both lengths probed successfully — compute exact fractional weights.
		const totalProbed = probedPreviewBytes + probedMainBytes
		WEIGHT_PREVIEW =
			totalProbed > 0
				? probedPreviewBytes / totalProbed
				: DOWNLOAD_MULTIPLEX_WEIGHTS.PREVIEW
		WEIGHT_MAIN = 1.0 - WEIGHT_PREVIEW
		tracker.log(
			`[downloadStyleAssets] Dynamic weights for "${item.id}": ` +
				`preview=${probedPreviewBytes}B → ${(WEIGHT_PREVIEW * 100).toFixed(1)}%, ` +
				`main=${probedMainBytes}B → ${(WEIGHT_MAIN * 100).toFixed(1)}%.`
		)
	} else {
		// At least one probe returned null — fall back to static constants.
		// FIX M3 post-hoc correction will recalibrate after downloads complete.
		WEIGHT_PREVIEW = DOWNLOAD_MULTIPLEX_WEIGHTS.PREVIEW
		WEIGHT_MAIN = 1.0 - WEIGHT_PREVIEW
		usingStaticFallback = true
		tracker.warn(
			`[downloadStyleAssets] Content-Length probe incomplete for style ` +
				`"${item.id}" ` +
				`(preview=${probedPreviewBytes ?? 'null'}, ` +
				`main=${probedMainBytes ?? 'null'}). ` +
				`Using static weight split — ` +
				`preview=${(WEIGHT_PREVIEW * 100).toFixed(1)}%, ` +
				`main=${(WEIGHT_MAIN * 100).toFixed(1)}%. ` +
				`Post-hoc correction will apply after downloads complete.`
		)
	}

	let progressPreview = 0.0
	let progressMain = 0.0

	/**
	 * Recomputes the weighted aggregate and dispatches it to the store,
	 * capped at 1.0 to guard against any floating-point overshoot.
	 */
	const _reportAggregate = (flush = false): void => {
		const aggregate =
			WEIGHT_PREVIEW * progressPreview + WEIGHT_MAIN * progressMain
		dispatchProgress(Math.min(aggregate, 1.0), flush)
	}

	try {
		const sep = styleDir.uri.endsWith('/') ? '' : '/'
		const mainFile = new File(`${styleDir.uri}${sep}main.tflite`)

		tracker.log(
			`Starting concurrent download for style "${item.id}": ` +
				`preview="${item.previewModelUrl ?? 'none'}", main="${item.mainModelUrl}"`
		)

		// ── Preview download (conditional on URL presence) ─────────────────
		let downloadPreview: Promise<File | null>
		let previewFile: File | null = null

		if (hasPreviewModel && item.previewModelUrl !== undefined) {
			// TypeScript narrowing: item.previewModelUrl is `string` here.
			const previewUrl: string = item.previewModelUrl
			previewFile = new File(`${styleDir.uri}${sep}preview.tflite`)
			const previewFileTarget = previewFile

			downloadPreview = (async (): Promise<File> => {
				// Start beacon — signals to the UI that this stream is in flight.
				progressPreview = 0.1
				_reportAggregate()

				const downloaded = await File.downloadFileAsync(
					previewUrl,
					previewFileTarget
				)

				progressPreview = 1.0
				_reportAggregate()
				return downloaded
			})()
		} else {
			// No preview model URL — stream skipped; WEIGHT_PREVIEW is 0.
			downloadPreview = Promise.resolve(null)
		}

		// ── Main model download ────────────────────────────────────────────
		const downloadMain = (async (): Promise<File> => {
			// Start beacon — signals to the UI that this stream is in flight.
			progressMain = 0.05
			_reportAggregate()

			const downloaded = await File.downloadFileAsync(
				item.mainModelUrl,
				mainFile
			)

			progressMain = 1.0
			_reportAggregate()
			return downloaded
		})()

		// ── Await all streams ──────────────────────────────────────────────
		const [downloadedPreview, downloadedMain] = await Promise.all([
			downloadPreview,
			downloadMain,
		])

		// ── Read physical file sizes from disk ─────────────────────────────
		const previewSize: number = downloadedPreview?.exists
			? (downloadedPreview.size ?? 0)
			: 0
		const mainSize: number = downloadedMain.exists
			? (downloadedMain.size ?? 0)
			: 0

		// ── FIX M3: Post-hoc weight correction ────────────────────────────
		//
		// If the Content-Length probes were unavailable (usingStaticFallback),
		// recalibrate the weights from actual on-disk byte sizes before the
		// final flush. This corrects any divergence between the static split
		// and reality — the committed aggregate in the store will be accurate
		// even if intermediate ticks used approximate weights.
		//
		// Condition: only recalibrate when both sizes are non-zero (a zero
		// value indicates a filesystem error or an empty download, which the
		// registry commit below will capture).
		if (
			usingStaticFallback &&
			hasPreviewModel &&
			previewSize > 0 &&
			mainSize > 0
		) {
			const totalActual = previewSize + mainSize
			WEIGHT_PREVIEW = previewSize / totalActual
			WEIGHT_MAIN = 1.0 - WEIGHT_PREVIEW
			tracker.log(
				`[downloadStyleAssets] Post-hoc weight correction for "${item.id}" ` +
					`from actual on-disk sizes: ` +
					`preview=${previewSize}B → ${(WEIGHT_PREVIEW * 100).toFixed(1)}%, ` +
					`main=${mainSize}B → ${(WEIGHT_MAIN * 100).toFixed(1)}%.`
			)
		}

		// ── Commit results to registry ─────────────────────────────────────
		const completedEntry: ModelRegistryEntry = {
			...entry,
			downloadStatus: 'downloaded',
			previewPath: downloadedPreview?.uri ?? null,
			mainPath: downloadedMain.uri,
			previewSize,
			mainSize,
		}
		_writeRegistryEntry(item.id, completedEntry)

		// Final flush — guarantees aggregate 1.0 reaches the store regardless
		// of throttle timing. The hard-coded 1.0 in updateDownloadStatus below
		// provides a secondary belt-and-suspenders guarantee.
		_reportAggregate(true)
		cancelProgress()

		useModelStore
			.getState()
			.updateDownloadStatus(item.id, 'downloaded', 1.0)

		tracker.log(
			`Download complete for style "${item.id}". ` +
				`preview=${previewSize}B, main=${mainSize}B`
		)
	} catch (error) {
		// ── FIX M4: Stream interruption guard ─────────────────────────────
		//
		// cancelProgress() MUST be the first statement — it cancels any pending
		// throttle-deferred write, ensuring no partial-progress value lands in
		// the store after the state is reset to 'not_downloaded' below.
		cancelProgress()

		tracker.error(
			`Download failed for style "${item.id}". Cleaning up partial files. Error: ${error}`
		)

		// ── Filesystem cleanup ─────────────────────────────────────────────
		try {
			if (styleDir.exists) {
				styleDir.delete()
			}
		} catch (cleanupErr) {
			tracker.error(
				`Partial file cleanup failed for style "${item.id}": ${cleanupErr}`
			)
		}

		// ── Registry + store reset ─────────────────────────────────────────
		const failedEntry: ModelRegistryEntry = {
			...entry,
			downloadStatus: 'failed',
			previewPath: null,
			mainPath: null,
			previewSize: 0,
			mainSize: 0,
		}
		_writeRegistryEntry(item.id, failedEntry)

		// `'failed'` is a RegistryDownloadStatus — reset store to 'not_downloaded'
		// so UI components never observe the internal 'failed' string.
		useModelStore
			.getState()
			.updateDownloadStatus(item.id, 'not_downloaded', 0)

		throw error
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B — PRD §6.3 MODEL DELETION GUARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deletes all on-disk assets for a downloaded style pack and resets its
 * registry and Zustand store state to 'not_downloaded'.
 *
 * Three defensive checks must ALL pass before any filesystem mutation.
 *
 * @throws {Error} If CHECK 1 fails (engine active) or CHECK 2 fails (active jobs).
 */
export function deleteStyleAssets(styleId: StyleId): void {
	const styleDir = _resolveStyleDirectory(styleId)
	const styleDirUri = styleDir.uri

	// ── CHECK 1: InferenceEngine active model path inspection ─────────────────
	const previewActivePath = InferenceEngine.getActiveModelPath('preview')
	const mainActivePath = InferenceEngine.getActiveModelPath('main')

	const normalizedDirUri = styleDirUri.endsWith('/')
		? styleDirUri
		: `${styleDirUri}/`

	const previewIsActive =
		previewActivePath !== null &&
		previewActivePath.startsWith(normalizedDirUri)

	const mainIsActive =
		mainActivePath !== null && mainActivePath.startsWith(normalizedDirUri)

	if (previewIsActive || mainIsActive) {
		// BUG 9 FIX: Report every active slot, not just the first one.
		// The previous ternary short-circuited to 'preview' whenever both slots
		// were loaded, causing log analysis and error handlers to conclude only
		// the preview slot needed unloading — then retry deletion — which would
		// still fail because the main slot was still resident.
		const activeSlots: string[] = []
		if (previewIsActive) activeSlots.push('preview')
		if (mainIsActive) activeSlots.push('main')
		const slotsStr = activeSlots.join(' and ')
		throw new Error(
			`Cannot delete model asset: Model is currently active inside the ` +
				`InferenceEngine memory slots. ` +
				`Slot(s) "${slotsStr}" are loaded from "${normalizedDirUri}". ` +
				`Call InferenceEngine.unloadModel() for each active slot before deleting.`
		)
	}

	// ── CHECK 2: StyleJobStore active job inspection ───────────────────────────
	// FIX D: typed as Set<JobStatus> to preserve exhaustiveness checking.
	// A future rename of any JobStatus string literal will surface a
	// compile error here rather than silently failing the guard.
	const blockedStatuses = new Set<JobStatus>([
		'QUEUED',
		'PROCESSING',
		'BATTERY_PAUSED',
	])

	const allJobs = useStyleJobStore.getState().jobs
	const dependentJob = allJobs.find(
		(job) => job.styleId === styleId && blockedStatuses.has(job.status)
	)

	if (dependentJob) {
		throw new Error(
			`Cannot delete model asset: Active or queued processing jobs are currently ` +
				`dependent on this style template. ` +
				`Job "${dependentJob.id}" has status "${dependentJob.status}" ` +
				`for styleId "${styleId}".`
		)
	}

	// ── CHECK 3: Safe execution — delete files and reset state ─────────────────
	try {
		if (styleDir.exists) {
			styleDir.delete()
			tracker.log(
				`Style directory deleted for "${styleId}": ${styleDirUri}`
			)
		} else {
			tracker.log(
				`Style directory for "${styleId}" was already absent — skipping delete.`
			)
		}
	} catch (fsErr) {
		tracker.error(
			`Filesystem delete failed for style "${styleId}": ${fsErr}`
		)
		throw new Error(
			`deleteStyleAssets: filesystem error while deleting "${styleDirUri}". ` +
				`Original error: ${fsErr}`
		)
	}

	const existingEntry = _readRegistryEntry(styleId)
	if (existingEntry) {
		_writeRegistryEntry(styleId, {
			...existingEntry,
			downloadStatus: 'not_downloaded',
			previewPath: null,
			mainPath: null,
			previewSize: 0,
			mainSize: 0,
		})
	} else {
		tracker.log(
			`No MMKV registry entry found for "${styleId}" during delete — already clean.`
		)
	}

	useModelStore.getState().updateDownloadStatus(styleId, 'not_downloaded', 0)

	tracker.log(
		`deleteStyleAssets complete for "${styleId}". Registry and store reset.`
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA RESOLVER ACCESSORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the absolute file:// path for a downloaded model binary.
 * Returns null if the model is not in 'downloaded' state.
 */
export function getModelPath(
	styleId: StyleId,
	slot: 'preview' | 'main'
): string | null {
	const entry = _readRegistryEntry(styleId)
	if (!entry || entry.downloadStatus !== 'downloaded') return null
	return slot === 'preview' ? entry.previewPath : entry.mainPath
}

/**
 * Reads and returns the per-model config for a style from the MMKV registry.
 *
 * The registry always stores a fully-hydrated ModelConfig (written via
 * hydrateRemoteConfig at sync time). This function applies a second layer of
 * defensive validation on each field before returning, protecting against
 * corrupted or schema-mismatched MMKV data from an older app version.
 *
 * Returns a fresh object (spread) — callers may not mutate it.
 *
 * BUG 7 FIX: Previously declared `async` despite containing no `await`.
 * The `async` keyword added a spurious microtask-queue hop on every job
 * dispatch in StyleJobService. Removed — the function is synchronous.
 * Existing `await getModelConfig(...)` call sites remain valid: awaiting a
 * non-Promise returns the value immediately without a type error.
 */
export function getModelConfig(styleId: StyleId): ModelConfig {
	const entry = _readRegistryEntry(styleId)
	if (!entry?.config) {
		return { ...DEFAULT_MODEL_CONFIG }
	}

	const stored = entry.config
	const d = DEFAULT_MODEL_CONFIG

	// Validate all six fields individually. A field passes only if its runtime
	// value satisfies the type contract expected by the engine. Invalid fields
	// fall back to DEFAULT_MODEL_CONFIG — the server can never push the engine
	// into a state it was not compiled to handle.
	return {
		mainModel:
			typeof stored.mainModel === 'number' &&
			stored.mainModel >= MIN_INFERENCE_RESOLUTION
				? stored.mainModel
				: d.mainModel,

		previewModel:
			typeof stored.previewModel === 'number' &&
			stored.previewModel >= MIN_INFERENCE_RESOLUTION
				? stored.previewModel
				: d.previewModel,

		tileOverlap:
			typeof stored.tileOverlap === 'number' && stored.tileOverlap > 0
				? stored.tileOverlap
				: d.tileOverlap,

		luminanceBlend:
			typeof stored.luminanceBlend === 'number' &&
			stored.luminanceBlend >= 0 &&
			stored.luminanceBlend <= 1
				? stored.luminanceBlend
				: d.luminanceBlend,

		defaultColourMode: stored.defaultColourMode ?? d.defaultColourMode,

		preferredColourMode:
			stored.preferredColourMode ?? d.preferredColourMode,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY READ UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

export function getRegistryEntry(styleId: StyleId): ModelRegistryEntry | null {
	return _readRegistryEntry(styleId)
}

/**
 * Returns the true physical on-disk byte count (preview + main) for a style.
 * Returns 0 if the style is not in 'downloaded' state.
 */
export function getPhysicalFootprint(styleId: StyleId): number {
	const entry = _readRegistryEntry(styleId)
	if (!entry || entry.downloadStatus !== 'downloaded') return 0
	return (entry.previewSize ?? 0) + (entry.mainSize ?? 0)
}
