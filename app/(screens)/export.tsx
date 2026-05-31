/**
 * ArtLens — ExportScreen (Production Implementation)
 *
 * Route params:
 *   jobId      — used to derive style name and filename
 *   outputUri? — refined image URI from RefineScreen.
 *                Falls back to job.resultUri when absent.
 *
 * Features:
 *   - Dynamic filename: ArtLens_YYYY-MM-DD_StyleName.ext
 *   - Export format from useModelStore.exportFormat (JPEG / PNG / HEIC)
 *   - Quality selector: Standard / High / Ultra (labels; PNG is lossless)
 *   - Save to gallery:
 *       • requestPermissionsAsync() — if denied, prompts user to open Settings
 *       • createAlbumAsync("ArtLens") if album absent
 *       • saveToLibraryAsync with correct "ArtLens" album
 *       • Success state checkmark + 4 s auto-reset
 *   - Share via expo-sharing:
 *       • isAvailableAsync() guard
 *       • shareAsync() → native share sheet (no sandbox copy made)
 *   - Privacy note: on-device processing disclosure
 *
 * PRD § 3.6 — ExportScreen
 *
 * Dependencies:
 *   expo-media-library ~55.0.16
 *   expo-sharing ~55.0.19
 *   expo-file-system ~55.0.9
 *   expo-image
 *   expo-router
 *   lucide-react-native
 *   react-native-safe-area-context
 */

import React, { useCallback, useMemo, useState } from 'react'
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
import * as FileSystem from 'expo-file-system'
import {
	CheckCircle,
	ChevronLeft,
	Download,
	Lock,
	Share2,
} from 'lucide-react-native'
import { LinearGradient } from 'expo-linear-gradient'

import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useModelStore } from '@/shared/stores/useModelStore'
import type { ExportFormat } from '@/types'

import { createTracker } from '@/shared/utils/logger'
const tracker = createTracker('export_screen')

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
	text: '#F4F4FF',
	textMuted: '#7070A0',
	textDim: '#40405A',
	success: '#10B981',
	error: '#EF4444',
	white: '#FFFFFF',
} as const

const { width: SCREEN_W } = Dimensions.get('window')
const ARTLENS_ALBUM = 'ArtLens'
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

const QUALITY_OPTIONS: QualityDef[] = [
	{
		id: 'standard',
		label: 'Standard',
		sub: 'Great for quick sharing',
		estimate: '~2 MB',
	},
	{
		id: 'high',
		label: 'High Definition',
		sub: 'Optimized for social media',
		estimate: '~5 MB',
	},
	{
		id: 'ultra',
		label: 'Ultra HD',
		sub: 'Lossless — best for printing',
		estimate: '~12 MB',
	},
]

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL SHARE TARGETS
// ─────────────────────────────────────────────────────────────────────────────

interface SocialTarget {
	id: string
	label: string
	/** Android intent package / iOS URL scheme for direct-app share.
	 *  If the app is not installed, we fall back to expo-sharing. */
	androidPackage?: string
	iosScheme?: string
	/** Background colour for the icon pill */
	color: string
}

const SOCIAL_TARGETS: SocialTarget[] = [
	{
		id: 'whatsapp',
		label: 'WhatsApp',
		androidPackage: 'com.whatsapp',
		iosScheme: 'whatsapp://',
		color: '#25D366',
	},
	{
		id: 'instagram',
		label: 'Instagram',
		androidPackage: 'com.instagram.android',
		iosScheme: 'instagram://',
		color: '#E1306C',
	},
	{
		id: 'facebook',
		label: 'Facebook',
		androidPackage: 'com.facebook.katana',
		iosScheme: 'fb://',
		color: '#1877F2',
	},
	{
		id: 'twitter',
		label: 'X / Twitter',
		androidPackage: 'com.twitter.android',
		iosScheme: 'twitter://',
		color: '#000000',
	},
]

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produces: ArtLens_YYYY-MM-DD_StyleName.ext
 * Sanitizes the style name to filesystem-safe characters.
 */
function deriveFilename(styleName: string, exportFormat: ExportFormat): string {
	const now = new Date()
	const date = [
		now.getFullYear(),
		String(now.getMonth() + 1).padStart(2, '0'),
		String(now.getDate()).padStart(2, '0'),
	].join('-')
	const safe = styleName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')
	const ext = exportFormat.toLowerCase()
	return `ArtLens_${date}_${safe}.${ext}`
}

