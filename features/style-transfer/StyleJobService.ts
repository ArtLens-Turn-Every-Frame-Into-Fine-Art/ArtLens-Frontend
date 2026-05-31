/**
 * ArtLens — StyleJobService (v4 — float32 model integration)
 *
 * Module-level singleton driving the background stylization queue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES vs v3 (float32 model integration)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX 9 — Stale fp16 pipeline comments updated to reflect float32 reality.
 *    The v3 comment block in processNextJobInQueue still referenced "fp16" for
 *    the mainInputBuffer and tile output types. Both teacher and student models
 *    are float32 I/O. Comments now correctly describe the float32 pipeline and
 *    the CUT normalization: (pixel/127.5) − 1.0 → [-1, 1].
 *
 *  FIX 10 — Preview job support added (student model, 256×256 slot).
 *    StyleJobService now distinguishes PREVIEW_QUEUED jobs from QUEUED jobs.
 *    A PREVIEW_QUEUED job loads the student model into the 'preview' slot and
 *    calls runPreviewInference() instead of runTiledInference().
 *    Main and preview jobs are mutually exclusive via _processingLock — only
 *    one forward-pass pipeline can run at a time.
 *
 *    Teacher (main):
 *      loadMainModel  → unload preview → runTiledInference   (512×512, float32)
 *    Student (preview):
 *      loadPreviewModel → runPreviewInference              (256×256, float32)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRESERVED CHANGES FROM v3
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX 1 — loadMainModel API contract mismatch (was runtime TypeError).
 *  FIX 2 — unloadModel is synchronous — all call-sites correct as-is.
 *  FIX 3 — _processingLock set synchronously before the first await.
 *  FIX 4 — abort path memory leak (model unloaded before ID cleared).
 *  FIX 5 — cancelJob delegates to removeJob() — not ERROR status.
 *  FIX 6 — runTiledInference replaces simulated setTimeout loop.
 *  FIX 7 — InferenceAbortError caught specifically → BATTERY_PAUSED.
 *  FIX 8 — onProgress guards _currentJobId before writing progress.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PIPELINE LIFECYCLE (inner try block — main job)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. unloadModel('preview')           — free live-preview GPU slot
 *  2. loadMainModel(modelPath)         — load teacher .tflite (may throw BatteryGuardError)
 *  3. runTiledInference(...)           — full decode → tile → stitch → encode
 *       ├─ shouldAbort() polled before each tile's synchronous inference call
 *       ├─ InferenceAbortError thrown if shouldAbort() returns true
 *       └─ onProgress(fraction) called after each tile [0.0 → 1.0]
 *  4a. DONE    → updateJob(DONE, resultUri)
 *  4b. ABORT   → catch InferenceAbortError → updateJob(BATTERY_PAUSED)
 *  4c. ERROR   → catch generic Error     → failJob(ERROR, message)
 *  5.  finally → unloadModel('main'), _currentJobId = null  (always)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PIPELINE LIFECYCLE (inner try block — preview job)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. loadPreviewModel(previewPath)    — load student .tflite into preview slot
 *  2. runPreviewInference(...)         — full decode → tile → stitch → encode
 *       ├─ shouldAbort() polled before each tile
 *       └─ onProgress(fraction) called after each tile [0.0 → 1.0]
 *  3a. DONE    → updateJob(DONE, resultUri)
 *  3b. ABORT   → catch InferenceAbortError → updateJob(BATTERY_PAUSED)
 *  3c. ERROR   → catch generic Error     → failJob(ERROR, message)
 *  4.  finally → unloadModel('preview'), _currentJobId = null  (always)
 *
 * PRD § 5 — src/features/style-transfer/StyleJobService.ts
 */

import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import * as InferenceEngine from '@/core/inference/InferenceEngine'
import { getModelPath, getRegistryEntry } from '@/core/storage/ModelManager'
import {
	runTiledInference,
	runPreviewInference,
	InferenceAbortError,
} from '@/core/inference/TiledInferenceRunner'
import type { JobId, StyleId } from '@/types'

