/**
 * Fix-Checking Tests — useIncomingImageListener
 *
 * These tests run against the FIXED code and are EXPECTED TO PASS.
 * They verify all five outcomes from Property 1 for every input where
 * isBugCondition is true (a viable image is present).
 *
 * Requirements: Property 1 (design § Correctness Properties), bugfix.md § Required Actions 1–3
 */

// ─── Module mocks (must be hoisted before imports) ───────────────────────────

// Mock expo-share-intent — we control what useShareIntentContext returns
jest.mock('expo-share-intent', () => ({
	useShareIntentContext: jest.fn(),
}))

// Mock expo-file-system OO API — no real disk I/O
// We need to capture the mock instances so we can assert on them
jest.mock('expo-file-system', () => {
	const mockCopyFn = jest.fn()
	const mockCreateFn = jest.fn()

	// Track the last constructed Directory and File instances
	const MockDirectory = jest
		.fn()
		.mockImplementation((base: string, sub?: string) => {
			const uri = sub ? `${base}/${sub}/` : `${base}/`
			return {
				uri,
				exists: false,
				create: mockCreateFn,
			}
		})

	const MockFile = jest
		.fn()
		.mockImplementation((uriOrBase: string, filename?: string) => {
			const uri = filename ? `${uriOrBase}${filename}` : uriOrBase
			return {
				uri,
				exists: true,
				copy: mockCopyFn,
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
		__mockCreateFn: mockCreateFn,
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

// Mock useModelStore — provide a selectedStyleId (will be overridden per test)
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
import { File, Directory, Paths } from 'expo-file-system'
import {
	useIncomingImageListener,
	IncomingImageStateDispatcher,
} from '../useIncomingImage'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'
import { useModelStore } from '@/shared/stores/useModelStore'

// ─── Typed mock accessors ─────────────────────────────────────────────────────

const mockUseShareIntentContext = useShareIntentContext as jest.Mock
const mockProcessNextJobInQueue =
	StyleJobService.processNextJobInQueue as jest.Mock
const MockDirectory = Directory as jest.Mock
const MockFile = File as jest.Mock
const mockUseModelStoreGetState = useModelStore.getState as jest.Mock

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeShareIntentContext(path: string, mimeType = 'image/jpeg') {
	const resetShareIntent = jest.fn()
	mockUseShareIntentContext.mockReturnValue({
		hasShareIntent: true,
		shareIntent: {
			files: [
				{
					path,
					mimeType,
					fileName: path.split('/').pop() ?? 'shared.jpg',
				},
			],
		},
		resetShareIntent,
		error: null,
	})
	return { resetShareIntent }
}

function clearStore() {
	useStyleJobStore.getState().restoreJobs([])
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

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

	// Default: selectedStyleId is set
	mockUseModelStoreGetState.mockReturnValue({
		selectedStyleId: 'style_watercolor',
	})
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Fix-Checking — useIncomingImageListener (FIXED code)', () => {
	/**
	 * Outcome 1: Directory was constructed with Paths.cache and 'incoming_intents'
	 */
	describe('Outcome 1 — Directory constructed with Paths.cache and incoming_intents', () => {
		it('Android content:// URI: Directory is constructed with Paths.cache and incoming_intents', () => {
			const androidPath = 'content://media/external/images/media/42'
			makeShareIntentContext(androidPath, 'image/jpeg')

			useIncomingImageListener()

			expect(MockDirectory).toHaveBeenCalledWith(
				Paths.cache,
				'incoming_intents'
			)
		})

		it('iOS temporary file:// URI: Directory is constructed with Paths.cache and incoming_intents', () => {
			const iosPath =
				'file:///private/var/mobile/Containers/Data/Application/ABCD-1234/tmp/shared_image.png'
			makeShareIntentContext(iosPath, 'image/png')

			useIncomingImageListener()

			expect(MockDirectory).toHaveBeenCalledWith(
				Paths.cache,
				'incoming_intents'
			)
		})
	})

	/**
	 * Outcome 2: File.copy was called with the correct source and destination
	 */
	describe('Outcome 2 — File.copy called with correct source and destination', () => {
		it('Android content:// URI: sourceFile.copy(destFile) is called', () => {
			const androidPath = 'content://media/external/images/media/42'
			makeShareIntentContext(androidPath, 'image/jpeg')

			useIncomingImageListener()

			// The first File constructed is the source (viableImage.path)
			// The second File constructed is the destination (incomingDir.uri + filename)
			expect(MockFile).toHaveBeenCalledTimes(2)

			// First call: source file from the external URI
			expect(MockFile).toHaveBeenNthCalledWith(1, androidPath)

			// The copy method on the source file instance should have been called
			// with the destination file instance
			const sourceInstance = MockFile.mock.results[0].value
			const destInstance = MockFile.mock.results[1].value
			expect(sourceInstance.copy).toHaveBeenCalledWith(destInstance)
		})

		it('iOS temporary file:// URI: sourceFile.copy(destFile) is called', () => {
			const iosPath =
				'file:///private/var/mobile/Containers/Data/Application/ABCD-1234/tmp/shared_image.png'
			makeShareIntentContext(iosPath, 'image/png')

			useIncomingImageListener()

			expect(MockFile).toHaveBeenCalledTimes(2)
			expect(MockFile).toHaveBeenNthCalledWith(1, iosPath)

			const sourceInstance = MockFile.mock.results[0].value
			const destInstance = MockFile.mock.results[1].value
			expect(sourceInstance.copy).toHaveBeenCalledWith(destInstance)
		})
	})

	/**
	 * Outcome 3: addJob was called with sourceUri equal to the sandboxed destFile.uri
	 * (not the original external URI)
	 */
	describe('Outcome 3 — addJob called with sandboxed URI (not original external URI)', () => {
		it('Android content:// URI: addJob sourceUri is the sandboxed destFile.uri', () => {
			const androidPath = 'content://media/external/images/media/42'
			makeShareIntentContext(androidPath, 'image/jpeg')

			useIncomingImageListener()

			// The destFile is the second File instance constructed
			const destInstance = MockFile.mock.results[1].value
			const sandboxedUri = destInstance.uri

			const jobs = useStyleJobStore.getState().jobs
			expect(jobs.length).toBeGreaterThanOrEqual(1)

			const enqueuedJob = jobs[jobs.length - 1]
			expect(enqueuedJob.sourceUri).toBe(sandboxedUri)
			// Must NOT be the original external URI
			expect(enqueuedJob.sourceUri).not.toBe(androidPath)
		})

		it('iOS temporary file:// URI: addJob sourceUri is the sandboxed destFile.uri', () => {
			const iosPath =
				'file:///private/var/mobile/Containers/Data/Application/ABCD-1234/tmp/shared_image.png'
			makeShareIntentContext(iosPath, 'image/png')

			useIncomingImageListener()

			const destInstance = MockFile.mock.results[1].value
			const sandboxedUri = destInstance.uri

			const jobs = useStyleJobStore.getState().jobs
			expect(jobs.length).toBeGreaterThanOrEqual(1)

			const enqueuedJob = jobs[jobs.length - 1]
			expect(enqueuedJob.sourceUri).toBe(sandboxedUri)
			expect(enqueuedJob.sourceUri).not.toBe(iosPath)
		})
	})

	/**
	 * Outcome 4: addJob uses selectedStyleId from useModelStore when set, 'default' when null
	 */
	describe('Outcome 4 — addJob uses selectedStyleId or falls back to default', () => {
		it('uses selectedStyleId from useModelStore when it is set', () => {
			mockUseModelStoreGetState.mockReturnValue({
				selectedStyleId: 'style_watercolor',
			})

			const androidPath = 'content://media/external/images/media/42'
			makeShareIntentContext(androidPath, 'image/jpeg')

			useIncomingImageListener()

			const jobs = useStyleJobStore.getState().jobs
			expect(jobs.length).toBeGreaterThanOrEqual(1)
			expect(jobs[jobs.length - 1].styleId).toBe('style_watercolor')
		})

		it('falls back to "default" when selectedStyleId is null', () => {
			mockUseModelStoreGetState.mockReturnValue({ selectedStyleId: null })

			const androidPath = 'content://media/external/images/media/42'
			makeShareIntentContext(androidPath, 'image/jpeg')

			useIncomingImageListener()

			const jobs = useStyleJobStore.getState().jobs
			expect(jobs.length).toBeGreaterThanOrEqual(1)
			expect(jobs[jobs.length - 1].styleId).toBe('default')
		})
	})

	/**
	 * Outcome 5: StyleJobService.processNextJobInQueue was called exactly once
	 */
	describe('Outcome 5 — StyleJobService.processNextJobInQueue called exactly once', () => {
		it('Android content:// URI: processNextJobInQueue called exactly once', () => {
			const androidPath = 'content://media/external/images/media/42'
			makeShareIntentContext(androidPath, 'image/jpeg')

			useIncomingImageListener()

			expect(mockProcessNextJobInQueue).toHaveBeenCalledTimes(1)
		})

		it('iOS temporary file:// URI: processNextJobInQueue called exactly once', () => {
			const iosPath =
				'file:///private/var/mobile/Containers/Data/Application/ABCD-1234/tmp/shared_image.png'
			makeShareIntentContext(iosPath, 'image/png')

			useIncomingImageListener()

			expect(mockProcessNextJobInQueue).toHaveBeenCalledTimes(1)
		})
	})

	/**
	 * IncomingImageStateDispatcher.set called with the sandboxed URI
	 */
	describe('IncomingImageStateDispatcher.set called with sandboxed URI', () => {
		it('Android content:// URI: dispatcher receives the sandboxed URI', () => {
			const androidPath = 'content://media/external/images/media/42'
			makeShareIntentContext(androidPath, 'image/jpeg')

			useIncomingImageListener()

			const destInstance = MockFile.mock.results[1].value
			const sandboxedUri = destInstance.uri

			const state = IncomingImageStateDispatcher.get()
			expect(state.uri).toBe(sandboxedUri)
			// Must NOT be the original external URI
			expect(state.uri).not.toBe(androidPath)
		})

		it('iOS temporary file:// URI: dispatcher receives the sandboxed URI', () => {
			const iosPath =
				'file:///private/var/mobile/Containers/Data/Application/ABCD-1234/tmp/shared_image.png'
			makeShareIntentContext(iosPath, 'image/png')

			useIncomingImageListener()

			const destInstance = MockFile.mock.results[1].value
			const sandboxedUri = destInstance.uri

			const state = IncomingImageStateDispatcher.get()
			expect(state.uri).toBe(sandboxedUri)
			expect(state.uri).not.toBe(iosPath)
		})
	})

	/**
	 * resetShareIntent called in all success paths
	 */
	describe('resetShareIntent called in all success paths', () => {
		it('Android content:// URI: resetShareIntent is called', () => {
			const androidPath = 'content://media/external/images/media/42'
			const { resetShareIntent } = makeShareIntentContext(
				androidPath,
				'image/jpeg'
			)

			useIncomingImageListener()

			expect(resetShareIntent).toHaveBeenCalledTimes(1)
		})

		it('iOS temporary file:// URI: resetShareIntent is called', () => {
			const iosPath =
				'file:///private/var/mobile/Containers/Data/Application/ABCD-1234/tmp/shared_image.png'
			const { resetShareIntent } = makeShareIntentContext(
				iosPath,
				'image/png'
			)

			useIncomingImageListener()

			expect(resetShareIntent).toHaveBeenCalledTimes(1)
		})

		it('Two consecutive share intents: resetShareIntent called once per intent', () => {
			// First share intent
			const path1 = 'content://media/external/images/media/100'
			const { resetShareIntent: reset1 } = makeShareIntentContext(
				path1,
				'image/jpeg'
			)
			useIncomingImageListener()
			expect(reset1).toHaveBeenCalledTimes(1)

			// Second share intent
			const path2 = 'content://media/external/images/media/101'
			const { resetShareIntent: reset2 } = makeShareIntentContext(
				path2,
				'image/jpeg'
			)
			useIncomingImageListener()
			expect(reset2).toHaveBeenCalledTimes(1)
		})
	})

	/**
	 * Full integration: two consecutive share intents produce two distinct QUEUED jobs
	 */
	describe('Consecutive share intents', () => {
		it('Two consecutive share intents produce two distinct QUEUED jobs with different sandboxed URIs', () => {
			// First share intent
			const path1 = 'content://media/external/images/media/100'
			makeShareIntentContext(path1, 'image/jpeg')
			useIncomingImageListener()

			// Second share intent
			const path2 = 'content://media/external/images/media/101'
			makeShareIntentContext(path2, 'image/jpeg')
			useIncomingImageListener()

			const jobs = useStyleJobStore.getState().jobs
			const queuedJobs = jobs.filter((j) => j.status === 'QUEUED')
			expect(queuedJobs.length).toBeGreaterThanOrEqual(2)

			// The two jobs must have distinct sourceUris
			const uris = queuedJobs.map((j) => j.sourceUri)
			const uniqueUris = new Set(uris)
			expect(uniqueUris.size).toBeGreaterThanOrEqual(2)

			// processNextJobInQueue should have been called once per intent
			expect(mockProcessNextJobInQueue).toHaveBeenCalledTimes(2)
		})
	})

	/**
	 * All five outcomes together — full Property 1 assertion for Android URI
	 */
	describe('Property 1 — All five outcomes for Android content:// URI', () => {
		it('satisfies all five Property 1 outcomes for an Android content:// URI', () => {
			mockUseModelStoreGetState.mockReturnValue({
				selectedStyleId: 'style_oil',
			})
			const androidPath = 'content://media/external/images/media/42'
			const { resetShareIntent } = makeShareIntentContext(
				androidPath,
				'image/jpeg'
			)

			useIncomingImageListener()

			// 1. Directory constructed with Paths.cache and 'incoming_intents'
			expect(MockDirectory).toHaveBeenCalledWith(
				Paths.cache,
				'incoming_intents'
			)

			// 2. File.copy called with correct source and destination
			expect(MockFile).toHaveBeenCalledTimes(2)
			expect(MockFile).toHaveBeenNthCalledWith(1, androidPath)
			const sourceInstance = MockFile.mock.results[0].value
			const destInstance = MockFile.mock.results[1].value
			expect(sourceInstance.copy).toHaveBeenCalledWith(destInstance)

			// 3. addJob called with sandboxed URI (not original external URI)
			const sandboxedUri = destInstance.uri
			const jobs = useStyleJobStore.getState().jobs
			expect(jobs.length).toBeGreaterThanOrEqual(1)
			const enqueuedJob = jobs[jobs.length - 1]
			expect(enqueuedJob.sourceUri).toBe(sandboxedUri)
			expect(enqueuedJob.sourceUri).not.toBe(androidPath)

			// 4. addJob uses selectedStyleId from useModelStore
			expect(enqueuedJob.styleId).toBe('style_oil')

			// 5. processNextJobInQueue called exactly once
			expect(mockProcessNextJobInQueue).toHaveBeenCalledTimes(1)

			// Bonus: IncomingImageStateDispatcher.set called with sandboxed URI
			const dispatcherState = IncomingImageStateDispatcher.get()
			expect(dispatcherState.uri).toBe(sandboxedUri)

			// Bonus: resetShareIntent called
			expect(resetShareIntent).toHaveBeenCalledTimes(1)
		})
	})

	/**
	 * All five outcomes together — full Property 1 assertion for iOS URI
	 */
	describe('Property 1 — All five outcomes for iOS temporary file:// URI', () => {
		it('satisfies all five Property 1 outcomes for an iOS temporary file:// URI', () => {
			mockUseModelStoreGetState.mockReturnValue({ selectedStyleId: null })
			const iosPath =
				'file:///private/var/mobile/Containers/Data/Application/ABCD-1234/tmp/shared_image.png'
			const { resetShareIntent } = makeShareIntentContext(
				iosPath,
				'image/png'
			)

			useIncomingImageListener()

			// 1. Directory constructed with Paths.cache and 'incoming_intents'
			expect(MockDirectory).toHaveBeenCalledWith(
				Paths.cache,
				'incoming_intents'
			)

			// 2. File.copy called with correct source and destination
			expect(MockFile).toHaveBeenCalledTimes(2)
			expect(MockFile).toHaveBeenNthCalledWith(1, iosPath)
			const sourceInstance = MockFile.mock.results[0].value
			const destInstance = MockFile.mock.results[1].value
			expect(sourceInstance.copy).toHaveBeenCalledWith(destInstance)

			// 3. addJob called with sandboxed URI (not original external URI)
			const sandboxedUri = destInstance.uri
			const jobs = useStyleJobStore.getState().jobs
			expect(jobs.length).toBeGreaterThanOrEqual(1)
			const enqueuedJob = jobs[jobs.length - 1]
			expect(enqueuedJob.sourceUri).toBe(sandboxedUri)
			expect(enqueuedJob.sourceUri).not.toBe(iosPath)

			// 4. addJob falls back to 'default' when selectedStyleId is null
			expect(enqueuedJob.styleId).toBe('default')

			// 5. processNextJobInQueue called exactly once
			expect(mockProcessNextJobInQueue).toHaveBeenCalledTimes(1)

			// Bonus: IncomingImageStateDispatcher.set called with sandboxed URI
			const dispatcherState = IncomingImageStateDispatcher.get()
			expect(dispatcherState.uri).toBe(sandboxedUri)

			// Bonus: resetShareIntent called
			expect(resetShareIntent).toHaveBeenCalledTimes(1)
		})
	})
})
