/**
 * @file features/gallery/components/ActiveJobRow.tsx
 * @description Card row for an in-flight job (QUEUED, PROCESSING, BATTERY_PAUSED).
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────┐
 *   │  [72×72 thumb]  status • style name • timestamp │ [✕/⏹ btn] │
 *   │                 progress bar / hint text         │           │
 *   └─────────────────────────────────────────────────┘
 *
 * Tap the row (QUEUED only) → bumps to front of queue.
 * The cancel/stop button is a separate pressable OUTSIDE the row Pressable so
 * React Native's responder chain never swallows it. stopPropagation on
 * GestureResponderEvent is a no-op in RN — the only reliable way to have a
 * nested tappable is to lift it out of the parent Pressable entirely.
 */

import React, { useCallback } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { Battery, StopCircle, X } from 'lucide-react-native'
import { createTracker } from '@/shared/utils/logger'
import type { StyleJob } from '@/types'
import { ProcessingRing } from './ProcessingRing'
import { STATUS_CONFIG } from './statusConfig'
import { Colors } from '@/shared/ui'

const tracker = createTracker('ActiveJobRow')

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatRelative(ts: number): string {
	const diff = Date.now() - ts
	if (diff < 60_000) return 'just now'
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
	return `${Math.floor(diff / 86_400_000)}d ago`
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveJobRowProps {
	job: StyleJob
	styleName: string
	/** 1-based queue position shown next to the status label for QUEUED jobs. */
	queuePosition?: number
	onPrioritize: (id: string) => void
	onCancel: (id: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const ActiveJobRow = React.memo<ActiveJobRowProps>(
	({ job, styleName, queuePosition, onPrioritize, onCancel }) => {
		const cfg = STATUS_CONFIG[job.status]
		const isStoppable =
			job.status === 'PROCESSING' || job.status === 'BATTERY_PAUSED'
		const showCancelBtn =
			job.status === 'QUEUED' ||
			job.status === 'PROCESSING' ||
			job.status === 'BATTERY_PAUSED'

		// Tapping the row body only does something for QUEUED jobs (prioritize).
		// PROCESSING / BATTERY_PAUSED rows are informational — no tap action.
		const handleRowPress = useCallback(() => {
			if (job.status !== 'QUEUED') return
			tracker.log('Prioritizing job from active row', { jobId: job.id })
			onPrioritize(job.id)
		}, [job.id, job.status, onPrioritize])

		// Cancel / stop — plain callback, no event parameter.
		// The button is rendered OUTSIDE the row Pressable so RN's responder
		// chain cannot swallow the event (stopPropagation is a no-op in RN).
		const handleCancelPress = useCallback(() => {
			if (isStoppable) {
				Alert.alert(
					'Stop Processing?',
					`Inference for "${styleName}" will be interrupted at the next tile boundary and the job removed.`,
					[
						{ text: 'Keep Running', style: 'cancel' },
						{
							text: 'Stop',
							style: 'destructive',
							onPress: () => {
								tracker.log('User stopped active/paused job', {
									jobId: job.id,
								})
								onCancel(job.id)
							},
						},
					]
				)
			} else {
				Alert.alert(
					'Cancel Job',
					`Remove "${styleName}" from the queue?`,
					[
						{ text: 'Keep', style: 'cancel' },
						{
							text: 'Cancel Job',
							style: 'destructive',
							onPress: () => {
								tracker.log('User cancelled queued job', {
									jobId: job.id,
								})
								onCancel(job.id)
							},
						},
					]
				)
			}
		}, [job.id, isStoppable, styleName, onCancel])

		return (
			<Animated.View
				entering={FadeInDown.duration(220).springify()}
				style={styles.wrapper}
			>
				{/* ── Row body (tappable for QUEUED only) ─────────────────────── */}
				<Pressable
					onPress={handleRowPress}
					style={({ pressed }) => [
						styles.row,
						pressed && job.status === 'QUEUED' && styles.rowPressed,
					]}
					accessibilityRole="button"
					accessibilityLabel={`${styleName} — ${cfg.label}${job.status === 'QUEUED' ? ', tap to prioritise' : ''}`}
				>
					{/* Thumbnail + status overlay */}
					<View style={styles.thumb}>
						<Image
							source={{ uri: job.sourceUri }}
							style={styles.thumbImage}
							contentFit="cover"
							cachePolicy="disk"
							transition={200}
						/>
						{job.status === 'PROCESSING' && (
							<View style={styles.thumbOverlay}>
								<ProcessingRing progress={job.progress} />
							</View>
						)}
						{job.status === 'BATTERY_PAUSED' && (
							<View style={styles.thumbOverlay}>
								<Battery
									color={Colors.warning}
									size={22}
									strokeWidth={2}
								/>
							</View>
						)}
					</View>

					{/* Info column */}
					<View style={styles.info}>
						<View style={styles.statusRow}>
							<cfg.Icon
								color={cfg.color}
								size={13}
								strokeWidth={2}
							/>
							<Text
								style={[
									styles.statusLabel,
									{ color: cfg.color },
								]}
							>
								{cfg.label}
							</Text>
							{queuePosition !== undefined &&
								job.status === 'QUEUED' && (
									<Text style={styles.queueNum}>
										#{queuePosition}
									</Text>
								)}
						</View>

						<Text style={styles.styleName} numberOfLines={1}>
							{styleName}
						</Text>

						<Text style={styles.timestamp}>
							{formatRelative(job.createdAt)}
						</Text>

						{job.status === 'PROCESSING' && (
							<View style={styles.progressTrack}>
								<View
									style={[
										styles.progressFill,
										{
											width: `${Math.round(job.progress * 100)}%` as any,
										},
									]}
								/>
							</View>
						)}
						{job.status === 'BATTERY_PAUSED' && (
							<Text style={styles.batteryHint}>
								Low battery — auto-resume when charging
							</Text>
						)}
						{job.status === 'QUEUED' && (
							<Text style={styles.hint}>
								Tap to bump to front
							</Text>
						)}
					</View>
				</Pressable>

				{/* ── Cancel / Stop button — outside the row Pressable ─────────
				    Placing it here means RN assigns it its own responder, so it
				    always fires independently of the row tap handler.             */}
				{showCancelBtn && (
					<Pressable
						onPress={handleCancelPress}
						style={({ pressed }) => [
							styles.cancelBtn,
							isStoppable && styles.cancelBtnStop,
							pressed && styles.cancelBtnPressed,
						]}
						hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
						accessibilityRole="button"
						accessibilityLabel={
							isStoppable ? 'Stop inference' : 'Cancel job'
						}
					>
						{isStoppable ? (
							<StopCircle
								color={Colors.errorDeep}
								size={16}
								strokeWidth={2}
							/>
						) : (
							<X
								color={Colors.textMuted}
								size={16}
								strokeWidth={2}
							/>
						)}
					</Pressable>
				)}
			</Animated.View>
		)
	}
)
ActiveJobRow.displayName = 'ActiveJobRow'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	// Outer wrapper holds the row body + cancel button side-by-side as siblings,
	// not parent-child. This is the key to reliable cancel button hit detection.
	wrapper: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: Colors.surface,
		borderRadius: 14,
		marginBottom: 10,
		overflow: 'hidden',
		// Subtle shadow to give each row a card feel
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.06,
		shadowRadius: 4,
		elevation: 2,
	},

	// Row body fills all available width left of the cancel button
	row: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		paddingLeft: 14,
		paddingVertical: 12,
		gap: 12,
	},
	rowPressed: {
		backgroundColor: Colors.surfaceHigh,
	},

	// Thumbnail — larger than before so the overlay content breathes
	thumb: {
		width: 72,
		height: 72,
		borderRadius: 10,
		overflow: 'hidden',
		backgroundColor: Colors.surfaceHigh,
	},
	thumbImage: {
		width: '100%',
		height: '100%',
	},
	thumbOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: 'rgba(0,0,0,0.48)',
		justifyContent: 'center',
		alignItems: 'center',
	},

	// Info column
	info: {
		flex: 1,
	},
	statusRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 5,
		marginBottom: 3,
	},
	statusLabel: {
		fontSize: 11,
		fontWeight: '700',
		textTransform: 'uppercase',
		letterSpacing: 0.5,
	},
	queueNum: {
		fontSize: 11,
		color: Colors.textMuted,
		fontWeight: '600',
		marginLeft: 2,
	},
	styleName: {
		fontSize: 15,
		fontWeight: '700',
		color: Colors.text,
		marginBottom: 2,
	},
	timestamp: {
		fontSize: 12,
		color: Colors.textMuted,
		marginBottom: 5,
	},
	progressTrack: {
		height: 4,
		backgroundColor: Colors.borderSubtle,
		borderRadius: 2,
		overflow: 'hidden',
	},
	progressFill: {
		height: '100%',
		backgroundColor: Colors.primary,
		borderRadius: 2,
	},
	batteryHint: {
		fontSize: 12,
		color: Colors.warning,
		fontWeight: '500',
	},
	hint: {
		fontSize: 12,
		color: Colors.textDim,
	},

	// Cancel / Stop button — sits as a sibling to the row Pressable
	cancelBtn: {
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: Colors.surfaceHigh,
		justifyContent: 'center',
		alignItems: 'center',
		marginRight: 12,
		// Don't shrink — always show this button regardless of info text length
		flexShrink: 0,
	},
	cancelBtnStop: {
		backgroundColor: '#FFF0F0',
	},
	cancelBtnPressed: {
		opacity: 0.7,
	},
})
