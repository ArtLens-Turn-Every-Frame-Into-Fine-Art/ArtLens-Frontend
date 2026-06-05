/**
 * ArtLens — useStyleFrameProcessor
 *
 * Custom hook providing a Vision Camera v5 frame processor pipeline
 * fully aligned with PRD § 2.3.1 and your package.json targets.
 */

import { useEffect, useRef } from 'react'
import { useSharedValue, SharedValue } from 'react-native-reanimated'
import { useFrameOutput } from 'react-native-vision-camera'
import { useResizer } from 'react-native-vision-camera-resizer'
import type { Frame } from 'react-native-vision-camera'

import {
	runInferenceSync,
	loadPreviewModel,
	unloadModel,
} from '@/core/inference/InferenceEngine'
import { toRGBAWorklet } from '@/shared/utils/tensorUtils'
import { useModelStore } from '@/shared/stores/useModelStore'
//import { useHardwareProfileStore } from '@/shared/stores/useHardwareProfileStore'
import type { StyleId } from '@/types'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('useFrameProcessor')

const INFERENCE_SIZE = 256

export function useStyleFrameProcessor(
	styleId: StyleId,
	skiaPixelBuffer: SharedValue<Uint8Array | null>
) {
	const isDownloaded = useModelStore((s) =>
		s.catalog.some(
			(m) => m.id === styleId && m.downloadStatus === 'downloaded'
		)
	)

	const currentStyleId = useSharedValue<StyleId | null>(null)
	const isModelLoading = useSharedValue(false)
	const loadedStyleId = useRef<StyleId | null>(null)

	const { resizer } = useResizer({
		width: INFERENCE_SIZE,
		height: INFERENCE_SIZE,
		dataType: 'float32',
		channelOrder: 'rgb',
		pixelLayout: 'interleaved',
		scaleMode: 'cover',
	})

	// Handle asynchronous model hot-swapping
	useEffect(() => {
		let isCancelled = false

		async function swapStyleModel() {
			if (!isDownloaded) {
				currentStyleId.value = null
				isModelLoading.value = false
				return
			}
			currentStyleId.value = null
			isModelLoading.value = true

			try {
				const { getModelPath } =
					await import('@/core/storage/ModelManager').catch(() => ({
						getModelPath: () => null,
					}))

				const modelSandboxPath = getModelPath(styleId, 'preview')
				if (!modelSandboxPath || isCancelled) {
					isModelLoading.value = false
					return
				}

				if (typeof loadPreviewModel === 'function') {
					await loadPreviewModel(modelSandboxPath)
				}

				if (!isCancelled) {
					loadedStyleId.current = styleId
					currentStyleId.value = styleId
					isModelLoading.value = false
					tracker.log(
						`Core Opened Successfully for style: ${styleId}`
					)
				}
			} catch (err) {
				if (!isCancelled) {
					isModelLoading.value = false
					tracker.error('Hot-swap lifecycle error:', err)
				}
			}
		}

		swapStyleModel()

		return () => {
			isCancelled = true
			if (typeof unloadModel === 'function') {
				unloadModel('preview')
			}
			loadedStyleId.current = null
		}
	}, [styleId, isDownloaded, currentStyleId, isModelLoading])

	// High-performance native frame pipeline loop
	return useFrameOutput({
		pixelFormat: 'yuv',
		onFrame: (frame: Frame) => {
			'worklet'

			// TEMPORARY DIAGNOSTIC LOG
			tracker.debug(
				`[Pipeline Check] Style: ${currentStyleId.value}, Loading: ${isModelLoading.value}`
			)

			// 1. Bypass processing if no model is fully initialized yet
			if (currentStyleId.value === null || isModelLoading.value) {
				return
			}
			// 2. Downscale input viewfinder frame to network dimensions (256x256)
			const resizedFrame = resizer?.resize(frame)
			if (!resizedFrame) return

			// 3. Fire synchronous neural network inference pass
			const rawHostBuffer = resizedFrame.getPixelBuffer()

			try {
				// Wrap the raw buffer into the typed array Fast-TFLite expects
				//const typedInputArray = new Float32Array(rawHostBuffer)
				const safeBuffer = rawHostBuffer.slice(0)
				const inferenceRawOutputs = runInferenceSync(
					'preview',
					safeBuffer
				)

				// 4. Transform raw network tensor arrays back into render-safe RGBA bytes
				// Directly update the shared buffer passed from the UI component layer
				if (skiaPixelBuffer.value) {
					toRGBAWorklet(inferenceRawOutputs, skiaPixelBuffer.value)

					// Trigger a modification notification hook to force the Skia view redraw pass
					skiaPixelBuffer.value = skiaPixelBuffer.value
				}
			} catch (error) {
				tracker.error('[FrameProcessor C++ Native Failure]:', error)

				// Force a standard fallback or remote exception capture in production
				if (!__DEV__) {
					tracker.error(
						'[useFrameProcessor] Critical Worklet Failure:',
						error
					)
					// crashlytics().recordError(error) or your choice of remote tracker
				}
			} finally {
				// 5. CRITICAL: Unlocks the resizer plugin memory context immediately
				// even if inference or buffer operations fail
				resizedFrame.dispose()
			}
		},
	})
}

export function createInferenceErrorToken() {
	return { value: false }
}
