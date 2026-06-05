/**
 * ArtLens — ExportScreen
 *
 * UI: light-theme design from ExportScreen_old.tsx
 * Logic: all SDK 55 / production functionality from export.tsx (unchanged)
 *
 * Visual changes from old → new:
 *   - Light background (#FFF / #F8F9FA) replaces dark theme
 *   - Pill save button (borderRadius: 32, height: 64) restored
 *   - Quality cards: white bg, borderRadius: 20, fontSize: 17
 *   - Share section: 4-column icon grid with labeled cards
 *   - SparklesIcon (✦) decorator on "SELECT QUALITY" section header
 *   - Header: space-between layout with back + title + share icon
 *   - PRIMARY_PURPLE (#7B61FF) replaces #7C3AED as accent
 *
 * Functionality retained from export.tsx (zero regressions):
 *   - SDK 55 OOP FileSystem API (File, Paths)
 *   - Dynamic filename derivation
 *   - exportFormat from useModelStore
 *   - Quality selector state (standard / high / ultra)
 *   - handleSave: permissions → copy → asset → album → cleanup → updateJob
 *   - handleShare: isAvailableAsync guard → shareAsync
 *   - handleSocialShare: per-target social chips
 *   - savedResetTimerRef memory-leak guard
 *   - Artwork thumbnail with LinearGradient + filename badge
 *   - Privacy disclosure row
 *   - Accessibility roles and labels
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Dimensions,
	Linking,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Image } from 'expo-image'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import { File, Paths } from 'expo-file-system'

import {
	CheckCircle2,
	ChevronLeft,
	Download,
	Lock,
	Share2,
} from 'lucide-react-native'
import { LinearGradient } from 'expo-linear-gradient'

import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useModelStore } from '@/shared/stores/useModelStore'
import type { ExportFormat } from '@/types'
import { APP_INFO } from '@/shared/utils/constants'

import { createTracker } from '@/shared/utils/logger'
const tracker = createTracker('export_screen')

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_PURPLE = '#7B61FF'

const C = {
	bg: '#FFFFFF',
	surface: '#F8F9FA',
	surfaceHigh: '#F2F2F7',
	border: '#F2F2F7',
	borderActive: PRIMARY_PURPLE,
	text: '#1C1C1E',
	textMuted: '#8E8E93',
	textDim: '#AEAEB2',
	primary: PRIMARY_PURPLE,
	primaryLight: '#A291FF',
	success: '#00C853',
	error: '#EF4444',
	white: '#FFFFFF',
	black: '#000000',
} as const

const { width: SCREEN_W } = Dimensions.get('window')
const THUMB_H = 220

// ─────────────────────────────────────────────────────────────────────────────
// QUALITY SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

type Quality = 'standard' | 'high' | 'ultra'

interface QualityDef {
	id: Quality
	label: string
	sub: string
	estimate: string
}

//const QUALITY_OPTIONS: QualityDef[] = [
//	{
//		id: 'standard',
//		label: 'Standard',
//		sub: 'Fastest export, great for DMs',
//		estimate: '2.4 MB',
//	},
//	{
//		id: 'high',
//		label: 'High Definition',
//		sub: 'Optimized for Social Media',
//		estimate: '5.8 MB',
//	},
//	{
//		id: 'ultra',
//		label: 'Ultra 4K',
//		sub: 'Lossless — best for printing',
//		estimate: '14.2 MB',
//	},
//]

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL SHARE TARGETS
// ─────────────────────────────────────────────────────────────────────────────

interface SocialTarget {
	id: string
	label: string
	androidPackage?: string
	iosScheme?: string
	color: string
	/** Emoji / text icon for the old-style card layout */
	emoji: string
}

