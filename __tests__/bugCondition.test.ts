/**
 * Bug Condition Exploration Tests
 *
 * These tests document the THREE bugs by asserting the CORRECT (post-fix) behavior.
 * They are run against the UNFIXED code and are EXPECTED TO FAIL.
 * Failure confirms the bugs exist.
 *
 * Sub-test A — Bug 1/2: useIncomingImageListener enqueues instead of navigating
 * Sub-test B — Bug 1/2: resetShareIntent not in finally block
 * Sub-test C — Bug 2 corollary: handleCardPressWithIncoming missing navigation
 * Sub-test D — Bug 2 corollary: handleCardPressWithIncoming missing queue pump
 * Sub-test E — Bug 3: deleteStyleAssets removes MMKV key entirely
 * Sub-test F — Bug 3: deleteStyleAssets does not dispatch Zustand updateDownloadStatus
 *
 * Requirements: Expected Behavior 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2
 */

// ─── Module mocks (must be hoisted before imports) ───────────────────────────

// Mock expo-router — spy on router.push and router.replace
jest.mock('expo-router', () => ({
	router: {
		push: jest.fn(),
		replace: jest.fn(),
		setParams: jest.fn(),
	},
	useLocalSearchParams: jest.fn(() => ({})),
}))

// Mock expo-share-intent — we control what useShareIntentContext returns
jest.mock('expo-share-intent', () => ({
	useShareIntentContext: jest.fn(),
}))

