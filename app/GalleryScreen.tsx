import { ChevronDown, MoreHorizontal, Sparkles } from "lucide-react-native";
import React from "react";
import {
	Dimensions,
	Image,
	ScrollView,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
} from "react-native";

const { width } = Dimensions.get("window");
const COLUMN_WIDTH = (width - 50) / 2;

const ARTWORKS = [
	{
		id: "1",
		title: "Smoke Blast",
		time: "2 mins ago",
		image: "https://picsum.photos/id/1015/400/600",
	},
	{
		id: "2",
		title: "Garden Walk",
		time: "Yesterday",
		image: "https://picsum.photos/id/1021/400/600",
	},
	{
		id: "3",
		title: "Abstract City",
		time: "Nov 12",
		image: "https://picsum.photos/id/1024/400/600",
	},
	{
		id: "4",
		title: "Pencil Portrait",
		time: "Nov 10",
		image: "https://picsum.photos/id/1027/400/600",
	},
	{
		id: "5",
		title: "Cyber Night",
		time: "Nov 08",
		image: "https://picsum.photos/id/1039/400/600",
	},
	{
		id: "6",
		title: "Watercolor Flora",
		time: "Nov 05",
		image: "https://picsum.photos/id/1043/400/600",
	},
];

export default function GalleryScreen() {
	return (
		<View style={styles.container}>
			{/* Header */}
			<View style={styles.header}>
				<View>
					<Text style={styles.headerTitle}>My Gallery</Text>
					<Text style={styles.headerSubtitle}>24 Artworks Saved</Text>
				</View>
				<View style={styles.profileCircle} />
			</View>

			<ScrollView
				contentContainerStyle={styles.scrollContent}
				showsVerticalScrollIndicator={false}
			>
				{/* Statistics Row */}
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					style={styles.statsRow}
				>
					<StatPill label="Total" value="24" />
					<StatPill label="Favorite" value="Cyberpunk" />
					<StatPill label="This Week" value="5" />
				</ScrollView>

				{/* Filter Bar */}
				<View style={styles.filterBar}>
					<TouchableOpacity style={styles.filterDropdown}>
						<Text style={styles.filterText}>All Styles</Text>
						<ChevronDown size={16} color="#1C1C1E" />
					</TouchableOpacity>
					<TouchableOpacity style={styles.filterDropdown}>
						<Text style={styles.filterText}>Date</Text>
						<ChevronDown size={16} color="#1C1C1E" />
					</TouchableOpacity>
				</View>

				{/* Art Grid */}
				<View style={styles.grid}>
					{ARTWORKS.map((art) => (
						<TouchableOpacity key={art.id} style={styles.artCard}>
							<Image
								source={{ uri: art.image }}
								style={styles.artImage}
							/>
							<View style={styles.artOverlay}>
								<Text style={styles.artTimeText}>
									{art.time}
								</Text>
								<MoreHorizontal size={20} color="#FFF" />
							</View>
						</TouchableOpacity>
					))}
				</View>

				{/* Quick Tips Section */}
				<Text style={styles.sectionTitle}>Quick Tips</Text>

				<TipCard
					question="Where are my photos saved?"
					answer="All artworks are saved locally on your device in high resolution."
				/>

				<TipCard
					question="Can I re-edit an artwork?"
					answer="Yes, tap any image and select 'Edit' to apply new styles."
				/>

				{/* Floating Action-style Button */}
				<TouchableOpacity style={styles.transformBtn}>
					<Sparkles size={20} color="#FFF" />
					<Text style={styles.transformBtnText}>
						Transform Another Photo
					</Text>
				</TouchableOpacity>
			</ScrollView>
		</View>
	);
}

// Helper Components
const StatPill = ({ label, value }: { label: string; value: string }) => (
	<View style={styles.statPill}>
		<Text style={styles.statLabel}>{label}: </Text>
		<Text style={styles.statValue}>{value}</Text>
	</View>
);

const TipCard = ({
	question,
	answer,
}: {
	question: string;
	answer: string;
}) => (
	<View style={styles.tipCard}>
		<Text style={styles.tipQuestion}>{question}</Text>
		<Text style={styles.tipAnswer}>{answer}</Text>
	</View>
);

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "#F8F9FB" },
	header: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		padding: 20,
		backgroundColor: "#FFF",
		borderBottomWidth: 1,
		borderBottomColor: "#F2F2F7",
	},
	headerTitle: { fontSize: 22, fontWeight: "800", color: "#1C1C1E" },
	headerSubtitle: { fontSize: 13, color: "#8E8E93", marginTop: 2 },
	profileCircle: {
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: "#F2F2F7",
	},

	scrollContent: { padding: 15, paddingBottom: 100 },

	statsRow: { marginBottom: 20 },
	statPill: {
		flexDirection: "row",
		backgroundColor: "#FFF",
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 20,
		marginRight: 10,
		borderWidth: 1,
		borderColor: "#F2F2F7",
	},
	statLabel: { color: "#8E8E93", fontSize: 14 },
	statValue: { color: "#1C1C1E", fontWeight: "700", fontSize: 14 },

	filterBar: { flexDirection: "row", gap: 10, marginBottom: 20 },
	filterDropdown: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#F2F2F7",
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 8,
		gap: 4,
	},
	filterText: { fontSize: 14, fontWeight: "600", color: "#1C1C1E" },

	grid: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "space-between",
	},
	artCard: {
		width: COLUMN_WIDTH,
		height: 220,
		borderRadius: 12,
		marginBottom: 15,
		overflow: "hidden",
	},
	artImage: { width: "100%", height: "100%" },
	artOverlay: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		padding: 10,
		flexDirection: "row",
		justifyContent: "space-between",
		backgroundColor: "rgba(0,0,0,0.2)",
	},
	artTimeText: { color: "#FFF", fontSize: 12, fontWeight: "600" },

	sectionTitle: {
		fontSize: 18,
		fontWeight: "800",
		color: "#1C1C1E",
		marginTop: 20,
		marginBottom: 15,
	},
	tipCard: {
		backgroundColor: "#FFF",
		padding: 16,
		borderRadius: 12,
		marginBottom: 12,
		borderWidth: 1,
		borderColor: "#F2F2F7",
	},
	tipQuestion: {
		fontSize: 15,
		fontWeight: "700",
		color: "#1C1C1E",
		marginBottom: 6,
	},
	tipAnswer: { fontSize: 13, color: "#8E8E93", lineHeight: 18 },

	transformBtn: {
		backgroundColor: "#7B61FF",
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		padding: 16,
		borderRadius: 30,
		marginTop: 20,
		gap: 8,
		shadowColor: "#7B61FF",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 8,
		elevation: 5,
	},
	transformBtnText: { color: "#FFF", fontSize: 16, fontWeight: "700" },

	bottomNav: {
		position: "absolute",
		bottom: 0,
		flexDirection: "row",
		backgroundColor: "#FFF",
		paddingVertical: 12,
		borderTopWidth: 1,
		borderTopColor: "#F2F2F7",
		justifyContent: "space-around",
		width: "100%",
	},
	navItem: { alignItems: "center" },
	navText: { fontSize: 10, color: "#A0A0A0", marginTop: 4 },
});
