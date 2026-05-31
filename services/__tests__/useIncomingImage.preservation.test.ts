/**
 * Preservation Tests — useIncomingImageListener
 *
 * These tests run against the FIXED code and are EXPECTED TO PASS.
 * They verify Property 2: for all inputs where isBugCondition is false,
 * the fixed hook produces exactly the same side-effects as the original —
 * no file copy, no job enqueued, no processNextJobInQueue call, and
 * resetShareIntent called where it was called before.
 *
 * Requirements: Property 2 (design § Correctness Properties), design § Preservation Requirements
 */

// ─── Module mocks (must be hoisted before imports) ───────────────────────────

// Mock expo-share-intent — we control what useShareIntentContext returns
jest.mock('expo-share-intent', () => ({
	useShareIntentContext: jest.fn(),
}))

// Mock expo-file-system OO API — no real disk I/O
jest.mock('expo-file-system', () => {
	const mockCopyFn = jest.fn()
	const MockFile = jest.fn().mockImplementation((uri: string) => ({
		uri,
		exists: true,
		copy: mockCopyFn,
	}))
	const MockDirectory = jest
		.fn()
		.mockImplementation((base: string, sub?: string) => {
			const uri = sub ? `${base}/${sub}/` : `${base}/`
			return {
				uri,
				exists: false,
				create: jest.fn(),
			}
		})
	const MockPaths = {
		cache: 'file:///mock-cache',
		document: 'file:///mock-document',
	}
	return {
		File: MockFile,
		Directory: MockDirectory,
		Paths: MockPaths,
		__mockCopyFn: mockCopyFn,
	}
})

// Mock react-native-mmkv so useStyleJobStore can initialise without native bindings
jest.mock('react-native-mmkv', () => ({
	createMMKV: jest.fn(() => ({
		getString: jest.fn(() => undefined),
		set: jest.fn(),
		getAllKeys: jest.fn(() => []),
		remove: jest.fn(),
	})),
}))

// Mock StyleJobService — spy on processNextJobInQueue
jest.mock('@/features/style-transfer/StyleJobService', () => ({
	StyleJobService: {
		processNextJobInQueue: jest.fn(),
		prioritizeJob: jest.fn(),
		pauseJob: jest.fn(),
		resumeAll: jest.fn(),
		cancelJob: jest.fn(),
		getActiveJobId: jest.fn(() => null),
		isStyleInUse: jest.fn(() => false),
	},
}))

// Mock useModelStore — provide a selectedStyleId
jest.mock('@/shared/stores/useModelStore', () => ({
	useModelStore: {
		getState: jest.fn(() => ({ selectedStyleId: 'style_watercolor' })),
	},
}))

// Mock React's useState and useEffect so we can drive the hook synchronously
// without needing a React renderer
jest.mock('react', () => {
	const actual = jest.requireActual('react')
	return {
		...actual,
		useState: jest.fn((initial: unknown) => [initial, jest.fn()]),
		useEffect: jest.fn((fn: () => void) => fn()),
	}
})

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { useShareIntentContext } from 'expo-share-intent'
import { File, Directory } from 'expo-file-system'
import { useIncomingImageListener } from '../useIncomingImage'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useModelStore } from '@/shared/stores/useModelStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockUseShareIntentContext = useShareIntentContext as jest.Mock
const mockProcessNextJobInQueue =
	StyleJobService.processNextJobInQueue as jest.Mock
const MockFile = File as jest.Mock
const MockDirectory = Directory as jest.Mock

function clearStore() {
	useStyleJobStore.getState().restoreJobs([])
}

function getJobCount() {
	return useStyleJobStore.getState().jobs.length
}

function getSelectedStyleId() {
	return useModelStore.getState().selectedStyleId
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	jest.clearAllMocks()
	clearStore()
	// Re-apply useEffect mock to execute synchronously after clearAllMocks
	const React = jest.requireActual('react')
	const reactMock = require('react') as typeof React
	;(reactMock.useEffect as jest.Mock).mockImplementation((fn: () => void) =>
		fn()
	)
	;(reactMock.useState as jest.Mock).mockImplementation(
		(initial: unknown) => [initial, jest.fn()]
	)
})

