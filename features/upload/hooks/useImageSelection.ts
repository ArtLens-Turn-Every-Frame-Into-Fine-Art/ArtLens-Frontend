/**
 * ArtLens — useImageSelection
 *
 * HomeScreen interaction hook. Manages the local loading state, surfaces
 * native picker errors as user-facing strings, and orchestrates the
 * parameter-driven navigation hand-off to the StyleSelectionScreen.
 *
 * This hook owns exactly one responsibility: bridge the MediaPicker utility
 * call into the navigation graph. It never touches the job queue directly —
 * queue commitment happens in StyleSelectionScreen once a style is confirmed.
 *
 * Return contract:
 *   pickImage   — async function to call from any tap gesture
 *   isPicking   — true while the permission dialog or picker sheet is open
 *   error       — non-null string when the last invocation failed
 *   clearError  — resets the error state (call from error banner dismiss)
 *
 * PRD § Features — Directory: src/features/upload/hooks/useImageSelection.ts
 */

import { useState, useCallback } from 'react'
import { MediaPicker, MediaPermissionError } from '@/shared/utils/MediaPicker'
import { useRouter } from 'expo-router'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('useImageSelection')

// ─────────────────────────────────────────────────────────────────────────────
// RETURN TYPE
// ─────────────────────────────────────────────────────────────────────────────

export interface UseImageSelectionReturn {
	/** Opens the native gallery picker and navigates to StyleSelection on success. */
	pickImage: () => Promise<void>
	/** True while the permission prompt or the system gallery sheet is active. */
	isPicking: boolean
	/** Non-null when the last pickImage() call failed. Display in UI, reset with clearError(). */
	error: string | null
	/** Resets the error state to null. Call when the user dismisses an error banner. */
	clearError: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param navigation - React Navigation navigation object (stack or tab navigator).
 *                     Typed as `any` to remain agnostic of the navigator stack depth
 *                     and avoid importing the Expo Router type tree in a shared hook.
 *                     The only call made is navigation.navigate('StyleSelection', {...}).
 */
export function useImageSelection(): UseImageSelectionReturn {
	const [isPicking, setIsPicking] = useState<boolean>(false)
	const [error, setError] = useState<string | null>(null)
	const router = useRouter()

	const clearError = useCallback((): void => {
		setError(null)
	}, [])

	const pickImage = useCallback(async (): Promise<void> => {
		// Prevent double-tap re-entry. If a pick operation is already in progress,
		// return immediately without opening a second picker sheet.
		if (isPicking) {
			return
		}

		// ── 1. Open loading state ─────────────────────────────────────────────
		// Clear any stale error from a previous failed attempt, then signal that
		// an async operation is in flight.
		setError(null)
		setIsPicking(true)

		try {
			// ── 2. Invoke native picker ─────────────────────────────────────────
			const selectedUri = await MediaPicker.launchGallery()

			// ── 3. Cancellation guard ───────────────────────────────────────────
			// If the user dismissed the picker without selecting a photo, return
			// gracefully. isPicking is reset in the finally block.
			if (selectedUri === null) {
				return
			}

			// ── 4. Navigate to StyleSelectionScreen ────────────────────────────
			// Pass the raw local URI as a navigation parameter. The StyleSelection
			// screen reads this to display the thumbnail and construct the JobPayload.
			//
			// NOTE: Navigation is called before isPicking is reset (which happens
			// in the finally block). The state reset fires during the navigation
			// transition, which is correct — the HomeScreen is pushed off the stack
			// before the next render cycle.
			router.push({
				pathname: '/StyleSelectionScreen',
				params: { sourceUri: selectedUri },
			})
		} catch (caughtError: any) {
			tracker.error(caughtError)
			// ── 5. Typed error handling ─────────────────────────────────────────
			if (caughtError instanceof MediaPermissionError) {
				// The user explicitly denied access to the photo library.
				// Surface the human-readable message from the typed error.
				setError(caughtError.message)
			} else if (caughtError instanceof Error) {
				// An unexpected runtime error from the native picker layer
				// (e.g., picker process killed, storage unavailable).
				setError(
					`Unable to open the photo library. ${caughtError.message}`
				)
			} else {
				// Truly unknown rejection value.
				setError(
					'An unexpected error occurred while opening the photo library. Please try again.'
				)
			}
		} finally {
			// ── 6. Always reset loading flag ────────────────────────────────────
			// Executed whether the pick succeeded, was cancelled, or threw an error.
			// This guarantees the loading spinner is never left in a stuck state.
			setIsPicking(false)
		}
	}, [isPicking, router])

	return {
		pickImage,
		isPicking,
		error,
		clearError,
	}
}
