/**
 * ArtLens — StyleJobService (v5 — resolution-agnostic model config hydration)
 *
 * Module-level singleton driving the background stylization queue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES vs v4 (resolution-agnostic refactor)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX 11 — Mandate 1: Dynamic config hydration before any model slot load.
 *    getModelConfig(job.styleId) is now awaited inside the inner try block,
 *    before loadMainModel or loadPreviewModel is called. The resolved config
 *    object is passed as the second argument to both loaders, storing it on
 *    the hardware slot so TiledInferenceRunner can retrieve live resolution
 *    via getActiveModelConfig() without a secondary manifest round-trip.
 *
 *  FIX 12 — Mandate 2: Complete resolution blindness.
 *    All hardcoded resolution literals eliminated. Every log message, tracker
 *    metric, and error string that references a tile dimension now reads from
 *    config.mainModel (main path) or config.previewModel (preview path).
 *
 *  FIX 13 — Mandate 3 / BatteryGuardError parity.
 *    BatteryGuardError thrown by loadMainModel is now caught and handled
 *    identically to InferenceAbortError — job transitions to BATTERY_PAUSED.
 *    Both error types fall through to the inner finally without duplicating
 *    unloadModel or _currentJobId cleanup.
 *
 *  FIX 14 — Mandate 3 / nextPreviewJob routing bug.
 *    nextPreviewJob was incorrectly sourced from status === 'BATTERY_PAUSED',
 *    causing paused main-inference jobs to be picked up and run through the
 *    preview (student) slot. Corrected to status === 'PREVIEW_QUEUED'.
 *    isPreviewJob guard updated accordingly.
 *
 *  FIX 15 — Mandate 3 / outer finally queue continuation.
 *    Outer finally now schedules processNextJobInQueue() via setTimeout(0)
 *    after releasing _processingLock, keeping the queue draining fluidly
 *    without relying on external callers to re-trigger processing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRESERVED CHANGES FROM v4
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX 1  — loadMainModel API contract mismatch (was runtime TypeError).
 *  FIX 2  — unloadModel is synchronous — all call-sites correct as-is.
 *  FIX 3  — _processingLock set synchronously before the first await.
 *  FIX 4  — abort path memory leak (model unloaded before ID cleared).
 *  FIX 5  — cancelJob delegates to removeJob() — not ERROR status.
 *  FIX 6  — runTiledInference replaces simulated setTimeout loop.
 *  FIX 7  — InferenceAbortError caught specifically → BATTERY_PAUSED.
 *  FIX 8  — onProgress guards _currentJobId before writing progress.
 *  FIX 9  — Stale fp16 pipeline comments updated to reflect float32 reality.
 *  FIX 10 — Preview job support added (student model, dynamic preview-res slot).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PIPELINE LIFECYCLE (inner try block — main job)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  0. getModelConfig(styleId)          — hydrate live config (await; before any load)
 *  1. unloadModel('preview')           — free live-preview GPU slot
 *  2. loadMainModel(path, config)      — load teacher .tflite (may throw BatteryGuardError)
 *  3. runTiledInference(...)           — full decode → tile → stitch → encode
 *       ├─ shouldAbort() polled before each tile's synchronous inference call
 *       ├─ InferenceAbortError thrown if shouldAbort() returns true
 *       └─ onProgress(fraction) called after each tile [0.0 → 1.0]
 *  4a. DONE    → updateJob(DONE, resultUri)
 *  4b. ABORT   → catch InferenceAbortError|BatteryGuardError → updateJob(BATTERY_PAUSED)
 *  4c. ERROR   → catch generic Error → failJob(ERROR, message)
 *  5.  finally → unloadModel('main'), _currentJobId = null  (always)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PIPELINE LIFECYCLE (inner try block — preview job)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  0. getModelConfig(styleId)          — hydrate live config (await; before any load)
 *  1. loadPreviewModel(path, config)   — load student .tflite into preview slot
 *  2. runPreviewInference(...)         — full decode → tile → stitch → encode
 *       ├─ shouldAbort() polled before each tile
 *       └─ onProgress(fraction) called after each tile [0.0 → 1.0]
 *  3a. DONE    → updateJob(DONE, resultUri)
 *  3b. ABORT   → catch InferenceAbortError → updateJob(BATTERY_PAUSED)
 *  3c. ERROR   → catch generic Error → failJob(ERROR, message)
 *  4.  finally → unloadModel('preview'), _currentJobId = null  (always)
 *
 * PRD § 5 — src/features/style-transfer/StyleJobService.ts
 */

