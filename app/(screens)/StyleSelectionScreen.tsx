/**
 * ArtLens — StyleSelectionScreen
 *
 * Post-pick art style browser and queue pipeline link.
 *
 * This screen receives a `sourceUri` navigation parameter (the raw file URI of
 * the user's selected photo), presents the downloadable style catalog, tracks
 * live per-job rendering progress, and commits the final JobPayload into the
 * background stylization queue when the user confirms a selection.
 *
 * Interaction lifecycle:
 *   1. Receives sourceUri from navigation params (set by useImageSelection).
 *   2. Reads the downloaded style catalog from useModelStore.
 *   3. User selects a style card → selectedStyleId state updates.
 *   4. If a matching job is already PROCESSING, a progress overlay renders.
 *   5. "Apply Fine-Art Style" tap → enqueue() + processNextJobInQueue() (fire-and-forget).
 *   6. Immediately navigates to the Gallery tab.
 *
 * PRD § 3.3 StyleSelection Screen — Directory: src/features/upload/screens/StyleSelectionScreen.tsx
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
	View,
	Text,
	FlatList,
	TouchableOpacity,
	StyleSheet,
	StatusBar,
	Dimensions,
	ActivityIndicator,
	Platform,
	Animated,
	ListRenderItemInfo,
	Alert,
} from 'react-native'
import { Image } from 'expo-image'
import {
	ChevronLeft,
	Sparkles,
	CheckCircle2,
	Clock,
	AlertCircle,
} from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { useModelStore } from '@/shared/stores/useModelStore'
import { useShallow } from 'zustand/react/shallow'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'
import type { StyleModel, JobPayload, StyleId } from '@/types'

import { createTracker } from '@/shared/utils/logger'
const tracker = createTracker('StyleSelectionScreen')

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const CARD_MARGIN = 12
const NUM_COLUMNS = 2
// Each card occupies half the screen minus outer padding and inter-card gap.
const CARD_WIDTH = (SCREEN_WIDTH - CARD_MARGIN * 3) / NUM_COLUMNS
const CARD_HEIGHT = CARD_WIDTH * 1.35

// Design tokens — ink-dark editorial palette
const COLORS = {
	bg: '#0E0E10',
	surface: '#18181B',
	surfaceHover: '#27272A',
	border: '#2A2A2D',
	accent: '#E8C96B', // warm gold — primary action
	accentMuted: '#3D3523', // gold tint for subtle backgrounds
	textPrimary: '#F4F4F5',
	textSecondary: '#A1A1AA',
	textMuted: '#52525B',
	error: '#F87171',
	success: '#4ADE80',
	processing: '#60A5FA',
	overlay: 'rgba(14,14,16,0.82)',
	cardSelected: '#E8C96B',
	cardSelectedBorder: '#E8C96B',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Animated shimmer placeholder shown while a thumbnail is loading from cache
 * or remote URL.
 */
