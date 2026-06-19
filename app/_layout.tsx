/**
 * ArtLens — Root Layout Shell (Light Theme Variant)
 *
 * Responsibilities:
 * - GestureHandlerRootView + StatusBar
 * - Tabs navigator with all 5 tab screens
 * - Camera tab: tab bar hidden for full-screen experience
 * - Font hydration + SplashScreen gating
 */

import React, { useEffect } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { Tabs } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import {
	SafeAreaProvider,
	useSafeAreaInsets,
} from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Home, Images, Camera, Layers, Settings } from 'lucide-react-native'
import { ContactProvider } from '@/context/ContactContext'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'
import { useBatteryStore } from '@/shared/stores/useBatteryStore'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('RootLayout')

// — Design Tokens (Updated to Light Theme) ————————————————————————————————————
const C = {
	bg: '#F8F9FB',
	surface: '#FFFFFF',
	border: '#F2F2F7',
	primary: '#7B61FF',
	primaryGlow: '#A291FF',
	inactive: '#8E8E93',
	white: '#FFFFFF',
} as const

const TAB_ICON_SIZE = 22

// — Prevent splash from hiding before fonts are ready ————————————————————————
SplashScreen.preventAutoHideAsync().catch(() => {})

// — Icon helpers ——————————————————————————————————————————————————————————————
interface TabIconProps {
	color: string
	focused: boolean
}

const HomeIcon = ({ color }: TabIconProps) => (
	<Home color={color} size={TAB_ICON_SIZE} strokeWidth={1.8} />
)
const GalleryIcon = ({ color }: TabIconProps) => (
	<Images color={color} size={TAB_ICON_SIZE} strokeWidth={1.8} />
)
const StylesIcon = ({ color }: TabIconProps) => (
	<Layers color={color} size={TAB_ICON_SIZE} strokeWidth={1.8} />
)
const SettingsIcon = ({ color }: TabIconProps) => (
	<Settings color={color} size={TAB_ICON_SIZE} strokeWidth={1.8} />
)

/** The centre "Create" tab gets an optimized pill-shaped button treatment. */
const CreateIcon = ({ focused }: TabIconProps) => (
	<View style={[styles.createPill, focused && styles.createPillActive]}>
		<Camera
			color={focused ? C.white : C.inactive}
			size={22}
			strokeWidth={2.0}
		/>
	</View>
)

