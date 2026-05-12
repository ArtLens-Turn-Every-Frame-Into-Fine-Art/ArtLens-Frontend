import { Stack, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
	Camera,
	Home,
	Image as ImageIcon,
	Settings,
} from "lucide-react-native";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import {
	SafeAreaProvider,
	useSafeAreaInsets,
} from "react-native-safe-area-context";
import { COLORS } from "@/utils/constants";
import { ModelProvider } from "@/context/ModelContext";

function AppLayout() {
	const insets = useSafeAreaInsets();
	const pathname = usePathname();

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

			{!isCamera && (
				<View style={[styles.bottomNav, { paddingBottom: 60 }]}>
					<NavItem
						icon={<Home size={24} />}
						active={pathname === "/"}
						onPress={() => router.push("/")}
					/>
					<NavItem
						icon={<ImageIcon size={24} />}
						active={pathname.includes("Gallery")}
						onPress={() => router.push("/GalleryScreen")}
					/>
					<NavItem
						icon={<Camera size={24} />}
						onPress={() => router.push("/CameraScreen")}
					/>
					<NavItem
						icon={<Settings size={24} />}
						active={pathname.includes("Settings")}
						onPress={() => router.push("/SettingsScreen")}
					/>
				</View>
			)}
		</View>
	);
}

export default function RootLayout() {
	return (
		<ModelProvider>
			<SafeAreaProvider>
				<AppLayout />
			</SafeAreaProvider>
		</ModelProvider>
	);
}

const NavItem = ({ icon, active, onPress }: any) => (
	<TouchableOpacity style={styles.navItem} onPress={onPress}>
		{React.cloneElement(icon, {
			color: active ? COLORS.primary : COLORS.textGray,
		})}
	</TouchableOpacity>
);

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
});