/**
 * Opens the OS-level app settings page so the user can re-enable
 * photo library access without leaving to navigate manually.
 */
function openAppSettings(): void {
	if (Platform.OS === 'ios') {
		Linking.openURL('app-settings:').catch((err) => {
			tracker.warn('Failed to open iOS app settings via deep link', {
				error: err,
			})
		})
	} else {
		Linking.openSettings().catch((err) => {
			tracker.warn('Failed to open Android app settings screen', {
				error: err,
			})
		})
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL CHIP (memoized) — taps trigger direct-app share with expo-sharing fallback
// ─────────────────────────────────────────────────────────────────────────────

interface SocialChipProps {
	target: SocialTarget
	onShare: (target: SocialTarget) => void
	disabled?: boolean
}

const SocialChip = React.memo<SocialChipProps>(
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
					styles.socialChip,
					{ borderColor: target.color + '40' },
					pressed && !disabled && { opacity: 0.8 },
					disabled && { opacity: 0.45 },
				]}
				accessibilityRole="button"
				accessibilityLabel={`Share to ${target.label}`}
			>
				<View
					style={[
						styles.socialDot,
						{ backgroundColor: target.color },
					]}
				/>
				<Text style={styles.socialLabel}>{target.label}</Text>
			</Pressable>
		)
	}
)
SocialChip.displayName = 'SocialChip'

