/**
 * ArtLens — GalleryScreen
 *
 * Displays two sections via a single FlatList:
 *   1. Processing Pipeline  — active jobs (QUEUED / PROCESSING / BATTERY_PAUSED)
 *   2. Your Artwork         — finalized jobs (DONE / ERROR), filterable + sortable
 *
 * All sub-components live in features/gallery/components/ and are imported here.
 * This file contains only orchestration logic: derived state, event handlers,
 * and the FlatList render tree.
 *
 * Directory: app/(tabs)/gallery.tsx
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Dimensions,
	FlatList,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
	type ListRenderItem,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated'
import {
	Battery,
	Camera,
	Filter,
	Images,
	SortAsc,
	Sparkles,
	Trash2,
} from 'lucide-react-native'

import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useModelStore } from '@/shared/stores/useModelStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'
import { Colors } from '@/shared/ui'

import {
	ActiveJobRow,
	FinalizedTile,
	GalleryDropdown,
	GallerySectionHeader,
	StatPill,
} from '@/features/gallery/components'

import type { StyleJob, JobStatus } from '@/types'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('GalleryScreen')

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window')
const H_PADDING = 16
const COLUMN_GAP = 10
const COLUMNS = 2

/**
 * Explicit pixel width for each tile cell.
 *
 * React Native FlatList's numColumns layout does NOT reduce the available width
 * for columnWrapperStyle children when contentContainerStyle.paddingHorizontal
 * is set — items still measure at SCREEN_W and the padding just shifts content.
 * The reliable solution is to give every tile an explicit pixel width so it
 * never depends on implicit flex behaviour across the column wrapper.
 */
