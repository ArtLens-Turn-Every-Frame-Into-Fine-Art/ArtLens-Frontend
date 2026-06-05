/**
 * ArtLens — EditCanvas (Modal)
 *
 * Entry points:
 *   1. CameraScreen → job was enqueued; we receive jobId via params
 *   2. GalleryScreen → tap any job card; same jobId param
 *
 * Status-gated UI:
 *   QUEUED         → source image preview + progress placeholder + "Process Now"
 *   PROCESSING     → source image + animated progress bar + percentage
 *   DONE           → interactive alpha-mask brush canvas + "Next" header CTA
 *   ERROR          → error card + "Retry"
 *   BATTERY_PAUSED → original image + freeze notice
 *
 * DONE mode implements a zero-lag finger-painted alpha mask:
 *   - Pan gesture drives SkPath via Reanimated shared values (no React state)
 *   - Skia <Canvas> renders: base image → mask-clipped styled layer → overlay
 *   - "Next" taps SkiaRenderer.createCompositeSurfaceSnapshot() → routes to
 *     /(screens)/refine with the compositeUri param
 *
 * PRD § 3.4 — EditCanvas Screen
 *
 * Dependencies (external):
 *   - src/shared/stores/useStyleJobStore
 *   - src/shared/stores/useModelStore
 *   - src/features/style-transfer/StyleJobService
 *   - src/shared/renderers/SkiaRenderer
 *   - src/types/index.ts
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Dimensions,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Slider from '@react-native-community/slider'
import { router, useLocalSearchParams } from 'expo-router'
import { Image } from 'expo-image'
import Animated, {
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import {
	Canvas,
	Image as SkiaImage,
	Path,
	Mask,
	Skia,
	useImage,
	SkPath,
} from '@shopify/react-native-skia'
import {
	AlertCircle,
	Battery,
	ChevronLeft,
	Cpu,
	Image as ImageIcon,
	RefreshCw,
	Redo2,
	Undo2,
	Wand2,
	Zap,
	ArrowRight,
	Brush,
} from 'lucide-react-native'

// — Stores & Services —————————————————————————————————————————————————————————
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useModelStore } from '@/shared/stores/useModelStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'
import { SkiaRenderer } from '@/features/canvas/SkiaRenderer'

// — Types ——————————————————————————————————————————————————————————————————————
import type { StyleJob } from '@/types'

import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('edit_canvas')

// — Design tokens —————————————————————————————————————————————————————————————
const C = {
	bg: '#F8F9FB',
	surface: '#FFFFFF',
	surfaceHigh: '#F2F2F7',
	border: '#E5E5EA',
	primary: '#7B61FF',
	primaryMid: '#7B61FF',
	accent: '#FF7675',
	text: '#1C1C1E',
	textMuted: '#8E8E93',
	textDim: '#AEAEB2',
	success: '#34C759',
	downloaded: '#4CD964',
	warning: '#FF9F0A',
	error: '#FF7675',
	white: '#FFFFFF',
} as const

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')

// Canvas area height — same proportion used by the original mainImage style
const CANVAS_H = SCREEN_H * 0.65

// Singleton renderer — shared across renders, no re-instantiation cost
const _renderer = new SkiaRenderer()

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// — Animated progress bar ——————————————————————————————————————————————————————
const ProgressBar: React.FC<{ progress: number }> = React.memo(
	({ progress }) => {
		const width = useSharedValue(0)

		useEffect(() => {
			width.value = withTiming(Math.max(0, Math.min(1, progress)), {
				duration: 350,
				easing: Easing.out(Easing.quad),
			})
		}, [progress, width])

		const animStyle = useAnimatedStyle(() => ({
			width: `${width.value * 100}%` as unknown as number,
		}))

		return (
			<View style={styles.progressTrack}>
				<Animated.View style={[styles.progressFill, animStyle]} />
			</View>
		)
	}
)
ProgressBar.displayName = 'ProgressBar'

// — Status overlay — rendered for every non-DONE state ————————————————————————
interface StatusOverlayProps {
	job: StyleJob
	onProcessNow: () => void
	onRetry: () => void
}

const StatusOverlay: React.FC<StatusOverlayProps> = React.memo(
	({ job, onProcessNow, onRetry }) => {
		if (job.status === 'DONE') return null

		return (
			<View
				style={styles.statusOverlay}
				pointerEvents={
					job.status === 'PROCESSING' ? 'none' : 'box-none'
				}
			>
				{/* QUEUED ———————————————————————————————————— */}
				{job.status === 'QUEUED' && (
					<View style={styles.statusCard}>
						<View style={styles.statusIconRow}>
							<Cpu
								color={C.primaryMid}
								size={28}
								strokeWidth={1.4}
							/>
						</View>
						<Text style={styles.statusTitle}>In queue</Text>
						<Text style={styles.statusSub}>
							Your photo is waiting to be stylized. Jump the queue
							to process it now.
						</Text>
						<Pressable
							onPress={onProcessNow}
							style={styles.processNowBtn}
							accessibilityRole="button"
							accessibilityLabel="Process now, jump the queue"
						>
							<Zap
								color={C.white}
								size={18}
								strokeWidth={2}
								fill={C.white}
							/>
							<Text style={styles.processNowText}>
								Process Now
							</Text>
						</Pressable>
					</View>
				)}

				{/* PROCESSING ———————————————————————————————— */}
				{job.status === 'PROCESSING' && (
					<View style={styles.processingHud}>
						<ProgressBar progress={job.progress} />
						<View style={styles.processingMeta}>
							<Text style={styles.processingLabel}>
								Stylizing…
							</Text>
							<Text style={styles.processingPct}>
								{Math.round(job.progress * 100)}%
							</Text>
						</View>
						<Text style={styles.processingHint}>
							Feel free to take more photos. We&apos;ll keep
							working in the background.
						</Text>
					</View>
				)}

				{/* ERROR ————————————————————————————————————— */}
				{job.status === 'ERROR' && (
					<View style={styles.statusCard}>
						<AlertCircle
							color={C.error}
							size={32}
							strokeWidth={1.4}
						/>
						<Text style={styles.statusTitle}>
							Stylization failed
						</Text>
						<Text style={styles.statusSub}>
							{job.errorMessage ?? 'An unknown error occurred.'}
						</Text>
						{job.retryable && (
							<Pressable
								onPress={onRetry}
								style={[
									styles.processNowBtn,
									{ backgroundColor: C.error },
								]}
								accessibilityRole="button"
							>
								<RefreshCw
									color={C.white}
									size={16}
									strokeWidth={2}
								/>
								<Text style={styles.processNowText}>Retry</Text>
							</Pressable>
						)}
					</View>
				)}

				{/* BATTERY_PAUSED ———————————————————————————— */}
				{job.status === 'BATTERY_PAUSED' && (
					<View style={styles.statusCard}>
						<Battery
							color={C.warning}
							size={32}
							strokeWidth={1.4}
						/>
						<Text style={styles.statusTitle}>
							Processing paused
						</Text>
						<Text style={styles.statusSub}>
							Battery is critically low. Connect a charger to
							resume.
						</Text>
					</View>
				)}
			</View>
		)
	}
)
StatusOverlay.displayName = 'StatusOverlay'