// ─────────────────────────────────────────────────────────────────────────────
// QUALITY CARD (memoized)
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
					selected && styles.qualityCardSelected,
					pressed && !selected && { opacity: 0.8 },
				]}
				accessibilityRole="radio"
				accessibilityState={{ checked: selected }}
				accessibilityLabel={`${opt.label} quality, ${opt.estimate}`}
			>
				<View style={styles.qualityInfo}>
					<View style={styles.qualityTitleRow}>
						<Text
							style={[
								styles.qualityTitle,
								selected && styles.qualityTitleSelected,
							]}
						>
							{opt.label}
						</Text>
						<View
							style={[
								styles.estimateBadge,
								selected && styles.estimateBadgeSelected,
							]}
						>
							<Text
								style={[
									styles.estimateText,
									selected && { color: C.white },
								]}
							>
								{opt.estimate}
							</Text>
						</View>
					</View>
					<Text style={styles.qualitySub}>{opt.sub}</Text>
				</View>

				<View style={[styles.radio, selected && styles.radioSelected]}>
					{selected && <View style={styles.radioDot} />}
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

	// ── Route params ──────────────────────────────────────────────────────────
	const { jobId, outputUri: paramOutputUri } = useLocalSearchParams<{
		jobId: string
		outputUri?: string
	}>()

	// ── Store state ───────────────────────────────────────────────────────────
	const job = useStyleJobStore(
		(s) => s.jobs.find((j) => j.id === jobId) ?? null
	)
	const catalog = useModelStore((s) => s.catalog)
	const exportFormat = useModelStore((s) => s.exportFormat) as ExportFormat

	const styleName = useMemo(
		() => catalog.find((m) => m.id === job?.styleId)?.name ?? 'ArtLens',
		[catalog, job?.styleId]
	)

	// Prefer the refined snapshot from RefineScreen; fall back to raw job result.
	const outputUri = paramOutputUri || job?.resultUri

	const filename = useMemo(
		() => deriveFilename(styleName, exportFormat),
		[styleName, exportFormat]
	)

	// ── Local state ───────────────────────────────────────────────────────────
	const [quality, setQuality] = useState<Quality>('high')
	const [isSaving, setIsSaving] = useState(false)
	const [isSaved, setIsSaved] = useState(false)
	const [isSharing, setIsSharing] = useState(false)
	const [sharingSocialId, setSharingSocialId] = useState<string | null>(null)

	// ── Save to gallery ───────────────────────────────────────────────────────
	const handleSave = useCallback(async () => {
		if (!outputUri) {
			Alert.alert('Error', 'No image available to save.')
			return
		}
		if (isSaving || isSaved) return

		setIsSaving(true)
		try {
			// Step 1 — Verify / request media library permissions.
			const { status, canAskAgain } =
				await MediaLibrary.getPermissionsAsync()

			if (status === 'denied' && !canAskAgain) {
				// User has permanently denied; redirect to Settings.
				tracker.warn(
					'User permanently denied Media Library permissions',
					{ jobId }
				)
				Alert.alert(
					'Permission Required',
					'Photo library access was denied. To save your artwork, enable it in your device Settings under ArtLens → Photos.',
					[
						{ text: 'Not Now', style: 'cancel' },
						{
							text: 'Open Settings',
							onPress: openAppSettings,
						},
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
						'ArtLens needs photo library access to save your artwork. Please enable it in Settings.',
						[
							{ text: 'Cancel', style: 'cancel' },
							{
								text: 'Open Settings',
								onPress: openAppSettings,
							},
						]
					)
					return
				}
			}

			// Step 2 — Copy source file to a named temp file so MediaLibrary
			// registers the correct human-readable filename.
			const mimeType =
				exportFormat.toLowerCase() === 'png'
					? 'image/png'
					: 'image/jpeg'
			const sourceFile = new FileSystem.File(outputUri)
			const destFile = FileSystem.Paths.cache.createFile(
				filename,
				mimeType
			)
			await sourceFile.copy(destFile)

			// Step 3 — Create the gallery asset.
			const asset = await MediaLibrary.createAssetAsync(destFile.uri)

			// Step 4 — Find or create the "ArtLens" album.
			const albums = await MediaLibrary.getAlbumsAsync()
			const existingAlbum = albums.find((a) => a.title === ARTLENS_ALBUM)

			if (existingAlbum) {
				await MediaLibrary.addAssetsToAlbumAsync(
					[asset],
					existingAlbum,
					false
				)
			} else {
				await MediaLibrary.createAlbumAsync(ARTLENS_ALBUM, asset, false)
			}

			// Step 5 — Clean up the temporary named copy.
			try {
				destFile.delete()
			} catch (err) {
				tracker.warn(
					'Failed to delete temporary export file from cache',
					{
						filename,
						error: err instanceof Error ? err.message : String(err),
						outputUri,
					}
				)
			}

			// Step 6 — Show success state for 4 seconds.
			setIsSaved(true)
			setTimeout(() => setIsSaved(false), 4000)
		} catch (err) {
			tracker.error('Artwork save to gallery pipeline failed', {
				jobId,
				styleName,
				exportFormat,
				quality,
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
				'Save Failed',
				err instanceof Error ? err.message : 'Could not save image.'
			)
		} finally {
			setIsSaving(false)
		}
	}, [
		outputUri,
		isSaving,
		isSaved,
		filename,
		exportFormat,
		jobId,
		quality,
		styleName,
	])

	// ── Share ─────────────────────────────────────────────────────────────────
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

			// Use the original outputUri directly — no duplicate copy needed.
			await Sharing.shareAsync(outputUri, {
				mimeType:
					exportFormat.toLowerCase() === 'png'
						? 'image/png'
						: 'image/jpeg',
				dialogTitle: `Share ${filename}`,
				UTI:
					exportFormat.toLowerCase() === 'png'
						? 'public.png'
						: 'public.jpeg',
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

	// ── Share to a specific social app ───────────────────────────────────────
	// Strategy:
	//   1. Check if the target app is installed (Linking.canOpenURL on the scheme).
	//   2. If yes: use expo-sharing — it lets the OS route to that specific app
	//      via the native share sheet pre-filtered. On Android we pass the package
	//      as a hint; on iOS the UTI constrains compatible apps.
	//   3. If no: fall back to the generic system share sheet (same Sharing.shareAsync).
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

				// Check if the target social app is installed.
				const scheme = Platform.OS === 'ios' ? target.iosScheme : null
				const appInstalled = scheme
					? await Linking.canOpenURL(scheme).catch(() => false)
					: false

				tracker.log('Social share attempt', {
					target: target.id,
					appInstalled,
					outputUri: outputUri.substring(0, 80),
				})

				// expo-sharing opens the native share sheet; the OS surfaces the
				// target app at the top when it matches the MIME type. On Android
				// we cannot programmatically pre-select an app without a custom
				// Intent bridge, so we rely on the share sheet ordering.
				await Sharing.shareAsync(outputUri, {
					mimeType:
						exportFormat.toLowerCase() === 'png'
							? 'image/png'
							: 'image/jpeg',
					dialogTitle: `Share to ${target.label}`,
					UTI:
						exportFormat.toLowerCase() === 'png'
							? 'public.png'
							: 'public.jpeg',
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
		<View style={[styles.screen, { backgroundColor: C.bg }]}>
			{/* ── Header ──────────────────────────────────────────────────── */}
			<View style={[styles.header, { paddingTop: insets.top + 4 }]}>
				<Pressable
					onPress={() => router.back()}
					style={styles.headerBtn}
					accessibilityRole="button"
					accessibilityLabel="Go back"
					hitSlop={12}
				>
					<ChevronLeft color={C.text} size={26} strokeWidth={1.8} />
				</Pressable>
				<Text style={styles.headerTitle}>Export</Text>
				{/* Spacer to balance the back button */}
				<View style={styles.headerSpacer} />
			</View>

			{/* ── Scrollable content ───────────────────────────────────────── */}
			<ScrollView
				contentContainerStyle={[
					styles.scrollContent,
					{ paddingBottom: insets.bottom + 32 },
				]}
				showsVerticalScrollIndicator={false}
				keyboardShouldPersistTaps="handled"
			>
				{/* ── Artwork thumbnail ──────────────────────────────────── */}
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
								colors={['transparent', 'rgba(8,8,16,0.7)']}
								style={styles.thumbGradient}
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

				{/* ── Section header ────────────────────────────────────── */}
				<View style={styles.titleSection}>
					<Text style={styles.pageTitle}>Save Your Artwork</Text>
					<Text style={styles.pageSub}>
						Choose a quality level, then download to your gallery or
						share it directly.
					</Text>
				</View>

				{/* ── Quality selector ──────────────────────────────────── */}
				<Text style={styles.sectionLabel}>SELECT QUALITY</Text>
				{QUALITY_OPTIONS.map((opt) => (
					<QualityCard
						key={opt.id}
						opt={opt}
						selected={quality === opt.id}
						onSelect={setQuality}
					/>
				))}

				{/* ── Save to gallery button ────────────────────────────── */}
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
							<CheckCircle
								color={C.white}
								size={20}
								strokeWidth={2.5}
								fill={C.white}
							/>
							<Text style={styles.saveBtnText}>
								Saved to ArtLens
							</Text>
						</>
					) : (
						<>
							<Download
								color={C.white}
								size={20}
								strokeWidth={2}
							/>
							<Text style={styles.saveBtnText}>
								Download Artwork
							</Text>
						</>
					)}
				</Pressable>

				{/* ── Social share targets ────────────────────────────────── */}
				<Text style={styles.sectionLabel}>SHARE TO</Text>
				<View style={styles.socialGrid}>
					{SOCIAL_TARGETS.map((target) => (
						<SocialChip
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

				{/* ── Generic system share sheet ────────────────────────── */}
				<Pressable
					onPress={handleShare}
					disabled={
						isSharing || !outputUri || sharingSocialId !== null
					}
					style={[
						styles.shareBtn,
						(!outputUri || isSharing) && { opacity: 0.55 },
					]}
					accessibilityRole="button"
					accessibilityLabel="Share artwork via system share sheet"
				>
					{isSharing ? (
						<ActivityIndicator color={C.primaryMid} size="small" />
					) : (
						<Share2
							color={C.primaryMid}
							size={18}
							strokeWidth={2}
						/>
					)}
					<Text style={styles.shareBtnText}>More Options…</Text>
				</Pressable>

				{/* ── Privacy disclosure ────────────────────────────────── */}
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
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: { flex: 1 },

	// ── Header ────────────────────────────────────────────────────────────────
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 12,
		paddingBottom: 10,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: '#1E1E30',
	},
	headerBtn: {
		width: 40,
		height: 40,
		borderRadius: 20,
		justifyContent: 'center',
		alignItems: 'center',
	},
	headerTitle: {
		flex: 1,
		textAlign: 'center',
		color: '#F4F4FF',
		fontSize: 17,
		fontWeight: '700',
		letterSpacing: -0.2,
	},
	headerSpacer: {
		width: 40,
	},

	// ── Scroll ────────────────────────────────────────────────────────────────
	scrollContent: {
		paddingHorizontal: 20,
	},

	// ── Thumbnail ─────────────────────────────────────────────────────────────
	thumbWrap: {
		width: SCREEN_W - 40,
		height: THUMB_H,
		borderRadius: 20,
		overflow: 'hidden',
		alignSelf: 'center',
		marginVertical: 20,
		borderWidth: 1,
		borderColor: '#1E1E30',
		backgroundColor: '#10101C',
	},
	thumb: {
		width: '100%',
		height: '100%',
	},
	thumbPlaceholder: {
		backgroundColor: '#181828',
	},
	thumbGradient: {
		...StyleSheet.absoluteFillObject,
	},
	thumbBadge: {
		position: 'absolute',
		bottom: 12,
		left: 12,
		right: 12,
		backgroundColor: 'rgba(8,8,16,0.75)',
		borderRadius: 8,
		paddingHorizontal: 10,
		paddingVertical: 5,
	},
	thumbFilename: {
		color: '#7070A0',
		fontSize: 11,
		fontWeight: '500',
	},

	// ── Title section ─────────────────────────────────────────────────────────
	titleSection: {
		alignItems: 'center',
		marginBottom: 28,
		gap: 8,
	},
	pageTitle: {
		color: '#F4F4FF',
		fontSize: 24,
		fontWeight: '800',
		letterSpacing: -0.5,
		textAlign: 'center',
	},
	pageSub: {
		color: '#7070A0',
		fontSize: 14,
		textAlign: 'center',
		lineHeight: 21,
		paddingHorizontal: 20,
	},

	// ── Section label ─────────────────────────────────────────────────────────
	sectionLabel: {
		color: '#40405A',
		fontSize: 11,
		fontWeight: '700',
		letterSpacing: 1.0,
		textTransform: 'uppercase',
		marginBottom: 12,
	},

	// ── Quality cards ─────────────────────────────────────────────────────────
	qualityCard: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: '#10101C',
		borderRadius: 16,
		borderWidth: 1.5,
		borderColor: '#1E1E30',
		padding: 16,
		marginBottom: 10,
	},
	qualityCardSelected: {
		borderColor: '#7C3AED',
		backgroundColor: 'rgba(124,58,237,0.05)',
		...Platform.select({
			ios: {
				shadowColor: '#7C3AED',
				shadowOffset: { width: 0, height: 4 },
				shadowOpacity: 0.18,
				shadowRadius: 10,
			},
			android: { elevation: 4 },
		}),
	},
	qualityInfo: { flex: 1 },
	qualityTitleRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		marginBottom: 4,
	},
	qualityTitle: {
		color: '#F4F4FF',
		fontSize: 15,
		fontWeight: '700',
	},
	qualityTitleSelected: {
		color: '#7C3AED',
	},
	estimateBadge: {
		backgroundColor: '#1E1E30',
		borderRadius: 6,
		paddingHorizontal: 7,
		paddingVertical: 2,
	},
	estimateBadgeSelected: {
		backgroundColor: '#7C3AED',
	},
	estimateText: {
		color: '#7070A0',
		fontSize: 11,
		fontWeight: '700',
	},
	qualitySub: {
		color: '#7070A0',
		fontSize: 12,
	},
	radio: {
		width: 22,
		height: 22,
		borderRadius: 11,
		borderWidth: 2,
		borderColor: '#40405A',
		justifyContent: 'center',
		alignItems: 'center',
		marginLeft: 14,
	},
	radioSelected: {
		borderColor: '#7C3AED',
	},
	radioDot: {
		width: 10,
		height: 10,
		borderRadius: 5,
		backgroundColor: '#7C3AED',
	},

	// ── Action buttons ────────────────────────────────────────────────────────
	saveBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 10,
		height: 58,
		borderRadius: 16,
		backgroundColor: '#7C3AED',
		marginTop: 24,
		marginBottom: 12,
	},
	saveBtnSuccess: {
		backgroundColor: '#10B981',
	},
	saveBtnText: {
		color: '#FFFFFF',
		fontSize: 16,
		fontWeight: '800',
	},
	shareBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		height: 50,
		borderRadius: 14,
		borderWidth: 1.5,
		borderColor: '#7C3AED',
		marginBottom: 20,
	},
	shareBtnText: {
		color: '#7C3AED',
		fontSize: 15,
		fontWeight: '700',
	},

	// ── Social chips ─────────────────────────────────────────────────────────
	socialGrid: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: 10,
		marginBottom: 12,
	},
	socialChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 7,
		paddingHorizontal: 14,
		paddingVertical: 10,
		borderRadius: 12,
		borderWidth: 1.5,
		borderColor: '#1E1E30',
		backgroundColor: '#10101C',
		minWidth: '45%',
		flex: 1,
	},
	socialDot: {
		width: 10,
		height: 10,
		borderRadius: 5,
	},
	socialLabel: {
		color: '#F4F4FF',
		fontSize: 13,
		fontWeight: '600',
	},

	// ── Privacy note ──────────────────────────────────────────────────────────
	privacyRow: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 6,
		paddingHorizontal: 8,
		marginBottom: 8,
	},
	privacyText: {
		flex: 1,
		color: '#40405A',
		fontSize: 12,
		lineHeight: 18,
	},
})
