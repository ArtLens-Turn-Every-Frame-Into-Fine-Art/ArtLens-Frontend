import {
	Download,
	Eye,
	HelpCircle,
	Search,
	Sparkles,
} from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
	Dimensions,
	Image,
	Platform,
	SafeAreaView,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";

const { width } = Dimensions.get("window");
const COLUMN_WIDTH = (width - 50) / 2;

const CATEGORIES = ["All", "Popular", "New", "Downloaded"];
const ART_STYLES = [
	{
		id: "1",
		name: "Cyberpunk",
		genre: "Futuristic",
		category: "Popular",
		image: "https://picsum.photos/id/103/400/400",
	},
	{
		id: "2",
		name: "Oil Painting",
		genre: "Classic",
		category: "Popular",
		image: "https://picsum.photos/id/1043/400/400",
	},
	{
		id: "3",
		name: "Pencil Sketch",
		genre: "Monochrome",
		category: "New",
		image: "https://picsum.photos/id/1062/400/400",
	},
	{
		id: "4",
		name: "Watercolor",
		genre: "Abstract",
		category: "Downloaded",
		image: "https://picsum.photos/id/1081/400/400",
	},
	{
		id: "5",
		name: "Pop Art",
		genre: "Modern",
		category: "New",
		image: "https://picsum.photos/id/158/400/400",
	},
	{
		id: "6",
		name: "Mosaic",
		genre: "Texture",
		category: "New",
		comingSoon: true,
	},
];

export default function StyleSelection() {
	const [activeCategory, setActiveCategory] = useState("All");
	const [searchQuery, setSearchQuery] = useState("");

	// Functional logic for filtering the grid
	const filteredStyles = useMemo(() => {
		return ART_STYLES.filter((style) => {
			const matchesSearch = style.name
				.toLowerCase()
				.includes(searchQuery.toLowerCase());
			const matchesCategory =
				activeCategory === "All" || style.category === activeCategory;
			return matchesSearch && matchesCategory;
		});
	}, [searchQuery, activeCategory]);

	return (
		<SafeAreaView style={styles.container}>
			<View style={styles.header}>
				<Text style={styles.headerTitle}>Style Explorer</Text>
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={styles.scrollContent}
			>
				<Text style={styles.pageTitle}>Choose Your Style</Text>
				<Text style={styles.pageSubtitle}>
					Transform your photos into masterpieces using AI-powered
					artist profiles.
				</Text>

				{/* Enhanced Info Box with Icons */}
				<View style={styles.infoBox}>
					<InfoItem
						icon={<Sparkles size={16} color="#7B61FF" />}
						label="AI Curated"
					/>
					<InfoItem
						icon={<Eye size={16} color="#7B61FF" />}
						label="Live Preview"
					/>
					<InfoItem
						icon={<Download size={16} color="#7B61FF" />}
						label="Offline Use"
					/>
				</View>

				{/* Search Bar */}
				<View style={styles.searchContainer}>
					<Search size={20} color="#8E8E93" />
					<TextInput
						placeholder="Search styles..."
						style={styles.searchInput}
						value={searchQuery}
						onChangeText={setSearchQuery}
						placeholderTextColor="#8E8E93"
					/>
				</View>

				{/* Category Pills */}
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					style={styles.categoryScroll}
				>
					{CATEGORIES.map((cat) => (
						<TouchableOpacity
							key={cat}
							onPress={() => setActiveCategory(cat)}
							style={[
								styles.pill,
								activeCategory === cat && styles.activePill,
							]}
						>
							<Text
								style={[
									styles.pillText,
									activeCategory === cat &&
										styles.activePillText,
								]}
							>
								{cat}
							</Text>
						</TouchableOpacity>
					))}
				</ScrollView>

				{/* Styles Grid */}
				<View style={styles.grid}>
					{filteredStyles.length > 0 ? (
						filteredStyles.map((style) => (
							<TouchableOpacity
								key={style.id}
								style={styles.styleCard}
								activeOpacity={0.9}
							>
								{style.comingSoon ? (
									<View
										style={[
											styles.styleImage,
											styles.comingSoonBg,
										]}
									>
										<Text style={styles.comingSoonText}>
											COMING SOON
										</Text>
									</View>
								) : (
									<Image
										source={{ uri: style.image }}
										style={styles.styleImage}
									/>
								)}
								<View style={styles.cardInfo}>
									<Text style={styles.styleName}>
										{style.name}
									</Text>
									<Text style={styles.styleGenre}>
										{style.genre}
									</Text>
								</View>
							</TouchableOpacity>
						))
					) : (
						<View style={styles.emptyState}>
							<Text style={styles.emptyStateText}>
								No styles found matching &quot;{searchQuery}
								&quot;
							</Text>
						</View>
					)}
				</View>

				{/* FAQ Section */}
				<View style={styles.faqSection}>
					<View style={styles.faqHeaderRow}>
						<HelpCircle size={22} color="#1C1C1E" />
						<Text style={styles.faqHeader}>Help & Tips</Text>
					</View>
					<FaqItem
						question="How do I download a new style?"
						answer="Tap on any style. If it's not in your library, the download will begin automatically."
					/>
					<FaqItem
						question="Can I combine styles?"
						answer="Currently, ArtLens applies one primary style per image for the best resolution results."
					/>
				</View>
			</ScrollView>
		</SafeAreaView>
	);
}

