/**
 * ArtLens — MediaPicker
 *
 * Secure, production-grade native gallery asset acquisition layer.
 * Provides a single async surface for obtaining a clean, absolute local file
 * URI from the device photo library. All permission barriers, OS activity
 * recovery, and cancellation paths are fully handled internally.
 *
 * Architecture:
 *   - Zero UI coupling. Pure imperative utility; no hooks, no React lifecycle.
 *   - Called exclusively by useImageSelection.ts.
 *   - Returns a clean `file://` or `content://` URI on success, null on
 *     user cancellation, and throws a typed PermissionError on denial.
 *
 * PRD § Features — Directory: src/shared/utils/MediaPicker.ts
 */

import * as ImagePicker from 'expo-image-picker'

// ─────────────────────────────────────────────────────────────────────────────
// TYPED ERROR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when the user has denied media library access either on the
 * initial permission prompt or in system settings.
 *
 * Caught by useImageSelection.ts and surfaced as a user-facing error string.
 */
export class MediaPermissionError extends Error {
	constructor() {
		super(
			'Photo library access was denied. Please enable it in your device Settings to import photos.'
		)
		this.name = 'MediaPermissionError'
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// ANDROID ACTIVITY RESURRECTION GUARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * On Android, if the host Activity was destroyed by the OS while the native
 * gallery picker was foregrounded (e.g., due to low-memory reclamation), the
 * result is delivered asynchronously via a pending result mechanism rather than
 * through the normal picker return path.
 *
 * This function must be called ONCE on app initialization (before any picker
 * invocation) to flush any outstanding pending result. If a result is present
 * it is returned immediately, bypassing a fresh picker launch.
 *
 * Returns the rescued URI string, or null if no pending result exists.
 */
async function recoverPendingAndroidResult(): Promise<string | null> {
	try {
		const pending = await ImagePicker.getPendingResultAsync()

		// getPendingResultAsync() returns an array when results are pending.
		if (!pending || !Array.isArray(pending) || pending.length === 0) {
			return null
		}

		// Inspect the first pending result. If it is a non-cancelled image pick,
		// extract and return the URI.
		const first = pending[0]
		if (
			first &&
			!first.canceled &&
			first.assets &&
			first.assets.length > 0 &&
			typeof first.assets[0].uri === 'string' &&
			first.assets[0].uri.length > 0
		) {
			return first.assets[0].uri
		}

		return null
	} catch {
		// getPendingResultAsync may throw on iOS (where it is a no-op) or in
		// environments where the underlying native method is not available.
		// Swallow silently — the absence of a pending result is not a failure.
		return null
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export const MediaPicker = {
	/**
	 * Opens the native device photo library picker and returns the URI of the
	 * selected image, or null if the user cancelled without selecting.
	 *
	 * Execution order:
	 *   1. Check for Android Activity resurrection pending result.
	 *   2. Request media library permissions (prompts first time; reads cache subsequently).
	 *   3. Launch the picker with production-safe configuration.
	 *   4. Guard against cancellation and return the clean URI.
	 *
	 * @throws {MediaPermissionError} When the user has denied media library access.
	 * @returns {Promise<string | null>} Absolute local URI on success, null on cancel.
	 */
	launchGallery: async (): Promise<string | null> => {
		// ── Step 1: Android Activity resurrection recovery ──────────────────────
		// Attempt to recover a pending result from a previous picker session whose
		// host Activity was recycled by the OS. If a valid URI is recovered, return
		// it immediately — no need to re-launch the picker.
		const rescued = await recoverPendingAndroidResult()
		if (rescued !== null) {
			return rescued
		}

		// ── Step 2: Permission gate ─────────────────────────────────────────────
		// requestMediaLibraryPermissionsAsync() returns the cached status if the
		// user has already responded to the prompt. It only shows the system dialog
		// on the first call (or after the user navigates to Settings and back).
		const permissionResult =
			await ImagePicker.requestMediaLibraryPermissionsAsync()

		if (permissionResult.status !== 'granted') {
			// The permission was denied or restricted. Throw a typed, catchable
			// error that useImageSelection will surface to the UI.
			throw new MediaPermissionError()
		}

		// ── Step 3: Launch the native picker ────────────────────────────────────
		// Configuration rationale:
		//   mediaTypes: ['images']     — Exclude video and GIF streams; ArtLens
		//                                only processes static photographic frames.
		//   allowsEditing: false       — Suppress the built-in OS crop/rotate UI.
		//                                StyleJobService handles all tile division
		//                                and spatial transforms mathematically.
		//   quality: 1                 — Full native resolution; no re-encode pass.
		//                                Any quality reduction here propagates as
		//                                compression artifacts through the Teacher
		//                                model's tiling pipeline.
		//   allowsMultipleSelection: false — Enforce single-asset selection. The
		//                                    StyleSelection flow is keyed to one
		//                                    sourceUri per enqueue transaction.
		//   exif: false                — Skip EXIF extraction; we don't need it
		//                                and it saves time on large RAW files.
		const result = await ImagePicker.launchImageLibraryAsync({
			mediaTypes: ['images'],
			allowsEditing: false,
			quality: 1,
			allowsMultipleSelection: false,
			exif: false,
		})

		// ── Step 4: Cancellation guard ───────────────────────────────────────────
		// If the user dismissed the picker without selecting an asset, return null.
		// This is a normal UX path, not an error — calling code must handle null.
		if (result.canceled) {
			return null
		}

		// ── Step 5: URI extraction ───────────────────────────────────────────────
		// The assets array is guaranteed to have exactly one entry because
		// allowsMultipleSelection is false, but we guard defensively regardless.
		if (!result.assets || result.assets.length === 0) {
			return null
		}

		const selectedAsset = result.assets[0]

		if (
			!selectedAsset ||
			typeof selectedAsset.uri !== 'string' ||
			selectedAsset.uri.trim().length === 0
		) {
			return null
		}

		return selectedAsset.uri
	},
}
