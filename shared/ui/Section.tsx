/**
 * @file shared/ui/Section.tsx
 * @description Labeled card section wrapper used in settings-style list screens.
 *
 * Renders a uppercase section title above a white rounded-card container.
 * Extracted from app/(tabs)/settings.tsx for reuse across settings-like screens.
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Colors } from './DesignTokens'

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

interface SectionProps {
	title: string
	children: React.ReactNode
}

export const Section: React.FC<SectionProps> = ({ title, children }) => (
	<View style={styles.section}>
		<Text style={styles.sectionTitle}>{title}</Text>
		<View style={styles.sectionCard}>{children}</View>
	</View>
)

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	section: {
		marginBottom: 28,
	},
	sectionTitle: {
		color: Colors.textMuted,
		fontSize: 11,
		fontWeight: '700',
		letterSpacing: 0.8,
		textTransform: 'uppercase',
		paddingHorizontal: 4,
		marginBottom: 10,
	},
	sectionCard: {
		backgroundColor: Colors.surface,
		borderRadius: 16,
		borderWidth: 1,
		borderColor: Colors.border,
		overflow: 'hidden',
	},
})
