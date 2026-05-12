import React, { useEffect, useRef, useState, useCallback } from "react";
import {
	View,
	Text,
	StyleSheet,
	ActivityIndicator,
	TouchableOpacity,
	Alert,
} from "react-native";
import Slider from "@react-native-community/slider";
import {
	Canvas,
	Image as SkiaImage,
	useCanvasRef,
} from "@shopify/react-native-skia";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { getLocalMeta } from "../services/ModelManager";
import { loadModel } from "../services/InferenceEngine";
import { alphaBlend, tensorToRGBA, makeSkiaImage } from "../utils/tensorUtils";

const MODEL_SIZE = 256;

interface RouteParams {
	photoPath: string;
	modelId: string;
	modelVersion: number;
}

export default function RefineScreen({ route, navigation }: any) {
	const { photoPath, modelId, modelVersion } = route.params as RouteParams;

	const canvasRef = useCanvasRef();
	const originalRef = useRef<Float32Array | null>(null); // Raw frame tensor
	const stylizedRef = useRef<Float32Array | null>(null); // Model output tensor
	const skiaImageRef = useRef<ReturnType<typeof makeSkiaImage> | null>(null);

	const [intensity, setIntensity] = useState(1.0);
	const [isProcessing, setIsProcessing] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// ── Blend & render ────────────────────────────────────────────────────────
	const renderBlended = useCallback(
		(value: number) => {
			if (!originalRef.current || !stylizedRef.current) return;

			const blended = alphaBlend(
				originalRef.current,
				stylizedRef.current,
				value,
			);
			const rgba = tensorToRGBA(blended);
			skiaImageRef.current = makeSkiaImage(rgba);
			canvasRef.current?.redraw();
		},
		[canvasRef],
	);

	// ── Load & run inference once on mount ───────────────────────────────────
	useEffect(() => {
		(async () => {
			try {
				// 1. Decode captured photo to float32 RGB [1, 256, 256, 3]
				const rawPixels = await decodeImageToTensor(photoPath);
				originalRef.current = rawPixels;

				// 2. Ensure model is loaded (may already be in memory from CameraScreen)
				const meta = getLocalMeta(modelId);
				if (!meta || meta.version !== modelVersion) {
					throw new Error(
						"Model metadata mismatch. Please re-download.",
					);
				}
				const model = await loadModel(meta);

				// 3. Run inference on full (resized) captured frame
				const [output] = model.runSync([
					rawPixels.buffer as any,
				]) as ArrayBuffer[];
				stylizedRef.current = new Float32Array(output);

				// 4. Render initial output at full intensity
				renderBlended(1.0);
				setIsProcessing(false);
			} catch (err: any) {
				setError(err.message);
				setIsProcessing(false);
			}
		})();
	}, [photoPath, modelId, modelVersion, renderBlended]);

	const handleSliderChange = useCallback(
		(value: number) => {
			setIntensity(value);
			renderBlended(value);
		},
		[renderBlended],
	);

	// ── Export ────────────────────────────────────────────────────────────────
	const handleSave = useCallback(async () => {
		if (!originalRef.current || !stylizedRef.current) return;

		setIsSaving(true);

		try {
			const permission = await MediaLibrary.requestPermissionsAsync();

			if (!permission.granted) {
				throw new Error(
					"Gallery permission denied. Please enable it in Settings.",
				);
			}

			const blended = alphaBlend(
				originalRef.current,
				stylizedRef.current,
				intensity,
			);

			const rgbaBytes = tensorToRGBA(blended);

			const tempPath = `${FileSystem.Paths.cache.uri}artlens_export_${Date.now()}.png`;

			await encodeTensorToPNG(rgbaBytes, tempPath);

			const asset = await MediaLibrary.createAssetAsync(tempPath);

			await MediaLibrary.createAlbumAsync("ArtLens", asset, false).catch(
				() => {},
			);

			Alert.alert(
				"Saved!",
				"Your artwork has been saved to your gallery.",
				[{ text: "Done", onPress: () => navigation.goBack() }],
			);
		} catch (err: any) {
			Alert.alert("Save Failed", err.message);
		} finally {
			setIsSaving(false);
		}
	}, [intensity, navigation]);

	// ── Render ────────────────────────────────────────────────────────────────
	if (isProcessing) {
		return (
			<View style={styles.center}>
				<ActivityIndicator size="large" color="#6C63FF" />
				<Text style={styles.hint}>Applying style…</Text>
			</View>
		);
	}

	if (error) {
		return (
			<View style={styles.center}>
				<Text style={styles.errorText}>{error}</Text>
				<TouchableOpacity onPress={() => navigation.goBack()}>
					<Text style={styles.backBtn}>Go Back</Text>
				</TouchableOpacity>
			</View>
		);
	}

	return (
		<View style={styles.container}>
			<Canvas ref={canvasRef} style={styles.canvas}>
				{skiaImageRef.current && (
					<SkiaImage
						image={skiaImageRef.current}
						x={0}
						y={0}
						width={MODEL_SIZE}
						height={MODEL_SIZE}
						fit="contain"
					/>
				)}
			</Canvas>

			<View style={styles.controls}>
				<Text style={styles.label}>Style Intensity</Text>
				<View style={styles.sliderRow}>
					<Text style={styles.sliderBound}>Original</Text>
					<Slider
						style={styles.slider}
						minimumValue={0}
						maximumValue={1}
						step={0.01}
						value={intensity}
						onValueChange={handleSliderChange}
						minimumTrackTintColor="#6C63FF"
						maximumTrackTintColor="#333"
						thumbTintColor="#6C63FF"
					/>
					<Text style={styles.sliderBound}>Stylized</Text>
				</View>

				<TouchableOpacity
					style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
					onPress={handleSave}
					disabled={isSaving}
				>
					{isSaving ? (
						<ActivityIndicator color="#fff" />
					) : (
						<Text style={styles.saveBtnText}>Save to Gallery</Text>
					)}
				</TouchableOpacity>
			</View>
		</View>
	);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function decodeImageToTensor(filePath: string): Promise<Float32Array> {
	// ... (native image decode logic)
	// Returns Float32Array of length 256*256*3 in [0.0, 1.0]
	throw new Error(
		`Implement decodeImageToTensor with Skia or a TurboModule. File: ${filePath}`,
	);
}

async function encodeTensorToPNG(
	rgbaBuffer: Uint8ClampedArray,
	destPath: string,
): Promise<void> {
	const { Skia, ImageFormat, AlphaType, ColorType } =
		await import("@shopify/react-native-skia");
	const data = Skia.Data.fromBytes(new Uint8Array(rgbaBuffer.buffer));
	const image = Skia.Image.MakeImage(
		{
			width: MODEL_SIZE,
			height: MODEL_SIZE,
			alphaType: AlphaType.Opaque,
			colorType: ColorType.RGBA_8888,
		},
		data,
		MODEL_SIZE * 4,
	);

	if (!image) throw new Error("Failed to create Skia image");

	// Leverage Skia's base64 encoding instead of Node.js Buffer
	const base64 = image.encodeToBase64(ImageFormat.PNG, 100);
	await FileSystem.writeAsStringAsync(destPath, base64, {
		encoding: "base64",
	});
}

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "#111" },
	center: { flex: 1, justifyContent: "center", alignItems: "center" },
	canvas: {
		width: MODEL_SIZE,
		height: MODEL_SIZE,
		alignSelf: "center",
		marginTop: 40,
	},
	controls: { padding: 24, gap: 12 },
	label: {
		color: "#fff",
		fontSize: 16,
		fontWeight: "600",
		textAlign: "center",
	},
	sliderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
	sliderBound: {
		color: "#888",
		fontSize: 11,
		width: 55,
		textAlign: "center",
	},
	slider: { flex: 1, height: 40 },
	saveBtn: {
		backgroundColor: "#6C63FF",
		borderRadius: 12,
		padding: 16,
		alignItems: "center",
	},
	saveBtnDisabled: { opacity: 0.5 },
	saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
	hint: { color: "#888", marginTop: 12 },
	errorText: { color: "#ff5555", textAlign: "center", margin: 24 },
	backBtn: { color: "#6C63FF", fontSize: 16, marginTop: 12 },
});
