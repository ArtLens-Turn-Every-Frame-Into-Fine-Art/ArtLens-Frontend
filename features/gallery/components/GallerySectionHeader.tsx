/**
 * @file features/gallery/components/GallerySectionHeader.tsx
 * @description Section header row with a title, item count badge, and optional action.
 *
 * Named GallerySectionHeader to avoid a naming collision with the shared
 * settings-style Section wrapper in shared/ui/Section.tsx.
 */

import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Colors } from '@/shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface SectionAction {
	label: string
	onPress: () => void
	icon?: React.ReactNode
}

interface GallerySectionHeaderProps {
	title: string
	count: number
	action?: SectionAction
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const GallerySectionHeader = React.memo<GallerySectionHeaderProps>(
	({ title, count, action }) => (
		<View style={styles.row}>
			<View style={styles.left}>
				<Text style={styles.title}>{title}</Text>
				<View style={styles.badge}>
					<Text style={styles.badgeText}>{count}</Text>
				</View>
			</View>
			{action ? (
				<Pressable
					onPress={action.onPress}
					style={styles.action}
					accessibilityRole="button"
					accessibilityLabel={action.label}
					hitSlop={10}
				>
					{action.icon}
					<Text style={styles.actionText}>{action.label}</Text>
				</Pressable>
			) : null}
		</View>
	)
)
GallerySectionHeader.displayName = 'GallerySectionHeader'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 10,
		marginTop: 4,
	},
	left: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	title: {
		fontSize: 16,
		fontWeight: '700',
		color: Colors.text,
	},
	badge: {
		backgroundColor: Colors.primarySoft,
		borderRadius: 10,
		paddingHorizontal: 7,
		paddingVertical: 2,
	},
	badgeText: {
		fontSize: 12,
		fontWeight: '700',
		color: Colors.primary,
	},
	action: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
	},
	actionText: {
		fontSize: 13,
		fontWeight: '600',
		color: Colors.primary,
	},
})