import { createTracker } from '@/shared/utils/logger'
const tracker = createTracker('StyleJobService')

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FIX 3: Processing lock flag.
 * Set synchronously before the first `await` in processNextJobInQueue.
 * JS single-threaded semantics guarantee mutual exclusion between the
 * if-check and the assignment as long as they are not separated by an await.
 */
let _processingLock = false

/**
 * The JobId of the job currently being processed (between startJob and DONE/ERROR).
 * Distinct from _processingLock: _processingLock gates entry to the function,
 * _currentJobId tracks which job is active for abort/prioritize signalling.
 */
let _currentJobId: JobId | null = null

/**
 * Cooperative abort signal. Set to true by pauseJob/prioritizeJob/cancelJob.
 *
 * FIX 7: This flag is now read by TiledInferenceRunner via the `shouldAbort`
 * callback rather than being polled inside a manual setTimeout loop. The runner
 * checks it at the start of each tile iteration (before the synchronous TFLite
 * call) and throws InferenceAbortError if true. Maximum abort latency is one
 * tile's inference time (~50–200ms on Samsung A-series GPU delegate).
 */
let _abortCurrentJob = false

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export const StyleJobService = {
	/**
	 * Processes the next QUEUED job in the store, if no job is already running.
	 *
	 * Call this after every state change that could add a QUEUED job:
	 *   - After enqueue()
	 *   - After retryJob()
	 *   - After resumeAll() (battery restored)
	 *   - On app foreground
	 *
	 * FIX 3: _processingLock is set synchronously before the first await,
	 * preventing concurrent calls from both entering the processing body.
	 *
	 * FIX 7: The inner try/catch/finally now cleanly handles three outcomes:
	 *   - DONE          : runTiledInference / runPreviewInference returns successfully
	 *   - BATTERY_PAUSED: InferenceAbortError caught, job paused
	 *   - ERROR         : Any other exception, job failed with retryable=true
	 *
	 * FIX 9: Model slot routing — QUEUED jobs use the main (teacher, 512×512)
	 * slot. PREVIEW_QUEUED jobs use the preview (student, 256×256) slot.
	 * Both models are float32 I/O. CUT normalization applies to both:
	 *   input:  (pixel / 127.5) − 1.0  →  [-1, 1]  float32
	 *   output: (v + 1.0) * 0.5        →  [0, 1]   float32 (then × 255 for uint8)
	 */
	async processNextJobInQueue(): Promise<void> {
		// FIX 3: Guard check + flag set happen with no await between them.
		// This is the only safe concurrency pattern in single-threaded JS:
		// check and assign before any suspension point.
		if (_processingLock) return
		_processingLock = true

		try {
			const { jobs, startJob, updateJob, failJob } =
				useStyleJobStore.getState()

			// Check for preview jobs first (higher priority — live viewfinder UX),
			// then fall back to regular main-model jobs.
			const nextPreviewJob = jobs.find(
				(j) => j.status === 'BATTERY_PAUSED'
			)
			const nextMainJob = jobs.find((j) => j.status === 'QUEUED')
			const nextJob = nextPreviewJob ?? nextMainJob

			if (!nextJob) {
				return
			}

			const isPreviewJob = nextJob.status === 'BATTERY_PAUSED'
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
			_currentJobId = nextJob.id
			_abortCurrentJob = false
			startJob(_currentJobId)

			try {
				if (isPreviewJob) {
					// ── PREVIEW PATH: student model, 256×256, float32 ─────────────
					//
					// Student model:
					//   artlens_student_ngf32_b4_e150_zpad_simplified_float32.tflite
					//   Input  : [1, 256, 256, 3] float32 NHWC, values in [-1, 1]
					//   Output : [1, 256, 256, 3] float32 NHWC, Tanh → [-1, 1]
					//
					// FIX 2: loadPreviewModel is async — must be awaited.
					// No unloadModel('main') needed here: the preview slot is independent.
					// If a main model is loaded, it remains; preview slot is separate.
					await InferenceEngine.loadPreviewModel(modelPath)

					const result = await runPreviewInference(
						nextJob.sourceUri,
						nextJob.styleId,
						{
							// FIX 8: Guard against a null _currentJobId.
							onProgress: (fraction: number) => {
								if (_currentJobId) {
									updateJob(_currentJobId, {
										progress: fraction,
									})
								}
							},
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
							`${result.totalTiles} tiles, ${result.durationMs}ms, ` +
							`uri=${result.resultUri}`
					)
				} else {
					// ── MAIN PATH: teacher model, 512×512, float32 ────────────────
					//
					// Teacher model:
					//   artlens_teacher_ngf64_e179_ph1_zpad_simplified_float32.tflite
					//   Input  : [1, 512, 512, 3] float32 NHWC, values in [-1, 1]
					//   Output : [1, 512, 512, 3] float32 NHWC, Tanh → [-1, 1]
					//
					// FIX 1: loadMainModel is async — must be awaited.
					// FIX 4: Unload preview BEFORE loading main — guarantees single-slot
					//   occupancy (InferenceEngine enforces one loaded model at a time).
					InferenceEngine.unloadModel('preview')
					await InferenceEngine.loadMainModel(modelPath)

					// ── Real tiled inference pipeline ─────────────────────────────
					//
					// runTiledInference() drives the full pipeline:
					//   Phase 1  DECODE   sourceUri → Skia → fullRgba Uint8Array
					//   Phase 2  GRID     tileImage(W, H, config) → TileGrid
					//   Phase 3  HOT LOOP for each coord:
					//              A) _extractTileRgba → _tileScratch[512×512×4]
					//              B) prepareInputTensor → mainInputBuffer[512×512×3×4]
					//                 normalization: (pixel/127.5) − 1.0 → [-1, 1] float32
					//              C) runInferenceSync('main') → rawF32 ArrayBuffer
					//                 [1,512,512,3] float32 NHWC, Tanh → [-1, 1]
					//              D) push ProcessedTile{ coord, rawF32 }
					//              E) shouldAbort() → throw InferenceAbortError if true
					//              F) onProgress(k/total) → updateJob progress
					//              G) yield to event loop (setTimeout 0)
					//   Phase 4  STITCH   stitchTiles(grid, tiles) → Float32Array [0,1]
					//              denormalization: (v + 1.0) × 0.5 inline per pixel
					//   Phase 5  EXPORT   f32StitchedToRgba → Skia JPEG → cache write
					//
					// CALLBACKS:
					//   onProgress(fraction)  — strict [0.0, 1.0] per tile completion.
					//   shouldAbort()         — reads _abortCurrentJob synchronously.
					const result = await runTiledInference(
						nextJob.sourceUri,
						nextJob.styleId,
						{
							/**
							 * FIX 8: Guard against a null _currentJobId.
							 * This cannot happen in practice (the lock guarantees single
							 * occupancy and _currentJobId is only cleared in finally), but
							 * the defensive check satisfies the TypeScript null-check and
							 * prevents a silent update to a stale slot on unexpected re-entry.
							 */
							onProgress: (fraction: number) => {
								if (_currentJobId) {
									updateJob(_currentJobId, {
										progress: fraction,
									})
								}
							},
							/**
							 * Returns the current cooperative abort signal.
							 * Read synchronously — no async gap between the read and the
							 * InferenceAbortError throw inside TiledInferenceRunner.
							 */
							shouldAbort: () => _abortCurrentJob,
						}
					)

					// ── Job completed successfully ─────────────────────────────────
					//
					// result.resultUri is the absolute file:// URI of the JPEG written
					// to Paths.cache by TiledInferenceRunner._encodeAndSave().
					if (_currentJobId) {
						updateJob(_currentJobId, {
							status: 'DONE',
							resultUri: result.resultUri,
						})
					}

					tracker.log(
						`[StyleJobService] Job ${_currentJobId} DONE — ` +
							`${result.totalTiles} tiles, ${result.durationMs}ms, ` +
							`uri=${result.resultUri}`
					)
				}
			} catch (error) {
				// ── FIX 7: Discriminated abort vs. error handling ─────────────
				//
				// InferenceAbortError is thrown by TiledInferenceRunner /
				// runPreviewInference when shouldAbort() returns true at a tile
				// boundary. This is a cooperative interruption, NOT a pipeline failure.
				//
				// BATTERY_PAUSED semantics:
				//   - Job is preserved in the queue at its current styleId.
				//   - Progress is reset to 0 when resumeAll() re-queues it.
				//   - The job can be resumed once battery recovers.
				//   - No error overlay is shown in Gallery or EditCanvas.
				//   - retryable is NOT set to true (no Retry button shown).
				//
				// The finally block below handles unloadModel and _currentJobId = null
				// for BOTH the abort and error paths.
				// DO NOT duplicate that cleanup here.
				if (error instanceof InferenceAbortError) {
					tracker.log(
						`[StyleJobService] Job ${_currentJobId} aborted cooperatively ` +
							`at tile boundary → BATTERY_PAUSED.`
					)
					if (_currentJobId) {
						updateJob(_currentJobId, { status: 'BATTERY_PAUSED' })
					}
					// Intentional fall-through to finally — no return needed.
					// The finally block unloads the model and clears _currentJobId.
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
				}
			} finally {
				// ── Guaranteed cleanup — runs in EVERY exit path ──────────────
				//
				// FIX 4 (preserved from v2): unloadModel BEFORE clearing _currentJobId.
				// This prevents a race where the preview loop could reload the preview
				// slot while main is still resident (only 2 slots total per engine).
				//
				// FIX 9 (new): unload the slot that was loaded for this job type.
				// Preview jobs load 'preview'; main jobs load 'main'. Each must be
				// explicitly unloaded to release the native TFLite runtime allocation.
				const slotToUnload = isPreviewJob ? 'preview' : 'main'
				InferenceEngine.unloadModel(slotToUnload)
				_currentJobId = null
			}
		} finally {
			// FIX 3: Release the processing lock in all exit paths.
			// This runs after the inner try/catch/finally completes, allowing
			// the next call to processNextJobInQueue() to enter the body.
			_processingLock = false
		}
	},

	/**
	 * Moves a QUEUED job to the front of the queue, interrupting the current
	 * job at its next tile boundary if it is a different job.
	 */
	prioritizeJob(jobId: JobId): void {
		const { prioritize } = useStyleJobStore.getState()
		if (_currentJobId !== null && _currentJobId !== jobId) {
			_abortCurrentJob = true
		}
		prioritize(jobId)
	},

	/**
	 * Signals the current job to pause at the next tile boundary.
	 * The job's status is updated to BATTERY_PAUSED inside the catch block
	 * when InferenceAbortError is caught (FIX 7).
	 */
	pauseJob(jobId: JobId): void {
		if (_currentJobId === jobId) {
			_abortCurrentJob = true
		}
	},

	/**
	 * Resumes all BATTERY_PAUSED jobs by resetting them to QUEUED.
	 * Call when battery level rises above threshold or power-saver is disabled.
	 */
	resumeAll(): void {
		const { jobs, updateJob } = useStyleJobStore.getState()
		jobs.filter((j) => j.status === 'BATTERY_PAUSED').forEach((j) =>
			updateJob(j.id, { status: 'QUEUED', progress: 0 })
		)
	},

	/**
	 * Cancels a job, removing it from the active processing pipeline.
	 *
	 * FIX 5 (preserved from v2): Delegates to useStyleJobStore.removeJob() to
	 * fully remove the cancelled job rather than setting status: 'ERROR'. A
	 * user-initiated cancellation is not an error state and should not display
	 * the error UI or offer a "Retry" button.
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
					j.status === 'BATTERY_PAUSED' ||
					j.status === 'PROCESSING')
		)
	},
}
