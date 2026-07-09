/**
 * ArtLens — HomeScreen
 *
 * Landing screen with:
 *  - Hero CTA (camera + library picker)
 *  - Quick stats strip (created count, this-week count)
 *  - Features row (Live AI / Background / Magic Edit)
 *  - Recent Artwork horizontal scroll (last 5 DONE jobs)
 *  - Trending Styles horizontal FlatList
 *  - Floating ComputeMonitor pill while jobs are active
 *
 * Directory: app/(tabs)/home.tsx
 * * @module app/(tabs)
 */

import React, { useCallback, useEffect, useMemo } from 'react'
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
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, { FadeInUp } from 'react-native-reanimated'
import {
	CheckCircle2,
	Clock,
	Image as ImageIcon,
	Images,
	Layers,
	Sparkles,
	Wand2,
} from 'lucide-react-native'

import { useModelStore } from '@/shared/stores/useModelStore'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useImageSelection } from '@/features/upload/hooks/useImageSelection'

import {
	ComputeMonitor,
	ErrorBanner,
	FeatureItem,
	HOME_STYLE_CARD_W,
	HomeStyleCard,
	RecentCard,
} from '@/features/home/components'

import type { StyleModel, StyleJob } from '@/types'
import { createTracker } from '@/shared/utils/logger'
import { Colors } from '@/shared/ui'

