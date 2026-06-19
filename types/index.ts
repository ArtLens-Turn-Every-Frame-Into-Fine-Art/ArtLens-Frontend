/**
 * 🎨 ArtLens — Global TypeScript Type Definitions
 *
 * All shared interfaces, enums, and utility types for the entire application.
 * Screens, stores, services, and core modules import from this file.
 *
 * @see PRD § 5 — Directory: src/types/index.ts
 */

// ============================================================================
// 1. PRIMITIVES & ALIASES
// ============================================================================

export type StyleId = string
export type JobId = string
export type ClientHash = string

// ============================================================================
// 2. STYLE MODEL & DOMAIN CONFIG
// ============================================================================

/** Download state of a style pack (Preview + Main .tflite pair). */
export type DownloadStatus = 'not_downloaded' | 'downloading' | 'downloaded'

/**
 * Extended download status used exclusively inside the MMKV model registry.
 * `'failed'` is a registry-internal state that is never written to Zustand.
 * When a download fails, the registry stores `'failed'` but the store is
 * reset to `'not_downloaded'` so UI components only see the public union.
 */
export type RegistryDownloadStatus = DownloadStatus | 'failed'

/** Supported colour processing modes for the style transfer pipeline. */
export type ColourMode = 'texture_only' | 'full_colour' | 'luminance_blend'

/**
 * The partial model configuration as received from the API manifest.
 * Only `mainModel` and `previewModel` are served by the backend.
 * All other ModelConfig fields are engine-local constants that are NEVER
 * served by the API and must always be filled from DEFAULT_MODEL_CONFIG.
 *
 * @see ModelConfig — the fully-hydrated engine-ready shape
 * @see hydrateRemoteConfig — the merge function that produces ModelConfig
 */
export interface RemoteModelConfig {
	/** Input resolution for the main (teacher) model inference pass. */
	mainModel: number
	/**
	 * Input resolution for the preview (student) model inference pass.
	 * Optional — falls back to DEFAULT_MODEL_CONFIG.previewModel when absent.
	 */
	previewModel?: number
}

/**
 * A single art style entry in the catalog.
 * Mirrors the ManifestUpdate shape plus local download tracking.
 */
export interface StyleModel {
	id: string
	name: string
	description?: string
	version: number
	mainModelUrl: string
	previewModelUrl?: string
	thumbnailUrl: string
	fileSize?: string
	isActive: boolean
	config: ModelConfig
	/** Local download state */
	downloadStatus: DownloadStatus
	/** Download progress [0, 1] — only meaningful when status === 'downloading' */
	downloadProgress: number
}

/**
 * The fully hydrated, engine-ready model configuration.
 *
 * This type is produced by hydrateRemoteConfig() and is NEVER constructed
 * directly from the raw API RemoteModelConfig. All fields are readonly to
 * prevent accidental compile-time resolution locking via in-place mutation.
 *
 * Fields not served by the API (tileOverlap, luminanceBlend, colourModes)
 * are always backfilled from DEFAULT_MODEL_CONFIG.
 */
export interface ModelConfig {
	/**
	 * Input resolution for the main model inference pass.
	 * @source RemoteModelConfig.mainModel
	 */
	mainModel: number
	/**
	 * Input resolution for the preview model inference pass.
	 * @source RemoteModelConfig.previewModel ?? DEFAULT_MODEL_CONFIG.previewModel
	 */
	previewModel: number
	/**
	 * Pixel overlap between adjacent tiles to prevent visible seam artefacts.
	 * @source DEFAULT_MODEL_CONFIG (not served by API)
	 */
	tileOverlap: number
	/**
	 * Luminance blending coefficient in range [0.0, 1.0].
	 * @source DEFAULT_MODEL_CONFIG (not served by API)
	 */
	luminanceBlend: number
	/** Default colour processing mode applied on first use. */
	defaultColourMode: ColourMode
	/** User's current preferred colour mode (may differ from default). */
	preferredColourMode: ColourMode
}

/**
 * On-disk registry entry persisted to MMKV by ModelManager.
 * Tracks the fully-hydrated config, file paths, and download lifecycle state.
 *
 * `downloadStatus` uses RegistryDownloadStatus (superset of DownloadStatus)
 * so that `'failed'` can be tracked in the registry without polluting the
 * Zustand store's public DownloadStatus contract.
 */
