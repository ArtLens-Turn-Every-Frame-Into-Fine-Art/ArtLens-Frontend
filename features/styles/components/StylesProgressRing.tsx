/**
 * @file features/styles/components/StylesProgressRing.tsx
 * @description Download progress indicator shown on a style card while its
 *              model pack is being fetched.
 *
 * Named StylesProgressRing to distinguish it from the inference
 * ProcessingRing in features/gallery/components/.
 */

import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Colors } from '@/shared/ui'

interface StylesProgressRingProps {
	/** Download progress in [0, 1]. Displayed as a rounded integer percentage. */
	progress: number
}

export const StylesProgressRing = React.memo<StylesProgressRingProps>(
	({ progress }) => (
		<View style={styles.wrap}>
			<ActivityIndicator color={Colors.primary} size="small" />
			<Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
		</View>
	)
)
StylesProgressRing.displayName = 'StylesProgressRing'

const styles = StyleSheet.create({
	wrap: {
		alignItems: 'center',
		justifyContent: 'center',
		gap: 3,
	},
	percent: {
		fontSize: 10,
		fontWeight: '700',
		color: Colors.primary,
	},
})