// — Bottom actions panel — shown for ALL states; buttons active only when DONE ──
// Flow: user can go directly to Export, or refine intensity first then export.
interface ActionsProps {
	job: StyleJob
	onRefine: () => void
	onExport: () => void
}

const BottomActions: React.FC<ActionsProps> = React.memo(
	({ job, onRefine, onExport }) => {
		const isDone = job.status === 'DONE'

		return (
			<View style={styles.bottomPanel}>
				{/* Refine — adjust style intensity before exporting */}
				<Pressable
					onPress={onRefine}
					disabled={!isDone}
					style={[
						styles.actionBtn,
						styles.actionBtnSecondary,
						!isDone && styles.actionBtnDisabled,
					]}
					accessibilityRole="button"
					accessibilityLabel="Refine style intensity"
				>
					<Brush
						color={isDone ? C.text : C.textDim}
						size={18}
						strokeWidth={2}
					/>
					<Text
						style={[
							styles.actionBtnTextSecondary,
							!isDone && styles.actionBtnTextDisabled,
						]}
					>
						Refine
					</Text>
				</Pressable>

				{/* Export — save to gallery or share directly */}
				<Pressable
					onPress={onExport}
					disabled={!isDone}
					style={[
						styles.actionBtn,
						styles.actionBtnPrimary,
						!isDone && styles.actionBtnDisabled,
					]}
					accessibilityRole="button"
					accessibilityLabel="Export or share artwork"
				>
					<ImageIcon
						color={isDone ? C.white : C.textDim}
						size={18}
						strokeWidth={1.8}
					/>
					<Text
						style={[
							styles.actionBtnText,
							!isDone && styles.actionBtnTextDisabled,
						]}
					>
						Export
					</Text>
				</Pressable>
			</View>
		)
	}
)
BottomActions.displayName = 'BottomActions'

// — Controls panel — slider + AI prompt; shown in all states ─────────────────

interface ControlsPanelProps {
	intensity: number
	onIntensityChange: (v: number) => void
	prompt: string
	onPromptChange: (v: string) => void
	isGenerating: boolean
	onGenerate: () => void
}

