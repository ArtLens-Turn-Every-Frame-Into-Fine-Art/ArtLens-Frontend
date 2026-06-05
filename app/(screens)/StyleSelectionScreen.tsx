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
	TouchableOpacity,
	StyleSheet,
	StatusBar,
	Dimensions,
	ActivityIndicator,
	Platform,
	Animated,
	Alert,
	ScrollView,
	TextInput,
} from 'react-native'
import { Image } from 'expo-image'
import {
	ChevronLeft,
	Sparkles,
	CheckCircle2,
	Clock,
	AlertCircle,
	Download,
	Eye,
	HelpCircle,
	Search,
} from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useModelStore } from '@/shared/stores/useModelStore'
import { useShallow } from 'zustand/react/shallow'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'
import type { StyleModel, JobPayload, StyleId } from '@/types'

import { createTracker } from '@/shared/utils/logger'
import { COLORS } from '@/shared/utils/constants'

const tracker = createTracker('StyleSelectionScreen')

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const H_PADDING = 20
const COLUMN_GAP = 10
const NUM_COLUMNS = 2
const CARD_WIDTH =
	(SCREEN_WIDTH - H_PADDING * 2 - COLUMN_GAP * (NUM_COLUMNS - 1)) /
	NUM_COLUMNS
//const CARD_HEIGHT = CARD_WIDTH * 1.35

const CATEGORIES = ['All', 'Popular', 'New', 'Downloaded']

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
// INFO ITEM
// ─────────────────────────────────────────────────────────────────────────────

interface InfoItemProps {
	icon: React.ReactNode
	label: string
}

