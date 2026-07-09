/**
 * @file features/style-selection/components/SelectionStyleCard.tsx
 * @description Style card used in StyleSelectionScreen.
 *
 * Displays a thumbnail, download-state badge, live inference progress overlay,
 * selection checkmark, and a footer showing name and size/ready state.
 * Plays a spring scale animation when selected.
 *
 * Named SelectionStyleCard to avoid collisions with HomeStyleCard and
 * StyleGridCard which serve different layouts and interaction models.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Animated,
	Dimensions,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
} from 'react-native'
import { Image } from 'expo-image'
import { CheckCircle2, Clock } from 'lucide-react-native'
import type { StyleModel } from '@/types'
import { ThumbnailSkeleton } from './ThumbnailSkeleton'
import { Colors } from '@/shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT CONSTANTS — kept in sync with StyleSelectionScreen CARD_WIDTH
// ─────────────────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const H_PADDING = 20
const COLUMN_GAP = 10
const NUM_COLUMNS = 2
const CARD_WIDTH =
	(SCREEN_WIDTH - H_PADDING * 2 - COLUMN_GAP * (NUM_COLUMNS - 1)) /
	NUM_COLUMNS

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface SelectionStyleCardProps {
	model: StyleModel
	isSelected: boolean
	/** null = no active job; 0–100 = inference percentage to show as overlay. */
	progressPercent: number | null
	onPress: (id: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function SelectionStyleCard({
	model,
	isSelected,
	progressPercent,
	onPress,
}: SelectionStyleCardProps): React.ReactElement {
	const isDownloaded = model.downloadStatus === 'downloaded'
	const isDownloading = model.downloadStatus === 'downloading'
	const [isImageLoaded, setIsImageLoaded] = useState(false)

	const handlePress = useCallback(() => {
		if (isDownloaded) onPress(model.id)
	}, [isDownloaded, model.id, onPress])

	// Spring scale on selection
	const scaleAnim = useRef(new Animated.Value(1)).current
	useEffect(() => {
		Animated.spring(scaleAnim, {
			toValue: isSelected ? 0.96 : 1,
			tension: 200,
			friction: 20,
			useNativeDriver: true,
		}).start()
	}, [isSelected, scaleAnim])

	return (
		<TouchableOpacity
			onPress={handlePress}
			activeOpacity={isDownloaded ? 0.9 : 1}
			style={styles.touchable}
			accessibilityRole="button"
			accessibilityLabel={`Select ${model.name} art style`}
			accessibilityState={{
				selected: isSelected,
				disabled: !isDownloaded,
			}}
		>
			<Animated.View
				style={[
					styles.card,
					isSelected && styles.cardSelected,
					!isDownloaded && styles.cardDisabled,
					{ transform: [{ scale: scaleAnim }] },
				]}
			>
				{/* Thumbnail */}
				<View style={styles.imageContainer}>
					{!isImageLoaded ? <ThumbnailSkeleton /> : null}
					<Image
						source={{ uri: model.thumbnailUrl }}
						style={StyleSheet.absoluteFill}
						contentFit="cover"
						transition={300}
						onLoad={() => setIsImageLoaded(true)}
						cachePolicy="memory-disk"
					/>

					{/* Inference progress overlay */}
					{progressPercent !== null ? (
						<View style={styles.progressOverlay}>
							<View style={styles.progressInner}>
								<ActivityIndicator
									size="small"
									color={Colors.primary}
								/>
								<Text style={styles.progressText}>
									{progressPercent}%
								</Text>
							</View>
							<View style={styles.progressTrack}>
								<View
									style={[
										styles.progressFill,
										{ width: `${progressPercent}%` as any },
									]}
								/>
							</View>
						</View>
					) : null}

					{/* Not-downloaded badge */}
					{!isDownloaded ? (
						<View style={styles.unavailableBadge}>
							{isDownloading ? (
								<Clock
									size={12}
									color={Colors.textMuted}
									strokeWidth={2}
								/>
							) : (
								<Text style={styles.unavailableText}>
									Download
								</Text>
							)}
						</View>
					) : null}

					{/* Selected checkmark */}
					{isSelected && isDownloaded ? (
						<View style={styles.selectedBadge}>
							<CheckCircle2
								size={18}
								color="#FFF"
								strokeWidth={2.5}
							/>
						</View>
					) : null}
				</View>

				{/* Footer */}
				<View style={styles.footer}>
					<Text style={styles.name} numberOfLines={1}>
						{model.name}
					</Text>
					<Text style={styles.size} numberOfLines={1}>
						{isDownloaded ? '✓ Ready' : model.fileSize}
					</Text>
				</View>
			</Animated.View>
		</TouchableOpacity>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	touchable: {
		width: CARD_WIDTH,
		marginBottom: 20,
	},
	card: {
		width: '100%',
		borderRadius: 16,
		overflow: 'hidden',
		backgroundColor: '#FBFBFF',
		borderWidth: 2,
		borderColor: Colors.border,
	},
	cardSelected: {
		borderColor: Colors.primary,
	},
	cardDisabled: {
		opacity: 0.75,
	},
	imageContainer: {
		width: '100%',
		height: CARD_WIDTH,
		aspectRatio: 1,
		backgroundColor: '#F2F2F7',
	},
	progressOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: 'rgba(0,0,0,0.5)',
		justifyContent: 'center',
		alignItems: 'center',
		gap: 8,
		padding: 12,
	},
	progressInner: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	progressText: {
		fontSize: 20,
		fontWeight: '700',
		color: '#FFFFFF',
	},
	progressTrack: {
		width: '80%',
		height: 3,
		backgroundColor: 'rgba(255,255,255,0.3)',
		borderRadius: 2,
		overflow: 'hidden',
	},
	progressFill: {
		height: '100%',
		backgroundColor: Colors.primary,
		borderRadius: 2,
	},
	unavailableBadge: {
		position: 'absolute',
		bottom: 8,
		left: 8,
		backgroundColor: 'rgba(0,0,0,0.55)',
		borderRadius: 8,
		paddingHorizontal: 8,
		paddingVertical: 4,
	},
	unavailableText: {
		fontSize: 10,
		fontWeight: '700',
		color: '#FFFFFF',
	},
	selectedBadge: {
		position: 'absolute',
		top: 8,
		right: 8,
		backgroundColor: Colors.primary,
		borderRadius: 12,
		padding: 2,
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
