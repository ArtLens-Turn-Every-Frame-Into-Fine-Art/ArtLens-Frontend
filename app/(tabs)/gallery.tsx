/**
 * ArtLens — GalleryScreen (v2 — Full Spec Implementation)
 *
 * Dual-section layout:
 *   Section 1 — Active Management Stream (QUEUED / PROCESSING / BATTERY_PAUSED)
 *   Section 2 — Finalized Creation Repository (DONE / ERROR) — 2-column mosaic
 *
 * Features:
 *  - Auto-trigger StyleJobService.processNextJobInQueue() if queue is stalled
 *  - QUEUED tile tap → StyleJobService.prioritizeJob(id)
 *  - PROCESSING tile → live progress ring bound to job.progress
 *  - DONE tile tap → router.push with resultUri + originalUri params
 *  - ERROR tile tap → useStyleJobStore.retryJob(id)
 *  - BATTERY_PAUSED overlay banner
 *  - Clear completed button → clearCompleted()
 *  - getItemLayout for smooth deep-scroll virtualization
 *
 * PRD § 3.7 — GalleryScreen
 * Directory: app/(tabs)/gallery.tsx
 */

import React, { useCallback, useEffect, useMemo } from 'react'
import {
	ActivityIndicator,
	Dimensions,
	FlatList,
	GestureResponderEvent,
	Pressable,
	StyleSheet,
	Text,
	View,
	type ListRenderItem,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Image } from 'expo-image'
import Animated, {
	useSharedValue,
	useAnimatedStyle,
	withRepeat,
	withTiming,
	Easing,
	FadeIn,
} from 'react-native-reanimated'
import {
	AlertCircle,
	Battery,
	CheckCircle2,
	Clock,
	Images,
	RefreshCw,
	Trash2,
	Zap,
	Camera,
} from 'lucide-react-native'
import { createTracker } from '@/shared/utils/logger'

// — Stores ———————————————————————————————————————————————————————————————————
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useModelStore } from '@/shared/stores/useModelStore'

// — Services ——————————————————————————————————————————————————————————————————
import { StyleJobService } from '@/features/style-transfer/StyleJobService'

// — Types ——————————————————————————————————————————————————————————————————————
import type { StyleJob, JobStatus } from '@/types'

const tracker = createTracker('GalleryScreen')

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const C = {
	bg: '#080810',
	surface: '#10101C',
	surfaceHigh: '#181828',
	border: '#1E1E30',
	primary: '#6D28D9',
	primaryMid: '#7C3AED',
	primaryGlow: '#9F67FF',
	text: '#F4F4FF',
	textMuted: '#7070A0',
	textDim: '#40405A',
	success: '#059669',
	downloaded: '#10B981',
	warning: '#D97706',
	error: '#DC2626',
	errorSoft: '#EF4444',
	white: '#FFFFFF',
} as const

