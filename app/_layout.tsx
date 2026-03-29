import { Stack, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
	Camera,
	Home,
	Image as ImageIcon,
	Settings,
} from "lucide-react-native";
import React, { useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
	SafeAreaProvider,
	useSafeAreaInsets,
} from "react-native-safe-area-context";
import { COLORS } from "../utils/constants";

function AppLayout() {
	const insets = useSafeAreaInsets();
	const pathname = usePathname();

	useEffect(() => {}, []);

	// Hide global nav on the Camera screen for full immersion
	const isCamera = pathname.includes("CameraScreen");

	return (
		<View
			style={[
				styles.container,
				{ backgroundColor: isCamera ? "#000" : COLORS.background },
			]}
		>
			<StatusBar style={isCamera ? "light" : "dark"} translucent />

			<View style={{ flex: 1, paddingTop: isCamera ? 0 : insets.top }}>
				<Stack
					screenOptions={{ headerShown: false, animation: "fade" }}
				/>
			</View>

			{/* 2. GLOBAL BOTTOM NAVIGATION (Moved from individual screens) */}
			{!isCamera && (
				<View style={[styles.bottomNav, { paddingBottom: 40 }]}>
					<NavItem
						icon={<Home size={24} />}
						label=""
						active={pathname === "/"}
						onPress={() => router.push("/")}
					/>
					<NavItem
						icon={<ImageIcon size={24} />}
						label=""
						active={pathname.includes("Gallery")}
						onPress={() => router.push("/GalleryScreen")}
					/>
					<NavItem
						icon={<Camera size={24} />}
						label=""
						onPress={() => router.push("/CameraScreen")}
					/>
					<NavItem
						icon={<Settings size={24} />}
						label=""
						active={pathname.includes("Settings")}
						onPress={() => router.push("/SettingsScreen")}
					/>
				</View>
			)}
		</View>
	);
}

const NavItem = ({ icon, label, active, onPress }: any) => (
	<TouchableOpacity style={styles.navItem} onPress={onPress}>
		{React.cloneElement(icon, {
			color: active ? COLORS.primary : COLORS.textGray,
		})}
		<Text
			style={[
				styles.navText,
				{ color: active ? COLORS.primary : COLORS.textGray },
			]}
		>
			{label}
		</Text>
	</TouchableOpacity>
);

export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<AppLayout />
		</SafeAreaProvider>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
	bottomNav: {
		flexDirection: "row",
		backgroundColor: COLORS.white,
		paddingTop: 12,
		borderTopWidth: 1,
		borderTopColor: COLORS.border,
		justifyContent: "space-around",
	},
	navItem: { alignItems: "center" },
	navText: { fontSize: 10, marginTop: 4, fontWeight: "500" },
});
