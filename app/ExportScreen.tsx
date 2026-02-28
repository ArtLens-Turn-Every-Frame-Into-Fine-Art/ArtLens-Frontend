import { router } from "expo-router";
import {
	CheckCircle2,
	ChevronLeft,
	Download,
	Facebook,
	Instagram,
	MoreHorizontal,
	Share2,
	Twitter,
} from "lucide-react-native";
import React, { useState } from "react";
import {
	Dimensions,
	Platform,
	ScrollView,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
} from "react-native";

const { width } = Dimensions.get("window");
const PRIMARY_PURPLE = "#7B61FF";

interface QualityOptionProps {
	id: string;
	title: string;
	subtitle: string;
	size: string;
	selected: boolean;
	onSelect: (id: string) => void;
}

export default function ExportScreen() {
	const [selectedQuality, setSelectedQuality] = useState("high");
	const [isSaved, setIsSaved] = useState(false);

	const shareOptions = [
		{ name: "Instagram", icon: <Instagram color="#E1306C" size={24} /> },
		{ name: "Facebook", icon: <Facebook color="#1877F2" size={24} /> },
		{ name: "Twitter", icon: <Twitter color="#1DA1F2" size={24} /> },
		{ name: "More", icon: <MoreHorizontal color="#8E8E93" size={24} /> },
	];

	const handleSave = () => {
		// Here you would integrate actual file saving logic
		setIsSaved(true);
		setTimeout(() => setIsSaved(false), 3000);
	};

	return (
		<View style={styles.container}>
			{/* Header - Aligned with _layout's paddingTop: 21 */}
			<View style={styles.header}>
				<TouchableOpacity
					onPress={() => router.back()}
					style={styles.backBtn}
					hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
				>
					<ChevronLeft color="#1A1A1A" size={28} />
				</TouchableOpacity>
				<Text style={styles.headerTitle}>Export</Text>
				<TouchableOpacity style={styles.backBtn}>
					<Share2 color="#1A1A1A" size={22} />
				</TouchableOpacity>
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={styles.scrollContent}
			>
				<View style={styles.titleSection}>
					<Text style={styles.pageTitle}>Masterpiece Ready</Text>
					<Text style={styles.pageSubtitle}>
						Choose your preferred quality and share your creation
						with the world.
					</Text>
				</View>

				{/* Export Quality Section */}
				<View style={styles.sectionHeaderRow}>
					<Text style={styles.sectionLabel}>SELECT QUALITY</Text>
					<SparklesIcon color={PRIMARY_PURPLE} size={14} />
				</View>

				<QualityOption
					id="standard"
					title="Standard"
					subtitle="Fastest export, great for DMs"
					size="2.4 MB"
					selected={selectedQuality === "standard"}
					onSelect={setSelectedQuality}
				/>

				<QualityOption
					id="high"
					title="High Definition"
					subtitle="Optimized for Social Media"
					size="5.8 MB"
					selected={selectedQuality === "high"}
					onSelect={setSelectedQuality}
				/>

				<QualityOption
					id="ultra"
					title="Ultra 4K"
					subtitle="Lossless, best for printing"
					size="14.2 MB"
					selected={selectedQuality === "ultra"}
					onSelect={setSelectedQuality}
				/>

				{/* Share Section */}
				<Text style={[styles.sectionLabel, { marginTop: 25 }]}>
					SHARE DIRECTLY
				</Text>
				<View style={styles.shareGrid}>
					{shareOptions.map((option, index) => (
						<TouchableOpacity key={index} style={styles.shareCard}>
							<View style={styles.shareIconWrapper}>
								{option.icon}
							</View>
							<Text style={styles.shareName}>{option.name}</Text>
						</TouchableOpacity>
					))}
				</View>

				{/* Primary Action Button */}
				<TouchableOpacity
					style={[styles.saveBtn, isSaved && styles.saveBtnSuccess]}
					onPress={handleSave}
					disabled={isSaved}
					activeOpacity={0.8}
				>
					{isSaved ? (
						<>
							<CheckCircle2 size={22} color="#FFF" />
							<Text style={styles.saveBtnText}>
								Saved to Gallery
							</Text>
						</>
					) : (
						<>
							<Download size={22} color="#FFF" />
							<Text style={styles.saveBtnText}>
								Download Artwork
							</Text>
						</>
					)}
				</TouchableOpacity>

				<View style={styles.infoBox}>
					<Text style={styles.footerNote}>
						Images are processed locally. Your art never leaves your
						device unless you share it.
					</Text>
				</View>
			</ScrollView>
		</View>
	);
}

// Small helper for the section header
const SparklesIcon = ({ color, size }: { color: string; size: number }) => (
	<View style={{ marginLeft: 6 }}>
		<Text style={{ color, fontSize: size }}>✦</Text>
	</View>
);

