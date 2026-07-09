/**
 * @file useStyleJobStore.ts
 * @description Persistent background rendering queue for ArtLens.
 *
 * State is synced to MMKV with a 500 ms debounce (FIX 2) so that rapid
 * progress-tick mutations during tiled inference don't stall the JS thread
 * with back-to-back synchronous serializations.
 *
 * Key fixes applied (see inline comments for detail):
 *   FIX 1 — failJob now uses `errorMessage` (matches StyleJob type), not `error`.
 *   FIX 2 — MMKV persistence is debounced 500 ms to avoid per-tick writes.
 *   FIX 3 — User-initiated cancellation calls removeJob(), not cancelJob().
 *            cancelJob() is retained for hard-fail / model-deletion paths.
 *   FIX 4 — Startup job sanitization uses `errorMessage: undefined` (correct
 *            property name) when resetting PROCESSING → QUEUED jobs.
 */

import { create } from 'zustand'
import { createMMKV } from 'react-native-mmkv'
import {
	STORAGE_INSTANCE_IDS,
	APP_STATE_KEYS,
} from '@/shared/utils/storageKeys'
import type { StyleJob, JobPayload, JobId } from '@/types'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('useStyleJobStore')

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface StyleJobStoreState {
	jobs: StyleJob[]
}

interface StyleJobStoreActions {
	/** Creates a new job and appends it to the queue. Returns the new JobId. */
	enqueue: (payload: JobPayload) => JobId
	/** Transitions a job from QUEUED to PROCESSING. */
	startJob: (jobId: JobId) => void
	/** Applies a partial update to any job field except `id`. */
	updateJob: (jobId: JobId, updates: Partial<Omit<StyleJob, 'id'>>) => void
	/** Marks a job as ERROR with a human-readable reason and retryable: true. */
	failJob: (jobId: JobId, errorReason: string) => void
	/** Moves a job to the front of the queue. */
	prioritize: (jobId: JobId) => void
	/**
	 * Sets status: 'ERROR' on a job (hard-fail / model deletion path).
	 * Does NOT remove the job — the error overlay and Retry button remain visible.
	 * For user-initiated cancellation use removeJob() instead.
	 */
	cancelJob: (jobId: JobId) => void
	/**
	 * Permanently removes a job from the queue (user-initiated cancel).
	 * No error overlay is shown — the job simply disappears from the UI.
	 */
	removeJob: (jobId: JobId) => void
	/** Resets a failed job back to QUEUED so it can be re-processed. */
	retryJob: (jobId: JobId) => void
	/** Removes all DONE and ERROR jobs from the queue. */
	clearCompleted: () => void
	/** Replaces the entire jobs array (used during startup restoration). */
	restoreJobs: (jobs: StyleJob[]) => void
}

export type StyleJobStore = StyleJobStoreState & StyleJobStoreActions

// ─────────────────────────────────────────────────────────────────────────────
// MMKV STORAGE
// ─────────────────────────────────────────────────────────────────────────────

const queueStorage = createMMKV({ id: STORAGE_INSTANCE_IDS.APP_STATE })

/**
 * Loads the persisted job queue from MMKV on startup.
 *
 * Any PROCESSING jobs are reset to QUEUED (FIX 4): the app was killed or
 * crashed mid-inference, so the job must restart from scratch on next launch.
 * `errorMessage` is explicitly cleared to avoid surfacing a stale error from
 * a prior failed attempt alongside the freshly-queued restart.
 */
function loadPersistedJobs(): StyleJob[] {
	try {
		const raw = queueStorage.getString(APP_STATE_KEYS.STYLE_JOBS_QUEUE)
		if (!raw) return []

		const parsed = JSON.parse(raw) as StyleJob[]
		if (!Array.isArray(parsed)) return []

		return parsed.map((job) =>
			job.status === 'PROCESSING'
				? {
						...job,
						status: 'QUEUED' as const,
						progress: 0,
						errorMessage: undefined,
					}
				: job
		)
	} catch (err) {
		tracker.error(
			'Failed to parse persisted job queue — starting empty.',
			err
		)
		return []
	}
}

