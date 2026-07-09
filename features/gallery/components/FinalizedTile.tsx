/**
 * @file features/gallery/components/FinalizedTile.tsx
 * @description Grid tile for a completed (DONE) or failed (ERROR) job.
 *
 * Sizing contract:
 *   The parent (GalleryScreen) passes an explicit `tileWidth` in pixels.
 *   The tile fills that exact width and renders a square image via `aspectRatio: 1`.
 *   Using an explicit pixel width is the reliable way to size items in a
 *   React Native numColumns FlatList — relying on flex/percentage widths inside
 *   a columnWrapper can break when contentContainerStyle adds horizontal padding.
 *
 * Interactions:
 *   - DONE: tap → edit-canvas, long-press → action sheet (Open & Edit / Delete)
 *   - ERROR: tap → retry, retryable button also inline on the error overlay
 *   - Entrance animation staggered by index to avoid a wall-of-tiles flash.
 */

import React, { useCallback } from 'react'
import {
	Alert,
	GestureResponderEvent,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { Image } from 'expo-image'
import Animated, { FadeIn } from 'react-native-reanimated'
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react-native'
import type { StyleJob } from '@/types'
import { Colors } from '@/shared/ui'
import { STATUS_CONFIG } from './statusConfig'

const MAX_STAGGER_MS = 400

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface FinalizedTileProps {
	job: StyleJob
	styleName: string
	/** Position in the finalized list — used to stagger FadeIn. */
	index: number
	/**
	 * Explicit pixel width for this tile.
	 * Must be computed by the parent as:
	 *   (SCREEN_W - H_PADDING * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS
	 */
	tileWidth: number
	onPressDone: (job: StyleJob) => void
	onRetry: (id: string) => void
	onDelete: (id: string, styleName: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const FinalizedTile = React.memo<FinalizedTileProps>(
	({ job, styleName, index, tileWidth, onPressDone, onRetry, onDelete }) => {
		const cfg = STATUS_CONFIG[job.status]
		const displayUri = job.status === 'DONE' ? job.resultUri : job.sourceUri
		const delay = Math.min(index * 40, MAX_STAGGER_MS)

		const handlePress = useCallback(() => {
			if (job.status === 'DONE') onPressDone(job)
			else if (job.status === 'ERROR') onRetry(job.id)
		}, [job, onPressDone, onRetry])

		const handleLongPress = useCallback(() => {
			if (job.status !== 'DONE') return
			Alert.alert(
				styleName,
				'What would you like to do with this artwork?',
				[
					{ text: 'Cancel', style: 'cancel' },
					{ text: 'Open & Edit', onPress: () => onPressDone(job) },
					{
						text: 'Delete',
						style: 'destructive',
						onPress: () => onDelete(job.id, styleName),
					},
				]
			)
		}, [job, styleName, onPressDone, onDelete])

		const handleRetryDirect = useCallback(
			(e: GestureResponderEvent) => {
				e.stopPropagation?.()
				onRetry(job.id)
			},
			[job.id, onRetry]
		)

		return (
			<Animated.View
				entering={FadeIn.delay(delay).duration(300)}
				style={{ width: tileWidth }}
			>
				<Pressable
					onPress={handlePress}
					onLongPress={handleLongPress}
					delayLongPress={380}
					style={({ pressed }) => [
						styles.tile,
						pressed && styles.tilePressed,
					]}
					accessibilityRole="button"
					accessibilityLabel={`${styleName} — ${cfg.label}`}
				>
					{/* Square thumbnail — height driven by aspectRatio on a fixed width */}
					<Image
						source={{ uri: displayUri }}
						style={[
							styles.image,
							job.status === 'ERROR' && styles.imageError,
						]}
						contentFit="cover"
						cachePolicy="disk"
						transition={200}
					/>

					{job.status === 'ERROR' && (
						<View style={styles.errorOverlay}>
							<AlertCircle
								color={Colors.errorSoft}
								size={24}
								strokeWidth={1.5}
							/>
							<Text style={styles.errorLabel}>Failed</Text>
							{job.errorMessage ? (
								<Text
									style={styles.errorMessage}
									numberOfLines={2}
								>
									Image size or filetype not supported.
								</Text>
							) : null}
							{job.retryable ? (
								<Pressable
									onPress={handleRetryDirect}
									style={styles.retryBtn}
									accessibilityRole="button"
									accessibilityLabel="Retry stylization"
								>
									<RefreshCw
										color={Colors.white}
										size={12}
										strokeWidth={2}
									/>
									<Text style={styles.retryText}>Retry</Text>
								</Pressable>
							) : null}
						</View>
					)}

					{/* Translucent footer strip: status + style name */}
					<View style={styles.footer}>
						<cfg.Icon color={cfg.color} size={11} strokeWidth={2} />
						<Text
							style={[styles.statusText, { color: cfg.color }]}
							numberOfLines={1}
						>
							{cfg.label}
						</Text>
						<Text style={styles.styleNameText} numberOfLines={1}>
							· {styleName}
						</Text>
					</View>

					{job.status === 'DONE' ? (
						<View style={styles.doneBadge}>
							<CheckCircle2
								color={Colors.successLegacy}
								size={14}
								strokeWidth={2}
								fill={`${Colors.successLegacy}30`}
							/>
						</View>
					) : null}
				</Pressable>
			</Animated.View>
		)
	}
)
FinalizedTile.displayName = 'FinalizedTile'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	tile: {
		width: '100%',
		borderRadius: 14,
		overflow: 'hidden',
		backgroundColor: Colors.surfaceHigh,
	},
	tilePressed: {
		opacity: 0.88,
	},
	// Width is 100% of the Animated.View which has an explicit pixel width
	// from the tileWidth prop. aspectRatio: 1 makes it square.
	image: {
		width: '100%',
		aspectRatio: 1,
	},
	imageError: {
		opacity: 0.35,
	},
	errorOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: 'rgba(0,0,0,0.55)',
		justifyContent: 'center',
		alignItems: 'center',
		gap: 6,
		padding: 12,
	},
	errorLabel: {
		fontSize: 13,
		fontWeight: '700',
		color: Colors.white,
	},
	errorMessage: {
		fontSize: 11,
		color: Colors.textDim,
		textAlign: 'center',
	},
	retryBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		backgroundColor: Colors.errorDeep,
		borderRadius: 8,
		paddingHorizontal: 10,
		paddingVertical: 5,
		marginTop: 4,
	},
	retryText: {
		fontSize: 12,
		fontWeight: '700',
		color: Colors.white,
	},
	footer: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		paddingHorizontal: 8,
		paddingVertical: 7,
		backgroundColor: 'rgba(0,0,0,0.45)',
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
	},
	statusText: {
		fontSize: 10,
		fontWeight: '600',
	},
	styleNameText: {
		fontSize: 10,
		color: Colors.textDim,
		flex: 1,
	},
	doneBadge: {
		position: 'absolute',
		top: 8,
		right: 8,
		backgroundColor: 'rgba(255,255,255,0.9)',
		borderRadius: 10,
		padding: 2,
	},
})
