/**
 * ArtLens — HomeScreen (v2 — Full Spec Implementation)
 *
 * Features:
 *  - Branded premium hero header
 *  - Open Camera + Upload Photo quick-action row
 *  - Trending styles horizontal carousel with download status indicators
 *  - Style card selection → setSelectedStyleId + pickImage() orchestration
 *  - Floating animated compute monitor (PROCESSING/QUEUED jobs)
 *  - Error boundary alert for image selection failures
 *  - "See All" CTA → StyleSelection
 *
 * PRD § 3.1 — HomeScreen
 * Directory: app/(tabs)/home.tsx
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
	FlatList,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
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
	FadeOutDown,
} from 'react-native-reanimated'
import {
	Camera,
	Upload,
	ChevronRight,
	Sparkles,
	Zap,
	Layers,
	Download,
	CheckCircle2,
	Image as ImageIcon,
	X,
} from 'lucide-react-native'

// — Store imports ——————————————————————————————————————————————————————————————
import { useModelStore } from '@/shared/stores/useModelStore'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'

// — Hook imports ———————————————————————————————————————————————————————————————
import { useImageSelection } from '@/features/upload/hooks/useImageSelection'

// — Type imports ———————————————————————————————————————————————————————————————
import type { StyleModel } from '@/types'

import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('HomeScreen')

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
	accent: '#C026D3',
	gold: '#D97706',
	goldLight: '#F59E0B',
	text: '#F4F4FF',
	textMuted: '#7070A0',
	textDim: '#40405A',
	success: '#059669',
	downloaded: '#10B981',
	error: '#EF4444',
	inactive: '#52526A',
} as const

const STYLE_CARD_W = 140
const STYLE_CARD_H = 186
const H_PADDING = 20
const GAP_SIZE = 12

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/** Pulsing glow dot used in the floating compute monitor */
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

/** Floating monitor pill shown when jobs are active */
interface ComputeMonitorProps {
	count: number
	onPress: () => void
}

const ComputeMonitor = React.memo<ComputeMonitorProps>(({ count, onPress }) => {
	const translateY = useSharedValue(40)

	useEffect(() => {
		translateY.value = withSpring(0, {
			damping: 18,
			stiffness: 200,
		})
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
					pressed && { opacity: 0.85 },
				]}
				accessibilityRole="button"
				accessibilityLabel={`${count} image${count === 1 ? '' : 's'} transforming. Tap to view gallery.`}
			>
				<PulseDot />
				<Text style={styles.computeMonitorText}>
					Transforming {count} image{count === 1 ? '' : 's'}…
				</Text>
				<ChevronRight color={C.primaryGlow} size={14} strokeWidth={2} />
			</Pressable>
		</Animated.View>
	)
})
ComputeMonitor.displayName = 'ComputeMonitor'

/** Error banner shown when image selection fails */
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
			<Zap color={C.error} size={16} strokeWidth={2} />
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
			<X color={C.textMuted} size={14} strokeWidth={2} />
		</Pressable>
	</Animated.View>
))
ErrorBanner.displayName = 'ErrorBanner'

/** Quick-action row card */
interface QuickActionProps {
	icon: React.ReactNode
	label: string
	sub: string
	onPress: () => void
	loading?: boolean
	tint?: string
}

const QuickAction = React.memo<QuickActionProps>(
	({ icon, label, sub, onPress, loading = false, tint = C.primary }) => (
		<Pressable
			onPress={onPress}
			disabled={loading}
			style={({ pressed }) => [
				styles.quickAction,
				pressed && styles.quickActionPressed,
				loading && { opacity: 0.6 },
			]}
			android_ripple={{ color: `${tint}33`, borderless: false }}
			accessibilityRole="button"
			accessibilityLabel={label}
		>
			<View
				style={[
					styles.quickActionIcon,
					{ backgroundColor: `${tint}20`, borderColor: `${tint}40` },
				]}
			>
				{icon}
			</View>
			<View style={styles.quickActionText}>
				<Text style={styles.quickActionLabel}>{label}</Text>
				<Text style={styles.quickActionSub}>
					{loading ? 'Opening…' : sub}
				</Text>
			</View>
			<ChevronRight color={C.textDim} size={16} strokeWidth={1.5} />
		</Pressable>
	)
)
QuickAction.displayName = 'QuickAction'

/** Trending style card with download status indicator */
interface StyleCardProps {
	item: StyleModel
	onPress: (id: string) => void
}

