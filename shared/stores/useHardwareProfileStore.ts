/**
 * @file useHardwareProfileStore.ts
 * @description Zustand state engine for managing hardware acceleration profiles and runtime delegates.
 *
 * RESPONSIBILITIES:
 * - Persist and manage hardware accelerator delegates (GPU, NPU, CoreML, NNAPI)
 * - Provide independent runtime delegate fallbacks for 'preview' and 'main' model slots
 * - Detect platform capability contexts safely and provide automatic profile selection
 * - Integrate cleanly with global app state configurations and constants
 *
 * PRD § 5 — Directory: src/stores/useHardwareProfileStore.ts
 */

import { create } from 'zustand'
import { Platform } from 'react-native'
import { createMMKV } from 'react-native-mmkv'
import { ModelSlot } from '@/types'
import {
	STORAGE_INSTANCE_IDS,
	APP_STATE_KEYS,
} from '@/shared/utils/storageKeys'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('useHardwareStore')

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

/** Available accelerator delegates supported natively by react-native-fast-tflite v3.x */
export type HardwareDelegate =
	| 'xnnpack'
	| 'nnapi'
	| 'android-gpu'
	| 'core-ml'
	| 'metal'

// ADDED: Simple data structure for profile to resolve profile typing issues in settings.tsx
export interface HardwareBenchmarkProfile {
	tier: 1 | 2
	score?: number
	lastRunTimestamp?: number
}

export interface HardwareProfileState {
	/** Active hardware delegates assigned per inference runtime pipeline slot */
	activeDelegates: Record<ModelSlot, HardwareDelegate[]>
	/** Whether the hardware profile was manually overridden by the developer or user preferences */
	isManualOverride: boolean
	/** Derived performance profiling class context tier for custom optimizations */
	hardwareTier: 1 | 2

	/** Active hardware benchmark metrics profile record */
	profile: HardwareBenchmarkProfile | null
	/** State tracking boolean indicating if a resource benchmark evaluation is currently active */
	isBenchmarking: boolean
}

export interface HardwareProfileActions {
	/** Enforces programmatic detection sequences to re-evaluate computing capabilities dynamically */
	reprofileHardwareCapabilities: () => void
	/** Configures distinct delegate queues targeting an isolated internal execution slot context */
	setSlotDelegates: (slot: ModelSlot, delegates: HardwareDelegate[]) => void
	/** Reverts override layers back to system inferred capabilities matrices securely */
	resetToSystemDefaults: () => void

	// FIXED FOR SETTINGS.TSX compatibility layers
	/** Mutation action updating active storage configuration profiles */
	setProfile: (profile: HardwareBenchmarkProfile) => void
	/** Mutation action shifting running loader parameters */
	setIsBenchmarking: (flag: boolean) => void
}

export type HardwareProfileStore = HardwareProfileState & HardwareProfileActions

// ─────────────────────────────────────────────────────────────────────────────
// STORE CORE MODULE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

/** Atomic internal instance sandbox mapped directly to application state bounds */
const _appStateStorage = createMMKV({ id: STORAGE_INSTANCE_IDS.APP_STATE })

/**
 * Evaluates default cross-platform fallback configurations targeting a specific model layout allocation.
 */
function _getPlatformDefaults(slot: ModelSlot): HardwareDelegate[] {
	if (Platform.OS === 'ios') {
		// Leverage Metal GPU shaders on main thread rendering queues, and CoreML accelerators for preview spaces
		return slot === 'main' ? ['metal'] : ['core-ml', 'metal']
	}
	// Default matrix strategy fallback tracking for generic Android distributions
	return slot === 'main' ? ['android-gpu'] : ['nnapi', 'xnnpack']
}

/**
 * Safe initializer attempting to retrieve previously saved manual configuration streams from hardware storage.
 */
