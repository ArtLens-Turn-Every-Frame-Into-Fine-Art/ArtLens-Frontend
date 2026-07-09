/**
 * @file features/home/components/PulseDot.tsx
 * @description Animated pulsing dot shown inside the ComputeMonitor pill
 *              while jobs are actively processing.
 */

import React, { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, {
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withSequence,
	withTiming,
} from 'react-native-reanimated'
import { Colors } from '@/shared/ui'

export const PulseDot = React.memo(() => {
	const scale = useSharedValue(1)

	useEffect(() => {
		scale.value = withRepeat(
			withSequence(
				withTiming(1.4, {
					duration: 700,
					easing: Easing.out(Easing.quad),
				}),
				withTiming(1, { duration: 700, easing: Easing.in(Easing.quad) })
			),
			-1,
			false
		)
	}, [scale])

	const animStyle = useAnimatedStyle(() => ({
		transform: [{ scale: scale.value }],
		opacity: scale.value > 1.2 ? 0.6 : 1,
	}))

	return <Animated.View style={[styles.dot, animStyle]} />
})
PulseDot.displayName = 'PulseDot'

const styles = StyleSheet.create({
	dot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: Colors.primary,
	},
})
