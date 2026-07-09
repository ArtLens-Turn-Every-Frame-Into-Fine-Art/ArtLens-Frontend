/**
 * @file features/style-selection/components/EmptyStyleCatalog.tsx
 * @description Empty-state placeholder shown in StyleSelectionScreen when no
 *              styles match the current search/filter criteria.
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Sparkles } from 'lucide-react-native'
import { Colors } from '@/shared/ui'

export function EmptyStyleCatalog(): React.ReactElement {
	return (
		<View style={styles.container}>
			<Sparkles size={36} color={Colors.textMuted} />
			<Text style={styles.title}>No Styles Available</Text>
			<Text style={styles.body}>
				Visit the Styles tab to sync and download art models from the
				catalog.
			</Text>
		</View>
	)
}

const styles = StyleSheet.create({
	container: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 40,
		paddingHorizontal: 32,
		gap: 10,
	},
	title: {
		fontSize: 17,
		fontWeight: '600',
		color: Colors.text,
		textAlign: 'center',
	},
	body: {
		fontSize: 14,
		color: Colors.textMuted,
		textAlign: 'center',
		lineHeight: 20,
	},
})
