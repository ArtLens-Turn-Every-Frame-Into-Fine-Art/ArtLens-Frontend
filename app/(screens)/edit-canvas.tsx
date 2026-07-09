/**
 * ArtLens — EditCanvasScreen
 *
 * Entry points:
 *   1. CameraScreen after capture — jobId param identifies the enqueued job
 *   2. GalleryScreen — tap any job card
 *
 * Status-gated UI layout:
 *   QUEUED         → source image + "In queue" overlay + "Process Now" CTA
 *   PROCESSING     → source image + animated progress bar + percentage
 *   DONE           → side-by-side ImageCompareSlider + "Next" header CTA
 *   ERROR          → source image + error card + conditional Retry button
 *   BATTERY_PAUSED → source image + paused notice
 *
 * Loading guard: if the Zustand store has not yet hydrated from MMKV (fast
 * navigation before app startup settles), `job` is null — render a spinner
 * rather than a blank screen.
 *
 * PRD § 3.4 — Directory: app/(screens)/edit-canvas.tsx
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
	AlertCircle,
	ArrowRight,
	Battery,
	Brush,
	Cpu,
	Image as ImageIcon,
	RefreshCw,
	Redo2,
	Undo2,
	Wand2,
	Zap,
} from 'lucide-react-native'

import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useModelStore } from '@/shared/stores/useModelStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'
import { Colors, ImageCompareSlider } from '@/shared/ui'

import type { StyleJob } from '@/types'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('EditCanvasScreen')

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')
/** Canvas occupies 65% of screen height to leave room for controls below. */
const CANVAS_H = SCREEN_H * 0.65

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Animated progress fill bar — smoothly interpolates between progress values
 * using Reanimated withTiming so rapid tick updates don't cause jank.
 */
const ProgressBar = React.memo<{ progress: number }>(({ progress }) => {
	const width = useSharedValue(0)

	useEffect(() => {
		width.value = withTiming(Math.max(0, Math.min(1, progress)), {
			duration: 350,
			easing: Easing.out(Easing.quad),
		})
	}, [progress, width])

	const animStyle = useAnimatedStyle(() => ({
		width: `${width.value * 100}%`,
	}))

	return (
		<View style={styles.progressTrack}>
			<Animated.View style={[styles.progressFill, animStyle]} />
		</View>
	)
})
ProgressBar.displayName = 'ProgressBar'

/**
 * Full-canvas status overlay — rendered for every non-DONE job state.
 * Returns null for DONE so the ImageCompareSlider shows unobstructed.
 */
interface StatusOverlayProps {
	job: StyleJob
	onProcessNow: () => void
	onRetry: () => void
}

