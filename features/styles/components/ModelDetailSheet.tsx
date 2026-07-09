/**
 * @file features/styles/components/ModelDetailSheet.tsx
 * @description Modal bottom sheet showing full metadata for a selected style,
 *              with Download / Delete actions.
 *
 * Used by StylesScreen (app/(tabs)/styles.tsx).
 */

import React from 'react'
import {
	ActivityIndicator,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { Image } from 'expo-image'
import {
	Check,
	Download,
	HardDrive,
	Info,
	Trash2,
	X,
} from 'lucide-react-native'
import type { StyleModel } from '@/types'
import { Colors } from '@/shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ModelDetailSheetProps {
	item: StyleModel | null
	visible: boolean
	onClose: () => void
	onDownload: (id: string) => void
	onDelete: (id: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const ModelDetailSheet = React.memo<ModelDetailSheetProps>(
	({ item, visible, onClose, onDownload, onDelete }) => {
		// Guard: nothing to render if no item is selected
		if (!item) return null

		const isDownloaded = item.downloadStatus === 'downloaded'
		const isDownloading = item.downloadStatus === 'downloading'

		return (
			<Modal
				visible={visible}
				animationType="slide"
				presentationStyle={
					Platform.OS === 'ios' ? 'pageSheet' : 'formSheet'
				}
				onRequestClose={onClose}
			>
				<View style={styles.sheet}>
					<Pressable
						onPress={onClose}
						style={styles.closeBtn}
						accessibilityRole="button"
						accessibilityLabel="Close"
					>
						<X color={Colors.textMuted} size={20} strokeWidth={2} />
					</Pressable>

					<ScrollView showsVerticalScrollIndicator={false}>
						{/* Hero thumbnail */}
						<View style={styles.hero}>
							<Image
								source={{ uri: item.thumbnailUrl }}
								style={styles.heroImage}
								contentFit="cover"
								cachePolicy="memory-disk"
							/>
						</View>

						<View style={styles.content}>
							<Text style={styles.title}>{item.name}</Text>
							<Text style={styles.description}>
								{item.description}
							</Text>

							{/* Metadata row */}
							<View style={styles.meta}>
								<View style={styles.metaItem}>
									<HardDrive
										color={Colors.textMuted}
										size={14}
										strokeWidth={1.5}
									/>
									<Text style={styles.metaText}>
										{item.fileSize}
									</Text>
								</View>
								<View style={styles.metaItem}>
									<Info
										color={Colors.textMuted}
										size={14}
										strokeWidth={1.5}
									/>
									<Text style={styles.metaText}>
										v{item.version}
									</Text>
								</View>
							</View>

							{/* Action area — switches on download state */}
							{isDownloaded ? (
								<View style={styles.actions}>
									<View style={styles.readyRow}>
										<Check
											color={Colors.success}
											size={18}
											strokeWidth={2.5}
										/>
										<Text style={styles.readyText}>
											Style ready
										</Text>
									</View>
									<Pressable
										onPress={() => onDelete(item.id)}
										style={styles.deleteBtn}
										accessibilityRole="button"
										accessibilityLabel={`Delete ${item.name}`}
									>
										<Trash2
											color="#DC2626"
											size={16}
											strokeWidth={1.8}
										/>
										<Text style={styles.deleteText}>
											Remove from device
										</Text>
									</Pressable>
								</View>
							) : isDownloading ? (
								<View style={styles.downloadingRow}>
									<ActivityIndicator
										color={Colors.primary}
										size="small"
									/>
									<Text style={styles.downloadingText}>
										Downloading…{' '}
										{Math.round(
											(item.downloadProgress ?? 0) * 100
										)}
										%
									</Text>
								</View>
							) : (
								<Pressable
									onPress={() => onDownload(item.id)}
									style={styles.downloadBtn}
									accessibilityRole="button"
									accessibilityLabel={`Download ${item.name}`}
								>
									<Download
										color="#FFF"
										size={18}
										strokeWidth={2}
									/>
									<Text style={styles.downloadBtnText}>
										Download ({item.fileSize})
									</Text>
								</Pressable>
							)}
						</View>
					</ScrollView>
				</View>
			</Modal>
		)
	}
)
ModelDetailSheet.displayName = 'ModelDetailSheet'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	sheet: {
		flex: 1,
		backgroundColor: '#FFFFFF',
		paddingTop: 25,
	},
	closeBtn: {
		position: 'absolute',
		top: 43,
		right: 18,
		width: 36,
		height: 36,
		borderRadius: 25,
		backgroundColor: '#F2F2F7',
		justifyContent: 'center',
		alignItems: 'center',
		zIndex: 10,
	},
	hero: {
		height: 350,
		overflow: 'hidden',
	},
	heroImage: {
		width: '100%',
		height: '100%',
	},
	content: {
		padding: 24,
		gap: 12,
	},
	title: {
		fontSize: 26,
		fontWeight: '800',
		letterSpacing: -0.5,
		color: '#1C1C1E',
	},
	description: {
		fontSize: 15,
		color: Colors.textMuted,
		lineHeight: 22,
	},
	meta: {
		flexDirection: 'row',
		gap: 20,
		marginVertical: 4,
	},
	metaItem: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	metaText: {
		fontSize: 13,
		color: Colors.textMuted,
		fontWeight: '500',
	},
	actions: {
		gap: 12,
	},
	readyRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: `${Colors.success}20`,
		borderRadius: 12,
		paddingVertical: 12,
		paddingHorizontal: 16,
		borderWidth: 1,
		borderColor: `${Colors.success}30`,
	},
	readyText: {
		fontSize: 15,
		fontWeight: '600',
		color: Colors.success,
	},
	deleteBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		paddingVertical: 12,
		paddingHorizontal: 16,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: '#DC262630',
		backgroundColor: '#DC262610',
	},
	deleteText: {
		fontSize: 14,
		fontWeight: '600',
		color: '#DC2626',
	},
	downloadingRow: {
		flexDirection: 'row',
		alignItems: 'center',
	},
	downloadingText: {
		fontSize: 14,
		color: Colors.textMuted,
	},
	downloadBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 10,
		backgroundColor: Colors.primary,
		borderRadius: 14,
		paddingVertical: 14,
	},
	downloadBtnText: {
		fontSize: 15,
		fontWeight: '700',
		color: '#FFFFFF',
	},
})
