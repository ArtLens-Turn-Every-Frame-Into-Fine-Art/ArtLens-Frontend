/**
 * @file storageKeys.ts
 * @description Global storage registry lookup indices and key namespaces for ArtLens.
 *
 * This file maintains the precise string dictionary tokens used across all MMKV
 * localized key-value stores. Keeping them centralized guarantees that no two
 * core modules accidentally cross-contaminate or overwrite their respective storage domains.
 *
 * PRD § 5 — Directory: src/shared/utils/storageKeys.ts
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. STORAGE WORKSPACE INSTANCE IDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core storage domain IDs passed during `createMMKV({ id })` invocations.
 * Separating storage instances into dedicated files optimizes on-disk I/O operations.
 *
 * CRITICAL: Every value in this object must be unique. Each string maps to a distinct
 * on-disk MMKV database file. Duplicate values would cause two logical domains to
 * share the same file, leading to key collisions and data corruption.
 */
export const STORAGE_INSTANCE_IDS = {
	THUMBNAILS: 'artlens.thumbnail_cache',
	MODELS: 'artlens-model-store',
	APP_STATE: 'artlens.global_app_state',
	HARDWARE: 'artlens.hardware',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 2. HARDWARE PROFILER KEYS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage keys utilized inside the `artlens.hardware` MMKV instance.
 * Managed by `HardwareProfiler.ts` and `useHardwareProfileStore.ts`.
 */
export const HARDWARE_KEYS = {
	/** On-disk key for the persisted HardwareProfile benchmark result (HardwareProfiler.ts) */
	PROFILE: 'artlens.hardware.profile.v1',
	/** On-disk key for the persisted HardwareBenchmarkProfile used by useHardwareProfileStore */
	BENCHMARK_PROFILE: 'app_config:hardware_benchmark_profile',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 3. THUMBNAIL CACHE WORKSPACE KEYS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage keys utilized inside the separate `artlens.thumbnail_cache` store.
 * Managed directly via `ThumbnailCache.ts`.
 */
export const THUMBNAIL_KEYS = {
	/** Prefix appended to each unique cached style ID (e.g., 'thumb_meta:vangogh') */
	REGISTRY_PREFIX: 'thumb_meta:',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 4. MODEL CATALOG AND BINARY REGISTRY KEYS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage keys utilized inside the separate `artlens-model-store` MMKV instance.
 * Managed directly via `ModelManager.ts`.
 */
export const MODEL_REGISTRY_KEYS = {
	/** Prefix prepended to all local metadata tracking frames (e.g., 'model_meta:monet') */
	ITEM_PREFIX: 'model_meta:',
	/** Tracks the exact cryptographic sync sequence timestamp from the last delta manifest lookup */
	LAST_SYNC_TIMESTAMP: 'models_manifest:last_sync_at',
	/** Tracks the HTTP ETag signature header payload from the most recent 304/200 request */
	MANIFEST_ETAG: 'models_manifest:cached_etag',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 5. GLOBAL USER STATE AND CONFIGURATION UTILITY KEYS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keys utilized inside the generic fallback `artlens.global_app_state` instance
 * for managing user preferences and background task states.
 */
export const APP_STATE_KEYS = {
	/** Stores token identifiers or profiles for the onboarding view sequence */
	HAS_COMPLETED_ONBOARDING: 'app_user:has_completed_onboarding',
	/** Tracks user-selected preferred hardware inference mode override values if any */
	USER_INFERENCE_DELEGATE_OVERRIDE: 'app_config:inference_delegate_mode',
	/** Array mapping of historical client lookups or query parameters used for tracking */
	HISTORICAL_CLIENT_HASHES: 'app_diagnostic:historical_hashes',
	/** Persistent queue storage for active and completed stylization jobs */
	STYLE_JOBS_QUEUE: 'app_queue:style_jobs_list',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// 6. UTILITY TYPE GUARDS & INSPECTORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Utility helper to determine if a generic un-sliced MMKV string key matches
 * an active thumbnail registration record footprint.
 */
export function isThumbnailRegistryKey(key: string): boolean {
	return key.startsWith(THUMBNAIL_KEYS.REGISTRY_PREFIX)
}

/**
 * Utility helper to determine if an isolated runtime string key matches
 * a downloaded style pack asset specification footprint.
 */
export function isModelRegistryKey(key: string): boolean {
	return key.startsWith(MODEL_REGISTRY_KEYS.ITEM_PREFIX)
}

/**
 * Aggregates all global storage namespace prefix constraints cleanly into an immutable configuration group.
 */
export const ALL_PROTECTED_PREFIXES: string[] = [
	THUMBNAIL_KEYS.REGISTRY_PREFIX,
	MODEL_REGISTRY_KEYS.ITEM_PREFIX,
]
