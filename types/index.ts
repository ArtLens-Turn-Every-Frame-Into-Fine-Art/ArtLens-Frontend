/**
 * ArtLens — Global TypeScript Type Definitions
 *
 * All shared interfaces, enums, and utility types for the entire application.
 * Screens, stores, services, and core modules import from this file.
 *
 * PRD § 5 — Directory: src/types/index.ts
 */

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

export type StyleId = string
export type JobId = string
export type ClientHash = string

// ─────────────────────────────────────────────────────────────────────────────
// STYLE MODEL
// ─────────────────────────────────────────────────────────────────────────────

/** Download state of a style pack (Preview + Main .tflite pair). */
export type DownloadStatus = 'not_downloaded' | 'downloading' | 'downloaded'

/**
 * A single art style entry in the catalog.
 * Mirrors the ManifestUpdate shape plus local download tracking.
 */
export interface StyleModel {
	/** Unique identifier — stable across versions */
	id: StyleId
	/** Display name shown in carousels and selection grids */
	name: string
	/** Long-form description shown in ModelDetailSheet */
	description: string
	/** Manifest version — used for delta update comparison */
	version: number
	/** Remote URL for the thumbnail image */
	thumbnailUrl: string
	/** Human-readable estimated file size (e.g. "~45 MB") from manifest */
	fileSize: string
	/** Whether this model is visible in the active catalog */
	isActive: boolean
	/** URL to download the Preview (live preview) .tflite model */
	previewModelUrl: string
	/** URL to download the Main (full quality) .tflite model */
	mainModelUrl: string
	/** URL to a JSON file with per-model inference config (overlap, colour mode, etc.) */
	config: string
	/** Local download state */
	downloadStatus: DownloadStatus
	/** Download progress [0, 1] — only meaningful when status === 'downloading' */
	downloadProgress: number
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE JOB
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All possible lifecycle states for a background stylization job.
 *
 * Transitions:
 *   QUEUED → PROCESSING → DONE
 *   QUEUED | PROCESSING → BATTERY_PAUSED  (battery ≤ 5% or power-saver)
 *   PROCESSING → ERROR
 *   ERROR → QUEUED (via retryJob)
 */
export type JobStatus =
	| 'QUEUED'
	| 'PROCESSING'
	| 'DONE'
	| 'ERROR'
	| 'BATTERY_PAUSED'

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
	 * Allows resumption from the last completed tile.
	 */
	checkpointPath?: string
}

/** Minimum payload required to enqueue a new job. */
export interface JobPayload {
	/** Source image URI (file:// or content://) */
	sourceUri: string
	/** ID of the style to apply */
	styleId: StyleId
}

// ─────────────────────────────────────────────────────────────────────────────
// DEEP FREEZE CHECKPOINT (PRD § StyleJobService — Tiling checkpoint fields)
// ─────────────────────────────────────────────────────────────────────────────

export interface TileGridDef {
	cols: number
	rows: number
	total: number
	step: number
	tileSize: number
	overlapFrac: number
}

/** Serialized to disk when a job is interrupted by low battery. */
export interface TileCheckpoint {
	taskId: JobId
	sourceUri: string
	targetFormat: ExportFormat
	styleId: StyleId
	modelHash: string
	tileGrid: TileGridDef
	completedTiles: number[]
	pendingTiles: number[]
	/** Base64-encoded PNG of the partially assembled composite canvas. */
	partialBitmapB64: string
}

// ─────────────────────────────────────────────────────────────────────────────
// HARDWARE PROFILE  (PRD § HardwareProfiler.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type DelegateType = 'nnapi' | 'android-gpu' | 'core-ml'

/**
 * Result of a full hardware benchmark run.
 * Determines how InferenceEngine routes models to delegates.
 *
 * Tier 1 → Live camera loop capable (NPU/GPU available, benchmark ≥ 10 FPS).
 * Tier 2 → Static-only mode; live preview disabled, queue-based only.
 */
export interface HardwareProfile {
	tier: 1 | 2
	preferredLiveDelegate: DelegateType
	preferredMainDelegate: DelegateType
	/** Optimal CPU thread count for multi-threaded XNNPACK inference. */
	threadCount: number
	/** Unix timestamp (ms) when the benchmark was last run. */
	benchmarkedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL & INFERENCE CONFIG
// ─────────────────────────────────────────────────────────────────────────────

/** URL pair used by ModelManager.downloadStylePack(). */
export interface ModelUrls {
	previewModelUrl: string
	mainModelUrl: string
	config: string
}

/** Parsed contents of a style's config.json fetched from config. */
export interface ModelConfig {
	/** Tile overlap fraction [0, 1]. Default 0.5 per PRD. */
	tileOverlap: number
	/** 'texture_only' | 'lab_match' | 'none' — post-processing colour mode. */
	preferredColourMode: 'texture_only' | 'lab_match' | 'none'
	/** Main model tile resolution. Always 512 per PRD. */
	inferenceResolution: number
	/** Preview model tile resolution. Always 256 per PRD. */
	previewResolution: number

	luminanceBlend: number
	defaultColourMode: 'texture_only' | 'lab_match' | 'none'
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS / EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/** User-selected format for saved artwork files. Stored in useModelStore. */
export type ExportFormat = 'JPEG' | 'JPG' | 'PNG' | 'HEIC' | 'HEIF'

// ─────────────────────────────────────────────────────────────────────────────
// API — MANIFEST SYNC  (PRD § 8.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single model entry within a manifest 200 response.
 * Structural subset of StyleModel — no local fields (downloadStatus etc.).
 */
export interface ManifestUpdate {
	id: StyleId
	name: string
	description: string
	version: number
	thumbnailUrl: string
	fileSize: string
	isActive: boolean
	previewModelUrl: string
	mainModelUrl: string
	config?: string
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

// ─────────────────────────────────────────────────────────────────────────────
// API — CONTACT FORM  (PRD § api.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactPayload {
	name: string
	email: string
	message: string
}

// ─────────────────────────────────────────────────────────────────────────────
// INCOMING IMAGE (Share Intent / Deep Link)
// ─────────────────────────────────────────────────────────────────────────────

/** Populated by useIncomingImage when the app is opened via share or deep link. */
export interface IncomingImageState {
	uri: string | null
	filename: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// INFERENCE ENGINE INTERFACES  (PRD § InferenceEngine.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** The two isolated model slots managed by InferenceEngine. */
export type ModelSlot = 'preview' | 'main'

/** Input tensor shape for inference — [batch, height, width, channels]. */
export type TensorShape = [number, number, number, number]

// ─────────────────────────────────────────────────────────────────────────────
// BATTERY  (PRD § useBatteryGuard.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface BatteryState {
	batteryLevel: number // [0, 100] percentage
	isPowerSaverActive: boolean
	isProcessingFrozen: boolean
}
