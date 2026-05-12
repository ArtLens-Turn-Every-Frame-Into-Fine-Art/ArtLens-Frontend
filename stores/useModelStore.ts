import { create } from "zustand";
import { StyleModel, DownloadStatus } from "../types/StyleModel";
import {
	fetchModelList,
	getLocalMeta,
	getDownloadStatus,
	downloadModel,
	deleteModel,
} from "../services/ModelManager";
import { loadModel, unloadCurrentModel } from "../services/InferenceEngine";

interface ModelStore {
	// ── State ─────────────────────────────────────────────────────────────────
	models: StyleModel[];
	selectedModel: StyleModel | null;
	downloadStatuses: Record<string, DownloadStatus>;
	downloadProgress: Record<string, number>;
	isLoadingModel: boolean;
	isFetchingModels: boolean;
	loadError: string | null;
	fetchError: string | null;

	// ── Actions ───────────────────────────────────────────────────────────────

	/**
	 * Fetch active model list from the API.
	 * Because MMKV is synchronous, download statuses are computed inline
	 * with no async init — call this as soon as the screen mounts.
	 * Safe to call on pull-to-refresh.
	 */
	fetchModels: () => Promise<void>;

	/** Internal helper: set models array + recompute statuses. */
	setModels: (models: StyleModel[]) => void;

	/** Recompute downloadStatuses from current MMKV state. */
	refreshStatuses: () => void;

	/**
	 * Load model into TFLite memory and mark as selected.
	 * Model must already be downloaded.
	 * When isLoadingModel transitions false→true→false, CameraScreen's
	 * useEffect syncs the new TensorflowModel into its worklet SharedValue.
	 */
	selectModel: (model: StyleModel) => Promise<void>;

	/**
	 * Download a model file and persist metadata.
	 * Concurrent calls for the same model are ignored (guard inside).
	 */
	startDownload: (model: StyleModel) => Promise<void>;

	/**
	 * Delete a downloaded model's .tflite file and MMKV metadata.
	 * If model is selected, unloads TFLite interpreter first (releases VRAM).
	 */
	removeModel: (modelId: string) => Promise<void>;
}

export const useModelStore = create<ModelStore>((set, get) => ({
	models: [],
	selectedModel: null,
	downloadStatuses: {},
	downloadProgress: {},
	isLoadingModel: false,
	isFetchingModels: false,
	loadError: null,
	fetchError: null,

	// ── fetchModels ───────────────────────────────────────────────────────────
	fetchModels: async () => {
		if (get().isFetchingModels) return;
		set({ isFetchingModels: true, fetchError: null });
		try {
			const models = await fetchModelList();
			get().setModels(models);
		} catch (err: unknown) {
			const msg =
				err instanceof Error ? err.message : "Failed to load styles.";
			set({ fetchError: msg });
		} finally {
			set({ isFetchingModels: false });
		}
	},

	// ── setModels ─────────────────────────────────────────────────────────────
	setModels: (models) => {
		// MMKV reads are synchronous — no await needed for download status
		const statuses: Record<string, DownloadStatus> = {};
		models.forEach((m) => {
			statuses[m.id] = getDownloadStatus(m);
		});
		set({ models, downloadStatuses: statuses });
	},

	// ── refreshStatuses ───────────────────────────────────────────────────────
	refreshStatuses: () => {
		const statuses: Record<string, DownloadStatus> = {};
		get().models.forEach((m) => {
			statuses[m.id] = getDownloadStatus(m);
		});
		set({ downloadStatuses: statuses });
	},

	// ── selectModel ───────────────────────────────────────────────────────────
	selectModel: async (model) => {
		const meta = getLocalMeta(model.id); // synchronous MMKV read
		if (!meta) {
			set({
				loadError: "Model not downloaded. Please download it first.",
			});
			return;
		}

		set({ isLoadingModel: true, loadError: null });
		try {
			await loadModel(meta);
			// isLoadingModel going false is the SIGNAL that CameraScreen's useEffect
			// watches to sync the new TensorflowModel into its worklet SharedValue.
			set({ selectedModel: model, isLoadingModel: false });
		} catch (err: unknown) {
			const msg =
				err instanceof Error ? err.message : "Failed to load model.";
			set({ isLoadingModel: false, loadError: msg });
		}
	},

	// ── startDownload ─────────────────────────────────────────────────────────
	startDownload: async (model) => {
		// Concurrent download guard: two taps on the same card would otherwise
		// launch two parallel RNFS writes to the same file path.
		if (get().downloadStatuses[model.id] === "downloading") return;

		set((s) => ({
			downloadStatuses: {
				...s.downloadStatuses,
				[model.id]: "downloading",
			},
			downloadProgress: { ...s.downloadProgress, [model.id]: 0 },
		}));

		const result = await downloadModel(model, (pct) => {
			set((s) => ({
				downloadProgress: { ...s.downloadProgress, [model.id]: pct },
			}));
		});

		if (result.success) {
			set((s) => ({
				downloadStatuses: {
					...s.downloadStatuses,
					[model.id]: "downloaded",
				},
				downloadProgress: { ...s.downloadProgress, [model.id]: 100 },
			}));
		} else {
			set((s) => ({
				downloadStatuses: {
					...s.downloadStatuses,
					[model.id]: "error",
				},
				loadError: result.error,
			}));
		}
	},

	// ── removeModel ───────────────────────────────────────────────────────────
	removeModel: async (modelId) => {
		const { selectedModel } = get();

		// Unload interpreter BEFORE deleting the file.
		// If we delete the file first, the live GPU delegate may try to read a
		// non-existent path on its next inference call → crash.
		if (selectedModel?.id === modelId) {
			await unloadCurrentModel();
			set({ selectedModel: null });
		}

		try {
			await deleteModel(modelId); // deletes file + MMKV entry
		} catch (err) {
			console.warn("[useModelStore] removeModel error:", err);
		}

		set((s) => ({
			downloadStatuses: {
				...s.downloadStatuses,
				[modelId]: "not_downloaded",
			},
			downloadProgress: { ...s.downloadProgress, [modelId]: 0 },
		}));
	},
}));
