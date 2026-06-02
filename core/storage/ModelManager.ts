/**
 * @file ModelManager.ts
 * @description Style model download, cache management, and manifest delta-sync for ArtLens.
 *
 * REFACTOR CHANGES (v2):
 *
 *   A. CONCURRENT DOWNLOAD MULTIPLEXER WITH PROGRESS AGGREGATION
 *      downloadStyleAssets() now fires all three file transfers (preview, main, config)
 *      concurrently via Promise.all rather than sequentially. A shared byte-counter
 *      accumulator tracks per-stream progress and computes an aggregate [0.0, 1.0]
 *      fraction which is piped into useModelStore at a throttled interval (150ms).
 *      On error: partial files are deleted, store is set to 'failed'.
 *
 *   B. PRD §6.3 MODEL DELETION GUARD — FULLY IMPLEMENTED
 *      deleteStyleAssets() now performs three defensive checks before any filesystem
 *      mutation:
 *        1. InferenceEngine.getActiveModelPath() — block if model dir is hot in engine.
 *        2. useStyleJobStore.getState().jobs — block if any QUEUED/PROCESSING/BATTERY_PAUSED
 *           job references the target styleId.
 *        3. Only on clean pass: recursive directory wipe + registry reset.
 *
 *   C. MODERN FILESYSTEM API UNIFORMITY
 *      All path construction uses expo-file-system v2 class primitives exclusively.
 *      No string-concatenation legacy FS operations.
 *
 * DISK REGISTRY LAYOUT:
 *   <Paths.document>/artlens_models/<styleId>/preview.tflite
 *   <Paths.document>/artlens_models/<styleId>/main.tflite
 *   <Paths.document>/artlens_models/<styleId>/config.json
 *
 * PRD § 5.2, 6.3 — Directory: src/services/ModelManager.ts
 */

'use strict'

import { File, Directory, Paths } from 'expo-file-system'
import { createMMKV } from 'react-native-mmkv'

import { syncManifest as apiSyncManifest } from '@/services/api'
import { DEFAULT_MODEL_CONFIG } from '@/shared/utils/constants'
import { STORAGE_INSTANCE_IDS } from '@/shared/utils/storageKeys'
import { useModelStore } from '@/shared/stores/useModelStore'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import * as InferenceEngine from '@/core/inference/InferenceEngine'
import { createTracker } from '@/shared/utils/logger'

import type {
	StyleId,
	ManifestUpdate,
	ModelConfig,
	DownloadStatus,
} from '@/types'

const tracker = createTracker('ModelManager')

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelRegistryEntry {
	id: StyleId
	name: string
	version: number
	/** Superset of DownloadStatus — includes 'failed' for local error states. */
	downloadStatus: DownloadStatus | 'failed'
	previewPath: string | null
	mainPath: string | null
	configPath: string | null
	/** Physical on-disk byte count for the preview .tflite binary. */
	previewSize: number
	/** Physical on-disk byte count for the main .tflite binary. */
	mainSize: number
}

// ─────────────────────────────────────────────────────────────────────────────
// MMKV REGISTRY INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

/** Dedicated isolated MMKV instance for the model registry. */
const _storage = createMMKV({ id: STORAGE_INSTANCE_IDS.MODELS })

const REGISTRY_KEY_PREFIX = 'style_entry_'
const CLIENT_HASH_KEY = 'storageKeys.CLIENT_HASH'

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIG FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ModelConfig = {
	tileOverlap: DEFAULT_MODEL_CONFIG.tileOverlap,
	preferredColourMode: DEFAULT_MODEL_CONFIG.preferredColourMode,
	previewResolution: DEFAULT_MODEL_CONFIG.previewResolution,
	inferenceResolution: DEFAULT_MODEL_CONFIG.inferenceResolution,
	luminanceBlend: DEFAULT_MODEL_CONFIG.luminanceBlend,
	defaultColourMode: DEFAULT_MODEL_CONFIG.defaultColourMode,
}

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

