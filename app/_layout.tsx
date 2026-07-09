/**
 * ArtLens — Root Layout Shell
 * * @module app/_layout
 *
 * Responsibilities:
 *   - SafeAreaProvider, ContactProvider, GestureHandlerRootView wrappers
 *   - StatusBar configuration (dark, translucent)
 *   - Tabs navigator: Home, Gallery, Create/Camera, Styles, Settings
 *   - Camera tab: tab bar hidden for full-screen viewfinder experience
 *   - Font hydration + SplashScreen gating
 *   - Battery monitoring lifecycle (start on mount, stop on unmount)
 *   - Battery recovery: auto-resume BATTERY_PAUSED jobs when battery recovers
 *   - Startup queue drain: repair stale BATTERY_PAUSED jobs from last session,
 *     then kick off any QUEUED work that survived a crash or force-quit
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
import { Camera, Home, Images, Layers, Settings } from 'lucide-react-native'

import { ContactProvider } from '@/context/ContactContext'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'
import { useBatteryStore } from '@/shared/stores/useBatteryStore'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('RootLayout')

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS (layout-local — not imported from DesignTokens.ts because the
// root layout loads before the full module graph is warm)
// ─────────────────────────────────────────────────────────────────────────────

const C = {
	bg: '#F8F9FB',
	surface: '#FFFFFF',
	border: '#F2F2F7',
	primary: '#7B61FF',
	inactive: '#8E8E93',
	white: '#FFFFFF',
} as const

const TAB_ICON_SIZE = 22

// Hide the splash screen only after fonts resolve (loaded or errored).
SplashScreen.preventAutoHideAsync().catch(() => {})

// ─────────────────────────────────────────────────────────────────────────────
// TAB ICON COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * The centre Create/Camera tab uses a pill-shaped button to distinguish it
 * visually from the flat text-icon tabs on either side.
 */
const CreateIcon = ({ focused }: TabIconProps) => (
	<View style={[styles.createPill, focused && styles.createPillActive]}>
		<Camera
			color={focused ? C.white : C.inactive}
			size={22}
			strokeWidth={2.0}
		/>
	</View>
)

// ─────────────────────────────────────────────────────────────────────────────
// ROOT LAYOUT CONTENT (inner — needs insets, so lives inside SafeAreaProvider)
// ─────────────────────────────────────────────────────────────────────────────

function RootLayoutContent(): React.JSX.Element | null {
	const insets = useSafeAreaInsets()

	// Extend the font map here when custom font assets are bundled.
	const [fontsLoaded, fontError] = useFonts({})
	const ready = fontsLoaded || Boolean(fontError)

	useEffect(() => {
		if (ready) SplashScreen.hideAsync().catch(() => {})
	}, [ready])

	// Start hardware battery polling on mount; clean up listeners on unmount.
	useEffect(() => {
		useBatteryStore
			.getState()
			.initializeBatteryMonitoring()
			.catch((err) =>
				tracker.error('Battery monitoring init failed:', err)
			)

		return () => useBatteryStore.getState().destroyBatteryMonitoring()
	}, [])

	// When isProcessingFrozen transitions true → false (battery recovered or
	// power-saver disabled), re-queue all BATTERY_PAUSED jobs.
	useEffect(() => {
		let wasFrozen = useBatteryStore.getState().isProcessingFrozen

		const unsubscribe = useBatteryStore.subscribe((state) => {
			const isFrozen = state.isProcessingFrozen
			if (wasFrozen && !isFrozen) {
				tracker.log('Battery recovered — resuming paused jobs.')
				StyleJobService.resumeAll()
			}
			wasFrozen = isFrozen
		})

		return () => unsubscribe()
	}, [])

	// On startup: repair any BATTERY_PAUSED jobs left from the previous session
	// back to QUEUED, then drain the queue if work is waiting.
	useEffect(() => {
		const { jobs, updateJob } = useStyleJobStore.getState()
		const isFrozen = useBatteryStore.getState().isProcessingFrozen

		if (!isFrozen) {
			jobs.forEach((job) => {
				if (job.status === 'BATTERY_PAUSED') {
					updateJob(job.id, { status: 'QUEUED', progress: 0 })
				}
			})
		}

		const freshJobs = useStyleJobStore.getState().jobs
		const hasWork = freshJobs.some(
			(job) => job.status === 'QUEUED' || job.status === 'PREVIEW_QUEUED'
		)

		if (hasWork) {
			StyleJobService.processNextJobInQueue().catch((err) =>
				tracker.error('Startup queue drain failed:', err)
			)
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
			<Tabs.Screen
				name="(tabs)/home"
				options={{ title: 'Home', tabBarIcon: HomeIcon }}
			/>
			<Tabs.Screen
				name="(tabs)/gallery"
				options={{ title: 'Gallery', tabBarIcon: GalleryIcon }}
			/>
			<Tabs.Screen
				name="(tabs)/camera"
				options={{
					title: 'Create',
					tabBarIcon: CreateIcon,
					tabBarLabel: () => null,
					// Full-bleed camera viewfinder — tab bar would occlude the shutter
					tabBarStyle: { display: 'none' },
				}}
			/>
			<Tabs.Screen
				name="(tabs)/styles"
				options={{ title: 'Styles', tabBarIcon: StylesIcon }}
			/>
			<Tabs.Screen
				name="(tabs)/settings"
				options={{ title: 'Settings', tabBarIcon: SettingsIcon }}
			/>

			{/* Modal screen group — hidden from the tab bar */}
			<Tabs.Screen name="(screens)" options={{ href: null }} />
			<Tabs.Screen name="expo-sharing" options={{ href: null }} />
			<Tabs.Screen name="index" options={{ href: null }} />
		</Tabs>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT ENTRY WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

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
