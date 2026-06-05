/**
 * @file useIncomingImage.ts
 * @description State handlers for images arriving via share intent actions or custom deep-linking schemes.
 *
 * PRD § 5.2 — Directory: src/shared/hooks/useIncomingImage.ts
 */

import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { useShareIntentContext } from 'expo-share-intent'
import { File, Directory, Paths } from 'expo-file-system'
import type { IncomingImageState } from '@/types'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('useIncomingImage')

// Implement module-level singleton state leveraging the exact layout interface properties of index.ts
let _pendingState: IncomingImageState = {
	uri: null,
	filename: null,
}

const _listeners = new Set<() => void>()

function notifyListeners(): void {
	_listeners.forEach((callback) => callback())
}

export const IncomingImageStateDispatcher = {
	get(): IncomingImageState {
		return _pendingState
	},
	set(uri: string, filename: string): void {
		_pendingState = { uri, filename }
		notifyListeners()
	},
	clear(): void {
		_pendingState = { uri: null, filename: null }
		notifyListeners()
	},
}

export function useIncomingImage() {
	const [state, setState] = useState<IncomingImageState>(
		IncomingImageStateDispatcher.get()
	)

	useEffect(() => {
		const handleUpdate = () => setState(IncomingImageStateDispatcher.get())
		_listeners.add(handleUpdate)
		return () => {
			_listeners.delete(handleUpdate)
		}
	}, [])

	return {
		pendingImage: state.uri ? state : null,
		clearPendingImage: IncomingImageStateDispatcher.clear,
	}
}

export function useIncomingImageListener() {
	const { hasShareIntent, shareIntent, resetShareIntent, error } =
		useShareIntentContext()

	useEffect(() => {
		if (!hasShareIntent) return

		if (error) {
			tracker.warn(
				'[useIncomingImageListener] Intercepted share-intent error payload channel:',
				error as any
			)
			resetShareIntent()
			return
		}

		const files = shareIntent?.files
		if (!files || files.length === 0) {
			resetShareIntent()
			return
		}

		// Look for valid incoming images based on standard mime types and file extensions
		const viableImage = files.find(
			(file) =>
				file.mimeType?.startsWith('image/') ||
				/\.(png|jpe?g|webp|heic|heif)$/i.test(file.path ?? '')
		)

		if (!viableImage?.path) {
			resetShareIntent()
			return
		}

		const derivedFilename =
			(viableImage.fileName ?? viableImage.path)
				.split('/')
				.pop()
				?.replace(/\.[^/.]+$/, '') || 'shared_artwork'

		try {
			// Step 1: Extract file extension from path or mimeType
			const pathExtMatch = viableImage.path.match(/\.([^./]+)$/)
			const mimeExtMap: Record<string, string> = {
				'image/jpeg': '.jpg',
				'image/jpg': '.jpg',
				'image/png': '.png',
				'image/webp': '.webp',
				'image/heic': '.heic',
				'image/heif': '.heif',
			}
			const extSuffix = pathExtMatch
				? `.${pathExtMatch[1]}`
				: (viableImage.mimeType &&
						mimeExtMap[viableImage.mimeType.toLowerCase()]) ||
					'.jpg'

			// Step 2: Ensure the incoming_intents cache directory exists
			const incomingDir = new Directory(Paths.cache, 'incoming_intents')

			// Step 3: Create directory if it does not exist
			if (!incomingDir.exists) {
				incomingDir.create({ intermediates: true, idempotent: true })
			}

			// Step 4: Instantiate source file from the external URI
			const sourceFile = new File(viableImage.path)

			// Step 5: Instantiate destination file in the sandbox
			const destFile = new File(
				incomingDir.uri,
				derivedFilename + extSuffix
			)

			// Step 6: Synchronous OO copy matching ModelManager.ts pattern
			sourceFile.copy(destFile)

			// Step 7: Capture the sandboxed URI
			const sandboxedUri = destFile.uri

			// Step 8: Dispatch sandboxed URI (not the original external URI) to state observers
			IncomingImageStateDispatcher.set(sandboxedUri, derivedFilename)

			// Step 9: Navigate to Style Selection so the user can choose a style
			router.push('/styles')
		} catch (err) {
			tracker.error(
				'[useIncomingImageListener] Failed to sandbox, enqueue, or pump incoming image:',
				err
			)
		} finally {
			// Always flush the share-intent context regardless of success or failure
			resetShareIntent()
		}
	}, [hasShareIntent, shareIntent, error, resetShareIntent])
}