const { width: SCREEN_W } = Dimensions.get('window')
const H_PADDING = 16
const COLUMN_GAP = 10
const COLUMNS = 2
const TILE_W = (SCREEN_W - H_PADDING * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS
const TILE_H = TILE_W

// ─────────────────────────────────────────────────────────────────────────────
// STATUS CONFIG
// ─────────────────────────────────────────────────────────────────────────────

interface StatusConfig {
	label: string
	color: string
	Icon: React.ComponentType<{
		color: string
		size: number
		strokeWidth?: number
	}>
}

const STATUS_CONFIG: Record<JobStatus, StatusConfig> = {
	QUEUED: { label: 'Queued', color: C.textMuted, Icon: Clock },
	PROCESSING: { label: 'Working…', color: C.primaryMid, Icon: Zap },
	DONE: { label: 'Done', color: C.downloaded, Icon: CheckCircle2 },
	ERROR: { label: 'Failed', color: C.error, Icon: AlertCircle },
	BATTERY_PAUSED: { label: 'Paused', color: C.warning, Icon: Battery },
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCESSING RING
// ─────────────────────────────────────────────────────────────────────────────

const ProcessingRing = React.memo<{ progress: number }>(({ progress }) => {
	const rotation = useSharedValue(0)

	useEffect(() => {
		rotation.value = withRepeat(
			withTiming(360, { duration: 1200, easing: Easing.linear }),
			-1,
			false
		)
	}, [rotation])

	const spinningStyle = useAnimatedStyle(() => ({
		transform: [{ rotate: `${rotation.value}deg` }],
	}))

	return (
		<View style={styles.ringWrapper}>
			<Animated.View
				style={[styles.progressRingIndicator, spinningStyle]}
			/>
			<Text style={styles.ringPercentText}>
				{Math.round(progress * 100)}%
			</Text>
		</View>
	)
})
ProcessingRing.displayName = 'ProcessingRing'

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE JOB ROW  (QUEUED / PROCESSING / BATTERY_PAUSED)
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveJobRowProps {
	job: StyleJob
	styleName: string
	queuePosition?: number
	onPrioritize: (id: string) => void
}

const ActiveJobRow = React.memo<ActiveJobRowProps>(
	({ job, styleName, queuePosition, onPrioritize }) => {
		const cfg = STATUS_CONFIG[job.status]

		const handlePress = useCallback(() => {
			if (job.status === 'QUEUED') {
				tracker.log('User requesting queue prioritization', {
					jobId: job.id,
				})
				onPrioritize(job.id)
			}
		}, [job.id, job.status, onPrioritize])

		return (
			<Pressable
				onPress={handlePress}
				style={({ pressed }) => [
					styles.activeRow,
					pressed &&
						job.status === 'QUEUED' &&
						styles.activeRowPressed,
				]}
				accessibilityRole="button"
				accessibilityLabel={`${styleName} — ${cfg.label}${job.status === 'QUEUED' ? '. Tap to process now.' : ''}`}
			>
				{/* Thumbnail */}
				<View style={styles.activeRowThumb}>
					<Image
						source={{ uri: job.sourceUri }}
						style={styles.activeRowThumbImage}
						contentFit="cover"
						cachePolicy="disk"
						transition={200}
					/>
					{/* PROCESSING ring overlay on thumb */}
					{job.status === 'PROCESSING' && (
						<View style={styles.activeRowThumbOverlay}>
							<ProcessingRing progress={job.progress} />
						</View>
					)}
					{/* BATTERY_PAUSED icon on thumb */}
					{job.status === 'BATTERY_PAUSED' && (
						<View style={styles.activeRowThumbOverlay}>
							<Battery
								color={C.warning}
								size={20}
								strokeWidth={2}
							/>
						</View>
					)}
				</View>

				{/* Info Content Section */}
				<View style={styles.activeRowInfo}>
					<View style={styles.activeRowHeader}>
						<cfg.Icon color={cfg.color} size={12} strokeWidth={2} />
						<Text
							style={[
								styles.activeRowStatus,
								{ color: cfg.color },
							]}
						>
							{cfg.label}
						</Text>
						{queuePosition !== undefined &&
							job.status === 'QUEUED' && (
								<Text style={styles.activeRowQueueNum}>
									#{queuePosition}
								</Text>
							)}
					</View>

					<Text style={styles.activeRowStyleName} numberOfLines={1}>
						{styleName}
					</Text>

					{/* Progress bar — shown for PROCESSING */}
					{job.status === 'PROCESSING' && (
						<View style={styles.progressBarTrack}>
							<Animated.View
								style={[
									styles.progressBarFill,
									{
										width: `${Math.round(job.progress * 100)}%`,
									},
								]}
							/>
						</View>
					)}

					{/* BATTERY_PAUSED warning */}
					{job.status === 'BATTERY_PAUSED' && (
						<Text style={styles.batteryWarning} numberOfLines={1}>
							Low battery system lock
						</Text>
					)}

					{/* QUEUED process-now hint */}
					{job.status === 'QUEUED' && (
						<Text style={styles.activeRowHint}>
							Tap to bump up priority
						</Text>
					)}
				</View>
			</Pressable>
		)
	}
)
ActiveJobRow.displayName = 'ActiveJobRow'

// ─────────────────────────────────────────────────────────────────────────────
// FINALIZED TILE  (DONE / ERROR)
// ─────────────────────────────────────────────────────────────────────────────

interface FinalizedTileProps {
	job: StyleJob
	styleName: string
	onPressDone: (job: StyleJob) => void
	onRetry: (id: string) => void
}

const FinalizedTile = React.memo<FinalizedTileProps>(
	({ job, styleName, onPressDone, onRetry }) => {
		const handlePress = useCallback(() => {
			if (job.status === 'DONE') {
				onPressDone(job)
			} else if (job.status === 'ERROR') {
				onRetry(job.id)
			}
		}, [job, onPressDone, onRetry])

		const handleRetryDirect = useCallback(
			(e: GestureResponderEvent) => {
				e.stopPropagation?.()
				tracker.log('Retry button tapped on error tile', {
					jobId: job.id,
				})
				onRetry(job.id)
			},
			[job.id, onRetry]
		)

		// DONE → show resultUri; ERROR → show desaturated sourceUri
		const displayUri = job.status === 'DONE' ? job.resultUri : job.sourceUri

		const cfg = STATUS_CONFIG[job.status]

		return (
			<Pressable
				onPress={handlePress}
				style={({ pressed }) => [
					styles.tile,
					pressed && styles.tilePressed,
				]}
				accessibilityRole="button"
				accessibilityLabel={`${styleName} — ${cfg.label}`}
			>
				<Image
					source={{ uri: displayUri }}
					style={[
						styles.tileImage,
						job.status === 'ERROR' && styles.tileImageError,
					]}
					contentFit="cover"
					cachePolicy="disk"
					transition={200}
					accessibilityLabel={`${styleName} stylized photo`}
				/>

				{/* ERROR overlay */}
				{job.status === 'ERROR' && (
					<View style={styles.errorOverlay}>
						<AlertCircle
							color={C.errorSoft}
							size={24}
							strokeWidth={1.5}
						/>
						<Text style={styles.errorOverlayLabel}>Failed</Text>
						{job.errorMessage && (
							<Text
								style={styles.errorOverlayMessage}
								numberOfLines={2}
							>
								{job.errorMessage}
							</Text>
						)}
						{job.retryable && (
							<Pressable
								onPress={handleRetryDirect}
								style={styles.retryButton}
								accessibilityRole="button"
								accessibilityLabel="Retry stylization"
							>
								<RefreshCw
									color={C.white}
									size={12}
									strokeWidth={2}
								/>
								<Text style={styles.retryText}>Retry</Text>
							</Pressable>
						)}
					</View>
				)}

				{/* Bottom info strip */}
				<View style={styles.tileFooter}>
					<cfg.Icon color={cfg.color} size={11} strokeWidth={2} />
					<Text
						style={[styles.tileStatus, { color: cfg.color }]}
						numberOfLines={1}
					>
						{cfg.label}
					</Text>
					<Text style={styles.tileStyleName} numberOfLines={1}>
						· {styleName}
					</Text>
				</View>
			</Pressable>
		)
	}
)
FinalizedTile.displayName = 'FinalizedTile'

// ─────────────────────────────────────────────────────────────────────────────
// SECTION HEADER
// ─────────────────────────────────────────────────────────────────────────────

interface SectionHeaderProps {
	title: string
	count: number
	action?: { label: string; onPress: () => void; icon?: React.ReactNode }
}

const SectionHeader = React.memo<SectionHeaderProps>(
	({ title, count, action }) => (
		<View style={styles.sectionHeader}>
			<View style={styles.sectionHeaderLeft}>
				<Text style={styles.sectionTitle}>{title}</Text>
				<View style={styles.sectionCount}>
					<Text style={styles.sectionCountText}>{count}</Text>
				</View>
			</View>
			{action && (
				<Pressable
					onPress={action.onPress}
					style={styles.sectionAction}
					accessibilityRole="button"
					accessibilityLabel={action.label}
					hitSlop={10}
				>
					{action.icon}
					<Text style={styles.sectionActionText}>{action.label}</Text>
				</Pressable>
			)}
		</View>
	)
)
SectionHeader.displayName = 'SectionHeader'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function GalleryScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// ── Zustand selectors (atomic) ────────────────────────────────────────────
	const jobs = useStyleJobStore((s) => s.jobs)
	const retryJob = useStyleJobStore((s) => s.retryJob)
	const clearCompleted = useStyleJobStore((s) => s.clearCompleted)
	const catalog = useModelStore((s) => s.catalog)

	// Derived Streams
	const activeJobs = useMemo<StyleJob[]>(() => {
		const active = jobs.filter((j) =>
			['QUEUED', 'PROCESSING', 'BATTERY_PAUSED'].includes(j.status)
		)
		const order: Record<JobStatus, number> = {
			PROCESSING: 0,
			QUEUED: 1,
			BATTERY_PAUSED: 2,
			DONE: 3,
			ERROR: 4,
		}
		return [...active].sort((a, b) => {
			const diff = order[a.status] - order[b.status]
			if (diff !== 0) return diff
			return a.createdAt - b.createdAt
		})
	}, [jobs])

	const finalizedJobs = useMemo<StyleJob[]>(() => {
		const finalized = jobs.filter((j) =>
			['DONE', 'ERROR'].includes(j.status)
		)
		return [...finalized].sort((a, b) => b.createdAt - a.createdAt)
	}, [jobs])

	const systemBatteryPaused = useMemo(
		() => activeJobs.some((j) => j.status === 'BATTERY_PAUSED'),
		[activeJobs]
	)

	const queuePositions = useMemo<Record<string, number>>(() => {
		const queued = activeJobs.filter((j) => j.status === 'QUEUED')
		const map: Record<string, number> = {}
		queued.forEach((j, i) => {
			map[j.id] = i + 1
		})
		return map
	}, [activeJobs])

	const styleNameMap = useMemo<Record<string, string>>(() => {
		const map: Record<string, string> = {}
		catalog.forEach((m) => {
			map[m.id] = m.name
		})
		return map
	}, [catalog])

	// Auto worker trigger pipeline optimization
	const jobStatusFingerprint = useMemo(
		() => jobs.map((j) => j.status).join(','),
		[jobs]
	)

	useEffect(() => {
		const hasQueued = jobs.some((j) => j.status === 'QUEUED')
		const activeJobId = StyleJobService.getActiveJobId()

		if (hasQueued && activeJobId === null) {
			tracker.log(
				'Stalled queue detected on GalleryScreen — structural kickstart triggered'
			)
			void StyleJobService.processNextJobInQueue()
		}
	}, [jobStatusFingerprint, jobs])

	// Actions
	const handlePrioritize = useCallback((id: string) => {
		tracker.log('Prioritizing job from gallery active stream', {
			jobId: id,
		})
		StyleJobService.prioritizeJob(id)
		void StyleJobService.processNextJobInQueue()
	}, [])

	const handlePressDone = useCallback((job: StyleJob) => {
		tracker.log('Routing to edit-canvas from finalized gallery tile', {
			jobId: job.id,
		})
		router.push({
			pathname: '/(screens)/edit-canvas',
			params: {
				jobId: job.id,
				resultUri: job.resultUri ?? '',
				originalUri: job.sourceUri,
			},
		})
	}, [])

	const handleRetry = useCallback(
		(id: string) => {
			tracker.log('Retrying failed job from gallery', { jobId: id })
			retryJob(id)
			void StyleJobService.processNextJobInQueue()
		},
		[retryJob]
	)

	const handleClearCompleted = useCallback(() => {
		tracker.log('Clearing completed and errored jobs from gallery')
		clearCompleted()
	}, [clearCompleted])

	const handleGoToCamera = useCallback(() => {
		router.push('/(tabs)/camera')
	}, [])

	// Native Component Grid Flattening Renders to protect virtualization
	const renderFinalizedTile = useCallback<ListRenderItem<StyleJob>>(
		({ item }) => (
			<FinalizedTile
				job={item}
				styleName={styleNameMap[item.styleId] ?? 'Unknown style'}
				onPressDone={handlePressDone}
				onRetry={handleRetry}
			/>
		),
		[styleNameMap, handlePressDone, handleRetry]
	)

	const totalJobs = jobs.length
	const processingCount = activeJobs.filter(
		(j) => j.status === 'PROCESSING' || j.status === 'QUEUED'
	).length

	// ── Virtualization Correction Strategy ───────────────────────────────────
	// Build a unified layout model inside a standard top-level FlatList pipeline.
	// This allows active rows and finalized columns to coexist without list nesting alerts.
	return (
		<View style={[styles.screen, { backgroundColor: C.bg }]}>
			{/* BATTERY_PAUSED Full-screen Contextual Top Banner */}
			{systemBatteryPaused && (
				<Animated.View
					entering={FadeIn.duration(200)}
					style={[
						styles.globalWarningBanner,
						{ paddingTop: insets.top + 8 },
					]}
				>
					<Battery color={C.white} size={14} strokeWidth={2.5} />
					<Text style={styles.globalWarningText}>
						Background Pipeline Paused — Battery Critical
					</Text>
				</Animated.View>
			)}

			<FlatList
				data={finalizedJobs}
				renderItem={renderFinalizedTile}
				keyExtractor={(item) => item.id}
				numColumns={COLUMNS}
				columnWrapperStyle={
					finalizedJobs.length > 0 ? styles.columnWrapper : undefined
				}
				removeClippedSubviews={true}
				maxToRenderPerBatch={10}
				initialNumToRender={12}
				contentContainerStyle={{
					paddingTop: systemBatteryPaused
						? insets.top + 52
						: insets.top + 16,
					paddingBottom: insets.bottom + 100,
				}}
				getItemLayout={(_, index) => {
					const rowIndex = Math.floor(index / COLUMNS)
					return {
						length: TILE_H + COLUMN_GAP,
						offset: rowIndex * (TILE_H + COLUMN_GAP),
						index,
					}
				}}
				ListHeaderComponent={
					<View style={styles.listHeaderContainer}>
						{/* Title Bar Header */}
						<View style={styles.pageHeader}>
							<View style={styles.pageHeaderLeft}>
								<Images
									color={C.primaryMid}
									size={22}
									strokeWidth={1.6}
								/>
								<Text style={styles.pageTitle}>Gallery</Text>
							</View>
							<View style={styles.pageHeaderRight}>
								{processingCount > 0 && (
									<View style={styles.processingPill}>
										<ActivityIndicator
											color={C.primaryMid}
											size="small"
										/>
										<Text style={styles.processingPillText}>
											{processingCount} workers active
										</Text>
									</View>
								)}
							</View>
						</View>

						{/* Stream Section 1 Rendering */}
						{activeJobs.length > 0 && (
							<View style={styles.headerSectionBlock}>
								<SectionHeader
									title="Processing Pipeline"
									count={activeJobs.length}
								/>
								<View style={styles.activeList}>
									{activeJobs.map((job) => (
										<ActiveJobRow
											key={job.id}
											job={job}
											styleName={
												styleNameMap[job.styleId] ??
												'Unknown style'
											}
											queuePosition={
												queuePositions[job.id]
											}
											onPrioritize={handlePrioritize}
										/>
									))}
								</View>
							</View>
						)}

						{/* Stream Section 2 Header Anchor Label */}
						{finalizedJobs.length > 0 && (
							<View style={styles.headerSectionBlock}>
								<SectionHeader
									title="Your Artwork"
									count={finalizedJobs.length}
									action={{
										label: 'Clear All',
										onPress: handleClearCompleted,
										icon: (
											<Trash2
												color={C.textMuted}
												size={13}
												strokeWidth={2}
											/>
										),
									}}
								/>
							</View>
						)}
					</View>
				}
				ListEmptyComponent={
					totalJobs === 0 ? (
						<View style={styles.emptyState}>
							<Images
								color={C.textDim}
								size={56}
								strokeWidth={1}
							/>
							<Text style={styles.emptyTitle}>
								No artwork yet
							</Text>
							<Text style={styles.emptySub}>
								Capture your first photo or select an image to
								render fine art translations on device.
							</Text>
							<Pressable
								onPress={handleGoToCamera}
								style={styles.emptyButton}
								accessibilityRole="button"
							>
								<Camera
									color={C.white}
									size={16}
									strokeWidth={2}
								/>
								<Text style={styles.emptyButtonText}>
									Open Camera
								</Text>
							</Pressable>
						</View>
					) : null
				}
			/>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLESHEET
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: {
		flex: 1,
	},
	globalWarningBanner: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		backgroundColor: C.warning,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 6,
		paddingBottom: 8,
		zIndex: 999,
	},
	globalWarningText: {
		color: C.white,
		fontSize: 12,
		fontWeight: '700',
	},
	listHeaderContainer: {
		paddingHorizontal: H_PADDING,
		marginBottom: 8,
	},
	headerSectionBlock: {
		marginTop: 20,
	},
	pageHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingVertical: 12,
	},
	pageHeaderLeft: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	pageTitle: {
		fontSize: 26,
		fontWeight: '800',
		color: C.text,
		letterSpacing: -0.5,
	},
	pageHeaderRight: {
		justifyContent: 'center',
	},
	processingPill: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: C.surface,
		paddingHorizontal: 10,
		paddingVertical: 6,
		borderRadius: 20,
		borderWidth: 1,
		borderColor: C.border,
		gap: 6,
	},
	processingPillText: {
		color: C.textMuted,
		fontSize: 12,
		fontWeight: '600',
	},
	sectionHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 12,
	},
	sectionHeaderLeft: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	sectionTitle: {
		fontSize: 16,
		fontWeight: '700',
		color: C.text,
	},
	sectionCount: {
		backgroundColor: C.surfaceHigh,
		paddingHorizontal: 7,
		paddingVertical: 2,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: C.border,
	},
	sectionCountText: {
		color: C.textMuted,
		fontSize: 11,
		fontWeight: '700',
	},
	sectionAction: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
	},
	sectionActionText: {
		color: C.textMuted,
		fontSize: 13,
		fontWeight: '600',
	},
	activeList: {
		gap: 10,
	},
	activeRow: {
		flexDirection: 'row',
		backgroundColor: C.surface,
		borderRadius: 14,
		borderWidth: 1,
		borderColor: C.border,
		padding: 10,
		gap: 12,
	},
	activeRowPressed: {
		borderColor: C.primaryMid,
	},
	activeRowThumb: {
		width: 64,
		height: 64,
		borderRadius: 10,
		overflow: 'hidden',
		backgroundColor: C.bg,
	},
	activeRowThumbImage: {
		width: '100%',
		height: '100%',
	},
	activeRowThumbOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: 'rgba(8, 8, 16, 0.72)',
		alignItems: 'center',
		justifyContent: 'center',
	},
	activeRowInfo: {
		flex: 1,
		justifyContent: 'center',
	},
	activeRowHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		marginBottom: 2,
	},
	activeRowStatus: {
		fontSize: 11,
		fontWeight: '700',
		textTransform: 'uppercase',
		letterSpacing: 0.5,
	},
	activeRowQueueNum: {
		color: C.textDim,
		fontSize: 11,
		fontWeight: '700',
		marginLeft: 'auto',
	},
	activeRowStyleName: {
		color: C.text,
		fontSize: 15,
		fontWeight: '600',
		marginBottom: 6,
	},
	progressBarTrack: {
		height: 4,
		backgroundColor: C.surfaceHigh,
		borderRadius: 2,
		overflow: 'hidden',
	},
	progressBarFill: {
		height: '100%',
		backgroundColor: C.primaryMid,
		borderRadius: 2,
	},
	batteryWarning: {
		color: C.warning,
		fontSize: 12,
		fontWeight: '500',
	},
	activeRowHint: {
		color: C.textMuted,
		fontSize: 12,
		fontStyle: 'italic',
	},
	columnWrapper: {
		paddingHorizontal: H_PADDING,
		justifyContent: 'space-between',
		marginBottom: COLUMN_GAP,
	},
	tile: {
		width: TILE_W,
		height: TILE_H,
		backgroundColor: C.surface,
		borderRadius: 16,
		borderWidth: 1,
		borderColor: C.border,
		overflow: 'hidden',
	},
	tilePressed: {
		opacity: 0.85,
		borderColor: C.primaryGlow,
	},
	tileImage: {
		width: '100%',
		height: '100%',
	},
	tileImageError: {
		opacity: 0.2,
	},
	errorOverlay: {
		...StyleSheet.absoluteFillObject,
		alignItems: 'center',
		justifyContent: 'center',
		padding: 12,
	},
	errorOverlayLabel: {
		color: C.errorSoft,
		fontSize: 14,
		fontWeight: '700',
		marginTop: 4,
	},
	errorOverlayMessage: {
		color: C.textMuted,
		fontSize: 11,
		textAlign: 'center',
		marginTop: 2,
		marginBottom: 8,
	},
	retryButton: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: C.surfaceHigh,
		borderWidth: 1,
		borderColor: C.border,
		paddingHorizontal: 10,
		paddingVertical: 5,
		borderRadius: 10,
		gap: 4,
	},
	retryText: {
		color: C.white,
		fontSize: 11,
		fontWeight: '700',
	},
	tileFooter: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: 'rgba(16, 16, 28, 0.85)',
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: 'rgba(30, 30, 48, 0.5)',
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 10,
		height: 30,
		gap: 4,
	},
	tileStatus: {
		fontSize: 11,
		fontWeight: '700',
	},
	tileStyleName: {
		color: C.text,
		fontSize: 11,
		fontWeight: '500',
		flex: 1,
	},
	emptyState: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: 40,
		marginTop: 80,
	},
	emptyTitle: {
		color: C.text,
		fontSize: 18,
		fontWeight: '700',
		marginTop: 16,
		marginBottom: 6,
	},
	emptySub: {
		color: C.textMuted,
		fontSize: 14,
		textAlign: 'center',
		lineHeight: 20,
		marginBottom: 24,
	},
	emptyButton: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: C.primaryMid,
		paddingHorizontal: 18,
		height: 44,
		borderRadius: 12,
		gap: 8,
	},
	emptyButtonText: {
		color: C.white,
		fontSize: 15,
		fontWeight: '700',
	},
	ringWrapper: {
		width: 44,
		height: 44,
		alignItems: 'center',
		justifyContent: 'center',
	},
	progressRingIndicator: {
		position: 'absolute',
		width: 36,
		height: 36,
		borderRadius: 18,
		borderWidth: 3,
		borderColor: C.primaryMid,
		borderTopColor: 'transparent',
	},
	ringPercentText: {
		color: C.white,
		fontSize: 10,
		fontWeight: '800',
	},
})