function ThumbnailSkeleton(): React.ReactElement {
	const anim = useRef(new Animated.Value(0.3)).current

	useEffect(() => {
		const pulse = Animated.loop(
			Animated.sequence([
				Animated.timing(anim, {
					toValue: 0.7,
					duration: 900,
					useNativeDriver: true,
				}),
				Animated.timing(anim, {
					toValue: 0.3,
					duration: 900,
					useNativeDriver: true,
				}),
			])
		)
		pulse.start()
		return () => pulse.stop()
	}, [anim])

	return (
		<Animated.View
			style={[
				StyleSheet.absoluteFill,
				styles.thumbnailSkeleton,
				{ opacity: anim },
			]}
		/>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE CARD
// ─────────────────────────────────────────────────────────────────────────────

interface StyleCardProps {
	model: StyleModel
	isSelected: boolean
	progressPercent: number | null // null = no active job, 0–100 = job in progress
	onPress: (id: StyleId) => void
}

function StyleCard({
	model,
	isSelected,
	progressPercent,
	onPress,
}: StyleCardProps): React.ReactElement {
	const isDownloaded = model.downloadStatus === 'downloaded'
	const isDownloading = model.downloadStatus === 'downloading'
	const [isImageLoaded, setIsImageLoaded] = useState<boolean>(false)

	const handlePress = useCallback(() => {
		if (isDownloaded) {
			onPress(model.id)
		}
	}, [isDownloaded, model.id, onPress])

	// Scale animation on selection
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
			activeOpacity={isDownloaded ? 0.85 : 1}
			style={styles.cardTouchable}
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
				{/* ── Thumbnail ── */}
				<View style={styles.cardImageContainer}>
					{/* Render skeleton behind image until onLoad completes */}
					{!isImageLoaded && <ThumbnailSkeleton />}
					<Image
						source={{ uri: model.thumbnailUrl }}
						style={StyleSheet.absoluteFill}
						contentFit="cover"
						transition={300}
						onLoad={() => setIsImageLoaded(true)}
						cachePolicy="memory-disk"
					/>

					{/* Dark gradient overlay at bottom for legibility */}
					<View style={styles.cardGradient} />

					{/* ── Processing progress overlay ── */}
					{progressPercent !== null && (
						<View style={styles.progressOverlay}>
							<View style={styles.progressInner}>
								<ActivityIndicator
									size="small"
									color={COLORS.processing}
									style={styles.progressSpinner}
								/>
								<Text style={styles.progressText}>
									{progressPercent}%
								</Text>
							</View>
							<View style={styles.progressBarTrack}>
								<View
									style={[
										styles.progressBarFill,
										{ width: `${progressPercent}%` },
									]}
								/>
							</View>
						</View>
					)}

					{/* ── Download state badge ── */}
					{!isDownloaded && (
						<View style={styles.unavailableBadge}>
							{isDownloading ? (
								<Clock
									size={12}
									color={COLORS.textSecondary}
									strokeWidth={2}
								/>
							) : (
								<Text style={styles.unavailableBadgeText}>
									Download
								</Text>
							)}
						</View>
					)}

					{/* ── Selected checkmark ── */}
					{isSelected && isDownloaded && (
						<View style={styles.selectedBadge}>
							<CheckCircle2
								size={18}
								color={COLORS.bg}
								strokeWidth={2.5}
							/>
						</View>
					)}
				</View>

				{/* ── Card footer ── */}
				<View style={styles.cardFooter}>
					<Text style={styles.cardName} numberOfLines={1}>
						{model.name}
					</Text>
					<Text style={styles.cardSize} numberOfLines={1}>
						{isDownloaded ? '✓ Ready' : model.fileSize}
					</Text>
				</View>
			</Animated.View>
		</TouchableOpacity>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────

function EmptyStyleCatalog(): React.ReactElement {
	return (
		<View style={styles.emptyContainer}>
			<AlertCircle size={40} color={COLORS.textMuted} strokeWidth={1.5} />
			<Text style={styles.emptyTitle}>No Styles Available</Text>
			<Text style={styles.emptyBody}>
				Visit the Styles tab to sync and download art models from the
				catalog.
			</Text>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

interface RouteParams {
	sourceUri?: string
}

interface StyleSelectionScreenProps {
	route: { params?: RouteParams }
	navigation: any
}

export default function StyleSelectionScreen({
	route,
}: StyleSelectionScreenProps): React.ReactElement {
	// ── Parameter extraction & safety guard ────────────────────────────────────
	const { sourceUri } = useLocalSearchParams<{ sourceUri?: string }>()

	const router = useRouter()

	// ── Store subscriptions ────────────────────────────────────────────────────
	// Select only the downloaded (active) models from the catalog.
	// Using a focused selector prevents re-renders when unrelated catalog fields
	// (e.g., syncError, isSyncing) mutate.
	const downloadedModels = useModelStore(
		useShallow((state) =>
			state.catalog.filter(
				(m) => m.isActive && m.downloadStatus === 'downloaded'
			)
		)
	)

	// All models (active, regardless of download status) for display purposes.
	// We show unavailable models grayed out so users know more styles exist.
	const allActiveModels = useModelStore(
		useShallow((state) => state.catalog.filter((m) => m.isActive))
	)

	// Focused job selector: only PROCESSING jobs matching the current sourceUri.
	// This minimizes re-renders during the gallery's high-frequency progress ticks.
	const processingJobs = useStyleJobStore(
		useShallow((state) =>
			state.jobs.filter(
				(j) => j.sourceUri === sourceUri && j.status === 'PROCESSING'
			)
		)
	)

	// ── Local state ────────────────────────────────────────────────────────────
	const [selectedStyleId, setSelectedStyleId] = useState<StyleId | null>(null)
	const [isEnqueuing, setIsEnqueuing] = useState<boolean>(false)

	// ── Derived: progress map ──────────────────────────────────────────────────
	// Build a styleId → progress% map from active processing jobs.
	// O(n) where n = active jobs for this sourceUri (typically 0 or 1).
	const progressByStyleId = useMemo<Map<StyleId, number>>(() => {
		const map = new Map<StyleId, number>()
		for (const job of processingJobs) {
			map.set(job.styleId, Math.round((job.progress ?? 0) * 100))
		}
		return map
	}, [processingJobs])

	// ── Style selection handler ────────────────────────────────────────────────
	const handleStylePress = useCallback(
		(id: StyleId): void => {
			const model = allActiveModels.find((m) => m.id === id)

			if (model && model.downloadStatus !== 'downloaded') {
				// 🔴 OPTIONAL PRODUCT TELEMETRY DETECTOR
				tracker.debug(
					'User attempted interaction with un-downloaded fine-art model asset',
					{
						styleId: id,
						downloadStatus: model.downloadStatus,
					}
				)
				return
			}

			setSelectedStyleId((prev) => (prev === id ? null : id))
		},
		[allActiveModels]
	)

	// ── Enqueue and navigate ───────────────────────────────────────────────────
	const handleApplyStyle = useCallback(async (): Promise<void> => {
		if (!selectedStyleId || isEnqueuing || !sourceUri) {
			return
		}

		setIsEnqueuing(true)

		try {
			// Build the formal job payload matching the JobPayload interface.
			const payload: JobPayload = {
				sourceUri,
				styleId: selectedStyleId,
			}

			// Commit the transaction to the persistent job queue.
			// enqueue() is synchronous — it writes to Zustand + MMKV immediately.
			useStyleJobStore.getState().enqueue(payload)

			// Wake the background processing thread. This is intentionally
			// unawaited — we do not block navigation on the first tile completing.
			// StyleJobService.processNextJobInQueue() acquires its own internal lock
			// and will no-op if already processing another job.
			void StyleJobService.processNextJobInQueue()

			// Navigate immediately to the Gallery monitoring panel.
			// The user will see the job appear as QUEUED → PROCESSING in real time.
			router.navigate({
				pathname: '/(tabs)/gallery',
			})
		} catch (err) {
			// 🔴 CRITICAL PIPELINE TELEMETRY LOG HERE
			tracker.error(
				'Failed to commit style job payload to processing queue',
				{
					styleId: selectedStyleId,
					hasSourceUri: !!sourceUri,
					error:
						err instanceof Error
							? {
									name: err.name,
									message: err.message,
									stack: err.stack,
								}
							: String(err),
				}
			)

			// Notify user of core storage state failure
			Alert.alert(
				'Queue Error',
				'Could not enqueue this image for style transfer. Please clear cache or try again.'
			)
		} finally {
			setIsEnqueuing(false)
		}
	}, [selectedStyleId, isEnqueuing, sourceUri, router])

	// ── FlatList renderItem ────────────────────────────────────────────────────
	const renderStyleCard = useCallback(
		({ item }: ListRenderItemInfo<StyleModel>): React.ReactElement => {
			const isSelected = item.id === selectedStyleId
			const progressPercent = progressByStyleId.get(item.id) ?? null

			return (
				<StyleCard
					model={item}
					isSelected={isSelected}
					progressPercent={progressPercent}
					onPress={handleStylePress}
				/>
			)
		},
		[selectedStyleId, progressByStyleId, handleStylePress]
	)

	const keyExtractor = useCallback((item: StyleModel): string => item.id, [])

	// Guard: if sourceUri is missing or not a non-empty string, the screen
	// cannot function. Render a safe fallback that redirects back.
	if (
		!sourceUri ||
		typeof sourceUri !== 'string' ||
		sourceUri.trim() === ''
	) {
		tracker.warn(
			'StyleSelectionScreen mounted with missing or invalid sourceUri parameter',
			{
				receivedType: typeof sourceUri,
				catalogSize: allActiveModels.length,
			}
		)
		return (
			<View style={styles.errorFallbackContainer}>
				<StatusBar
					barStyle="light-content"
					backgroundColor={COLORS.bg}
				/>
				<AlertCircle size={48} color={COLORS.error} strokeWidth={1.5} />
				<Text style={styles.errorFallbackTitle}>Missing Photo</Text>
				<Text style={styles.errorFallbackBody}>
					No source photo was provided. Please go back and select an
					image first.
				</Text>
				<TouchableOpacity
					style={styles.errorFallbackButton}
					onPress={() => router.back()}
					activeOpacity={0.8}
				>
					<Text style={styles.errorFallbackButtonText}>
						← Go Back
					</Text>
				</TouchableOpacity>
			</View>
		)
	}

	// ── Button availability ────────────────────────────────────────────────────
	const canApply =
		selectedStyleId !== null &&
		!isEnqueuing &&
		downloadedModels.some((m) => m.id === selectedStyleId)

	const selectedModel = allActiveModels.find((m) => m.id === selectedStyleId)

	// ── Render ─────────────────────────────────────────────────────────────────
	return (
		<View style={styles.screen}>
			<StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

			{/* ── Header ── */}
			<View style={styles.header}>
				<TouchableOpacity
					style={styles.backButton}
					onPress={() => router.back()}
					activeOpacity={0.7}
					accessibilityRole="button"
					accessibilityLabel="Go back"
				>
					<ChevronLeft
						size={22}
						color={COLORS.textPrimary}
						strokeWidth={2}
					/>
				</TouchableOpacity>

				<View style={styles.headerCenter}>
					<Text style={styles.headerTitle}>Choose a Style</Text>
					<Text style={styles.headerSubtitle}>
						{allActiveModels.length} art{' '}
						{allActiveModels.length === 1 ? 'style' : 'styles'}{' '}
						available
					</Text>
				</View>

				{/* Spacer to balance the back button */}
				<View style={styles.headerSpacer} />
			</View>

			{/* ── Source photo strip ── */}
			<View style={styles.sourcePhotoStrip}>
				<Image
					source={{ uri: sourceUri }}
					style={styles.sourcePhotoThumb}
					contentFit="cover"
					transition={200}
					cachePolicy="memory"
				/>
				<View style={styles.sourcePhotoInfo}>
					<Text style={styles.sourcePhotoLabel}>Source Photo</Text>
					<Text style={styles.sourcePhotoHint} numberOfLines={2}>
						Select a style below to apply to this image
					</Text>
				</View>
			</View>

			{/* ── Catalog divider ── */}
			<View style={styles.sectionDivider}>
				<View style={styles.sectionLine} />
				<Text style={styles.sectionLabel}>ART STYLES</Text>
				<View style={styles.sectionLine} />
			</View>

			{/* ── Style grid ── */}
			{allActiveModels.length === 0 ? (
				<EmptyStyleCatalog />
			) : (
				<FlatList<StyleModel>
					data={allActiveModels}
					renderItem={renderStyleCard}
					keyExtractor={keyExtractor}
					numColumns={NUM_COLUMNS}
					contentContainerStyle={styles.listContent}
					showsVerticalScrollIndicator={false}
					// Extra bottom padding so the last row clears the sticky action bar.
					ListFooterComponent={
						<View style={styles.listFooterSpacer} />
					}
				/>
			)}

			{/* ── Sticky action bar ── */}
			<View style={styles.actionBar}>
				{selectedModel ? (
					<View style={styles.actionBarInfo}>
						<Text
							style={styles.actionBarStyleName}
							numberOfLines={1}
						>
							{selectedModel.name}
						</Text>
						<Text style={styles.actionBarStyleHint}>
							{selectedModel.description.length > 60
								? selectedModel.description.slice(0, 57) + '…'
								: selectedModel.description}
						</Text>
					</View>
				) : (
					<View style={styles.actionBarInfo}>
						<Text style={styles.actionBarPlaceholder}>
							Select a style to continue
						</Text>
					</View>
				)}

				<TouchableOpacity
					style={[
						styles.applyButton,
						!canApply && styles.applyButtonDisabled,
					]}
					onPress={handleApplyStyle}
					disabled={!canApply}
					activeOpacity={0.8}
					accessibilityRole="button"
					accessibilityLabel="Apply Fine-Art Style"
					accessibilityState={{ disabled: !canApply }}
				>
					{isEnqueuing ? (
						<ActivityIndicator size="small" color={COLORS.bg} />
					) : (
						<>
							<Sparkles
								size={16}
								color={canApply ? COLORS.bg : COLORS.textMuted}
								strokeWidth={2}
								style={styles.applyButtonIcon}
							/>
							<Text
								style={[
									styles.applyButtonText,
									!canApply && styles.applyButtonTextDisabled,
								]}
							>
								Apply Fine-Art Style
							</Text>
						</>
					)}
				</TouchableOpacity>
			</View>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	// ── Root ──────────────────────────────────────────────────────────────────
	screen: {
		flex: 1,
		backgroundColor: COLORS.bg,
	},

	// ── Error fallback ─────────────────────────────────────────────────────────
	errorFallbackContainer: {
		flex: 1,
		backgroundColor: COLORS.bg,
		alignItems: 'center',
		justifyContent: 'center',
		padding: 32,
		gap: 16,
	},
	errorFallbackTitle: {
		fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
		fontSize: 22,
		fontWeight: '600',
		color: COLORS.textPrimary,
		textAlign: 'center',
	},
	errorFallbackBody: {
		fontSize: 15,
		color: COLORS.textSecondary,
		textAlign: 'center',
		lineHeight: 22,
	},
	errorFallbackButton: {
		marginTop: 8,
		paddingVertical: 12,
		paddingHorizontal: 24,
		backgroundColor: COLORS.surface,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: COLORS.border,
	},
	errorFallbackButtonText: {
		fontSize: 15,
		fontWeight: '600',
		color: COLORS.textPrimary,
	},

	// ── Header ─────────────────────────────────────────────────────────────────
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingTop: Platform.OS === 'ios' ? 56 : 16,
		paddingBottom: 12,
		paddingHorizontal: 16,
		backgroundColor: COLORS.bg,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: COLORS.border,
	},
	backButton: {
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: COLORS.surface,
		alignItems: 'center',
		justifyContent: 'center',
	},
	headerCenter: {
		flex: 1,
		alignItems: 'center',
		paddingHorizontal: 8,
	},
	headerTitle: {
		fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
		fontSize: 18,
		fontWeight: '700',
		color: COLORS.textPrimary,
		letterSpacing: 0.2,
	},
	headerSubtitle: {
		fontSize: 12,
		color: COLORS.textMuted,
		marginTop: 2,
		letterSpacing: 0.5,
	},
	headerSpacer: {
		width: 40,
	},

	// ── Source photo strip ─────────────────────────────────────────────────────
	sourcePhotoStrip: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 16,
		paddingVertical: 14,
		backgroundColor: COLORS.surface,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: COLORS.border,
		gap: 14,
	},
	sourcePhotoThumb: {
		width: 60,
		height: 60,
		borderRadius: 8,
		backgroundColor: COLORS.bg,
		borderWidth: 1,
		borderColor: COLORS.border,
	},
	sourcePhotoInfo: {
		flex: 1,
	},
	sourcePhotoLabel: {
		fontSize: 11,
		fontWeight: '700',
		color: COLORS.accent,
		letterSpacing: 1.2,
		textTransform: 'uppercase',
		marginBottom: 4,
	},
	sourcePhotoHint: {
		fontSize: 13,
		color: COLORS.textSecondary,
		lineHeight: 18,
	},

	// ── Section divider ────────────────────────────────────────────────────────
	sectionDivider: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 16,
		paddingVertical: 14,
		gap: 10,
	},
	sectionLine: {
		flex: 1,
		height: StyleSheet.hairlineWidth,
		backgroundColor: COLORS.border,
	},
	sectionLabel: {
		fontSize: 10,
		fontWeight: '700',
		letterSpacing: 2,
		color: COLORS.textMuted,
	},

	// ── FlatList ───────────────────────────────────────────────────────────────
	listContent: {
		paddingHorizontal: CARD_MARGIN,
		paddingTop: 4,
	},
	listFooterSpacer: {
		// Clearance for the sticky action bar (estimated 100dp).
		height: 110,
	},

	// ── Style card ─────────────────────────────────────────────────────────────
	cardTouchable: {
		width: CARD_WIDTH,
		margin: CARD_MARGIN / 2,
	},
	card: {
		width: '100%',
		borderRadius: 14,
		overflow: 'hidden',
		backgroundColor: COLORS.surface,
		borderWidth: 1.5,
		borderColor: COLORS.border,
	},
	cardSelected: {
		borderColor: COLORS.cardSelectedBorder,
		borderWidth: 2,
	},
	cardDisabled: {
		opacity: 0.55,
	},
	cardImageContainer: {
		width: '100%',
		height: CARD_HEIGHT * 0.72,
		backgroundColor: COLORS.bg,
		overflow: 'hidden',
	},
	cardGradient: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		height: 48,
		// Simulated gradient via semi-transparent overlay.
		backgroundColor: 'rgba(14,14,16,0.55)',
	},
	thumbnailSkeleton: {
		backgroundColor: COLORS.surfaceHover,
	},
	// Processing progress overlay
	progressOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: 'rgba(14,14,16,0.72)',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		padding: 12,
	},
	progressInner: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	progressSpinner: {
		// No additional style needed
	},
	progressText: {
		fontSize: 20,
		fontWeight: '800',
		color: COLORS.processing,
		fontVariant: ['tabular-nums'],
	},
	progressBarTrack: {
		width: '80%',
		height: 3,
		borderRadius: 2,
		backgroundColor: COLORS.border,
		overflow: 'hidden',
	},
	progressBarFill: {
		height: '100%',
		borderRadius: 2,
		backgroundColor: COLORS.processing,
	},
	// Download status badge
	unavailableBadge: {
		position: 'absolute',
		top: 8,
		right: 8,
		paddingVertical: 3,
		paddingHorizontal: 7,
		borderRadius: 6,
		backgroundColor: 'rgba(14,14,16,0.75)',
		borderWidth: 1,
		borderColor: COLORS.border,
		alignItems: 'center',
		justifyContent: 'center',
	},
	unavailableBadgeText: {
		fontSize: 10,
		fontWeight: '600',
		color: COLORS.textSecondary,
		letterSpacing: 0.5,
	},
	// Selected badge
	selectedBadge: {
		position: 'absolute',
		top: 8,
		right: 8,
		width: 28,
		height: 28,
		borderRadius: 14,
		backgroundColor: COLORS.accent,
		alignItems: 'center',
		justifyContent: 'center',
	},
	// Card footer
	cardFooter: {
		padding: 10,
		gap: 2,
	},
	cardName: {
		fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
		fontSize: 13,
		fontWeight: '700',
		color: COLORS.textPrimary,
		letterSpacing: 0.1,
	},
	cardSize: {
		fontSize: 11,
		color: COLORS.textMuted,
		letterSpacing: 0.3,
	},

	// ── Empty state ────────────────────────────────────────────────────────────
	emptyContainer: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		padding: 40,
		gap: 14,
	},
	emptyTitle: {
		fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
		fontSize: 20,
		fontWeight: '700',
		color: COLORS.textSecondary,
		textAlign: 'center',
	},
	emptyBody: {
		fontSize: 14,
		color: COLORS.textMuted,
		textAlign: 'center',
		lineHeight: 20,
	},

	// ── Sticky action bar ──────────────────────────────────────────────────────
	actionBar: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 16,
		paddingTop: 14,
		paddingBottom: Platform.OS === 'ios' ? 32 : 20,
		backgroundColor: COLORS.bg,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: COLORS.border,
		gap: 12,
	},
	actionBarInfo: {
		flex: 1,
		justifyContent: 'center',
		gap: 3,
	},
	actionBarStyleName: {
		fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
		fontSize: 15,
		fontWeight: '700',
		color: COLORS.textPrimary,
	},
	actionBarStyleHint: {
		fontSize: 11,
		color: COLORS.textMuted,
		lineHeight: 15,
	},
	actionBarPlaceholder: {
		fontSize: 13,
		color: COLORS.textMuted,
		fontStyle: 'italic',
	},
	applyButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: COLORS.accent,
		borderRadius: 12,
		paddingVertical: 13,
		paddingHorizontal: 18,
		gap: 7,
		minWidth: 180,
		shadowColor: COLORS.accent,
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.35,
		shadowRadius: 10,
		elevation: 8,
	},
	applyButtonDisabled: {
		backgroundColor: COLORS.surface,
		shadowOpacity: 0,
		elevation: 0,
		borderWidth: 1,
		borderColor: COLORS.border,
	},
	applyButtonIcon: {
		// handled via gap on parent
	},
	applyButtonText: {
		fontSize: 14,
		fontWeight: '700',
		color: COLORS.bg,
		letterSpacing: 0.3,
	},
	applyButtonTextDisabled: {
		color: COLORS.textMuted,
	},
})