// — Root Layout Content Component —————————————————————————————————────────────
function RootLayoutContent(): React.JSX.Element | null {
	const insets = useSafeAreaInsets()

	// Fonts — add custom font map here when assets are bundled.
	const [fontsLoaded, fontError] = useFonts({})

	const ready = fontsLoaded || Boolean(fontError)

	useEffect(() => {
		if (ready) {
			SplashScreen.hideAsync().catch(() => {})
		}
	}, [ready])

	// ── Battery monitoring lifecycle ──────────────────────────────────────────
	// Start hardware listeners on mount and tear them down on unmount.
	useEffect(() => {
		useBatteryStore
			.getState()
			.initializeBatteryMonitoring()
			.catch((err) => {
				tracker.error(
					'[RootLayout] Failed to start battery monitoring:',
					err
				)
			})

		return () => {
			useBatteryStore.getState().destroyBatteryMonitoring()
		}
	}, [])

	// ── Battery recovery → resume paused jobs ─────────────────────────────────
	// Subscribe to isProcessingFrozen. When it transitions true → false (battery
	// recovered above critical threshold or power-saver disabled), resume all
	// BATTERY_PAUSED jobs and restart the queue drain cycle.
	useEffect(() => {
		let wasFrozen = useBatteryStore.getState().isProcessingFrozen

		const unsubscribe = useBatteryStore.subscribe((state) => {
			const isFrozen = state.isProcessingFrozen
			if (wasFrozen && !isFrozen) {
				tracker.log(
					'[RootLayout] Battery recovered — resuming BATTERY_PAUSED jobs.'
				)
				StyleJobService.resumeAll()
			}
			wasFrozen = isFrozen
		})

		return () => {
			unsubscribe()
		}
	}, [])

	// ── Startup queue drain (Fixed) ───────────────────────────────────────────
	useEffect(() => {
		const { jobs, updateJob } = useStyleJobStore.getState()
		const isFrozen = useBatteryStore.getState().isProcessingFrozen

		// 1. If battery is healthy on boot, automatically repair historical paused jobs back to standard queue status
		if (!isFrozen) {
			jobs.forEach((job) => {
				if (job.status === 'BATTERY_PAUSED') {
					updateJob(job.id, { status: 'QUEUED', progress: 0 })
				}
			})
		}

		// 2. Query the live store state again to see if any work needs processing
		const freshJobs = useStyleJobStore.getState().jobs
		const hasWorkToProcess = freshJobs.some(
			(job) => job.status === 'QUEUED' || job.status === 'PREVIEW_QUEUED'
		)

		if (hasWorkToProcess) {
			StyleJobService.processNextJobInQueue().catch((error) => {
				tracker.error(
					'[RootLayout] Failed to auto-start persistent job queue loop:',
					error
				)
			})
		}
	}, [])

	const dynamicBottomPadding = Platform.OS === 'ios' ? 16 : insets.bottom + 10
	const dynamicTabBarHeight = 54 + dynamicBottomPadding

	if (!ready) return null

	return (
		<Tabs
			screenOptions={{
				sceneStyle: { backgroundColor: C.bg },
				headerShown: false,
				tabBarActiveTintColor: C.primary,
				tabBarInactiveTintColor: C.inactive,
				tabBarStyle: {
					backgroundColor: C.surface,
					borderTopColor: C.border,
					borderTopWidth: StyleSheet.hairlineWidth,
					height: dynamicTabBarHeight,
					paddingBottom: dynamicBottomPadding,
					paddingTop: 6,
					elevation: 0,
					shadowOpacity: 0,
				},
				tabBarLabelStyle: styles.tabLabel,
				tabBarHideOnKeyboard: true,
				animation: 'shift',
			}}
		>
			{/* ── Home ── */}
			<Tabs.Screen
				name="(tabs)/home"
				options={{
					title: 'Home',
					tabBarIcon: HomeIcon,
				}}
			/>

			{/* ── Gallery ── */}
			<Tabs.Screen
				name="(tabs)/gallery"
				options={{
					title: 'Gallery',
					tabBarIcon: GalleryIcon,
				}}
			/>

			{/* ── Create / Camera — tab bar hidden for full-bleed experience ── */}
			<Tabs.Screen
				name="(tabs)/camera"
				options={{
					title: 'Create',
					tabBarIcon: CreateIcon,
					tabBarLabel: () => null,
					tabBarStyle: { display: 'none' },
				}}
			/>

			{/* ── Styles ── */}
			<Tabs.Screen
				name="(tabs)/styles"
				options={{
					title: 'Styles',
					tabBarIcon: StylesIcon,
				}}
			/>

			{/* ── Settings ── */}
			<Tabs.Screen
				name="(tabs)/settings"
				options={{
					title: 'Settings',
					tabBarIcon: SettingsIcon,
				}}
			/>

			{/* (screens) */}
			<Tabs.Screen
				name="(screens)"
				options={{
					href: null,
				}}
			/>

			{/* expo-sharing */}
			<Tabs.Screen
				name="expo-sharing"
				options={{
					href: null,
				}}
			/>

			{/* ── Redirect index — hidden from tab bar ── */}
			<Tabs.Screen name="index" options={{ href: null }} />
		</Tabs>
	)
}

// — Root Entry Wrapper ————————————————————————————————————————————————————————
export default function RootLayout(): React.JSX.Element {
	return (
		<SafeAreaProvider>
			<ContactProvider>
				<GestureHandlerRootView style={styles.root}>
					<StatusBar
						style="dark"
						translucent
						backgroundColor="transparent"
					/>
					<RootLayoutContent />
				</GestureHandlerRootView>
			</ContactProvider>
		</SafeAreaProvider>
	)
}

// — Styles ————————————————————————————————————————————————————————————————————
const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: C.bg,
	},
	tabLabel: {
		fontSize: 11,
		fontWeight: '600',
		letterSpacing: 0.1,
		marginTop: 2,
	},
	createPill: {
		width: 46,
		height: 46,
		borderRadius: 23,
		backgroundColor: C.surface,
		borderWidth: 1.5,
		borderColor: C.border,
		justifyContent: 'center',
		alignItems: 'center',
		marginTop: 2,
	},
	createPillActive: {
		backgroundColor: C.primary,
		borderColor: C.primary,
		shadowColor: C.primary,
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.25,
		shadowRadius: 12,
		elevation: 8,
	},
})