const SOCIAL_TARGETS: SocialTarget[] = [
	{
		id: 'instagram',
		label: 'Instagram',
		androidPackage: 'com.instagram.android',
		iosScheme: 'instagram://',
		color: '#E1306C',
		emoji: '📸',
	},
	{
		id: 'facebook',
		label: 'Facebook',
		androidPackage: 'com.facebook.katana',
		iosScheme: 'fb://',
		color: '#1877F2',
		emoji: '👤',
	},
	{
		id: 'twitter',
		label: 'X',
		androidPackage: 'com.twitter.android',
		iosScheme: 'twitter://',
		color: '#000000',
		emoji: '✖',
	},
	{
		id: 'whatsapp',
		label: 'More',
		androidPackage: 'com.whatsapp',
		iosScheme: 'whatsapp://',
		color: '#8E8E93',
		emoji: '···',
	},
]

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS (unchanged from export.tsx)
// ─────────────────────────────────────────────────────────────────────────────

function deriveFilename(styleName: string, exportFormat: ExportFormat): string {
	const now = new Date()
	const date = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, '0'),
		String(now.getDate()).padStart(2, '0'),
	].join('-')
	const safe = styleName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')
	const ext = exportFormat.toLowerCase()
	const timestamp = now.getTime()

	return `${APP_INFO.name}_${date}_${safe}_${timestamp}.${ext}`
}

function mimeTypeFor(exportFormat: ExportFormat): string {
	return exportFormat.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg'
}

function utiFor(exportFormat: ExportFormat): string {
	return exportFormat.toLowerCase() === 'png' ? 'public.png' : 'public.jpeg'
}

