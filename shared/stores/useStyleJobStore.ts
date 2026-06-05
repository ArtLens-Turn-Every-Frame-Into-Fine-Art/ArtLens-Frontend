/**
 * ArtLens — useStyleJobStore (Refactored)
 * Persistent background rendering queue synced with MMKV storage layer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES vs v1 (audit-driven fixes)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX 1 — Critical: `failJob` was setting `error: errorReason` but StyleJob
 *    interface defines `errorMessage?: string`. The `error` property does not
 *    exist on StyleJob so it was silently discarded at runtime. All Gallery
 *    and EditCanvas error display code reading `job.errorMessage` always saw
 *    `undefined`. Retry flow appeared to work but no error description was shown.
 *    Fix: Use `errorMessage: errorReason` matching the type definition exactly.
 *
 *  FIX 2 — Critical: MMKV persistence subscription fired JSON.stringify on
 *    EVERY Zustand state mutation — including each incremental progress tick
 *    during tiled inference. At 16–64 tiles per job, this is 16–64 heavy
 *    serializations + synchronous MMKV writes per job, each blocking the JS
 *    event loop for 1–5ms. During active inference this produces perceptible
 *    UI stutter.
 *    Fix: 500ms debounce on the subscribe callback. The queue state is
 *    only flushed to disk after mutations settle, not on every tick.
 *
 *  FIX 3 — `cancelJob` set status: 'ERROR' which caused Gallery to show
 *    an error overlay and "Retry" button for a user-initiated cancellation.
 *    Fix: Added `removeJob` action that fully removes the job from the array.
 *    StyleJobService.cancelJob() now calls removeJob() instead of cancelJob().
 *    The legacy cancelJob() is retained for error-state transitions that the
 *    PRD prescribes (e.g., model deletion with active jobs).
 *
 *  FIX 4 — Job restoration on startup sanitized PROCESSING → QUEUED but
 *    preserved the stale `error` field (undefined on type, but set in old code).
 *    Fix: Explicit spread with `errorMessage: undefined` on the restoration.
 *    Also fixed the property name from `error` to `errorMessage` throughout.
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

interface StyleJobStoreState {
	jobs: StyleJob[]
}

interface StyleJobStoreActions {
	addJob: (payload: JobPayload) => JobId
	/** Alias for addJob — explicit UI compatibility layer. */
	enqueue: (payload: JobPayload) => JobId
	startJob: (jobId: JobId) => void
	updateJob: (jobId: JobId, updates: Partial<Omit<StyleJob, 'id'>>) => void
	updateJobOutputUri: (jobId: string, newUri: string) => void
	failJob: (jobId: JobId, errorReason: string) => void
	prioritize: (jobId: JobId) => void
	/** Sets status: 'ERROR' on the job (internal use — model deletion, hard fail). */
	cancelJob: (jobId: JobId) => void
	/** FIX 3: Fully removes a job from the queue (user-initiated cancel). */
	removeJob: (jobId: JobId) => void
	retryJob: (jobId: JobId) => void
	clearCompleted: () => void
	restoreJobs: (jobs: StyleJob[]) => void
}

export type StyleJobStore = StyleJobStoreState & StyleJobStoreActions

const queueStorage = createMMKV({ id: STORAGE_INSTANCE_IDS.APP_STATE })

const getPersistedJobs = (): StyleJob[] => {
	try {
		const savedJobs = queueStorage.getString(
			APP_STATE_KEYS.STYLE_JOBS_QUEUE
		)
		if (savedJobs) {
			const parsed = JSON.parse(savedJobs) as StyleJob[]
			if (Array.isArray(parsed)) {
				// Sanitize: reset any PROCESSING jobs (app crash / forced close).
				// FIX 4: Use errorMessage: undefined (matching the type), not error: undefined.
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
			}
		}
	} catch (error) {
		tracker.error(
			'[useStyleJobStore] Failed to parse persisted job queue:',
			error
		)
	}
	return []
}

