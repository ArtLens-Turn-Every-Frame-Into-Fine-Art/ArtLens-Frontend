/**
 * @file ThumbnailCache.ts
 * @description Remote thumbnail image mirror management for ArtLens style cards.
 *
 * RESPONSIBILITIES:
 * - Return a local `file://` URI for a style thumbnail (downloading on demand)
 * - Prevent duplicate concurrent downloads for the same style
 * - Track cache validity using a version-aware key (re-downloads on version bump)
 * - Provide cache pruning for stale/deleted style thumbnails
 *
 * CACHE LOCATION:
 * `<CacheDirectory>/artlens_thumbs/<styleId>_v<version>.jpg`
 * Using CacheDirectory (not DocumentDirectory) allows the OS to evict
 * thumbnails under storage pressure — the app re-downloads on next render.
 *
 * @module core/storage
 */

import { createMMKV } from 'react-native-mmkv'
import { File, Directory, Paths } from 'expo-file-system'

import { StyleId } from '@/types'
import { STORAGE_KEYS, CACHE_POLICIES } from '@/shared/utils/constants'
import { STORAGE_INSTANCE_IDS } from '@/shared/utils/storageKeys'

import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('ThumbnailCache')

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ThumbnailCacheEntry {
	styleId: StyleId
	version: number
	localPath: string
	downloadedAt: number
	remoteUrl: string
}

