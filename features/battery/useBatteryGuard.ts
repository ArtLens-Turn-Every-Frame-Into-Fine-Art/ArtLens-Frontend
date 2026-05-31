/**
 * @file useBatteryGuard.ts
 * @description Custom execution guard hook implementing power safety policies for style loops.
 *
 * RESPONSIBILITIES:
 * - Initialize and tear down hardware power subscription event listeners reactively
 * - Expose state variables and functional guards to block expensive style operations
 * - Enforce structural runtime blocks if remaining power falls beneath strict limits (<= 5%)
 *
 * PRD § 5 — Directory: src/shared/hooks/useBatteryGuard.ts
 */

import { useEffect, useCallback } from 'react'
import { useBatteryStore } from '@/shared/stores/useBatteryStore'

import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('useBatteryGuard')

export interface BatteryGuardHookResult {
	/** Active capacity percentage value remaining on the hardware unit. Range: [0, 100] */
	batteryLevel: number
	/** Dictates if the operational device profile has entered a low-power mode threshold state */
	isPowerSaverActive: boolean
	/** Explicit indicator to immediately halt compute-heavy rendering iterations */
	isProcessingFrozen: boolean
	/** Handy utility function to safely wrap and execute heavy operations conditionally */
	runWithPowerSafety: <R>(task: () => R, fallbackValue: R) => R
}

/**
 * Custom hook to safely attach, manage, and query power threshold guards inside active screen elements.
 * Prevents device overheating and deep battery draining during TFLite frame inferences.
 */
export function useBatteryGuard(): BatteryGuardHookResult {
	const batteryLevel = useBatteryStore((state) => state.batteryLevel)
	const isPowerSaverActive = useBatteryStore(
		(state) => state.isPowerSaverActive
	)
	const isProcessingFrozen = useBatteryStore(
		(state) => state.isProcessingFrozen
	)

	const initializeBatteryMonitoring = useBatteryStore(
		(state) => state.initializeBatteryMonitoring
	)
	const destroyBatteryMonitoring = useBatteryStore(
		(state) => state.destroyBatteryMonitoring
	)

	// Attach streaming subscription channels down onto the device's native hardware module layers
	useEffect(() => {
		initializeBatteryMonitoring()

		return () => {
			destroyBatteryMonitoring()
		}
	}, [initializeBatteryMonitoring, destroyBatteryMonitoring])

	/**
	 * Wraps any high-power performance computation task. It guarantees execution
	 * fires only if power boundaries are sound, returning a safe fallback value if frozen.
	 *
	 * @param task - Lambda function containing code intended for execution under ideal parameters
	 * @param fallbackValue - Element value to provide if system boundaries enforce a processing freeze
	 */
	const runWithPowerSafety = useCallback(
		<R>(task: () => R, fallbackValue: R): R => {
			if (isProcessingFrozen) {
				tracker.warn(
					`[useBatteryGuard] Execution blocked. Current power parameters (${batteryLevel}%, PowerSaver: ${isPowerSaverActive}) violate safety constraints.`
				)
				return fallbackValue
			}
			return task()
		},
		[isProcessingFrozen, batteryLevel, isPowerSaverActive]
	)

	return {
		batteryLevel,
		isPowerSaverActive,
		isProcessingFrozen,
		runWithPowerSafety,
	}
}

/**
 * Static non-reactive validation helper designed for structural filtering tasks,
 * batch iterations, or background style jobs outside component view structures.
 * * @param activeStoreSnapshots - An array containing one or multiple historical state hashes to analyze
 */
export function assertSystemPowerStackSanity(
	activeStoreSnapshots: string[]
): boolean {
	// Query current snapshot values outside the React rendering context framework loop
	const currentStoreState = useBatteryStore.getState()

	if (currentStoreState.isProcessingFrozen) {
		tracker.log(
			`[useBatteryGuard] Background execution loop halted across ${activeStoreSnapshots.length} tracked assets due to system freeze flags.`
		)
		return false
	}

	return true
}
