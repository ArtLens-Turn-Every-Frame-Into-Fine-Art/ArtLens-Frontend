import Slider from "@react-native-community/slider";
import { router } from "expo-router";
import {
	ChevronLeft,
	Image as ImageIcon,
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
	ActivityIndicator,
} from "react-native";

export default function EditCanvas() {
	const [intensity, setIntensity] = useState(0.75);
	const [prompt, setPrompt] = useState("");
	const [isGenerating, setIsGenerating] = useState(false);

	// This handles the async call to your Node.js backend -> Stable Diffusion
	const handleGenerateBackground = () => {
		if (!prompt) return;
		setIsGenerating(true);

		// MOCK API CALL (10-20 seconds per NFR-P3)
		setTimeout(() => {
			setIsGenerating(false);
			// In reality, you'd fetch the new image URL here and update the canvas
			alert("Background generated successfully!");
		}, 10000);
	};

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : "height"}
			style={styles.container}
		>
			<View style={styles.header}>
				<TouchableOpacity
					onPress={() => router.back()}
					style={styles.backBtn}
				>
					<ChevronLeft color="#1A1A1A" size={28} />
				</TouchableOpacity>
				<Text style={styles.headerTitle}>Edit Canvas</Text>
				<TouchableOpacity
					onPress={() => router.push("/ExportScreen")}
					disabled={isGenerating}
				>
					<Text
						style={[
							styles.saveText,
							isGenerating && { opacity: 0.5 },
						]}
					>
						Save
					</Text>
				</TouchableOpacity>
			</View>

			<View style={styles.canvasContainer}>
				<Image
					source={{
						uri: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?q=80&w=1000",
					}}
					style={styles.mainImage}
					resizeMode="contain"
				/>

				{/* Overlay for when background is generating */}
				{isGenerating && (
					<View style={styles.generatingOverlay}>
						<ActivityIndicator size="large" color="#7B61FF" />
						<Text style={styles.generatingText}>
							AI is painting your background...
						</Text>
						<Text style={styles.generatingSubtext}>
							You can navigate away, we&apos;ll notify you when
							it&apos;s done.
						</Text>
					</View>
				)}
			</View>

			<View style={styles.controlsSection}>
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
						placeholder="e.g. A cyberpunk city at night..."
						placeholderTextColor="#8E8E93"
						onSubmitEditing={handleGenerateBackground}
					/>
					{isGenerating ? (
						<ActivityIndicator size="small" color="#7B61FF" />
					) : (
						<TouchableOpacity onPress={handleGenerateBackground}>
							<Text style={styles.generateBtnText}>Gen</Text>
						</TouchableOpacity>
					)}
				</View>

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
						<Text style={styles.backgroundBtnText}>BG Gallery</Text>
					</TouchableOpacity>
				</View>
			</View>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	// ... Keep existing styles ...
	container: { flex: 1, backgroundColor: "#FFF" },
	header: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingHorizontal: 16,
		height: 60,
		backgroundColor: "#FFF",
	},
	backBtn: { padding: 4 },
	headerTitle: { fontSize: 17, fontWeight: "700", color: "#1A1A1A" },
	saveText: { fontSize: 16, fontWeight: "700", color: "#7B61FF" },
	canvasContainer: {
		flex: 1,
		backgroundColor: "#F2F2F7",
		justifyContent: "center",
		alignItems: "center",
	},
	mainImage: { width: "95%", height: "95%" },
	generatingOverlay: {
		position: "absolute",
		backgroundColor: "rgba(255,255,255,0.85)",
		padding: 20,
		borderRadius: 16,
		alignItems: "center",
	},
	generatingText: {
		color: "#1A1A1A",
		fontWeight: "700",
		marginTop: 12,
		fontSize: 16,
	},
	generatingSubtext: {
		color: "#8E8E93",
		fontSize: 12,
		marginTop: 4,
		textAlign: "center",
	},
	controlsSection: {
		padding: 20,
		backgroundColor: "#FFF",
		borderTopLeftRadius: 24,
		borderTopRightRadius: 24,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: -4 },
		shadowOpacity: 0.05,
		shadowRadius: 10,
		elevation: 10,
	},
	sliderContainer: { marginBottom: 25 },
	sliderLabelRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 10,
	},
	sliderLabel: { color: "#1C1C1E", fontSize: 14, fontWeight: "600" },
	sliderValue: { color: "#7B61FF", fontSize: 14, fontWeight: "700" },
	slider: { width: "100%", height: 40 },
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
	inputIcon: { marginRight: 10 },
	textInput: { flex: 1, color: "#1C1C1E", fontSize: 15, fontWeight: "500" },
	generateBtnText: { color: "#7B61FF", fontWeight: "700", fontSize: 15 },
	footer: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingBottom: 10,
	},
	historyActions: { flexDirection: "row", gap: 12 },
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
	backgroundBtnText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});
