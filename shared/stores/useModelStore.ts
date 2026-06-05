/**
 * @file useModelStore.ts
 * @description Global Zustand v5 store for the ArtLens style model catalog and manifest sync state.
 *
 * REFACTOR CHANGES (v3):
 *
 *   FIX S1 — _storageAdapter.removeItem return type annotation was `: boolean`.
 *     The Zustand PersistStorage adapter contract requires removeItem to return
 *     `void | Promise<void>`. The explicit wrong annotation caused a type mismatch
 *     with createJSONStorage. Removed the annotation so TypeScript infers `void`
 *     from _mmkv.remove(), which is the correct return type.
 *
 *   FIX S2 — _mapConfigToModelConfig now accepts RemoteModelConfig instead of
 *     ManifestUpdate['config'] (which was ModelConfig — all fields required).
 *     Since ManifestUpdate.config is now RemoteModelConfig (previewModel is
 *     optional), the `?? DEFAULT_MODEL_CONFIG.previewModel` fallback is now
 *     semantically correct and will actually trigger when the API omits the field.
 *
 *   FIX S3 — New catalog entries now go through _mapConfigToModelConfig.
 *     Previously, applyManifestUpdate used `config: incoming.config` for brand-new
 *     entries while version-bumped existing entries used `_mapConfigToModelConfig`.
 *     This asymmetry meant new entries bypassed the DEFAULT_MODEL_CONFIG merge,
 *     producing a ModelConfig where engine-only fields (tileOverlap, luminanceBlend,
 *     colour modes) were undefined at runtime despite being typed as required numbers.
 *     Both code paths now use _mapConfigToModelConfig for consistency.
 *
 * PRD § 2.2 / 5.2 — Directory: src/shared/stores/useModelStore.ts
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { createMMKV } from 'react-native-mmkv'

import type {
	StyleModel,
	ExportFormat,
	StyleId,
	ClientHash,
	DownloadStatus,
	ManifestUpdate,
	ModelConfig,
	RemoteModelConfig,
} from '@/types'
import { STORAGE_INSTANCE_IDS } from '@/shared/utils/storageKeys'
import {
	DEFAULT_MODEL_CONFIG,
	MIN_INFERENCE_RESOLUTION,
} from '@/shared/utils/constants'

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL PAYLOAD TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Shape returned by the API layer and passed into applyManifestUpdate. */
interface ManifestUpdatePayload {
	updates: ManifestUpdate[]
	deleted: StyleId[]
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE SHAPE
// ─────────────────────────────────────────────────────────────────────────────

interface ModelStoreState {
	/** Full catalog of known style models (active + inactive). */
	catalog: StyleModel[]
	/** Hash from the most recent successful manifest sync (server-issued). */
	manifestHash: ClientHash | null
	/** Alias for manifestHash — retained for legacy UI component compatibility. */
	clientHash: ClientHash | null
	/** Currently selected style for live camera preview. */
	selectedStyleId: StyleId | null
	/** User-preferred export format. Persisted to MMKV. */
	exportFormat: ExportFormat
	/** True while a manifest sync network request is in flight. */
	isSyncing: boolean
	/** Non-null when the most recent sync attempt failed. */
	syncError: string | null
}

interface ModelStoreActions {
	// ── Selection ──────────────────────────────────────────────────────────────
	setSelectedStyleId: (id: StyleId | null) => void
	/** Alias for setSelectedStyleId — UI component compatibility. */
	setSelectedStyle: (id: StyleId | null) => void

	// ── Settings ───────────────────────────────────────────────────────────────
	setExportFormat: (format: ExportFormat) => void

	// ── Sync plumbing ──────────────────────────────────────────────────────────
	setSyncing: (isSyncing: boolean) => void
	setSyncError: (error: string | null) => void
	/** Updates both manifestHash and clientHash alias atomically. */
	setClientHash: (hash: ClientHash | null) => void

	// ── Catalog mutations ──────────────────────────────────────────────────────
	/** Full catalog replacement — used during onboarding or hard resets. */
	updateCatalog: (catalog: StyleModel[]) => void

