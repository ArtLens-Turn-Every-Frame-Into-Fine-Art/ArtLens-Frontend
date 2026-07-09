/**
 * @file shared/ui/Row.tsx
 * @description Generic settings-list row with icon, label, optional subtitle,
 *              and a right-hand accessory (custom node or auto-chevron).
 *
 * Used by SettingsScreen for every tappable and static row. Extracted from
 * app/(tabs)/settings.tsx so it can be reused across any list-style screen.
 */

import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { Colors } from './DesignTokens'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface RowProps {
	icon: React.ReactNode
	label: string
	/** Secondary line of text rendered below the label. */
	/** Custom right-hand content. When absent and onPress is set, a chevron renders. */
	right?: React.ReactNode
	onPress?: () => void
	/** Renders the label and icon tint in the destructive (error) color. */
	danger?: boolean
	/** Suppresses the bottom border separator. */
	noBorder?: boolean
	subtitle?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const Row = React.memo<RowProps>(
	({ icon, label, right, onPress, danger, noBorder, subtitle }) => {
		const content = (
			<>
				<View style={styles.rowLeft}>
					<View
						style={[styles.rowIcon, danger && styles.rowIconDanger]}
					>
						{icon}
					</View>
					<View style={styles.rowLabelBlock}>
						<Text
							style={[
								styles.rowLabel,
								danger && styles.rowLabelDanger,
							]}
						>
							{label}
						</Text>
						{subtitle ? (
							<Text style={styles.rowSubtitle}>{subtitle}</Text>
						) : null}
					</View>
				</View>

				<View style={styles.rowRight}>
					{right}
					{onPress && !right ? (
						<ChevronRight
							color={Colors.textDim}
							size={16}
							strokeWidth={1.5}
						/>
					) : null}
				</View>
			</>
		)

		if (onPress) {
			return (
				<Pressable
					onPress={onPress}
					style={({ pressed }) => [
						styles.row,
						!noBorder && styles.rowBorder,
						pressed && styles.rowPressed,
					]}
					accessibilityRole="button"
					accessibilityLabel={label}
				>
					{content}
				</Pressable>
			)
		}

		return (
			<View style={[styles.row, !noBorder && styles.rowBorder]}>
				{content}
			</View>
		)
	}
)
Row.displayName = 'Row'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 16,
		paddingVertical: 14,
		minHeight: 52,
	},
	rowBorder: {
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: Colors.border,
	},
	rowPressed: {
		backgroundColor: Colors.surfaceHigh,
	},
	rowLeft: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		flex: 1,
	},
	rowIcon: {
		width: 32,
		height: 32,
		borderRadius: 8,
		backgroundColor: Colors.surfaceHigh,
		justifyContent: 'center',
		alignItems: 'center',
	},
	rowIconDanger: { backgroundColor: `${Colors.error}15` },
	rowLabelBlock: {
		flex: 1,
	},
	rowLabel: {
		color: Colors.text,
		fontSize: 15,
		fontWeight: '500',
	},
	rowLabelDanger: {
		color: Colors.errorDeep,
	},
	rowSubtitle: {
		color: Colors.textMuted,
		fontSize: 12,
		marginTop: 1,
	},
	rowRight: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
})