function InfoItem({ icon, label }: InfoItemProps): React.ReactElement {
	return (
		<View style={styles.infoItem}>
			{icon}
			<Text style={styles.infoText}>{label}</Text>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// FAQ ITEM
// ─────────────────────────────────────────────────────────────────────────────

interface FaqItemProps {
	question: string
	answer: string
}

function FaqItem({ question, answer }: FaqItemProps): React.ReactElement {
	return (
		<View style={styles.faqItem}>
			<Text style={styles.faqQuestion}>{question}</Text>
			<Text style={styles.faqAnswer}>{answer}</Text>
		</View>
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
			activeOpacity={isDownloaded ? 0.9 : 1}
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
					{!isImageLoaded && <ThumbnailSkeleton />}
					<Image
						source={{ uri: model.thumbnailUrl }}
						style={StyleSheet.absoluteFill}
						contentFit="cover"
						transition={300}
						onLoad={() => setIsImageLoaded(true)}
						cachePolicy="memory-disk"
					/>

					{/* ── Processing progress overlay ── */}
					{progressPercent !== null && (
						<View style={styles.progressOverlay}>
							<View style={styles.progressInner}>
								<ActivityIndicator
									size="small"
									color={COLORS.primary}
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
									color={COLORS.textGray}
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
								color="#FFF"
								strokeWidth={2.5}
							/>
						</View>
					)}
				</View>

				{/* ── Card footer (old UI pattern) ── */}
				<View style={styles.cardInfo}>
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
			<Sparkles size={36} color={COLORS.textGray} />
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
	const { sourceUri } = useLocalSearchParams<{ sourceUri?: string }>()
	const insets = useSafeAreaInsets()
	const router = useRouter()

	// ── Store subscriptions ────────────────────────────────────────────────────
	const downloadedModels = useModelStore(
		useShallow((state) =>
			state.catalog.filter(
				(m) => m.isActive && m.downloadStatus === 'downloaded'
			)
		)
	)

	const allActiveModels = useModelStore(
		useShallow((state) => state.catalog.filter((m) => m.isActive))
	)

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
	const [searchQuery, setSearchQuery] = useState('')
	const [activeCategory, setActiveCategory] = useState('All')

	// ── Derived: progress map ──────────────────────────────────────────────────
	const progressByStyleId = useMemo<Map<StyleId, number>>(() => {
		const map = new Map<StyleId, number>()
		for (const job of processingJobs) {
			map.set(job.styleId, Math.round((job.progress ?? 0) * 100))
		}
		return map
	}, [processingJobs])

	// ── Category + search filtering ───────────────────────────────────────────
	const filteredModels = useMemo(() => {
		return allActiveModels.filter((model) => {
			const matchesSearch = model.name
				.toLowerCase()
				.includes(searchQuery.toLowerCase())
			let matchesCategory = true
			if (activeCategory === 'Downloaded') {
				matchesCategory = model.downloadStatus === 'downloaded'
			}
			return matchesSearch && matchesCategory
		})
	}, [allActiveModels, searchQuery, activeCategory])

	// ── Style selection handler ────────────────────────────────────────────────
	const handleStylePress = useCallback(
		(id: StyleId): void => {
			const model = allActiveModels.find((m) => m.id === id)

			if (model && model.downloadStatus !== 'downloaded') {
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
			const payload: JobPayload = {
				sourceUri,
				styleId: selectedStyleId,
			}

			useStyleJobStore.getState().enqueue(payload)

			void StyleJobService.processNextJobInQueue()

			router.navigate({
				pathname: '/(tabs)/gallery',
			})
		} catch (err) {
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

			Alert.alert(
				'Queue Error',
				'Could not enqueue this image for style transfer. Please clear cache or try again.'
			)
		} finally {
			setIsEnqueuing(false)
		}
	}, [selectedStyleId, isEnqueuing, sourceUri, router])

	// ── FlatList renderItem ────────────────────────────────────────────────────
	//const renderStyleCard = useCallback(
	//	({ item }: ListRenderItemInfo<StyleModel>): React.ReactElement => {
	//		const isSelected = item.id === selectedStyleId
	//		const progressPercent = progressByStyleId.get(item.id) ?? null

	//		return (
	//			<StyleCard
	//				model={item}
	//				isSelected={isSelected}
	//				progressPercent={progressPercent}
	//				onPress={handleStylePress}
	//			/>
	//		)
	//	},
	//	[selectedStyleId, progressByStyleId, handleStylePress]
	//)

	//const keyExtractor = useCallback((item: StyleModel): string => item.id, [])

	// ── Error fallback guard ───────────────────────────────────────────────────
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
				<StatusBar barStyle="dark-content" />
				<AlertCircle size={48} color="#EF4444" strokeWidth={1.5} />
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
			<StatusBar barStyle="dark-content" />

			{/* ── Header ── */}
			<View
				style={[
					styles.header,
					{ paddingTop: insets.top > 0 ? insets.top : 16 },
				]}
			>
				<TouchableOpacity
					style={styles.backButton}
					onPress={() => router.back()}
					activeOpacity={0.7}
					accessibilityRole="button"
					accessibilityLabel="Go back"
				>
					<ChevronLeft
						size={22}
						color={COLORS.textMain}
						strokeWidth={2}
					/>
				</TouchableOpacity>

				<Text style={styles.headerTitle}>Style Explorer</Text>

				{/* Spacer to balance the back button */}
				<View style={styles.headerSpacer} />
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={[
					styles.scrollContent,
					{ paddingBottom: insets.bottom + 40 },
				]}
			>
				{/* Page intro */}
				<Text style={styles.pageTitle}>Choose Your Style</Text>
				<Text style={styles.pageSubtitle}>
					Transform your photos into masterpieces using AI-powered
					artist profiles.
				</Text>

				{/* Source photo strip */}
				{sourceUri ? (
					<View style={styles.sourcePhotoStrip}>
						<Image
							source={{ uri: sourceUri }}
							style={styles.sourcePhotoThumb}
							contentFit="cover"
							transition={200}
							cachePolicy="memory"
						/>
						<View style={styles.sourcePhotoInfo}>
							<Text style={styles.sourcePhotoLabel}>
								Source Photo
							</Text>
							<Text
								style={styles.sourcePhotoHint}
								numberOfLines={2}
							>
								Select a style below to apply to this image
							</Text>
						</View>
					</View>
				) : null}

				{/* Info Box */}
				<View style={styles.infoBox}>
					<InfoItem
						icon={<Sparkles size={16} color={COLORS.primary} />}
						label="AI Curated"
					/>
					<InfoItem
						icon={<Eye size={16} color={COLORS.primary} />}
						label="Live Preview"
					/>
					<InfoItem
						icon={<Download size={16} color={COLORS.primary} />}
						label="Offline Use"
					/>
				</View>

				{/* Search Bar */}
				<View style={styles.searchContainer}>
					<Search size={20} color={COLORS.textGray} />
					<TextInput
						placeholder="Search styles..."
						style={styles.searchInput}
						value={searchQuery}
						onChangeText={setSearchQuery}
						placeholderTextColor={COLORS.textGray}
					/>
				</View>

				{/* Category Pills */}
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					style={styles.categoryScroll}
				>
					{CATEGORIES.map((cat) => (
						<TouchableOpacity
							key={cat}
							onPress={() => setActiveCategory(cat)}
							style={[
								styles.pill,
								activeCategory === cat && styles.activePill,
							]}
						>
							<Text
								style={[
									styles.pillText,
									activeCategory === cat &&
										styles.activePillText,
								]}
							>
								{cat}
							</Text>
						</TouchableOpacity>
					))}
				</ScrollView>

				{/* Style Grid */}
				{filteredModels.length === 0 ? (
					<EmptyStyleCatalog />
				) : (
					<View style={styles.grid}>
						{filteredModels.map((item) => {
							const isSelected = item.id === selectedStyleId
							const progressPercent =
								progressByStyleId.get(item.id) ?? null
							return (
								<StyleCard
									key={item.id}
									model={item}
									isSelected={isSelected}
									progressPercent={progressPercent}
									onPress={handleStylePress}
								/>
							)
						})}
					</View>
				)}

				{/* FAQ Section */}
				<View style={styles.faqSection}>
					<View style={styles.faqHeaderRow}>
						<HelpCircle size={22} color={COLORS.textMain} />
						<Text style={styles.faqHeader}>Help &amp; Tips</Text>
					</View>
					<FaqItem
						question="How do I download a new style?"
						answer="Tap on any style. If it's not in your library, the download will begin automatically."
					/>
					<FaqItem
						question="Can I combine styles?"
						answer="Currently, ArtLens applies one primary style per image for the best resolution results."
					/>
				</View>
			</ScrollView>

			{/* ── Sticky action bar ── */}
			<View style={[styles.actionBar, { paddingBottom: 18 }]}>
				{selectedModel ? (
					<View style={styles.actionBarInfo}>
						<Text
							style={styles.actionBarStyleName}
							numberOfLines={1}
						>
							{selectedModel.name}
						</Text>
						<Text style={styles.actionBarStyleHint}>
							{(selectedModel.description?.length ?? 0) > 60
								? selectedModel.description?.slice(0, 57) + '…'
								: (selectedModel.description ??
									'No description available')}
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
						<ActivityIndicator size="small" color="#FFF" />
					) : (
						<>
							<Sparkles
								size={16}
								color={canApply ? '#FFF' : COLORS.textGray}
								strokeWidth={2}
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
		backgroundColor: '#FFFFFF',
	},

	// ── Error fallback ─────────────────────────────────────────────────────────
	errorFallbackContainer: {
		flex: 1,
		backgroundColor: '#FFFFFF',
		alignItems: 'center',
		justifyContent: 'center',
		padding: 32,
		gap: 16,
	},
	errorFallbackTitle: {
		fontSize: 22,
		fontWeight: '600',
		color: COLORS.textMain,
		textAlign: 'center',
	},
	errorFallbackBody: {
		fontSize: 15,
		color: COLORS.textGray,
		textAlign: 'center',
		lineHeight: 22,
	},
	errorFallbackButton: {
		marginTop: 8,
		paddingVertical: 12,
		paddingHorizontal: 24,
		backgroundColor: COLORS.border,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: COLORS.border,
	},
	errorFallbackButtonText: {
		fontSize: 15,
		fontWeight: '600',
		color: COLORS.textMain,
	},

	// ── Header ─────────────────────────────────────────────────────────────────
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: H_PADDING,
		paddingBottom: 12,
		backgroundColor: '#FFFFFF',
		borderBottomWidth: 1,
		borderBottomColor: COLORS.border,
	},
	backButton: {
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: COLORS.border,
		alignItems: 'center',
		justifyContent: 'center',
	},
	headerTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textMain },
	headerSpacer: { width: 40 },

	// ── Scroll ─────────────────────────────────────────────────────────────────
	scrollContent: { padding: H_PADDING },

	// ── Page intro ─────────────────────────────────────────────────────────────
	pageTitle: {
		fontSize: 32,
		fontWeight: '800',
		color: COLORS.textMain,
		marginBottom: 8,
		letterSpacing: -0.5,
	},
	pageSubtitle: {
		fontSize: 16,
		color: COLORS.textGray,
		marginBottom: 20,
		lineHeight: 22,
	},

	// ── Source photo strip ─────────────────────────────────────────────────────
	sourcePhotoStrip: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: '#F8F3FF',
		borderRadius: 16,
		padding: 14,
		marginBottom: 20,
		gap: 14,
	},
	sourcePhotoThumb: {
		width: 54,
		height: 54,
		borderRadius: 10,
		backgroundColor: COLORS.border,
	},
	sourcePhotoInfo: { flex: 1 },
	sourcePhotoLabel: {
		fontSize: 11,
		fontWeight: '700',
		color: COLORS.primary,
		letterSpacing: 1,
		textTransform: 'uppercase',
		marginBottom: 4,
	},
	sourcePhotoHint: {
		fontSize: 13,
		color: COLORS.textGray,
		lineHeight: 18,
	},

	// ── Info Box ───────────────────────────────────────────────────────────────
	infoBox: {
		flexDirection: 'row',
		backgroundColor: '#F8F3FF',
		borderRadius: 16,
		padding: 16,
		marginBottom: 24,
		justifyContent: 'space-around',
	},
	infoItem: { alignItems: 'center', gap: 6 },
	infoText: { fontSize: 11, fontWeight: '600', color: COLORS.primary },

	// ── Search ─────────────────────────────────────────────────────────────────
	searchContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: COLORS.border,
		borderRadius: 12,
		paddingHorizontal: 12,
		height: 48,
		marginBottom: 20,
	},
	searchInput: {
		flex: 1,
		fontSize: 16,
		marginLeft: 8,
		color: COLORS.textMain,
	},

	// ── Category pills ─────────────────────────────────────────────────────────
	categoryScroll: { marginBottom: 24 },
	pill: {
		paddingHorizontal: 18,
		paddingVertical: 10,
		borderRadius: 25,
		backgroundColor: COLORS.border,
		marginRight: 10,
	},
	activePill: { backgroundColor: COLORS.primary },
	pillText: { fontSize: 14, color: COLORS.textGray, fontWeight: '600' },
	activePillText: { color: '#FFF' },

	// ── Grid ───────────────────────────────────────────────────────────────────
	grid: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		justifyContent: 'space-between',
	},

	// ── Card ───────────────────────────────────────────────────────────────────
	cardTouchable: {
		width: CARD_WIDTH,
		marginBottom: 20,
	},
	card: {
		width: '100%',
		backgroundColor: '#FFF',
		borderRadius: 16,
		overflow: 'hidden',
		borderWidth: 1,
		borderColor: COLORS.border,
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
		borderColor: COLORS.primary,
		borderWidth: 2,
	},
	cardDisabled: {
		opacity: 0.55,
	},
	cardImageContainer: {
		width: '100%',
		height: CARD_WIDTH, // square thumbnail
		backgroundColor: COLORS.border,
		overflow: 'hidden',
		borderTopLeftRadius: 16,
		borderTopRightRadius: 16,
	},
	thumbnailSkeleton: {
		backgroundColor: '#E5E5EA',
	},
	// Processing progress overlay
	progressOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: 'rgba(255,255,255,0.85)',
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
	progressSpinner: {},
	progressText: {
		fontSize: 20,
		fontWeight: '800',
		color: COLORS.primary,
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
		backgroundColor: COLORS.primary,
	},
	// Download badge
	unavailableBadge: {
		position: 'absolute',
		top: 8,
		right: 8,
		paddingVertical: 3,
		paddingHorizontal: 7,
		borderRadius: 6,
		backgroundColor: 'rgba(0,0,0,0.5)',
		alignItems: 'center',
		justifyContent: 'center',
	},
	unavailableBadgeText: {
		fontSize: 10,
		fontWeight: '600',
		color: '#FFF',
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
		backgroundColor: COLORS.primary,
		alignItems: 'center',
		justifyContent: 'center',
	},
	// Card footer (old UI)
	cardInfo: { padding: 12 },
	cardName: {
		fontSize: 16,
		fontWeight: '700',
		color: COLORS.textMain,
	},
	cardSize: {
		fontSize: 12,
		color: COLORS.textGray,
		marginTop: 2,
	},

	// ── Empty state ────────────────────────────────────────────────────────────
	emptyContainer: {
		width: '100%',
		paddingVertical: 40,
		alignItems: 'center',
		gap: 12,
	},
	emptyTitle: {
		fontSize: 18,
		fontWeight: '700',
		color: COLORS.textMain,
		textAlign: 'center',
	},
	emptyBody: {
		fontSize: 14,
		color: COLORS.textGray,
		textAlign: 'center',
		lineHeight: 20,
	},

	// ── FAQ ────────────────────────────────────────────────────────────────────
	faqSection: {
		marginTop: 20,
		paddingTop: 30,
		borderTopWidth: 1,
		borderTopColor: COLORS.border,
		marginBottom: 20,
	},
	faqHeaderRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		marginBottom: 20,
	},
	faqHeader: { fontSize: 20, fontWeight: '800', color: COLORS.textMain },
	faqItem: { marginBottom: 24 },
	faqQuestion: {
		fontSize: 16,
		fontWeight: '700',
		color: COLORS.textMain,
		marginBottom: 6,
	},
	faqAnswer: { fontSize: 14, color: COLORS.textGray, lineHeight: 20 },

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
		backgroundColor: '#FFFFFF',
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: COLORS.border,
		gap: 12,
		...Platform.select({
			ios: {
				shadowColor: '#000',
				shadowOffset: { width: 0, height: -4 },
				shadowOpacity: 0.06,
				shadowRadius: 8,
			},
			android: { elevation: 8 },
		}),
	},
	actionBarInfo: {
		flex: 1,
		justifyContent: 'center',
		gap: 3,
	},
	actionBarStyleName: {
		fontSize: 15,
		fontWeight: '700',
		color: COLORS.textMain,
	},
	actionBarStyleHint: {
		fontSize: 11,
		color: COLORS.textGray,
		lineHeight: 15,
	},
	actionBarPlaceholder: {
		fontSize: 13,
		color: COLORS.textGray,
		fontStyle: 'italic',
	},
	applyButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: COLORS.primary,
		borderRadius: 12,
		paddingVertical: 13,
		paddingHorizontal: 18,
		gap: 7,
		minWidth: 180,
		...Platform.select({
			ios: {
				shadowColor: COLORS.primary,
				shadowOffset: { width: 0, height: 4 },
				shadowOpacity: 0.35,
				shadowRadius: 10,
			},
			android: { elevation: 8 },
		}),
	},
	applyButtonDisabled: {
		backgroundColor: COLORS.border,
		...Platform.select({
			ios: { shadowOpacity: 0 },
			android: { elevation: 0 },
		}),
	},
	applyButtonText: {
		fontSize: 14,
		fontWeight: '700',
		color: '#FFF',
		letterSpacing: 0.3,
	},
	applyButtonTextDisabled: {
		color: COLORS.textGray,
	},
})