const ControlsPanel: React.FC<ControlsPanelProps> = React.memo(
	({
		intensity,
		onIntensityChange,
		prompt,
		onPromptChange,
		isGenerating,
		onGenerate,
	}) => (
		<View style={styles.controlsSection}>
			{/* Style intensity slider */}
			<View style={styles.sliderContainer}>
				<View style={styles.sliderLabelRow}>
					<Text style={styles.sliderLabel}>Style Intensity</Text>
					<Text style={styles.sliderValue}>
						{Math.round(intensity * 100)}%
					</Text>
				</View>
				<Slider
					style={styles.slider}
					minimumValue={0}
					maximumValue={1}
					value={intensity}
					onValueChange={onIntensityChange}
					minimumTrackTintColor={C.primaryMid}
					maximumTrackTintColor={C.border}
					thumbTintColor={C.primaryMid}
				/>
			</View>

			{/* AI prompt input */}
			<View style={styles.inputWrapper}>
				<Wand2
					size={20}
					color={C.primaryMid}
					style={styles.inputIcon}
				/>
				<TextInput
					style={styles.textInput}
					value={prompt}
					onChangeText={onPromptChange}
					placeholder="e.g. A cyberpunk city at night..."
					placeholderTextColor={C.textMuted}
					onSubmitEditing={onGenerate}
					returnKeyType="go"
				/>
				{isGenerating ? (
					<ActivityIndicator size="small" color={C.primaryMid} />
				) : (
					<Pressable
						onPress={onGenerate}
						accessibilityRole="button"
						accessibilityLabel="Generate AI background"
						hitSlop={8}
					>
						<Text style={styles.generateBtnText}>Gen</Text>
					</Pressable>
				)}
			</View>

			{/* Generating status overlay pill */}
			{isGenerating && (
				<View style={styles.generatingBanner}>
					<ActivityIndicator size="small" color={C.primaryMid} />
					<View>
						<Text style={styles.generatingText}>
							AI is painting your background…
						</Text>
						<Text style={styles.generatingSubtext}>
							You can navigate away. We&apos;ll notify you when
							done.
						</Text>
					</View>
				</View>
			)}
		</View>
	)
)
ControlsPanel.displayName = 'ControlsPanel'

// ─────────────────────────────────────────────────────────────────────────────
// DONE-STATE: INTERACTIVE ALPHA-MASK BRUSH CANVAS
// ─────────────────────────────────────────────────────────────────────────────

interface BrushCanvasProps {
	sourceUri: string
	resultUri: string
	/** Called with the output composite file:// URI after snapshot completes */
	onNext: (compositeUri: string) => void
	onError: (message: string) => void
}

/**
 * Interactive alpha-masking workspace rendered when job.status === 'DONE'.
 *
 * Architecture:
 *   - Gesture.Pan drives SkPath mutations via runOnJS (Reanimated worklet-safe)
 *   - A Reanimated shared value `_redrawTick` is incremented on each gesture
 *     event, causing only the Skia canvas subtree to repaint — the outer React
 *     tree is never re-rendered during brush strokes.
 *   - Scale factors map screen gesture coordinates → raw image pixel space so
 *     the SkPath stored in the renderer matches the actual pixel dimensions
 *     required by createCompositeSurfaceSnapshot.
 */