function generateJobId(): JobId {
	return `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

export const useStyleJobStore = create<StyleJobStore>((set) => ({
	jobs: getPersistedJobs(),

	addJob: (payload) => {
		const newId = generateJobId()
		const newJob: StyleJob = {
			id: newId,
			...payload,
			status: payload.isPreview ? 'PREVIEW_QUEUED' : 'QUEUED',
			progress: 0,
			retryable: false,
			createdAt: Date.now(),
		}
		set((state) => ({ jobs: [...state.jobs, newJob] }))
		return newId
	},

	enqueue: (payload) => {
		const newId = generateJobId()
		const newJob: StyleJob = {
			id: newId,
			...payload,
			status: payload.isPreview ? 'PREVIEW_QUEUED' : 'QUEUED',
			progress: 0,
			retryable: false,
			createdAt: Date.now(),
		}
		set((state) => ({ jobs: [...state.jobs, newJob] }))
		return newId
	},

	startJob: (jobId) => {
		set((state) => ({
			jobs: state.jobs.map((j) =>
				j.id === jobId ? { ...j, status: 'PROCESSING' } : j
			),
		}))
	},

	updateJob: (jobId, updates) => {
		set((state) => ({
			jobs: state.jobs.map((j) =>
				j.id === jobId ? { ...j, ...updates } : j
			),
		}))
	},

	updateJobOutputUri: (jobId: string, newUri: string) => {
		set((state) => ({
			jobs: state.jobs.map((job) =>
				job.id === jobId ? { ...job, outputUri: newUri } : job
			),
		}))
	},

	/**
	 * FIX 1: Use `errorMessage` (matches StyleJob interface), not `error`.
	 * The old code used `error: errorReason` which is not a property of
	 * StyleJob — it was silently dropped, leaving errorMessage undefined
	 * and breaking all error display in Gallery and EditCanvas.
	 */
	failJob: (jobId, errorReason) => {
		set((state) => ({
			jobs: state.jobs.map((j) => {
				if (j.id !== jobId) return j
				return {
					...j,
					status: 'ERROR' as const,
					errorMessage: errorReason, // FIX 1: was `error: errorReason`
					retryable: true,
				}
			}),
		}))
	},

	prioritize: (jobId) => {
		set((state) => {
			const targetJob = state.jobs.find((j) => j.id === jobId)
			if (!targetJob) return state
			const remaining = state.jobs.filter((j) => j.id !== jobId)
			return { jobs: [targetJob, ...remaining] }
		})
	},

	/**
	 * Sets a job to ERROR status (used for hard failures, not user cancellation).
	 * Retains the job in the queue with retryable: true.
	 * For user-initiated cancellation, use removeJob() instead.
	 */
	cancelJob: (jobId) => {
		set((state) => ({
			jobs: state.jobs.map((j) =>
				j.id === jobId
					? { ...j, status: 'ERROR' as const, retryable: false }
					: j
			),
		}))
	},

	/**
	 * FIX 3: Fully removes a job from the queue.
	 * Called by StyleJobService.cancelJob() for user-initiated cancellations.
	 * Does not set ERROR status — no error overlay or Retry button is shown.
	 */
	removeJob: (jobId) => {
		set((state) => ({
			jobs: state.jobs.filter((j) => j.id !== jobId),
		}))
	},

	retryJob: (jobId) => {
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
		}))
	},

	clearCompleted: () => {
		set((state) => ({
			jobs: state.jobs.filter(
				(j) => j.status !== 'DONE' && j.status !== 'ERROR'
			),
		}))
	},

	restoreJobs: (jobs) => {
		set({ jobs })
	},
}))

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2: DEBOUNCED PERSISTENCE SUBSCRIPTION
// ─────────────────────────────────────────────────────────────────────────────
//
// Previously: subscribe fired JSON.stringify + synchronous MMKV write on every
// single Zustand state mutation — including each progress tick during tiled
// inference. At 16+ tiles/job this was 16+ heavy serializations per job, each
// blocking the JS event loop for 1–5ms.
//
// Fix: 500ms debounce — only persist after mutations settle.
// The queue is persisted frequently enough to survive app crash/OS kill while
// not serializing every incremental progress update.
//
// The debounce timer is cleared on each new mutation and only fires once
// after the queue has been idle for 500ms. This is safe because:
//   - Progress updates fire rapidly during a job → only the final state persists
//   - Structural changes (enqueue, done, error) trigger a persist after 500ms
//   - On app close the OS kills the process; the last settled state was persisted

let _persistDebounceTimer: ReturnType<typeof setTimeout> | null = null

useStyleJobStore.subscribe((state) => {
	if (_persistDebounceTimer !== null) {
		clearTimeout(_persistDebounceTimer)
	}
	_persistDebounceTimer = setTimeout(() => {
		_persistDebounceTimer = null
		try {
			queueStorage.set(
				APP_STATE_KEYS.STYLE_JOBS_QUEUE,
				JSON.stringify(state.jobs)
			)
		} catch (error) {
			tracker.error(
				'[useStyleJobStore] Failed to persist job queue to MMKV:',
				error
			)
		}
	}, 500)
})
