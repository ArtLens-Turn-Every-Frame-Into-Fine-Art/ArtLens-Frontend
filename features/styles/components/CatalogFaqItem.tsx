/**
 * @file features/styles/components/CatalogFaqItem.tsx
 * @description A question/answer pair used in the FAQ section at the bottom
 *              of the style catalog (StylesScreen and StyleSelectionScreen).
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Colors } from '@/shared/ui/DesignTokens'

interface CatalogFaqItemProps {
	question: string
	answer: string
}

export const CatalogFaqItem = React.memo<CatalogFaqItemProps>(
	({ question, answer }) => (
		<View style={styles.item}>
			<Text style={styles.question}>{question}</Text>
			<Text style={styles.answer}>{answer}</Text>
		</View>
	)
)
CatalogFaqItem.displayName = 'CatalogFaqItem'

const styles = StyleSheet.create({
	item: {
		paddingVertical: 12,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: Colors.borderSubtle,
		gap: 4,
	},
	question: {
		fontSize: 16,
		fontWeight: '700',
		color: Colors.text,
	},
	answer: {
		fontSize: 14,
		color: Colors.textMuted,
		lineHeight: 20,
	},
})