function generateJobId(): JobId {
	return `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────────────────────

export const useStyleJobStore = create<StyleJobStore>((set) => ({
	jobs: loadPersistedJobs(),

	enqueue: (payload) => {
		const id = generateJobId()
		const newJob: StyleJob = {
			id,
			...payload,
			status: payload.isPreview ? 'PREVIEW_QUEUED' : 'QUEUED',
			progress: 0,
			retryable: false,
			createdAt: Date.now(),
		}
		set((state) => ({ jobs: [...state.jobs, newJob] }))
		return id
	},

	startJob: (jobId) =>
		set((state) => ({
			jobs: state.jobs.map((j) =>
				j.id === jobId ? { ...j, status: 'PROCESSING' as const } : j
			),
		})),

	updateJob: (jobId, updates) =>
		set((state) => ({
			jobs: state.jobs.map((j) =>
				j.id === jobId ? { ...j, ...updates } : j
			),
		})),

	// FIX 1: property name is `errorMessage`, not `error`.
	// The original `error: errorReason` was silently discarded because `error`
	// is not defined on StyleJob, leaving job.errorMessage always undefined and
	// breaking every error message rendered in Gallery and EditCanvas.
	failJob: (jobId, errorReason) =>
		set((state) => ({
			jobs: state.jobs.map((j) =>
				j.id === jobId
					? {
							...j,
							status: 'ERROR' as const,
							errorMessage: errorReason,
							retryable: true,
						}
					: j
			),
		})),

	prioritize: (jobId) =>
		set((state) => {
			const target = state.jobs.find((j) => j.id === jobId)
			if (!target) return state
			return {
				jobs: [target, ...state.jobs.filter((j) => j.id !== jobId)],
			}
		}),

	cancelJob: (jobId) =>
		set((state) => ({
			jobs: state.jobs.map((j) =>
				j.id === jobId
					? { ...j, status: 'ERROR' as const, retryable: false }
					: j
			),
		})),

	removeJob: (jobId) =>
		set((state) => ({
			jobs: state.jobs.filter((j) => j.id !== jobId),
		})),

	retryJob: (jobId) =>
		set((state) => ({
			jobs: state.jobs.map((j) =>
				j.id === jobId
					? {
							...j,
							status: 'QUEUED' as const,
							progress: 0,
							errorMessage: undefined,
							errorTrace: undefined,
							retryable: false,
						}
					: j
			),
		})),

	clearCompleted: () =>
		set((state) => ({
			jobs: state.jobs.filter(
				(j) => j.status !== 'DONE' && j.status !== 'ERROR'
			),
		})),

	restoreJobs: (jobs) => set({ jobs }),
}))

// ─────────────────────────────────────────────────────────────────────────────
// DEBOUNCED MMKV PERSISTENCE  (FIX 2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Rationale: the old implementation called JSON.stringify + a synchronous MMKV
// write on every single Zustand mutation, including every per-tile progress tick
// during tiled inference (16–64 ticks per job, each 1–5 ms on the JS thread).
//
// The 500 ms debounce ensures we only flush to disk once mutations have settled:
//   - Rapid progress ticks → only the final settled value is written.
//   - Structural changes (enqueue, done, error) flush after 500 ms idle.
//   - If the OS kills the process, the last settled state was already persisted.
//
// 500 ms is safe: the queue survives an app kill as long as at least one
// debounce period elapses between a structural mutation and process termination,
// which is always true in normal usage.

let _persistDebounceTimer: ReturnType<typeof setTimeout> | null = null

useStyleJobStore.subscribe((state) => {
	if (_persistDebounceTimer !== null) clearTimeout(_persistDebounceTimer)

	_persistDebounceTimer = setTimeout(() => {
		_persistDebounceTimer = null
		try {
			queueStorage.set(
				APP_STATE_KEYS.STYLE_JOBS_QUEUE,
				JSON.stringify(state.jobs)
			)
		} catch (err) {
			tracker.error('Failed to persist job queue to MMKV:', err)
		}
	}, 500)
})
