/**
 * ArtLens — GalleryScreen
 *
 * NEW vs v2:
 *  - Filter dropdown: filter finalized grid by styleId (real popover state)
 *  - Sort dropdown: sort finalized by "Newest" | "Oldest" | "Name"
 *  - Cancel (removeJob) button on QUEUED rows — X icon on right side
 *  - Long-press on DONE tile → Alert with "Delete" option (removeJob)
 *  - Tile footer shows relative timestamp (e.g. "3h ago")
 *  - Stats pills wired: Total / Done / In Progress / Favorite
 *  - Battery-paused banner also shows resume ETA copy
 *  - FadeInDown entrance animation on finalized tiles (stagger via index)
 *  - Active row shows cancel ("×") for QUEUED jobs
 *
 * Directory: app/(tabs)/gallery.tsx
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Dimensions,
	FlatList,
	GestureResponderEvent,
	Modal,
	Pressable,
	ScrollView,
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
	FadeInDown,
	FadeInUp,
} from 'react-native-reanimated'
import {
	AlertCircle,
	Battery,
	CheckCircle2,
	ChevronDown,
	Clock,
	Images,
	RefreshCw,
	Sparkles,
	StopCircle,
	Trash2,
	X,
	Zap,
	Camera,
	SortAsc,
	Filter,
} from 'lucide-react-native'
import { createTracker } from '@/shared/utils/logger'

import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useModelStore } from '@/shared/stores/useModelStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'

import type { StyleJob, JobStatus } from '@/types'

const tracker = createTracker('GalleryScreen')

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const C = {
	bg: '#F8F9FB',
	surface: '#FFFFFF',
	surfaceHigh: '#F2F2F7',
	border: '#F2F2F7',
	primary: '#7B61FF',
	primaryMid: '#7B61FF',
	primaryGlow: '#A291FF',
	primarySoft: '#F0EDFF',
	text: '#1C1C1E',
	textMuted: '#8E8E93',
	textDim: '#C7C7CC',
	success: '#4CD964',
	downloaded: '#34C759',
	warning: '#FF9F0A',
	warningSoft: '#FFF5E6',
	error: '#FF3B30',
	errorSoft: '#FF3B30',
	white: '#FFFFFF',
} as const

const { width: SCREEN_W } = Dimensions.get('window')
const H_PADDING = 16
const COLUMN_GAP = 10
const COLUMNS = 2
const TILE_W = (SCREEN_W - H_PADDING * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS
const TILE_H = TILE_W

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
	PREVIEW_QUEUED: {
		label: 'Preview Queued',
		color: C.textMuted,
		Icon: Clock,
	},
}

type SortMode = 'newest' | 'oldest' | 'name'

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
// ACTIVE JOB ROW
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveJobRowProps {
	job: StyleJob
	styleName: string
	queuePosition?: number
	onPrioritize: (id: string) => void
	onCancel: (id: string) => void
}

const ActiveJobRow = React.memo<ActiveJobRowProps>(
	({ job, styleName, queuePosition, onPrioritize, onCancel }) => {
		const cfg = STATUS_CONFIG[job.status]

		const handlePress = useCallback(() => {
			if (job.status === 'QUEUED') {
				tracker.log('Prioritizing job from active row', {
					jobId: job.id,
				})
				onPrioritize(job.id)
			}
		}, [job.id, job.status, onPrioritize])

		const isStoppable =
			job.status === 'PROCESSING' || job.status === 'BATTERY_PAUSED'

		const handleCancel = useCallback(
			(e: GestureResponderEvent) => {
				e.stopPropagation?.()
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
									tracker.log(
										'User stopped active/paused job',
										{ jobId: job.id }
									)
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
			},
			[job.id, isStoppable, styleName, onCancel]
		)

		return (
			<Animated.View entering={FadeInDown.duration(220).springify()}>
				<Pressable
					onPress={handlePress}
					style={({ pressed }) => [
						styles.activeRow,
						pressed &&
							job.status === 'QUEUED' &&
							styles.activeRowPressed,
					]}
					accessibilityRole="button"
					accessibilityLabel={`${styleName} — ${cfg.label}`}
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
						{job.status === 'PROCESSING' && (
							<View style={styles.activeRowThumbOverlay}>
								<ProcessingRing progress={job.progress} />
							</View>
						)}
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

					{/* Info */}
					<View style={styles.activeRowInfo}>
						<View style={styles.activeRowHeader}>
							<cfg.Icon
								color={cfg.color}
								size={12}
								strokeWidth={2}
							/>
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

						<Text
							style={styles.activeRowStyleName}
							numberOfLines={1}
						>
							{styleName}
						</Text>

						<Text style={styles.activeRowTimestamp}>
							{formatRelative(job.createdAt)}
						</Text>

						{job.status === 'PROCESSING' && (
							<View style={styles.progressBarTrack}>
								<View
									style={[
										styles.progressBarFill,
										{
											width: `${Math.round(job.progress * 100)}%` as any,
										},
									]}
								/>
							</View>
						)}
						{job.status === 'BATTERY_PAUSED' && (
							<Text style={styles.batteryWarning}>
								Low battery — auto-resume when charging
							</Text>
						)}
						{job.status === 'QUEUED' && (
							<Text style={styles.activeRowHint}>
								Tap to bump to front
							</Text>
						)}
					</View>

					{/* Cancel/Stop button — QUEUED, PROCESSING, and BATTERY_PAUSED */}
					{(job.status === 'QUEUED' ||
						job.status === 'PROCESSING' ||
						job.status === 'BATTERY_PAUSED') && (
						<Pressable
							onPress={handleCancel}
							style={[
								styles.cancelBtn,
								isStoppable && styles.cancelBtnStop,
							]}
							hitSlop={10}
							accessibilityRole="button"
							accessibilityLabel={
								isStoppable ? 'Stop inference' : 'Cancel job'
							}
						>
							{isStoppable ? (
								<StopCircle
									color={C.error}
									size={14}
									strokeWidth={2}
								/>
							) : (
								<X
									color={C.textMuted}
									size={14}
									strokeWidth={2}
								/>
							)}
						</Pressable>
					)}
				</Pressable>
			</Animated.View>
		)
	}
)
ActiveJobRow.displayName = 'ActiveJobRow'

