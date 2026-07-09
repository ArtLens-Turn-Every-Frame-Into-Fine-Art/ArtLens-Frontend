/**
 * @file features/styles/components/CatalogInfoItem.tsx
 * @description Icon + label row used in the info box at the top of the
 *              style catalog (StylesScreen and StyleSelectionScreen).
 *
 * Named CatalogInfoItem to avoid collisions with any future generic InfoItem
 * in shared/ui.
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Colors } from '@/shared/ui'

interface CatalogInfoItemProps {
	icon: React.ReactNode
	label: string
}

export const CatalogInfoItem = React.memo<CatalogInfoItemProps>(
	({ icon, label }) => (
		<View style={styles.item}>
			{icon}
			<Text style={styles.label}>{label}</Text>
		</View>
	)
)
CatalogInfoItem.displayName = 'CatalogInfoItem'

const styles = StyleSheet.create({
	item: {
		alignItems: 'center',
		gap: 6,
	},
	label: {
		fontSize: 11,
		fontWeight: '600',
		color: Colors.primary,
	},
})
