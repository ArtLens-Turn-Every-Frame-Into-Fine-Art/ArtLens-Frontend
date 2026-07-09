/**
 * @file features/gallery/components/GalleryDropdown.tsx
 * @description Pressable chip that opens a full-screen Modal with a list of
 *              selectable options. Used for the Sort and Filter controls in
 *              GalleryScreen.
 *
 * Named GalleryDropdown to keep it scoped to the gallery feature and avoid
 * a generic "Dropdown" name conflict in shared/ui.
 */

import React, { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { CheckCircle2, ChevronDown } from 'lucide-react-native'
import { Colors } from '@/shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface DropdownOption {
	label: string
	value: string
}

interface GalleryDropdownProps {
	/** Button label shown when nothing is selected. */
	label: string
	icon: React.ReactNode
	options: DropdownOption[]
	selected: string
	onSelect: (value: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const GalleryDropdown = React.memo<GalleryDropdownProps>(
	({ label, icon, options, selected, onSelect }) => {
		const [open, setOpen] = useState(false)
		const selectedLabel =
			options.find((o) => o.value === selected)?.label ?? label

		return (
			<>
				<Pressable
					onPress={() => setOpen(true)}
					style={({ pressed }) => [
						styles.chip,
						pressed && styles.chipPressed,
					]}
					accessibilityRole="button"
					accessibilityLabel={`${label}: ${selectedLabel}`}
				>
					{icon}
					<Text style={styles.chipText}>{selectedLabel}</Text>
					<ChevronDown
						size={14}
						color={Colors.text}
						strokeWidth={2}
					/>
				</Pressable>

				<Modal
					visible={open}
					transparent
					animationType="fade"
					onRequestClose={() => setOpen(false)}
				>
					<Pressable
						style={styles.backdrop}
						onPress={() => setOpen(false)}
					>
						<View style={styles.sheet}>
							<Text style={styles.sheetTitle}>{label}</Text>
							{options.map((opt) => (
								<Pressable
									key={opt.value}
									onPress={() => {
										onSelect(opt.value)
										setOpen(false)
									}}
									style={({ pressed }) => [
										styles.option,
										pressed && styles.optionPressed,
										selected === opt.value &&
											styles.optionSelected,
									]}
								>
									<Text
										style={[
											styles.optionText,
											selected === opt.value &&
												styles.optionTextSelected,
										]}
									>
										{opt.label}
									</Text>
									{selected === opt.value ? (
										<CheckCircle2
											color={Colors.primary}
											size={16}
											strokeWidth={2}
										/>
									) : null}
								</Pressable>
							))}
						</View>
					</Pressable>
				</Modal>
			</>
		)
	}
)
GalleryDropdown.displayName = 'GalleryDropdown'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	chip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 5,
		paddingHorizontal: 10,
		paddingVertical: 6,
		backgroundColor: Colors.surface,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: Colors.border,
	},
	chipPressed: {
		opacity: 0.8,
	},
	chipText: {
		fontSize: 13,
		fontWeight: '500',
		color: Colors.text,
	},
	backdrop: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.3)',
		justifyContent: 'flex-end',
	},
	sheet: {
		backgroundColor: Colors.surface,
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		paddingHorizontal: 20,
		paddingTop: 20,
		paddingBottom: 36,
		gap: 4,
	},
	sheetTitle: {
		fontSize: 14,
		fontWeight: '700',
		color: Colors.textMuted,
		textTransform: 'uppercase',
		letterSpacing: 0.5,
		marginBottom: 8,
	},
	option: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingVertical: 13,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: Colors.borderSubtle,
	},
	optionPressed: {
		backgroundColor: Colors.surfaceHigh,
	},
	optionSelected: {},
	optionText: {
		fontSize: 15,
		color: Colors.text,
	},
	optionTextSelected: {
		fontWeight: '700',
		color: Colors.primary,
	},
})