const InfoItem = ({
	icon,
	label,
}: {
	icon: React.ReactNode;
	label: string;
}) => (
	<View style={styles.infoItem}>
		{icon}
		<Text style={styles.infoText}>{label}</Text>
	</View>
);

const FaqItem = ({
	question,
	answer,
}: {
	question: string;
	answer: string;
}) => (
	<View style={styles.faqItem}>
		<Text style={styles.faqQuestion}>{question}</Text>
		<Text style={styles.faqAnswer}>{answer}</Text>
	</View>
);

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "#FFFFFF" },
	header: {
		height: 60,
		justifyContent: "center",
		alignItems: "center",
		borderBottomWidth: 1,
		borderBottomColor: "#F2F2F7",
	},
	headerTitle: { fontSize: 17, fontWeight: "700", color: "#1C1C1E" },
	scrollContent: { padding: 20, paddingBottom: 40 },
	pageTitle: {
		fontSize: 32,
		fontWeight: "800",
		color: "#1C1C1E",
		marginBottom: 8,
		letterSpacing: -0.5,
	},
	pageSubtitle: {
		fontSize: 16,
		color: "#8E8E93",
		marginBottom: 24,
		lineHeight: 22,
	},
	infoBox: {
		flexDirection: "row",
		backgroundColor: "#F8F3FF",
		borderRadius: 16,
		padding: 16,
		marginBottom: 24,
		justifyContent: "space-around",
	},
	infoItem: { alignItems: "center", gap: 6 },
	infoText: { fontSize: 11, fontWeight: "600", color: "#7B61FF" },
	searchContainer: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#F2F2F7",
		borderRadius: 12,
		paddingHorizontal: 12,
		height: 48,
		marginBottom: 20,
	},
	searchInput: { flex: 1, fontSize: 16, marginLeft: 8, color: "#1C1C1E" },
	categoryScroll: { marginBottom: 24 },
	pill: {
		paddingHorizontal: 18,
		paddingVertical: 10,
		borderRadius: 25,
		backgroundColor: "#F2F2F7",
		marginRight: 10,
	},
	activePill: { backgroundColor: "#7B61FF" },
	pillText: { fontSize: 14, color: "#8E8E93", fontWeight: "600" },
	activePillText: { color: "#FFF" },
	grid: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "space-between",
	},
	styleCard: {
		width: COLUMN_WIDTH,
		backgroundColor: "#FFF",
		borderRadius: 16,
		marginBottom: 20,
		...Platform.select({
			ios: {
				shadowColor: "#000",
				shadowOffset: { width: 0, height: 4 },
				shadowOpacity: 0.1,
				shadowRadius: 8,
			},
			android: { elevation: 4 },
		}),
	},
	styleImage: {
		width: "100%",
		height: COLUMN_WIDTH,
		borderTopLeftRadius: 16,
		borderTopRightRadius: 16,
	},
	comingSoonBg: {
		backgroundColor: "#1C1C1E",
		justifyContent: "center",
		alignItems: "center",
	},
	comingSoonText: {
		color: "#FFF",
		fontWeight: "900",
		fontSize: 12,
		letterSpacing: 1,
	},
	cardInfo: { padding: 12 },
	styleName: { fontSize: 16, fontWeight: "700", color: "#1C1C1E" },
	styleGenre: { fontSize: 12, color: "#8E8E93", marginTop: 2 },
	emptyState: { width: "100%", paddingVertical: 40, alignItems: "center" },
	emptyStateText: { color: "#AEAEB2", fontSize: 16 },
	faqSection: {
		marginTop: 20,
		paddingTop: 30,
		borderTopWidth: 1,
		borderTopColor: "#F2F2F7",
	},
	faqHeaderRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		marginBottom: 20,
	},
	faqHeader: { fontSize: 20, fontWeight: "800", color: "#1C1C1E" },
	faqItem: { marginBottom: 24 },
	faqQuestion: {
		fontSize: 16,
		fontWeight: "700",
		color: "#1C1C1E",
		marginBottom: 6,
	},
	faqAnswer: { fontSize: 14, color: "#8E8E93", lineHeight: 20 },
});