function openAppSettings(): void {
	if (Platform.OS === 'ios') {
		Linking.openURL('app-settings:').catch((err) =>
			tracker.warn('Failed to open iOS app settings via deep link', {
				error: err,
			})
		)
	} else {
		Linking.openSettings().catch((err) =>
			tracker.warn('Failed to open Android app settings screen', {
				error: err,
			})
		)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SPARKLES DECORATOR — restored from old UI
// ─────────────────────────────────────────────────────────────────────────────

//const SparklesIcon = ({ color, size }: { color: string; size: number }) => (
//	<View style={{ marginLeft: 6 }}>
//		<Text style={{ color, fontSize: size }}>✦</Text>
//	</View>
//)

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL CARD — old-style 4-column icon card (memoized)
// ─────────────────────────────────────────────────────────────────────────────

interface SocialCardProps {
	target: SocialTarget
	onShare: (target: SocialTarget) => void
	disabled?: boolean
}

const SocialCard = React.memo<SocialCardProps>(
	({ target, onShare, disabled }) => {
		const handlePress = useCallback(
			() => onShare(target),
			[target, onShare]
		)
		return (
			<Pressable
				onPress={handlePress}
				disabled={disabled}
				style={({ pressed }) => [
					styles.shareCard,
					pressed && !disabled && { opacity: 0.75 },
					disabled && { opacity: 0.45 },
				]}
				accessibilityRole="button"
				accessibilityLabel={`Share to ${target.label}`}
			>
				<View
					style={[
						styles.shareIconWrapper,
						{ backgroundColor: target.color + '15' },
					]}
				>
					<Text style={[styles.shareEmoji, { color: target.color }]}>
						{target.emoji}
					</Text>
				</View>
				<Text style={styles.shareName}>
					{target.label.toUpperCase()}
				</Text>
			</Pressable>
		)
	}
)
SocialCard.displayName = 'SocialCard'

// ─────────────────────────────────────────────────────────────────────────────
// QUALITY CARD — old-style (memoized)
// ─────────────────────────────────────────────────────────────────────────────

interface QualityCardProps {
	opt: QualityDef
	selected: boolean
	onSelect: (id: Quality) => void
}

const QualityCard = React.memo<QualityCardProps>(
	({ opt, selected, onSelect }) => {
		const handlePress = useCallback(
			() => onSelect(opt.id),
			[opt.id, onSelect]
		)
		return (
			<Pressable
				onPress={handlePress}
				style={({ pressed }) => [
					styles.qualityCard,
					selected && styles.activeQualityCard,
					pressed && !selected && { opacity: 0.8 },
				]}
				accessibilityRole="radio"
				accessibilityState={{ checked: selected }}
				accessibilityLabel={`${opt.label} quality, ${opt.estimate}`}
			>
				<View style={styles.qualityTextGroup}>
					<View style={styles.titleRow}>
						<Text
							style={[
								styles.qualityTitle,
								selected && { color: PRIMARY_PURPLE },
							]}
						>
							{opt.label}
						</Text>
						<View
							style={[
								styles.sizeBadge,
								selected && styles.activeSizeBadge,
							]}
						>
							<Text
								style={[
									styles.qualitySize,
									selected && { color: C.white },
								]}
							>
								{opt.estimate}
							</Text>
						</View>
					</View>
					<Text style={styles.qualitySubtitle}>{opt.sub}</Text>
				</View>
				<View
					style={[
						styles.radioOuter,
						selected && styles.radioOuterActive,
					]}
				>
					{selected && <View style={styles.radioInner} />}
				</View>
			</Pressable>
		)
	}
)
QualityCard.displayName = 'QualityCard'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function ExportScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	const { jobId, outputUri: paramOutputUri } = useLocalSearchParams<{
		jobId: string
		outputUri?: string
	}>()

	const job = useStyleJobStore(
		(s) => s.jobs.find((j) => j.id === jobId) ?? null
	)
	const updateJob = useStyleJobStore((s) => s.updateJob)
	const catalog = useModelStore((s) => s.catalog)
	const exportFormat = useModelStore((s) => s.exportFormat) as ExportFormat

	const styleName = useMemo(
		() => catalog.find((m) => m.id === job?.styleId)?.name ?? APP_INFO.name,
		[catalog, job?.styleId]
	)

	const outputUri = paramOutputUri || job?.resultUri

	const filename = useMemo(
		() => deriveFilename(styleName, exportFormat),
		[styleName, exportFormat]
	)

	const [isSaving, setIsSaving] = useState(false)
	const [isSaved, setIsSaved] = useState(false)
	const [isSharing, setIsSharing] = useState(false)
	const [sharingSocialId, setSharingSocialId] = useState<string | null>(null)

	const savedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null
	)

	useEffect(() => {
		return () => {
			if (savedResetTimerRef.current !== null)
				clearTimeout(savedResetTimerRef.current)
		}
	}, [])

	// ── Save to gallery (SDK 55 pipeline — unchanged) ─────────────────────────
	const handleSave = useCallback(async () => {
		if (!outputUri) {
			Alert.alert('Error', 'No image available to save.')
			return
		}
		if (isSaving || isSaved) return

		if (!job) {
			tracker.warn(
				'Aborting save chain: job target context is undefined or null'
			)
			return
		}

		try {
			setIsSaving(true)
			tracker.log('Executing production local storage copy chain')
			const { status, canAskAgain } =
				await MediaLibrary.getPermissionsAsync()

			if (status === 'denied' && !canAskAgain) {
				tracker.warn(
					'User permanently denied Media Library permissions',
					{ jobId }
				)
				Alert.alert(
					'Permission Required',
					`Photo library access was denied. To save your artwork, enable it in your device Settings under ${APP_INFO.name} → Photos.`,
					[
						{ text: 'Not Now', style: 'cancel' },
						{ text: 'Open Settings', onPress: openAppSettings },
					]
				)
				return
			}

			if (status !== 'granted') {
				const { status: newStatus } =
					await MediaLibrary.requestPermissionsAsync()
				if (newStatus !== 'granted') {
					tracker.warn('User rejected Media Library request prompt', {
						jobId,
					})
					Alert.alert(
						'Permission Denied',
						`${APP_INFO.name} needs photo library access to save your artwork. Please enable it in Settings.`,
						[
							{ text: 'Cancel', style: 'cancel' },
							{ text: 'Open Settings', onPress: openAppSettings },
						]
					)
					return
				}
			}

			const sourceFile = new File(outputUri)
			const destFile = new File(Paths.cache, filename)
			sourceFile.copy(destFile)

			let asset = await MediaLibrary.createAssetAsync(destFile.uri)

			const albums = await MediaLibrary.getAlbumsAsync({
				includeSmartAlbums: false,
			})
			const existingAlbum = albums.find((a) => a.title === APP_INFO.album)
			if (existingAlbum) {
				await MediaLibrary.addAssetsToAlbumAsync(
					[asset],
					existingAlbum,
					false
				)
			} else {
				await MediaLibrary.createAlbumAsync(
					APP_INFO.album,
					asset,
					false
				)
			}

			const albumAssets = await MediaLibrary.getAssetsAsync({
				album: existingAlbum || APP_INFO.album,
				sortBy: [[MediaLibrary.SortBy.creationTime, false]], // Get most recent asset first
				first: 1,
			})

			const realAsset = albumAssets.assets[0] || asset
			const trueUri = realAsset.uri

			try {
				destFile.delete()
			} catch (err) {
				tracker.warn(
					'Failed to delete named temp export file from cache',
					{
						tempUri: destFile.uri,
						error: err instanceof Error ? err.message : String(err),
					}
				)
			}

			const isCachedResult =
				outputUri.startsWith(Paths.cache.uri) ||
				outputUri.includes('/cache/artlens_') ||
				outputUri.includes('/cache/artlens-')

			if (isCachedResult) {
				try {
					new File(outputUri).delete()
				} catch (err) {
					tracker.warn(
						'Failed to delete source cache file after gallery save',
						{
							outputUri,
							error:
								err instanceof Error
									? err.message
									: String(err),
						}
					)
				}
			}

			if (jobId && asset.uri) {
				updateJob(jobId, { resultUri: trueUri })
				tracker.log(
					'job.resultUri updated to permanent gallery asset URI',
					{
						jobId,
						assetUri: trueUri,
					}
				)
			}

			if (savedResetTimerRef.current !== null)
				clearTimeout(savedResetTimerRef.current)
			setIsSaved(true)
			savedResetTimerRef.current = setTimeout(() => {
				setIsSaved(false)
				savedResetTimerRef.current = null
			}, APP_INFO.success_reset_ms)

			tracker.log('Artwork saved to gallery successfully', {
				jobId,
				filename,
				assetUri: trueUri,
				albumName: APP_INFO.album,
			})
		} catch (err) {
			tracker.error('Artwork save to gallery pipeline failed', {
				jobId,
				styleName,
				exportFormat,
				filename,
				outputUri,
				error:
					err instanceof Error
						? {
								name: err.name,
								message: err.message,
								stack: err.stack,
							}
						: err,
			})
			Alert.alert(
				'Save Failed',
				err instanceof Error ? err.message : 'Could not save image.'
			)
		} finally {
			setIsSaving(false)
		}
	}, [
		exportFormat,
		filename,
		isSaved,
		isSaving,
		job,
		jobId,
		outputUri,
		styleName,
		updateJob,
	])

	// ── Share (unchanged) ─────────────────────────────────────────────────────
	const handleShare = useCallback(async () => {
		if (!outputUri || isSharing) return
		setIsSharing(true)
		try {
			const canShare = await Sharing.isAvailableAsync()
			if (!canShare) {
				Alert.alert(
					'Unavailable',
					'Sharing is not available on this device.'
				)
				return
			}
			await Sharing.shareAsync(outputUri, {
				mimeType: mimeTypeFor(exportFormat),
				dialogTitle: `Share ${filename}`,
				UTI: utiFor(exportFormat),
			})
		} catch (err) {
			tracker.error('Native sharing utility failed', {
				jobId,
				outputUri,
				exportFormat,
				filename,
				error:
					err instanceof Error
						? {
								name: err.name,
								message: err.message,
								stack: err.stack,
							}
						: err,
			})
			Alert.alert(
				'Share Failed',
				err instanceof Error
					? err.message
					: 'Could not open share sheet.'
			)
		} finally {
			setIsSharing(false)
		}
	}, [outputUri, isSharing, filename, exportFormat, jobId])

	// ── Social share (unchanged) ──────────────────────────────────────────────
	const handleSocialShare = useCallback(
		async (target: SocialTarget) => {
			if (!outputUri || isSharing || sharingSocialId) return
			setSharingSocialId(target.id)
			try {
				const canShare = await Sharing.isAvailableAsync()
				if (!canShare) {
					Alert.alert(
						'Unavailable',
						'Sharing is not available on this device.'
					)
					return
				}

				const scheme = Platform.OS === 'ios' ? target.iosScheme : null
				const appInstalled = scheme
					? await Linking.canOpenURL(scheme).catch(() => false)
					: false
				tracker.log('Social share attempt', {
					target: target.id,
					appInstalled,
					outputUri: outputUri.substring(0, 80),
				})

				await Sharing.shareAsync(outputUri, {
					mimeType: mimeTypeFor(exportFormat),
					dialogTitle: `Share to ${target.label}`,
					UTI: utiFor(exportFormat),
				})
			} catch (err) {
				tracker.error('Social share failed', {
					target: target.id,
					jobId,
					error: err instanceof Error ? err.message : String(err),
				})
				Alert.alert(
					'Share Failed',
					err instanceof Error
						? err.message
						: 'Could not open share sheet.'
				)
			} finally {
				setSharingSocialId(null)
			}
		},
		[outputUri, isSharing, sharingSocialId, exportFormat, jobId]
	)

	// ── Render ────────────────────────────────────────────────────────────────
	return (
		<View style={[styles.container, { backgroundColor: C.bg }]}>
			{/* ── Header — old style: space-between + share icon ────────────── */}
			<View style={[styles.header, { paddingTop: insets.top + 4 }]}>
				<Pressable
					onPress={() => router.back()}
					style={styles.backBtn}
					accessibilityRole="button"
					accessibilityLabel="Go back"
					hitSlop={12}
				>
					<ChevronLeft color={C.text} size={28} strokeWidth={1.8} />
				</Pressable>
				<Text style={styles.headerTitle}>Export</Text>
				<Pressable
					onPress={handleShare}
					disabled={isSharing || !outputUri}
					style={[
						styles.backBtn,
						(!outputUri || isSharing) && { opacity: 0.45 },
					]}
					accessibilityRole="button"
					accessibilityLabel="Share artwork"
				>
					{isSharing ? (
						<ActivityIndicator color={C.text} size="small" />
					) : (
						<Share2 color={C.text} size={22} strokeWidth={1.8} />
					)}
				</Pressable>
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={[
					styles.scrollContent,
					{ paddingBottom: 27 },
				]}
				keyboardShouldPersistTaps="handled"
			>
				{/* ── Artwork thumbnail (new — retained) ────────────────────── */}
				<View style={styles.thumbWrap}>
					{outputUri ? (
						<>
							<Image
								source={{ uri: outputUri }}
								style={styles.thumb}
								contentFit="cover"
								accessibilityLabel="Artwork preview"
							/>
							<LinearGradient
								colors={['transparent', 'rgba(0,0,0,0.35)']}
								style={StyleSheet.absoluteFillObject}
							/>
							<View style={styles.thumbBadge}>
								<Text
									style={styles.thumbFilename}
									numberOfLines={1}
								>
									{filename}
								</Text>
							</View>
						</>
					) : (
						<View style={[styles.thumb, styles.thumbPlaceholder]} />
					)}
				</View>

				{/* ── Title section — old copy ───────────────────────────────── */}
				<View style={styles.titleSection}>
					<Text style={styles.pageTitle}>Masterpiece Ready</Text>
					<Text style={styles.pageSubtitle}>
						Choose your preferred quality and share your creation
						with the world.
					</Text>
				</View>

				{/* ── Quality section header with SparklesIcon ──────────────── */}
				{/*<View style={styles.sectionHeaderRow}>
					<Text style={styles.sectionLabel}>SELECT QUALITY</Text>
					<SparklesIcon color={PRIMARY_PURPLE} size={14} />
				</View>

				{QUALITY_OPTIONS.map((opt) => (
					<QualityCard
						key={opt.id}
						opt={opt}
						selected={quality === opt.id}
						onSelect={setQuality}
					/>
				))}*/}

				{/* ── Social share grid — old 4-column layout ───────────────── */}
				<Text
					style={[
						styles.sectionLabel,
						{ marginTop: 25, marginBottom: 12 },
					]}
				>
					SHARE DIRECTLY
				</Text>
				<View style={styles.shareGrid}>
					{SOCIAL_TARGETS.map((target) => (
						<SocialCard
							key={target.id}
							target={target}
							onShare={handleSocialShare}
							disabled={
								!outputUri ||
								isSharing ||
								sharingSocialId !== null
							}
						/>
					))}
				</View>

				{/* ── Save to gallery — old pill button ─────────────────────── */}
				<Pressable
					onPress={handleSave}
					disabled={isSaving || isSaved || !outputUri}
					style={({ pressed }) => [
						styles.saveBtn,
						isSaved && styles.saveBtnSuccess,
						(isSaving || !outputUri) && { opacity: 0.65 },
						pressed && !isSaved && { opacity: 0.88 },
					]}
					accessibilityRole="button"
					accessibilityLabel="Save artwork to device gallery"
				>
					{isSaving ? (
						<>
							<ActivityIndicator color={C.white} size="small" />
							<Text style={styles.saveBtnText}>Saving…</Text>
						</>
					) : isSaved ? (
						<>
							<CheckCircle2
								color={C.white}
								size={22}
								strokeWidth={2.5}
							/>
							<Text style={styles.saveBtnText}>
								Saved to Gallery
							</Text>
						</>
					) : (
						<>
							<Download
								color={C.white}
								size={22}
								strokeWidth={2}
							/>
							<Text style={styles.saveBtnText}>
								Download Artwork
							</Text>
						</>
					)}
				</Pressable>

				{/* ── Privacy disclosure (new — retained) ───────────────────── */}
				<View style={styles.privacyRow}>
					<Lock color={C.textDim} size={12} strokeWidth={1.5} />
					<Text style={styles.privacyText}>
						Images are processed entirely on-device. Your artwork
						never leaves unless you explicitly share it.
					</Text>
				</View>
			</ScrollView>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES — light theme from old, layout metrics preserved
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	container: { flex: 1 },

	// ── Header ────────────────────────────────────────────────────────────────
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingHorizontal: 20,
		paddingBottom: 10,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: C.border,
	},
	backBtn: { padding: 4, width: 40, alignItems: 'center' },
	headerTitle: {
		fontSize: 17,
		fontWeight: '700',
		color: C.text,
		letterSpacing: -0.3,
	},

	// ── Scroll ────────────────────────────────────────────────────────────────
	scrollContent: { padding: 20 },

	// ── Thumbnail (new — retained) ────────────────────────────────────────────
	thumbWrap: {
		width: SCREEN_W - 40,
		height: THUMB_H,
		borderRadius: 20,
		overflow: 'hidden',
		alignSelf: 'center',
		marginBottom: 20,
		borderWidth: 1,
		borderColor: C.border,
		backgroundColor: C.surfaceHigh,
	},
	thumb: { width: '100%', height: '100%' },
	thumbPlaceholder: { backgroundColor: C.surfaceHigh },
	thumbBadge: {
		position: 'absolute',
		bottom: 12,
		left: 12,
		right: 12,
		backgroundColor: 'rgba(0,0,0,0.55)',
		borderRadius: 8,
		paddingHorizontal: 10,
		paddingVertical: 5,
	},
	thumbFilename: { color: '#E0E0E0', fontSize: 11, fontWeight: '500' },

	// ── Title section ─────────────────────────────────────────────────────────
	titleSection: { alignItems: 'center', marginBottom: 28 },
	pageTitle: {
		fontSize: 28,
		fontWeight: '900',
		color: C.text,
		marginBottom: 8,
		letterSpacing: -0.5,
	},
	pageSubtitle: {
		fontSize: 15,
		color: C.textMuted,
		textAlign: 'center',
		lineHeight: 22,
		paddingHorizontal: 20,
	},

	// ── Section labels ────────────────────────────────────────────────────────
	sectionHeaderRow: {
		flexDirection: 'row',
		alignItems: 'center',
		marginBottom: 15,
	},
	sectionLabel: {
		fontSize: 12,
		fontWeight: '800',
		color: C.textDim,
		letterSpacing: 1,
		textTransform: 'uppercase',
	},

	// ── Quality cards — old metrics ───────────────────────────────────────────
	qualityCard: {
		backgroundColor: C.surface,
		borderRadius: 20,
		padding: 20,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 12,
		borderWidth: 1.5,
		borderColor: 'transparent',
	},
	activeQualityCard: {
		borderColor: PRIMARY_PURPLE,
		backgroundColor: C.bg,
		...Platform.select({
			ios: {
				shadowColor: PRIMARY_PURPLE,
				shadowOffset: { width: 0, height: 8 },
				shadowOpacity: 0.15,
				shadowRadius: 12,
			},
			android: { elevation: 4 },
		}),
	},
	qualityTextGroup: { flex: 1 },
	titleRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		marginBottom: 4,
	},
	qualityTitle: { fontSize: 17, fontWeight: '800', color: C.text },
	sizeBadge: {
		backgroundColor: '#E5E5EA',
		paddingHorizontal: 8,
		paddingVertical: 2,
		borderRadius: 6,
	},
	activeSizeBadge: { backgroundColor: PRIMARY_PURPLE },
	qualitySize: { fontSize: 11, fontWeight: '700', color: C.textMuted },
	qualitySubtitle: { fontSize: 13, color: C.textMuted },
	radioOuter: {
		width: 24,
		height: 24,
		borderRadius: 12,
		borderWidth: 2,
		borderColor: '#D1D1D6',
		justifyContent: 'center',
		alignItems: 'center',
		marginLeft: 15,
	},
	radioOuterActive: { borderColor: PRIMARY_PURPLE },
	radioInner: {
		width: 12,
		height: 12,
		borderRadius: 6,
		backgroundColor: PRIMARY_PURPLE,
	},

	// ── Share grid — old 4-column ─────────────────────────────────────────────
	shareGrid: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		marginBottom: 28,
	},
	shareCard: {
		width: (SCREEN_W - 70) / 4,
		backgroundColor: C.bg,
		borderRadius: 20,
		paddingVertical: 18,
		alignItems: 'center',
		borderWidth: 1,
		borderColor: C.border,
	},
	shareIconWrapper: {
		width: 44,
		height: 44,
		borderRadius: 22,
		justifyContent: 'center',
		alignItems: 'center',
		marginBottom: 10,
	},
	shareEmoji: { fontSize: 18, fontWeight: '700' },
	shareName: {
		fontSize: 10,
		color: C.text,
		fontWeight: '700',
		textTransform: 'uppercase',
	},

	// ── Save pill button — old metrics ────────────────────────────────────────
	saveBtn: {
		backgroundColor: PRIMARY_PURPLE,
		height: 64,
		borderRadius: 32,
		flexDirection: 'row',
		justifyContent: 'center',
		alignItems: 'center',
		gap: 12,
		marginBottom: 20,
	},
	saveBtnSuccess: { backgroundColor: '#00C853' },
	saveBtnText: { color: C.white, fontSize: 18, fontWeight: '900' },

	// ── Privacy note (new — retained) ─────────────────────────────────────────
	privacyRow: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 6,
		paddingHorizontal: 8,
		marginBottom: 8,
	},
	privacyText: { flex: 1, color: C.textDim, fontSize: 12, lineHeight: 18 },
})