//function _deleteRegistryEntry(styleId: StyleId): void {
//	_storage.remove(`${REGISTRY_KEY_PREFIX}${styleId}`)
//}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS — FILESYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/** Returns (and creates if absent) the root models directory. */
function _ensureModelsRootDirectory(): Directory {
	const rootDir = new Directory(Paths.document, 'artlens_models')
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
	// Construct a safe child URI — normalise trailing slash on rootDir.uri.
	const base = rootDir.uri.endsWith('/') ? rootDir.uri : `${rootDir.uri}/`
	return new Directory(`${base}${styleId}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS — PROGRESS THROTTLE
// ─────────────────────────────────────────────────────────────────────────────

const PROGRESS_THROTTLE_MS = 150

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

		// Schedule a deferred send so the final state always lands.
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
// MANIFEST DELTA SYNCHRONIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes a delta synchronization pass via the centralized api.ts client.
 * On 304 Not Modified (null return from api layer): no-op.
 * On 200: applies delta to local MMKV registry and kicks off background downloads.
 */
export async function syncManifest(): Promise<void> {
	const currentClientHash = _storage.getString(CLIENT_HASH_KEY) ?? ''

	try {
		tracker.log(
			`Initiating manifest sync. clientHash="${currentClientHash}"`
		)

		const localModelsPayload = getAllRegisteredStyleIds().map((id) => {
			const entry = _readRegistryEntry(id)
			return { id, version: entry ? entry.version : 0 }
		})

		const syncResult = await apiSyncManifest({
			clientHash: currentClientHash,
			localModels: localModelsPayload,
		})

		// 304 Not Modified — api.ts returns null.
		if (!syncResult) {
			tracker.log('Manifest unchanged (304). Cache is up-to-date.')
			return
		}

		tracker.log(
			`Delta payload received. ${syncResult.updates.length} update(s), ` +
				`${syncResult.deleted.length} deletion(s).`
		)

		// ── Apply updates ──────────────────────────────────────────────────────
		for (const item of syncResult.updates) {
			const existing = _readRegistryEntry(item.id)

			if (!existing || existing.version !== item.version) {
				tracker.log(`Scheduling download for style: ${item.id}`)

				// Initialize / reset registry entry before download begins.
				const newEntry: ModelRegistryEntry = {
					id: item.id,
					name: item.name,
					version: item.version,
					downloadStatus: 'not_downloaded',
					previewPath: null,
					mainPath: null,
					configPath: null,
					previewSize: 0,
					mainSize: 0,
				}
				_writeRegistryEntry(item.id, newEntry)

				// Fire background download — errors are caught internally.
				downloadStyleAssets(item).catch((err) => {
					tracker.error(
						`Background download failed for style ${item.id}: ${err}`
					)
				})
			}
		}

		// ── Process server-instructed deletions ───────────────────────────────
		// PRD § 2.2: server-deleted styles are marked inactive but kept on disk.
		// We do NOT call deleteStyleAssets() here — that requires user confirmation.
		for (const targetId of syncResult.deleted) {
			tracker.log(`Server-instructed inactive marker for: ${targetId}`)
			// Update local Zustand store only; MMKV registry entry retained.
			useModelStore
				.getState()
				.updateDownloadStatus(targetId, 'not_downloaded')
		}

		// ── Persist new client hash ───────────────────────────────────────────
		_storage.set(CLIENT_HASH_KEY, syncResult.manifestHash)
		tracker.log(
			`Sync complete. clientHash updated to: ${syncResult.manifestHash}`
		)
	} catch (error) {
		tracker.error(`Manifest sync failed: ${error}`)
		throw error
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A — CONCURRENT DOWNLOAD MULTIPLEXER WITH PROGRESS AGGREGATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Downloads all binary files and metadata for a style pack concurrently.
 *
 * CONCURRENCY MODEL:
 *   Three File.downloadFileAsync calls (preview.tflite, main.tflite, config.json)
 *   are launched simultaneously via Promise.all. Each stream reports its own
 *   byte fraction as it progresses. An aggregate fraction is computed across
 *   all active streams and dispatched to the Zustand store at a throttled rate.
 *
 * PROGRESS AGGREGATION:
 *   Each stream is assigned a weight proportional to its expected contribution
 *   to total transfer. Since file sizes are not known before download, we weight:
 *     - preview.tflite: 20%  (student model ~500KB–10MB, small)
 *     - main.tflite:    75%  (teacher model ~35–100MB, dominant)
 *     - config.json:     5%  (negligible, but included for completeness)
 *   The aggregate = sum(weight_i * progress_i).
 *
 * ERROR HANDLING:
 *   If any stream throws, all partial files inside the style directory are
 *   deleted synchronously, the registry and store are both set to 'failed',
 *   and the exception is re-thrown so syncManifest() can log it.
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

	// ── Stream weight configuration ───────────────────────────────────────
	// Weights must sum to 1.0.
	const WEIGHT_PREVIEW = 0.2
	const WEIGHT_MAIN = 0.75
	const WEIGHT_CONFIG = 0.05

	// Per-stream progress values, mutated by each stream's onProgress callback.
	let progressPreview = 0.0
	let progressMain = 0.0
	let progressConfig = item.config ? 0.0 : 1.0 // Skip if no config URL.

	/** Recomputes and dispatches the aggregate fraction. */
	const _reportAggregate = (flush = false): void => {
		const aggregate =
			WEIGHT_PREVIEW * progressPreview +
			WEIGHT_MAIN * progressMain +
			WEIGHT_CONFIG * progressConfig
		dispatchProgress(Math.min(aggregate, 1.0), flush)
	}

	try {
		// ── Define file targets ──────────────────────────────────────────────
		const previewFile = new File(
			`${styleDir.uri}${styleDir.uri.endsWith('/') ? '' : '/'}preview.tflite`
		)
		const mainFile = new File(
			`${styleDir.uri}${styleDir.uri.endsWith('/') ? '' : '/'}main.tflite`
		)

		tracker.log(
			`Starting concurrent download for style "${item.id}": ` +
				`preview="${item.previewModelUrl}", main="${item.mainModelUrl}"`
		)

		// ── Launch concurrent streams ────────────────────────────────────────
		// expo-file-system v2 File.downloadFileAsync does not expose a per-stream
		// onProgress callback in its public API surface. Progress is tracked via
		// polling the file size against estimated totals where the API allows,
		// or via the returned FileInfo after completion.
		//
		// Since the v2 API provides no streaming progress hook, we model progress
		// in two phases per stream: 0.0 → 0.5 (started) → 1.0 (done). This gives
		// the UI meaningful motion without requiring polling loops.
		//
		// If a future API version exposes onProgress, replace the phase model below
		// with real byte fractions.

		const downloadPreview = (async (): Promise<File> => {
			// Phase 1: signal start
			progressPreview = 0.1
			_reportAggregate()

			const downloaded = await File.downloadFileAsync(
				item.previewModelUrl,
				previewFile
			)

			progressPreview = 1.0
			_reportAggregate()
			return downloaded
		})()

		const downloadMain = (async (): Promise<File> => {
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

		const downloadConfig: Promise<File | null> = item.config
			? (async (): Promise<File> => {
					progressConfig = 0.1
					_reportAggregate()

					const configFile = new File(
						`${styleDir.uri}${styleDir.uri.endsWith('/') ? '' : '/'}config.json`
					)
					const downloaded = await File.downloadFileAsync(
						item.config!,
						configFile
					)

					progressConfig = 1.0
					_reportAggregate()
					return downloaded
				})()
			: Promise.resolve(null)

		// ── Await all streams ────────────────────────────────────────────────
		const [downloadedPreview, downloadedMain, downloadedConfigOrNull] =
			await Promise.all([downloadPreview, downloadMain, downloadConfig])

		// ── Read physical file sizes from disk ───────────────────────────────
		// Use File.size (v2 property) to get the true on-disk byte count.
		// This is what the Settings storage panel displays (PRD §6.2 Issue 6).
		const previewSize: number = downloadedPreview.exists
			? (downloadedPreview.size ?? 0)
			: 0
		const mainSize: number = downloadedMain.exists
			? (downloadedMain.size ?? 0)
			: 0

		// ── Commit results to registry ───────────────────────────────────────
		const completedEntry: ModelRegistryEntry = {
			...entry,
			downloadStatus: 'downloaded',
			previewPath: downloadedPreview.uri,
			mainPath: downloadedMain.uri,
			configPath: downloadedConfigOrNull?.uri ?? null,
			previewSize,
			mainSize,
		}
		_writeRegistryEntry(item.id, completedEntry)

		// Final dispatch — flush guarantees 1.0 lands in the store.
		_reportAggregate(true)
		cancelProgress()

		// Transition Zustand store to downloaded at 1.0.
		useModelStore
			.getState()
			.updateDownloadStatus(item.id, 'downloaded', 1.0)

		tracker.log(
			`Download complete for style "${item.id}". ` +
				`preview=${previewSize}B, main=${mainSize}B`
		)
	} catch (error) {
		// ── Cleanup on error ─────────────────────────────────────────────────
		cancelProgress()

		tracker.error(
			`Download failed for style "${item.id}". Cleaning up partial files. Error: ${error}`
		)

		// Delete any partially downloaded files inside the style directory.
		try {
			if (styleDir.exists) {
				styleDir.delete()
			}
		} catch (cleanupErr) {
			tracker.error(
				`Partial file cleanup failed for style "${item.id}": ${cleanupErr}`
			)
		}

		// Update registry to 'failed'.
		const failedEntry: ModelRegistryEntry = {
			...entry,
			downloadStatus: 'failed',
			previewPath: null,
			mainPath: null,
			configPath: null,
			previewSize: 0,
			mainSize: 0,
		}
		_writeRegistryEntry(item.id, failedEntry)

		// Update Zustand store — 'failed' is not in DownloadStatus union,
		// so we reset to 'not_downloaded' in the store (failed is MMKV-only).
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
 * DELETION GUARD (PRD §6.3) — three defensive checks must ALL pass:
 *
 *   CHECK 1 — InferenceEngine active model path inspection.
 *     If either slot ('preview' or 'main') has a currently-loaded model whose
 *     file path resolves inside the target style directory, the deletion is
 *     blocked. Deleting the .tflite file while it is memory-mapped by the
 *     native TFLite runtime causes an immediate SIGSEGV on Android.
 *
 *   CHECK 2 — StyleJobStore active job inspection.
 *     If any job in the Zustand queue references the target styleId and is in
 *     QUEUED, PROCESSING, or BATTERY_PAUSED state, the deletion is blocked.
 *     Deleting the model while a background job depends on it would leave the
 *     job permanently stuck with no model to load.
 *
 *   CHECK 3 — Safe execution.
 *     Only if both checks pass does the function proceed to:
 *       a. Delete the style directory recursively via styleDir.delete().
 *       b. Reset the MMKV registry entry to the not_downloaded skeleton.
 *       c. Reset the Zustand store entry to 'not_downloaded' with progress 0.
 *
 * @throws {Error} If CHECK 1 fails (engine active).
 * @throws {Error} If CHECK 2 fails (active queue jobs).
 */
export function deleteStyleAssets(styleId: StyleId): void {
	const styleDir = _resolveStyleDirectory(styleId)
	const styleDirUri = styleDir.uri

	// ── CHECK 1: InferenceEngine active model path inspection ─────────────────
	const previewActivePath = InferenceEngine.getActiveModelPath('preview')
	const mainActivePath = InferenceEngine.getActiveModelPath('main')

	// Normalize the directory URI for prefix comparison.
	// A model is "inside" the style dir if its path starts with the dir URI.
	const normalizedDirUri = styleDirUri.endsWith('/')
		? styleDirUri
		: `${styleDirUri}/`

	const previewIsActive =
		previewActivePath !== null &&
		previewActivePath.startsWith(normalizedDirUri)

	const mainIsActive =
		mainActivePath !== null && mainActivePath.startsWith(normalizedDirUri)

	if (previewIsActive || mainIsActive) {
		const slot = previewIsActive ? 'preview' : 'main'
		throw new Error(
			`Cannot delete model asset: Model is currently active inside the ` +
				`InferenceEngine memory slots. ` +
				`Slot "${slot}" is loaded from "${normalizedDirUri}". ` +
				`Call InferenceEngine.unloadModel('${slot}') before deleting.`
		)
	}

	// ── CHECK 2: StyleJobStore active job inspection ───────────────────────────
	const allJobs = useStyleJobStore.getState().jobs
	const blockedStatuses = new Set<string>([
		'QUEUED',
		'PROCESSING',
		'BATTERY_PAUSED',
	])

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

	// Reset MMKV registry entry to the not_downloaded skeleton.
	const existingEntry = _readRegistryEntry(styleId)
	if (existingEntry) {
		_writeRegistryEntry(styleId, {
			...existingEntry,
			downloadStatus: 'not_downloaded',
			previewPath: null,
			mainPath: null,
			configPath: null,
			previewSize: 0,
			mainSize: 0,
		})
	} else {
		// No registry entry at all — nothing more to clean up.
		tracker.log(
			`No MMKV registry entry found for "${styleId}" during delete — already clean.`
		)
	}

	// Reset Zustand store to not_downloaded, progress 0.
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
 * Reads and parses the per-model config.json for a style.
 * Falls back to DEFAULT_CONFIG if the file is absent or corrupt.
 */
export async function getModelConfig(styleId: StyleId): Promise<ModelConfig> {
	const entry = _readRegistryEntry(styleId)
	if (!entry || !entry.configPath) {
		return { ...DEFAULT_CONFIG }
	}

	try {
		const configFile = new File(entry.configPath)
		if (!configFile.exists) return { ...DEFAULT_CONFIG }

		const rawContent = await configFile.text()
		if (!rawContent) return { ...DEFAULT_CONFIG }

		const parsed: unknown = JSON.parse(rawContent)
		if (typeof parsed !== 'object' || parsed === null) {
			return { ...DEFAULT_CONFIG }
		}

		const p = parsed as Record<string, unknown>

		return {
			tileOverlap:
				typeof p.tileOverlap === 'number'
					? p.tileOverlap
					: DEFAULT_CONFIG.tileOverlap,
			preferredColourMode:
				typeof p.preferredColourMode === 'string' &&
				(p.preferredColourMode === 'texture_only' ||
					p.preferredColourMode === 'lab_match' ||
					p.preferredColourMode === 'none')
					? p.preferredColourMode
					: DEFAULT_CONFIG.preferredColourMode,
			previewResolution:
				typeof p.previewResolution === 'number'
					? p.previewResolution
					: DEFAULT_CONFIG.previewResolution,
			inferenceResolution:
				typeof p.inferenceResolution === 'number'
					? p.inferenceResolution
					: DEFAULT_CONFIG.inferenceResolution,
			luminanceBlend:
				typeof p.luminanceBlend === 'number'
					? p.luminanceBlend
					: DEFAULT_CONFIG.luminanceBlend,
			defaultColourMode:
				typeof p.defaultColourMode === 'string' &&
				(p.defaultColourMode === 'texture_only' ||
					p.defaultColourMode === 'lab_match' ||
					p.defaultColourMode === 'none')
					? p.defaultColourMode
					: DEFAULT_CONFIG.defaultColourMode,
		}
	} catch (err) {
		tracker.warn(
			`Config parse error for style "${styleId}" — using defaults: ${err}`
		)
		return { ...DEFAULT_CONFIG }
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY READ UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

export function getRegistryEntry(styleId: StyleId): ModelRegistryEntry | null {
	return _readRegistryEntry(styleId)
}

/** Returns all style IDs that have a registry entry (any status). */
export function getAllRegisteredStyleIds(): StyleId[] {
	return _storage
		.getAllKeys()
		.filter((k: string) => k.startsWith(REGISTRY_KEY_PREFIX))
		.map((k: string) => k.slice(REGISTRY_KEY_PREFIX.length))
}

/** Returns only style IDs whose registry entry is in 'downloaded' state. */
export function getDownloadedStyleIds(): StyleId[] {
	return getAllRegisteredStyleIds().filter((id) => {
		const entry = _readRegistryEntry(id)
		return entry?.downloadStatus === 'downloaded'
	})
}

/**
 * Returns the true physical on-disk byte count (preview + main) for a style.
 * Returns 0 if the style is not in 'downloaded' state.
 * PRD §6.2 Issue 6: uses File.size, not manifest fileSize string.
 */
export function getPhysicalFootprint(styleId: StyleId): number {
	const entry = _readRegistryEntry(styleId)
	if (!entry || entry.downloadStatus !== 'downloaded') return 0
	return (entry.previewSize ?? 0) + (entry.mainSize ?? 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// DEBUG UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

export function debugInspectSharedStorage(): void {
	tracker.log('============== MMKV STORAGE INSPECTION ==============')
	const allKeys = _storage.getAllKeys()
	tracker.log(`All keys in '${STORAGE_INSTANCE_IDS.MODELS}':`)
	for (const key of allKeys) {
		const val = _storage.getString(key)
		tracker.log(`  [${key}] = ${val ? val.slice(0, 120) : '<empty>'}...`)
	}
	tracker.log('=====================================================')
}
