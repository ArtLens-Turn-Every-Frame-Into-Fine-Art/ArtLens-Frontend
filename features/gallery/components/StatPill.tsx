/**
 * @file features/gallery/components/StatPill.tsx
 * @description Small summary pill showing a numeric value and a label.
 *
 * Used in GalleryScreen's stats strip at the top of the list.
 * An optional accent color highlights the value text and the pill border.
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Colors } from '@/shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface StatPillProps {
	label: string
	value: string
	/** Optional hex color for the value text and pill border tint. */
	accent?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const StatPill = React.memo<StatPillProps>(
	({ label, value, accent }) => (
		<View
			style={[styles.pill, accent ? { borderColor: `${accent}40` } : {}]}
		>
			<Text style={[styles.value, accent ? { color: accent } : {}]}>
				{value}
			</Text>
			<Text style={styles.label}> {label}</Text>
		</View>
	)
)
StatPill.displayName = 'StatPill'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	pill: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 10,
		paddingVertical: 5,
		borderRadius: 20,
		backgroundColor: Colors.surface,
		borderWidth: 1,
		borderColor: Colors.border,
	},
	value: {
		fontSize: 13,
		fontWeight: '700',
		color: Colors.text,
	},
	label: {
		fontSize: 12,
		color: Colors.textMuted,
	},
})