const tracker = createTracker('HomeScreen')

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const RECENT_CARD_W = 130
const RECENT_CARD_H = 130
const GAP_SIZE = 15

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function HomeScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	const catalog = useModelStore((s) => s.catalog)
	const setSelectedStyleId = useModelStore((s) => s.setSelectedStyleId)
	const jobs = useStyleJobStore((s) => s.jobs)

	// ── Derived job state ─────────────────────────────────────────────────────
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

	// ── Completed artwork ─────────────────────────────────────────────────────
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

	// ── Style name lookup ─────────────────────────────────────────────────────
	const styleNameMap = useMemo<Record<string, string>>(() => {
		const map: Record<string, string> = {}
		catalog.forEach((m) => {
			map[m.id] = m.name
		})
		return map
	}, [catalog])

	const thisWeekCount = useMemo(
		() =>
			jobs.filter(
				(j) => Date.now() - j.createdAt < 7 * 24 * 60 * 60 * 1_000
			).length,
		[jobs]
	)

	const trendingStyles = useMemo<StyleModel[]>(
		() => catalog.filter((m) => m.isActive).slice(0, 8),
		[catalog]
	)

	const { pickImage, isPicking, error, clearError } = useImageSelection()

	useEffect(() => {
		if (error)
			tracker.warn('Image selection error surfaced to user', { error })
	}, [error])

	// ── Handlers ─────────────────────────────────────────────────────────────

	const handleOpenCamera = useCallback(() => {
		tracker.log('Navigating to camera')
		router.push('/(tabs)/camera')
	}, [])

	const handleUploadPhoto = useCallback(async () => {
		tracker.log('Launching photo library picker')
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
		router.push('/(tabs)/styles')
	}, [])

	const handleComputeMonitorPress = useCallback(() => {
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

	// ── FlatList helpers ──────────────────────────────────────────────────────

	const renderStyleCard = useCallback<ListRenderItem<StyleModel>>(
		({ item }) => (
			<HomeStyleCard item={item} onPress={handleStyleCardPress} />
		),
		[handleStyleCardPress]
	)
	const keyExtractor = useCallback((item: StyleModel) => item.id, [])
	const renderSeparator = useCallback(
		() => <View style={styles.separator} />,
		[]
	)

	return (
		<View style={styles.container}>
			<StatusBar style="dark" />

			{/* Header */}
			<View style={[styles.header, { paddingTop: insets.top + 4 }]}>
				<View style={styles.logoRow}>
					<View style={styles.logoBox}>
						<Sparkles size={18} color="#FFF" />
					</View>
					<Text style={styles.logoText}>ArtLens</Text>
				</View>

				{/* Profile badge — shows active job count or completed count */}
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
								color={Colors.primary}
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
				showsVerticalScrollIndicator={false}
				contentContainerStyle={[
					styles.scrollContent,
					{ paddingBottom: 33 },
				]}
			>
				{/* Error banner */}
				{error ? (
					<ErrorBanner message={error} onDismiss={clearError} />
				) : null}

				{/* Hero */}
				<View style={styles.heroContainer}>
					<ImageBackground
						source={{
							uri: 'https://i.ibb.co/HfGQMXsV/Girl-with-a-Pearl-Earring.jpg',
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
				{jobs.length > 0 && (
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
									color={Colors.primary}
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
						icon={<Sparkles size={20} color={Colors.primary} />}
					/>
					<FeatureItem
						label="Background"
						icon={<ImageIcon size={20} color={Colors.primary} />}
					/>
					<FeatureItem
						label="Magic Edit"
						icon={<Wand2 size={20} color={Colors.primary} />}
					/>
				</View>

				{/* Recent Artwork */}
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
							{completedCount > 5 && (
								<TouchableOpacity
									style={styles.recentSeeAllCard}
									onPress={handleSeeAllGallery}
									activeOpacity={0.8}
								>
									<Images
										size={24}
										color={Colors.primary}
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
								length: HOME_STYLE_CARD_W,
								offset: (HOME_STYLE_CARD_W + GAP_SIZE) * i,
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
							color={Colors.textMuted}
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

			{/* Floating processing monitor */}
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
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: '#FFF' },
	scrollContent: { paddingBottom: 20 },

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
		backgroundColor: Colors.primary,
		borderRadius: 10,
		marginRight: 12,
		justifyContent: 'center',
		alignItems: 'center',
	},
	logoText: {
		fontSize: 24,
		fontWeight: '900',
		color: Colors.text,
		letterSpacing: -0.5,
	},
	profileBtn: { padding: 4, justifyContent: 'center', alignItems: 'center' },
	profileCircle: { width: 36, height: 36 },
	pendingBadge: {
		minWidth: 36,
		height: 36,
		borderRadius: 18,
		backgroundColor: Colors.primary,
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
		borderColor: `${Colors.primary}30`,
	},
	completedBadgeText: {
		color: Colors.primary,
		fontSize: 13,
		fontWeight: '700',
	},

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
		backgroundColor: Colors.white,
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
	statChipText: { fontSize: 12, fontWeight: '600', color: Colors.text },

	featuresRow: {
		flexDirection: 'row',
		justifyContent: 'space-around',
		paddingVertical: 25,
		backgroundColor: Colors.white,
		marginHorizontal: 15,
		borderRadius: 20,
		marginTop: -30,
		elevation: 2,
		shadowColor: '#000',
		shadowOpacity: 0.05,
		shadowRadius: 5,
	},

	sectionHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		paddingHorizontal: 20,
		marginTop: 30,
		marginBottom: 15,
		alignItems: 'center',
	},
	sectionTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
	seeAll: { color: Colors.primary, fontWeight: '700', fontSize: 14 },

	recentScroll: { paddingLeft: 20, paddingRight: 20 },
	recentSeeAllCard: {
		width: RECENT_CARD_W,
		height: RECENT_CARD_H,
		borderRadius: 16,
		backgroundColor: '#F0EDFF',
		borderWidth: 1,
		borderColor: `${Colors.primary}30`,
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
	},
	recentSeeAllText: {
		color: Colors.primary,
		fontSize: 13,
		fontWeight: '700',
		textAlign: 'center',
	},

	styleScroll: { paddingLeft: 20, paddingRight: 20 },
	separator: { width: GAP_SIZE },

	emptyState: {
		alignItems: 'center',
		paddingTop: 40,
		paddingHorizontal: 20,
		gap: 12,
	},
	emptyTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' },
	emptySub: {
		color: Colors.textMuted,
		fontSize: 14,
		textAlign: 'center',
		lineHeight: 20,
	},
	emptyButton: {
		marginTop: 8,
		backgroundColor: Colors.primary,
		borderRadius: 12,
		paddingHorizontal: 24,
		paddingVertical: 12,
	},
	emptyButtonText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
})