export interface ModelRegistryEntry {
	id: StyleId
	name: string
	version: number
	downloadStatus: RegistryDownloadStatus
	previewPath: string | null
	mainPath: string | null
	/** Fully hydrated ModelConfig — never the raw RemoteModelConfig. */
	config: ModelConfig
	previewSize: number
	mainSize: number
}

// ============================================================================
// 3. BACKGROUND STYLE JOBS & PIPELINE
// ============================================================================

/**
 * All possible lifecycle states for a background stylization job.
 *
 * ```text
 * Transitions:
 * QUEUED → PROCESSING → DONE
 * QUEUED | PROCESSING → BATTERY_PAUSED  (battery ≤ 5% or power-saver)
 * PROCESSING → ERROR
 * ERROR → QUEUED (via retryJob)
 * ```
 */
export type JobStatus =
	| 'QUEUED'
	| 'PROCESSING'
	| 'DONE'
	| 'ERROR'
	| 'BATTERY_PAUSED'
	| 'PREVIEW_QUEUED'

/** A single background stylization job. */
export interface StyleJob {
	/** Unique job identifier */
	id: JobId
	/** file:// URI of the original captured or imported photo */
	sourceUri: string
	/** ID of the StyleModel to apply */
	styleId: StyleId
	/** Current lifecycle state */
	status: JobStatus
	/**
	 * Processing progress [0, 1].
	 * Represents completed tiles / total tiles during PROCESSING.
	 */
	progress: number
	/** file:// URI of the stylized output. Set only when status === 'DONE'. */
	resultUri?: string
	/** Human-readable error description. Set only when status === 'ERROR'. */
	errorMessage?: string
	/** Native stack trace for debugging. Set only when status === 'ERROR'. */
	errorTrace?: string
	/** Whether the job can be retried after failure. */
	retryable: boolean
	/** Unix timestamp (ms) when the job was created. */
	createdAt: number
	/**
	 * Deep-freeze checkpoint path.
	 * Set when a PROCESSING job is paused due to low battery.
	 */
	checkpointPath?: string
}

/** Minimum payload required to enqueue a new job. */
export interface JobPayload {
	/** Source image URI (file:// or content://) */
	sourceUri: string
	/** ID of the style to apply */
	styleId: StyleId
	isPreview?: boolean
}

// ============================================================================
// 5. INFERENCE ENGINE ARCHITECTURE
// ============================================================================

export type ModelSlot = 'preview' | 'main'

// ============================================================================
// 6. SYSTEM OS INTEGRATION (Battery & Intent Handlers)
// ============================================================================

export interface BatteryState {
	batteryLevel: number // [0, 100] percentage
	isPowerSaverActive: boolean
	isProcessingFrozen: boolean
}

/** Populated by useIncomingImage when the app is opened via share or deep link. */
export interface IncomingImageState {
	uri: string | null
	filename: string | null
}

/** User-selected format for saved artwork files. Stored in useModelStore. */
export type ExportFormat = 'JPEG' | 'JPG' | 'PNG' | 'HEIC' | 'HEIF'

// ============================================================================
// 7. API & NETWORK SYNC (PRD § 8.1 & api.ts)
// ============================================================================

/**
 * Single model entry within a manifest 200 response.
 *
 * `config` is typed as RemoteModelConfig — only mainModel and previewModel
 * are served by the API. Engine-only fields must be merged from
 * DEFAULT_MODEL_CONFIG via hydrateRemoteConfig() before use.
 */
export interface ManifestUpdate {
	id: StyleId
	name: string
	description?: string
	version: number
	mainModelUrl: string
	/** Optional — not all styles include a preview (student) model. */
	previewModelUrl?: string
	thumbnailUrl: string
	fileSize?: string
	isActive: boolean
	/** Partial API config — hydrate via hydrateRemoteConfig() before use. */
	config: RemoteModelConfig
}

/** Full body of a successful POST /api/models-manifest 200 response. */
export interface ManifestResponse {
	manifestHash: ClientHash
	isFullSync: boolean
	updates: ManifestUpdate[]
	/** StyleIds whose entries should be marked inactive (files kept on disk). */
	deleted: StyleId[]
}

/** Reduced result returned by api.syncManifest() — null signals 304 no-op. */
export type SyncResult = {
	manifestHash: ClientHash
	updates: ManifestUpdate[]
	deleted: StyleId[]
} | null

export interface ContactPayload {
	name: string
	email: string
	message: string
}
