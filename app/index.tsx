import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Image as ImageIcon, Sparkles, Wand2 } from "lucide-react-native";
import React from "react";
import {
	Image,
	ImageBackground,
	ScrollView,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
} from "react-native";
// Import the global colors from your layout
import { COLORS } from "../utils/constants";

interface FeatureItemProps {
	label: string;
	icon: React.ReactNode;
}

interface StyleCardProps {
	title: string;
	tag: string;
	image: string;
}

export default function ArtLensHome() {
	// Improved Feature Item with actual Icons
	const FeatureItem: React.FC<FeatureItemProps> = ({ label, icon }) => (
		<View style={styles.featureItem}>
			<View style={styles.featureCircle}>{icon}</View>
			<Text style={styles.featureLabel}>{label}</Text>
		</View>
	);

	const StyleCard: React.FC<StyleCardProps> = ({ title, tag, image }) => (
		<TouchableOpacity
			style={styles.cardContainer}
			onPress={() => router.push("/StyleSelection")}
			activeOpacity={0.9}
		>
			<Image source={{ uri: image }} style={styles.cardImage} />
			<View style={styles.cardInfo}>
				<Text style={styles.cardTitle}>{title}</Text>
				<Text style={styles.cardTag}>{tag}</Text>
			</View>
		</TouchableOpacity>
	);

	return (
		<View style={styles.container}>
			{/* Header - Simplified as padding is handled by _layout */}
			<View style={styles.header}>
				<View style={styles.logoRow}>
					<View style={styles.logoBox}>
						<Sparkles size={18} color="#FFF" />
					</View>
					<Text style={styles.logoText}>ArtLens</Text>
				</View>
				<TouchableOpacity
					style={styles.profileBtn}
					onPress={() => router.push("/SettingsScreen")}
					activeOpacity={0.7}
				>
					<View style={styles.profileCircle} />
				</TouchableOpacity>
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={styles.scrollContent}
			>
				{/* Hero Section */}
				<View style={styles.heroContainer}>
					<ImageBackground
						source={{
							uri: "https://images.unsplash.com/photo-1509248961158-e54f6934749c?q=80&w=1000",
						}}
						style={styles.heroImage}
						imageStyle={{ borderRadius: 24 }}
					>
						<LinearGradient
							colors={["transparent", "rgba(0,0,0,0.9)"]}
							style={styles.gradient}
						>
							<Text style={styles.heroTitle}>
								Turn Photos Into{"\n"}Art Instantly
							</Text>
							<Text style={styles.heroSubtitle}>
								Create masterpieces with AI power
							</Text>

							<View style={styles.heroButtonRow}>
								<TouchableOpacity
									style={styles.primaryButton}
									onPress={() => router.push("/CameraScreen")}
								>
									<Text style={styles.primaryButtonText}>
										Open Camera
									</Text>
								</TouchableOpacity>

								<TouchableOpacity
									style={styles.secondaryButton}
									onPress={() =>
										router.push("/GalleryScreen")
									}
								>
									<ImageIcon size={20} color="#FFF" />
								</TouchableOpacity>
							</View>
						</LinearGradient>
					</ImageBackground>
				</View>

				{/* Features Row */}
				<View style={styles.featuresRow}>
					<FeatureItem
						label="Live AI"
						icon={<Sparkles size={20} color={COLORS.primary} />}
					/>
					<FeatureItem
						label="Background"
						icon={<ImageIcon size={20} color={COLORS.primary} />}
					/>
					<FeatureItem
						label="Magic Edit"
						icon={<Wand2 size={20} color={COLORS.primary} />}
					/>
				</View>

				{/* Trending Styles Section */}
				<View style={styles.sectionHeader}>
					<Text style={styles.sectionTitle}>Trending Styles</Text>
					<TouchableOpacity
						onPress={() => router.push("/StyleSelection")}
					>
						<Text style={styles.seeAll}>See All</Text>
					</TouchableOpacity>
				</View>

				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					contentContainerStyle={styles.styleScroll}
				>
					<StyleCard
						title="Impressionism"
						tag="Classic"
						image="https://images.unsplash.com/photo-1541701494587-cb58502866ab?q=80&w=400"
					/>
					<StyleCard
						title="Cyberpunk"
						tag="Futuristic"
						image="https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=400"
					/>
					<StyleCard
						title="Pencil Sketch"
						tag="Minimal"
						image="https://images.unsplash.com/photo-1513364776144-60967b0f800f?q=80&w=400"
					/>
				</ScrollView>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "#FFF" },
	scrollContent: { paddingBottom: 20 },
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 20,
		paddingVertical: 15,
	},
	logoRow: { flexDirection: "row", alignItems: "center" },
	logoBox: {
		width: 36,
		height: 36,
		backgroundColor: COLORS.primary,
		borderRadius: 10,
		marginRight: 12,
		justifyContent: "center",
		alignItems: "center",
	},
	logoText: {
		fontSize: 24,
		fontWeight: "900",
		color: COLORS.textMain,
		letterSpacing: -0.5,
	},
	profileBtn: {
		padding: 4,
		justifyContent: "center",
		alignItems: "center",
	},
	profileCircle: {
		width: 36,
		height: 36,
		borderRadius: 18,
		backgroundColor: COLORS.border,
	},

	heroContainer: { paddingHorizontal: 15, height: 420, marginBottom: 10 },
	heroImage: { flex: 1, justifyContent: "flex-end", overflow: "hidden" },
	gradient: {
		padding: 24,
		paddingBottom: 30,
		alignItems: "center",
	},
	heroTitle: {
		color: "#FFF",
		fontSize: 36,
		fontWeight: "900",
		textAlign: "center",
		marginBottom: 8,
		lineHeight: 40,
	},
	heroSubtitle: {
		color: "rgba(255,255,255,0.7)",
		fontSize: 16,
		marginBottom: 25,
		fontWeight: "500",
	},

	heroButtonRow: { flexDirection: "row", gap: 12, width: "100%" },
	primaryButton: {
		backgroundColor: COLORS.white,
		flex: 1,
		padding: 18,
		borderRadius: 20,
		alignItems: "center",
		shadowColor: "#000",
		shadowOpacity: 0.2,
		shadowRadius: 10,
		elevation: 5,
	},
	primaryButtonText: { fontWeight: "800", fontSize: 16, color: "#000" },
	secondaryButton: {
		backgroundColor: "rgba(255,255,255,0.2)",
		width: 60,
		borderRadius: 20,
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.3)",
		justifyContent: "center",
		alignItems: "center",
	},

	featuresRow: {
		flexDirection: "row",
		justifyContent: "space-around",
		paddingVertical: 25,
		backgroundColor: COLORS.white,
		marginHorizontal: 15,
		borderRadius: 20,
		marginTop: -30, // Overlap effect
		elevation: 2,
		shadowColor: "#000",
		shadowOpacity: 0.05,
		shadowRadius: 5,
	},
	featureItem: { alignItems: "center", width: 90 },
	featureCircle: {
		width: 50,
		height: 50,
		borderRadius: 15,
		backgroundColor: "#F0EDFF", // Very light version of primary
		marginBottom: 8,
		justifyContent: "center",
		alignItems: "center",
	},
	featureLabel: {
		fontSize: 11,
		fontWeight: "700",
		color: COLORS.textMain,
		textAlign: "center",
	},

	sectionHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		paddingHorizontal: 20,
		marginTop: 30,
		marginBottom: 15,
		alignItems: "center",
	},
	sectionTitle: { fontSize: 20, fontWeight: "800", color: COLORS.textMain },
	seeAll: { color: COLORS.primary, fontWeight: "700", fontSize: 14 },

	styleScroll: { paddingLeft: 20, paddingRight: 20 },
	cardContainer: {
		marginRight: 15,
		width: 180,
		backgroundColor: COLORS.white,
		borderRadius: 20,
		overflow: "hidden",
		borderWidth: 1,
		borderColor: COLORS.border,
	},
	cardImage: { width: "100%", height: 240 },
	cardInfo: { padding: 12 },
	cardTitle: { fontSize: 16, fontWeight: "800", color: COLORS.textMain },
	cardTag: { fontSize: 13, color: COLORS.textGray, marginTop: 2 },
});
