/**
 * ArtLens — CameraScreen
 *
 * Full-screen lightweight viewfinder using VisionCamera v5.
 * Captures high-res photos and instantly routes them to StyleSelectionScreen.
 *
 * @module app/(tabs)
 */

import React, { useCallback, useState, useRef } from 'react'
import {
	ActivityIndicator,
	Alert,
	Animated,
	Linking,
	Pressable,
	StyleSheet,
	Text,
	View,
	Platform,
	StatusBar,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { createTracker } from '@/shared/utils/logger'
import * as ImagePicker from 'expo-image-picker'

// ── VisionCamera v5 ───────────────────────────────────────────────────────────
import {
	Camera,
	useCameraDevice,
	useCameraPermission,
	usePhotoOutput,
} from 'react-native-vision-camera'

import {
	AlertTriangle,
	Battery,
	CameraOff,
	ChevronLeft,
	FlipHorizontal,
	Images,
	Zap,
	ZapOff,
} from 'lucide-react-native'

// ── Stores ────────────────────────────────────────────────────────────────────
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { useBatteryStore } from '@/shared/stores/useBatteryStore'

const tracker = createTracker('CameraScreen')

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const C = {
	bg: '#080810',
	surface: '#10101C',
	text: '#F4F4FF',
	textMuted: '#7070A0',
	primaryMid: '#7C3AED',
	warning: '#D97706',
	white: '#FFFFFF',
	black: '#000000',
} as const

const SHUTTER_SIZE = 74
const CONTROL_SIZE = 44

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM FALLBACK SCREENS
// ─────────────────────────────────────────────────────────────────────────────

const PermissionScreen = React.memo<{ onRequest: () => void }>(
	({ onRequest }) => (
		<View style={styles.centeredState}>
			<CameraOff color={C.textMuted} size={56} strokeWidth={1.2} />
			<Text style={styles.stateTitle}>Camera access needed</Text>
			<Text style={styles.stateSub}>
				ArtLens needs camera permission to take pictures for processing.
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

const BatteryPausedScreen = React.memo(() => (
	<View style={styles.centeredState}>
		<Battery color={C.warning} size={56} strokeWidth={1.2} />
		<Text style={styles.stateTitle}>Camera paused</Text>
		<Text style={styles.stateSub}>
			Camera disabled due to critical low battery — connect to charger to
			resume.
		</Text>
	</View>
))
BatteryPausedScreen.displayName = 'BatteryPausedScreen'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CAMERA SCREEN Component
// ─────────────────────────────────────────────────────────────────────────────

export default function CameraScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// ── Permissions & Hardware Hardware Configuration ──────────────────────────
	const { hasPermission, requestPermission } = useCameraPermission()
	const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>(
		'back'
	)
	const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off')
	const device = useCameraDevice(cameraPosition)

	// ── Core Lifecycle States ──────────────────────────────────────────────────
	const [isCameraActive, setIsCameraActive] = useState(false)
	const [isCapturing, setIsCapturing] = useState(false)

	// FIXED FOR EXPO SDK 55: Use React.ElementRef<typeof Camera> instead of direct value type
	const cameraRef = useRef<React.ElementRef<typeof Camera>>(null)

	// ── Animations ─────────────────────────────────────────────────────────────
	const shutterAnim = useRef(new Animated.Value(1)).current
	const captureScale = useRef(new Animated.Value(1)).current

	// ── Global Stores Context ──────────────────────────────────────────────────
	const pendingCount = useStyleJobStore(
		(s) =>
			s.jobs.filter(
				(j) => j.status === 'QUEUED' || j.status === 'PROCESSING'
			).length
	)
	const batteryLevel = useBatteryStore((s) => s.batteryLevel)
	const isPowerSaverActive = useBatteryStore((s) => s.isPowerSaverActive)
	const isBatteryCritical = batteryLevel <= 5 || isPowerSaverActive

	// ── VisionCamera v5 Output Registration ────────────────────────────────────
	const photoOutput = usePhotoOutput()

	// ── Focus Gate Observer ────────────────────────────────────────────────────
	useFocusEffect(
		useCallback(() => {
			tracker.log('Screen focused, waking up camera hardware stream')
			setIsCameraActive(true)

			// Force system bar hidden behavior when camera opens
			StatusBar.setHidden(true, 'fade')

			return () => {
				tracker.log('Screen unfocused, pausing camera hardware stream')
				setIsCameraActive(false)

				// CLEANUP: Force Android window out of immersive/fullscreen state immediately
				StatusBar.setHidden(false, 'fade')
				StatusBar.setBarStyle('dark-content', true)

				if (Platform.OS === 'android') {
					StatusBar.setTranslucent(false)
					// Paint the bar back to white to immediately overwrite frozen pixels/black blocks
					StatusBar.setBackgroundColor('#FFFFFF')
				}
			}
		}, [])
	)

	// ── Action Event Handlers ──────────────────────────────────────────────────

	const handleFlipCamera = useCallback(() => {
		setCameraPosition((prev) => (prev === 'back' ? 'front' : 'back'))
	}, [])

	const handleToggleFlash = useCallback(() => {
		setFlashMode((prev) =>
			prev === 'off' ? 'on' : prev === 'on' ? 'auto' : 'off'
		)
	}, [])

	const handleCapture = useCallback(async () => {
		if (isBatteryCritical || isCapturing) return

		tracker.log('Initiating snapshot capture sequence')
		setIsCapturing(true)

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
			const photo = await photoOutput.capturePhotoToFile(
				{
					flashMode,
					enableShutterSound: false,
					enableDistortionCorrection: true,
				},
				{}
			)

			const fileUri = photo.filePath.startsWith('file://')
				? photo.filePath
				: `file://${photo.filePath}`

			tracker.debug('Photo file created on disk successfully', {
				path: fileUri,
			})

			const encodedUri = encodeURIComponent(fileUri)

			router.replace({
				pathname: '/(screens)/StyleSelectionScreen',
				params: { sourceUri: encodedUri },
			})
			setIsCapturing(false)
		} catch (err) {
			tracker.error('Hardware snapshot file compilation layer error', err)
			Alert.alert(
				'Capture failed',
				'Could not save photo. Please try again.'
			)
			setIsCapturing(false)
		}
	}, [
		isBatteryCritical,
		isCapturing,
		flashMode,
		photoOutput,
		shutterAnim,
		captureScale,
	])

	const handleGoToGallery = useCallback(async () => {
		try {
			const result = await ImagePicker.launchImageLibraryAsync({
				mediaTypes: ImagePicker.MediaTypeOptions.Images,
				allowsEditing: false,
				quality: 1,
			})

			if (!result.canceled && result.assets && result.assets.length > 0) {
				const selectedUri = result.assets[0].uri
				const encodedUri = encodeURIComponent(selectedUri)

				router.replace({
					pathname: '/(screens)/StyleSelectionScreen',
					params: { sourceUri: encodedUri },
				})
			}
		} catch (err) {
			tracker.error('Error launching system photo gallery', err)
			Alert.alert('Error', 'Could not open the photo gallery.')
		}
	}, [])

	const handleGoBack = useCallback(() => {
		router.replace('/(tabs)/home')
	}, [])

	const FlashIcon = flashMode === 'off' ? ZapOff : Zap

	// ── Render States: Permissions Fallback ────────────────────────────────────
	if (!hasPermission) {
		return (
			<View style={styles.screen}>
				<PermissionScreen onRequest={requestPermission} />
			</View>
		)
	}

	// ── Render States: Battery Protection Rule ────────────────────────────────
	if (isBatteryCritical) {
		return (
			<View style={styles.screen}>
				<BatteryPausedScreen />
				<Pressable
					onPress={handleGoBack}
					style={[
						styles.topControl,
						{
							position: 'absolute',
							top: insets.top + 12,
							left: 16,
						},
					]}
				>
					<ChevronLeft color={C.white} size={22} strokeWidth={2} />
				</Pressable>
			</View>
		)
	}

	// ── Render States: Hardware Warming Delay ─────────────────────────────────
	if (!device) {
		return (
			<View style={styles.screen}>
				{/* FIXED: Changed <div> to native React Native <View> to eliminate web linter style warnings */}
				<View style={styles.centeredState}>
					<ActivityIndicator color={C.primaryMid} size="large" />
					<Text style={styles.stateSub}>
						Initializing camera device layer…
					</Text>
				</View>
			</View>
		)
	}

	// ── Render States: Live Viewport Layout ────────────────────────────────────
	return (
		<View style={styles.screen}>
			<Camera
				ref={cameraRef}
				style={StyleSheet.absoluteFill}
				device={device}
				isActive={isCameraActive}
				outputs={[photoOutput]}
				orientationSource="device"
			/>

			{/* FIXED: Replaced legacy style pointer hacks with idiomatic pointerEvents properties */}
			<View style={styles.topScrim} pointerEvents="none" />
			<View style={styles.bottomScrim} pointerEvents="none" />

			{/* Top Bar Action Accessory Controllers */}
			<View style={[styles.topControls, { top: insets.top + 12 }]}>
				<View style={styles.topControlsLeftRow}>
					<Pressable onPress={handleGoBack} style={styles.topControl}>
						<ChevronLeft
							color={C.white}
							size={22}
							strokeWidth={2}
						/>
					</Pressable>

					<Pressable
						onPress={handleToggleFlash}
						style={[
							styles.topControl,
							flashMode !== 'off' && styles.topControlActive,
						]}
					>
						<FlashIcon
							color={flashMode === 'off' ? C.white : C.warning}
							size={20}
							strokeWidth={1.8}
						/>
					</Pressable>
				</View>

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

				<Pressable onPress={handleFlipCamera} style={styles.topControl}>
					<FlipHorizontal
						color={C.white}
						size={20}
						strokeWidth={1.8}
					/>
				</Pressable>
			</View>

			{/* Bottom Row Viewport Shutter Trigger Bar Layout */}
			<View style={[styles.shutterRow, { bottom: insets.bottom + 32 }]}>
				<Pressable
					onPress={handleGoToGallery}
					style={styles.sideControl}
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

				<Animated.View style={{ transform: [{ scale: captureScale }] }}>
					<Pressable
						onPress={handleCapture}
						disabled={isCapturing}
						style={[
							styles.shutterOuter,
							isCapturing && styles.shutterOuterCapturing,
						]}
					>
						<Animated.View
							style={[
								styles.shutterInner,
								{ opacity: shutterAnim },
							]}
						/>
					</Pressable>
				</Animated.View>

				<View style={styles.sideControlInvisible} />
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
	topScrim: {
		...StyleSheet.absoluteFillObject,
		height: 140,
		bottom: 'auto',
		top: 0,
	},
	bottomScrim: {
		...StyleSheet.absoluteFillObject,
		top: 'auto',
		bottom: 0,
		height: 200,
	},
	topControls: {
		position: 'absolute',
		left: 16,
		right: 16,
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	topControlsLeftRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
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
	shutterRow: {
		position: 'absolute',
		left: 0,
		right: 0,
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingHorizontal: 40,
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
	sideControlInvisible: {
		width: CONTROL_SIZE + 10,
		height: CONTROL_SIZE + 10,
		opacity: 0,
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
	pendingBadgeText: {
		color: C.white,
		fontSize: 9,
		fontWeight: '800',
	},
	shutterOuter: {
		width: SHUTTER_SIZE,
		height: SHUTTER_SIZE,
		borderRadius: SHUTTER_SIZE / 2,
		backgroundColor: 'rgba(255,255,255,0.2)',
		justifyContent: 'center',
		alignItems: 'center',
		borderWidth: 4,
		borderColor: C.white,
	},
	shutterOuterCapturing: {
		opacity: 0.4,
	},
	shutterInner: {
		width: SHUTTER_SIZE - 18,
		height: SHUTTER_SIZE - 18,
		borderRadius: (SHUTTER_SIZE - 18) / 2,
		backgroundColor: C.white,
	},
})
