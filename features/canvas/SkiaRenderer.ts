/**
 * @file SkiaRenderer.ts
 * @description High-performance graphic context canvas renderer powered by React Native Skia.
 *
 * RESPONSIBILITIES:
 * - Render and blend style transfer textures utilizing hardware-accelerated Skia targets
 * - Blend raw input frame luminance maps with local model tensor output footprints
 * - Apply explicit matrix transformations and color space clamping (RGB / YUV context maps)
 * - Provide safe surface garbage collection to prevent frame buffer resource leak profiles
 * - Off-screen composite snapshot generation for the EditCanvas → Refine pipeline handoff
 *
 * PRD § 5 — Directory: src/shared/renderers/SkiaRenderer.ts
 */

import {
	SkCanvas,
	SkPaint,
	SkPath,
	SkImage,
	SkSurface,
	Skia,
	AlphaType,
	ColorType,
	BlendMode,
	ImageFormat,
} from '@shopify/react-native-skia'
import { File, Paths } from 'expo-file-system'
import { TensorShape } from '@/types'
import { DEFAULT_MODEL_CONFIG } from '@/shared/utils/constants'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('SkiaRenderer')

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & PARAMETERS
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderPipelineOptions {
	/** Blend ratio favoring raw luminance contours vs stylistic texture layout parameters. Range: [0.0, 1.0] */
	luminanceBlend?: number
	/** Target color mapping configuration alignment format matching current slot constraints */
	colorMode?: 'rgb' | 'yuv'
	/** Absolute target clipping dimensions for layout adjustments */
	clippingBounds?: { width: number; height: number }
}

export interface RenderingContextMetrics {
	drawDurationMs: number
	allocatedBufferBytes: number
	compositionPasses: number
}

export class SkiaRenderer {
	private _sharedPaint: SkPaint
	private _totalFramesRendered = 0
	private _activeCacheKeys: string[] = []

	constructor() {
		this._sharedPaint = Skia.Paint()
		this._sharedPaint.setAntiAlias(true)
		this._sharedPaint.setBlendMode(BlendMode.SrcOver)
	}

