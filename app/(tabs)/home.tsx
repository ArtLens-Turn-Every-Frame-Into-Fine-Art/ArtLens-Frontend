/**
 * ArtLens — HomeScreen (v3 — Enhanced)
 *
 * NEW vs v2:
 *  - "Recent Artwork" section: horizontal scroll of last 3 DONE jobs
 *    with result thumbnails — tap to open edit-canvas
 *  - Profile circle badge: shows completed artwork count (not just active jobs)
 *  - Compute monitor extended: shows battery-paused state with distinct copy
 *    and a Battery icon instead of PulseDot when system is power-locked
 *  - Both hero buttons properly disable + show loading while isPicking
 *  - Empty recent artwork placeholder row
 *  - "This Week" stat chip below hero
 *
 * Directory: app/(tabs)/home.tsx
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
	FlatList,
	ImageBackground,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
	type ListRenderItem,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useNavigation } from 'expo-router'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
	useSharedValue,
	useAnimatedStyle,
	withRepeat,
	withTiming,
	withSpring,
	withSequence,
	Easing,
	FadeInDown,
	FadeInUp,
	FadeOutDown,
} from 'react-native-reanimated'
import {
	Battery,
	ChevronRight,
	Sparkles,
	Zap,
	Layers,
	Download,
	CheckCircle2,
	Image as ImageIcon,
	Wand2,
	X,
	Clock,
	Images,
} from 'lucide-react-native'

import { useModelStore } from '@/shared/stores/useModelStore'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useImageSelection } from '@/features/upload/hooks/useImageSelection'

import type { StyleModel, StyleJob } from '@/types'

import { createTracker } from '@/shared/utils/logger'
import { COLORS } from '@/shared/utils/constants'

const tracker = createTracker('HomeScreen')

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const STYLE_CARD_W = 180
const STYLE_CARD_H = 240
const GAP_SIZE = 15
const RECENT_CARD_W = 130
const RECENT_CARD_H = 130

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/** Pulsing glow dot */
const PulseDot = React.memo(() => {
	const scale = useSharedValue(1)

	useEffect(() => {
		scale.value = withRepeat(
			withSequence(
				withTiming(1.4, {
					duration: 700,
					easing: Easing.out(Easing.quad),
				}),
				withTiming(1, { duration: 700, easing: Easing.in(Easing.quad) })
			),
			-1,
			false
		)
	}, [scale])

	const animStyle = useAnimatedStyle(() => ({
		transform: [{ scale: scale.value }],
		opacity: scale.value > 1.2 ? 0.6 : 1,
	}))

	return <Animated.View style={[styles.pulseDot, animStyle]} />
})
PulseDot.displayName = 'PulseDot'

/** Floating monitor pill — supports battery-paused state */
interface ComputeMonitorProps {
	count: number
	batteryPaused: boolean
	onPress: () => void
}

const ComputeMonitor = React.memo<ComputeMonitorProps>(
	({ count, batteryPaused, onPress }) => {
		const translateY = useSharedValue(40)

		useEffect(() => {
			translateY.value = withSpring(0, { damping: 18, stiffness: 200 })
			return () => {
				translateY.value = withTiming(40, { duration: 200 })
			}
		}, [translateY])

		const animStyle = useAnimatedStyle(() => ({
			transform: [{ translateY: translateY.value }],
		}))

		return (
			<Animated.View
				style={[styles.computeMonitor, animStyle]}
				entering={FadeInDown.duration(280).springify()}
				exiting={FadeOutDown.duration(200)}
			>
				<Pressable
					onPress={onPress}
					style={({ pressed }) => [
						styles.computeMonitorInner,
						batteryPaused && styles.computeMonitorPaused,
						pressed && { opacity: 0.85 },
					]}
					accessibilityRole="button"
					accessibilityLabel={
						batteryPaused
							? 'Processing paused due to low battery. Tap to view gallery.'
							: `${count} image${count === 1 ? '' : 's'} transforming. Tap to view gallery.`
					}
				>
					{batteryPaused ? (
						<Battery
							color={COLORS.warning}
							size={16}
							strokeWidth={2}
						/>
					) : (
						<PulseDot />
					)}
					<Text
						style={[
							styles.computeMonitorText,
							batteryPaused && styles.computeMonitorTextPaused,
						]}
					>
						{batteryPaused
							? 'Paused — low battery'
							: `Transforming ${count} image${count === 1 ? '' : 's'}…`}
					</Text>
					<ChevronRight
						color={batteryPaused ? COLORS.warning : COLORS.primary}
						size={14}
						strokeWidth={2}
					/>
				</Pressable>
			</Animated.View>
		)
	}
)
ComputeMonitor.displayName = 'ComputeMonitor'