import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import * as InferenceEngine from '@/core/inference/InferenceEngine'
import {
	getModelPath,
	getRegistryEntry,
	getModelConfig,
} from '@/core/storage/ModelManager'
import {
	runCoarseToFineInference,
	runCoarseToFinePreviewInference,
	InferenceAbortError,
} from '@/core/inference/CoarseToFineRunner'
import type { JobId, StyleId } from '@/types'

import { createTracker } from '@/shared/utils/logger'
const tracker = createTracker('StyleJobService')

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — MODULE-LEVEL TRACKING SYNCHRONIZATION STATES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processing lock flag (outer mutex).
 *
 * FIX 3: Set synchronously before the first `await` in processNextJobInQueue.
 * JS single-threaded semantics guarantee mutual exclusion between the guard
 * check and the assignment as long as no `await` separates them. This is the
 * only safe concurrency pattern for re-entrancy prevention in single-threaded
 * JS runtimes (RN Hermes, V8).
 */
let _processingLock: boolean = false

/**
 * The JobId of the job currently being processed (between startJob and DONE/ERROR/PAUSED).
 *
 * Distinct from _processingLock:
 *   _processingLock  → gates ENTRY to processNextJobInQueue()
 *   _currentJobId    → identifies the active job for abort/progress signalling
 *
 * Cleared in the inner `finally` block (before _processingLock is released in
 * the outer finally). Null while the queue is idle or between jobs.
 */
let _currentJobId: JobId | null = null

/**
 * Cooperative abort signal.
 *
 * FIX 7: Set to `true` by pauseJob(), prioritizeJob(), and cancelJob().
 * Read synchronously by TiledInferenceRunner via the `shouldAbort` callback.
 * The runner checks it at the start of each tile iteration (before the
 * synchronous TFLite call) and throws InferenceAbortError if true.
 *
 * Reset to `false` immediately after _currentJobId is claimed (before startJob)
 * to prevent a stale abort from a prior job from silently aborting its successor.
 *
 * Maximum abort latency = one tile's inference time (~50–200ms on mid-range GPU delegate).
 */