/** Options for `getThumbnailUri()`. */
export interface GetThumbnailOptions {
	/** Remote URL to download from if not cached. */
	remoteUrl: string
	/** Style version — used to invalidate stale cached thumbnails on manifest update. */
	version: number
	/** Maximum age of cache entries before forced re-validation (in milliseconds). Default: 7 days. */
	maxAge?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/** Isolated MMKV store specifically designated for tracking thumbnail metadata footprints. */
const _storage = createMMKV({
	id: STORAGE_INSTANCE_IDS.THUMBNAILS,
})

const CACHE_REGISTRY_KEY_PREFIX = STORAGE_KEYS.THUMBNAIL_PREFIX
const DEFAULT_MAX_AGE = CACHE_POLICIES.THUMB_MAX_AGE_MS

/**
 * Global map protecting against concurrent execution conditions.
 * Prevents multiple component view layers from executing duplicate network fetches for identical assets.
 */
const _inFlightDownloads: Record<string, Promise<string>> = {}

/**
 * Resolves or builds the root absolute directory container inside the system's volatile Cache space.
 */
function _ensureThumbsDirectory(): Directory {
	const thumbsDirUri = `${Paths.cache.uri}/artlens_thumbs`
	const dir = new Directory(thumbsDirUri)
	if (!dir.exists) {
		dir.create()
	}
	return dir
}

/**
 * Builds the unique storage registry lookup path key identifier.
 */
function _makeRegistryKey(styleId: string): string {
	return `${CACHE_REGISTRY_KEY_PREFIX}${styleId}`
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CORE INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the localized file target path for a style thumbnail.
 * If the asset is missing, corrupted, or outdated, it downloads it asynchronously.
 *
 * @returns An absolute file system URI link targeting the localized asset.
 */
export async function getThumbnailUri(
	styleId: StyleId,
	options: GetThumbnailOptions
): Promise<string> {
	const registryKey = _makeRegistryKey(styleId)
	const maxAge = options.maxAge ?? DEFAULT_MAX_AGE
	const now = Date.now()

	const cachedRaw = _storage.getString(registryKey)

	if (cachedRaw) {
		try {
			const entry = JSON.parse(cachedRaw) as ThumbnailCacheEntry

			// Verify absolute freshness matrix and file persistence boundary parameters
			const isVersionMatch = entry.version === options.version
			const isFresh = now - entry.downloadedAt < maxAge
			const targetFile = new File(entry.localPath)

			if (isVersionMatch && isFresh && targetFile.exists) {
				return targetFile.uri
			}

			// Clean historical invalid context assets cleanly before execution allocations
			if (targetFile.exists) {
				targetFile.delete()
			}
		} catch {
			// Parsing crash signatures indicate corruption — safely pass through to clean re-download cycle
		}
		_storage.remove(registryKey)
	}

	// Explicit checking against undefined state rather than truthy parsing on an active object structure
	const activeInFlight = _inFlightDownloads[registryKey]
	if (activeInFlight !== undefined) {
		return activeInFlight
	}

	const downloadPromise = (async () => {
		try {
			const thumbsDir = _ensureThumbsDirectory()

			// Cleaned up split parsing chain syntax to safely extract file extension without token warnings
			const urlParts = options.remoteUrl.split('?')[0].split('.')
			const fileExtension =
				urlParts.length > 1 ? urlParts[urlParts.length - 1] : 'jpg'

			const filename = `${styleId}_v${options.version}.${fileExtension}`
			const localTargetUri = `${thumbsDir.uri}/${filename}`

			const localFile = new File(localTargetUri)

			// FIXED ts(2339): Using correct expo-file-system File.downloadAsync static factory allocation signature
			await File.downloadFileAsync(options.remoteUrl, localFile)

			const cacheEntry: ThumbnailCacheEntry = {
				styleId,
				version: options.version,
				localPath: localTargetUri,
				downloadedAt: Date.now(),
				remoteUrl: options.remoteUrl,
			}

			_storage.set(registryKey, JSON.stringify(cacheEntry))
			return localFile.uri
		} finally {
			// FIXED ts(1472): re-added missing 'finally' keyword wrapper statement
			delete _inFlightDownloads[registryKey]
		}
	})()

	_inFlightDownloads[registryKey] = downloadPromise
	return downloadPromise
}

/**
 * Sweeps and discards stale thumbnail images belonging to old manifest entries or missing models.
 * * @param activeStyles - An array containing the current list of active style variants from the manifest.
 */
export function pruneStaleThumbnails(
	activeStyles: { id: StyleId; version: number }[] // <-- Ensure the array bracket [] is preserved here
): void {
	const allKeys = _storage
		.getAllKeys()
		.filter((k: string) => k.startsWith(CACHE_REGISTRY_KEY_PREFIX))

	// FIX ts(2339): activeStyles must explicitly be handled as an array to read mapped identifiers safely
	const activeStyleIds = activeStyles.map((s) => s.id)

	for (const key of allKeys) {
		const raw = _storage.getString(key)
		if (!raw) continue

		try {
			const entry = JSON.parse(raw) as ThumbnailCacheEntry

			// If the cached thumbnail style no longer exists in the manifest, purge its asset files
			if (!activeStyleIds.includes(entry.styleId)) {
				const file = new File(entry.localPath)
				if (file.exists) {
					file.delete()
				}
				_storage.remove(key)
				continue
			}

			// Version-aware validation lookup
			const currentManifestStyle = activeStyles.find(
				(s) => s.id === entry.styleId
			)
			if (
				currentManifestStyle &&
				currentManifestStyle.version !== entry.version
			) {
				const file = new File(entry.localPath)
				if (file.exists) {
					file.delete()
				}
				_storage.remove(key)
			}
		} catch (err: any) {
			tracker.warn(
				'[ThumbnailCache] Handled exception tracking single item cache pruning:',
				err.message
			)
		} finally {
			_storage.remove(key)
		}
	}
}

/**
 * Completely drops the local layout store and clears the cache directory context space.
 */
export function clearThumbnailCache(): void {
	const allKeys = _storage
		.getAllKeys()
		.filter((k: string) => k.startsWith(CACHE_REGISTRY_KEY_PREFIX))

	for (const key of allKeys) {
		try {
			const raw = _storage.getString(key)
			if (raw) {
				const entry = JSON.parse(raw) as ThumbnailCacheEntry
				const file = new File(entry.localPath)
				if (file.exists) {
					file.delete()
				}
			}
		} catch {
			// Soft fail non-fatal single asset drop locks
		}
		_storage.remove(key)
	}

	try {
		const thumbsDirUri = `${Paths.cache.uri}/artlens_thumbs`
		const dir = new Directory(thumbsDirUri)
		if (dir.exists) {
			dir.delete()
		}
	} catch (err: any) {
		tracker.warn(
			'[ThumbnailCache] Safe system clear directory sweep exception handled:',
			err.message
		)
	}

	tracker.log(
		`[ThumbnailCache] Cache dropped cleanly. ${allKeys.length} items purged from runtime index mappings.`
	)
}

/**
 * Computes on-disk storage metrics accumulated across active tracked cache elements.
 *
 * @returns Total physical file footprint values evaluated in bytes.
 */
export function getCacheFootprint(): number {
	const allKeys = _storage
		.getAllKeys()
		.filter((k: string) => k.startsWith(CACHE_REGISTRY_KEY_PREFIX))

	let totalBytes = 0

	for (const key of allKeys) {
		const raw = _storage.getString(key)
		if (!raw) continue
		try {
			const entry = JSON.parse(raw) as ThumbnailCacheEntry
			const file = new File(entry.localPath)
			if (file.exists) {
				totalBytes += file.size
			}
		} catch {
			// Discard corrupted structural metadata elements gracefully from computation passes
			tracker.warn(
				`[ThumbnailCache] Evicting corrupted cache metadata key: ${key}`
			)
			_storage.remove(key) // Automatically cleans up the invalid database state
		}
	}

	return totalBytes
}
