/**
 * ArtLens — CameraScreen
 *
 * Full-screen artistic viewfinder using the Student (Preview) model.
 *
 * ─── VisionCamera v5 API Contracts ───────────────────────────────────────────
 *
 * IMPORT CHANGES (v4 → v5):
 * - `CameraRef`        REMOVED  — v5 ref type is `Camera` (the component class)
 * - `usePhotoOutput`   REMOVED  — v5 photo output is a separate `CameraPhotoOutput`
 * object created via `VisionCamera.createPhotoOutput()`
 * or the hook `usePhotoOutput()` from the same package.
 * Photo capture is done via `photoOutput.capturePhotoToFile()`
 * NOT on the Camera ref.
 * - `useFrameOutput`   CORRECT  — still exported from `react-native-vision-camera` in v5,
 * used to create a `CameraFrameOutput` for streaming frames.
 * - `Frame`            CORRECT  — still exported from `react-native-vision-camera` in v5.
 * - `PhotoFile`        REMOVED  — v5 uses `Photo` (in-memory) or `PhotoFile` (file path).
 * `capturePhotoToFile()` returns `{ filePath: string }`.
 *
 * CAPTURE CHANGES (v4 → v5):
 * - OLD: `cameraRef.current.takePhoto({ flash: ... })`
 * - NEW: `photoOutput.capturePhotoToFile({ flashMode: ... }, {})`
 * Returns `Promise<{ filePath: string }>` — `filePath` is a bare filesystem path,
 * NOT a `file://` URI. Prepend `file://` manually.
 *
 * CAMERA COMPONENT CHANGES (v4 → v5):
 * - `photo={true}` prop    REMOVED — photo output is attached via `outputs={[photoOutput]}`
 * - `frameProcessor` prop  REMOVED — frame output is attached via `outputs={[frameOutput]}`
 * - Both outputs passed together: `outputs={[photoOutput, frameOutput]}`
 * - `ref` type: `useRef<CameraRef>` → `useRef<Camera>` (Camera is the component)
 * - `enableNativeZoomGesture` → renamed `enableNativeZoomGesture` (still present)
 *
 * FRAME PROCESSOR CHANGES (v4 → v5):
 * - `useFrameProcessor()` hook MOVED to `react-native-vision-camera-worklets` in some
 * builds, but in THIS project the Nitro worklet runtime is set up via the worklets
 * package automatically. `useFrameOutput({ onFrame })` from the base package is used.
 * - `onFrame` callback MUST be a worklet (annotated with `'worklet'`).
 * - `frame.dispose()` is MANDATORY after processing.
 *
 * REACT NATIVE 0.83 NOTES:
 * - `pointerEvents` as a direct View prop is deprecated. Use `style={{ pointerEvents: 'none' }}`.
 *
 * @module app/(tabs)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Animated,
	FlatList,
	Linking,
	Pressable,
	StyleSheet,
	Text,
	View,
	//Dimensions,
	type ListRenderItem,
} from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import {
	Canvas,
	Image,
	Skia,
	AlphaType,
	ColorType,
	type SkImage,
} from '@shopify/react-native-skia'
import { Image as ExpoImage } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { useStyleFrameProcessor } from '@/core/camera/useFrameProcessor'
import { createTracker } from '@/shared/utils/logger'

// ── VisionCamera v5 ───────────────────────────────────────────────────────────
//
// v5 public API surface used in this file:
//   • Camera           — the JSX component (also the ref type in v5)
//   • useCameraDevice  — unchanged from v4
//   • useCameraPermission — unchanged from v4
//   • usePhotoOutput   — creates a CameraPhotoOutput; capture via .capturePhotoToFile()
//   • useFrameOutput   — creates a CameraFrameOutput; onFrame worklet receives Frame
//   • Frame            — the HostObject passed to the onFrame worklet
//
// REMOVED vs v4:
//   • CameraRef        — no longer a separate exported type; ref type is `Camera`
//   • PhotoFile        — capturePhotoToFile() returns { filePath: string } directly
//   • useFrameProcessor — moved/renamed; use useFrameOutput with onFrame worklet instead
//
import {
	Camera,
	useCameraDevice,
	useCameraPermission,
	usePhotoOutput,
	CameraRef,
} from 'react-native-vision-camera'

import {
	AlertTriangle,
	Battery,
	CameraOff,
	Check,
	ChevronLeft,
	FlipHorizontal,
	Images,
	Zap,
	ZapOff,
} from 'lucide-react-native'

// ── Stores ────────────────────────────────────────────────────────────────────
import { useModelStore } from '@/shared/stores/useModelStore'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useBatteryStore } from '@/shared/stores/useBatteryStore'

// ── Types ─────────────────────────────────────────────────────────────────────
import type { StyleModel } from '@/types'

//const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')
const INFERENCE_SIZE = 256
const ROW_BYTES = INFERENCE_SIZE * 4

// Initialize namespaced module logger at module scope
const tracker = createTracker('CameraScreen')

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const C = {
	bg: '#080810',
	overlay: 'rgba(8,8,16,0.72)',
	surface: '#10101C',
	surfaceHigh: '#181828',
	border: '#1E1E30',
	primary: '#6D28D9',
	primaryMid: '#7C3AED',
	accent: '#C026D3',
	text: '#F4F4FF',
	textMuted: '#7070A0',
	warning: '#D97706',
	error: '#DC2626',
	white: '#FFFFFF',
	black: '#000000',
} as const

const STYLE_CARD_W = 72
const STYLE_CARD_H = 96
const SHUTTER_SIZE = 74
const CONTROL_SIZE = 44

// ─────────────────────────────────────────────────────────────────────────────
// STYLE CAROUSEL CHIP
// ─────────────────────────────────────────────────────────────────────────────

interface StyleChipProps {
	item: StyleModel
	isSelected: boolean
	onPress: (id: string) => void
}

const StyleChip = React.memo<StyleChipProps>(
	({ item, isSelected, onPress }) => {
		const handlePress = useCallback(
			() => onPress(item.id),
			[item.id, onPress]
		)

		return (
			<Pressable
				onPress={handlePress}
				style={[
					styles.styleChip,
					isSelected && styles.styleChipSelected,
				]}
				accessibilityRole="button"
				accessibilityLabel={`Select ${item.name} style`}
				accessibilityState={{ selected: isSelected }}
			>
				<ExpoImage
					source={{ uri: item.thumbnailUrl }}
					style={styles.styleChipImage}
					contentFit="cover"
					cachePolicy="disk"
					transition={200}
				/>
				{isSelected && (
					<View style={styles.styleChipCheckmark}>
						<Check color={C.white} size={10} strokeWidth={3} />
					</View>
				)}
				<Text
					style={[
						styles.styleChipLabel,
						isSelected && styles.styleChipLabelSelected,
					]}
					numberOfLines={1}
				>
					{item.name}
				</Text>
			</Pressable>
		)
	}
)
StyleChip.displayName = 'StyleChip'

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const PermissionScreen = React.memo<{ onRequest: () => void }>(
	({ onRequest }) => (
		<View style={styles.centeredState}>
			<CameraOff color={C.textMuted} size={56} strokeWidth={1.2} />
			<Text style={styles.stateTitle}>Camera access needed</Text>
			<Text style={styles.stateSub}>
				ArtLens needs camera permission to apply live art styles.
			</Text>
			<Pressable
				onPress={onRequest}
				style={styles.primaryButton}
				accessibilityRole="button"
			>
				<Text style={styles.primaryButtonText}>Grant Permission</Text>
			</Pressable>
			<Pressable
				onPress={() => Linking.openSettings()}
				style={styles.ghostButton}
				accessibilityRole="button"
			>
				<Text style={styles.ghostButtonText}>Open Settings</Text>
			</Pressable>
		</View>
	)
)
PermissionScreen.displayName = 'PermissionScreen'

// ─────────────────────────────────────────────────────────────────────────────
// BATTERY PAUSED SCREEN
// ─────────────────────────────────────────────────────────────────────────────

const BatteryPausedScreen = React.memo(() => (
	<View style={styles.centeredState}>
		<Battery color={C.warning} size={56} strokeWidth={1.2} />
		<Text style={styles.stateTitle}>Camera paused</Text>
		<Text style={styles.stateSub}>
			Heavy processing paused — connect to charger to resume.
		</Text>
	</View>
))
BatteryPausedScreen.displayName = 'BatteryPausedScreen'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function CameraScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// ── Permissions ─────────────────────────────────────────────────────────────
	const { hasPermission, requestPermission } = useCameraPermission()

	// ── Camera device ────────────────────────────────────────────────────────────
	const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>(
		'back'
	)
	const device = useCameraDevice(cameraPosition)

	// ── Flash ────────────────────────────────────────────────────────────────────
	const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off')

	// ── Active gate: only activate camera when screen is focused ─────────────────
	// VisionCamera v5 respects `isActive={false}` by fully pausing the sensor,
	// which releases GPU/CPU resources as required by the PRD.
	const [isCameraActive, setIsCameraActive] = useState(false)

	// ── Capture in-flight guard ───────────────────────────────────────────────────
	const [isCapturing, setIsCapturing] = useState(false)

	// ── Shutter animation ─────────────────────────────────────────────────────────
	const shutterAnim = useRef(new Animated.Value(1)).current
	const captureScale = useRef(new Animated.Value(1)).current

	// ── Camera ref ───────────────────────────────────────────────────────────────
	//
	// FIX (v4 → v5): In v5 `CameraRef` is no longer a separately exported type.
	// The ref type is `Camera` — the component class itself.
	//
	// Before (v4): const cameraRef = useRef<CameraRef>(null)
	// After  (v5): const cameraRef = useRef<Camera>(null)
	//
	// Note: in v5 the Camera ref is only needed for things like `focus()`.
	// Photo capture is handled through `photoOutput.capturePhotoToFile()` directly,
	// NOT through `cameraRef.current.capturePhoto()`.
	//
	const cameraRef = useRef<CameraRef>(null)

	// ── Stores ───────────────────────────────────────────────────────────────────
	const catalog = useModelStore((s) => s.catalog)
	const selectedStyleId = useModelStore((s) => s.selectedStyleId)
	const setSelectedStyle = useModelStore((s) => s.setSelectedStyle)
	const enqueueJob = useStyleJobStore((s) => s.enqueue)
	const pendingCount = useStyleJobStore(
		(s) =>
			s.jobs.filter(
				(j) => j.status === 'QUEUED' || j.status === 'PROCESSING'
			).length
	)

	const batteryLevel = useBatteryStore((s) => s.batteryLevel)
	const isPowerSaverActive = useBatteryStore((s) => s.isPowerSaverActive)

	// PRD §3.2: camera disabled when battery ≤ 5% OR power-saver active.
	const isBatteryCritical = batteryLevel <= 5 || isPowerSaverActive

	// ── Available styles (downloaded only) ───────────────────────────────────────
	const availableStyles = useMemo<StyleModel[]>(
		() =>
			catalog.filter(
				(m) => m.isActive && m.downloadStatus === 'downloaded'
			),
		[catalog]
	)

	// Allocate shared native memory block for 256x256 RGBA frame configurations
	const skiaPixelBuffer = useSharedValue<Uint8Array | null>(
		new Uint8Array(INFERENCE_SIZE * INFERENCE_SIZE * 4)
	)

	// ── v5 Photo output ───────────────────────────────────────────────────────────
	//
	// FIX (v4 → v5): `usePhotoOutput` is exported from `react-native-vision-camera`
	// and returns a `CameraPhotoOutput` object. It must be passed to the Camera's
	// `outputs` prop. Capture is then performed via `photoOutput.capturePhotoToFile()`.
	//
	// This replaces:
	//   OLD (v4): ref.current.takePhoto({ flash: ... }) → PhotoFile
	//   NEW (v5): photoOutput.capturePhotoToFile({ flashMode: ... }, {}) → { filePath }
	//
	const photoOutput = usePhotoOutput()

	// ── v5 Frame output ───────────────────────────────────────────────────────────
	//
	// PRD §3.2 Live Inference Loop:
	//   1. Frame captured via useFrameOutput worklet (Nitro zero-copy).
	//   2. Hardware-accelerated downsample to 256×256 RGB via resizer at C++ level.
	//   3. previewModel.runSync(pixelBuffer) → Float32Array (CPU, XNNPACK delegate).
	//   4. tensorUtils.toRGBA() writes into sharedRgbaBuffer (no allocation).
	//   5. react-native-vision-camera-skia feeds buffer to Skia surface.
	//
	// This scaffold implements steps 1 and 5 (frame acquisition and disposal).
	// Steps 2-4 are wired in by InferenceEngine / useFrameProcessor integration
	// (see src/core/camera/useFrameProcessor.ts).
	//
	// FIX: `onFrame` MUST be a worklet (`'worklet'` directive). Frame MUST be
	// disposed in the `finally` block to prevent pipeline stalls (camera stutter).
	const frameOutput = useStyleFrameProcessor(
		selectedStyleId as string,
		skiaPixelBuffer
	)

	// Derive real-time Skia drawable images from the shared pixel state block
	const skiaDrawableImage = useMemo<SkImage | null>(() => {
		// 1. Guard against empty buffers during hot-swaps or cold boot cycles
		const currentBuffer = skiaPixelBuffer.value
		if (!currentBuffer || currentBuffer.length === 0) return null

		// 2. Build explicit image layout metadata structures matching our network size bounds
		const imageInfo = {
			width: INFERENCE_SIZE,
			height: INFERENCE_SIZE,
			colorType: ColorType.RGBA_8888,
			alphaType: AlphaType.Opaque,
		}

		try {
			// 3. Directly wrap the existing TypedArray context without instantiating an empty backing buffer
			const rawUint8View = new Uint8Array(
				currentBuffer.buffer,
				currentBuffer.byteOffset,
				currentBuffer.byteLength
			)

			const dataWrapper = Skia.Data.fromBytes(rawUint8View)

			// 4. Instantiate a clean SkImage graphic primitive matrix
			return (
				Skia.Image.MakeImage(imageInfo, dataWrapper, ROW_BYTES) || null
			)
		} catch (err) {
			tracker.error('Skia structural layout translation error', err)
			return null
		}
	}, [skiaPixelBuffer])

	// ── Focus gate ───────────────────────────────────────────────────────────────
	// Activate camera only when the screen is in focus (PRD §3.2 Camera Disable
	// Conditions). `isActive={false}` in v5 fully pauses the sensor and releases
	// GPU/CPU resources — it does NOT unmount the Camera component, keeping it
	// warm for fast resume (per PRD §3.2 "conditionally unmounted" means isActive).
	useFocusEffect(
		useCallback(() => {
			tracker.log('Screen focused, activating camera hardware stream')
			setIsCameraActive(true)
			return () => {
				tracker.log('Screen unfocused, pausing camera hardware stream')
				setIsCameraActive(false)
			}
		}, [])
	)

	// ── Auto-select first style ───────────────────────────────────────────────────
	useEffect(() => {
		if (!selectedStyleId && availableStyles.length > 0) {
			tracker.debug('Auto-selecting first available style', {
				id: availableStyles[0].id,
			})
			setSelectedStyle(availableStyles[0].id)
		}
	}, [availableStyles, selectedStyleId, setSelectedStyle])

	// ── Handlers ─────────────────────────────────────────────────────────────────

	const handleStyleSelect = useCallback(
		(id: string) => {
			tracker.log('Style selection changed', { styleId: id })
			setSelectedStyle(id)
		},
		[setSelectedStyle]
	)

	const handleFlipCamera = useCallback(() => {
		setCameraPosition((prev) => {
			const nextPosition = prev === 'back' ? 'front' : 'back'
			tracker.log('Toggling camera position placement', {
				from: prev,
				to: nextPosition,
			})
			return nextPosition
		})
	}, [])

	const handleToggleFlash = useCallback(() => {
		setFlashMode((prev) => {
			let nextMode: 'off' | 'on' | 'auto' = 'off'
			if (prev === 'off') nextMode = 'on'
			else if (prev === 'on') nextMode = 'auto'

			tracker.log('Cycling hardware flash engine parameter', {
				from: prev,
				to: nextMode,
			})
			return nextMode
		})
	}, [])

	/**
	 * Capture handler — VisionCamera v5 API.
	 *
	 * FIX (v4 → v5):
	 * OLD: cameraRef.current.takePhoto({ flash: flashMode }) → PhotoFile
	 * NEW: photoOutput.capturePhotoToFile({ flashMode }, {}) → { filePath: string }
	 *
	 * The `filePath` returned by v5 is a bare OS filesystem path WITHOUT the
	 * `file://` scheme (e.g. `/data/user/.../photo.jpg`). We prepend `file://`
	 * for compatibility with expo-file-system, React Native Image, and the job
	 * queue which expects a fully qualified URI.
	 *
	 * The `{}` second argument is the `CapturePhotoCallbacks` object (required
	 * in v5 but can be an empty object for default behaviour).
	 */
	const handleCapture = useCallback(async () => {
		if (isBatteryCritical || isCapturing) {
			tracker.warn('Capture abort triggered', {
				isBatteryCritical,
				isCapturing,
			})
			return
		}

		tracker.log('Initiating high-res snapshot asset generation sequence', {
			flashMode,
			selectedStyleId,
		})
		setIsCapturing(true)

		// Shutter flash animation
		Animated.sequence([
			Animated.timing(shutterAnim, {
				toValue: 0.2,
				duration: 60,
				useNativeDriver: true,
			}),
			Animated.timing(shutterAnim, {
				toValue: 1,
				duration: 200,
				useNativeDriver: true,
			}),
		]).start()

		// Shutter scale animation
		Animated.sequence([
			Animated.spring(captureScale, {
				toValue: 0.88,
				useNativeDriver: true,
				speed: 50,
				bounciness: 4,
			}),
			Animated.spring(captureScale, {
				toValue: 1,
				useNativeDriver: true,
				speed: 30,
				bounciness: 6,
			}),
		]).start()

		try {
			// ── v5 capture call ────────────────────────────────────────────────────
			// `capturePhotoToFile` writes directly to a temp file and resolves with
			// `{ filePath: string }`. The `flashMode` option accepts 'on'|'off'|'auto'.
			// Second argument is `CapturePhotoCallbacks` (empty object = defaults).
			const photo = await photoOutput.capturePhotoToFile(
				{ flashMode },
				{}
			)

			// Normalise to a `file://` URI. v5 returns a bare filesystem path without
			// the scheme. We guard against double-prefixing in case a future SDK
			// version adds it automatically.
			const fileUri = photo.filePath.startsWith('file://')
				? photo.filePath
				: `file://${photo.filePath}`

			tracker.debug(
				'Photo resolved safely onto disk space tracking matrix',
				{ barePath: photo.filePath, formattedUri: fileUri }
			)

			// PRD §3.2 Capture Behaviour: enqueue immediately, UI stays responsive.
			if (selectedStyleId) {
				tracker.log(
					'Enqueuing newly structured raw frame matrix into background worker line',
					{ styleId: selectedStyleId }
				)
				enqueueJob({ sourceUri: fileUri, styleId: selectedStyleId })
			} else {
				tracker.warn(
					'Photo captured successfully, but style payload context is completely empty'
				)
			}
		} catch (err) {
			tracker.error(
				'High-res hardware filesystem capture sub-pipeline error wrapper',
				err
			)
			Alert.alert(
				'Capture failed',
				'Could not take photo. Please try again.'
			)
		} finally {
			setIsCapturing(false)
		}
	}, [
		isBatteryCritical,
		isCapturing,
		shutterAnim,
		captureScale,
		flashMode,
		selectedStyleId,
		enqueueJob,
		photoOutput,
	])

	const handleGoToGallery = useCallback(() => {
		tracker.debug(
			'Routing user path forward to local processing gallery interface grid'
		)
		router.push('/(tabs)/gallery')
	}, [])
	const handleGoToStyles = useCallback(() => {
		tracker.debug(
			'Routing user path down into marketplace repository store module'
		)
		router.push('/(tabs)/styles')
	}, [])

	// ── List renderers ────────────────────────────────────────────────────────────

	const renderStyleChip = useCallback<ListRenderItem<StyleModel>>(
		({ item }) => (
			<StyleChip
				item={item}
				isSelected={item.id === selectedStyleId}
				onPress={handleStyleSelect}
			/>
		),
		[selectedStyleId, handleStyleSelect]
	)

	const styleKeyExtractor = useCallback((item: StyleModel) => item.id, [])

	const FlashIcon = flashMode === 'off' ? ZapOff : Zap

	// ── Render: permission denied ─────────────────────────────────────────────────
	if (!hasPermission) {
		tracker.warn(
			'Rendering permission fallback layout element branch - hardware unavailable'
		)
		return (
			<View style={styles.screen}>
				<PermissionScreen onRequest={requestPermission} />
			</View>
		)
	}

	// ── Render: battery critical (PRD §3.2) ───────────────────────────────────────
	// Camera viewfinder is conditionally NOT rendered when battery is critical.
	// Camera component is NOT in the tree at all in this branch, fully releasing
	// GPU/CPU resources.
	if (isBatteryCritical) {
		tracker.warn(
			'Halting camera lifecycle execution context tree due to critical engine load limits',
			{ batteryLevel, isPowerSaverActive }
		)
		return (
			<View style={styles.screen}>
				<BatteryPausedScreen />
				<Pressable
					onPress={() => router.back()}
					style={[
						styles.topControl,
						{
							position: 'absolute',
							top: insets.top + 12,
							left: 16,
						},
					]}
					accessibilityRole="button"
					accessibilityLabel="Go back"
				>
					<ChevronLeft color={C.white} size={22} strokeWidth={2} />
				</Pressable>
			</View>
		)
	}

	// ── Render: device not ready ───────────────────────────────────────────────────
	if (!device) {
		tracker.log(
			'Viewport setup holding configuration loop - target camera hardware layer not localized'
		)
		return (
			<View style={styles.screen}>
				<View style={styles.centeredState}>
					<ActivityIndicator color={C.primaryMid} size="large" />
					<Text style={styles.stateSub}>Initializing camera…</Text>
				</View>
			</View>
		)
	}

	// ── Render: full camera UI ────────────────────────────────────────────────────
	return (
		<View style={styles.screen}>
			{/*
			 * ── Camera Feed ────────────────────────────────────────────────────────
			 *
			 * VisionCamera v5 props:
			 * ref         → useRef<Camera> (NOT CameraRef — that type was removed in v5)
			 * device      → CameraDevice from useCameraDevice()
			 * isActive    → false fully pauses the sensor (PRD §3.2 Camera Disable)
			 * outputs     → array of CameraOutput objects created via hooks:
			 * • photoOutput  (from usePhotoOutput)
			 * • frameOutput  (from useFrameOutput with onFrame worklet)
			 * orientationSource → 'device' tracks physical rotation (recommended)
			 *
			 * REMOVED vs v4:
			 * • photo={true}               → replaced by outputs={[photoOutput]}
			 * • frameProcessor={...}       → replaced by outputs={[frameOutput]}
			 * • enableDistortionCorrection → removed in v5
			 * • enableLowLightBoost        → removed in v5
			 * • enableNativeTapToFocusGesture → removed in v5 (always built-in)
			 * • enableSmoothAutoFocus      → removed in v5
			 */}
			<Camera
				ref={cameraRef}
				style={StyleSheet.absoluteFill}
				device={device}
				isActive={isCameraActive}
				outputs={[photoOutput, frameOutput]}
				orientationSource="device"
			/>

			{selectedStyleId && skiaDrawableImage && (
				<Canvas style={StyleSheet.absoluteFill}>
					<Image
						image={skiaDrawableImage}
						x={0}
						y={0}
						width={256}
						height={256}
					/>
				</Canvas>
			)}

			{/* ── Ambient overlay scrims ─────────────────────────────────────────── */}
			{/*
			 * RN 0.83: `pointerEvents` as a direct View prop is deprecated.
			 * Pass it via `style={{ pointerEvents: 'none' }}` instead.
			 */}
			<View style={[styles.topScrim, { pointerEvents: 'none' }]} />
			<View style={[styles.bottomScrim, { pointerEvents: 'none' }]} />

			{/* ── Top controls ──────────────────────────────────────────────────── */}
			<View style={[styles.topControls, { top: insets.top + 12 }]}>
				{/* Flash toggle */}
				<Pressable
					onPress={handleToggleFlash}
					style={[
						styles.topControl,
						flashMode !== 'off' && styles.topControlActive,
					]}
					accessibilityRole="button"
					accessibilityLabel={`Flash mode: ${flashMode}`}
				>
					<FlashIcon
						color={flashMode === 'off' ? C.white : C.warning}
						size={20}
						strokeWidth={1.8}
					/>
				</Pressable>

				{/* Battery warning pill — shown when ≤ 20% but not critical */}
				{batteryLevel <= 20 && (
					<View style={styles.batteryWarnPill}>
						<AlertTriangle
							color={C.warning}
							size={12}
							strokeWidth={2}
						/>
						<Text style={styles.batteryWarnText}>
							{batteryLevel}%
						</Text>
					</View>
				)}

				{/* Camera flip */}
				<Pressable
					onPress={handleFlipCamera}
					style={styles.topControl}
					accessibilityRole="button"
					accessibilityLabel="Flip camera"
				>
					<FlipHorizontal
						color={C.white}
						size={20}
						strokeWidth={1.8}
					/>
				</Pressable>
			</View>

			{/* ── No styles prompt ──────────────────────────────────────────────── */}
			{availableStyles.length === 0 && (
				<View style={styles.noStylesBanner}>
					<Text style={styles.noStylesText}>
						No styles downloaded.
					</Text>
					<Pressable
						onPress={handleGoToStyles}
						style={styles.noStylesButton}
					>
						<Text style={styles.noStylesButtonText}>
							Get styles →
						</Text>
					</Pressable>
				</View>
			)}

			{/* ── Style carousel ────────────────────────────────────────────────── */}
			{availableStyles.length > 0 && (
				<View
					style={[
						styles.carousel,
						{ bottom: insets.bottom + SHUTTER_SIZE + 48 },
					]}
				>
					<FlatList
						data={availableStyles}
						renderItem={renderStyleChip}
						keyExtractor={styleKeyExtractor}
						horizontal
						showsHorizontalScrollIndicator={false}
						contentContainerStyle={styles.carouselContent}
						ItemSeparatorComponent={() => (
							<View style={{ width: 10 }} />
						)}
						getItemLayout={(_, i) => ({
							length: STYLE_CARD_W + 10,
							offset: (STYLE_CARD_W + 10) * i,
							index: i,
						})}
						initialNumToRender={5}
						maxToRenderPerBatch={5}
						removeClippedSubviews
					/>
				</View>
			)}

			{/* ── Shutter row ───────────────────────────────────────────────────── */}
			<View style={[styles.shutterRow, { bottom: insets.bottom + 24 }]}>
				{/* Gallery shortcut with pending-jobs badge */}
				<Pressable
					onPress={handleGoToGallery}
					style={styles.sideControl}
					accessibilityRole="button"
					accessibilityLabel={`Gallery, ${pendingCount} jobs pending`}
				>
					<Images color={C.white} size={24} strokeWidth={1.6} />
					{pendingCount > 0 && (
						<View style={styles.pendingBadge}>
							<Text style={styles.pendingBadgeText}>
								{pendingCount > 9 ? '9+' : pendingCount}
							</Text>
						</View>
					)}
				</Pressable>

				{/* Shutter button */}
				<Animated.View style={{ transform: [{ scale: captureScale }] }}>
					<Pressable
						onPress={handleCapture}
						disabled={isCapturing}
						style={[
							styles.shutterOuter,
							isCapturing && styles.shutterOuterCapturing,
						]}
						accessibilityRole="button"
						accessibilityLabel="Capture photo"
						accessibilityState={{ disabled: isCapturing }}
					>
						<Animated.View
							style={[
								styles.shutterInner,
								{ opacity: shutterAnim },
							]}
						/>
					</Pressable>
				</Animated.View>

				{/* Balance spacer */}
				<View style={styles.sideControl} />
			</View>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		backgroundColor: C.black,
	},

	// State screens
	centeredState: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		padding: 32,
		gap: 16,
		backgroundColor: C.bg,
	},
	stateTitle: {
		color: C.text,
		fontSize: 22,
		fontWeight: '700',
		textAlign: 'center',
	},
	stateSub: {
		color: C.textMuted,
		fontSize: 15,
		textAlign: 'center',
		lineHeight: 22,
	},
	primaryButton: {
		backgroundColor: C.primaryMid,
		borderRadius: 14,
		paddingHorizontal: 28,
		paddingVertical: 14,
		marginTop: 8,
	},
	primaryButtonText: {
		color: C.white,
		fontSize: 15,
		fontWeight: '700',
	},
	ghostButton: {
		borderRadius: 14,
		paddingHorizontal: 28,
		paddingVertical: 12,
	},
	ghostButtonText: {
		color: C.textMuted,
		fontSize: 14,
		fontWeight: '500',
	},

	// Scrims — pointerEvents applied inline via style (RN 0.83 deprecation)
	topScrim: {
		...StyleSheet.absoluteFillObject,
		height: 160,
		bottom: 'auto',
		top: 0,
	},
	bottomScrim: {
		...StyleSheet.absoluteFillObject,
		top: 'auto',
		bottom: 0,
		height: 300,
	},

	// Top controls
	topControls: {
		position: 'absolute',
		left: 16,
		right: 16,
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	topControl: {
		width: CONTROL_SIZE,
		height: CONTROL_SIZE,
		borderRadius: CONTROL_SIZE / 2,
		backgroundColor: 'rgba(0,0,0,0.45)',
		justifyContent: 'center',
		alignItems: 'center',
		borderWidth: 1,
		borderColor: 'rgba(255,255,255,0.12)',
	},
	topControlActive: {
		backgroundColor: `${C.warning}25`,
		borderColor: `${C.warning}50`,
	},
	batteryWarnPill: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		backgroundColor: 'rgba(0,0,0,0.55)',
		borderRadius: 20,
		paddingHorizontal: 10,
		paddingVertical: 6,
		borderWidth: 1,
		borderColor: `${C.warning}40`,
	},
	batteryWarnText: {
		color: C.warning,
		fontSize: 12,
		fontWeight: '600',
	},

	// No styles banner
	noStylesBanner: {
		position: 'absolute',
		top: '50%',
		left: 24,
		right: 24,
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		backgroundColor: 'rgba(10,10,20,0.85)',
		borderRadius: 14,
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderWidth: 1,
		borderColor: C.border,
	},
	noStylesText: { color: C.textMuted, fontSize: 14 },
	noStylesButton: {
		paddingHorizontal: 12,
		paddingVertical: 6,
		backgroundColor: C.primaryMid,
		borderRadius: 8,
	},
	noStylesButtonText: { color: C.white, fontSize: 13, fontWeight: '600' },

	// Style carousel
	carousel: { position: 'absolute', left: 0, right: 0 },
	carouselContent: { paddingHorizontal: 20 },
	styleChip: {
		width: STYLE_CARD_W,
		alignItems: 'center',
		gap: 6,
		opacity: 0.7,
	},
	styleChipSelected: { opacity: 1 },
	styleChipImage: {
		width: STYLE_CARD_W,
		height: STYLE_CARD_H,
		borderRadius: 14,
		borderWidth: 2,
		borderColor: 'transparent',
	},
	styleChipCheckmark: {
		position: 'absolute',
		top: 6,
		right: 6,
		width: 20,
		height: 20,
		borderRadius: 10,
		backgroundColor: C.primaryMid,
		justifyContent: 'center',
		alignItems: 'center',
	},
	styleChipLabel: {
		color: C.text,
		fontSize: 11,
		fontWeight: '500',
		textAlign: 'center',
		opacity: 0.7,
	},
	styleChipLabelSelected: { opacity: 1, color: C.white, fontWeight: '700' },

	// Shutter
	shutterRow: {
		position: 'absolute',
		left: 0,
		right: 0,
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingHorizontal: 32,
	},
	sideControl: {
		width: CONTROL_SIZE + 10,
		height: CONTROL_SIZE + 10,
		borderRadius: (CONTROL_SIZE + 10) / 2,
		backgroundColor: 'rgba(0,0,0,0.45)',
		justifyContent: 'center',
		alignItems: 'center',
		borderWidth: 1,
		borderColor: 'rgba(255,255,255,0.12)',
	},
	pendingBadge: {
		position: 'absolute',
		top: -4,
		right: -4,
		width: 18,
		height: 18,
		borderRadius: 9,
		backgroundColor: C.primaryMid,
		justifyContent: 'center',
		alignItems: 'center',
	},
	pendingBadgeText: { color: C.white, fontSize: 9, fontWeight: '800' },
	shutterOuter: {
		width: SHUTTER_SIZE,
		height: SHUTTER_SIZE,
		borderRadius: SHUTTER_SIZE / 2,
		backgroundColor: 'rgba(255,255,255,0.2)',
		justifyContent: 'center',
		alignItems: 'center',
		borderWidth: 3,
		borderColor: C.white,
	},
	shutterOuterCapturing: { opacity: 0.6 },
	shutterInner: {
		width: SHUTTER_SIZE - 16,
		height: SHUTTER_SIZE - 16,
		borderRadius: (SHUTTER_SIZE - 16) / 2,
		backgroundColor: C.white,
	},
})