// ─────────────────────────────────────────────────────────────────────────────
// FINALIZED TILE
// ─────────────────────────────────────────────────────────────────────────────

interface FinalizedTileProps {
	job: StyleJob
	styleName: string
	index: number
	onPressDone: (job: StyleJob) => void
	onRetry: (id: string) => void
	onDelete: (id: string, name: string) => void
}

const FinalizedTile = React.memo<FinalizedTileProps>(
	({ job, styleName, index, onPressDone, onRetry, onDelete }) => {
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
					{
						text: 'Open & Edit',
						onPress: () => onPressDone(job),
					},
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

		const displayUri = job.status === 'DONE' ? job.resultUri : job.sourceUri
		const cfg = STATUS_CONFIG[job.status]

		// Stagger entrance by index
		const delay = Math.min(index * 40, 400)

		return (
			<Animated.View entering={FadeIn.delay(delay).duration(300)}>
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
					<Image
						source={{ uri: displayUri }}
						style={[
							styles.tileImage,
							job.status === 'ERROR' && styles.tileImageError,
						]}
						contentFit="cover"
						cachePolicy="disk"
						transition={200}
					/>

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

					{/* Bottom footer strip */}
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
						<Text style={styles.tileTimestamp}>
							{formatRelative(job.createdAt)}
						</Text>
					</View>

					{/* Done badge */}
					{job.status === 'DONE' && (
						<View style={styles.doneBadge}>
							<CheckCircle2
								color={C.downloaded}
								size={14}
								strokeWidth={2}
								fill={`${C.downloaded}30`}
							/>
						</View>
					)}
				</Pressable>
			</Animated.View>
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
// STAT PILL
// ─────────────────────────────────────────────────────────────────────────────

const StatPill = React.memo<{
	label: string
	value: string
	accent?: string
}>(({ label, value, accent }) => (
	<View
		style={[styles.statPill, accent ? { borderColor: `${accent}40` } : {}]}
	>
		<Text style={[styles.statValue, accent ? { color: accent } : {}]}>
			{value}
		</Text>
		<Text style={styles.statLabel}> {label}</Text>
	</View>
))
StatPill.displayName = 'StatPill'

// ─────────────────────────────────────────────────────────────────────────────
// FILTER / SORT DROPDOWN
// ─────────────────────────────────────────────────────────────────────────────

interface DropdownProps {
	label: string
	icon: React.ReactNode
	options: { label: string; value: string }[]
	selected: string
	onSelect: (v: string) => void
}

const Dropdown = React.memo<DropdownProps>(
	({ label, icon, options, selected, onSelect }) => {
		const [open, setOpen] = useState(false)
		const selectedLabel =
			options.find((o) => o.value === selected)?.label ?? label

		return (
			<>
				<Pressable
					onPress={() => setOpen(true)}
					style={({ pressed }) => [
						styles.filterDropdown,
						pressed && { opacity: 0.8 },
					]}
					accessibilityRole="button"
					accessibilityLabel={`${label}: ${selectedLabel}`}
				>
					{icon}
					<Text style={styles.filterText}>{selectedLabel}</Text>
					<ChevronDown size={14} color={C.text} strokeWidth={2} />
				</Pressable>

				<Modal
					visible={open}
					transparent
					animationType="fade"
					onRequestClose={() => setOpen(false)}
				>
					<Pressable
						style={styles.dropdownBackdrop}
						onPress={() => setOpen(false)}
					>
						<View style={styles.dropdownSheet}>
							<Text style={styles.dropdownSheetTitle}>
								{label}
							</Text>
							{options.map((opt) => (
								<Pressable
									key={opt.value}
									onPress={() => {
										onSelect(opt.value)
										setOpen(false)
									}}
									style={({ pressed }) => [
										styles.dropdownOption,
										pressed && styles.dropdownOptionPressed,
										selected === opt.value &&
											styles.dropdownOptionSelected,
									]}
								>
									<Text
										style={[
											styles.dropdownOptionText,
											selected === opt.value &&
												styles.dropdownOptionTextSelected,
										]}
									>
										{opt.label}
									</Text>
									{selected === opt.value && (
										<CheckCircle2
											color={C.primaryMid}
											size={16}
											strokeWidth={2}
										/>
									)}
								</Pressable>
							))}
						</View>
					</Pressable>
				</Modal>
			</>
		)
	}
)
Dropdown.displayName = 'Dropdown'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function GalleryScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	const jobs = useStyleJobStore((s) => s.jobs)
	const retryJob = useStyleJobStore((s) => s.retryJob)
	const removeJob = useStyleJobStore((s) => s.removeJob)
	const clearCompleted = useStyleJobStore((s) => s.clearCompleted)
	const catalog = useModelStore((s) => s.catalog)

	// ── Filter / sort state ───────────────────────────────────────────────────
	const [sortMode, setSortMode] = useState<SortMode>('newest')
	const [filterStyleId, setFilterStyleId] = useState<string>('all')

	// ── Derived streams ───────────────────────────────────────────────────────
	const activeJobs = useMemo<StyleJob[]>(() => {
		const active = jobs.filter((j) =>
			['QUEUED', 'PROCESSING', 'BATTERY_PAUSED'].includes(j.status)
		)
		const order: Record<JobStatus, number> = {
			PROCESSING: 0,
			QUEUED: 1,
			PREVIEW_QUEUED: 1,
			BATTERY_PAUSED: 2,
			DONE: 3,
			ERROR: 4,
		}
		return [...active].sort((a, b) => {
			const diff = order[a.status] - order[b.status]
			return diff !== 0 ? diff : a.createdAt - b.createdAt
		})
	}, [jobs])

	const finalizedJobs = useMemo<StyleJob[]>(() => {
		let finalized = jobs.filter((j) => ['DONE', 'ERROR'].includes(j.status))

		// Apply style filter
		if (filterStyleId !== 'all') {
			finalized = finalized.filter((j) => j.styleId === filterStyleId)
		}

		// Apply sort
		return [...finalized].sort((a, b) => {
			if (sortMode === 'newest') return b.createdAt - a.createdAt
			if (sortMode === 'oldest') return a.createdAt - b.createdAt
			// name sort: by style name
			const nameA = catalog.find((m) => m.id === a.styleId)?.name ?? ''
			const nameB = catalog.find((m) => m.id === b.styleId)?.name ?? ''
			return nameA.localeCompare(nameB)
		})
	}, [jobs, filterStyleId, sortMode, catalog])

	const systemBatteryPaused = useMemo(
		() => activeJobs.some((j) => j.status === 'BATTERY_PAUSED'),
		[activeJobs]
	)

	const styleNameMap = useMemo<Record<string, string>>(() => {
		const map: Record<string, string> = {}
		catalog.forEach((m) => {
			map[m.id] = m.name
		})
		return map
	}, [catalog])

	// Style filter options — only styles that appear in finalized jobs
	const styleFilterOptions = useMemo(() => {
		const usedStyleIds = new Set(
			jobs
				.filter((j) => ['DONE', 'ERROR'].includes(j.status))
				.map((j) => j.styleId)
		)
		const opts: { label: string; value: string }[] = [
			{ label: 'All Styles', value: 'all' },
		]
		usedStyleIds.forEach((id) => {
			opts.push({ label: styleNameMap[id] ?? id, value: id })
		})
		return opts
	}, [jobs, styleNameMap])

	const favoriteStyle = useMemo(() => {
		const freq: Record<string, number> = {}
		jobs.forEach((j) => {
			freq[j.styleId] = (freq[j.styleId] ?? 0) + 1
		})
		const topId = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0]
		return topId ? (styleNameMap[topId] ?? '—') : '—'
	}, [jobs, styleNameMap])

	const queuePositions = useMemo<Record<string, number>>(() => {
		const queued = activeJobs.filter((j) => j.status === 'QUEUED')
		const map: Record<string, number> = {}
		queued.forEach((j, i) => {
			map[j.id] = i + 1
		})
		return map
	}, [activeJobs])

	const doneCount = useMemo(
		() => jobs.filter((j) => j.status === 'DONE').length,
		[jobs]
	)
	const errorCount = useMemo(
		() => jobs.filter((j) => j.status === 'ERROR').length,
		[jobs]
	)
	const processingCount = useMemo(
		() =>
			activeJobs.filter(
				(j) => j.status === 'PROCESSING' || j.status === 'QUEUED'
			).length,
		[activeJobs]
	)
	const totalJobs = jobs.length

	// Stall recovery
	const jobStatusFingerprint = useMemo(
		() => jobs.map((j) => j.status).join(','),
		[jobs]
	)

	useEffect(() => {
		const hasQueued = jobs.some((j) => j.status === 'QUEUED')
		const activeJobId = StyleJobService.getActiveJobId()
		if (hasQueued && activeJobId === null) {
			tracker.log(
				'Stalled queue detected — structural kickstart triggered'
			)
			void StyleJobService.processNextJobInQueue()
		}
	}, [jobStatusFingerprint, jobs])

	// ── Actions ───────────────────────────────────────────────────────────────

	const handlePrioritize = useCallback((id: string) => {
		StyleJobService.prioritizeJob(id)
		void StyleJobService.processNextJobInQueue()
	}, [])

	const handleCancelJob = useCallback((id: string) => {
		// Use StyleJobService.cancelJob so that:
		//   • QUEUED jobs  → store.removeJob() (no UI error state)
		//   • PROCESSING jobs → _abortCurrentJob = true + store.removeJob()
		//     (inference halts at the next tile boundary, ~50–200 ms latency)
		StyleJobService.cancelJob(id)
	}, [])

	const handlePressDone = useCallback((job: StyleJob) => {
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
			retryJob(id)
			void StyleJobService.processNextJobInQueue()
		},
		[retryJob]
	)

	const handleDelete = useCallback(
		(id: string, name: string) => {
			Alert.alert(
				`Delete "${name}"?`,
				'This artwork will be removed from your gallery.',
				[
					{ text: 'Cancel', style: 'cancel' },
					{
						text: 'Delete',
						style: 'destructive',
						onPress: () => {
							tracker.log('Deleting finalized job from gallery', {
								id,
							})
							removeJob(id)
						},
					},
				]
			)
		},
		[removeJob]
	)

	const handleClearCompleted = useCallback(() => {
		Alert.alert(
			'Clear All Completed',
			`Remove all ${doneCount + errorCount} finished artworks from your gallery?`,
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Clear All',
					style: 'destructive',
					onPress: () => {
						tracker.log('Clearing all completed jobs from gallery')
						clearCompleted()
					},
				},
			]
		)
	}, [clearCompleted, doneCount, errorCount])

	const handleGoToCamera = useCallback(() => {
		router.push('/(tabs)/camera')
	}, [])

	const renderFinalizedTile = useCallback<ListRenderItem<StyleJob>>(
		({ item, index }) => (
			<FinalizedTile
				job={item}
				styleName={styleNameMap[item.styleId] ?? 'Unknown style'}
				index={index}
				onPressDone={handlePressDone}
				onRetry={handleRetry}
				onDelete={handleDelete}
			/>
		),
		[styleNameMap, handlePressDone, handleRetry, handleDelete]
	)

	const sortOptions: { label: string; value: SortMode }[] = [
		{ label: 'Newest First', value: 'newest' },
		{ label: 'Oldest First', value: 'oldest' },
		{ label: 'By Style Name', value: 'name' },
	]

	return (
		<View style={[styles.screen, { backgroundColor: C.bg }]}>
			{/* Battery-paused full-screen banner */}
			{systemBatteryPaused && (
				<Animated.View
					entering={FadeInUp.duration(200)}
					style={[
						styles.globalWarningBanner,
						{ paddingTop: insets.top + 8 },
					]}
				>
					<Battery color={C.white} size={14} strokeWidth={2.5} />
					<Text style={styles.globalWarningText}>
						Processing paused — Battery critical. Will resume on
						charge.
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
				removeClippedSubviews
				maxToRenderPerBatch={10}
				initialNumToRender={12}
				contentContainerStyle={{
					paddingTop: systemBatteryPaused
						? insets.top + 52
						: insets.top + 16,
					paddingBottom: 25,
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
						{/* Page header */}
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
											{processingCount} active
										</Text>
									</View>
								)}
							</View>
						</View>

						{/* Stats row */}
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							style={styles.statsRow}
						>
							<StatPill label="Total" value={String(totalJobs)} />
							<StatPill
								label="Done"
								value={String(doneCount)}
								accent={C.downloaded}
							/>
							{processingCount > 0 && (
								<StatPill
									label="Active"
									value={String(processingCount)}
									accent={C.primaryMid}
								/>
							)}
							{errorCount > 0 && (
								<StatPill
									label="Failed"
									value={String(errorCount)}
									accent={C.error}
								/>
							)}
							<StatPill label="Fav style" value={favoriteStyle} />
						</ScrollView>

						{/* Active pipeline section */}
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
											onCancel={handleCancelJob}
										/>
									))}
								</View>
							</View>
						)}

						{/* Finalized section header + filter/sort bar */}
						{(finalizedJobs.length > 0 ||
							jobs.some((j) =>
								['DONE', 'ERROR'].includes(j.status)
							)) && (
							<View style={styles.headerSectionBlock}>
								<SectionHeader
									title="Your Artwork"
									count={
										jobs.filter((j) =>
											['DONE', 'ERROR'].includes(j.status)
										).length
									}
									action={
										doneCount + errorCount > 0
											? {
													label: 'Clear All',
													onPress:
														handleClearCompleted,
													icon: (
														<Trash2
															color={C.textMuted}
															size={13}
															strokeWidth={2}
														/>
													),
												}
											: undefined
									}
								/>

								{/* Filter & Sort bar */}
								<View style={styles.filterBar}>
									<Dropdown
										label="All Styles"
										icon={
											<Filter
												size={13}
												color={C.text}
												strokeWidth={2}
											/>
										}
										options={styleFilterOptions}
										selected={filterStyleId}
										onSelect={setFilterStyleId}
									/>
									<Dropdown
										label="Sort"
										icon={
											<SortAsc
												size={13}
												color={C.text}
												strokeWidth={2}
											/>
										}
										options={sortOptions}
										selected={sortMode}
										onSelect={(v) =>
											setSortMode(v as SortMode)
										}
									/>
								</View>
							</View>
						)}
					</View>
				}
				ListFooterComponent={
					totalJobs > 0 ? (
						<View style={styles.footerContainer}>
							<Pressable
								onPress={handleGoToCamera}
								style={({ pressed }) => [
									styles.transformBtn,
									pressed && styles.transformBtnPressed,
								]}
								accessibilityRole="button"
								accessibilityLabel="Transform another photo"
							>
								<Sparkles
									color={C.white}
									size={20}
									strokeWidth={2}
								/>
								<Text style={styles.transformBtnText}>
									Transform Another Photo
								</Text>
							</Pressable>
						</View>
					) : null
				}
				ListEmptyComponent={
					totalJobs === 0 ? (
						<Animated.View
							entering={FadeInDown.delay(100)
								.duration(320)
								.springify()}
							style={styles.emptyState}
						>
							<View style={styles.emptyIconWrap}>
								<Images
									color={C.primaryMid}
									size={40}
									strokeWidth={1.2}
								/>
							</View>
							<Text style={styles.emptyTitle}>
								No artwork yet
							</Text>
							<Text style={styles.emptySub}>
								Capture a photo or pick from your library to
								start creating on-device fine art.
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
						</Animated.View>
					) : finalizedJobs.length === 0 &&
					  filterStyleId !== 'all' ? (
						<View style={styles.emptyFilterState}>
							<Text style={styles.emptyFilterText}>
								No artwork matches the selected filter.
							</Text>
							<Pressable
								onPress={() => setFilterStyleId('all')}
								style={styles.clearFilterBtn}
							>
								<Text style={styles.clearFilterBtnText}>
									Clear Filter
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
	screen: { flex: 1 },

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
	globalWarningText: { color: C.white, fontSize: 12, fontWeight: '700' },

	listHeaderContainer: { paddingHorizontal: H_PADDING, marginBottom: 8 },
	headerSectionBlock: { marginTop: 20 },

	pageHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingVertical: 12,
		backgroundColor: C.surface,
		borderBottomWidth: 1,
		borderBottomColor: C.border,
		marginHorizontal: -H_PADDING,
		paddingHorizontal: H_PADDING,
		marginBottom: 16,
	},
	pageHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	pageTitle: {
		fontSize: 22,
		fontWeight: '800',
		color: C.text,
		letterSpacing: -0.3,
	},
	pageHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	processingPill: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: C.primarySoft,
		paddingHorizontal: 10,
		paddingVertical: 6,
		borderRadius: 20,
		borderWidth: 1,
		borderColor: `${C.primaryMid}30`,
		gap: 6,
	},
	processingPillText: {
		color: C.primaryMid,
		fontSize: 12,
		fontWeight: '700',
	},

	statsRow: { marginBottom: 16 },
	statPill: {
		flexDirection: 'row',
		backgroundColor: C.surface,
		paddingHorizontal: 14,
		paddingVertical: 9,
		borderRadius: 20,
		marginRight: 10,
		borderWidth: 1,
		borderColor: C.border,
	},
	statLabel: { color: C.textMuted, fontSize: 13 },
	statValue: { color: C.text, fontWeight: '700', fontSize: 13 },

	filterBar: {
		flexDirection: 'row',
		gap: 10,
		marginBottom: 4,
		marginTop: 12,
	},
	filterDropdown: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: C.surface,
		paddingHorizontal: 12,
		paddingVertical: 9,
		borderRadius: 10,
		gap: 6,
		borderWidth: 1,
		borderColor: C.border,
	},
	filterText: { fontSize: 13, fontWeight: '600', color: C.text },

	// Dropdown modal
	dropdownBackdrop: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.35)',
		justifyContent: 'flex-end',
	},
	dropdownSheet: {
		backgroundColor: C.surface,
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		paddingBottom: 32,
		paddingTop: 8,
	},
	dropdownSheetTitle: {
		color: C.textMuted,
		fontSize: 11,
		fontWeight: '700',
		letterSpacing: 0.8,
		textTransform: 'uppercase',
		paddingHorizontal: 20,
		paddingVertical: 14,
	},
	dropdownOption: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 20,
		paddingVertical: 14,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: C.border,
	},
	dropdownOptionPressed: { backgroundColor: C.surfaceHigh },
	dropdownOptionSelected: { backgroundColor: C.primarySoft },
	dropdownOptionText: { color: C.text, fontSize: 15, fontWeight: '500' },
	dropdownOptionTextSelected: { color: C.primaryMid, fontWeight: '700' },

	// Section header
	sectionHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 12,
	},
	sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	sectionTitle: { fontSize: 18, fontWeight: '800', color: C.text },
	sectionCount: {
		backgroundColor: C.surfaceHigh,
		paddingHorizontal: 7,
		paddingVertical: 2,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: C.border,
	},
	sectionCountText: { color: C.textMuted, fontSize: 11, fontWeight: '700' },
	sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
	sectionActionText: { color: C.textMuted, fontSize: 13, fontWeight: '600' },

	// Active row
	activeList: { gap: 10 },
	activeRow: {
		flexDirection: 'row',
		backgroundColor: C.surface,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: C.border,
		padding: 10,
		gap: 12,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.06,
		shadowRadius: 4,
		elevation: 2,
		alignItems: 'center',
	},
	activeRowPressed: { borderColor: C.primaryMid },
	activeRowThumb: {
		width: 64,
		height: 64,
		borderRadius: 10,
		overflow: 'hidden',
		backgroundColor: C.surfaceHigh,
		flexShrink: 0,
	},
	activeRowThumbImage: { width: '100%', height: '100%' },
	activeRowThumbOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: 'rgba(255,255,255,0.6)',
		alignItems: 'center',
		justifyContent: 'center',
	},
	activeRowInfo: { flex: 1, justifyContent: 'center' },
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
		marginBottom: 2,
	},
	activeRowTimestamp: { color: C.textDim, fontSize: 11, marginBottom: 4 },
	cancelBtn: {
		width: 28,
		height: 28,
		borderRadius: 14,
		backgroundColor: C.surfaceHigh,
		alignItems: 'center',
		justifyContent: 'center',
		flexShrink: 0,
	},
	cancelBtnStop: {
		backgroundColor: `${C.error}15`,
		borderWidth: 1,
		borderColor: `${C.error}30`,
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
	batteryWarning: { color: C.warning, fontSize: 12, fontWeight: '500' },
	activeRowHint: { color: C.textMuted, fontSize: 12, fontStyle: 'italic' },

	// Tile grid
	columnWrapper: {
		paddingHorizontal: H_PADDING,
		justifyContent: 'space-between',
		marginBottom: COLUMN_GAP,
	},
	tile: {
		width: TILE_W,
		height: TILE_H,
		backgroundColor: C.surface,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: C.border,
		overflow: 'hidden',
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.08,
		shadowRadius: 4,
		elevation: 2,
	},
	tilePressed: { opacity: 0.85, borderColor: C.primaryGlow },
	tileImage: { width: '100%', height: '100%' },
	tileImageError: { opacity: 0.25 },
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
		backgroundColor: C.primaryMid,
		paddingHorizontal: 10,
		paddingVertical: 5,
		borderRadius: 10,
		gap: 4,
	},
	retryText: { color: C.white, fontSize: 11, fontWeight: '700' },
	tileFooter: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: 'rgba(0,0,0,0.55)',
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 8,
		paddingVertical: 5,
		gap: 3,
	},
	tileStatus: { fontSize: 10, fontWeight: '700' },
	tileStyleName: {
		color: 'rgba(255,255,255,0.85)',
		fontSize: 10,
		fontWeight: '500',
		flex: 1,
	},
	tileTimestamp: {
		color: 'rgba(255,255,255,0.55)',
		fontSize: 9,
		fontWeight: '500',
	},
	doneBadge: {
		position: 'absolute',
		top: 8,
		right: 8,
		width: 22,
		height: 22,
		borderRadius: 11,
		backgroundColor: 'rgba(0,0,0,0.4)',
		alignItems: 'center',
		justifyContent: 'center',
	},

	// Ring
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
	ringPercentText: { color: C.text, fontSize: 10, fontWeight: '800' },

	// Empty states
	emptyState: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: 40,
		marginTop: 80,
	},
	emptyIconWrap: {
		width: 80,
		height: 80,
		borderRadius: 24,
		backgroundColor: C.primarySoft,
		alignItems: 'center',
		justifyContent: 'center',
		marginBottom: 16,
	},
	emptyTitle: {
		color: C.text,
		fontSize: 20,
		fontWeight: '800',
		marginBottom: 8,
	},
	emptySub: {
		color: C.textMuted,
		fontSize: 14,
		textAlign: 'center',
		lineHeight: 21,
		marginBottom: 24,
	},
	emptyButton: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: C.primaryMid,
		paddingHorizontal: 20,
		height: 46,
		borderRadius: 14,
		gap: 8,
	},
	emptyButtonText: { color: C.white, fontSize: 15, fontWeight: '700' },

	emptyFilterState: {
		alignItems: 'center',
		paddingTop: 40,
		paddingHorizontal: 40,
		gap: 12,
	},
	emptyFilterText: { color: C.textMuted, fontSize: 14, textAlign: 'center' },
	clearFilterBtn: {
		backgroundColor: C.primarySoft,
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderRadius: 10,
	},
	clearFilterBtnText: {
		color: C.primaryMid,
		fontWeight: '700',
		fontSize: 14,
	},

	// Footer
	footerContainer: {
		paddingHorizontal: H_PADDING,
		paddingTop: 8,
		paddingBottom: 8,
	},
	transformBtn: {
		backgroundColor: C.primaryMid,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 16,
		borderRadius: 30,
		marginTop: 20,
		gap: 8,
		shadowColor: C.primaryMid,
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 8,
		elevation: 5,
	},
	transformBtnPressed: { opacity: 0.85 },
	transformBtnText: { color: C.white, fontSize: 16, fontWeight: '700' },
})
