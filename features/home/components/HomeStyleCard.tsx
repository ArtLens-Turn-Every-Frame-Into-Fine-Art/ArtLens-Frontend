/**
 * @file features/home/components/HomeStyleCard.tsx
 * @description Vertical style card shown in the "Trending Styles" horizontal
 *              FlatList on HomeScreen.
 *
 * Named HomeStyleCard to distinguish it from the StyleCard in
 * features/style-selection/components/ (which handles selection state and
 * download progress) and the StyleGridCard in features/styles/components/.
 */

import React, { useCallback } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Image } from 'expo-image'
import { CheckCircle2, Download } from 'lucide-react-native'
import type { StyleModel } from '@/types'
import { Colors } from '@/shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT CONSTANTS — kept in sync with home.tsx STYLE_CARD_W / STYLE_CARD_H
// ─────────────────────────────────────────────────────────────────────────────

export const HOME_STYLE_CARD_W = 180
const HOME_STYLE_CARD_H = 240

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface HomeStyleCardProps {
	item: StyleModel
	onPress: (id: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const HomeStyleCard = React.memo<HomeStyleCardProps>(
	({ item, onPress }) => {
		const handlePress = useCallback(
			() => onPress(item.id),
			[item.id, onPress]
		)

		const isDownloaded = item.downloadStatus === 'downloaded'
		const isDownloading = item.downloadStatus === 'downloading'

		return (
			<TouchableOpacity
				onPress={handlePress}
				style={styles.card}
				activeOpacity={0.9}
				accessibilityRole="button"
				accessibilityLabel={`${item.name} style — ${isDownloaded ? 'ready' : 'tap to download'}`}
			>
				<Image
					source={{ uri: item.thumbnailUrl }}
					style={styles.image}
					contentFit="cover"
					cachePolicy="disk"
					transition={300}
				/>

				{/* Download status badge */}
				<View style={styles.badge}>
					{isDownloaded ? (
						<CheckCircle2
							color="#10B981"
							size={14}
							fill="#10B98130"
							strokeWidth={2}
						/>
					) : isDownloading ? (
						<Download
							color={Colors.primary}
							size={14}
							strokeWidth={2}
						/>
					) : (
						<Download
							color={Colors.textMuted}
							size={14}
							strokeWidth={1.5}
						/>
					)}
				</View>

				<View style={styles.info}>
					<Text style={styles.name}>{item.name}</Text>
					{!isDownloaded ? (
						<Text style={styles.size}>{item.fileSize}</Text>
					) : null}
				</View>
			</TouchableOpacity>
		)
	}
)
HomeStyleCard.displayName = 'HomeStyleCard'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	card: {
		width: HOME_STYLE_CARD_W,
		height: HOME_STYLE_CARD_H,
		borderRadius: 16,
		overflow: 'hidden',
		backgroundColor: '#FFFFFF',
		borderWidth: 1,
		borderColor: Colors.border,
	},
	image: {
		width: '100%',
		height: HOME_STYLE_CARD_H - 54, // fixed pixel height = card height minus info footer
	},
	badge: {
		position: 'absolute',
		top: 8,
		right: 8,
		width: 22,
		height: 22,
		borderRadius: 11,
		backgroundColor: 'rgba(0,0,0,0.45)',
		justifyContent: 'center',
		alignItems: 'center',
	},
	info: {
		paddingHorizontal: 12,
		paddingVertical: 10,
		backgroundColor: '#FFFFFF',
	},
	name: {
		fontSize: 16,
		fontWeight: '800',
		color: Colors.text,
	},
	size: {
		fontSize: 13,
		color: Colors.textMuted,
		marginTop: 2,
	},
})
