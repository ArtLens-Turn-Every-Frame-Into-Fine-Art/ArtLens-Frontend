/**
 * @file useBatteryStore.ts
 * @description Zustand state engine for monitoring device battery safety thresholds.
 * * ALIGNMENT WITH PRD STATS & ARCHITECTURE REQUIREMENTS:
 * - Listens for level variations and low power profile updates.
 * - Freezes background style queues immediately if battery drops <= 5% or
 * power saving settings toggle active, shifting status maps to BATTERY_PAUSED.
 */

import { create } from 'zustand'
import * as Battery from 'expo-battery'
import type { BatteryState } from '@/types' // maps cleanly onto your src/types/index.ts
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('UseBatteryStore')

/** Extend your core definitions to include reactive action interfaces */
export interface BatteryStoreState extends BatteryState {
	/** Starts subscription listeners to hardware power events */
	initializeBatteryMonitoring: () => Promise<void>
	/** Tears down and removes hardware event channel listeners */
	destroyBatteryMonitoring: () => void
	/** Forced manual reading state update pass */
	updateBatteryStatus: () => Promise<void>
}

// Keep tracking variables private inside local module scope using expo-battery's internal Subscription shape
let batteryLevelListener: Battery.Subscription | null = null
let powerStateListener: Battery.Subscription | null = null

const BATTERY_CRITICAL_THRESHOLD = 5 // Trigger execution blocks at <= 5%

export const useBatteryStore = create<BatteryStoreState>((set, get) => ({
	// ———————————————————————————————————————————————————————————————————————————
	// INITIAL CORE STATE DATA MATRICES
	// ———————————————————————————————————————————————————————————————————————————
	batteryLevel: 100,
	isPowerSaverActive: false,
	isProcessingFrozen: false,

	// ———————————————————————————————————————————————————————————————————————————
	// ACTIONS / IMPLEMENTATION UTILITIES
	// ———————————————————————————————————————————————————————————————————————————
	updateBatteryStatus: async () => {
		try {
			const [rawLevel, lowPowerMode] = await Promise.all([
				Battery.getBatteryLevelAsync(),
				Battery.isLowPowerModeEnabledAsync(),
			])

			// Conversion match: native values arrive as floats [0.0 - 1.0], map to [0 - 100]%
			const normalizedLevel = Math.round(rawLevel * 100)
			const shouldFreeze =
				normalizedLevel <= BATTERY_CRITICAL_THRESHOLD || lowPowerMode

			set({
				batteryLevel: normalizedLevel,
				isPowerSaverActive: lowPowerMode,
				isProcessingFrozen: shouldFreeze,
			})
		} catch (error: any) {
			tracker.warn(
				'[useBatteryStore] Could not request hardware power update layout:',
				error.message
			)
		}
	},

	initializeBatteryMonitoring: async () => {
		// Prevent duplicated listener loops across hot-swaps
		get().destroyBatteryMonitoring()

		// Query immediate state configuration context before creating streaming updates
		await get().updateBatteryStatus()

		// 1. Level Variation Channel
		batteryLevelListener = Battery.addBatteryLevelListener(
			({ batteryLevel }) => {
				const normalizedLevel = Math.round(batteryLevel * 100)
				const isPowerSaver = get().isPowerSaverActive
				const shouldFreeze =
					normalizedLevel <= BATTERY_CRITICAL_THRESHOLD ||
					isPowerSaver

				set({
					batteryLevel: normalizedLevel,
					isProcessingFrozen: shouldFreeze,
				})
			}
		)

		// 2. Low Power State and Plug Status Event Channel (Fixed ts(2551) & ts(7031))
		powerStateListener = Battery.addBatteryStateListener(async () => {
			// The battery state listener alerts on charging switches and power-saver status flips.
			// We safely read the absolute current setting to verify state changes accurately.
			const lowPowerMode = await Battery.isLowPowerModeEnabledAsync()
			const currentLevel = get().batteryLevel
			const shouldFreeze =
				currentLevel <= BATTERY_CRITICAL_THRESHOLD || lowPowerMode

			set({
				isPowerSaverActive: lowPowerMode,
				isProcessingFrozen: shouldFreeze,
			})
		})
	},

	destroyBatteryMonitoring: () => {
		if (batteryLevelListener) {
			batteryLevelListener.remove()
			batteryLevelListener = null
		}
		if (powerStateListener) {
			powerStateListener.remove()
			powerStateListener = null
		}
	},
}))