export const TILE_W =
	(SCREEN_W - H_PADDING * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS

type SortMode = 'newest' | 'oldest' | 'name'

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-SCOPE CONSTANTS (stable across renders — no allocation per render)
// ─────────────────────────────────────────────────────────────────────────────

const SORT_OPTIONS: { label: string; value: SortMode }[] = [
	{ label: 'Newest First', value: 'newest' },
	{ label: 'Oldest First', value: 'oldest' },
	{ label: 'By Style Name', value: 'name' },
]

const ACTIVE_JOB_ORDER: Record<JobStatus, number> = {
	PROCESSING: 0,
	QUEUED: 1,
	PREVIEW_QUEUED: 1,
	BATTERY_PAUSED: 2,
	DONE: 3,
	ERROR: 4,
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function GalleryScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// ── Store subscriptions ───────────────────────────────────────────────────
	const jobs = useStyleJobStore((s) => s.jobs)
	const retryJob = useStyleJobStore((s) => s.retryJob)
	const removeJob = useStyleJobStore((s) => s.removeJob)
	const clearCompleted = useStyleJobStore((s) => s.clearCompleted)
	const catalog = useModelStore((s) => s.catalog)

	// ── Filter / sort UI state ────────────────────────────────────────────────
	const [sortMode, setSortMode] = useState<SortMode>('newest')
	const [filterStyleId, setFilterStyleId] = useState<string>('all')

	// ── Style name lookup (catalog id → display name) ─────────────────────────
	const styleNameMap = useMemo<Record<string, string>>(() => {
		const map: Record<string, string> = {}
		catalog.forEach((m) => {
			map[m.id] = m.name
		})
		return map
	}, [catalog])

	// ── Active pipeline jobs (QUEUED / PROCESSING / BATTERY_PAUSED) ──────────
	const activeJobs = useMemo<StyleJob[]>(() => {
		const active = jobs.filter((j) =>
			['QUEUED', 'PROCESSING', 'BATTERY_PAUSED'].includes(j.status)
		)
		return [...active].sort((a, b) => {
			const diff = ACTIVE_JOB_ORDER[a.status] - ACTIVE_JOB_ORDER[b.status]
			return diff !== 0 ? diff : a.createdAt - b.createdAt
		})
	}, [jobs])

	// ── Finalized jobs (DONE / ERROR) with filter + sort applied ─────────────
	const finalizedJobs = useMemo<StyleJob[]>(() => {
		let finalized = jobs.filter((j) => ['DONE', 'ERROR'].includes(j.status))
		if (filterStyleId !== 'all') {
			finalized = finalized.filter((j) => j.styleId === filterStyleId)
		}
		return [...finalized].sort((a, b) => {
			if (sortMode === 'newest') return b.createdAt - a.createdAt
			if (sortMode === 'oldest') return a.createdAt - b.createdAt
			return (styleNameMap[a.styleId] ?? '').localeCompare(
				styleNameMap[b.styleId] ?? ''
			)
		})
	}, [jobs, filterStyleId, sortMode, styleNameMap])

	// ── Derived counts ────────────────────────────────────────────────────────
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
	const systemBatteryPaused = useMemo(
		() => activeJobs.some((j) => j.status === 'BATTERY_PAUSED'),
		[activeJobs]
	)
	const queuePositions = useMemo<Record<string, number>>(() => {
		const map: Record<string, number> = {}
		activeJobs
			.filter((j) => j.status === 'QUEUED')
			.forEach((j, i) => {
				map[j.id] = i + 1
			})
		return map
	}, [activeJobs])

	const styleFilterOptions = useMemo(() => {
		const usedIds = new Set(
			jobs
				.filter((j) => ['DONE', 'ERROR'].includes(j.status))
				.map((j) => j.styleId)
		)
		const opts: { label: string; value: string }[] = [
			{ label: 'All Styles', value: 'all' },
		]
		usedIds.forEach((id) =>
			opts.push({ label: styleNameMap[id] ?? id, value: id })
		)
		return opts
	}, [jobs, styleNameMap])

	const favoriteStyleName = useMemo(() => {
		const freq: Record<string, number> = {}
		jobs.forEach((j) => {
			freq[j.styleId] = (freq[j.styleId] ?? 0) + 1
		})
		const topId = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0]
		return topId ? (styleNameMap[topId] ?? '—') : '—'
	}, [jobs, styleNameMap])

	// ── Stall recovery: restart queue if work is QUEUED but processor is idle ─
	const jobStatusFingerprint = useMemo(
		() => jobs.map((j) => j.status).join(','),
		[jobs]
	)

	useEffect(() => {
		const hasQueued = jobs.some((j) => j.status === 'QUEUED')
		if (hasQueued && StyleJobService.getActiveJobId() === null) {
			tracker.log('Stalled queue detected — restarting processor')
			void StyleJobService.processNextJobInQueue()
		}
	}, [jobStatusFingerprint, jobs])

	// ── Action handlers ───────────────────────────────────────────────────────

	const handlePrioritize = useCallback((id: string) => {
		StyleJobService.prioritizeJob(id)
		void StyleJobService.processNextJobInQueue()
	}, [])

	const handleCancelJob = useCallback((id: string) => {
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

	const handleGoToCamera = useCallback(
		() => router.push('/(tabs)/camera'),
		[]
	)

	// ── FlatList renderItem ───────────────────────────────────────────────────

	const renderFinalizedTile = useCallback<ListRenderItem<StyleJob>>(
		({ item, index }) => (
			<FinalizedTile
				job={item}
				styleName={styleNameMap[item.styleId] ?? 'Unknown style'}
				index={index}
				tileWidth={TILE_W}
				onPressDone={handlePressDone}
				onRetry={handleRetry}
				onDelete={handleDelete}
			/>
		),
		[styleNameMap, handlePressDone, handleRetry, handleDelete]
	)

	// ─────────────────────────────────────────────────────────────────────────
	// RENDER
	// ─────────────────────────────────────────────────────────────────────────

	return (
		<View style={[styles.screen, { backgroundColor: Colors.bg }]}>
			{/* Critical-battery banner */}
			{systemBatteryPaused && (
				<Animated.View
					entering={FadeInUp.duration(200)}
					style={[
						styles.batteryBanner,
						{ paddingTop: insets.top + 8 },
					]}
				>
					<Battery color={Colors.white} size={14} strokeWidth={2.5} />
					<Text style={styles.batteryBannerText}>
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
				// Each tile has an explicit width (TILE_W) so columnWrapperStyle
				// only needs to handle the gap between them and vertical spacing.
				// No paddingHorizontal here — the header carries its own padding
				// and tiles are sized to fill the screen minus H_PADDING on each side.
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
				ListHeaderComponent={
					<ListHeader
						totalJobs={totalJobs}
						doneCount={doneCount}
						errorCount={errorCount}
						processingCount={processingCount}
						favoriteStyleName={favoriteStyleName}
						activeJobs={activeJobs}
						styleNameMap={styleNameMap}
						queuePositions={queuePositions}
						finalizedJobCount={
							jobs.filter((j) =>
								['DONE', 'ERROR'].includes(j.status)
							).length
						}
						styleFilterOptions={styleFilterOptions}
						filterStyleId={filterStyleId}
						sortMode={sortMode}
						onPrioritize={handlePrioritize}
						onCancelJob={handleCancelJob}
						onClearCompleted={handleClearCompleted}
						onFilterChange={setFilterStyleId}
						onSortChange={(v) => setSortMode(v as SortMode)}
					/>
				}
				ListFooterComponent={
					totalJobs > 0 ? (
						<View style={styles.footer}>
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
									color={Colors.white}
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
									color={Colors.primary}
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
								accessibilityLabel="Open camera"
							>
								<Camera
									color={Colors.white}
									size={18}
									strokeWidth={2}
								/>
								<Text style={styles.emptyButtonText}>
									Open Camera
								</Text>
							</Pressable>
						</Animated.View>
					) : null
				}
			/>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST HEADER — memoised to avoid re-rendering on every grid scroll/tick
// ─────────────────────────────────────────────────────────────────────────────

interface ListHeaderProps {
	totalJobs: number
	doneCount: number
	errorCount: number
	processingCount: number
	favoriteStyleName: string
	activeJobs: StyleJob[]
	styleNameMap: Record<string, string>
	queuePositions: Record<string, number>
	finalizedJobCount: number
	styleFilterOptions: { label: string; value: string }[]
	filterStyleId: string
	sortMode: SortMode
	onPrioritize: (id: string) => void
	onCancelJob: (id: string) => void
	onClearCompleted: () => void
	onFilterChange: (value: string) => void
	onSortChange: (value: string) => void
}

const ListHeader = React.memo<ListHeaderProps>(
	({
		totalJobs,
		doneCount,
		errorCount,
		processingCount,
		favoriteStyleName,
		activeJobs,
		styleNameMap,
		queuePositions,
		finalizedJobCount,
		styleFilterOptions,
		filterStyleId,
		sortMode,
		onPrioritize,
		onCancelJob,
		onClearCompleted,
		onFilterChange,
		onSortChange,
	}) => (
		<View style={styles.listHeader}>
			{/* Page title + active-job indicator */}
			<View style={styles.pageHeader}>
				<View style={styles.pageHeaderLeft}>
					<Images
						color={Colors.primary}
						size={22}
						strokeWidth={1.6}
					/>
					<Text style={styles.pageTitle}>Gallery</Text>
				</View>
				{processingCount > 0 && (
					<View style={styles.processingPill}>
						<ActivityIndicator
							color={Colors.primary}
							size="small"
						/>
						<Text style={styles.processingPillText}>
							{processingCount} active
						</Text>
					</View>
				)}
			</View>

			{/* Stats strip */}
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={styles.statsRow}
				contentContainerStyle={styles.statsRowContent}
			>
				<StatPill label="Total" value={String(totalJobs)} />
				<StatPill
					label="Done"
					value={String(doneCount)}
					accent={Colors.successLegacy}
				/>
				{processingCount > 0 && (
					<StatPill
						label="Active"
						value={String(processingCount)}
						accent={Colors.primary}
					/>
				)}
				{errorCount > 0 && (
					<StatPill
						label="Failed"
						value={String(errorCount)}
						accent={Colors.errorDeep}
					/>
				)}
				<StatPill label="Fav style" value={favoriteStyleName} />
			</ScrollView>

			{/* Active pipeline */}
			{activeJobs.length > 0 && (
				<View style={styles.sectionBlock}>
					<GallerySectionHeader
						title="Processing Pipeline"
						count={activeJobs.length}
					/>
					<View style={styles.activeList}>
						{activeJobs.map((job) => (
							<ActiveJobRow
								key={job.id}
								job={job}
								styleName={
									styleNameMap[job.styleId] ?? 'Unknown style'
								}
								queuePosition={queuePositions[job.id]}
								onPrioritize={onPrioritize}
								onCancel={onCancelJob}
							/>
						))}
					</View>
				</View>
			)}

			{/* Finalized section header + filter/sort bar */}
			{finalizedJobCount > 0 && (
				<View style={styles.sectionBlock}>
					<GallerySectionHeader
						title="Your Artwork"
						count={finalizedJobCount}
						action={
							doneCount + errorCount > 0
								? {
										label: 'Clear All',
										onPress: onClearCompleted,
										icon: (
											<Trash2
												color={Colors.textMuted}
												size={13}
												strokeWidth={2}
											/>
										),
									}
								: undefined
						}
					/>
					<View style={styles.filterBar}>
						<GalleryDropdown
							label="All Styles"
							icon={
								<Filter
									size={13}
									color={Colors.text}
									strokeWidth={2}
								/>
							}
							options={styleFilterOptions}
							selected={filterStyleId}
							onSelect={onFilterChange}
						/>
						<GalleryDropdown
							label="Sort"
							icon={
								<SortAsc
									size={13}
									color={Colors.text}
									strokeWidth={2}
								/>
							}
							options={SORT_OPTIONS}
							selected={sortMode}
							onSelect={onSortChange}
						/>
					</View>
				</View>
			)}
		</View>
	)
)
ListHeader.displayName = 'ListHeader'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: { flex: 1 },

	batteryBanner: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		zIndex: 10,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		paddingHorizontal: 16,
		paddingBottom: 10,
		backgroundColor: Colors.warning,
	},
	batteryBannerText: {
		color: Colors.white,
		fontSize: 13,
		fontWeight: '600',
	},

	// Header carries its own horizontal padding so the tile grid doesn't need any
	listHeader: {
		paddingHorizontal: H_PADDING,
		paddingBottom: 8,
	},
	pageHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 14,
	},
	pageHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	pageTitle: {
		fontSize: 24,
		fontWeight: '800',
		color: Colors.text,
		letterSpacing: -0.3,
	},
	processingPill: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		backgroundColor: Colors.primarySoft,
		borderRadius: 20,
		paddingHorizontal: 10,
		paddingVertical: 5,
	},
	processingPillText: {
		fontSize: 12,
		fontWeight: '600',
		color: Colors.primary,
	},

	statsRow: { marginBottom: 16 },
	statsRowContent: { gap: 8, paddingRight: 4 },

	sectionBlock: { marginBottom: 16 },
	activeList: { gap: 0 },
	filterBar: {
		flexDirection: 'row',
		gap: 8,
		marginTop: 10,
		marginBottom: 12,
	},

	// Tile grid rows — gap only, no extra padding.
	// Tiles carry their own explicit width (TILE_W) so this wrapper doesn't need
	// to constrain width at all; it just controls the gap and row spacing.
	columnWrapper: {
		paddingHorizontal: H_PADDING,
		gap: COLUMN_GAP,
		marginBottom: COLUMN_GAP,
	},

	footer: {
		paddingTop: 20,
		paddingBottom: 10,
		alignItems: 'center',
	},
	transformBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: Colors.primary,
		borderRadius: 16,
		paddingHorizontal: 24,
		paddingVertical: 14,
	},
	transformBtnPressed: { opacity: 0.85 },
	transformBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },

	emptyState: {
		paddingHorizontal: H_PADDING,
		paddingTop: 60,
		alignItems: 'center',
		gap: 12,
	},
	emptyIconWrap: {
		width: 80,
		height: 80,
		borderRadius: 40,
		backgroundColor: Colors.primarySoft,
		justifyContent: 'center',
		alignItems: 'center',
		marginBottom: 8,
	},
	emptyTitle: { fontSize: 22, fontWeight: '800', color: Colors.text },
	emptySub: {
		fontSize: 14,
		color: Colors.textMuted,
		textAlign: 'center',
		lineHeight: 20,
	},
	emptyButton: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		marginTop: 8,
		backgroundColor: Colors.primary,
		borderRadius: 14,
		paddingHorizontal: 24,
		paddingVertical: 13,
	},
	emptyButtonText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
})
