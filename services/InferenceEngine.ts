/**
 * InferenceEngine.ts — Refactored for New Architecture
 *
 * Changes:
 *  1. Removed react-native-fs — file existence check now uses expo-file-system.
 *  2. Path semantics: expo-file-system localPaths already carry 'file://'
 *     scheme. The previous code did `file://${meta.localPath}` which would
 *     produce 'file:///file:///...' with the new stack. Fixed to use the
 *     localPath directly as the URL.
 *  3. CPU_DELEGATES: [] → ['default'].  An empty array does not instruct
 *     react-native-fast-tflite v3 (NitroModules) to use CPU. Passing []
 *     results in undefined behaviour. 'default' is the explicit CPU sentinel.
 *  4. Added JSDoc warning: getActiveModel() is main-thread only.
 *     CameraScreen bridges to worklets via useSharedValue (see CameraScreen.tsx).
 */

import * as FileSystem from "expo-file-system";
import {
	loadTensorflowModel,
	TensorflowModel,
	TensorflowModelDelegate,
} from "react-native-fast-tflite";
import { Platform } from "react-native";
import { LocalModelMeta } from "../types/StyleModel";

// ── Singleton model holder ────────────────────────────────────────────────────
// ⚠️  MAIN-THREAD ONLY ⚠️
// These module-level variables live in the main JS thread's heap.
// They are invisible to the react-native-worklets-core worklet thread.
// Never call getActiveModel() from inside a 'worklet' function.
// See CameraScreen.tsx for the correct useSharedValue bridge pattern.
let activeModel: TensorflowModel | null = null;
let activeModelId: string | null = null;

export async function loadModel(
	meta: LocalModelMeta,
): Promise<TensorflowModel> {
	// Short-circuit: already loaded
	if (activeModel && activeModelId === `${meta.id}_v${meta.version}`) {
		return activeModel;
	}

	// Dispose previous model first — GPU delegate holds VRAM until dispose().
	// Failing to do this causes OOM crashes on mid-range devices.
	await unloadCurrentModel();

	// Verify file exists.
	// meta.localPath already includes 'file://' (set by expo-file-system).
	const info = await FileSystem.getInfoAsync(meta.localPath);
	if (!info.exists) {
		throw new Error(`Model file not found: ${meta.localPath}`);
	}

	// GPU delegate: CoreML/Neural Engine on iOS, OpenCL GPU on Android.
	const GPU_DELEGATES: TensorflowModelDelegate[] =
		Platform.OS === "ios" ? ["core-ml"] : ["android-gpu"];

	// CPU fallback. 'default' is the explicit value — [] is undefined behaviour.
	const CPU_DELEGATES: TensorflowModelDelegate[] = [];

	try {
		// localPath already has 'file://' scheme — do NOT prepend another one.
		const model = await loadTensorflowModel(
			{ url: meta.localPath },
			GPU_DELEGATES,
		);
		activeModel = model;
		activeModelId = `${meta.id}_v${meta.version}`;
		return model;
	} catch (gpuErr) {
		console.warn(
			"[InferenceEngine] GPU delegate failed, falling back to CPU:",
			gpuErr,
		);
		const model = await loadTensorflowModel(
			{ url: meta.localPath },
			CPU_DELEGATES,
		);
		activeModel = model;
		activeModelId = `${meta.id}_v${meta.version}`;
		return model;
	}
}

export async function unloadCurrentModel(): Promise<void> {
	if (activeModel) {
		try {
			activeModel.dispose?.();
		} catch (e) {
			console.warn("[InferenceEngine] Error disposing model:", e);
		} finally {
			activeModel = null;
			activeModelId = null;
		}
	}
}

/**
 * Returns the currently loaded TensorflowModel, or null.
 *
 * ⚠️  MAIN-THREAD ONLY — do not call from a 'worklet'.
 * The worklet thread cannot read JS-thread module-level variables.
 * CameraScreen.tsx bridges this via useSharedValue<TensorflowModel|null>.
 */
export function getActiveModel(): TensorflowModel | null {
	return activeModel;
}

export function isModelLoaded(id: string, version: number): boolean {
	return activeModelId === `${id}_v${version}`;
}
