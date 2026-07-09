/**
 * @file shared/ui/FormatPicker.tsx
 * @description Horizontal pill selector for image export format (JPEG, PNG, HEIC, etc.).
 *
 * Extracted from app/(tabs)/settings.tsx. The selected format is highlighted
 * in the brand primary color; unselected chips are neutral.
 */

import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Check } from 'lucide-react-native'
import type { ExportFormat } from '@/types'
import { Colors } from './DesignTokens'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const EXPORT_FORMATS: ExportFormat[] = ['JPEG', 'JPG', 'PNG', 'HEIC', 'HEIF']

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface FormatPickerProps {
	selected: ExportFormat
	onSelect: (format: ExportFormat) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const FormatPicker = React.memo<FormatPickerProps>(
	({ selected, onSelect }) => (
		<View style={styles.container}>
			{EXPORT_FORMATS.map((fmt, i) => {
				const isSelected = selected === fmt
				return (
					<Pressable
						key={fmt}
						onPress={() => onSelect(fmt)}
						style={[
							styles.chip,
							isSelected && styles.chipSelected,
							i === 0 && styles.chipFirst,
							i === EXPORT_FORMATS.length - 1 && styles.chipLast,
						]}
						accessibilityRole="radio"
						accessibilityState={{ checked: isSelected }}
						accessibilityLabel={`${fmt} format`}
					>
						{isSelected ? (
							<Check
								color={Colors.white}
								size={12}
								strokeWidth={3}
							/>
						) : null}
						<Text
							style={[
								styles.chipText,
								isSelected && styles.chipTextSelected,
							]}
						>
							{fmt}
						</Text>
					</Pressable>
				)
			})}
		</View>
	)
)
FormatPicker.displayName = 'FormatPicker'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	container: {
		flexDirection: 'row',
		backgroundColor: Colors.surfaceHigh,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: Colors.border,
		overflow: 'hidden',
	},
	chip: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 4,
		paddingVertical: 10,
		borderRightWidth: StyleSheet.hairlineWidth,
		borderRightColor: Colors.border,
	},
	chipSelected: {
		backgroundColor: Colors.primary,
		borderColor: Colors.primary,
	},
	chipFirst: {},
	chipLast: {},
	chipText: {
		fontSize: 13,
		fontWeight: '600',
		color: Colors.textMuted,
	},
	chipTextSelected: {
		color: Colors.white,
	},
})