function _getInitialDelegates(): Record<ModelSlot, HardwareDelegate[]> {
	try {
		const rawOverrides = _appStateStorage.getString(
			APP_STATE_KEYS.USER_INFERENCE_DELEGATE_OVERRIDE
		)
		if (rawOverrides) {
			return JSON.parse(rawOverrides)
		}
	} catch (err: any) {
		tracker.warn(
			'[HardwareProfileStore] Cache extraction error loading delegate overrides:',
			err.message
		)
	}

	return {
		preview: _getPlatformDefaults('preview'),
		main: _getPlatformDefaults('main'),
	}
}

/**
 * Initializer helper to read cached profile measurements from cold storage disk.
 */
function _getInitialProfile(inferredTier: 1 | 2): HardwareBenchmarkProfile {
	try {
		// Use USER_INFERENCE_DELEGATE_OVERRIDE base parameters or separate string registers as necessary
		const saved = _appStateStorage.getString(
			'app_config:hardware_benchmark_profile'
		)
		if (saved) return JSON.parse(saved)
	} catch (e) {
		tracker.error(
			'[HardwareProfileStore] Failed parsing initial benchmark profile:',
			e
		)
	}
	return { tier: inferredTier }
}

export const useHardwareProfileStore = create<HardwareProfileStore>(
	(set, get) => {
		// Base automatic static performance analysis
		const initialInferredTier =
			Platform.OS === 'android' && Platform.Version < 28 ? 1 : 2

		return {
			// --- Initial State ---
			activeDelegates: _getInitialDelegates(),
			isManualOverride: _appStateStorage.contains(
				APP_STATE_KEYS.USER_INFERENCE_DELEGATE_OVERRIDE
			),
			hardwareTier: initialInferredTier,
			profile: _getInitialProfile(initialInferredTier),
			isBenchmarking: false,

			// --- Actions ---
			setProfile: (profile) => {
				try {
					_appStateStorage.set(
						'app_config:hardware_benchmark_profile',
						JSON.stringify(profile)
					)
				} catch (err) {
					tracker.error(
						'[HardwareProfileStore] Failed saving benchmark profiles to hardware disk:',
						err
					)
				}
				set({ profile, hardwareTier: profile.tier })
			},

			setIsBenchmarking: (isBenchmarking) => set({ isBenchmarking }),

			reprofileHardwareCapabilities: () => {
				// Basic automatic heuristic determining legacy device API levels or memory footprint limits
				const inferredTier =
					Platform.OS === 'android' && Platform.Version < 28 ? 1 : 2

				set({
					activeDelegates: {
						preview: _getPlatformDefaults('preview'),
						main:
							inferredTier === 1
								? ['xnnpack']
								: _getPlatformDefaults('main'),
					},
					isManualOverride: false,
					hardwareTier: inferredTier,
					profile: {
						tier: inferredTier,
						lastRunTimestamp: Date.now(),
					},
				})
			},

			setSlotDelegates: (
				slot: ModelSlot,
				delegates: HardwareDelegate[]
			) => {
				const currentDelegates = { ...get().activeDelegates }
				currentDelegates[slot] = delegates

				// Sync allocations persistently out to the hardware state file index configurations
				try {
					_appStateStorage.set(
						APP_STATE_KEYS.USER_INFERENCE_DELEGATE_OVERRIDE,
						JSON.stringify(currentDelegates)
					)
				} catch (err) {
					tracker.error(
						'[HardwareProfileStore] Execution pipeline failed writing persistent override matrix:',
						err
					)
				}

				set({
					activeDelegates: currentDelegates,
					isManualOverride: true,
				})
			},

			resetToSystemDefaults: () => {
				try {
					_appStateStorage.remove(
						APP_STATE_KEYS.USER_INFERENCE_DELEGATE_OVERRIDE
					)
					_appStateStorage.remove(
						'app_config:hardware_benchmark_profile'
					)
				} catch (err: any) {
					tracker.warn(
						'[HardwareProfileStore] Could not drop manual preference key:',
						err.message
					)
				}

				set({
					activeDelegates: {
						preview: _getPlatformDefaults('preview'),
						main: _getPlatformDefaults('main'),
					},
					isManualOverride: false,
					hardwareTier: initialInferredTier,
					profile: { tier: initialInferredTier },
				})
			},
		}
	}
)