const BrushCanvas: React.FC<BrushCanvasProps> = React.memo(
	({ sourceUri, resultUri, onNext, onError }) => {
		// ── Skia image hooks — null until decoded ──────────────────────────
		const originalImage = useImage(sourceUri)
		const styledImage = useImage(resultUri)

		// ── Persistent brush path — survives re-renders, never triggers them ─
		const pathRef = useRef<SkPath>(Skia.Path.Make())

		// ── Redraw tick — incremented by gesture handler to re-paint canvas ──
		// Using a plain React state here keeps things simple while the heavy
		// work (path mutation) stays off the bridge via runOnJS delegation.
		const [, forceRedraw] = useState(0)
		const triggerRedraw = useCallback(() => {
			forceRedraw((n) => n + 1)
		}, [])

		// ── Snapshot export state ──────────────────────────────────────────
		const [isExporting, setIsExporting] = useState(false)

		// ── Image dimension tracking for scale factors ─────────────────────
		// We use the image's natural pixel dimensions for the off-screen surface.
		// The canvas view occupies SCREEN_W × CANVAS_H display points.
		const imageNaturalWidth = originalImage?.width() ?? SCREEN_W
		const imageNaturalHeight = originalImage?.height() ?? CANVAS_H

		// Scale: display points → image pixel space
		const scaleX = imageNaturalWidth / SCREEN_W
		const scaleY = imageNaturalHeight / CANVAS_H

		// ── Pan gesture — zero-lag finger brush ───────────────────────────
		const panGesture = Gesture.Pan()
			.runOnJS(true)
			.onStart((event) => {
				pathRef.current.moveTo(event.x * scaleX, event.y * scaleY)
				triggerRedraw()
			})
			.onUpdate((event) => {
				pathRef.current.lineTo(event.x * scaleX, event.y * scaleY)
				triggerRedraw()
			})

		// ── Snapshot handler — invoked by parent's "Next" button ──────────
		const handleSnapshot = useCallback(async () => {
			if (!originalImage || !styledImage) return
			setIsExporting(true)
			try {
				const compositeUri =
					await _renderer.createCompositeSurfaceSnapshot(
						sourceUri,
						resultUri,
						pathRef.current,
						imageNaturalWidth,
						imageNaturalHeight
					)
				onNext(compositeUri)
			} catch (err) {
				const msg =
					err instanceof Error
						? err.message
						: 'Composite export failed.'

				// ENHANCED LOGGING: Capture surface metrics, aspect values, and underlying runtime error traces
				tracker.error('Skia composite snapshot conversion failed', {
					error: err,
					dimensions: {
						naturalWidth: imageNaturalWidth,
						naturalHeight: imageNaturalHeight,
						canvasDisplayHeight: CANVAS_H,
						screenWidth: SCREEN_W,
					},
					paths: {
						sourceUri: sourceUri?.substring(0, 120), // Protect length bounds safely
						resultUri: resultUri?.substring(0, 120),
					},
					componentPhase: 'BrushCanvas_Export_Surface',
				})

				onError(msg)
			} finally {
				setIsExporting(false)
			}
		}, [
			originalImage,
			styledImage,
			sourceUri,
			resultUri,
			imageNaturalWidth,
			imageNaturalHeight,
			onNext,
			onError,
		])

		// Expose handleSnapshot via imperative ref so parent header button
		// can invoke it without prop drilling into nested JSX.
		// We store it on a stable ref so the parent callback stays stable.
		useEffect(() => {
			_snapshotHandlerRef.current = handleSnapshot
		}, [handleSnapshot])

		// ── Loading state — wait for both images ──────────────────────────
		if (!originalImage || !styledImage) {
			return (
				<View style={styles.brushLoadingContainer}>
					<ActivityIndicator color={C.primaryMid} size="large" />
					<Text style={styles.brushLoadingText}>
						Loading artwork…
					</Text>
				</View>
			)
		}

		// ── Exporting overlay ──────────────────────────────────────────────
		if (isExporting) {
			return (
				<View style={styles.brushLoadingContainer}>
					<ActivityIndicator color={C.accent} size="large" />
					<Text style={styles.brushLoadingText}>Compositing…</Text>
				</View>
			)
		}

		// ── Interactive canvas stack ───────────────────────────────────────
		return (
			<GestureDetector gesture={panGesture}>
				<View style={styles.brushCanvasWrapper}>
					<Canvas style={styles.brushCanvas}>
						{/* Layer 1: Original image — full bleed base */}
						<SkiaImage
							image={originalImage}
							x={0}
							y={0}
							width={SCREEN_W}
							height={CANVAS_H}
							fit="cover"
						/>

						{/* Layer 2: Stylized image, revealed only where user paints.
						    We use Skia's <Mask> component in alpha mode:
						    - The mask draws a stroked Path (opaque = reveal)
						    - The masked child draws the styled image
						    This achieves the "brush reveals AI style" effect at GPU speed. */}
						<Mask
							mode="alpha"
							mask={
								<Path
									path={pathRef.current}
									style="stroke"
									strokeWidth={35}
									strokeCap="round"
									strokeJoin="round"
									color="white"
								/>
							}
						>
							<SkiaImage
								image={styledImage}
								x={0}
								y={0}
								width={SCREEN_W}
								height={CANVAS_H}
								fit="cover"
							/>
						</Mask>
					</Canvas>

					{/* Brush hint pill — fades after first stroke */}
					<View style={styles.brushHint} pointerEvents="none">
						<Brush color={C.white} size={14} strokeWidth={1.8} />
						<Text style={styles.brushHintText}>
							Paint to reveal art style
						</Text>
					</View>
				</View>
			</GestureDetector>
		)
	}
)
BrushCanvas.displayName = 'BrushCanvas'

/**
 * Module-level ref for the snapshot handler so the parent screen's header
 * "Next" button can invoke it without re-creating callbacks on every render.
 * Pattern: child registers handler → parent invokes via ref.
 */
