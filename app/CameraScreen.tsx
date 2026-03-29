import { BlurView } from "expo-blur";
import { router } from "expo-router";
import {
	Camera,
	useCameraDevice,
	useCameraPermission,
} from "react-native-vision-camera";
import { DownloadCloud, Layers, RotateCw, X, Zap } from "lucide-react-native";
import React, { useState } from "react";
import {
	Image,
	ScrollView,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
	ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { COLORS } from "@/utils/constants";

// Mocking the model data structure based on your UC-6 requirement
const FILTERS = [
	{
		id: "1",
		name: "Impression",
		size: "18MB",
		isDownloaded: true,
		image: "https://picsum.photos/id/10/200",
	},
	{
		id: "2",
		name: "Cyberpunk",
		size: "22MB",
		isDownloaded: false,
		image: "https://picsum.photos/id/1044/200",
	},
	{
		id: "3",
		name: "Oil Paint",
		size: "19MB",
		isDownloaded: false,
		image: "https://picsum.photos/id/1025/200",
	},
];

export default function CameraScreen() {
	const insets = useSafeAreaInsets();
	const { hasPermission, requestPermission } = useCameraPermission();
	const [facing, setFacing] = useState<"front" | "back">("back");
	const device = useCameraDevice(facing);

	// ML State Management
	const [activeFilter, setActiveFilter] = useState("1");
	const [isModelLoading, setIsModelLoading] = useState(false);
	const [isDownloading, setIsDownloading] = useState(false);

	// Handle Filter Selection & Model Loading (NFR-P2)
	const handleFilterSelect = async (filter: (typeof FILTERS)[0]) => {
		if (filter.id === activeFilter) return;

		if (!filter.isDownloaded) {
			// Trigger UC-6: Download Model
			setIsDownloading(true);
			// MOCK DOWNLOAD DELAY
			setTimeout(() => {
				setIsDownloading(false);
				filter.isDownloaded = true; // Update local state
				loadModelToRAM(filter.id);
			}, 3000);
			return;
		}
		loadModelToRAM(filter.id);
	};

	const loadModelToRAM = (filterId: string) => {
		setIsModelLoading(true);
		setActiveFilter(filterId);
		// MOCK RAM LOAD DELAY (1-3 seconds)
		setTimeout(() => setIsModelLoading(false), 1500);
	};

	if (!hasPermission) {
		return (
			<View style={styles.center}>
				<Zap
					size={48}
					color={COLORS.primary}
					style={{ marginBottom: 20 }}
				/>
				<Text style={styles.whiteText}>
					Camera access is required for real-time AI art.
				</Text>
				<TouchableOpacity
					style={styles.permissionBtn}
					onPress={requestPermission}
				>
					<Text style={styles.permissionBtnText}>Enable Camera</Text>
				</TouchableOpacity>
			</View>
		);
	}

	if (device == null) return <View style={styles.blackBg} />;

	return (
		<View style={styles.container}>
			<Camera
				style={styles.absoluteFill}
				device={device}
				isActive={true}
				// frameProcessor={myStyleTransferFrameProcessor} // <-- You will plug your ML model here later
			/>

			{/* Loading Overlays */}
			{(isModelLoading || isDownloading) && (
				<View style={styles.loadingOverlay}>
					<BlurView
						intensity={50}
						tint="dark"
						style={styles.loadingBlur}
					>
						<ActivityIndicator
							size="large"
							color={COLORS.primary}
						/>
						<Text style={styles.loadingText}>
							{isDownloading
								? "Downloading Model (approx 20MB)..."
								: "Loading Model to RAM..."}
						</Text>
					</BlurView>
				</View>
			)}

			{/* Top Controls Overlay */}
			<View style={[styles.topOverlay, { paddingTop: insets.top || 20 }]}>
				<TouchableOpacity
					style={styles.glassBtn}
					onPress={() => router.back()}
				>
					<X color={COLORS.white} size={22} />
				</TouchableOpacity>

				<BlurView intensity={30} tint="dark" style={styles.modeBadge}>
					<View style={styles.activeDot} />
					<Text style={styles.modeText}>AI LIVE PREVIEW</Text>
				</BlurView>

				<TouchableOpacity
					style={styles.glassBtn}
					onPress={() =>
						setFacing(facing === "back" ? "front" : "back")
					}
				>
					<RotateCw color={COLORS.white} size={22} />
				</TouchableOpacity>
			</View>

			{/* Bottom UI Area */}
			<View
				style={[
					styles.bottomArea,
					{ paddingBottom: insets.bottom || 40 },
				]}
			>
				{/* Filter Selector */}
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					contentContainerStyle={styles.filterScroll}
				>
					{FILTERS.map((f) => (
						<TouchableOpacity
							key={f.id}
							onPress={() => handleFilterSelect(f)}
							style={styles.filterItem}
						>
							<View
								style={[
									styles.filterRing,
									activeFilter === f.id && {
										borderColor: COLORS.primary,
									},
								]}
							>
								<Image
									source={{ uri: f.image }}
									style={styles.filterImg}
								/>
								{/* Download Icon Overlay for un-downloaded models */}
								{!f.isDownloaded && (
									<View style={styles.downloadBadge}>
										<DownloadCloud
											size={16}
											color={COLORS.white}
										/>
									</View>
								)}
							</View>
							<Text
								style={[
									styles.filterLabel,
									activeFilter === f.id && {
										color: COLORS.primary,
									},
								]}
							>
								{f.name}
							</Text>
						</TouchableOpacity>
					))}
				</ScrollView>

				{/* Main Actions */}
				<View style={styles.actionRow}>
					<TouchableOpacity
						style={styles.sideAction}
						onPress={() => router.push("/BackgroundGenerator")}
					>
						<BlurView
							intensity={20}
							tint="light"
							style={styles.sideIconBox}
						>
							<Layers color={COLORS.white} size={24} />
						</BlurView>
						<Text style={styles.sideText}>BG Gen</Text>
					</TouchableOpacity>

					{/* Shutter Button */}
					<TouchableOpacity
						style={styles.shutterOuter}
						activeOpacity={0.8}
						onPress={() => router.push("/EditCanvas")}
					>
						<View style={styles.shutterInner} />
					</TouchableOpacity>

					<TouchableOpacity
						style={styles.sideAction}
						onPress={() => router.push("/GalleryScreen")}
					>
						<Image
							source={{ uri: "https://picsum.photos/id/64/100" }}
							style={styles.galleryPreview}
						/>
						<Text style={styles.sideText}>Gallery</Text>
					</TouchableOpacity>
				</View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	// ... (Keep your existing styles) ...
	container: { flex: 1, backgroundColor: COLORS.black },
	absoluteFill: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
	},
	blackBg: { flex: 1, backgroundColor: COLORS.black },
	center: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: COLORS.black,
		padding: 40,
	},
	whiteText: {
		color: COLORS.white,
		fontSize: 16,
		textAlign: "center",
		marginBottom: 30,
		opacity: 0.8,
	},
	permissionBtn: {
		backgroundColor: COLORS.primary,
		paddingHorizontal: 32,
		paddingVertical: 16,
		borderRadius: 30,
	},
	permissionBtnText: { color: COLORS.white, fontWeight: "800", fontSize: 16 },
	// Overlays
	loadingOverlay: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "center",
		alignItems: "center",
		zIndex: 10,
	},
	loadingBlur: {
		padding: 30,
		borderRadius: 20,
		alignItems: "center",
		overflow: "hidden",
	},
	loadingText: { color: COLORS.white, marginTop: 15, fontWeight: "600" },
	topOverlay: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		paddingHorizontal: 20,
		zIndex: 5,
	},
	glassBtn: {
		width: 48,
		height: 48,
		borderRadius: 24,
		backgroundColor: "rgba(255,255,255,0.15)",
		justifyContent: "center",
		alignItems: "center",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.2)",
	},
	modeBadge: {
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 25,
		overflow: "hidden",
		borderWidth: 1,
		borderColor: "rgba(255,255,255,0.1)",
	},
	activeDot: {
		width: 6,
		height: 6,
		borderRadius: 3,
		backgroundColor: "#00FF94",
		marginRight: 8,
	},
	modeText: {
		color: COLORS.white,
		fontSize: 11,
		fontWeight: "900",
		letterSpacing: 1,
	},
	// Bottom
	bottomArea: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		zIndex: 5,
	},
	filterScroll: { paddingHorizontal: 20, paddingBottom: 30 },
	filterItem: { alignItems: "center", marginRight: 20 },
	filterRing: {
		width: 66,
		height: 66,
		borderRadius: 33,
		borderWidth: 3,
		borderColor: "transparent",
		padding: 2,
		marginBottom: 8,
	},
	filterImg: { width: "100%", height: "100%", borderRadius: 30 },
	downloadBadge: {
		position: "absolute",
		bottom: 0,
		right: 0,
		backgroundColor: "rgba(0,0,0,0.6)",
		borderRadius: 12,
		padding: 4,
	},
	filterLabel: {
		color: COLORS.white,
		fontSize: 11,
		fontWeight: "600",
		opacity: 0.9,
	},
	actionRow: {
		flexDirection: "row",
		justifyContent: "space-evenly",
		alignItems: "center",
		paddingHorizontal: 20,
	},
	sideAction: { alignItems: "center", width: 70 },
	sideIconBox: {
		width: 50,
		height: 50,
		borderRadius: 16,
		justifyContent: "center",
		alignItems: "center",
		overflow: "hidden",
	},
	sideText: {
		color: COLORS.white,
		fontSize: 11,
		fontWeight: "700",
		marginTop: 8,
	},
	galleryPreview: {
		width: 50,
		height: 50,
		borderRadius: 16,
		borderWidth: 2,
		borderColor: COLORS.white,
	},
	shutterOuter: {
		width: 88,
		height: 88,
		borderRadius: 44,
		borderWidth: 5,
		borderColor: COLORS.white,
		justifyContent: "center",
		alignItems: "center",
	},
	shutterInner: {
		width: 68,
		height: 68,
		borderRadius: 34,
		backgroundColor: COLORS.white,
	},
});