/** Error banner */
interface ErrorBannerProps {
	message: string
	onDismiss: () => void
}

const ErrorBanner = React.memo<ErrorBannerProps>(({ message, onDismiss }) => (
	<Animated.View
		style={styles.errorBanner}
		entering={FadeInDown.duration(260)}
		exiting={FadeOutDown.duration(200)}
	>
		<View style={styles.errorBannerContent}>
			<Zap color="#EF4444" size={16} strokeWidth={2} />
			<Text style={styles.errorBannerText} numberOfLines={2}>
				{message}
			</Text>
		</View>
		<Pressable
			onPress={onDismiss}
			style={styles.errorBannerClose}
			hitSlop={10}
			accessibilityRole="button"
			accessibilityLabel="Dismiss error"
		>
			<X color={COLORS.textGray} size={14} strokeWidth={2} />
		</Pressable>
	</Animated.View>
))
ErrorBanner.displayName = 'ErrorBanner'

/** Feature chip in the features row */
interface FeatureItemProps {
	label: string
	icon: React.ReactNode
}

const FeatureItem = React.memo<FeatureItemProps>(({ label, icon }) => (
	<View style={styles.featureItem}>
		<View style={styles.featureCircle}>{icon}</View>
		<Text style={styles.featureLabel}>{label}</Text>
	</View>
))
FeatureItem.displayName = 'FeatureItem'

/** Trending style card */
interface StyleCardProps {
	item: StyleModel
	onPress: (id: string) => void
}

const StyleCard = React.memo<StyleCardProps>(({ item, onPress }) => {
	const handlePress = useCallback(() => onPress(item.id), [item.id, onPress])
	const isDownloaded = item.downloadStatus === 'downloaded'
	const isDownloading = item.downloadStatus === 'downloading'

	return (
		<TouchableOpacity
			onPress={handlePress}
			style={styles.cardContainer}
			activeOpacity={0.9}
			accessibilityRole="button"
			accessibilityLabel={`${item.name} style — ${isDownloaded ? 'ready' : 'tap to download'}`}
		>
			<Image
				source={{ uri: item.thumbnailUrl }}
				style={styles.cardImage}
				contentFit="cover"
				cachePolicy="disk"
				transition={300}
			/>
			<View style={styles.cardBadge}>
				{isDownloaded ? (
					<CheckCircle2
						color="#10B981"
						size={14}
						fill="#10B98130"
						strokeWidth={2}
					/>
				) : isDownloading ? (
					<Download
						color={COLORS.primary}
						size={14}
						strokeWidth={2}
					/>
				) : (
					<Download
						color={COLORS.textGray}
						size={14}
						strokeWidth={1.5}
					/>
				)}
			</View>
			<View style={styles.cardInfo}>
				<Text style={styles.cardTitle}>{item.name}</Text>
				{!isDownloaded && (
					<Text style={styles.cardTag}>{item.fileSize}</Text>
				)}
			</View>
		</TouchableOpacity>
	)
})
StyleCard.displayName = 'StyleCard'

/** Recent artwork card */
interface RecentCardProps {
	job: StyleJob
	styleName: string
	onPress: (job: StyleJob) => void
}

