/**
 * ArtLens — RefineScreen
 *
 * Route params:
 *   jobId         — to locate the job in useStyleJobStore
 *   compositeUri? — URI of a mask-composited image from EditCanvas brush tool.
 *                   Falls back to job.resultUri if absent.
 *
 * Flow:
 *   • Slider controls "Style Intensity" 0–100%.
 *     0% = fully original photo, 100% = fully stylised.
 *   • Moving the slider away from the last-applied value activates the
 *     "Stylise" button. Until then the button is inactive/un-pressable.
 *   • Pressing "Stylise" re-renders the Skia canvas at the chosen opacity
 *     and takes a snapshot → marks intensity as applied → button goes inactive.
 *   • "Export" button in the header (always active when images are ready)
 *     takes the current canvas snapshot and pushes to ExportScreen.
 *   • Back button returns to EditCanvas.
 *
 * PRD § 3.5 — RefineScreen
 */

import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Dimensions,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import {
	Canvas,
	Image as SkiaImage,
	ImageFormat,
	useCanvasRef,
	useImage,
} from '@shopify/react-native-skia'
import Slider from '@react-native-community/slider'
import * as FileSystem from 'expo-file-system'
import {
	ChevronLeft,
	Layers,
	SlidersHorizontal,
	Sparkles,
	Upload,
	Wand2,
} from 'lucide-react-native'

import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useModelStore } from '@/shared/stores/useModelStore'