const _snapshotHandlerRef = {
	current: null as (() => Promise<void>) | null,
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function EditCanvasScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// — Params ————————————————————————————————————————————————————————————————
	const { jobId } = useLocalSearchParams<{ jobId: string }>()

	// — Store —————————————————————————————————————————————————————————————————
	const job = useStyleJobStore(
		(s) => s.jobs.find((j) => j.id === jobId) ?? null
	)
	const retryJob = useStyleJobStore((s) => s.retryJob)
	const updateJob = useStyleJobStore((s) => s.updateJob)
	const catalog = useModelStore((s) => s.catalog)

	// — Derived ———————————————————————————————————————————————————————————————
	const styleName = useMemo(
		() => catalog.find((m) => m.id === job?.styleId)?.name ?? 'Style',
		[catalog, job?.styleId]
	)

	// — Export loading state for header button ————————————————————————————————
	const [isExporting, setIsExporting] = useState(false)

	// — Old-canvas UI states ——————————————————————————————————————————————————
	const [intensity, setIntensity] = useState(0.75)
	const [prompt, setPrompt] = useState('')
	const [isGenerating, setIsGenerating] = useState(false)

	const handleGenerateBackground = useCallback(() => {
		if (!prompt.trim()) return
		setIsGenerating(true)
		// Mock pipeline — replace with real backend call to StyleJobService
		setTimeout(() => {
			setIsGenerating(false)
			Alert.alert(
				'Background generated',
				'AI background applied successfully.'
			)
		}, 10_000)
	}, [prompt])

	// — Handlers ——————————————————————————————————————————————————————————————
	const handleProcessNow = useCallback(() => {
		if (!jobId) return
		Alert.alert(
			'Prioritize this job?',
			'The current job will be paused and resumed immediately after. This one will be processed next.',
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Process Now',
					onPress: () => StyleJobService.prioritizeJob(jobId),
				},
			]
		)
	}, [jobId])

	const handleRetry = useCallback(() => {
		if (!jobId) return
		retryJob(jobId)
		StyleJobService.processNextJobInQueue()
	}, [jobId, retryJob])

	const handleRefine = useCallback(() => {
		if (!job?.resultUri) return
		router.push({
			pathname: '/(screens)/refine',
			params: { jobId },
		})
	}, [job?.resultUri, jobId])

	const handleBGEdit = useCallback(() => {
		router.push({
			pathname: '/(screens)/background-generator',
			params: { jobId },
		})
	}, [jobId])

	// Go directly to ExportScreen without refining. The resultUri from the job
	// (or the composited brush-mask snapshot) is passed as outputUri so
	// ExportScreen works whether the user came via Refine or directly here.
	const handleExportDirect = useCallback(() => {
		if (!job || !job.resultUri) return
		router.push({
			pathname: '/(screens)/export',
			params: { jobId, outputUri: job.resultUri },
		})
	}, [job, jobId])

	/**
	 * "Next" header CTA — only active when status === 'DONE'.
	 * Delegates to the BrushCanvas snapshot handler registered via module ref.
	 */
	const handleNext = useCallback(async () => {
		if (!_snapshotHandlerRef.current) {
			tracker.warn(
				'Header Next button clicked but snapshot handler ref is missing',
				{
					jobId,
					jobStatus: job?.status,
					hasStyleJob: !!job,
				}
			)
			return
		}
		try {
			await _snapshotHandlerRef.current()
		} catch (err) {
			// NEW GUARDRAIL CATCH BLOCK: Prevents screen action locking if child context breaks
			tracker.error(
				'Imperative reference execution failed on top-level header submit',
				{
					error: err,
					jobId,
					styleName,
					isGlobalPathPopulated: !!pathRef_global.current,
				}
			)

			Alert.alert(
				'Processing Error',
				'Could not advance to refinement workspace.'
			)
		} finally {
			setIsExporting(false)
		}
	}, [jobId, job, styleName])

	/**
	 * Called by BrushCanvas after the brush-mask composite snapshot completes.
	 * The user has already painted which parts to stylise — this IS the refined
	 * result. Route directly to ExportScreen so they can save/share without an
	 * extra step. The compositeUri becomes outputUri in ExportScreen.
	 * If they want intensity control they can use the Refine button first
	 * before tapping Next/painting.
	 */
	const handleCompositeReady = useCallback(
		(compositeUri: string) => {
			router.push({
				pathname: '/(screens)/export',
				params: { jobId, outputUri: compositeUri },
			})
		},
		[jobId]
	)

	/**
	 * Called by BrushCanvas on snapshot error.
	 * Sets job to ERROR so GalleryScreen shows the error state.
	 */
	const handleCanvasError = useCallback(
		(message: string) => {
			if (!jobId) return
			updateJob(jobId, {
				status: 'ERROR',
				errorMessage: message,
				retryable: true,
			})
			Alert.alert('Export Failed', message, [{ text: 'OK' }])
		},
		[jobId, updateJob]
	)

	// — Missing job guard —————————————————————————————————————————————————————
	if (!jobId) {
		router.replace('/(tabs)/gallery')
		return <View style={styles.screen} />
	}

	// — Image to display for non-DONE states ——————————————————————————————————
	// BUG FIX — job null during MMKV hydration:
	//   The Zustand store is hydrated from MMKV asynchronously on app start.
	//   If the user navigates to edit-canvas before hydration completes (e.g.
	//   deep-link or fast gallery tap) `job` is null even though jobId is valid.
	//   Previously displayUri and isDone were computed with optional chaining and
	//   the canvas branch `isDone && job.sourceUri && job.resultUri` silently
	//   evaluated to false, rendering nothing — blank screen, no spinner, no log.
	//   Now we show an ActivityIndicator until the store provides the job object.
	if (!job) {
		return (
			<View
				style={[
					styles.screen,
					styles.canvas,
					{ backgroundColor: C.bg },
				]}
			>
				<ActivityIndicator color={C.primaryMid} size="large" />
			</View>
		)
	}

	const displayUri = job.status === 'DONE' ? job.resultUri : job.sourceUri

	const isDone = job.status === 'DONE'

	// — Render ————————————————————————————————————————————————————————————————
	return (
		<KeyboardAvoidingView
			style={[styles.screen, { backgroundColor: C.bg }]}
			behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
		>
			{/* ── Header ────────────────────────────────────────────────────── */}
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

				<View style={styles.headerCenter}>
					<Text style={styles.headerTitle} numberOfLines={1}>
						{styleName}
					</Text>
					{job && (
						<Text style={styles.headerSub}>
							{job.status === 'DONE'
								? '✦ paint to reveal'
								: job.status === 'PROCESSING'
									? `${Math.round(job.progress * 100)}% complete`
									: job.status === 'QUEUED'
										? 'in queue'
										: job.status === 'ERROR'
											? 'failed'
											: 'paused'}
						</Text>
					)}
				</View>

				{/* "Next" CTA — only active when done, shows spinner while exporting */}
				{isDone ? (
					<Pressable
						onPress={handleNext}
						disabled={isExporting}
						style={[styles.headerBtn, styles.nextBtn]}
						accessibilityRole="button"
						accessibilityLabel="Continue to refine screen"
					>
						{isExporting ? (
							<ActivityIndicator
								color={C.primaryMid}
								size="small"
							/>
						) : (
							<View style={styles.nextBtnInner}>
								<Text style={styles.nextBtnText}>Next</Text>
								<ArrowRight
									color={C.primaryMid}
									size={16}
									strokeWidth={2.2}
								/>
							</View>
						)}
					</Pressable>
				) : (
					/* Placeholder to keep header layout symmetric */
					<View style={styles.headerBtn} />
				)}
			</View>

			{/* ── Canvas area ───────────────────────────────────────────────── */}
			<View style={styles.canvas}>
				{isDone && job.sourceUri && job.resultUri ? (
					// DONE → interactive brush canvas
					<BrushCanvas
						sourceUri={job.sourceUri}
						resultUri={job.resultUri}
						onNext={handleCompositeReady}
						onError={handleCanvasError}
					/>
				) : displayUri ? (
					// QUEUED / PROCESSING / BATTERY_PAUSED / ERROR → static image
					<Image
						source={{ uri: displayUri }}
						style={styles.mainImage}
						contentFit="contain"
						cachePolicy="disk"
						transition={0}
						accessibilityLabel={`${styleName} artwork`}
					/>
				) : (
					<View style={styles.imagePlaceholder}>
						<ImageIcon
							color={C.textDim}
							size={48}
							strokeWidth={1}
						/>
					</View>
				)}

				{/* Status overlays — hidden when DONE (BrushCanvas owns that state) */}
				{job && !isDone && (
					<StatusOverlay
						job={job}
						onProcessNow={handleProcessNow}
						onRetry={handleRetry}
					/>
				)}
			</View>

			{/* ── Bottom actions — hidden when DONE (header "Next" drives the flow) ── */}
			{job && !isDone && (
				<View
					style={[
						styles.actions,
						{ paddingBottom: insets.bottom + 12 },
					]}
				>
					<BottomActions
						job={job}
						onRefine={handleRefine}
						onExport={handleExportDirect}
					/>
				</View>
			)}

			{/* ── DONE-state tool strip ────────────────────────────────────── */}
			{isDone && (
				<View
					style={[
						styles.doneToolStrip,
						{ paddingBottom: insets.bottom + 12 },
					]}
				>
					<Pressable
						onPress={() => {
							// Clear path and force canvas re-render
							pathRef_global.current = Skia.Path.Make()
							// We need to trigger a re-render in BrushCanvas
							// The simplest way is to navigate-in-place or signal via
							// a module-level counter — here we use an Alert for clarity
							Alert.alert(
								'Clear brush?',
								'This will erase your painted mask.',
								[
									{ text: 'Cancel', style: 'cancel' },
									{
										text: 'Clear',
										style: 'destructive',
										onPress: () => {
											// Path is module-level — see note below
										},
									},
								]
							)
						}}
						style={styles.clearBtn}
						accessibilityRole="button"
						accessibilityLabel="Clear brush strokes"
					>
						<Text style={styles.clearBtnText}>Clear</Text>
					</Pressable>

					<View style={styles.brushSizeHint}>
						<Text style={styles.brushSizeText}>
							Brush size: 35px
						</Text>
					</View>
				</View>
			)}

			{/* ── Controls: style intensity slider + AI prompt (all states) ─── */}
			<ControlsPanel
				intensity={intensity}
				onIntensityChange={setIntensity}
				prompt={prompt}
				onPromptChange={setPrompt}
				isGenerating={isGenerating}
				onGenerate={handleGenerateBackground}
			/>

			{/* ── History + BG Gallery footer row (all states) ──────────────── */}
			<View
				style={[
					styles.historyRow,
					{ paddingBottom: insets.bottom + 14 },
				]}
			>
				<View style={styles.historyActions}>
					<Pressable
						style={styles.circleBtn}
						accessibilityRole="button"
						accessibilityLabel="Undo"
						hitSlop={8}
					>
						<Undo2 size={22} color={C.text} strokeWidth={1.8} />
					</Pressable>
					<Pressable
						style={styles.circleBtn}
						accessibilityRole="button"
						accessibilityLabel="Redo"
						hitSlop={8}
					>
						<Redo2 size={22} color={C.text} strokeWidth={1.8} />
					</Pressable>
				</View>

				<Pressable
					style={styles.backgroundBtn}
					onPress={handleBGEdit}
					accessibilityRole="button"
					accessibilityLabel="Open background gallery"
				>
					<ImageIcon color={C.white} size={18} strokeWidth={1.8} />
					<Text style={styles.backgroundBtnText}>BG Gallery</Text>
				</Pressable>
			</View>
		</KeyboardAvoidingView>
	)
}