describe('Preservation — useIncomingImageListener (FIXED code)', () => {
	/**
	 * Case 1: No viable image — text-only share intent
	 *
	 * The hook receives a share intent with only a text file (no image mime type,
	 * no image extension). isBugCondition is false.
	 * Expected: no Directory/File constructed, no addJob, no processNextJobInQueue,
	 * resetShareIntent called.
	 */
	describe('Case 1 — No viable image (text-only share intent)', () => {
		it('does not construct Directory or File', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: '/tmp/note.txt',
							mimeType: 'text/plain',
							fileName: 'note.txt',
						},
					],
				},
				resetShareIntent,
				error: null,
			})

			const jobsBefore = getJobCount()
			useIncomingImageListener()

			expect(MockDirectory).not.toHaveBeenCalled()
			expect(MockFile).not.toHaveBeenCalled()
		})

		it('does not call addJob', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: '/tmp/note.txt',
							mimeType: 'text/plain',
							fileName: 'note.txt',
						},
					],
				},
				resetShareIntent,
				error: null,
			})

			const jobsBefore = getJobCount()
			useIncomingImageListener()

			expect(getJobCount()).toBe(jobsBefore)
		})

		it('does not call processNextJobInQueue', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: '/tmp/note.txt',
							mimeType: 'text/plain',
							fileName: 'note.txt',
						},
					],
				},
				resetShareIntent,
				error: null,
			})

			useIncomingImageListener()

			expect(mockProcessNextJobInQueue).not.toHaveBeenCalled()
		})

		it('calls resetShareIntent', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: '/tmp/note.txt',
							mimeType: 'text/plain',
							fileName: 'note.txt',
						},
					],
				},
				resetShareIntent,
				error: null,
			})

			useIncomingImageListener()

			expect(resetShareIntent).toHaveBeenCalledTimes(1)
		})

		it('leaves useStyleJobStore.jobs.length unchanged', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: '/tmp/note.txt',
							mimeType: 'text/plain',
							fileName: 'note.txt',
						},
					],
				},
				resetShareIntent,
				error: null,
			})

			const jobsBefore = getJobCount()
			useIncomingImageListener()

			expect(getJobCount()).toBe(jobsBefore)
		})

		it('does not mutate useModelStore.selectedStyleId', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: '/tmp/note.txt',
							mimeType: 'text/plain',
							fileName: 'note.txt',
						},
					],
				},
				resetShareIntent,
				error: null,
			})

			const styleBefore = getSelectedStyleId()
			useIncomingImageListener()

			expect(getSelectedStyleId()).toBe(styleBefore)
		})
	})

	/**
	 * Case 2: Error payload — share intent with error set
	 *
	 * The hook receives a share intent where error is set.
	 * Expected: early return, no job enqueued, resetShareIntent called.
	 */
	describe('Case 2 — Error payload (error set on context)', () => {
		it('does not construct Directory or File', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: 'content://media/external/images/media/99',
							mimeType: 'image/jpeg',
							fileName: 'photo.jpg',
						},
					],
				},
				resetShareIntent,
				error: 'Share intent error: permission denied',
			})

			useIncomingImageListener()

			expect(MockDirectory).not.toHaveBeenCalled()
			expect(MockFile).not.toHaveBeenCalled()
		})

		it('does not call addJob', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: 'content://media/external/images/media/99',
							mimeType: 'image/jpeg',
							fileName: 'photo.jpg',
						},
					],
				},
				resetShareIntent,
				error: 'Share intent error: permission denied',
			})

			const jobsBefore = getJobCount()
			useIncomingImageListener()

			expect(getJobCount()).toBe(jobsBefore)
		})

		it('does not call processNextJobInQueue', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: 'content://media/external/images/media/99',
							mimeType: 'image/jpeg',
							fileName: 'photo.jpg',
						},
					],
				},
				resetShareIntent,
				error: 'Share intent error: permission denied',
			})

			useIncomingImageListener()

			expect(mockProcessNextJobInQueue).not.toHaveBeenCalled()
		})

		it('calls resetShareIntent', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: 'content://media/external/images/media/99',
							mimeType: 'image/jpeg',
							fileName: 'photo.jpg',
						},
					],
				},
				resetShareIntent,
				error: 'Share intent error: permission denied',
			})

			useIncomingImageListener()

			expect(resetShareIntent).toHaveBeenCalledTimes(1)
		})

		it('leaves useStyleJobStore.jobs.length unchanged', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: 'content://media/external/images/media/99',
							mimeType: 'image/jpeg',
							fileName: 'photo.jpg',
						},
					],
				},
				resetShareIntent,
				error: 'Share intent error: permission denied',
			})

			const jobsBefore = getJobCount()
			useIncomingImageListener()

			expect(getJobCount()).toBe(jobsBefore)
		})

		it('does not mutate useModelStore.selectedStyleId', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: {
					files: [
						{
							path: 'content://media/external/images/media/99',
							mimeType: 'image/jpeg',
							fileName: 'photo.jpg',
						},
					],
				},
				resetShareIntent,
				error: 'Share intent error: permission denied',
			})

			const styleBefore = getSelectedStyleId()
			useIncomingImageListener()

			expect(getSelectedStyleId()).toBe(styleBefore)
		})
	})

	/**
	 * Case 3: Empty files array
	 *
	 * The hook receives a share intent with files: [].
	 * Expected: early return, no job enqueued, resetShareIntent called.
	 */
	describe('Case 3 — Empty files array', () => {
		it('does not construct Directory or File', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: { files: [] },
				resetShareIntent,
				error: null,
			})

			useIncomingImageListener()

			expect(MockDirectory).not.toHaveBeenCalled()
			expect(MockFile).not.toHaveBeenCalled()
		})

		it('does not call addJob', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: { files: [] },
				resetShareIntent,
				error: null,
			})

			const jobsBefore = getJobCount()
			useIncomingImageListener()

			expect(getJobCount()).toBe(jobsBefore)
		})

		it('does not call processNextJobInQueue', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: { files: [] },
				resetShareIntent,
				error: null,
			})

			useIncomingImageListener()

			expect(mockProcessNextJobInQueue).not.toHaveBeenCalled()
		})

		it('calls resetShareIntent', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: { files: [] },
				resetShareIntent,
				error: null,
			})

			useIncomingImageListener()

			expect(resetShareIntent).toHaveBeenCalledTimes(1)
		})

		it('leaves useStyleJobStore.jobs.length unchanged', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: { files: [] },
				resetShareIntent,
				error: null,
			})

			const jobsBefore = getJobCount()
			useIncomingImageListener()

			expect(getJobCount()).toBe(jobsBefore)
		})

		it('does not mutate useModelStore.selectedStyleId', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: { files: [] },
				resetShareIntent,
				error: null,
			})

			const styleBefore = getSelectedStyleId()
			useIncomingImageListener()

			expect(getSelectedStyleId()).toBe(styleBefore)
		})
	})

	/**
	 * Case 4: hasShareIntent: false
	 *
	 * The hook effect fires but hasShareIntent is false.
	 * Expected: no side-effects at all — not even resetShareIntent.
	 */
	describe('Case 4 — hasShareIntent: false', () => {
		it('does not construct Directory or File', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: false,
				shareIntent: null,
				resetShareIntent,
				error: null,
			})

			useIncomingImageListener()

			expect(MockDirectory).not.toHaveBeenCalled()
			expect(MockFile).not.toHaveBeenCalled()
		})

		it('does not call addJob', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: false,
				shareIntent: null,
				resetShareIntent,
				error: null,
			})

			const jobsBefore = getJobCount()
			useIncomingImageListener()

			expect(getJobCount()).toBe(jobsBefore)
		})

		it('does not call processNextJobInQueue', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: false,
				shareIntent: null,
				resetShareIntent,
				error: null,
			})

			useIncomingImageListener()

			expect(mockProcessNextJobInQueue).not.toHaveBeenCalled()
		})

		it('does not call resetShareIntent', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: false,
				shareIntent: null,
				resetShareIntent,
				error: null,
			})

			useIncomingImageListener()

			// When hasShareIntent is false the hook returns immediately — no side-effects at all
			expect(resetShareIntent).not.toHaveBeenCalled()
		})

		it('leaves useStyleJobStore.jobs.length unchanged', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: false,
				shareIntent: null,
				resetShareIntent,
				error: null,
			})

			const jobsBefore = getJobCount()
			useIncomingImageListener()

			expect(getJobCount()).toBe(jobsBefore)
		})

		it('does not mutate useModelStore.selectedStyleId', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: false,
				shareIntent: null,
				resetShareIntent,
				error: null,
			})

			const styleBefore = getSelectedStyleId()
			useIncomingImageListener()

			expect(getSelectedStyleId()).toBe(styleBefore)
		})
	})

	/**
	 * Cross-cutting: null files property on shareIntent
	 *
	 * shareIntent.files is null/undefined — treated as no viable image.
	 */
	describe('Case 5 — Null/undefined files on shareIntent', () => {
		it('does not enqueue a job and calls resetShareIntent', () => {
			const resetShareIntent = jest.fn()
			mockUseShareIntentContext.mockReturnValue({
				hasShareIntent: true,
				shareIntent: { files: null },
				resetShareIntent,
				error: null,
			})

			const jobsBefore = getJobCount()
			useIncomingImageListener()

			expect(getJobCount()).toBe(jobsBefore)
			expect(mockProcessNextJobInQueue).not.toHaveBeenCalled()
			expect(resetShareIntent).toHaveBeenCalledTimes(1)
		})
	})
})
