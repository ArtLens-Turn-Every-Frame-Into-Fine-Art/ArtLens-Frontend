/**
 * @file features/gallery/components/ProcessingRing.tsx
 * @description Compact spinner + percentage readout shown over the thumbnail
 *              of a PROCESSING job inside ActiveJobRow.
 *
 * Sized to fit within a 72×72 px thumbnail overlay comfortably:
 *   - ActivityIndicator size="small" (20 dp native)
 *   - Percentage label at 12 sp below the spinner
 *   - No scaling transform — native size is already appropriate
 */

import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Colors } from '@/shared/ui'

interface ProcessingRingProps {
	/** Inference progress in [0, 1]. Displayed as a rounded integer percentage. */
	progress: number
}

export const ProcessingRing = React.memo<ProcessingRingProps>(
	({ progress }) => (
		<View style={styles.wrapper}>
			<ActivityIndicator color={Colors.white} size="small" />
			<Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
		</View>
	)
)
ProcessingRing.displayName = 'ProcessingRing'

const styles = StyleSheet.create({
	wrapper: {
		alignItems: 'center',
		justifyContent: 'center',
		gap: 4,
	},
	percent: {
		fontSize: 12,
		fontWeight: '700',
		color: Colors.white,
	},
})
