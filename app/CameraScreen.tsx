import React, { useCallback, useEffect, useRef } from "react";
import {
	Alert,
	Platform,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
	useWindowDimensions,
} from "react-native";
import {
	Camera,
	useCameraDevice,
	useFrameProcessor,
} from "react-native-vision-camera";
import { useSharedValue, useRunOnJS } from "react-native-worklets-core";
import { useResizePlugin } from "vision-camera-resize-plugin";
import {
	Canvas,
	Image as SkiaImage,
	useCanvasRef,
} from "@shopify/react-native-skia";
import { useNavigation } from "@react-navigation/native";
import { getActiveModel } from "../services/InferenceEngine";
import { tensorToRGBA, makeSkiaImage } from "../utils/tensorUtils";
import { useModelStore } from "../stores/useModelStore";
import type { TensorflowModel } from "react-native-fast-tflite";

const MODEL_SIZE = 256;
const INFERENCE_INTERVAL_MS = 66; // ~15 FPS live preview

export default function CameraScreen() {
	const navigation = useNavigation<any>();
	const device = useCameraDevice("back");
	const { resize } = useResizePlugin();
	const canvasRef = useCanvasRef();
	const { width, height } = useWindowDimensions();

	const selectedModel = useModelStore((s) => s.selectedModel);
	const isLoadingModel = useModelStore((s) => s.isLoadingModel);

	// ── Worklet-accessible model reference ────────────────────────────────────
	//
	// WHY NOT getActiveModel() directly in the worklet?
	// ─────────────────────────────────────────────────
	// `activeModel` in InferenceEngine lives in the MAIN JS thread's module
	// scope. Frame processors run on a SEPARATE thread via react-native-
	// worklets-core. The worklet thread cannot read main-thread module-level
	// variables — they are in a different memory space. getActiveModel() will
	// always return null inside a 'worklet'.
	//
	// useSharedValue creates a JSI-level shared reference that IS readable
	// from both the main thread and any worklet thread simultaneously.
	//
	const modelSharedValue = useSharedValue<TensorflowModel | null>(null);

	// Sync the InferenceEngine singleton → shared value whenever loading
	// finishes or the selected model changes.
	useEffect(() => {
		if (!isLoadingModel) {
			modelSharedValue.value = getActiveModel();
		}
	}, [isLoadingModel, selectedModel, modelSharedValue]);

	// ── SkImage ref with safe disposal ────────────────────────────────────────
	//
	// WHY USE dispose()?
	// ──────────────────
	// SkImage objects hold GPU texture memory allocated on the native side.
	// Simply overwriting the ref leaves the old texture alive with no JS
	// reference pointing to it — it can never be GC'd. At 15 fps this
	// creates ~15 leaked GPU textures per second → OOM crash in ~60s.
	//
	const skiaImageRef = useRef<ReturnType<typeof makeSkiaImage> | null>(null);
	const lastInferenceMs = useSharedValue(0);

	// ── Render stylized frame on JS thread (called from worklet via runOnJS) ──
	const renderFrameJS = useRunOnJS(
		(rgba: Uint8ClampedArray) => {
			// Dispose old image BEFORE creating new one to free GPU memory.
			const prev = skiaImageRef.current;
			skiaImageRef.current = makeSkiaImage(rgba);
			prev?.dispose(); // safe: no-op if prev is null
			canvasRef.current?.redraw();
		},
		[canvasRef],
	);

	// ── Frame Processor (C++ JSI worklet — NOT on JS thread) ─────────────────
	const frameProcessor = useFrameProcessor(
		(frame) => {
			"worklet";

			// 1. Throttle to ~15 FPS to prevent thermal throttling
			const now = Date.now();
			if (now - lastInferenceMs.value < INFERENCE_INTERVAL_MS) return;
			lastInferenceMs.value = now;
			// NOTE: do NOT set lastInferenceMs again after inference —
			// that would compound the delay and reduce effective FPS.

			// 2. Get model from the worklet-accessible shared value.
			//    This is the ONLY safe way to read InferenceEngine state
			//    from a worklet. getActiveModel() would return null here.
			const model = modelSharedValue.value;
			if (!model) return;

			// 3. Resize frame to [256, 256] float32.
			//    vision-camera-resize-plugin returns a Float32Array wrapping
			//    a native-allocated buffer. Values are in [0.0, 255.0].
			const resized = resize(frame, {
				scale: { width: MODEL_SIZE, height: MODEL_SIZE },
				pixelFormat: "rgb",
				dataType: "float32",
				rotation: "0deg",
			});

			// Normalize [0,255] → [0.0,1.0] into a NEW Float32Array.
			// NEVER mutate `resized` in-place — it wraps a native buffer
			// and mutation causes undefined behaviour / frame corruption.
			const input = new Float32Array(resized.length);
			for (let i = 0; i < resized.length; i++) {
				input[i] = resized[i] / 255.0;
			}

			// 4. Run TFLite synchronously on GPU/NPU delegate.
			//    runSync takes ArrayBuffer[], returns ArrayBuffer[].
			//    Float32Array.buffer → ArrayBuffer (explicit cast, not `as any`).
			const [outputBuffer] = model.runSync([
				input.buffer as ArrayBuffer,
			]) as ArrayBuffer[];

			// 5. Wrap output buffer and convert to RGBA for Skia.
			const outputFloat32 = new Float32Array(outputBuffer);
			const rgba = tensorToRGBA(outputFloat32);

			// 6. Hand off to JS thread for Skia rendering.
			renderFrameJS(rgba);
		},
		[
			modelSharedValue,
			resize,
			renderFrameJS,
			lastInferenceMs,
			tensorToRGBA,
		],
	);

	// ── Capture Handler ────────────────────────────────────────────────────────
	// cameraRef declared before handleCapture so the closure is readable top-to-bottom.
	const cameraRef = useRef<Camera>(null);

	const handleCapture = useCallback(async () => {
		if (!cameraRef.current || !selectedModel) return;

		try {
			const photo = await cameraRef.current.takePhoto({ flash: "off" });

			// Normalize path: iOS returns a bare path without 'file://',
			// RNFS and Skia both need the scheme to locate the file reliably.
			const photoPath =
				Platform.OS === "ios" && !photo.path.startsWith("file://")
					? `file://${photo.path}`
					: photo.path;

			navigation.navigate("Refine", {
				photoPath,
				modelId: selectedModel.id,
				modelVersion: selectedModel.version,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			Alert.alert("Capture Failed", msg);
		}
	}, [selectedModel, navigation]);

	// ── Early returns ──────────────────────────────────────────────────────────
	if (!device) {
		return (
			<View style={styles.container}>
				<Text style={styles.hint}>No camera found</Text>
			</View>
		);
	}

	if (!selectedModel) {
		return (
			<View style={styles.container}>
				<Text style={styles.hint}>
					Select a style from the Gallery first
				</Text>
			</View>
		);
	}

	return (
		<View style={styles.container}>
			{/* Live camera feed — hidden behind Skia canvas */}
			<Camera
				ref={cameraRef}
				style={StyleSheet.absoluteFill}
				device={device}
				isActive={true}
				frameProcessor={frameProcessor}
				fps={30}
				pixelFormat="yuv"
				photo={true}
			/>

			{/* Skia canvas — renders stylized output on top of camera */}
			<Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
				{skiaImageRef.current && (
					<SkiaImage
						image={skiaImageRef.current}
						x={0}
						y={0}
						width={width}
						height={height}
						fit="cover"
					/>
				)}
			</Canvas>

			{/* Loading overlay — shown while model is being loaded to memory */}
			{isLoadingModel && (
				<View style={styles.loadingOverlay}>
					<Text style={styles.loadingText}>Loading style…</Text>
				</View>
			)}

			{/* Capture button */}
			<View style={styles.controls}>
				<TouchableOpacity
					style={[
						styles.captureBtn,
						isLoadingModel && styles.captureBtnDisabled,
					]}
					onPress={handleCapture}
					disabled={isLoadingModel}
				/>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "#000" },
	hint: { color: "#fff", textAlign: "center", marginTop: 60, fontSize: 16 },
	controls: {
		position: "absolute",
		bottom: 48,
		width: "100%",
		alignItems: "center",
	},
	captureBtn: {
		width: 72,
		height: 72,
		borderRadius: 36,
		backgroundColor: "#fff",
		borderWidth: 4,
		borderColor: "rgba(255,255,255,0.4)",
	},
	captureBtnDisabled: {
		backgroundColor: "rgba(255,255,255,0.3)",
	},
	loadingOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "rgba(0,0,0,0.5)",
		justifyContent: "center",
		alignItems: "center",
	},
	loadingText: {
		color: "#fff",
		fontSize: 16,
		fontWeight: "600",
	},
});
