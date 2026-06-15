/**
 * 🔑 ArtLens — Global Storage Registry & Key Namespaces
 *
 * This file maintains the precise string dictionary tokens used across all MMKV
 * localized key-value stores. Keeping them centralized guarantees that no two
 * core modules accidentally cross-contaminate or overwrite their respective storage domains.
 *
 * @see PRD § 5 — Directory: src/shared/utils/storageKeys.ts
 */

import { MANIFEST_SCHEMA_VERSION } from './constants'

const V = `v${MANIFEST_SCHEMA_VERSION}`

// ============================================================================
// 1. DYNAMIC SCHEMA-VERSIONED KEYS (v2 / Current)
// ============================================================================

export const STORAGE_KEYS = {
	/**
	 * The raw, un-hydrated manifest API response (serialized JSON string).
	 * Stored for offline-first and delta-sync use.
	 * @example 'artlens:v2:manifest:raw'
	 */
	MANIFEST_RAW: `artlens:${V}:manifest:raw`,

	/**
	 * The manifest hash from the last successful sync.
	 * Used to short-circuit a full manifest fetch when the hash hasn't changed.
	 * @example 'artlens:v2:manifest:hash'
	 */
	MANIFEST_HASH: `artlens:${V}:manifest:hash`,

	/**
	 * The hydrated StyleModel[] array, serialized as JSON.
	 * This is what the UI and engine code read from — never the raw manifest.
	 * @example 'artlens:v2:models:hydrated'
	 */
	MODELS_HYDRATED: `artlens:${V}:models:hydrated`,

	/**
	 * Per-model hydrated config, keyed by id + version.
	 * Including version ensures a backend model update (version bump)
	 * automatically invalidates the cached config for that model.
	 *
	 * @example 'artlens:v2:model:baroque:2:config'
	 */
	MODEL_CONFIG: (id: string, version: number): string =>
		`artlens:${V}:model:${id}:${version}:config`,

	/**
	 * Per-model file download status.
	 * @example 'artlens:v2:model:baroque:2:download_status'
	 */
	MODEL_DOWNLOAD_STATUS: (id: string, version: number): string =>
		`artlens:${V}:model:${id}:${version}:download_status`,

	/**
	 * Per-model local file path after download.
	 * @example 'artlens:v2:model:baroque:2:local_path'
	 */
	MODEL_LOCAL_PATH: (id: string, version: number): string =>
		`artlens:${V}:model:${id}:${version}:local_path`,
} as const

// ============================================================================
// 2. STORAGE WORKSPACE INSTANCE IDS (MMKV Instances)
// ============================================================================

/**
 * Core storage domain IDs passed during `createMMKV({ id })` invocations.
 * Separating storage instances into dedicated files optimizes on-disk I/O operations.
 *
 * @critical Every value in this object must be unique. Each string maps to a distinct
 * on-disk MMKV database file. Duplicate values cause logical domain cross-contamination.
 */
export const STORAGE_INSTANCE_IDS = {
	THUMBNAILS: 'artlens.thumbnail_cache',
	MODELS: 'artlens-model-store',
	APP_STATE: 'artlens.global_app_state',
	HARDWARE: 'artlens.hardware',
} as const

// ============================================================================
// 4. THUMBNAIL CACHE WORKSPACE KEYS
// ============================================================================

/**
 * Storage keys utilized inside the separate `artlens.thumbnail_cache` store.
 * Managed directly via `ThumbnailCache.ts`.
 */
export const THUMBNAIL_KEYS = {
	/** Prefix appended to each unique cached style ID (e.g., 'thumb_meta:vangogh') */
	REGISTRY_PREFIX: 'thumb_meta:',
} as const

// ============================================================================
// 5. MODEL CATALOG AND BINARY REGISTRY KEYS
// ============================================================================

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

// ============================================================================
// 6. GLOBAL USER STATE & APP PREFERENCES
// ============================================================================

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

// ============================================================================
// 7. DATA MIGRATION UTILITIES (Legacy Data Purge)
// ============================================================================

/**
 * All legacy storage keys (schema v1 and any unversioned keys) that must
 * be purged on first launch after upgrading to schema v2.
 *
 * Extend this list whenever MANIFEST_SCHEMA_VERSION is bumped.
 */
export const LEGACY_KEYS_TO_PURGE: readonly string[] = [
	// v1 versioned keys
	'artlens:v1:manifest:raw',
	'artlens:v1:manifest:hash',
	'artlens:v1:models:hydrated',
	// Unversioned legacy keys (pre-versioning era)
	'artlens:manifest',
	'artlens:models',
	'artlens:modelConfig',
	'artlens:manifestHash',
	// Legacy cache wrappers
	'artlens:styleModels',
	'artlens:cachedModels',
]

/**
 * Purges all legacy storage keys from AsyncStorage/MMKV instances.
 * Call this once on app startup, before reading any active model data.
 *
 * @param storage - Your AsyncStorage instance (or compatible key-value store wrapper).
 */
export async function purgeLegacyStorageKeys(storage: {
	removeItem: (key: string) => Promise<void>
}): Promise<void> {
	await Promise.allSettled(
		LEGACY_KEYS_TO_PURGE.map((key) => storage.removeItem(key))
	)
}

// ============================================================================
// 8. UTILITY TYPE GUARDS & INSPECTORS
// ============================================================================

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

export const FS_CONFIG = {
	MODELS_DIRECTORY_NAME: 'artlens_models',
} as const
