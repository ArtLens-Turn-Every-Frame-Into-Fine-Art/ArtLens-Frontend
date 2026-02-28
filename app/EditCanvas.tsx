import Slider from "@react-native-community/slider";
import { router } from "expo-router";
import {
	ChevronLeft,
	Image as ImageIcon,
	Pencil,
	Redo2,
	Undo2,
	Wand2,
} from "lucide-react-native";
import React, { useState } from "react";
import {
	Image,
	KeyboardAvoidingView,
	Platform,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";

export default function EditCanvas() {
	const [intensity, setIntensity] = useState(0.75);
	const [prompt, setPrompt] = useState("pencil sketch, detailed shading...");

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : "height"}
			style={styles.container}
		>
			{/* Header */}
			<View style={styles.header}>
				<TouchableOpacity
					onPress={() => router.back()}
					style={styles.backBtn}
				>
					<ChevronLeft color="#1A1A1A" size={28} />
				</TouchableOpacity>
				<Text style={styles.headerTitle}>Edit Canvas</Text>
				<TouchableOpacity onPress={() => router.push("/ExportScreen")}>
					<Text style={styles.saveText}>Save</Text>
				</TouchableOpacity>
			</View>

			{/* Main Canvas Area */}
			<View style={styles.canvasContainer}>
				<Image
					source={{
						uri: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?q=80&w=1000",
					}}
					style={styles.mainImage}
					resizeMode="contain"
				/>
			</View>

			{/* Bottom Controls Area */}
			<View style={styles.controlsSection}>
				{/* Share Banner */}
				<TouchableOpacity
					style={styles.shareBanner}
					onPress={() => router.push("/ExportScreen")}
				>
					<View>
						<Text style={styles.shareText}>Ready to share?</Text>
						<Text style={styles.shareSubtext}>
							Export in high resolution
						</Text>
					</View>
					<View style={styles.shareToggle}>
						<Text style={styles.shareToggleLabel}>Export</Text>
					</View>
				</TouchableOpacity>

				{/* Intensity Slider */}
				<View style={styles.sliderContainer}>
					<View style={styles.sliderLabelRow}>
						<Text style={styles.sliderLabel}>Style Intensity</Text>
						<Text style={styles.sliderValue}>
							{Math.round(intensity * 100)}%
						</Text>
					</View>
					<Slider
						style={styles.slider}
						minimumValue={0}
						maximumValue={1}
						value={intensity}
						onValueChange={setIntensity}
						minimumTrackTintColor="#7B61FF"
						maximumTrackTintColor="#F2F2F7"
						thumbTintColor="#7B61FF"
					/>
				</View>

				{/* AI Prompt Input */}
				<View style={styles.inputWrapper}>
					<Wand2 size={20} color="#7B61FF" style={styles.inputIcon} />
					<TextInput
						style={styles.textInput}
						value={prompt}
						onChangeText={setPrompt}
						placeholderTextColor="#8E8E93"
					/>
					<Pencil size={18} color="#C7C7CC" />
				</View>

				{/* Footer Actions */}
				<View style={styles.footer}>
					<View style={styles.historyActions}>
						<TouchableOpacity style={styles.circleBtn}>
							<Undo2 size={22} color="#1C1C1E" />
						</TouchableOpacity>
						<TouchableOpacity style={styles.circleBtn}>
							<Redo2 size={22} color="#1C1C1E" />
						</TouchableOpacity>
					</View>

					<TouchableOpacity
						style={styles.backgroundBtn}
						onPress={() => router.push("/BackgroundGenerator")}
					>
						<ImageIcon size={20} color="#FFF" />
						<Text style={styles.backgroundBtnText}>BG Gen</Text>
					</TouchableOpacity>
				</View>
			</View>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFF",
	},
	header: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingHorizontal: 16,
		height: 60,
		backgroundColor: "#FFF",
	},
	backBtn: { padding: 4 },
	headerTitle: {
		fontSize: 17,
		fontWeight: "700",
		color: "#1A1A1A",
	},
	saveText: {
		fontSize: 16,
		fontWeight: "700",
		color: "#7B61FF",
	},
	canvasContainer: {
		flex: 1,
		backgroundColor: "#F2F2F7", // Slightly lighter for contrast
		justifyContent: "center",
		alignItems: "center",
	},
	mainImage: {
		width: "95%",
		height: "95%",
	},
	controlsSection: {
		padding: 20,
		backgroundColor: "#FFF",
		borderTopLeftRadius: 24,
		borderTopRightRadius: 24,
		// Elevation/Shadow to separate from canvas
		shadowColor: "#000",
		shadowOffset: { width: 0, height: -4 },
		shadowOpacity: 0.05,
		shadowRadius: 10,
		elevation: 10,
	},
	shareBanner: {
		backgroundColor: "#7B61FF",
		borderRadius: 16,
		padding: 16,
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		marginBottom: 25,
	},
	shareText: {
		color: "#FFF",
		fontSize: 15,
		fontWeight: "700",
	},
	shareSubtext: {
		color: "rgba(255,255,255,0.8)",
		fontSize: 12,
		marginTop: 2,
	},
	shareToggle: {
		backgroundColor: "#FFF",
		borderRadius: 20,
		paddingHorizontal: 16,
		paddingVertical: 8,
	},
	shareToggleLabel: {
		color: "#7B61FF",
		fontSize: 13,
		fontWeight: "800",
	},
	sliderContainer: {
		marginBottom: 25,
	},
	sliderLabelRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 10,
	},
	sliderLabel: {
		color: "#1C1C1E",
		fontSize: 14,
		fontWeight: "600",
	},
	sliderValue: {
		color: "#7B61FF",
		fontSize: 14,
		fontWeight: "700",
	},
	slider: {
		width: "100%",
		height: 40,
	},
	inputWrapper: {
		backgroundColor: "#F8F9FA",
		borderRadius: 12,
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 15,
		height: 54,
		marginBottom: 25,
		borderWidth: 1,
		borderColor: "#E5E5EA",
	},
	inputIcon: {
		marginRight: 10,
	},
	textInput: {
		flex: 1,
		color: "#1C1C1E",
		fontSize: 15,
		fontWeight: "500",
	},
	footer: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingBottom: 10,
	},
	historyActions: {
		flexDirection: "row",
		gap: 12,
	},
	circleBtn: {
		width: 50,
		height: 50,
		borderRadius: 25,
		backgroundColor: "#F2F2F7",
		justifyContent: "center",
		alignItems: "center",
	},
	backgroundBtn: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#1C1C1E",
		paddingHorizontal: 24,
		height: 50,
		borderRadius: 25,
		gap: 8,
	},
	backgroundBtnText: {
		color: "#FFF",
		fontWeight: "700",
		fontSize: 15,
	},
});
