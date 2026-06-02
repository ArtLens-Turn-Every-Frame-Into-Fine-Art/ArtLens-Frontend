/**
 * @file useModelStore.ts
 * @description Global Zustand v5 store for the ArtLens style model catalog and manifest sync state.
 *
 * REFACTOR CHANGES (v2):
 *   — updateDownloadStatus now accepts an optional `progress` float (0.0–1.0) and
 *     applies `downloadStatus` + `downloadProgress` atomically in a single set() call,
 *     preventing split-update re-render cascades during high-frequency download ticks.
 *   — applyManifestUpdate guarantees that newly inserted catalog entries are always
 *     initialized with an explicit `downloadProgress: 0` (was previously relying on
 *     a spread that could miss the field if ManifestUpdate extended the shape).
 *   — All legacy state keys and action aliases are retained for backward-compat.
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
} from '@/types'
import { STORAGE_INSTANCE_IDS } from '@/shared/utils/storageKeys'

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
	 * REFACTOR NOTE: The `progress` parameter was added to allow ModelManager's
	 * concurrent download multiplexer to pipe high-frequency byte-fraction updates
	 * into the store without requiring two separate set() calls per tick.
	 * Both fields are applied in a single catalog map pass to prevent split-render
	 * artifacts (e.g., status='downloading' visible briefly with stale progress=1).
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

const _storageAdapter = {
	setItem: (key: string, value: string): void => _mmkv.set(key, value),
	getItem: (key: string): string | null => _mmkv.getString(key) ?? null,
	removeItem: (key: string): boolean => _mmkv.remove(key),
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
			 * REFACTOR: updateDownloadStatus now accepts optional `progress` and
			 * applies both `downloadStatus` and `downloadProgress` in one atomic
			 * map pass — no second set() call, no split-render window.
			 */
			updateDownloadStatus: (
				styleId: StyleId,
				status: DownloadStatus,
				progress?: number
			) =>
				set((state) => ({
					catalog: state.catalog.map((model) => {
						if (model.id !== styleId) return model

						// Build the update object atomically.
						// Only update downloadProgress if the caller provided a value;
						// otherwise keep the existing progress to avoid clobbering a
						// value set by a concurrent progress tick.
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
			 * REFACTOR: Explicit `downloadProgress: 0` guaranteed for every new
			 * catalog entry insertion. The old spread relied on ManifestUpdate
			 * containing the field, which it never does (it's a server shape).
			 */
			applyManifestUpdate: (
				update: ManifestUpdatePayload,
				newHash: ClientHash
			) =>
				set((state) => {
					// Build a mutable working map from the current catalog.
					const catalogMap = new Map<StyleId, StyleModel>(
						state.catalog.map((m) => [m.id, m])
					)

					// ── Step 1: Mark server-deleted entries as inactive ────────
					// Per PRD § 2.2: files are KEPT on disk; only isActive changes.
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
								// Known entry — check version change.
								const versionBumped =
									existing.version !== incoming.version

								catalogMap.set(incoming.id, {
									// Retain all local tracking fields by default.
									...existing,
									// Apply every server-side field from the delta.
									...incoming,
									// Ensure config always has a string value.
									config:
										incoming.config ??
										existing.config ??
										'',
									// Server says it is active again.
									isActive: true,
									// Version bump → force re-download.
									// Same version → keep existing download state.
									downloadStatus: versionBumped
										? 'not_downloaded'
										: existing.downloadStatus,
									// Version bump → reset progress to 0.
									// Same version → keep current progress.
									downloadProgress: versionBumped
										? 0
										: existing.downloadProgress,
								})
							} else {
								// Brand-new entry — initialize all local fields explicitly.
								// REFACTOR: `downloadProgress: 0` is written unconditionally
								// here; it must never be left to a spread from ManifestUpdate
								// (which has no such field).
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
									config: incoming.config ?? '',
									// ── Local tracking fields (never from server) ──
									downloadStatus: 'not_downloaded',
									downloadProgress: 0, // EXPLICIT — guaranteed initialization
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
			name: 'artlens-model-store',
			storage: createJSONStorage(() => _storageAdapter),
		}
	)
)
