/**
 * ArtLens — Root Layout Shell (Light Theme Variant)
 *
 * Responsibilities:
 *  - GestureHandlerRootView + StatusBar
 *  - Tabs navigator with all 5 tab screens
 *  - Camera tab: tab bar hidden for full-screen experience
 *  - Font hydration + SplashScreen gating
 *  - First-boot hardware benchmark trigger
 */

import React, { useCallback, useEffect } from 'react'
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native'
import { Tabs } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Home, Images, Camera, Layers, Settings } from 'lucide-react-native'
import { ContactProvider } from '@/context/ContactContext'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'
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

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 82 : 105
const TAB_ICON_SIZE = 22

// — Prevent splash from hiding before fonts are ready ————————————————————————
SplashScreen.preventAutoHideAsync().catch(() => {})

// — Icon helpers ——————————————————————————————————————————————————————————————
interface TabIconProps {
	color: string
	focused: boolean
}

const HomeIcon = ({ color }: TabIconProps) => (
	<Home color={color} size={TAB_ICON_SIZE} strokeWidth={1.6} />
)
const GalleryIcon = ({ color }: TabIconProps) => (
	<Images color={color} size={TAB_ICON_SIZE} strokeWidth={1.6} />
)
const StylesIcon = ({ color }: TabIconProps) => (
	<Layers color={color} size={TAB_ICON_SIZE} strokeWidth={1.6} />
)
const SettingsIcon = ({ color }: TabIconProps) => (
	<Settings color={color} size={TAB_ICON_SIZE} strokeWidth={1.6} />
)

/** The centre "Create" tab gets a pill-shaped button treatment. */
const CreateIcon = ({ focused }: TabIconProps) => (
	<View style={[styles.createPill, focused && styles.createPillActive]}>
		<Camera
			color={focused ? C.white : C.inactive}
			size={20}
			strokeWidth={1.8}
		/>
	</View>
)

// — Common tabBarStyle for visible tabs ———————————————————————————————————————
const VISIBLE_TAB_BAR_STYLE: ViewStyle = {
	backgroundColor: C.surface,
	borderTopColor: C.border,
	borderTopWidth: StyleSheet.hairlineWidth,
	height: TAB_BAR_HEIGHT,
	paddingBottom: Platform.OS === 'ios' ? 24 : 6,
	paddingTop: 0,
	elevation: 0,
	shadowOpacity: 0,
}

// — Root Layout ——————————————————————————————————————————————————————————————
export default function RootLayout(): React.JSX.Element | null {
	// Fonts — add custom font map here when assets are bundled.
	const [fontsLoaded, fontError] = useFonts({})

	const ready = fontsLoaded || Boolean(fontError)

	useEffect(() => {
		if (ready) {
			SplashScreen.hideAsync().catch(() => {})
		}
	}, [ready])

	useEffect(() => {
		const initialJobs = useStyleJobStore.getState().jobs
		const hasQueuedJobs = initialJobs.some((job) => job.status === 'QUEUED')

		if (hasQueuedJobs) {
			StyleJobService.processNextJobInQueue().catch((error) => {
				tracker.error(
					'[RootLayout] Failed to auto-start persistent job queue loop:',
					error
				)
			})
		}
	}, [])

	const onRootLayout = useCallback(() => {
		// no-op: kept so GestureHandlerRootView has a stable handler ref.
	}, [])

	if (!ready) return null

	return (
		<ContactProvider>
			<GestureHandlerRootView style={styles.root} onLayout={onRootLayout}>
				<StatusBar
					style="dark"
					translucent
					backgroundColor="transparent"
				/>

				<Tabs
					screenOptions={{
						sceneStyle: { backgroundColor: C.bg },
						headerShown: false,
						tabBarActiveTintColor: C.primary, // Swapped to primary core for richer text visibility
						tabBarInactiveTintColor: C.inactive,
						tabBarStyle: VISIBLE_TAB_BAR_STYLE,
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
			</GestureHandlerRootView>
		</ContactProvider>
	)
}

// — Styles ————————————————————————————————————————————————————————————————————
const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: C.bg,
	},
	tabLabel: {
		fontSize: 10,
		fontWeight: '500',
		letterSpacing: 0.2,
	},
	createPill: {
		width: 48,
		height: 48,
		borderRadius: 24,
		backgroundColor: C.surface,
		borderWidth: 1.5,
		borderColor: C.border,
		justifyContent: 'center',
		alignItems: 'center',
		marginTop: Platform.OS === 'ios' ? -16 : -12,
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
