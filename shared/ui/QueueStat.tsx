/**
 * @file shared/ui/QueueStat.tsx
 * @description A single stat row for the queue activity section in SettingsScreen.
 *
 * Displays an icon, a label, and a colored badge showing the job count.
 * Extracted from app/(tabs)/settings.tsx to keep the screen file lean.
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Colors } from './DesignTokens'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface QueueStatProps {
	icon: React.ReactNode
	label: string
	count: number
	/** Hex color string used for the badge background (at 10% opacity) and text. */
	color: string
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const QueueStat = React.memo<QueueStatProps>(
	({ icon, label, count, color }) => (
		<View style={styles.row}>
			{icon}
			<Text style={styles.label}>{label}</Text>
			<View
				style={[
					styles.badge,
					{
						backgroundColor: `${color}18`,
						borderColor: `${color}35`,
					},
				]}
			>
				<Text style={[styles.count, { color }]}>{count}</Text>
			</View>
		</View>
	)
)
QueueStat.displayName = 'QueueStat'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
	},
	label: {
		flex: 1,
		color: Colors.text,
		fontSize: 14,
		fontWeight: '500',
	},
	badge: {
		minWidth: 32,
		paddingHorizontal: 8,
		paddingVertical: 6,
		borderRadius: 25,
		borderWidth: 1,
		alignItems: 'center',
	},
	count: {
		fontSize: 13,
		fontWeight: '800',
	},
})
