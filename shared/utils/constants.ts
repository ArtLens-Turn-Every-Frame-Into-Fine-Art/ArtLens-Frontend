/**
 * @file constants.ts
 * @description Global configuration matrices, hardware parameters, and system constants for ArtLens.
 *
 * PRD § 5 — Directory: src/shared/utils/constants.ts
 */

import { ModelSlot, ModelConfig } from '@/types'
import { TensorflowModelDelegate } from 'react-native-fast-tflite'

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION CORE METADATA
// ─────────────────────────────────────────────────────────────────────────────

export const APP_INFO = {
	name: 'ArtLens',
	version: '1.0.0',
	buildNumber: '100',
	awardBadge: 'Awwwards Mobile Excellence 2026',
	supportEmail: 'support@artlens-ai.dev',
	twitterUrl: 'https://x.com/artlens_app',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// HARDWARE & COMPUTE CONSTRAINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Battery and system execution limits to safeguard device health.
 * Aligned with useBatteryStore.ts processing restrictions.
 */
export const BATTERY_LIMITS = {
	CRITICAL_THRESHOLD_PERCENT: 5, // Freeze intensive backgrounds at <= 5%
	POLLING_INTERVAL_MS: 30000, // 30 Seconds system state check loops
} as const

/**
 * Hardware accelerator delegate keys for react-native-fast-tflite v3.x.
 * Aligned with InferenceEngine.ts hardware split contracts.
 */
export const INFERENCE_DELEGATES: Record<
	ModelSlot,
	readonly TensorflowModelDelegate[]
> = {
	preview: [],
	main: ['nnapi', 'android-gpu', 'core-ml'],
} as const

// ─────────────────────────────────────────────────────────────────────────────
// CACHE & STORAGE POLICIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * On-disk TTL limits and path namespaces.
 * Aligned with ThumbnailCache.ts and ModelManager.ts.
 */
export const STORAGE_KEYS = {
	THUMBNAIL_PREFIX: 'thumb_meta:',
	MODEL_REGISTRY_PREFIX: 'model_meta:',
} as const

export const CACHE_POLICIES = {
	THUMB_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 Days standard expiration footprint
	MAX_TOTAL_FOOTPRINT_BYTES: 500 * 1024 * 1024, // 500 MB Local absolute soft limit cap
} as const

// ─────────────────────────────────────────────────────────────────────────────
// STYLE MODEL SAFETY FALLBACKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard fallbacks when custom model configurations are missing or corrupt.
 * Aligned with ModelManager.ts parsing blocks.
 */
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
	inferenceResolution: 512, // or 512 depending on your target baseline
	previewResolution: 256, // Missing property added
	tileOverlap: 64, // Missing property added (standard for 512/256 splits)
	luminanceBlend: 0.75,
	defaultColourMode: 'texture_only',
	preferredColourMode: 'texture_only', // Missing property added
} as const
