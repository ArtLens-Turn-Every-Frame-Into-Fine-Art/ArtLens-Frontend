/**
 * @file features/style-selection/components/ThumbnailSkeleton.tsx
 * @description Animated shimmer placeholder shown while a style thumbnail
 *              is loading from cache or a remote URL.
 */

import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'

export function ThumbnailSkeleton(): React.ReactElement {
	const anim = useRef(new Animated.Value(0.3)).current

	useEffect(() => {
		const pulse = Animated.loop(
			Animated.sequence([
				Animated.timing(anim, {
					toValue: 0.7,
					duration: 900,
					useNativeDriver: true,
				}),
				Animated.timing(anim, {
					toValue: 0.3,
					duration: 900,
					useNativeDriver: true,
				}),
			])
		)
		pulse.start()
		return () => pulse.stop()
	}, [anim])

	return (
		<Animated.View
			style={[
				StyleSheet.absoluteFill,
				styles.skeleton,
				{ opacity: anim },
			]}
		/>
	)
}

const styles = StyleSheet.create({
	skeleton: {
		backgroundColor: '#E5E5EA',
		borderRadius: 12,
	},
})