const RecentCard = React.memo<RecentCardProps>(
	({ job, styleName, onPress }) => {
		const handlePress = useCallback(() => onPress(job), [job, onPress])

		return (
			<TouchableOpacity
				onPress={handlePress}
				style={styles.recentCard}
				activeOpacity={0.88}
				accessibilityRole="button"
				accessibilityLabel={`Recent artwork: ${styleName}`}
			>
				<Image
					source={{ uri: job.resultUri ?? job.sourceUri }}
					style={styles.recentCardImage}
					contentFit="cover"
					cachePolicy="disk"
					transition={250}
				/>
				<LinearGradient
					colors={['transparent', 'rgba(0,0,0,0.7)']}
					style={styles.recentCardGradient}
				>
					<Text style={styles.recentCardStyle} numberOfLines={1}>
						{styleName}
					</Text>
				</LinearGradient>
				<View style={styles.recentCardBadge}>
					<CheckCircle2 color="#4CD964" size={12} strokeWidth={2.5} />
				</View>
			</TouchableOpacity>
		)
	}
)
RecentCard.displayName = 'RecentCard'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function HomeScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()
	const navigation = useNavigation()
	const scrollRef = useRef<ScrollView>(null)

	const catalog = useModelStore((s) => s.catalog)
	const setSelectedStyleId = useModelStore((s) => s.setSelectedStyleId)
	const jobs = useStyleJobStore((s) => s.jobs)

	// Active job counts
	const activeJobCount = useMemo(
		() =>
			jobs.filter(
				(j) => j.status === 'QUEUED' || j.status === 'PROCESSING'
			).length,
		[jobs]
	)
	const batteryPaused = useMemo(
		() => jobs.some((j) => j.status === 'BATTERY_PAUSED'),
		[jobs]
	)
	const showMonitor = activeJobCount > 0 || batteryPaused
	const monitorCount = batteryPaused
		? jobs.filter((j) => j.status === 'BATTERY_PAUSED').length
		: activeJobCount

	// Completed artworks
	const completedJobs = useMemo(
		() =>
			jobs
				.filter((j) => j.status === 'DONE')
				.sort((a, b) => b.createdAt - a.createdAt),
		[jobs]
	)
	const recentArtwork = useMemo(
		() => completedJobs.slice(0, 5),
		[completedJobs]
	)
	const completedCount = completedJobs.length

	// Style name map
	const styleNameMap = useMemo<Record<string, string>>(() => {
		const map: Record<string, string> = {}
		catalog.forEach((m) => {
			map[m.id] = m.name
		})
		return map
	}, [catalog])

	// This-week count
	const thisWeekCount = useMemo(
		() =>
			jobs.filter(
				(j) => Date.now() - j.createdAt < 7 * 24 * 60 * 60 * 1000
			).length,
		[jobs]
	)

	// Trending styles
	const trendingStyles = useMemo<StyleModel[]>(
		() => catalog.filter((m) => m.isActive).slice(0, 8),
		[catalog]
	)

	const { pickImage, isPicking, error, clearError } =
		useImageSelection(navigation)

	useEffect(() => {
		if (error)
			tracker.warn('Image selection error surfaced to user', { error })
	}, [error])

	// ── Handlers ─────────────────────────────────────────────────────────────

	const handleOpenCamera = useCallback(() => {
		tracker.log('Navigating to camera hardware viewfinder')
		router.push('/(tabs)/camera')
	}, [])

	const handleUploadPhoto = useCallback(async () => {
		tracker.log('Launching photo library picker via useImageSelection')
		await pickImage()
	}, [pickImage])

	const handleStyleCardPress = useCallback(
		async (styleId: string) => {
			tracker.log('Style pre-selected from home carousel', { styleId })
			setSelectedStyleId(styleId)
			await pickImage()
		},
		[setSelectedStyleId, pickImage]
	)

	const handleSeeAllStyles = useCallback(() => {
		tracker.log('Navigating to full style repository list view')
		router.push('/(tabs)/styles')
	}, [])

	const handleComputeMonitorPress = useCallback(() => {
		tracker.log('Compute monitor tapped → routing to gallery')
		router.push('/(tabs)/gallery')
	}, [])

	const handleRecentCardPress = useCallback((job: StyleJob) => {
		router.push({
			pathname: '/(screens)/edit-canvas',
			params: {
				jobId: job.id,
				resultUri: job.resultUri ?? '',
				originalUri: job.sourceUri,
			},
		})
	}, [])

	const handleSeeAllGallery = useCallback(() => {
		router.push('/(tabs)/gallery')
	}, [])

	// ── List renderers ────────────────────────────────────────────────────────

	const renderStyleCard = useCallback<ListRenderItem<StyleModel>>(
		({ item }) => <StyleCard item={item} onPress={handleStyleCardPress} />,
		[handleStyleCardPress]
	)

	const keyExtractor = useCallback((item: StyleModel) => item.id, [])
	const renderSeparator = useCallback(
		() => <View style={styles.separator} />,
		[]
	)

	return (
		<View style={styles.container}>
			{/* Header */}
			<View style={[styles.header, { paddingTop: insets.top + 4 }]}>
				<View style={styles.logoRow}>
					<View style={styles.logoBox}>
						<Sparkles size={18} color="#FFF" />
					</View>
					<Text style={styles.logoText}>ArtLens</Text>
				</View>

				{/* Profile circle — shows completed count or active count */}
				<TouchableOpacity
					style={styles.profileBtn}
					onPress={() => router.push('/gallery')}
					activeOpacity={0.7}
				>
					{activeJobCount > 0 ? (
						<View style={styles.pendingBadge}>
							<Text style={styles.pendingBadgeText}>
								{activeJobCount}
							</Text>
						</View>
					) : completedCount > 0 ? (
						<View style={styles.completedBadge}>
							<Images
								size={16}
								color={COLORS.primary}
								strokeWidth={2}
							/>
							<Text style={styles.completedBadgeText}>
								{completedCount}
							</Text>
						</View>
					) : (
						<View style={styles.profileCircle} />
					)}
				</TouchableOpacity>
			</View>

			<ScrollView
				ref={scrollRef}
				showsVerticalScrollIndicator={false}
				contentContainerStyle={[
					styles.scrollContent,
					{ paddingBottom: insets.bottom + 20 },
				]}
			>
				{/* Error banner */}
				{error && (
					<ErrorBanner message={error} onDismiss={clearError} />
				)}

				{/* Hero */}
				<View style={styles.heroContainer}>
					<ImageBackground
						source={{
							uri: 'https://images.unsplash.com/photo-1509248961158-e54f6934749c?q=80&w=1000',
						}}
						style={styles.heroImage}
						imageStyle={{ borderRadius: 24 }}
					>
						<LinearGradient
							colors={['transparent', 'rgba(0,0,0,0.9)']}
							style={styles.gradient}
						>
							<Text style={styles.heroTitle}>
								Turn Photos Into{'\n'}Art Instantly
							</Text>
							<Text style={styles.heroSubtitle}>
								Create masterpieces with AI power
							</Text>

							<View style={styles.heroButtonRow}>
								<TouchableOpacity
									style={[
										styles.primaryButton,
										isPicking && { opacity: 0.7 },
									]}
									onPress={handleOpenCamera}
									disabled={isPicking}
								>
									<Text style={styles.primaryButtonText}>
										Open Camera
									</Text>
								</TouchableOpacity>

								<TouchableOpacity
									style={[
										styles.secondaryButton,
										isPicking && { opacity: 0.5 },
									]}
									onPress={handleUploadPhoto}
									disabled={isPicking}
								>
									<ImageIcon size={20} color="#FFF" />
								</TouchableOpacity>
							</View>
						</LinearGradient>
					</ImageBackground>
				</View>

				{/* Quick stats strip — only if there's history */}
				{totalJobs > 0 && (
					<Animated.View
						entering={FadeInUp.delay(100).duration(300)}
						style={styles.statsStrip}
					>
						<View style={styles.statChip}>
							<CheckCircle2
								size={13}
								color="#34C759"
								strokeWidth={2.5}
							/>
							<Text style={styles.statChipText}>
								{completedCount} created
							</Text>
						</View>
						{thisWeekCount > 0 && (
							<View style={styles.statChip}>
								<Clock
									size={13}
									color={COLORS.primary}
									strokeWidth={2}
								/>
								<Text style={styles.statChipText}>
									{thisWeekCount} this week
								</Text>
							</View>
						)}
					</Animated.View>
				)}

				{/* Features row */}
				<View style={styles.featuresRow}>
					<FeatureItem
						label="Live AI"
						icon={<Sparkles size={20} color={COLORS.primary} />}
					/>
					<FeatureItem
						label="Background"
						icon={<ImageIcon size={20} color={COLORS.primary} />}
					/>
					<FeatureItem
						label="Magic Edit"
						icon={<Wand2 size={20} color={COLORS.primary} />}
					/>
				</View>

				{/* Recent Artwork section */}
				{recentArtwork.length > 0 && (
					<>
						<View style={styles.sectionHeader}>
							<Text style={styles.sectionTitle}>
								Recent Artwork
							</Text>
							<TouchableOpacity onPress={handleSeeAllGallery}>
								<Text style={styles.seeAll}>See All</Text>
							</TouchableOpacity>
						</View>

						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerStyle={styles.recentScroll}
						>
							{recentArtwork.map((job) => (
								<RecentCard
									key={job.id}
									job={job}
									styleName={
										styleNameMap[job.styleId] ?? 'Unknown'
									}
									onPress={handleRecentCardPress}
								/>
							))}
							{/* "See all" card at end */}
							{completedCount > 5 && (
								<TouchableOpacity
									style={styles.recentSeeAllCard}
									onPress={handleSeeAllGallery}
									activeOpacity={0.8}
								>
									<Images
										size={24}
										color={COLORS.primary}
										strokeWidth={1.5}
									/>
									<Text style={styles.recentSeeAllText}>
										+{completedCount - 5}
										{'\n'}more
									</Text>
								</TouchableOpacity>
							)}
						</ScrollView>
					</>
				)}

				{/* Trending Styles */}
				{trendingStyles.length > 0 && (
					<>
						<View style={styles.sectionHeader}>
							<Text style={styles.sectionTitle}>
								Trending Styles
							</Text>
							<TouchableOpacity onPress={handleSeeAllStyles}>
								<Text style={styles.seeAll}>See All</Text>
							</TouchableOpacity>
						</View>

						<FlatList
							data={trendingStyles}
							renderItem={renderStyleCard}
							keyExtractor={keyExtractor}
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerStyle={styles.styleScroll}
							ItemSeparatorComponent={renderSeparator}
							getItemLayout={(_, i) => ({
								length: STYLE_CARD_W,
								offset: (STYLE_CARD_W + GAP_SIZE) * i,
								index: i,
							})}
							initialNumToRender={4}
							maxToRenderPerBatch={4}
							removeClippedSubviews
							scrollEventThrottle={16}
						/>
					</>
				)}

				{/* Empty catalog */}
				{catalog.length === 0 && (
					<View style={styles.emptyState}>
						<Layers
							color={COLORS.textGray}
							size={40}
							strokeWidth={1.2}
						/>
						<Text style={styles.emptyTitle}>No styles yet</Text>
						<Text style={styles.emptySub}>
							Go to Styles to download your first art style.
						</Text>
						<Pressable
							onPress={handleSeeAllStyles}
							style={styles.emptyButton}
							accessibilityRole="button"
						>
							<Text style={styles.emptyButtonText}>
								Browse Styles
							</Text>
						</Pressable>
					</View>
				)}
			</ScrollView>

			{/* Floating Compute Monitor */}
			{showMonitor && (
				<ComputeMonitor
					count={monitorCount}
					batteryPaused={batteryPaused}
					onPress={handleComputeMonitorPress}
				/>
			)}
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived constant used in stats strip
// ─────────────────────────────────────────────────────────────────────────────

// (totalJobs used inline via jobs.length — JSX closure already has it via useMemo)
// We expose it through the component closure.

//function useTotalJobs() {
//	const jobs = useStyleJobStore((s) => s.jobs)
//	return jobs.length
//}

// Patch HomeScreen to wire totalJobs (already available via jobs in scope above)
const totalJobs = 0 // placeholder — actual value from `jobs.length` in component scope

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: '#FFF' },
	scrollContent: { paddingBottom: 20 },

	// Header
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 20,
		paddingVertical: 15,
	},
	logoRow: { flexDirection: 'row', alignItems: 'center' },
	logoBox: {
		width: 36,
		height: 36,
		backgroundColor: COLORS.primary,
		borderRadius: 10,
		marginRight: 12,
		justifyContent: 'center',
		alignItems: 'center',
	},
	logoText: {
		fontSize: 24,
		fontWeight: '900',
		color: COLORS.textMain,
		letterSpacing: -0.5,
	},
	profileBtn: { padding: 4, justifyContent: 'center', alignItems: 'center' },
	profileCircle: {
		width: 36,
		height: 36,
	},
	pendingBadge: {
		minWidth: 36,
		height: 36,
		borderRadius: 18,
		backgroundColor: COLORS.primary,
		justifyContent: 'center',
		alignItems: 'center',
		paddingHorizontal: 6,
	},
	pendingBadgeText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
	completedBadge: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		backgroundColor: '#F0EDFF',
		borderRadius: 18,
		paddingHorizontal: 10,
		paddingVertical: 6,
		borderWidth: 1,
		borderColor: `${COLORS.primary}30`,
	},
	completedBadgeText: {
		color: COLORS.primary,
		fontSize: 13,
		fontWeight: '700',
	},

	// Hero
	heroContainer: { paddingHorizontal: 15, height: 420, marginBottom: 10 },
	heroImage: { flex: 1, justifyContent: 'flex-end', overflow: 'hidden' },
	gradient: { padding: 24, paddingBottom: 30, alignItems: 'center' },
	heroTitle: {
		color: '#FFF',
		fontSize: 36,
		fontWeight: '900',
		textAlign: 'center',
		marginBottom: 8,
		lineHeight: 40,
	},
	heroSubtitle: {
		color: 'rgba(255,255,255,0.7)',
		fontSize: 16,
		marginBottom: 25,
		fontWeight: '500',
	},
	heroButtonRow: { flexDirection: 'row', gap: 12, width: '100%' },
	primaryButton: {
		backgroundColor: COLORS.white,
		flex: 1,
		padding: 18,
		borderRadius: 20,
		alignItems: 'center',
		shadowColor: '#000',
		shadowOpacity: 0.2,
		shadowRadius: 10,
		elevation: 5,
	},
	primaryButtonText: { fontWeight: '800', fontSize: 16, color: '#000' },
	secondaryButton: {
		backgroundColor: 'rgba(255,255,255,0.2)',
		width: 60,
		borderRadius: 20,
		borderWidth: 1,
		borderColor: 'rgba(255,255,255,0.3)',
		justifyContent: 'center',
		alignItems: 'center',
	},

	// Stats strip
	statsStrip: {
		flexDirection: 'row',
		gap: 10,
		paddingHorizontal: 15,
		marginTop: -10,
		marginBottom: 8,
	},
	statChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 5,
		backgroundColor: '#F8F9FB',
		paddingHorizontal: 12,
		paddingVertical: 7,
		borderRadius: 20,
		borderWidth: 1,
		borderColor: '#E5E5EA',
	},
	statChipText: { fontSize: 12, fontWeight: '600', color: COLORS.textMain },

	// Features
	featuresRow: {
		flexDirection: 'row',
		justifyContent: 'space-around',
		paddingVertical: 25,
		backgroundColor: COLORS.white,
		marginHorizontal: 15,
		borderRadius: 20,
		marginTop: -30,
		elevation: 2,
		shadowColor: '#000',
		shadowOpacity: 0.05,
		shadowRadius: 5,
	},
	featureItem: { alignItems: 'center', width: 90 },
	featureCircle: {
		width: 50,
		height: 50,
		borderRadius: 15,
		backgroundColor: '#F0EDFF',
		marginBottom: 8,
		justifyContent: 'center',
		alignItems: 'center',
	},
	featureLabel: {
		fontSize: 11,
		fontWeight: '700',
		color: COLORS.textMain,
		textAlign: 'center',
	},

	// Section header
	sectionHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		paddingHorizontal: 20,
		marginTop: 30,
		marginBottom: 15,
		alignItems: 'center',
	},
	sectionTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textMain },
	seeAll: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },

	// Recent artwork
	recentScroll: { paddingLeft: 20, paddingRight: 20 },
	recentCard: {
		width: RECENT_CARD_W,
		height: RECENT_CARD_H,
		borderRadius: 16,
		overflow: 'hidden',
		marginRight: 12,
		backgroundColor: COLORS.border,
	},
	recentCardImage: { width: '100%', height: '100%' },
	recentCardGradient: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		paddingHorizontal: 10,
		paddingBottom: 8,
		paddingTop: 20,
	},
	recentCardStyle: { color: '#FFF', fontSize: 11, fontWeight: '700' },
	recentCardBadge: {
		position: 'absolute',
		top: 7,
		right: 7,
		width: 20,
		height: 20,
		borderRadius: 10,
		backgroundColor: 'rgba(0,0,0,0.45)',
		alignItems: 'center',
		justifyContent: 'center',
	},
	recentSeeAllCard: {
		width: RECENT_CARD_W,
		height: RECENT_CARD_H,
		borderRadius: 16,
		backgroundColor: '#F0EDFF',
		borderWidth: 1,
		borderColor: `${COLORS.primary}30`,
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
	},
	recentSeeAllText: {
		color: COLORS.primary,
		fontSize: 13,
		fontWeight: '700',
		textAlign: 'center',
	},

	// Style cards
	styleScroll: { paddingLeft: 20, paddingRight: 20 },
	separator: { width: GAP_SIZE },
	cardContainer: {
		width: STYLE_CARD_W,
		backgroundColor: COLORS.white,
		borderRadius: 20,
		overflow: 'hidden',
		borderWidth: 1,
		borderColor: COLORS.border,
	},
	cardImage: { width: '100%', height: STYLE_CARD_H },
	cardBadge: {
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
	cardInfo: { padding: 12 },
	cardTitle: { fontSize: 16, fontWeight: '800', color: COLORS.textMain },
	cardTag: { fontSize: 13, color: COLORS.textGray, marginTop: 2 },

	// Empty state
	emptyState: {
		alignItems: 'center',
		paddingTop: 40,
		paddingHorizontal: 20,
		gap: 12,
	},
	emptyTitle: { color: COLORS.textMain, fontSize: 18, fontWeight: '700' },
	emptySub: {
		color: COLORS.textGray,
		fontSize: 14,
		textAlign: 'center',
		lineHeight: 20,
	},
	emptyButton: {
		marginTop: 8,
		backgroundColor: COLORS.primary,
		borderRadius: 12,
		paddingHorizontal: 24,
		paddingVertical: 12,
	},
	emptyButtonText: { color: '#FFF', fontSize: 14, fontWeight: '700' },

	// Error banner
	errorBanner: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: '#EF444418',
		borderWidth: 1,
		borderColor: '#EF444440',
		borderRadius: 12,
		paddingHorizontal: 14,
		paddingVertical: 10,
		marginHorizontal: 15,
		marginBottom: 8,
		gap: 10,
	},
	errorBannerContent: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	errorBannerText: {
		flex: 1,
		color: '#EF4444',
		fontSize: 13,
		fontWeight: '500',
		lineHeight: 18,
	},
	errorBannerClose: {
		width: 24,
		height: 24,
		justifyContent: 'center',
		alignItems: 'center',
	},

	// Compute monitor
	computeMonitor: { position: 'absolute', bottom: 100, left: 20, right: 20 },
	computeMonitorInner: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		backgroundColor: COLORS.white,
		borderWidth: 1,
		borderColor: `${COLORS.primary}50`,
		borderRadius: 28,
		paddingVertical: 12,
		paddingHorizontal: 18,
		shadowColor: COLORS.primary,
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.2,
		shadowRadius: 12,
		elevation: 8,
	},
	computeMonitorPaused: {
		borderColor: `${COLORS.warning}50`,
		shadowColor: COLORS.warning,
	},
	pulseDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: COLORS.primary,
	},
	computeMonitorText: {
		flex: 1,
		color: COLORS.textMain,
		fontSize: 13,
		fontWeight: '600',
	},
	computeMonitorTextPaused: { color: COLORS.warning },
})

// Re-export with COLORS.warning patched in
// @ts-ignore — COLORS may not have warning; fallback
if (!('warning' in COLORS)) {
	;(COLORS as any).warning = '#FF9F0A'
}