const StatusOverlay = React.memo(
	({ job, onProcessNow, onRetry }: StatusOverlayProps) => {
		if (job.status === 'DONE') return null

		return (
			<View
				style={styles.statusOverlay}
				pointerEvents={
					job.status === 'PROCESSING' ? 'none' : 'box-none'
				}
			>
				{job.status === 'QUEUED' && (
					<View style={styles.statusCard}>
						<Cpu
							color={Colors.primary}
							size={28}
							strokeWidth={1.4}
						/>
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
								color={Colors.white}
								size={18}
								strokeWidth={2}
								fill={Colors.white}
							/>
							<Text style={styles.processNowText}>
								Process Now
							</Text>
						</Pressable>
					</View>
				)}

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

				{job.status === 'ERROR' && (
					<View style={styles.statusCard}>
						<AlertCircle
							color={Colors.error}
							size={32}
							strokeWidth={1.4}
						/>
						<Text style={styles.statusTitle}>
							Stylization failed
						</Text>
						<Text style={styles.statusSub}>
							An unknown error occurred.
						</Text>
						{job.retryable && (
							<Pressable
								onPress={onRetry}
								style={[
									styles.processNowBtn,
									{ backgroundColor: Colors.error },
								]}
								accessibilityRole="button"
								accessibilityLabel="Retry stylization"
							>
								<RefreshCw
									color={Colors.white}
									size={16}
									strokeWidth={2}
								/>
								<Text style={styles.processNowText}>Retry</Text>
							</Pressable>
						)}
					</View>
				)}

				{job.status === 'BATTERY_PAUSED' && (
					<View style={styles.statusCard}>
						<Battery
							color={Colors.warning}
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

/**
 * Bottom action bar shown for non-DONE states.
 * Provides Refine (intensity) and Export (direct) paths. Both buttons are
 * disabled until the job reaches DONE status.
 */
interface ActionsProps {
	job: StyleJob
	onRefine: () => void
	onExport: () => void
}

const BottomActions = React.memo(
	({ job, onRefine, onExport }: ActionsProps) => {
		const isDone = job.status === 'DONE'

		return (
			<View style={styles.bottomPanel}>
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
						color={isDone ? Colors.text : Colors.textDim}
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
						color={isDone ? Colors.white : Colors.textDim}
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

/**
 * Style intensity slider and AI background prompt panel.
 * The AI Generate button triggers `onGenerate` which is handled by the screen.
 */
interface ControlsPanelProps {
	intensity: number
	onIntensityChange: (v: number) => void
	prompt: string
	onPromptChange: (v: string) => void
	isGenerating: boolean
	onGenerate: () => void
}

const ControlsPanel = React.memo(
	({
		intensity,
		onIntensityChange,
		prompt,
		onPromptChange,
		isGenerating,
		onGenerate,
	}: ControlsPanelProps) => (
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
					minimumTrackTintColor={Colors.primary}
					maximumTrackTintColor={Colors.border}
					thumbTintColor={Colors.primary}
				/>
			</View>

			{/* AI background prompt */}
			<View style={styles.inputWrapper}>
				<Wand2
					size={20}
					color={Colors.primary}
					style={styles.inputIcon}
				/>
				<TextInput
					style={styles.textInput}
					value={prompt}
					onChangeText={onPromptChange}
					placeholder="e.g. A cyberpunk city at night..."
					placeholderTextColor={Colors.textMuted}
					onSubmitEditing={onGenerate}
					returnKeyType="go"
				/>
				{isGenerating ? (
					<ActivityIndicator size="small" color={Colors.primary} />
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

			{isGenerating && (
				<View style={styles.generatingBanner}>
					<ActivityIndicator size="small" color={Colors.primary} />
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
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function EditCanvasScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()
	const { jobId } = useLocalSearchParams<{ jobId: string }>()

	const job = useStyleJobStore(
		(s) => s.jobs.find((j) => j.id === jobId) ?? null
	)
	const retryJob = useStyleJobStore((s) => s.retryJob)
	const catalog = useModelStore((s) => s.catalog)

	const styleName = useMemo(
		() => catalog.find((m) => m.id === job?.styleId)?.name ?? 'Style',
		[catalog, job?.styleId]
	)

	const [isExporting, setIsExporting] = useState(false)
	const [intensity, setIntensity] = useState(0.75)
	const [prompt, setPrompt] = useState('')
	const [isGenerating, setIsGenerating] = useState(false)

	/**
	 * AI background generation placeholder.
	 * TODO: replace setTimeout stub with a real StyleJobService call when
	 * the background-generation pipeline is implemented.
	 */
	const handleGenerateBackground = useCallback(() => {
		if (!prompt.trim()) return
		setIsGenerating(true)
		setTimeout(() => {
			setIsGenerating(false)
			Alert.alert(
				'Background generated',
				'AI background applied successfully.'
			)
		}, 10_000)
	}, [prompt])

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
		void StyleJobService.processNextJobInQueue()
	}, [jobId, retryJob])

	const handleRefine = useCallback(() => {
		if (!job?.resultUri) return
		router.push({ pathname: '/(screens)/refine', params: { jobId } })
	}, [job?.resultUri, jobId])

	const handleBGEdit = useCallback(() => {
		router.push({
			pathname: '/(screens)/background-generator',
			params: { jobId },
		})
	}, [jobId])

	/** Direct export — passes the finished result URI straight to ExportScreen. */
	const handleExportDirect = useCallback(() => {
		if (!job?.resultUri) return
		router.push({
			pathname: '/(screens)/export',
			params: { jobId, outputUri: job.resultUri },
		})
	}, [job, jobId])

	/**
	 * "Next" header CTA — active only when the job is DONE.
	 * Routes directly to ExportScreen using the completed result URI.
	 */
	const handleNext = useCallback(() => {
		if (!job?.resultUri) return
		setIsExporting(true)
		try {
			router.push({
				pathname: '/(screens)/export',
				params: { jobId, outputUri: job.resultUri },
			})
		} catch (err) {
			tracker.error('Navigation to export screen failed', {
				error: err,
				jobId,
				jobStatus: job.status,
			})
		} finally {
			setIsExporting(false)
		}
	}, [job, jobId])

	// ── Guards ────────────────────────────────────────────────────────────────

	// Missing jobId — redirect immediately rather than rendering a broken screen
	if (!jobId) {
		router.replace('/(tabs)/gallery')
		return <View style={styles.screen} />
	}

	// Store not yet hydrated from MMKV (fast navigation on startup)
	if (!job) {
		return (
			<View
				style={[
					styles.screen,
					styles.canvas,
					{ backgroundColor: Colors.bg },
				]}
			>
				<ActivityIndicator color={Colors.primary} size="large" />
			</View>
		)
	}

	const displayUri = job.status === 'DONE' ? job.resultUri : job.sourceUri
	const isDone = job.status === 'DONE'

	// ── Derived header sub-label ──────────────────────────────────────────────
	const headerSubLabel =
		job.status === 'DONE'
			? '✦ PROCESSED'
			: job.status === 'PROCESSING'
				? `${Math.round(job.progress * 100)}% complete`
				: job.status === 'QUEUED'
					? 'in queue'
					: job.status === 'ERROR'
						? 'failed'
						: 'paused'

	return (
		<KeyboardAvoidingView
			style={[styles.screen, { backgroundColor: Colors.bg }]}
			behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
		>
			{/* Header */}
			<View style={[styles.header, { paddingTop: insets.top + 4 }]}>
				<View
					style={styles.headerAbsoluteTitleContainer}
					pointerEvents="none"
				>
					<Text style={styles.headerTitle} numberOfLines={1}>
						{styleName}
					</Text>
					<Text style={styles.headerSub}>{headerSubLabel}</Text>
				</View>

				{/* Left spacer — keeps the title visually centered */}
				<View style={styles.headerBtn} />

				{isDone ? (
					<Pressable
						onPress={handleNext}
						disabled={isExporting}
						style={[styles.headerBtn, styles.nextBtn]}
						accessibilityRole="button"
						accessibilityLabel="Continue to export"
					>
						{isExporting ? (
							<ActivityIndicator
								color={Colors.primary}
								size="small"
							/>
						) : (
							<View style={styles.nextBtnInner}>
								<Text style={styles.nextBtnText}>Next</Text>
								<ArrowRight
									color={Colors.primary}
									size={16}
									strokeWidth={2.2}
								/>
							</View>
						)}
					</Pressable>
				) : (
					<View style={styles.headerBtn} />
				)}
			</View>

			{/* Canvas */}
			<View style={styles.canvas}>
				{isDone && job.sourceUri && job.resultUri ? (
					<ImageCompareSlider
						beforeUri={job.sourceUri}
						afterUri={job.resultUri}
						width={SCREEN_W}
						height={CANVAS_H}
					/>
				) : displayUri ? (
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
							color={Colors.textDim}
							size={48}
							strokeWidth={1}
						/>
					</View>
				)}

				{!isDone && (
					<StatusOverlay
						job={job}
						onProcessNow={handleProcessNow}
						onRetry={handleRetry}
					/>
				)}
			</View>

			{/* Bottom actions — hidden in DONE state (header "Next" drives the flow) */}
			{!isDone && (
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

			{/* Controls: intensity slider + AI background prompt */}
			<ControlsPanel
				intensity={intensity}
				onIntensityChange={setIntensity}
				prompt={prompt}
				onPromptChange={setPrompt}
				isGenerating={isGenerating}
				onGenerate={handleGenerateBackground}
			/>

			{/* Footer row: Undo/Redo + BG Gallery */}
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
						<Undo2
							size={22}
							color={Colors.text}
							strokeWidth={1.8}
						/>
					</Pressable>
					<Pressable
						style={styles.circleBtn}
						accessibilityRole="button"
						accessibilityLabel="Redo"
						hitSlop={8}
					>
						<Redo2
							size={22}
							color={Colors.text}
							strokeWidth={1.8}
						/>
					</Pressable>
				</View>

				<Pressable
					style={styles.backgroundBtn}
					onPress={handleBGEdit}
					accessibilityRole="button"
					accessibilityLabel="Open background gallery"
				>
					<ImageIcon
						color={Colors.white}
						size={18}
						strokeWidth={1.8}
					/>
					<Text style={styles.backgroundBtnText}>BG Gallery</Text>
				</Pressable>
			</View>
		</KeyboardAvoidingView>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: { flex: 1 },

	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 12,
		paddingBottom: 10,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: Colors.border,
		position: 'relative',
	},
	headerAbsoluteTitleContainer: {
		position: 'absolute',
		top: 33,
		left: 0,
		right: 0,
		bottom: 10,
		justifyContent: 'center',
		alignItems: 'center',
		zIndex: 0,
	},
	headerBtn: {
		width: 40,
		height: 40,
		borderRadius: 20,
		justifyContent: 'center',
		alignItems: 'center',
		zIndex: 1,
	},
	headerTitle: {
		color: Colors.text,
		fontSize: 17,
		fontWeight: '700',
		letterSpacing: -0.2,
		textAlign: 'center',
	},
	headerSub: {
		color: Colors.textMuted,
		fontSize: 12,
		marginTop: 2,
		textAlign: 'center',
	},
	nextBtn: { minWidth: 70, paddingHorizontal: 4 },
	nextBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 3 },
	nextBtnText: { color: Colors.primary, fontSize: 16, fontWeight: '700' },

	canvas: {
		flex: 1,
		backgroundColor: '#050508',
		justifyContent: 'center',
		alignItems: 'center',
		overflow: 'hidden',
	},
	mainImage: { width: SCREEN_W, height: CANVAS_H },
	imagePlaceholder: {
		justifyContent: 'center',
		alignItems: 'center',
		opacity: 0.4,
	},

	// Status overlay
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
		borderColor: Colors.border,
		padding: 24,
		alignItems: 'center',
		gap: 10,
	},
	statusTitle: {
		color: Colors.text,
		fontSize: 18,
		fontWeight: '700',
		textAlign: 'center',
	},
	statusSub: {
		color: Colors.textMuted,
		fontSize: 13,
		textAlign: 'center',
		lineHeight: 19,
	},
	processNowBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		backgroundColor: Colors.primary,
		borderRadius: 14,
		paddingHorizontal: 24,
		paddingVertical: 13,
		marginTop: 6,
		width: '100%',
	},
	processNowText: { color: Colors.white, fontSize: 15, fontWeight: '700' },

	// Processing HUD
	processingHud: {
		width: '100%',
		backgroundColor: 'rgba(255,255,255,0.94)',
		borderRadius: 16,
		borderWidth: 1,
		borderColor: Colors.border,
		padding: 20,
		gap: 10,
	},
	progressTrack: {
		height: 4,
		backgroundColor: Colors.border,
		borderRadius: 2,
		overflow: 'hidden',
	},
	progressFill: {
		height: 4,
		backgroundColor: Colors.primary,
		borderRadius: 2,
	},
	processingMeta: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	processingLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' },
	processingPct: {
		color: Colors.primary,
		fontSize: 14,
		fontWeight: '800',
		letterSpacing: -0.3,
	},
	processingHint: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },

	// Bottom action buttons
	actions: {
		backgroundColor: Colors.surface,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: Colors.border,
		paddingHorizontal: 20,
		paddingTop: 14,
	},
	bottomPanel: { flexDirection: 'row', gap: 12 },
	actionBtn: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		height: 52,
		borderRadius: 14,
	},
	actionBtnPrimary: { backgroundColor: Colors.primary },
	actionBtnSecondary: {
		backgroundColor: Colors.surfaceHigh,
		borderWidth: 1,
		borderColor: Colors.border,
	},
	actionBtnDisabled: { opacity: 0.38 },
	actionBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
	actionBtnTextSecondary: {
		color: Colors.text,
		fontSize: 15,
		fontWeight: '700',
	},
	actionBtnTextDisabled: { color: Colors.textDim },

	// Controls section
	controlsSection: {
		backgroundColor: Colors.surface,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: Colors.border,
		paddingHorizontal: 20,
		paddingTop: 18,
		paddingBottom: 10,
	},
	sliderContainer: { marginBottom: 18 },
	sliderLabelRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		marginBottom: 6,
	},
	sliderLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' },
	sliderValue: { color: Colors.primary, fontSize: 14, fontWeight: '700' },
	slider: { width: '100%', height: 36 },
	inputWrapper: {
		backgroundColor: Colors.surfaceHigh,
		borderRadius: 12,
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 14,
		height: 52,
		borderWidth: 1,
		borderColor: Colors.border,
	},
	inputIcon: { marginRight: 10 },
	textInput: { flex: 1, color: Colors.text, fontSize: 14, fontWeight: '500' },
	generateBtnText: { color: Colors.primary, fontWeight: '700', fontSize: 15 },
	generatingBanner: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		marginTop: 12,
		backgroundColor: Colors.surfaceHigh,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: Colors.border,
		padding: 12,
	},
	generatingText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
	generatingSubtext: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },

	// Footer row
	historyRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		backgroundColor: Colors.surface,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: Colors.border,
		paddingHorizontal: 20,
		paddingTop: 14,
	},
	historyActions: { flexDirection: 'row', gap: 12 },
	circleBtn: {
		width: 48,
		height: 48,
		borderRadius: 24,
		backgroundColor: Colors.surfaceHigh,
		borderWidth: 1,
		borderColor: Colors.border,
		justifyContent: 'center',
		alignItems: 'center',
	},
	backgroundBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: Colors.primary,
		paddingHorizontal: 20,
		height: 48,
		borderRadius: 24,
		gap: 8,
	},
	backgroundBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
})
