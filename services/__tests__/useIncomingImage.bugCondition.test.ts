/**
 * Bug Condition Exploration Test — useIncomingImageListener
 *
 * This test runs against the UNFIXED code and is EXPECTED TO FAIL.
 * Failure confirms the bug exists:
 *   - No StyleJob is created in useStyleJobStore when a share intent fires
 *   - StyleJobService.processNextJobInQueue is never called
 *
 * Requirements: Bug Condition (design § Bug Details), Property 1 (design § Correctness Properties)
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
import { useIncomingImageListener } from '../useIncomingImage'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockUseShareIntentContext = useShareIntentContext as jest.Mock
const mockProcessNextJobInQueue =
	StyleJobService.processNextJobInQueue as jest.Mock

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

describe('Bug Condition Exploration — useIncomingImageListener (UNFIXED code)', () => {
	/**
	 * Case 1: Android content:// URI
	 *
	 * The hook receives a share intent with an Android gallery content URI.
	 * On unfixed code: no job is created → assertion FAILS (confirms bug).
	 */
	it('Case 1 — Android content:// URI: store should contain a QUEUED job (EXPECTED TO FAIL on unfixed code)', () => {
		const androidPath = 'content://media/external/images/media/42'
		makeShareIntentContext(androidPath, 'image/jpeg')

		// Invoke the hook — useEffect fires synchronously via mock
		useIncomingImageListener()

		const jobs = useStyleJobStore.getState().jobs
		// This assertion MUST FAIL on unfixed code — no job is ever created
		expect(jobs.length).toBeGreaterThanOrEqual(1)
		expect(jobs.some((j) => j.status === 'QUEUED')).toBe(true)
	})

	/**
	 * Case 2: iOS temporary file:// URI outside sandbox
	 *
	 * The hook receives a share intent with an iOS temporary path.
	 * On unfixed code: no job is created → assertion FAILS (confirms bug).
	 */
	it('Case 2 — iOS temporary file:// URI: store should contain a QUEUED job (EXPECTED TO FAIL on unfixed code)', () => {
		const iosPath =
			'file:///private/var/mobile/Containers/Data/Application/ABCD-1234/tmp/shared_image.png'
		makeShareIntentContext(iosPath, 'image/png')

		useIncomingImageListener()

		const jobs = useStyleJobStore.getState().jobs
		// This assertion MUST FAIL on unfixed code — no job is ever created
		expect(jobs.length).toBeGreaterThanOrEqual(1)
		expect(jobs.some((j) => j.status === 'QUEUED')).toBe(true)
	})

	/**
	 * Case 3: Two consecutive share intents → two distinct QUEUED jobs
	 *
	 * On unfixed code: no jobs are created → assertion FAILS (confirms bug).
	 */
	it('Case 3 — Two consecutive share intents: store should contain two distinct QUEUED jobs (EXPECTED TO FAIL on unfixed code)', () => {
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

		// This assertion MUST FAIL on unfixed code — no jobs are ever created
		expect(queuedJobs.length).toBeGreaterThanOrEqual(2)

		// Ensure the two jobs have distinct sourceUris
		const uris = queuedJobs.map((j) => j.sourceUri)
		const uniqueUris = new Set(uris)
		expect(uniqueUris.size).toBeGreaterThanOrEqual(2)
	})

	/**
	 * Case 4: processNextJobInQueue call count check
	 *
	 * On unfixed code: StyleJobService.processNextJobInQueue is never called
	 * → assertion FAILS (confirms bug).
	 */
	it('Case 4 — processNextJobInQueue should be called at least once after a share intent (EXPECTED TO FAIL on unfixed code)', () => {
		const androidPath = 'content://media/external/images/media/42'
		makeShareIntentContext(androidPath, 'image/jpeg')

		useIncomingImageListener()

		// This assertion MUST FAIL on unfixed code — processNextJobInQueue is never called
		expect(mockProcessNextJobInQueue).toHaveBeenCalledTimes(1)
	})
})
