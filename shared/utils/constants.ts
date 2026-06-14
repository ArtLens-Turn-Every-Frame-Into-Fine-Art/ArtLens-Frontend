/**
 * ⚙️ ArtLens — Global Constants & Configuration Matrices
 *
 * Global configuration matrices, hardware parameters, and system constants for ArtLens.
 *
 * @see PRD § 5 — Directory: src/shared/utils/constants.ts
 */

import type { ModelConfig } from '@/types'
import type { TensorflowModelDelegate } from 'react-native-fast-tflite'

// ============================================================================
// 1. APPLICATION CORE METADATA
// ============================================================================

export const APP_INFO = {
	name: 'ArtLens',
	version: '1.5.0',
	buildNumber: '1024',
	/** @deprecated alias for buildNumber — retained for legacy callers */
	build: '1024',
	supportEmail: 'art.lens.fyp@gmail.com',
	twitterUrl: 'https://x.com/artlens_app',
	xHandle: '@ArtLensApp',
	album: 'ArtLens',
	success_reset_ms: 4000,
} as const

// ============================================================================
// 2. UI COLORS & LAYOUT
// ============================================================================

export const COLORS = {
	primary: '#7B61FF',
	primaryLight: '#A291FF',
	accent: '#FF7675',
	background: '#F8F9FB',
	white: '#FFFFFF',
	black: '#000000',
	textMain: '#1C1C1E',
	textGray: '#8E8E93',
	border: '#F2F2F7',
	cardBg: '#FBFBFF',
	success: '#4CD964',
	warning: '#FF9500',
} as const

// ============================================================================
// 3. HARDWARE & COMPUTE CONSTRAINTS
// ============================================================================

export const BATTERY_LIMITS = {
	CRITICAL_THRESHOLD_PERCENT: 5,
	POLLING_INTERVAL_MS: 30000,
} as const

/**
 * Platform-keyed delegate arrays for the InferenceEngine.
 *
 * BREAKING CHANGE FROM v1: The flat mixed-platform array has been replaced with
 * a platform-keyed map. The `main.android` / `main.ios` / `main.default` keys
 * allow InferenceEngine._getDefaultDelegates() to consume this via Platform.select()
 * without needing inline delegate literals.
 *
 * `preview` is always CPU/XNNPACK (empty array) — GPU delegates add latency for
 * the student model and can cause frame drops in the live viewfinder.
 */
export const INFERENCE_DELEGATES: {
	readonly preview: readonly TensorflowModelDelegate[]
	readonly main: Record<
		'android' | 'ios' | 'default',
		readonly TensorflowModelDelegate[]
	>
} = {
	preview: [],
	main: {
		android: ['android-gpu', 'nnapi'],
		ios: ['core-ml'],
		default: [],
	},
} as const

// ============================================================================
// 4. STYLE MODEL SAFETY FALLBACKS & PREPROCESSING
// ============================================================================

/**
 * Default engine configuration applied to every style model.
 *
 * Fields served by the API (`mainModel`, `previewModel`) will be
 * OVERWRITTEN by per-model values during hydration. All other fields are
 * engine-local and will ALWAYS come from here since the API does not serve them.
 *
 * @important Do not read this directly in engine code — always use the hydrated
 * `StyleModel.config` which has been merged with this default.
 */
export const DEFAULT_MODEL_CONFIG: Readonly<ModelConfig> = {
	mainModel: 512,
	previewModel: 256,
	tileOverlap: 0.5,
	luminanceBlend: 0.75,
	defaultColourMode: 'texture_only',
	preferredColourMode: 'texture_only',
} as const

/**
 * Image preprocessing parameters used by ALL style transfer models.
 *
 * Normalization formula applied to each input frame before inference:
 * ```text
 * normalizedPixel = (rawPixel / PREPROCESS_SCALE) - PREPROCESS_SHIFT
 * ```
 * This produces values in the range `[-1.0, 1.0]`.
 */
export const MODEL_PREPROCESS = {
	/** Divisor applied to raw pixel value (0–255). Value: 127.5 */
	SCALE: 127.5,
	/** Shift applied after scaling. Value: 1.0 */
	SHIFT: 1.0,
} as const

/**
 * Gaussian window pre-computation parameters for the tiled overlap-add stitch.
 *
 * `MODEL_GAUSSIAN_SIGMA_DIV`: The tile resolution is divided by this value to
 * produce the Gaussian sigma. σ = resolution / MODEL_GAUSSIAN_SIGMA_DIV.
 * At the default σ = 512 / 5 = 102.4, edge weight ≈ exp(-3.125) ≈ 0.044.
 *
 * `GAUSSIAN_FLOOR_EPSILON`: A small positive constant added to every weight
 * after peak normalization. Prevents a zero denominator in the overlap-add
 * accumulator (divide-by-zero) on tiles that receive no overlap coverage.
 */
export const MODEL_GAUSSIAN_SIGMA_DIV = 5.0 as const
export const GAUSSIAN_FLOOR_EPSILON = 1e-6 as const

/**
 * JPEG output quality for all stylized artwork exports.
 * Applied by both TiledInferenceRunner._encodeAndSave() and
 * SkiaRenderer.createCompositeSurfaceSnapshot().
 * Range [1, 100]. 90 preserves impasto texture without excessive file size.
 */
export const OUTPUT_JPEG_QUALITY = 100 as const

/**
 * Manifest cache schema version.
 *
 * BUMP THIS whenever the shape of cached manifest/model data changes.
 * A version increment causes all storage keys to change, forcing
 * old cached data to be ignored and re-fetched.
 *
 * **History:**
 * - `v2` — config: { mainModel: number, previewModel?: number } (inline)
 */
export const MANIFEST_SCHEMA_VERSION = 2

/**
 * The minimum acceptable resolution for any inference pass.
 * Values below this threshold indicate a hydration error and should
 * prevent model loading rather than running inference on a garbage shape.
 */
export const MIN_INFERENCE_RESOLUTION = 64

export const TIMING_CONFIG = {
	PROGRESS_THROTTLE_MS: 150,
} as const

export const DOWNLOAD_MULTIPLEX_WEIGHTS = {
	PREVIEW: 0.2,
	MAIN: 0.8,
} as const

export const SYSTEM_BOUNDS = {
	CHANNELS: 3,
	RGBA_CHANNELS: 4,
	F32_BYTES: 4,
} as const

export const PERFORMANCE_LIMITS = {
	/** Max ~12.5 Megapixel canvas threshold for the stitch accumulator */
	STITCH_MAX_PIXELS: 7900 * 4500, // ≈ 12.5 MP
} as const