const QualityOption: React.FC<QualityOptionProps> = ({
	id,
	title,
	subtitle,
	size,
	selected,
	onSelect,
}) => (
	<TouchableOpacity
		style={[styles.qualityCard, selected && styles.activeQualityCard]}
		onPress={() => onSelect(id)}
		activeOpacity={0.7}
	>
		<View style={styles.qualityTextGroup}>
			<View style={styles.titleRow}>
				<Text
					style={[
						styles.qualityTitle,
						selected && { color: PRIMARY_PURPLE },
					]}
				>
					{title}
				</Text>
				<View
					style={[
						styles.sizeBadge,
						selected && styles.activeSizeBadge,
					]}
				>
					<Text
						style={[
							styles.qualitySize,
							selected && { color: "#FFF" },
						]}
					>
						{size}
					</Text>
				</View>
			</View>
			<Text style={styles.qualitySubtitle}>{subtitle}</Text>
		</View>
		<View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
			{selected && <View style={styles.radioInner} />}
		</View>
	</TouchableOpacity>
);

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "#FFF" },
	header: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingHorizontal: 20,
		height: 60,
	},
	backBtn: { padding: 4 },
	headerTitle: {
		fontSize: 17,
		fontWeight: "700",
		color: "#1A1A1A",
		letterSpacing: -0.3,
	},
	scrollContent: { padding: 20 },
	titleSection: { alignItems: "center", marginBottom: 35 },
	pageTitle: {
		fontSize: 28,
		fontWeight: "900",
		color: "#1C1C1E",
		marginBottom: 8,
		letterSpacing: -0.5,
	},
	pageSubtitle: {
		fontSize: 15,
		color: "#8E8E93",
		textAlign: "center",
		lineHeight: 22,
		paddingHorizontal: 20,
	},
	sectionHeaderRow: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 15,
	},
	sectionLabel: {
		fontSize: 12,
		fontWeight: "800",
		color: "#AEAEB2",
		letterSpacing: 1,
	},

	// Quality Cards
	qualityCard: {
		backgroundColor: "#F8F9FA",
		borderRadius: 20,
		padding: 20,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginBottom: 12,
		borderWidth: 1.5,
		borderColor: "transparent",
	},
	activeQualityCard: {
		borderColor: PRIMARY_PURPLE,
		backgroundColor: "#FFF",
		...Platform.select({
			ios: {
				shadowColor: PRIMARY_PURPLE,
				shadowOffset: { width: 0, height: 8 },
				shadowOpacity: 0.15,
				shadowRadius: 12,
			},
			android: { elevation: 4 },
		}),
	},
	qualityTextGroup: { flex: 1 },
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		marginBottom: 4,
	},
	qualityTitle: {
		fontSize: 17,
		fontWeight: "800",
		color: "#1C1C1E",
	},
	sizeBadge: {
		backgroundColor: "#E5E5EA",
		paddingHorizontal: 8,
		paddingVertical: 2,
		borderRadius: 6,
	},
	activeSizeBadge: { backgroundColor: PRIMARY_PURPLE },
	qualitySize: {
		fontSize: 11,
		fontWeight: "700",
		color: "#8E8E93",
	},
	qualitySubtitle: { fontSize: 13, color: "#8E8E93", fontWeight: "400" },
	radioOuter: {
		width: 24,
		height: 24,
		borderRadius: 12,
		borderWidth: 2,
		borderColor: "#D1D1D6",
		justifyContent: "center",
		alignItems: "center",
		marginLeft: 15,
	},
	radioOuterActive: { borderColor: PRIMARY_PURPLE },
	radioInner: {
		width: 12,
		height: 12,
		borderRadius: 6,
		backgroundColor: PRIMARY_PURPLE,
	},

	// Share Grid
	shareGrid: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 35,
	},
	shareCard: {
		width: (width - 70) / 4,
		backgroundColor: "#FFF",
		borderRadius: 20,
		paddingVertical: 18,
		alignItems: "center",
		borderWidth: 1,
		borderColor: "#F2F2F7",
	},
	shareIconWrapper: { marginBottom: 10 },
	shareName: {
		fontSize: 10,
		color: "#1C1C1E",
		fontWeight: "700",
		textTransform: "uppercase",
	},

	// Footer Actions
	saveBtn: {
		backgroundColor: PRIMARY_PURPLE,
		height: 64,
		borderRadius: 32,
		flexDirection: "row",
		justifyContent: "center",
		alignItems: "center",
		gap: 12,
		marginBottom: 20,
	},
	saveBtnSuccess: { backgroundColor: "#00C853" },
	saveBtnText: { color: "#FFF", fontSize: 18, fontWeight: "900" },
	infoBox: {
		paddingHorizontal: 30,
		marginTop: 10,
	},
	footerNote: {
		textAlign: "center",
		color: "#AEAEB2",
		fontSize: 12,
		lineHeight: 18,
		fontWeight: "500",
	},

	// Bottom Nav - Enhanced for _layout
	bottomNav: {
		position: "absolute",
		bottom: 0,
		flexDirection: "row",
		paddingTop: 15,
		borderTopWidth: 1,
		borderTopColor: "rgba(0,0,0,0.05)",
		justifyContent: "space-around",
		alignItems: "flex-start",
		width: "100%",
		// Height is implicitly managed by the _layout's paddingBottom
		height: 85,
	},
	navItem: { padding: 10 },
	activeNavCircle: {
		width: 52,
		height: 52,
		borderRadius: 26,
		backgroundColor: "#F5F3FF",
		justifyContent: "center",
		alignItems: "center",
		marginTop: -10, // Slight lift for the active item
	},
});
