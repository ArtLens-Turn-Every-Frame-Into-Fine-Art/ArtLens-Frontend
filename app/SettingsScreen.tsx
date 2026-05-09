import { router } from "expo-router";
import {
	ChevronRight,
	CloudOff,
	HardDrive,
	Info,
	ShieldCheck,
	Sparkles,
	User,
	Zap,
} from "lucide-react-native";
import React, { useState } from "react";
import {
	Platform,
	ScrollView,
	StyleSheet,
	Switch,
	Text,
	TouchableOpacity,
	View,
} from "react-native";

interface SettingRowProps {
	icon: React.ReactNode;
	title: string;
	subtitle?: string;
	type: "toggle" | "link";
	value?: boolean;
	onValueChange?: (val: boolean) => void;
	onPress?: () => void;
	isLast?: boolean;
}

export default function SettingsScreen() {
	const [performanceMode, setPerformanceMode] = useState(true);
	const [highQuality, setHighQuality] = useState(false);
	const [offlineUsage, setOfflineUsage] = useState(false);

	const PRIMARY_PURPLE = "#7B61FF";

	return (
		<View style={styles.container}>
			{/* Header - Aligned with _layout padding */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>Settings</Text>
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={styles.scrollContent}
			>
				<Text style={styles.pageTitle}>Preferences</Text>
				<Text style={styles.pageSubtitle}>
					Customize your ArtLens experience and manage how the AI
					processes your artwork.
				</Text>

				{/* Account Section */}
				<Text style={styles.sectionHeader}>ACCOUNT</Text>
				<View style={styles.group}>
					<SettingRow
						icon={<User size={20} color={PRIMARY_PURPLE} />}
						title="Pro Plan"
						subtitle="Manage subscription"
						type="link"
						isLast
					/>
				</View>

				{/* Performance & Quality Section */}
				<Text style={styles.sectionHeader}>PERFORMANCE & QUALITY</Text>
				<View style={styles.group}>
					<SettingRow
						icon={<Zap size={20} color="#FFD60A" />}
						title="Performance Mode"
						subtitle="Prioritize speed over detail"
						type="toggle"
						value={performanceMode}
						onValueChange={setPerformanceMode}
					/>
					<SettingRow
						icon={<Sparkles size={20} color="#FF9F0A" />}
						title="Ultra Res Output"
						subtitle="Render in 4K resolution"
						type="toggle"
						value={highQuality}
						onValueChange={setHighQuality}
						isLast
					/>
				</View>

				{/* Data & Storage Section */}
				<Text style={styles.sectionHeader}>DATA & STORAGE</Text>
				<View style={styles.group}>
					<SettingRow
						icon={<CloudOff size={20} color="#30B0C7" />}
						title="Offline Mode"
						subtitle="Process without internet"
						type="toggle"
						value={offlineUsage}
						onValueChange={setOfflineUsage}
					/>
					<SettingRow
						icon={<HardDrive size={20} color="#32D74B" />}
						title="Clear Cache"
						subtitle="Used: 124 MB"
						type="link"
						isLast
					/>
				</View>

				{/* Support Section */}
				<Text style={styles.sectionHeader}>SUPPORT</Text>
				<View style={styles.group}>
					<SettingRow
						icon={<ShieldCheck size={20} color="#5E5CE6" />}
						title="Privacy Policy"
						type="link"
						onPress={() => {}}
					/>
					<SettingRow
						icon={<Info size={20} color="#8E8E93" />}
						title="About ArtLens"
						type="link"
						onPress={() => router.push("/AboutContact")}
						isLast
					/>
				</View>

				<View style={styles.footerInfo}>
					<Text style={styles.versionText}>
						ArtLens Version 2.0.4
					</Text>
					<Text style={styles.footerHint}>
						Changes are applied instantly to your profile.
					</Text>
				</View>
			</ScrollView>
		</View>
	);
}

const SettingRow: React.FC<SettingRowProps> = ({
	icon,
	title,
	subtitle,
	type,
	value,
	onValueChange,
	onPress,
	isLast,
}) => (
	<TouchableOpacity
		activeOpacity={type === "link" ? 0.6 : 1}
		onPress={type === "link" ? onPress : undefined}
		style={[styles.row, isLast && styles.noBorder]}
	>
		<View style={styles.iconContainer}>{icon}</View>
		<View style={styles.rowContent}>
			<View style={{ flex: 1 }}>
				<Text style={styles.rowTitle}>{title}</Text>
				{subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}
			</View>
			{type === "toggle" ? (
				<Switch
					value={value}
					onValueChange={onValueChange}
					trackColor={{ false: "#D1D1D6", true: "#34C759" }}
					thumbColor={Platform.OS === "ios" ? undefined : "#FFF"}
				/>
			) : (
				<ChevronRight size={18} color="#C7C7CC" />
			)}
		</View>
	</TouchableOpacity>
);

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "#FFF" },
	header: {
		height: 60,
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 20,
		borderBottomWidth: 1,
		borderBottomColor: "#F2F2F7",
	},
	headerTitle: { fontSize: 17, fontWeight: "700", color: "#1C1C1E" },
	scrollContent: { padding: 20, paddingBottom: 0 },
	pageTitle: {
		fontSize: 32,
		fontWeight: "800",
		color: "#1C1C1E",
		marginBottom: 8,
		letterSpacing: -0.5,
	},
	pageSubtitle: {
		fontSize: 15,
		color: "#8E8E93",
		marginBottom: 32,
		lineHeight: 22,
	},
	sectionHeader: {
		fontSize: 12,
		fontWeight: "700",
		color: "#8E8E93",
		marginBottom: 8,
		marginLeft: 4,
		letterSpacing: 1,
	},
	group: {
		backgroundColor: "#F8F9FA",
		borderRadius: 16,
		marginBottom: 24,
		overflow: "hidden",
	},
	row: {
		flexDirection: "row",
		alignItems: "center",
		paddingLeft: 16,
	},
	rowContent: {
		flex: 1,
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingVertical: 14,
		paddingRight: 16,
		borderBottomWidth: 1,
		borderBottomColor: "#E5E5EA",
	},
	noBorder: { borderBottomWidth: 0 },
	iconContainer: {
		width: 32,
		height: 32,
		borderRadius: 8,
		backgroundColor: "#FFF",
		justifyContent: "center",
		alignItems: "center",
		marginRight: 12,
		...Platform.select({
			ios: {
				shadowColor: "#000",
				shadowOffset: { width: 0, height: 1 },
				shadowOpacity: 0.1,
				shadowRadius: 2,
			},
			android: { elevation: 2 },
		}),
	},
	rowTitle: { fontSize: 16, fontWeight: "600", color: "#1C1C1E" },
	rowSubtitle: { fontSize: 12, color: "#8E8E93", marginTop: 2 },
	footerInfo: { alignItems: "center", marginTop: 10, marginBottom: 30 },
	versionText: { fontSize: 13, color: "#C7C7CC", marginBottom: 4 },
	footerHint: { textAlign: "center", color: "#AEAEB2", fontSize: 12 },

	// Bottom Nav (Absolute to sit over the _layout padding)
	bottomNav: {
		position: "absolute",
		bottom: 0,
		flexDirection: "row",
		backgroundColor: "rgba(255,255,255,0.9)",
		paddingTop: 12,
		borderTopWidth: 1,
		borderTopColor: "#F2F2F7",
		justifyContent: "space-around",
		width: "100%",
		height: 80,
	},
	navItem: { padding: 10, alignItems: "center" },
	activeIndicator: {
		backgroundColor: "#F5F3FF",
		padding: 8,
		borderRadius: 12,
		marginTop: -8,
	},
});