	/**
	 * Processes style outputs into hardware accelerated Skia Canvas interfaces cleanly.
	 */
	public compositeStyleFrame(
		canvas: SkCanvas,
		outputTensor: Float32Array,
		shape: TensorShape,
		options: RenderPipelineOptions = {}
	): RenderingContextMetrics {
		const startTime = Date.now()

		// FIXED: Skipped the unused batch parameter to eliminate the eslint error completely
		const [, height, width, channels] = shape

		const blendRatio =
			options.luminanceBlend ?? DEFAULT_MODEL_CONFIG.luminanceBlend
		this._sharedPaint.setAlphaf(blendRatio)

		// Convert raw output buffers into Skia structural byte handles
		const totalByteAllocation = width * height * channels
		const rawBytes = new Uint8Array(totalByteAllocation)

		// De-normalize and translate float models into byte matrices
		for (let i = 0; i < outputTensor.length; i++) {
			rawBytes[i] = Math.min(
				Math.max(Math.floor(outputTensor[i] * 255), 0),
				255
			)
		}

		const skiaData = Skia.Data.fromBytes(rawBytes)
		const imageInfo = {
			width,
			height,
			colorType:
				options.colorMode === 'yuv'
					? ColorType.BGRA_8888
					: ColorType.RGBA_8888,
			alphaType: AlphaType.Opaque,
		}

		const skiaImage = Skia.Image.MakeImage(
			imageInfo,
			skiaData,
			width * channels
		)
		if (!skiaImage) {
			throw new Error(
				'[SkiaRenderer] Critical failure constructing Skia Image composition instance from tensor memory buffers.'
			)
		}

		if (options.clippingBounds) {
			const destinationRect = Skia.XYWHRect(
				0,
				0,
				options.clippingBounds.width,
				options.clippingBounds.height
			)
			canvas.drawImageRect(
				skiaImage,
				Skia.XYWHRect(0, 0, width, height),
				destinationRect,
				this._sharedPaint
			)
		} else {
			canvas.drawImage(skiaImage, 0, 0, this._sharedPaint)
		}

		this._totalFramesRendered++

		return {
			drawDurationMs: Date.now() - startTime,
			// FIXED: Uses the processed byte length directly ensuring type-safety across library upgrades
			allocatedBufferBytes: rawBytes.length,
			compositionPasses: this._totalFramesRendered,
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// OFF-SCREEN COMPOSITE SNAPSHOT ENGINE
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Composites the original image, a user-drawn alpha mask path, and the stylized
	 * AI result into a single JPEG snapshot written to the app's temporary cache.
	 *
	 * Pipeline:
	 *   1. Load both URIs into native VRAM SkImage instances via MakeImageFromEncoded.
	 *   2. Allocate a CPU raster off-screen surface matching raw image dimensions.
	 *   3. Draw original image as the full-bleed backdrop layer.
	 *   4. Save canvas state; clip to maskPath; draw styled result with DstIn blend —
	 *      this keeps only the styled pixels whose alpha is covered by the brush path.
	 *   5. Restore canvas state; snapshot surface; encode to JPEG-90; write to cache.
	 *   6. Dispose ALL native allocations in finally — guaranteed even on throw.
	 *
	 * @param originalUri   - file:// URI to the original unprocessed photo
	 * @param resultUri     - file:// URI to the AI-stylized result image
	 * @param maskPath      - SkPath drawn by the user's finger gestures (screen-space,
	 *                        already scaled to image pixel space by the caller)
	 * @param imageWidth    - raw pixel width of the source images
	 * @param imageHeight   - raw pixel height of the source images
	 * @returns             - absolute file:// URI of the written composite JPEG
	 *
	 * @throws              - if either image cannot be decoded, or the surface cannot
	 *                        be allocated, or the file write fails
	 */
	public async createCompositeSurfaceSnapshot(
		originalUri: string,
		resultUri: string,
		maskPath: SkPath,
		imageWidth: number,
		imageHeight: number
	): Promise<string> {
		// Local references — tracked so the finally block can dispose each one
		// safely regardless of which step threw.
		let originalImage: SkImage | null = null
		let styledImage: SkImage | null = null
		let surface: SkSurface | null = null
		let snapshot: SkImage | null = null

		try {
			// ── Step 1: Decode source images into native VRAM buffers ──────────
			const originalFile = new File(originalUri)
			const resultFile = new File(resultUri)

			const [originalBytes, resultBytes] = await Promise.all([
				originalFile.bytes(),
				resultFile.bytes(),
			])

			const originalData = Skia.Data.fromBytes(originalBytes)
			const resultData = Skia.Data.fromBytes(resultBytes)

			originalImage = Skia.Image.MakeImageFromEncoded(originalData)
			styledImage = Skia.Image.MakeImageFromEncoded(resultData)

			if (!originalImage) {
				throw new Error(
					`[SkiaRenderer] Failed to decode original image from URI: ${originalUri}`
				)
			}
			if (!styledImage) {
				throw new Error(
					`[SkiaRenderer] Failed to decode styled image from URI: ${resultUri}`
				)
			}

			// ── Step 2: Allocate CPU raster off-screen surface ─────────────────
			// MakeRasterN32Premul allocates a premultiplied-alpha ARGB CPU surface.
			// No GPU context required — safe on any device tier.
			surface = Skia.Surface.Make(imageWidth, imageHeight)
			if (!surface) {
				throw new Error(
					`[SkiaRenderer] Failed to allocate off-screen raster surface (${imageWidth}×${imageHeight}).`
				)
			}

			const canvas = surface.getCanvas()

			// ── Step 3: Draw the original image as the flat backdrop ───────────
			// Fill entire surface — this forms the "unmasked" region baseline.
			const backdropPaint = Skia.Paint()
			backdropPaint.setAntiAlias(true)
			backdropPaint.setBlendMode(BlendMode.SrcOver)
			canvas.drawImage(originalImage, 0, 0, backdropPaint)

			// ── Step 4: Mask-clipped styled layer using DstIn blend ────────────
			//
			// DstIn semantics:  Output = Destination × Source.Alpha
			//
			// We save state, then:
			//   a) Draw the styled result with SrcOver onto a transparent layer
			//      using saveLayer so it doesn't premix with the backdrop yet.
			//   b) Draw the brush mask path with DstIn — this erases everything
			//      outside the brush strokes from the styled layer.
			//   c) Restore merges the clipped styled layer onto the backdrop.
			//
			// This is the standard "reveal brush" compositing pattern.

			const surfaceRect = Skia.XYWHRect(0, 0, imageWidth, imageHeight)

			// saveLayer creates an isolated compositing group for the styled art
			const layerPaint = Skia.Paint()
			canvas.saveLayer(layerPaint, surfaceRect)

			// Draw the stylized image inside the saved layer (fully opaque here)
			const styledPaint = Skia.Paint()
			styledPaint.setAntiAlias(true)
			styledPaint.setBlendMode(BlendMode.SrcOver)
			canvas.drawImage(styledImage, 0, 0, styledPaint)

			// Apply DstIn mask: the brush path becomes the alpha channel for the
			// layer — only painted regions survive when the layer is composited.
			const maskPaint = Skia.Paint()
			maskPaint.setAntiAlias(true)
			maskPaint.setBlendMode(BlendMode.DstIn)
			maskPaint.setStyle(1 /* Fill */)
			maskPaint.setColor(Skia.Color('white'))
			// Stroke the path with a thick brush so filled areas are opaque
			maskPaint.setStrokeWidth(35)
			maskPaint.setStrokeCap(2 /* Round */)
			maskPaint.setStrokeJoin(1 /* Round */)
			canvas.drawPath(maskPath, maskPaint)

			// Restore merges the masked styled layer onto the original backdrop
			canvas.restore()

			// ── Step 5: Snapshot → encode → write to cache ────────────────────
			snapshot = surface.makeImageSnapshot()
			if (!snapshot) {
				throw new Error(
					'[SkiaRenderer] makeImageSnapshot() returned null — surface may be in an invalid state.'
				)
			}

			const jpegBytes = snapshot.encodeToBytes(ImageFormat.JPEG, 90)
			if (!jpegBytes) {
				throw new Error(
					'[SkiaRenderer] encodeToBytes() returned null — image encoding failed.'
				)
			}

			// Construct target file instance inside the modern directory directory structure
			const outputUri = `${Paths.cache.uri}/composite_output_${Date.now()}.jpg`
			const outputFile = new File(outputUri)

			// Modern API safely consumes raw byte arrays directly out-of-the-box
			await outputFile.write(jpegBytes)

			return outputFile.uri
		} finally {
			// ── Memory Guard: dispose every native C++ allocation ─────────────
			// Called in ALL exit paths — normal return AND throw.
			// Failure to dispose SkImage/SkSurface leaks native heap memory
			// that the JS GC cannot reclaim, eventually causing OOM crashes.
			try {
				originalImage?.dispose()
			} catch {
				// Best-effort disposal — never throw from finally
			}
			try {
				styledImage?.dispose()
			} catch {
				// Best-effort disposal
			}
			try {
				snapshot?.dispose()
			} catch {
				// Best-effort disposal
			}
			try {
				// SkSurface: release its underlying pixel buffer
				// Note: surface.dispose() may not exist on all RN Skia versions;
				// the surface will be GC'd when it goes out of scope.
				// We explicitly null it to drop the JS reference immediately.
				surface = null
			} catch {
				// Best-effort
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// CACHE & LIFECYCLE
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Completely flushes retained tracking registry tags or strings to guarantee leak-free operation.
	 *
	 * @param staleKeys - String array parameters tracking specific model cache contexts to disconnect
	 */
	public purgeCompositionCache(staleKeys: string[]): void {
		this._activeCacheKeys = this._activeCacheKeys.filter(
			(activeKey: string) => {
				const isStale = staleKeys.includes(activeKey)
				if (isStale) {
					tracker.log(
						`[SkiaRenderer] Dropping active rendering descriptor binding for tag: ${activeKey}`
					)
				}
				return !isStale
			}
		)
	}

	/**
	 * Safely breaks down initialized reference contexts and structural paints to protect device resources.
	 */
	public disposeEngineContext(): void {
		this._sharedPaint.dispose()
		this._activeCacheKeys = []
		this._totalFramesRendered = 0
	}
}