import { createTracker } from '@/shared/utils/logger'
const tracker = createTracker('refine_screen')

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS — matches ArtLens app-wide palette
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
	white: '#FFFFFF',
} as const

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function aspectFitDimensions(
	imageWidth: number,
	imageHeight: number,
	maxWidth: number,
	maxHeight: number
): { canvasW: number; canvasH: number } {
	const ratio = imageWidth / imageHeight
	let canvasW = maxWidth
	let canvasH = canvasW / ratio
	if (canvasH > maxHeight) {
		canvasH = maxHeight
		canvasW = canvasH * ratio
	}
	return { canvasW, canvasH }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function RefineScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// ── Route params ──────────────────────────────────────────────────────────
	const { jobId, compositeUri } = useLocalSearchParams<{
		jobId: string
		compositeUri?: string
	}>()

	// ── Store hydration ───────────────────────────────────────────────────────
	const job = useStyleJobStore(
		(s) => s.jobs.find((j) => j.id === jobId) ?? null
	)
	const catalog = useModelStore((s) => s.catalog)

	const styleName = useMemo(
		() => catalog.find((m) => m.id === job?.styleId)?.name ?? 'Style',
		[catalog, job?.styleId]
	)

	// ── Overlay URI resolution ────────────────────────────────────────────────
	const overlayUri = useMemo((): string | null => {
		if (compositeUri && compositeUri.length > 0) return compositeUri
		return job?.resultUri ?? null
	}, [compositeUri, job?.resultUri])

	// ── Skia canvas ───────────────────────────────────────────────────────────
	const canvasRef = useCanvasRef()
	const baseImage = useImage(job?.sourceUri ?? null)
	const overlayImage = useImage(overlayUri)

	// ── Style intensity state ─────────────────────────────────────────────────
	// `intensity`       — live slider value 0–100 (integer %, shown to user)
	// `appliedIntensity`— the value at which Stylise was last run (starts at 100)
	// `intensityDirty`  — true when slider has moved from the last applied value
	//                     → activates the Stylise button
	const [intensity, setIntensity] = useState(100)
	const appliedIntensityRef = useRef(100)
	const [intensityDirty, setIntensityDirty] = useState(false)

	const handleIntensityChange = useCallback((val: number) => {
		const rounded = Math.round(val)
		setIntensity(rounded)
		setIntensityDirty(rounded !== appliedIntensityRef.current)
	}, [])

	// alphaBlend for Skia canvas: intensity/100
	const alphaBlend = intensity / 100

	// ── UI loading state ─────────────────────────────────────────────────────
	const [isStylising, setIsStylising] = useState(false)
	const [isExporting, setIsExporting] = useState(false)

	// ── Aspect-fit canvas dimensions ──────────────────────────────────────────
	const { canvasW, canvasH } = useMemo(() => {
		const MAX_W = SCREEN_W
		const MAX_H = SCREEN_H * 0.58
		if (baseImage) {
			return aspectFitDimensions(
				baseImage.width(),
				baseImage.height(),
				MAX_W,
				MAX_H
			)
		}
		return { canvasW: MAX_W, canvasH: MAX_W }
	}, [baseImage])

	// ── Snapshot helper — shared by Stylise and Export ────────────────────────
	const takeSnapshot = useCallback(async (): Promise<string> => {
		const snapshot = canvasRef.current?.makeImageSnapshot()
		if (!snapshot) {
			throw new Error('Canvas snapshot returned null.')
		}
		const base64 = snapshot.encodeToBase64(ImageFormat.PNG)
		if (!base64) {
			throw new Error('Image encoding produced no data.')
		}
		const filename = `refine_stage_${jobId}_${Date.now()}.png`
		const destFile = FileSystem.Paths.cache.createFile(
			filename,
			'image/png'
		)
		await destFile.write(base64, { encoding: 'base64' })
		return destFile.uri
	}, [canvasRef, jobId])

	// ── "Stylise" — apply the current intensity to produce a snapshot ─────────
	// After running, intensity is marked as applied and the button deactivates.
	const handleStylise = useCallback(async () => {
		if (!intensityDirty || isStylising) return
		setIsStylising(true)
		try {
			// The Skia canvas already renders at the new alphaBlend (opacity).
			// Taking a snapshot captures the blended output at the chosen intensity.
			await takeSnapshot()
			// Mark intensity as applied → deactivate the Stylise button.
			appliedIntensityRef.current = intensity
			setIntensityDirty(false)
			tracker.log('Style intensity applied via Skia snapshot', {
				jobId,
				intensity,
			})
		} catch (err) {
			tracker.error('Stylise snapshot failed', {
				jobId,
				intensity,
				error: err,
			})
			Alert.alert(
				'Stylise Failed',
				err instanceof Error ? err.message : 'Could not apply style.'
			)
		} finally {
			setIsStylising(false)
		}
	}, [intensityDirty, isStylising, takeSnapshot, intensity, jobId])

	// ── "Export" — snapshot current canvas and push to ExportScreen ───────────
	const handleExport = useCallback(async () => {
		if (isExporting) return
		setIsExporting(true)
		try {
			const outputUri = await takeSnapshot()
			tracker.log('Refine snapshot taken, routing to export', {
				jobId,
				outputUri,
				intensity,
			})
			router.push({
				pathname: '/(screens)/export',
				params: { jobId, outputUri },
			})
		} catch (err) {
			tracker.error('Export snapshot failed', {
				jobId,
				intensity,
				error: err,
			})
			Alert.alert(
				'Export Failed',
				err instanceof Error
					? err.message
					: 'Could not create refined image.'
			)
		} finally {
			setIsExporting(false)
		}
	}, [isExporting, takeSnapshot, jobId, intensity])

	// ── Guard: unreachable unless job is DONE ────────────────────────────────
	if (!job || job.status !== 'DONE' || !job.resultUri) {
		return (
			<View
				style={[
					styles.screen,
					styles.center,
					{ backgroundColor: C.bg },
				]}
			>
				<ActivityIndicator color={C.primaryMid} size="large" />
				<Text style={styles.loadingText}>Waiting for stylization…</Text>
				<Pressable
					onPress={() => router.back()}
					style={styles.backFallback}
				>
					<Text style={styles.backFallbackText}>← Back</Text>
				</Pressable>
			</View>
		)
	}

	const imagesReady = Boolean(baseImage && overlayImage)

	return (
		<View style={[styles.screen, { backgroundColor: C.bg }]}>
			{/* ── Header ──────────────────────────────────────────────────── */}
			<View style={[styles.header, { paddingTop: insets.top + 4 }]}>
				<Pressable
					onPress={() => router.back()}
					style={styles.headerBtn}
					accessibilityRole="button"
					accessibilityLabel="Go back to canvas"
					hitSlop={12}
				>
					<ChevronLeft color={C.text} size={26} strokeWidth={1.8} />
				</Pressable>

				<View style={styles.headerCenter}>
					<Text style={styles.headerTitle}>Refine</Text>
					<Text style={styles.headerSub}>{styleName}</Text>
				</View>

				{/* Export button — always active once images are ready */}
				<Pressable
					onPress={handleExport}
					disabled={isExporting || !imagesReady}
					style={[
						styles.exportBtn,
						(isExporting || !imagesReady) &&
							styles.exportBtnDisabled,
					]}
					accessibilityRole="button"
					accessibilityLabel="Export refined artwork"
				>
					{isExporting ? (
						<ActivityIndicator color={C.white} size="small" />
					) : (
						<View style={styles.exportBtnInner}>
							<Upload
								color={C.white}
								size={14}
								strokeWidth={2.2}
							/>
							<Text style={styles.exportText}>Export</Text>
						</View>
					)}
				</Pressable>
			</View>

			{/* ── Canvas workspace ────────────────────────────────────────── */}
			<View
				style={[styles.canvasWrap, { width: canvasW, height: canvasH }]}
			>
				{!imagesReady && (
					<View style={styles.imageLoadOverlay}>
						<ActivityIndicator color={C.primaryMid} size="large" />
						<Text style={styles.loadingText}>Loading images…</Text>
					</View>
				)}

				<Canvas
					ref={canvasRef}
					style={{ width: canvasW, height: canvasH }}
				>
					{/* Base layer — original photo, always fully opaque */}
					{baseImage && (
						<SkiaImage
							image={baseImage}
							x={0}
							y={0}
							width={canvasW}
							height={canvasH}
							fit="contain"
						/>
					)}
					{/* Stylised overlay — opacity driven by intensity slider */}
					{overlayImage && (
						<SkiaImage
							image={overlayImage}
							x={0}
							y={0}
							width={canvasW}
							height={canvasH}
							fit="contain"
							opacity={alphaBlend}
						/>
					)}
				</Canvas>

				{/* Blend mode badges */}
				<View style={styles.modeBadgeRow} pointerEvents="none">
					<View
						style={[
							styles.modeBadge,
							{ opacity: Math.max(0.15, 1 - alphaBlend) },
						]}
					>
						<Text style={styles.modeBadgeText}>Original</Text>
					</View>
					<View
						style={[
							styles.modeBadge,
							styles.modeBadgeStyled,
							{ opacity: Math.max(0.15, alphaBlend) },
						]}
					>
						<Sparkles color={C.white} size={10} fill={C.white} />
						<Text
							style={[styles.modeBadgeText, { color: C.white }]}
						>
							Stylized
						</Text>
					</View>
				</View>
			</View>

			{/* ── Slider panel ────────────────────────────────────────────── */}
			<View
				style={[
					styles.panel,
					{ flex: 1, paddingBottom: insets.bottom + 20 },
				]}
			>
				{/* Header row */}
				<View style={styles.sliderHeader}>
					<View style={styles.sliderLabelRow}>
						<SlidersHorizontal
							color={C.primaryMid}
							size={16}
							strokeWidth={1.6}
						/>
						<Text style={styles.sliderLabel}>Style Intensity</Text>
					</View>
					<Text style={styles.sliderValue}>{intensity}%</Text>
				</View>

				{/*
				 * Slider: 0 = fully original, 100 = fully stylised.
				 * Moving the slider activates the Stylise button below.
				 */}
				<Slider
					style={styles.slider}
					minimumValue={0}
					maximumValue={100}
					step={1}
					value={intensity}
					onValueChange={handleIntensityChange}
					minimumTrackTintColor={C.primaryMid}
					maximumTrackTintColor={C.border}
					thumbTintColor={C.primaryMid}
					tapToSeek
					accessibilityLabel="Style intensity slider"
					accessibilityHint="Drag left for original photo, right for full style"
				/>

				<View style={styles.sliderEndLabels}>
					<Text style={styles.sliderEndLabel}>Original</Text>
					<Text style={styles.sliderEndLabel}>Full Art</Text>
				</View>

				{/* Stylise button — active only when intensity has changed */}
				<Pressable
					onPress={handleStylise}
					disabled={!intensityDirty || isStylising || !imagesReady}
					style={[
						styles.styliseBtn,
						intensityDirty && imagesReady
							? styles.styliseBtnActive
							: styles.styliseBtnInactive,
					]}
					accessibilityRole="button"
					accessibilityLabel={
						intensityDirty
							? 'Apply new style intensity'
							: 'Change the slider to enable re-stylisation'
					}
					accessibilityState={{
						disabled: !intensityDirty || isStylising,
					}}
				>
					{isStylising ? (
						<ActivityIndicator color={C.white} size="small" />
					) : (
						<Wand2
							color={intensityDirty ? C.white : C.textDim}
							size={16}
							strokeWidth={2}
						/>
					)}
					<Text
						style={[
							styles.styliseBtnText,
							!intensityDirty && styles.styliseBtnTextInactive,
						]}
					>
						{isStylising ? 'Stylising…' : 'Stylise'}
					</Text>
				</Pressable>

				{/* Hint */}
				<View style={styles.tipRow}>
					<Layers color={C.textDim} size={12} strokeWidth={1.4} />
					<Text style={styles.tipText}>
						{intensityDirty
							? 'Tap Stylise to apply the new intensity, then Export when ready.'
							: 'Adjust intensity to re-activate the Stylise button.'}
					</Text>
				</View>
			</View>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: { flex: 1 },
	center: {
		justifyContent: 'center',
		alignItems: 'center',
		gap: 16,
		padding: 32,
	},

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
	headerCenter: {
		flex: 1,
		alignItems: 'center',
	},
	headerTitle: {
		color: '#F4F4FF',
		fontSize: 17,
		fontWeight: '700',
		letterSpacing: -0.2,
	},
	headerSub: {
		color: '#7070A0',
		fontSize: 12,
		marginTop: 2,
	},
	exportBtn: {
		backgroundColor: '#7C3AED',
		borderRadius: 12,
		paddingHorizontal: 14,
		paddingVertical: 9,
		minWidth: 72,
		alignItems: 'center',
		justifyContent: 'center',
	},
	exportBtnInner: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 5,
	},
	exportBtnDisabled: { opacity: 0.45 },
	exportText: {
		color: '#FFFFFF',
		fontSize: 15,
		fontWeight: '700',
	},

	// ── Canvas ────────────────────────────────────────────────────────────────
	canvasWrap: {
		alignSelf: 'center',
		backgroundColor: '#050508',
		overflow: 'hidden',
	},
	imageLoadOverlay: {
		...StyleSheet.absoluteFillObject,
		justifyContent: 'center',
		alignItems: 'center',
		gap: 12,
		zIndex: 10,
		backgroundColor: '#050508',
	},
	modeBadgeRow: {
		position: 'absolute',
		bottom: 12,
		left: 12,
		right: 12,
		flexDirection: 'row',
		justifyContent: 'space-between',
	},
	modeBadge: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		backgroundColor: 'rgba(0,0,0,0.6)',
		borderRadius: 8,
		paddingHorizontal: 8,
		paddingVertical: 4,
	},
	modeBadgeStyled: {
		backgroundColor: 'rgba(124,58,237,0.8)',
	},
	modeBadgeText: {
		color: '#7070A0',
		fontSize: 11,
		fontWeight: '600',
	},

	// ── Slider panel ──────────────────────────────────────────────────────────
	panel: {
		backgroundColor: '#10101C',
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: '#1E1E30',
		paddingHorizontal: 20,
		paddingTop: 20,
		gap: 8,
	},
	sliderHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	sliderLabelRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	sliderLabel: {
		color: '#F4F4FF',
		fontSize: 15,
		fontWeight: '600',
	},
	sliderValue: {
		color: '#7C3AED',
		fontSize: 15,
		fontWeight: '800',
		letterSpacing: -0.3,
	},
	slider: {
		width: '100%',
		height: 44,
	},
	sliderEndLabels: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		marginTop: -6,
	},
	sliderEndLabel: {
		color: '#40405A',
		fontSize: 11,
		fontWeight: '500',
	},

	// ── Stylise button ────────────────────────────────────────────────────────
	styliseBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		height: 52,
		borderRadius: 14,
		marginTop: 4,
	},
	styliseBtnActive: {
		backgroundColor: '#7C3AED',
	},
	styliseBtnInactive: {
		backgroundColor: '#181828',
		borderWidth: 1,
		borderColor: '#1E1E30',
	},
	styliseBtnText: {
		color: '#FFFFFF',
		fontSize: 15,
		fontWeight: '700',
	},
	styliseBtnTextInactive: {
		color: '#40405A',
	},

	// ── Hint row ─────────────────────────────────────────────────────────────
	tipRow: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 6,
		marginTop: 2,
	},
	tipText: {
		color: '#40405A',
		fontSize: 12,
		flex: 1,
		lineHeight: 17,
	},

	// ── Loading / fallback ────────────────────────────────────────────────────
	loadingText: {
		color: '#7070A0',
		fontSize: 14,
		fontWeight: '500',
	},
	backFallback: {
		marginTop: 8,
		padding: 10,
	},
	backFallbackText: {
		color: '#7C3AED',
		fontSize: 15,
		fontWeight: '700',
	},
})