let _abortCurrentJob: boolean = false

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export const StyleJobService = {
	// ─────────────────────────────────────────────────────────────────────────
	// SECTION 2 — processNextJobInQueue
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Dequeues and processes the next eligible job. Must be called after every
	 * state change that could produce a QUEUED or PREVIEW_QUEUED job:
	 *   - After enqueue() / addJob()
	 *   - After retryJob()
	 *   - After resumeAll() (battery recovered)
	 *   - On app foreground
	 *
	 * The outer finally schedules a zero-delay self-call to drain the queue
	 * without requiring external callers to chain processNextJobInQueue() manually.
	 *
	 * ── Lock invariants (Mandate 3) ──────────────────────────────────────────
	 *
	 *   Outer try/finally: _processingLock gates entry; released unconditionally.
	 *   Inner try/catch/finally: hardware slot + job identity; cleaned up atomically.
	 *
	 *   The guard check and assignment share no await between them:
	 *     if (_processingLock) return          ← check
	 *     _processingLock = true               ← assign (NO await between these)
	 *
	 * ── Config hydration (Mandate 1) ─────────────────────────────────────────
	 *
	 *   getModelConfig(styleId) is awaited as the first operation inside the inner
	 *   try, before any InferenceEngine load call. The resolved ModelConfig is
	 *   passed to loadMainModel / loadPreviewModel, which store it on the hardware
	 *   slot. TiledInferenceRunner retrieves it via getActiveModelConfig(slot) —
	 *   avoiding a secondary manifest round-trip inside the hot tile loop.
	 *
	 * ── Resolution blindness (Mandate 2) ─────────────────────────────────────
	 *
	 *   All log strings, tracker metrics, and error messages that reference a tile
	 *   dimension read from config.mainModel (main path) or config.previewModel
	 *   (preview path). No hardcoded resolution literals anywhere in this method.
	 *
	 * ── Error handling ───────────────────────────────────────────────────────
	 *
	 *   InferenceAbortError  → cooperative tile-boundary interrupt → BATTERY_PAUSED
	 *   BatteryGuardError    → thrown by loadMainModel at battery threshold → BATTERY_PAUSED
	 *   generic Error        → pipeline crash (decode, TFLite, Skia, OOM) → ERROR / failJob
	 *
	 *   Catch blocks update the Zustand store and fall through to the inner finally.
	 *   They do NOT duplicate unloadModel or _currentJobId cleanup — that is the
	 *   exclusive responsibility of the inner finally block.
	 */
	async processNextJobInQueue(): Promise<void> {
		// ── Mandate 3: Synchronous, ungapped lock acquisition ─────────────────
		//
		// FIX 3: The guard check and flag assignment must have no `await` between
		// them. JS single-threaded event loop guarantees mutual exclusion here.
		if (_processingLock) return
		_processingLock = true

		try {
			const { jobs, startJob, updateJob, failJob } =
				useStyleJobStore.getState()

			// ── Job selection — preview (PREVIEW_QUEUED) takes priority ───────
			//
			// FIX 14: Preview jobs are identified exclusively by status === 'PREVIEW_QUEUED'.
			// The prior implementation incorrectly matched 'BATTERY_PAUSED', which caused
			// paused main-inference jobs to be routed through the student (preview) model
			// slot — a silent, hard-to-reproduce corruption of slot occupancy state.
			const nextPreviewJob = jobs.find(
				(j) => j.status === 'PREVIEW_QUEUED'
			)
			const nextMainJob = jobs.find((j) => j.status === 'QUEUED')
			const nextJob = nextPreviewJob ?? nextMainJob

			if (!nextJob) {
				return
			}

			// FIX 14: isPreviewJob derived from the corrected PREVIEW_QUEUED check.
			const isPreviewJob = nextJob.status === 'PREVIEW_QUEUED'
			const modelSlot = isPreviewJob ? 'preview' : 'main'

			// ── Model presence guard ──────────────────────────────────────────
			const registryEntry = getRegistryEntry(nextJob.styleId)
			const modelPath = registryEntry
				? getModelPath(nextJob.styleId, modelSlot)
				: null

			if (!registryEntry || !modelPath) {
				tracker.warn(
					`[StyleJobService] Model pack missing for style "${nextJob.styleId}" ` +
						`slot="${modelSlot}". ` +
						`Registry: ${registryEntry ? 'found' : 'missing'}, ` +
						`status: ${registryEntry?.downloadStatus ?? 'n/a'}. ` +
						`Failing job ${nextJob.id}.`
				)
				failJob(
					nextJob.id,
					`Model asset pack not found for slot "${modelSlot}". ` +
						'Please download the style pack first.'
				)
				return
			}

			// ── Claim the job slot ────────────────────────────────────────────
			//
			// Mandate 3: _abortCurrentJob reset AFTER _currentJobId is claimed but
			// BEFORE startJob() is called. Prevents a stale abort signal from a prior
			// job silently aborting its successor at the first tile boundary check.
			_currentJobId = nextJob.id
			_abortCurrentJob = false
			startJob(_currentJobId)

			try {
				// ── BUG 12 FIX: Stale snapshot re-verification ────────────────
				//
				// `jobs` above is a snapshot captured before any await. Between that
				// snapshot and `startJob` the user could have called cancelJob() →
				// removeJob(), deleting the job from the store. startJob() on a
				// non-existent ID is a silent no-op. The inference pipeline would
				// then run to completion and write updateJob(id, { status: 'DONE' })
				// on a ghost ID — also a silent no-op — so the result is permanently
				// lost and the UI never shows it.
				//
				// Fix: re-query the live store at the very top of the inner try,
				// before any await. If the job is gone, return immediately. The inner
				// finally still executes (unloadModel + _currentJobId = null).
				const liveJobCheck = useStyleJobStore
					.getState()
					.jobs.find((j) => j.id === _currentJobId)
				if (!liveJobCheck) {
					tracker.warn(
						`[StyleJobService] Job ${_currentJobId} was removed between the ` +
							`queue snapshot and startJob — skipping inference to prevent ` +
							`a ghost result write.`
					)
					return
				}

				// ── Mandate 1: Hydrate live model config ──────────────────────
				//
				// FIX 11: getModelConfig MUST be fully resolved before any call to
				// loadMainModel or loadPreviewModel. The config object is passed
				// directly to the loader, which stores it on the hardware slot via
				// _loadedConfigs[slot]. TiledInferenceRunner reads it back through
				// InferenceEngine.getActiveModelConfig(slot) — no secondary manifest
				// query in the hot tile loop.
				const config = await getModelConfig(nextJob.styleId)

				if (isPreviewJob) {
					// ── PREVIEW PATH: student model, dynamic previewModel-res, float32 ─
					//
					// Student model tile resolution: config.previewModel (e.g. 256)
					//   Input  : [1, R, R, 3] float32 NHWC, values in [-1, 1]  (R = config.previewModel)
					//   Output : [1, R, R, 3] float32 NHWC, Tanh → [-1, 1]
					//   Normalization: (pixel / 127.5) − 1.0 → [-1, 1]  (both I/O float32)
					//
					// No explicit unloadModel('main') needed: loadPreviewModel unloads
					// 'main' synchronously before its first internal await.
					await InferenceEngine.loadPreviewModel(modelPath, config)

					const result = await runCoarseToFinePreviewInference(
						nextJob.sourceUri,
						nextJob.styleId,
						{
							// FIX 8: Guard against a null _currentJobId before writing progress.
							onProgress: (fraction: number) => {
								if (_currentJobId) {
									updateJob(_currentJobId, {
										progress: fraction,
									})
								}
							},
							// Reads _abortCurrentJob synchronously — no async gap between
							// the read and the InferenceAbortError throw in TiledInferenceRunner.
							shouldAbort: () => _abortCurrentJob,
						}
					)

					if (_currentJobId) {
						updateJob(_currentJobId, {
							status: 'DONE',
							resultUri: result.resultUri,
						})
					}

					tracker.log(
						`[StyleJobService] Preview job ${_currentJobId} DONE — ` +
							// FIX 12: Resolution derived from live config, not hardcoded literal.
							`${result.totalTiles} tiles @ ${config.previewModel}×${config.previewModel}, ` +
							`${result.durationMs}ms, uri=${result.resultUri}`
					)
				} else {
					// ── MAIN PATH: teacher model, dynamic mainModel-res, float32 ──────
					//
					// Teacher model tile resolution: config.mainModel (e.g. 512)
					//   Input  : [1, R, R, 3] float32 NHWC, values in [-1, 1]  (R = config.mainModel)
					//   Output : [1, R, R, 3] float32 NHWC, Tanh → [-1, 1]
					//   Normalization: (pixel / 127.5) − 1.0 → [-1, 1]  (both I/O float32)
					//
					// FIX 4 (preserved): Unload 'preview' synchronously before the first
					// await inside loadMainModel — guarantees single-slot occupancy.
					// loadMainModel also performs this unload internally, but the explicit
					// call here provides a belt-and-suspenders invariant for slot clarity.
					InferenceEngine.unloadModel('preview')

					// FIX 1: loadMainModel is async — awaited.
					// FIX 11: config passed as second argument — stored on hardware slot.
					// May throw BatteryGuardError (caught below alongside InferenceAbortError).
					await InferenceEngine.loadMainModel(modelPath, config)

					// ── Real tiled inference pipeline ─────────────────────────────────
					//
					// runTiledInference() drives the full pipeline:
					//   Phase 1  DECODE   sourceUri → Skia → fullRgba Uint8Array
					//   Phase 2  GRID     tileImage(W, H, config) → TileGrid
					//   Phase 3  HOT LOOP for each coord:
					//              A) _extractTileRgba → _tileScratch[R×R×4]
					//              B) prepareInputTensor → mainInputBuffer[R×R×3×4] float32
					//                 normalization: (pixel/127.5) − 1.0 → [-1, 1]
					//              C) runInferenceSync('main') → rawF32 ArrayBuffer
					//                 [1,R,R,3] float32 NHWC, Tanh → [-1, 1]
					//              D) push ProcessedTile{ coord, rawF32 }
					//              E) shouldAbort() → throw InferenceAbortError if true
					//              F) onProgress(k/total) → updateJob progress
					//              G) yield to event loop (setTimeout 0)
					//   Phase 4  STITCH   stitchTiles(grid, tiles) → Float32Array [0,1]
					//              denormalization: (v + 1.0) × 0.5 inline per pixel
					//   Phase 5  EXPORT   f32StitchedToRgba → Skia JPEG → cache write
					//
					// R (tile resolution) is read from InferenceEngine.getActiveModelConfig('main')
					// by TiledInferenceRunner — supplied via the config object passed to loadMainModel.
					const result = await runCoarseToFineInference(
						nextJob.sourceUri,
						nextJob.styleId,
						{
							/**
							 * FIX 8: Guard against a null _currentJobId.
							 * Cannot occur in practice under the lock invariant, but satisfies
							 * TypeScript null-check and prevents a silent write to a stale slot
							 * in the event of unexpected re-entry.
							 */
							onProgress: (fraction: number) => {
								if (_currentJobId) {
									updateJob(_currentJobId, {
										progress: fraction,
									})
								}
							},
							/**
							 * Returns the current cooperative abort signal synchronously.
							 * No async gap between the read and the InferenceAbortError throw
							 * inside TiledInferenceRunner.
							 */
							shouldAbort: () => _abortCurrentJob,
						}
					)

					if (_currentJobId) {
						updateJob(_currentJobId, {
							status: 'DONE',
							resultUri: result.resultUri,
						})
					}

					tracker.log(
						`[StyleJobService] Main job ${_currentJobId} DONE — ` +
							// FIX 12: Resolution derived from live config, not hardcoded literal.
							`${result.totalTiles} tiles @ ${config.mainModel}×${config.mainModel}, ` +
							`${result.durationMs}ms, uri=${result.resultUri}`
					)
				}
			} catch (error) {
				// ── FIX 7 / FIX 13: Discriminated pause vs. error handling ──────────
				//
				// TWO COOPERATIVE INTERRUPTION TYPES → BATTERY_PAUSED:
				//
				//   InferenceAbortError — thrown by TiledInferenceRunner when
				//     shouldAbort() returns true at a tile boundary. A cooperative
				//     interruption: job can be resumed once battery recovers or the
				//     user re-queues.
				//
				//   BatteryGuardError (FIX 13) — thrown by loadMainModel when battery
				//     level ≤ BATTERY_LIMITS.CRITICAL_THRESHOLD_PERCENT. Treated
				//     identically to InferenceAbortError — job transitions to
				//     BATTERY_PAUSED, not ERROR. No Retry button shown.
				//
				// BATTERY_PAUSED semantics (both types):
				//   - Job preserved in queue at its current styleId.
				//   - Progress reset to 0 when resumeAll() re-queues it.
				//   - No error overlay shown in Gallery or EditCanvas.
				//   - retryable NOT set to true.
				//
				// CRITICAL: Do NOT call unloadModel or clear _currentJobId here.
				// The inner finally block below is the sole owner of that cleanup.
				if (
					error instanceof InferenceAbortError ||
					error instanceof InferenceEngine.BatteryGuardError
				) {
					const pauseReason =
						error instanceof InferenceEngine.BatteryGuardError
							? `low battery (${error.batteryLevel}%)`
							: 'cooperative tile-boundary abort'

					tracker.log(
						`[StyleJobService] Job ${_currentJobId} interrupted — ` +
							`${pauseReason} → BATTERY_PAUSED.`
					)
					if (_currentJobId) {
						updateJob(_currentJobId, { status: 'BATTERY_PAUSED' })
					}
					// Intentional fall-through to inner finally.
					// unloadModel and _currentJobId = null are handled there exclusively.
				} else {
					// Genuine pipeline failure: decode error, TFLite crash,
					// filesystem write failure, Skia encode failure, OOM, etc.
					tracker.error(
						`[StyleJobService] Pipeline crash — Job: ${_currentJobId}`,
						error
					)
					if (_currentJobId) {
						failJob(
							_currentJobId,
							error instanceof Error
								? `Stylization failed: ${error.message}`
								: 'Internal pipeline error. Tap Retry to try again.'
						)
					}
					// Intentional fall-through to inner finally.
				}
			} finally {
				// ── Inner finally: hardware slot + job identity cleanup ────────────
				//
				// FIX 4 (preserved): unloadModel BEFORE clearing _currentJobId.
				// Prevents the preview loop from reloading the preview slot while the
				// main model is still resident (InferenceEngine enforces one model per slot).
				//
				// Mandate 3: Must always unload the slot that was loaded for THIS job type.
				// Preview jobs load 'preview'; main jobs load 'main'.
				// Safe to call even if loadMainModel/loadPreviewModel threw before completing —
				// unloadModel is a synchronous no-op on an already-empty slot.
				InferenceEngine.unloadModel(isPreviewJob ? 'preview' : 'main')
				_currentJobId = null
			}
		} finally {
			// ── Outer finally: processing lock release + queue continuation ────────
			//
			// FIX 3 (preserved): _processingLock released unconditionally in all exit
			// paths — including early returns (no nextJob, missing model pack) and any
			// unhandled throw that escapes the inner try.
			//
			// FIX 15: Zero-delay setTimeout schedules the next queue drain cycle after
			// the current microtask checkpoint, allowing pending Zustand state mutations
			// (DONE, BATTERY_PAUSED, ERROR) to settle before the next dequeue attempt.
			// This keeps the queue processing fluidly without requiring external callers
			// to re-invoke processNextJobInQueue() after each job completes.
			_processingLock = false
			setTimeout(() => StyleJobService.processNextJobInQueue(), 0)
		}
	},

	// ─────────────────────────────────────────────────────────────────────────
	// SECTION 3 — QUEUE ORCHESTRATION & CANCELLATION HANDLERS
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Moves a QUEUED job to the front of the queue, interrupting the current
	 * job at its next tile boundary if it is a different job.
	 *
	 * Sets _abortCurrentJob = true only when the active job differs from jobId,
	 * so prioritizing the already-running job is a safe no-op.
	 */
	prioritizeJob(jobId: JobId): void {
		const { prioritize } = useStyleJobStore.getState()
		if (_currentJobId !== null && _currentJobId !== jobId) {
			_abortCurrentJob = true
		}
		prioritize(jobId)
	},

	/**
	 * Signals the current job to pause at the next tile boundary by setting
	 * _abortCurrentJob = true.
	 *
	 * FIX 7 (preserved): The status transition to BATTERY_PAUSED is handled
	 * inside the InferenceAbortError catch block in processNextJobInQueue, NOT
	 * here. This method is a pure signal — no store mutations.
	 */
	pauseJob(jobId: JobId): void {
		if (_currentJobId === jobId) {
			_abortCurrentJob = true
		}
	},

	/**
	 * Resumes all BATTERY_PAUSED jobs by transitioning them to QUEUED with
	 * progress reset to 0. Call when battery level rises above threshold or
	 * power-saver mode is disabled.
	 *
	 * BUG 11 FIX: Previously this method only updated job statuses without
	 * triggering queue processing. If the queue had drained to empty before
	 * the battery pause (all other jobs finished, only paused jobs remained),
	 * `_processingLock` was false and no setTimeout continuation was pending.
	 * After resumeAll() the paused jobs transitioned to QUEUED but nothing
	 * called processNextJobInQueue() — they sat in QUEUED permanently until
	 * some other action re-triggered the service.
	 *
	 * Fix: call processNextJobInQueue() unconditionally after status updates.
	 * If the queue is already draining (lock held), processNextJobInQueue
	 * is a fast no-op (guard check + return). If the queue is idle, it starts
	 * the drain cycle immediately.
	 */
	resumeAll(): void {
		const { jobs, updateJob } = useStyleJobStore.getState()
		jobs.filter((j) => j.status === 'BATTERY_PAUSED').forEach((j) =>
			updateJob(j.id, { status: 'QUEUED', progress: 0 })
		)
		StyleJobService.processNextJobInQueue()
	},

	/**
	 * Cancels a job, removing it from the active processing pipeline.
	 *
	 * FIX 5 (preserved): Delegates to useStyleJobStore.removeJob() to fully
	 * remove the cancelled job rather than transitioning it to ERROR. A
	 * user-initiated cancellation is not a failure state and must not display
	 * an error overlay or offer a Retry button.
	 *
	 * If the job is currently active, sets _abortCurrentJob = true so the
	 * runner exits at the next tile boundary. The store removal happens
	 * synchronously; the inner finally will still fire (unloadModel,
	 * _currentJobId = null) but updateJob/failJob calls in the catch will
	 * silently no-op on the already-removed job ID.
	 */
	cancelJob(jobId: JobId): void {
		if (_currentJobId === jobId) {
			_abortCurrentJob = true
		}
		useStyleJobStore.getState().removeJob(jobId)
	},

	/** Returns the JobId of the currently processing job, or null if idle. */
	getActiveJobId(): JobId | null {
		return _currentJobId
	},

	/** Returns true if any active or queued job is using the given style. */
	isStyleInUse(styleId: StyleId): boolean {
		const { jobs } = useStyleJobStore.getState()
		return jobs.some(
			(j) =>
				j.styleId === styleId &&
				(j.status === 'QUEUED' ||
					j.status === 'PREVIEW_QUEUED' ||
					j.status === 'BATTERY_PAUSED' ||
					j.status === 'PROCESSING')
		)
	},
}
