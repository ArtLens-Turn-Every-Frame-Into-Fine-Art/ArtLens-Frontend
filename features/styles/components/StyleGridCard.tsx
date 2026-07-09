/**
 * @file features/styles/components/StyleGridCard.tsx
 * @description Two-column grid card for the style catalog in StylesScreen.
 *
 * Shows the style thumbnail, a download-state badge (ready / downloading / cloud),
 * and a footer with the style name and file size.
 */

import React, { useCallback } from 'react'
import {
	Dimensions,
	Platform,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
} from 'react-native'
import { Image } from 'expo-image'
import { Download, Zap } from 'lucide-react-native'
import type { StyleModel } from '@/types'
import { Colors } from '@/shared/ui'
import { StylesProgressRing } from './StylesProgressRing'

//
// CONSTANTS
//

const { width: SCREEN_W } = Dimensions.get('window')
const H_PADDING = 20
const COLUMN_GAP = 10
const COLUMNS = 2
const CARD_W = (SCREEN_W - H_PADDING * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface StyleGridCardProps {
	item: StyleModel
	isSelected: boolean
	onSelect: (item: StyleModel) => void
	onDownload: (id: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const StyleGridCard = React.memo<StyleGridCardProps>(
	({ item, isSelected, onSelect, onDownload }) => {
		const isDownloaded = item.downloadStatus === 'downloaded'
		const isDownloading = item.downloadStatus === 'downloading'

		const handlePress = useCallback(() => onSelect(item), [item, onSelect])
		const handleDownload = useCallback(
			(e: any) => {
				e.stopPropagation()
				onDownload(item.id)
			},
			[item.id, onDownload]
		)

		return (
			<TouchableOpacity
				activeOpacity={0.9}
				onPress={handlePress}
				style={[styles.card, isSelected && styles.cardSelected]}
				accessibilityRole="button"
				accessibilityLabel={`${item.name} style, ${item.downloadStatus}`}
			>
				{/* Thumbnail */}
				{item.thumbnailUrl ? (
					<Image
						source={{ uri: item.thumbnailUrl }}
						style={styles.image}
						contentFit="cover"
						cachePolicy="disk"
						transition={250}
					/>
				) : (
					<View style={[styles.image, styles.comingSoonBg]}>
						<Text style={styles.comingSoonText}>COMING SOON</Text>
					</View>
				)}

				{/* Download status badge — top right */}
				<View style={styles.badge}>
					{isDownloaded ? (
						<View style={styles.badgeDownloaded}>
							<Zap
								color={Colors.success}
								size={10}
								fill={Colors.success}
							/>
						</View>
					) : isDownloading ? (
						<StylesProgressRing
							progress={item.downloadProgress ?? 0}
						/>
					) : (
						<TouchableOpacity
							style={styles.badgeCloud}
							onPress={handleDownload}
							hitSlop={12}
						>
							<Download
								color="#FFF"
								size={11}
								strokeWidth={2.5}
							/>
						</TouchableOpacity>
					)}
				</View>

				{/* Footer */}
				<View style={styles.footer}>
					<Text style={styles.name}>{item.name}</Text>
					<Text style={styles.size}>{item.fileSize}</Text>
				</View>
			</TouchableOpacity>
		)
	}
)
StyleGridCard.displayName = 'StyleGridCard'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	card: {
		width: CARD_W,
		backgroundColor: '#FBFBFF',
		borderRadius: 16,
		marginBottom: 20,
		overflow: 'hidden',
		borderWidth: 1,
		borderColor: Colors.border,
		...Platform.select({
			ios: {
				shadowColor: '#000',
				shadowOffset: { width: 0, height: 4 },
				shadowOpacity: 0.1,
				shadowRadius: 8,
			},
			android: { elevation: 4 },
		}),
	},
	cardSelected: {
		borderColor: Colors.primary,
		borderWidth: 2,
	},
	image: {
		width: '100%',
		height: CARD_W,
		aspectRatio: 1,
	},
	comingSoonBg: {
		backgroundColor: '#F2F2F7',
		justifyContent: 'center',
		alignItems: 'center',
	},
	comingSoonText: {
		fontSize: 12,
		fontWeight: '900',
		color: '#8E8E93',
		letterSpacing: 1,
	},
	badge: {
		position: 'absolute',
		top: 8,
		right: 8,
	},
	badgeDownloaded: {
		width: 22,
		height: 22,
		borderRadius: 11,
		backgroundColor: `${Colors.white}`,
		padding: 4,
		borderWidth: 1,
		borderColor: `${Colors.success}60`,
		justifyContent: 'center',
		alignItems: 'center',
	},
	badgeCloud: {
		width: 26,
		height: 26,
		borderRadius: 13,
		backgroundColor: 'rgba(0,0,0,0.55)',
		justifyContent: 'center',
		alignItems: 'center',
	},
	footer: {
		paddingHorizontal: 10,
		paddingVertical: 8,
	},
	name: {
		fontSize: 13,
		fontWeight: '700',
		color: '#1C1C1E',
	},
	size: {
		fontSize: 11,
		color: '#8E8E93',
		marginTop: 2,
	},
})