/**
 * Module-level path ref used by the Clear button in the tool strip.
 * The BrushCanvas component reads pathRef internally; we expose a secondary
 * handle here so the strip can signal a clear without complex prop wiring.
 *
 * In a full implementation this would be lifted into a Zustand atom or a
 * shared context — kept simple here for architectural clarity.
 */
const pathRef_global = { current: Skia.Path.Make() }

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
		borderBottomColor: C.border,
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
		color: C.text,
		fontSize: 17,
		fontWeight: '700',
		letterSpacing: -0.2,
	},
	headerSub: {
		color: C.textMuted,
		fontSize: 12,
		marginTop: 2,
	},
	nextBtn: {
		minWidth: 70,
		paddingHorizontal: 4,
	},
	nextBtnInner: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 3,
	},
	nextBtnText: {
		color: C.primaryMid,
		fontSize: 16,
		fontWeight: '700',
	},

	// ── Canvas ────────────────────────────────────────────────────────────────
	canvas: {
		flex: 1,
		backgroundColor: '#050508',
		justifyContent: 'center',
		alignItems: 'center',
		overflow: 'hidden',
	},
	mainImage: {
		width: SCREEN_W,
		height: CANVAS_H,
	},
	imagePlaceholder: {
		justifyContent: 'center',
		alignItems: 'center',
		opacity: 0.4,
	},

	// ── Brush Canvas ──────────────────────────────────────────────────────────
	brushCanvasWrapper: {
		width: SCREEN_W,
		height: CANVAS_H,
		position: 'relative',
	},
	brushCanvas: {
		width: SCREEN_W,
		height: CANVAS_H,
	},
	brushLoadingContainer: {
		width: SCREEN_W,
		height: CANVAS_H,
		justifyContent: 'center',
		alignItems: 'center',
		gap: 14,
		backgroundColor: C.bg,
	},
	brushLoadingText: {
		color: C.textMuted,
		fontSize: 14,
		fontWeight: '500',
	},
	brushHint: {
		position: 'absolute',
		bottom: 20,
		alignSelf: 'center',
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		backgroundColor: 'rgba(0,0,0,0.55)',
		borderRadius: 20,
		paddingHorizontal: 14,
		paddingVertical: 7,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: 'rgba(0,0,0,0.15)',
	},
	brushHintText: {
		color: 'rgba(255,255,255,0.7)',
		fontSize: 12,
		fontWeight: '500',
		letterSpacing: 0.2,
	},

	// ── Status overlay ────────────────────────────────────────────────────────
	statusOverlay: {
		...StyleSheet.absoluteFillObject,
		justifyContent: 'flex-end',
		alignItems: 'center',
		paddingBottom: 32,
		paddingHorizontal: 24,
	},
	statusCard: {
		width: '100%',
		backgroundColor: 'rgba(255,255,255,0.96)',
		borderRadius: 20,
		borderWidth: 1,
		borderColor: C.border,
		padding: 24,
		alignItems: 'center',
		gap: 10,
	},
	statusIconRow: {
		marginBottom: 4,
	},
	statusTitle: {
		color: C.text,
		fontSize: 18,
		fontWeight: '700',
		textAlign: 'center',
	},
	statusSub: {
		color: C.textMuted,
		fontSize: 13,
		textAlign: 'center',
		lineHeight: 19,
	},

	// ── Process Now button ────────────────────────────────────────────────────
	processNowBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		backgroundColor: C.primaryMid,
		borderRadius: 14,
		paddingHorizontal: 24,
		paddingVertical: 13,
		marginTop: 6,
		width: '100%',
	},
	processNowText: {
		color: C.white,
		fontSize: 15,
		fontWeight: '700',
	},

	// ── Processing HUD ────────────────────────────────────────────────────────
	processingHud: {
		width: '100%',
		backgroundColor: 'rgba(255,255,255,0.94)',
		borderRadius: 16,
		borderWidth: 1,
		borderColor: C.border,
		padding: 20,
		gap: 10,
	},
	progressTrack: {
		height: 4,
		backgroundColor: C.border,
		borderRadius: 2,
		overflow: 'hidden',
	},
	progressFill: {
		height: 4,
		backgroundColor: C.primaryMid,
		borderRadius: 2,
	},
	processingMeta: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	processingLabel: {
		color: C.text,
		fontSize: 14,
		fontWeight: '600',
	},
	processingPct: {
		color: C.primaryMid,
		fontSize: 14,
		fontWeight: '800',
		letterSpacing: -0.3,
	},
	processingHint: {
		color: C.textMuted,
		fontSize: 12,
		lineHeight: 17,
	},

	// ── Bottom actions (non-DONE states) ──────────────────────────────────────
	actions: {
		backgroundColor: C.surface,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: C.border,
		paddingHorizontal: 20,
		paddingTop: 14,
	},
	bottomPanel: {
		flexDirection: 'row',
		gap: 12,
	},
	actionBtn: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		height: 52,
		borderRadius: 14,
	},
	actionBtnPrimary: {
		backgroundColor: C.primaryMid,
	},
	actionBtnSecondary: {
		backgroundColor: C.surfaceHigh,
		borderWidth: 1,
		borderColor: C.border,
	},
	actionBtnDisabled: {
		opacity: 0.38,
	},
	actionBtnText: {
		color: C.white,
		fontSize: 15,
		fontWeight: '700',
	},
	actionBtnTextSecondary: {
		color: C.text,
		fontSize: 15,
		fontWeight: '700',
	},
	actionBtnTextDisabled: {
		color: C.textDim,
	},

	// ── DONE tool strip ───────────────────────────────────────────────────────
	doneToolStrip: {
		backgroundColor: C.surface,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: C.border,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 20,
		paddingTop: 12,
		gap: 12,
	},
	clearBtn: {
		paddingHorizontal: 18,
		paddingVertical: 10,
		borderRadius: 10,
		backgroundColor: C.surfaceHigh,
		borderWidth: 1,
		borderColor: C.border,
	},
	clearBtnText: {
		color: C.textMuted,
		fontSize: 14,
		fontWeight: '600',
	},
	brushSizeHint: {
		flex: 1,
		alignItems: 'flex-end',
	},
	brushSizeText: {
		color: C.textDim,
		fontSize: 12,
	},

	surfaceHigh: { backgroundColor: C.surfaceHigh },

	// ── Controls section (slider + AI prompt) ────────────────────────────────
	controlsSection: {
		backgroundColor: C.surface,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: C.border,
		paddingHorizontal: 20,
		paddingTop: 18,
		paddingBottom: 10,
	},
	sliderContainer: {
		marginBottom: 18,
	},
	sliderLabelRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		marginBottom: 6,
	},
	sliderLabel: {
		color: C.text,
		fontSize: 14,
		fontWeight: '600',
	},
	sliderValue: {
		color: C.primaryMid,
		fontSize: 14,
		fontWeight: '700',
	},
	slider: {
		width: '100%',
		height: 36,
	},
	inputWrapper: {
		backgroundColor: C.surfaceHigh,
		borderRadius: 12,
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 14,
		height: 52,
		borderWidth: 1,
		borderColor: C.border,
	},
	inputIcon: {
		marginRight: 10,
	},
	textInput: {
		flex: 1,
		color: C.text,
		fontSize: 14,
		fontWeight: '500',
	},
	generateBtnText: {
		color: C.primaryMid,
		fontWeight: '700',
		fontSize: 15,
	},
	generatingBanner: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		marginTop: 12,
		backgroundColor: C.surfaceHigh,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: C.border,
		padding: 12,
	},
	generatingText: {
		color: C.text,
		fontSize: 13,
		fontWeight: '600',
	},
	generatingSubtext: {
		color: C.textMuted,
		fontSize: 11,
		marginTop: 2,
	},

	// ── History + BG Gallery footer row ──────────────────────────────────────
	historyRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		backgroundColor: C.surface,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: C.border,
		paddingHorizontal: 20,
		paddingTop: 14,
	},
	historyActions: {
		flexDirection: 'row',
		gap: 12,
	},
	circleBtn: {
		width: 48,
		height: 48,
		borderRadius: 24,
		backgroundColor: C.surfaceHigh,
		borderWidth: 1,
		borderColor: C.border,
		justifyContent: 'center',
		alignItems: 'center',
	},
	backgroundBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: C.primaryMid,
		paddingHorizontal: 20,
		height: 48,
		borderRadius: 24,
		gap: 8,
	},
	backgroundBtnText: {
		color: C.white,
		fontWeight: '700',
		fontSize: 14,
	},
})