	/**
	 * Applies a manifest delta to the catalog and advances the client hash.
	 *
	 * Rules (PRD § 2.2 / 3.3):
	 *   - `deleted` IDs: mark isActive=false, keep on disk.
	 *   - `updates` with new version: reset downloadStatus to 'not_downloaded'.
	 *   - New IDs not in the catalog: insert with downloadProgress: 0 (EXPLICIT).
	 *   - All entries (new and version-bumped) go through _mapConfigToModelConfig.
	 *   - Existing IDs with unchanged version: preserve downloadStatus/Progress.
	 */
	applyManifestUpdate: (
		update: ManifestUpdatePayload,
		newHash: ClientHash
	) => void

	/**
	 * Atomically updates the download lifecycle state and optional byte progress
	 * of a single catalog entry.
	 *
	 * @param styleId  - Target entry identifier.
	 * @param status   - New DownloadStatus value.
	 * @param progress - Optional [0.0, 1.0] byte fraction. Omit to leave unchanged.
	 */
	updateDownloadStatus: (
		styleId: StyleId,
		status: DownloadStatus,
		progress?: number
	) => void

	// ── Lifecycle ──────────────────────────────────────────────────────────────
	resetStore: () => void
}

export type ModelStore = ModelStoreState & ModelStoreActions

// ─────────────────────────────────────────────────────────────────────────────
// MMKV STORAGE ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

const _mmkv = createMMKV({ id: STORAGE_INSTANCE_IDS.MODELS })

/**
 * FIX S1: `removeItem` return type annotation removed.
 * The correct return type per Zustand's PersistStorage interface is
 * `void | Promise<void>`. The previous annotation `: boolean` was incorrect
 * and conflicted with the interface, causing a type error at the createJSONStorage
 * call site. TypeScript now infers `void` from _mmkv.remove(), which is correct.
 */
const _storageAdapter = {
	setItem: (key: string, value: string): void => _mmkv.set(key, value),
	getItem: (key: string): string | null => _mmkv.getString(key) ?? null,
	removeItem: (key: string) => _mmkv.remove(key),
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG MAPPING HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a RemoteModelConfig (partial API shape) into the engine-ready
 * ModelConfig shape, backfilling all engine-only fields from DEFAULT_MODEL_CONFIG.
 *
 * FIX S2: Parameter type changed from `ManifestUpdate['config']` (which was
 * `ModelConfig`, all fields required) to `RemoteModelConfig` (only mainModel
 * required, previewModel optional). This makes the `?? DEFAULT_MODEL_CONFIG
 * .previewModel` fallback semantically correct: it now triggers when the API
 * genuinely omits previewModel, instead of being dead code on a non-nullable field.
 *
 * BUG 10 FIX: Added MIN_INFERENCE_RESOLUTION validation for mainModel and
 * previewModel, mirroring the validation already present in
 * ModelManager.hydrateRemoteConfig(). Previously this function copied
 * config.mainModel verbatim — a manifest serving `mainModel: 0` or a negative
 * value would propagate corrupted data into the Zustand catalog, where UI
 * components and analytics would read it without any guard.
 *
 * This mirrors the logic in hydrateRemoteConfig() in ModelManager.ts so that
 * applyManifestUpdate produces configs consistent with those written to the
 * MMKV registry.
 */
function _mapConfigToModelConfig(config: RemoteModelConfig): ModelConfig {
	return {
		...DEFAULT_MODEL_CONFIG,
		mainModel:
			typeof config.mainModel === 'number' &&
			config.mainModel >= MIN_INFERENCE_RESOLUTION
				? config.mainModel
				: DEFAULT_MODEL_CONFIG.mainModel,
		// FIX S2 + BUG 10: validated ?? fallback — triggers both on undefined
		// (API omits field) and on invalid values (corrupt manifest).
		previewModel:
			typeof config.previewModel === 'number' &&
			config.previewModel >= MIN_INFERENCE_RESOLUTION
				? config.previewModel
				: DEFAULT_MODEL_CONFIG.previewModel,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT STATE
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_STATE: ModelStoreState = {
	catalog: [],
	manifestHash: null,
	clientHash: null,
	selectedStyleId: null,
	exportFormat: 'JPEG',
	isSyncing: false,
	syncError: null,
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────────────────────

export const useModelStore = create<ModelStore>()(
	persist(
		(set) => ({
			// ── Initial state ──────────────────────────────────────────────────
			...DEFAULT_STATE,

			// ── Selection ─────────────────────────────────────────────────────
			setSelectedStyleId: (id) => set({ selectedStyleId: id }),
			setSelectedStyle: (id) => set({ selectedStyleId: id }),

			// ── Settings ──────────────────────────────────────────────────────
			setExportFormat: (format) => set({ exportFormat: format }),

			// ── Sync plumbing ─────────────────────────────────────────────────
			setSyncing: (isSyncing) => set({ isSyncing }),

			setSyncError: (syncError) => set({ syncError }),

			setClientHash: (hash) =>
				set({ clientHash: hash, manifestHash: hash }),

			// ── Catalog mutations ─────────────────────────────────────────────
			updateCatalog: (catalog) => set({ catalog }),

			/**
			 * Atomically updates downloadStatus and optionally downloadProgress
			 * in a single catalog map pass to prevent split-render artifacts.
			 */
			updateDownloadStatus: (
				styleId: StyleId,
				status: DownloadStatus,
				progress?: number
			) =>
				set((state) => ({
					catalog: state.catalog.map((model) => {
						if (model.id !== styleId) return model

						const progressUpdate: Pick<
							StyleModel,
							'downloadProgress'
						> =
							typeof progress === 'number'
								? { downloadProgress: progress }
								: { downloadProgress: model.downloadProgress }

						return {
							...model,
							downloadStatus: status,
							...progressUpdate,
						}
					}),
				})),

			/**
			 * FIX S3: Both new entries and version-bumped existing entries now go
			 * through _mapConfigToModelConfig, ensuring the catalog always contains
			 * fully-hydrated ModelConfig objects regardless of which code path
			 * created the entry. Previously, new entries were inserted with
			 * `config: incoming.config` (the raw RemoteModelConfig), leaving
			 * engine-only fields undefined despite being typed as required numbers.
			 */
			applyManifestUpdate: (
				update: ManifestUpdatePayload,
				newHash: ClientHash
			) =>
				set((state) => {
					const catalogMap = new Map<StyleId, StyleModel>(
						state.catalog.map((m) => [m.id, m])
					)

					// ── Step 1: Mark server-deleted entries as inactive ────────
					if (Array.isArray(update?.deleted)) {
						for (const id of update.deleted) {
							const existing = catalogMap.get(id)
							if (existing) {
								catalogMap.set(id, {
									...existing,
									isActive: false,
								})
							}
						}
					}

					// ── Step 2: Apply delta updates ───────────────────────────
					if (Array.isArray(update?.updates)) {
						for (const incoming of update.updates) {
							const existing = catalogMap.get(incoming.id)

							if (existing) {
								const versionBumped =
									existing.version !== incoming.version

								catalogMap.set(incoming.id, {
									...existing,
									...incoming,
									// FIX S3: both paths use _mapConfigToModelConfig
									config: versionBumped
										? _mapConfigToModelConfig(
												incoming.config
											)
										: existing.config,
									isActive: true,
									downloadStatus: versionBumped
										? 'not_downloaded'
										: existing.downloadStatus,
									downloadProgress: versionBumped
										? 0
										: existing.downloadProgress,
								})
							} else {
								// FIX S3: new entries also use _mapConfigToModelConfig
								// — no longer rely on `incoming.config` directly,
								// which would silently omit engine-only ModelConfig fields.
								const newEntry: StyleModel = {
									id: incoming.id,
									name: incoming.name,
									description: incoming.description,
									version: incoming.version,
									thumbnailUrl: incoming.thumbnailUrl,
									fileSize: incoming.fileSize,
									isActive: true,
									previewModelUrl: incoming.previewModelUrl,
									mainModelUrl: incoming.mainModelUrl,
									config: _mapConfigToModelConfig(
										incoming.config
									),
									// ── Local tracking fields ──
									downloadStatus: 'not_downloaded',
									downloadProgress: 0,
								}
								catalogMap.set(incoming.id, newEntry)
							}
						}
					}

					return {
						catalog: Array.from(catalogMap.values()),
						manifestHash: newHash,
						clientHash: newHash,
						syncError: null,
					}
				}),

			// ── Lifecycle ─────────────────────────────────────────────────────
			resetStore: () => set({ ...DEFAULT_STATE }),
		}),
		{
			name: STORAGE_INSTANCE_IDS.MODELS,
			storage: createJSONStorage(() => _storageAdapter),
		}
	)
)
