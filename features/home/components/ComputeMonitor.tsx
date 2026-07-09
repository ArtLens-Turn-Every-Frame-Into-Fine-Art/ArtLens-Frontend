/**
 * @file features/home/components/ComputeMonitor.tsx
 * @description Floating pill shown at the bottom of HomeScreen while jobs are
 *              processing or paused due to low battery.
 *
 * Tapping navigates to the Gallery tab.
 */

import React, { useEffect } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import Animated, {
	FadeInDown,
	FadeOutDown,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
} from 'react-native-reanimated'
import { Battery, ChevronRight } from 'lucide-react-native'
import { Colors } from '@/shared/ui'
import { PulseDot } from './PulseDot'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ComputeMonitorProps {
	/** Number of active or paused jobs. */
	count: number
	/** When true, shows a battery-paused state instead of the pulsing dot. */
	batteryPaused: boolean
	onPress: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const ComputeMonitor = React.memo<ComputeMonitorProps>(
	({ count, batteryPaused, onPress }) => {
		const translateY = useSharedValue(40)

		useEffect(() => {
			translateY.value = withSpring(0, { damping: 18, stiffness: 200 })
			return () => {
				// Slide out on unmount — the FadeOutDown exiting prop handles the
				// opacity fade while we reset the translateY for a clean re-entry.
				translateY.value = 40
			}
		}, [translateY])

		const animStyle = useAnimatedStyle(() => ({
			transform: [{ translateY: translateY.value }],
		}))

		const label = batteryPaused
			? 'Paused — low battery'
			: `Transforming ${count} image${count === 1 ? '' : 's'}…`

		const a11yLabel = batteryPaused
			? 'Processing paused due to low battery. Tap to view gallery.'
			: `${count} image${count === 1 ? '' : 's'} transforming. Tap to view gallery.`

		return (
			<Animated.View
				style={[styles.wrapper, animStyle]}
				entering={FadeInDown.duration(280).springify()}
				exiting={FadeOutDown.duration(200)}
			>
				<Pressable
					onPress={onPress}
					style={({ pressed }) => [
						styles.pill,
						batteryPaused && styles.pillPaused,
						pressed && { opacity: 0.85 },
					]}
					accessibilityRole="button"
					accessibilityLabel={a11yLabel}
				>
					{batteryPaused ? (
						<Battery
							color={Colors.warning}
							size={16}
							strokeWidth={2}
						/>
					) : (
						<PulseDot />
					)}
					<Text
						style={[
							styles.text,
							batteryPaused && styles.textPaused,
						]}
					>
						{label}
					</Text>
					<ChevronRight
						color={batteryPaused ? Colors.warning : Colors.primary}
						size={14}
						strokeWidth={2}
					/>
				</Pressable>
			</Animated.View>
		)
	}
)
ComputeMonitor.displayName = 'ComputeMonitor'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	wrapper: {
		position: 'absolute',
		bottom: 16,
		left: 20,
		right: 20,
		alignItems: 'center',
	},
	pill: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		paddingHorizontal: 18,
		paddingVertical: 12,
		backgroundColor: Colors.surface,
		borderRadius: 28,
		borderWidth: 1,
		borderColor: Colors.border,
		shadowColor: Colors.primary,
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.12,
		shadowRadius: 12,
		elevation: 6,
	},
	pillPaused: {
		borderColor: `${Colors.warning}40`,
		shadowColor: Colors.warning,
	},
	text: {
		flex: 1,
		fontSize: 14,
		fontWeight: '600',
		color: Colors.text,
	},
	textPaused: {
		color: Colors.warning,
	},
})