const StyleCard = React.memo<StyleCardProps>(({ item, onPress }) => {
	const handlePress = useCallback(() => onPress(item.id), [item.id, onPress])
	const isDownloaded = item.downloadStatus === 'downloaded'
	const isDownloading = item.downloadStatus === 'downloading'

	return (
		<Pressable
			onPress={handlePress}
			style={({ pressed }) => [
				styles.styleCard,
				pressed && styles.styleCardPressed,
			]}
			accessibilityRole="button"
			accessibilityLabel={`${item.name} style — ${isDownloaded ? 'ready' : 'tap to download'}`}
		>
			{/* Thumbnail */}
			<Image
				source={{ uri: item.thumbnailUrl }}
				style={styles.styleCardImage}
				contentFit="cover"
				cachePolicy="disk"
				transition={300}
				accessibilityLabel={`${item.name} art style preview`}
			/>

			{/* Bottom gradient overlay */}
			<LinearGradient
				colors={['transparent', 'rgba(0,0,0,0.88)']}
				style={StyleSheet.absoluteFill}
				start={{ x: 0, y: 0.35 }}
				end={{ x: 0, y: 1 }}
			/>

			{/* Download status badge — top-right corner */}
			<View style={styles.styleCardBadge}>
				{isDownloaded ? (
					<CheckCircle2
						color={C.downloaded}
						size={14}
						fill={`${C.downloaded}30`}
						strokeWidth={2}
					/>
				) : isDownloading ? (
					<Download color={C.primaryGlow} size={14} strokeWidth={2} />
				) : (
					<Download color={C.inactive} size={14} strokeWidth={1.5} />
				)}
			</View>

			{/* Name + size footer */}
			<View style={styles.styleCardOverlay}>
				<Text style={styles.styleCardName} numberOfLines={2}>
					{item.name}
				</Text>
				{!isDownloaded && (
					<Text style={styles.styleCardSize}>{item.fileSize}</Text>
				)}
			</View>
		</Pressable>
	)
})
StyleCard.displayName = 'StyleCard'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function HomeScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()
	const navigation = useNavigation()
	const scrollRef = useRef<ScrollView>(null)

	// ── Zustand selectors (atomic design patterns) ──
	const catalog = useModelStore((s) => s.catalog)
	const setSelectedStyleId = useModelStore((s) => s.setSelectedStyleId)
	const jobs = useStyleJobStore((s) => s.jobs)

	// ── Active job count for the floating compute monitor ─────────────────────
	const activeJobCount = useMemo(
		() =>
			jobs.filter(
				(j) => j.status === 'QUEUED' || j.status === 'PROCESSING'
			).length,
		[jobs]
	)

	// ── Trending styles: first 8 active catalog entries ───────────────────────
	const trendingStyles = useMemo<StyleModel[]>(
		() => catalog.filter((m) => m.isActive).slice(0, 8),
		[catalog]
	)

	// ── Image selection hook ──────────────────────────────────────────────────
	const { pickImage, isPicking, error, clearError } =
		useImageSelection(navigation)

	useEffect(() => {
		if (error) {
			tracker.warn('Image selection error surfaced to user', { error })
		}
	}, [error])

	// ─────────────────────────────────────────────────────────────────────────
	// HANDLERS
	// ─────────────────────────────────────────────────────────────────────────

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

	// ─────────────────────────────────────────────────────────────────────────
	// LIST RENDERERS
	// ─────────────────────────────────────────────────────────────────────────

	const renderStyleCard = useCallback<ListRenderItem<StyleModel>>(
		({ item }) => <StyleCard item={item} onPress={handleStyleCardPress} />,
		[handleStyleCardPress]
	)

	const keyExtractor = useCallback((item: StyleModel) => item.id, [])
	const renderSeparator = useCallback(
		() => <View style={styles.separator} />,
		[]
	)

	// ─────────────────────────────────────────────────────────────────────────
	// RENDER
	// ─────────────────────────────────────────────────────────────────────────

	return (
		<View style={[styles.screen, { backgroundColor: C.bg }]}>
			<ScrollView
				ref={scrollRef}
				style={styles.scroll}
				contentContainerStyle={[
					styles.scrollContent,
					{
						paddingTop: insets.top + 16,
						paddingBottom: insets.bottom + 120,
					},
				]}
				showsVerticalScrollIndicator={false}
			>
				{/* ── Error Banner ─────────────────────────────────────────────── */}
				{error && (
					<ErrorBanner message={error} onDismiss={clearError} />
				)}

				{/* ── Header ──────────────────────────────────────────────────── */}
				<View style={styles.header}>
					<View>
						<View style={styles.brandRow}>
							<Sparkles
								color={C.primaryMid}
								size={17}
								fill={`${C.primaryMid}35`}
							/>
							<Text style={styles.brandName}>ArtLens</Text>
						</View>
						<Text style={styles.heroHeadline}>
							Turn every frame{'\n'}into fine art.
						</Text>
					</View>

					{activeJobCount > 0 && (
						<Pressable
							onPress={handleComputeMonitorPress}
							style={styles.pendingBadge}
							accessibilityRole="button"
							accessibilityLabel={`${activeJobCount} jobs processing, tap to view`}
						>
							<Text style={styles.pendingBadgeText}>
								{activeJobCount}
							</Text>
						</Pressable>
					)}
				</View>

				{/* ── Hero gradient strip ─────────────────────────────────────── */}
				<LinearGradient
					colors={[`${C.primary}22`, `${C.accent}12`, 'transparent']}
					style={styles.heroStrip}
					start={{ x: 0, y: 0 }}
					end={{ x: 1, y: 1 }}
				>
					<ImageIcon
						color={`${C.primaryGlow}80`}
						size={14}
						strokeWidth={1.5}
					/>
					<Text style={styles.heroSub}>
						On-device AI · No cloud · No waiting
					</Text>
				</LinearGradient>

				{/* ── Quick Actions ────────────────────────────────────────────── */}
				<View style={[styles.section, styles.quickActions]}>
					<QuickAction
						icon={
							<Camera
								color={C.primaryGlow}
								size={22}
								strokeWidth={1.6}
							/>
						}
						label="Open Camera"
						sub="Live style preview"
						onPress={handleOpenCamera}
						tint={C.primary}
					/>
					<View style={styles.quickActionDivider} />
					<QuickAction
						icon={
							<Upload
								color={C.goldLight}
								size={22}
								strokeWidth={1.6}
							/>
						}
						label="Upload Photo"
						sub="From your gallery"
						onPress={handleUploadPhoto}
						loading={isPicking}
						tint={C.gold}
					/>
				</View>

				{/* ── Trending Styles ──────────────────────────────────────────── */}
				{trendingStyles.length > 0 && (
					<View style={styles.section}>
						<View style={styles.sectionHeader}>
							<Text style={styles.sectionTitle}>
								Trending styles
							</Text>
							<Pressable
								onPress={handleSeeAllStyles}
								style={styles.seeAll}
								accessibilityRole="button"
								accessibilityLabel="See all styles"
								hitSlop={12}
							>
								<Text style={styles.seeAllText}>See all</Text>
								<ChevronRight
									color={C.primaryMid}
									size={14}
									strokeWidth={2}
								/>
							</Pressable>
						</View>

						<FlatList
							data={trendingStyles}
							renderItem={renderStyleCard}
							keyExtractor={keyExtractor}
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerStyle={styles.stylesListContent}
							ItemSeparatorComponent={renderSeparator}
							// FIXED: Sized to individual inner component dimension logic maps
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
					</View>
				)}

				{/* ── Empty catalog prompt ─────────────────────────────────────── */}
				{catalog.length === 0 && (
					<View style={styles.emptyState}>
						<Layers color={C.textDim} size={40} strokeWidth={1.2} />
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

			{/* ── Floating Compute Monitor ─────────────────────────────────────── */}
			{activeJobCount > 0 && (
				<ComputeMonitor
					count={activeJobCount}
					onPress={handleComputeMonitorPress}
				/>
			)}
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: {
		flex: 1,
	},
	scroll: {
		flex: 1,
	},
	scrollContent: {
		paddingHorizontal: H_PADDING,
	},
	separator: {
		width: GAP_SIZE,
	},

	// ── Error Banner ───────────────────────────────────────────────────────────
	errorBanner: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: `${C.error}18`,
		borderWidth: 1,
		borderColor: `${C.error}40`,
		borderRadius: 12,
		paddingHorizontal: 14,
		paddingVertical: 10,
		marginBottom: 16,
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
		color: C.error,
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

	// ── Header ─────────────────────────────────────────────────────────────────
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'flex-start',
		marginBottom: 20,
	},
	brandRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		marginBottom: 8,
	},
	brandName: {
		color: C.primaryMid,
		fontSize: 12,
		fontWeight: '700',
		letterSpacing: 2,
		textTransform: 'uppercase',
	},
	heroHeadline: {
		color: C.text,
		fontSize: 30,
		fontWeight: '800',
		lineHeight: 36,
		letterSpacing: -0.6,
	},
	pendingBadge: {
		minWidth: 28,
		height: 28,
		borderRadius: 14,
		backgroundColor: C.primaryMid,
		justifyContent: 'center',
		alignItems: 'center',
		paddingHorizontal: 6,
		marginTop: 4,
	},
	pendingBadgeText: {
		color: C.text,
		fontSize: 12,
		fontWeight: '700',
	},

	// ── Hero strip ─────────────────────────────────────────────────────────────
	heroStrip: {
		borderRadius: 10,
		borderWidth: 1,
		borderColor: `${C.primary}25`,
		paddingVertical: 10,
		paddingHorizontal: 14,
		marginBottom: 24,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		overflow: 'hidden',
	},
	heroSub: {
		color: C.textMuted,
		fontSize: 12,
		fontWeight: '500',
		letterSpacing: 0.2,
	},

	// ── Sections ───────────────────────────────────────────────────────────────
	section: {
		marginBottom: 28,
	},
	sectionHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 14,
	},
	sectionTitle: {
		color: C.text,
		fontSize: 18,
		fontWeight: '700',
		letterSpacing: -0.3,
	},
	seeAll: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 2,
	},
	seeAllText: {
		color: C.primaryMid,
		fontSize: 13,
		fontWeight: '600',
	},

	// ── Quick Actions ──────────────────────────────────────────────────────────
	quickActions: {
		backgroundColor: C.surface,
		borderRadius: 16,
		borderWidth: 1,
		borderColor: C.border,
		overflow: 'hidden',
	},
	quickAction: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingVertical: 16,
		paddingHorizontal: 16,
		gap: 14,
	},
	quickActionPressed: {
		backgroundColor: C.surfaceHigh,
	},
	quickActionIcon: {
		width: 44,
		height: 44,
		borderRadius: 12,
		borderWidth: 1,
		justifyContent: 'center',
		alignItems: 'center',
	},
	quickActionText: {
		flex: 1,
	},
	quickActionLabel: {
		color: C.text,
		fontSize: 15,
		fontWeight: '600',
	},
	quickActionSub: {
		color: C.textMuted,
		fontSize: 12,
		marginTop: 2,
	},
	quickActionDivider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: C.border,
		marginLeft: 74,
	},

	// ── Style Cards ────────────────────────────────────────────────────────────
	stylesListContent: {
		paddingRight: H_PADDING,
	},
	styleCard: {
		width: STYLE_CARD_W,
		height: STYLE_CARD_H,
		borderRadius: 16,
		overflow: 'hidden',
		backgroundColor: C.surface,
		borderWidth: 1,
		borderColor: C.border,
	},
	styleCardPressed: {
		opacity: 0.85,
		transform: [{ scale: 0.97 }],
	},
	styleCardImage: {
		position: 'absolute',
		top: 0,
		left: 0,
		width: STYLE_CARD_W,
		height: STYLE_CARD_H,
	},
	styleCardBadge: {
		position: 'absolute',
		top: 8,
		right: 8,
		width: 22,
		height: 22,
		borderRadius: 11,
		backgroundColor: 'rgba(0,0,0,0.55)',
		justifyContent: 'center',
		alignItems: 'center',
	},
	styleCardOverlay: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		padding: 10,
	},
	styleCardName: {
		color: C.text,
		fontSize: 13,
		fontWeight: '700',
		letterSpacing: -0.2,
		lineHeight: 17,
	},
	styleCardSize: {
		color: C.textMuted,
		fontSize: 10,
		fontWeight: '500',
		marginTop: 2,
	},

	// ── Empty state ────────────────────────────────────────────────────────────
	emptyState: {
		alignItems: 'center',
		paddingTop: 40,
		gap: 12,
	},
	emptyTitle: {
		color: C.text,
		fontSize: 18,
		fontWeight: '700',
	},
	emptySub: {
		color: C.textMuted,
		fontSize: 14,
		textAlign: 'center',
		lineHeight: 20,
	},
	emptyButton: {
		marginTop: 8,
		backgroundColor: C.primaryMid,
		borderRadius: 12,
		paddingHorizontal: 24,
		paddingVertical: 12,
	},
	emptyButtonText: {
		color: C.text,
		fontSize: 14,
		fontWeight: '700',
	},

	// ── Floating Compute Monitor ───────────────────────────────────────────────
	computeMonitor: {
		position: 'absolute',
		bottom: 100,
		left: H_PADDING,
		right: H_PADDING,
	},
	computeMonitorInner: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		backgroundColor: C.surface,
		borderWidth: 1,
		borderColor: `${C.primaryMid}50`,
		borderRadius: 28,
		paddingVertical: 12,
		paddingHorizontal: 18,
		shadowColor: C.primary,
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.35,
		shadowRadius: 12,
		elevation: 8,
	},
	pulseDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: C.primaryGlow,
	},
	computeMonitorText: {
		flex: 1,
		color: C.text,
		fontSize: 13,
		fontWeight: '600',
	},
})