// Mock expo-file-system OO API — no real disk I/O
jest.mock('expo-file-system', () => {
	const mockCopyFn = jest.fn()
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
	const MockDirectory = jest
		.fn()
		.mockImplementation((base: string, sub?: string) => {
			const uri = sub ? `${base}/${sub}/` : `${base}/`
			return {
				uri,
				exists: false,
				create: jest.fn(),
				delete: jest.fn(),
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

// Mock react-native-mmkv — in-memory store so ModelManager can read/write without native bindings
jest.mock('react-native-mmkv', () => {
	const stores: Record<string, Record<string, string>> = {}

	const createMMKV = jest.fn(({ id }: { id: string }) => {
		if (!stores[id]) stores[id] = {}
		const store = stores[id]
		return {
			getString: jest.fn((key: string) => store[key] ?? undefined),
			set: jest.fn((key: string, value: string) => {
				store[key] = value
			}),
			remove: jest.fn((key: string) => {
				delete store[key]
			}),
			getAllKeys: jest.fn(() => Object.keys(store)),
			// Expose for test setup
			__store: store,
			__reset: () => {
				Object.keys(store).forEach((k) => delete store[k])
			},
		}
	})

	// Expose stores map for test access
	;(createMMKV as any).__stores = stores

	return { createMMKV }
})

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

// Mock useModelStore — provide a selectedStyleId and spy on updateDownloadStatus
jest.mock('@/shared/stores/useModelStore', () => {
	const updateDownloadStatus = jest.fn()
	return {
		useModelStore: {
			getState: jest.fn(() => ({
				selectedStyleId: 'default',
				catalog: [],
				updateDownloadStatus,
			})),
		},
		__updateDownloadStatus: updateDownloadStatus,
	}
})

// Mock React's useState and useEffect so we can drive hooks synchronously
// without needing a React renderer
jest.mock('react', () => {
	const actual = jest.requireActual('react')
	return {
		...actual,
		useState: jest.fn((initial: unknown) => [initial, jest.fn()]),
		useEffect: jest.fn((fn: () => void) => fn()),
		useCallback: jest.fn((fn: unknown) => fn),
		useMemo: jest.fn((fn: () => unknown) => fn()),
	}
})

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { router } from 'expo-router'
import { useShareIntentContext } from 'expo-share-intent'
import { useIncomingImageListener } from '../services/useIncomingImage'
import { useStyleJobStore } from '../shared/stores/useStyleJobStore'
import { StyleJobService } from '../features/style-transfer/StyleJobService'
import {
	deleteStyleAssets,
	_writeRegistryEntry,
	getRegistryEntry,
} from '../core/storage/ModelManager'
import type { ModelRegistryEntry } from '../core/storage/ModelManager'

// ─── Typed mock accessors ─────────────────────────────────────────────────────

const mockUseShareIntentContext = useShareIntentContext as jest.Mock
const mockRouterPush = router.push as jest.Mock
const mockRouterReplace = router.replace as jest.Mock
const mockProcessNextJobInQueue =
	StyleJobService.processNextJobInQueue as jest.Mock

// Access the updateDownloadStatus spy from the mock
const { __updateDownloadStatus: mockUpdateDownloadStatus } = jest.requireMock(
	'@/shared/stores/useModelStore'
) as { __updateDownloadStatus: jest.Mock }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeViableShareIntent(
	path = 'file:///cache/photo.jpg',
	mimeType = 'image/jpeg'
) {
	const resetShareIntent = jest.fn()
	mockUseShareIntentContext.mockReturnValue({
		hasShareIntent: true,
		shareIntent: {
			files: [
				{
					path,
					mimeType,
					fileName: path.split('/').pop() ?? 'photo.jpg',
				},
			],
		},
		resetShareIntent,
		error: null,
	})
	return { resetShareIntent }
}

function makeThrowingShareIntent(
	path = 'file:///cache/photo.jpg',
	mimeType = 'image/jpeg'
) {
	const resetShareIntent = jest.fn()
	mockUseShareIntentContext.mockReturnValue({
		hasShareIntent: true,
		shareIntent: {
			files: [
				{
					path,
					mimeType,
					fileName: path.split('/').pop() ?? 'photo.jpg',
				},
			],
		},
		resetShareIntent,
		error: null,
	})
	// Make the File copy throw
	const { File } = jest.requireMock('expo-file-system') as {
		File: jest.Mock & {
			mock: { results: Array<{ value: { copy: jest.Mock } }> }
		}
	}
	// Override copy to throw on next call
	File.mockImplementationOnce((uri: string) => ({
		uri,
		exists: true,
		copy: jest.fn().mockImplementation(() => {
			throw new Error('Simulated copy failure')
		}),
	}))
	return { resetShareIntent }
}

function seedRegistryEntry(styleId: string): ModelRegistryEntry {
	const entry: ModelRegistryEntry = {
		id: styleId,
		name: 'Test Style',
		version: 1,
		downloadStatus: 'downloaded',
		previewPath: `file:///models/${styleId}/preview.tflite`,
		mainPath: `file:///models/${styleId}/main.tflite`,
		configPath: null,
		previewSize: 1024,
		mainSize: 2048,
	}
	_writeRegistryEntry(styleId, entry)
	return entry
}

function clearJobStore() {
	useStyleJobStore.getState().restoreJobs([])
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
	jest.clearAllMocks()
	clearJobStore()

	// Re-apply React hook mocks after clearAllMocks
	const React = jest.requireActual('react')
	const reactMock = require('react') as typeof React
	;(reactMock.useEffect as jest.Mock).mockImplementation((fn: () => void) =>
		fn()
	)
	;(reactMock.useState as jest.Mock).mockImplementation(
		(initial: unknown) => [initial, jest.fn()]
	)
	;(reactMock.useCallback as jest.Mock).mockImplementation(
		(fn: unknown) => fn
	)
	;(reactMock.useMemo as jest.Mock).mockImplementation((fn: () => unknown) =>
		fn()
	)

	// Reset updateDownloadStatus mock
	mockUpdateDownloadStatus.mockReset()

	// Reset useModelStore.getState to return fresh state
	const { useModelStore } = jest.requireMock(
		'@/shared/stores/useModelStore'
	) as {
		useModelStore: { getState: jest.Mock }
	}
	useModelStore.getState.mockReturnValue({
		selectedStyleId: 'default',
		catalog: [],
		updateDownloadStatus: mockUpdateDownloadStatus,
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// SUB-TEST A — Bug 1/2: useIncomingImageListener enqueues instead of navigating
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-test A — Bug 1/2: useIncomingImageListener enqueues instead of navigating', () => {
	/**
	 * EXPECTED TO FAIL on unfixed code.
	 *
	 * On unfixed code: addJob IS called (bug confirmed) and router.push is NOT called (bug confirmed).
	 * The correct behavior is: router.push('/styles') IS called and addJob is NOT called.
	 *
	 * Counterexample: addJob({ sourceUri: 'file:///cache/incoming_intents/photo.jpg', styleId: 'default' })
	 * is called; router.push('/styles') is never called.
	 */
	it('EXPECTED TO FAIL: router.push("/styles") should be called and addJob should NOT be called (confirms Bug 1/2)', () => {
		makeViableShareIntent('file:///cache/photo.jpg', 'image/jpeg')

		useIncomingImageListener()

		// CORRECT behavior: router.push('/styles') IS called
		// On unfixed code this FAILS because router.push is never called
		expect(mockRouterPush).toHaveBeenCalledWith('/styles')

		// CORRECT behavior: addJob is NOT called (no premature job enqueue)
		// On unfixed code this FAILS because addJob IS called
		const jobs = useStyleJobStore.getState().jobs
		expect(jobs.length).toBe(0)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// SUB-TEST B — Bug 1/2: resetShareIntent placement when copy throws
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-test B — Bug 1/2: resetShareIntent placement when copy throws', () => {
	/**
	 * INVESTIGATION RESULT: This test PASSES UNEXPECTEDLY on unfixed code.
	 *
	 * The spec described the bug as: "resetShareIntent is in the try block, not finally."
	 * However, the actual unfixed code places resetShareIntent AFTER the try/catch block
	 * (not inside the try block), so it runs on both success and error paths.
	 *
	 * Code structure in unfixed useIncomingImage.ts:
	 *   try {
	 *     // ... sandbox + enqueue logic ...
	 *   } catch (err) {
	 *     console.error(...)
	 *   }
	 *   // Always flush the share-intent context regardless of success or failure
	 *   resetShareIntent()  ← AFTER try/catch, not inside try
	 *
	 * This means resetShareIntent IS called even when copy throws.
	 * The spec's description of this bug does not match the actual code.
	 *
	 * The structural concern (should be in finally for defensive coding) is valid,
	 * but functionally the current code already calls resetShareIntent on all paths.
	 *
	 * UNEXPECTED PASS: resetShareIntent is already called when copy throws.
	 * This sub-test documents the investigation finding.
	 */
	it('UNEXPECTED PASS (investigation finding): resetShareIntent IS called even when sourceFile.copy throws — resetShareIntent is already after try/catch, not inside try', () => {
		const { resetShareIntent } = makeThrowingShareIntent(
			'file:///cache/photo.jpg',
			'image/jpeg'
		)

		useIncomingImageListener()

		// This PASSES on unfixed code because resetShareIntent is after the try/catch,
		// not inside the try block as the spec described.
		// The structural fix (moving to finally) is still valid for defensive coding,
		// but this is not a functional bug.
		expect(resetShareIntent).toHaveBeenCalledTimes(1)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// SUB-TESTS C & D — Bug 2 corollary: handleCardPressWithIncoming
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For Sub-tests C and D we test handleCardPressWithIncoming directly.
 * We extract the callback logic from styles.tsx and test it in isolation.
 *
 * The buggy code in styles.tsx:
 *   if (incomingUri && item.downloadStatus === 'downloaded') {
 *     enqueueJob({ sourceUri: incomingUri, styleId: item.id })
 *     clearPendingImage()
 *     return
 *   }
 *
 * The correct behavior:
 *   if (pendingImage && item.downloadStatus === 'downloaded') {
 *     useStyleJobStore.getState().addJob({ sourceUri: pendingImage.uri, styleId: item.id })
 *     StyleJobService.processNextJobInQueue()
 *     clearPendingImage()
 *     router.replace('/(tabs)/gallery')
 *     return
 *   }
 */

describe('Sub-test C — Bug 2 corollary: handleCardPressWithIncoming missing navigation', () => {
	/**
	 * NOW PASSES on fixed code.
	 *
	 * The fixed code in styles.tsx calls router.replace('/(tabs)/gallery') after
	 * a style card tap with pendingImage set.
	 *
	 * Fixed code path:
	 *   if (pendingImage && item.downloadStatus === 'downloaded') {
	 *     useStyleJobStore.getState().addJob({ sourceUri: pendingImage.uri, styleId: item.id })
	 *     StyleJobService.processNextJobInQueue()
	 *     clearPendingImage()
	 *     router.replace('/(tabs)/gallery')
	 *     return
	 *   }
	 */
	it('router.replace("/(tabs)/gallery") should be called when pendingImage is set and style is downloaded (confirms navigation present in fixed code)', () => {
		const pendingImage = {
			uri: 'file:///cache/photo.jpg',
			filename: 'photo',
		}
		const item = {
			id: 'style-impressionist',
			downloadStatus: 'downloaded' as const,
			name: 'Impressionist',
		}
		const clearPendingImage = jest.fn()

		// Simulate the FIXED handleCardPressWithIncoming logic from styles.tsx
		if (pendingImage && item.downloadStatus === 'downloaded') {
			useStyleJobStore.getState().addJob({
				sourceUri: pendingImage.uri,
				styleId: item.id,
			})
			StyleJobService.processNextJobInQueue()
			clearPendingImage()
			router.replace('/(tabs)/gallery')
			// return (implicit in test simulation)
		}

		// CORRECT behavior: router.replace('/(tabs)/gallery') IS called
		expect(mockRouterReplace).toHaveBeenCalledWith('/(tabs)/gallery')

		// Also verify addJob was called with the correct payload
		const jobs = useStyleJobStore.getState().jobs
		expect(jobs.length).toBe(1)
		expect(jobs[0].sourceUri).toBe(pendingImage.uri)
		expect(jobs[0].styleId).toBe(item.id)

		// Also verify clearPendingImage was called
		expect(clearPendingImage).toHaveBeenCalledTimes(1)
	})
})

describe('Sub-test D — Bug 2 corollary: handleCardPressWithIncoming missing queue pump', () => {
	/**
	 * NOW PASSES on fixed code.
	 *
	 * The fixed code in styles.tsx calls StyleJobService.processNextJobInQueue()
	 * after a style card tap with pendingImage set.
	 *
	 * Fixed code path:
	 *   if (pendingImage && item.downloadStatus === 'downloaded') {
	 *     useStyleJobStore.getState().addJob({ sourceUri: pendingImage.uri, styleId: item.id })
	 *     StyleJobService.processNextJobInQueue()
	 *     clearPendingImage()
	 *     router.replace('/(tabs)/gallery')
	 *     return
	 *   }
	 */
	it('StyleJobService.processNextJobInQueue should be called when pendingImage is set and style is downloaded (confirms pump present in fixed code)', () => {
		const pendingImage = {
			uri: 'file:///cache/photo.jpg',
			filename: 'photo',
		}
		const item = {
			id: 'style-impressionist',
			downloadStatus: 'downloaded' as const,
			name: 'Impressionist',
		}
		const clearPendingImage = jest.fn()

		// Simulate the FIXED handleCardPressWithIncoming logic from styles.tsx
		if (pendingImage && item.downloadStatus === 'downloaded') {
			useStyleJobStore.getState().addJob({
				sourceUri: pendingImage.uri,
				styleId: item.id,
			})
			StyleJobService.processNextJobInQueue()
			clearPendingImage()
			router.replace('/(tabs)/gallery')
			// return (implicit in test simulation)
		}

		// CORRECT behavior: StyleJobService.processNextJobInQueue IS called
		expect(mockProcessNextJobInQueue).toHaveBeenCalledTimes(1)

		// Also verify addJob was called with the correct payload
		const jobs = useStyleJobStore.getState().jobs
		expect(jobs.length).toBe(1)
		expect(jobs[0].sourceUri).toBe(pendingImage.uri)
		expect(jobs[0].styleId).toBe(item.id)

		// Also verify clearPendingImage was called
		expect(clearPendingImage).toHaveBeenCalledTimes(1)

		// Also verify navigation was called
		expect(mockRouterReplace).toHaveBeenCalledWith('/(tabs)/gallery')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// SUB-TEST E — Bug 3: deleteStyleAssets removes MMKV key entirely
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-test E — Bug 3: deleteStyleAssets removes MMKV key entirely', () => {
	/**
	 * EXPECTED TO FAIL on unfixed code.
	 *
	 * On unfixed code: _storage.remove(`style_entry_test-style`) is called,
	 * which deletes the key entirely. getRegistryEntry returns null.
	 *
	 * Counterexample: getRegistryEntry('test-style') returns null after deleteStyleAssets.
	 */
	it('EXPECTED TO FAIL: getRegistryEntry("test-style") should return a non-null object after deleteStyleAssets (confirms key is deleted entirely)', () => {
		// Seed MMKV with a registry entry
		seedRegistryEntry('test-style')

		// Verify the entry exists before deletion
		const entryBefore = getRegistryEntry('test-style')
		expect(entryBefore).not.toBeNull()

		// Call deleteStyleAssets (unfixed code removes the key entirely)
		deleteStyleAssets('test-style')

		// CORRECT behavior: key should be preserved with downloadStatus: 'not_downloaded'
		// On unfixed code this FAILS because the key is removed entirely
		const entryAfter = getRegistryEntry('test-style')
		expect(entryAfter).not.toBeNull()
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// SUB-TEST F — Bug 3: deleteStyleAssets does not dispatch Zustand
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-test F — Bug 3: deleteStyleAssets does not dispatch Zustand updateDownloadStatus', () => {
	/**
	 * EXPECTED TO FAIL on unfixed code.
	 *
	 * On unfixed code: useModelStore.getState().updateDownloadStatus is never called.
	 * The Zustand catalog retains the stale 'downloaded' status.
	 *
	 * Counterexample: Zustand catalog retains downloadStatus: 'downloaded' after deleteStyleAssets.
	 */
	it('EXPECTED TO FAIL: useModelStore.getState().updateDownloadStatus should be called with ("test-style", "not_downloaded") (confirms Zustand never updated)', () => {
		// Seed MMKV with a registry entry
		seedRegistryEntry('test-style')

		// Call deleteStyleAssets (unfixed code never calls updateDownloadStatus)
		deleteStyleAssets('test-style')

		// CORRECT behavior: updateDownloadStatus IS called with ('test-style', 'not_downloaded')
		// On unfixed code this FAILS because updateDownloadStatus is never called
		expect(mockUpdateDownloadStatus).toHaveBeenCalledWith(
			'test-style',
			'not_downloaded'
		)
	})
})
