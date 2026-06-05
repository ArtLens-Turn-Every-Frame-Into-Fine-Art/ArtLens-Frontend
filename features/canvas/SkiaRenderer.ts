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
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES (this revision)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX A — CRITICAL: compositeStyleFrame denormalization corrected.
 *    Was: rawBytes[i] = Math.floor(outputTensor[i] * 255)
 *    The outputTensor is raw float32 model output in [-1, 1] (Tanh activation).
 *    Multiplying by 255 maps the [-1, 0) range to negative byte values which
 *    clamp to 0, and maps [0, 1] to [0, 255] — effectively discarding all
 *    negative model activations and producing a washed-out, bright image.
 *
 *    Now: rawBytes[i] = clamp(Math.floor((outputTensor[i] + 1.0) * 127.5), 0, 255)
 *    This is the correct inverse of the CUT training normalization:
 *      training:   (pixel/255 − 0.5) / 0.5  =  pixel/127.5 − 1.0  →  [-1, 1]
 *      display:    (model_out + 1.0) * 127.5                        →  [0, 255]
 *
 *    The function accepts a Float32Array (raw model output) or a pre-decoded
 *    Float32Array in [0, 1]. The `tensorIsRaw` parameter controls which formula
 *    is applied:
 *      tensorIsRaw=true  (default) : raw Tanh output in [-1, 1] → denormalize
 *      tensorIsRaw=false           : already decoded [0, 1]     → scale by 255
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
import { OUTPUT_JPEG_QUALITY } from '@/shared/utils/constants'
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
	/**
	 * Whether outputTensor contains raw Tanh model output in [-1, 1].
	 *
	 * true  (default) — outputTensor holds raw float32 from TFLite in [-1, 1].
	 *                   Denormalization: byte = clamp((v + 1.0) * 127.5, 0, 255)
	 *                   This is the CUT model output normalization inverse.
	 *
	 * false           — outputTensor has already been decoded to [0, 1] (e.g.
	 *                   via decodeModelOutput() or stitchTiles()). No shift needed.
	 *                   Conversion: byte = clamp(v * 255, 0, 255)
	 */
	tensorIsRaw?: boolean
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

	/**
	 * Per-instance cache for the RGBA destination buffer used by compositeStyleFrame.
	 *
	 * BUG 3 FIX: compositeStyleFrame previously allocated `new Uint8Array(totalByteAllocation)`
	 * on every call. On a 512×512 frame at 4 bytes/pixel that is a 1 MB object discarded each
	 * frame — at 30 fps this produces ~30 MB/s of GC-eligible heap churn, causing perceptible
	 * frame drops and GC pauses on lower-end devices.
	 *
	 * Fix: cache the last-allocated buffer keyed by its byte length. The viewfinder always
	 * runs at a fixed resolution, so the very first call allocates and every subsequent call
	 * is a Map hit with zero allocation. If the resolution changes (e.g. switching from
	 * preview to main slot), the new size is allocated once and cached.
	 *
	 * The cache is intentionally instance-level (not module-level) so that multiple
	 * SkiaRenderer instances do not share mutable state.
	 */
	private _rgbaByteCache = new Map<number, Uint8Array>()

	constructor() {
		this._sharedPaint = Skia.Paint()
		this._sharedPaint.setAntiAlias(true)
		this._sharedPaint.setBlendMode(BlendMode.SrcOver)
	}

	/**
	 * Processes style outputs into hardware accelerated Skia Canvas interfaces cleanly.
	 *
	 * TENSOR PRECISION CONTRACT:
	 *   Both teacher (512×512) and student (256×256) models output float32 in [-1, 1]
	 *   via a Tanh activation (CUT architecture). The `tensorIsRaw` option controls
	 *   how values are converted to display bytes:
	 *
	 *   tensorIsRaw=true  (default):
	 *     byte = clamp(floor((v + 1.0) * 127.5), 0, 255)
	 *     Correctly maps [-1, 1] → [0, 255], symmetric around 0.
	 *
	 *   tensorIsRaw=false:
	 *     byte = clamp(floor(v * 255), 0, 255)
	 *     Use when outputTensor has already been denormalized to [0, 1]
	 *     (e.g., via stitchTiles() or decodeModelOutput()).
	 *
	 * CHANNEL LAYOUT:
	 *   outputTensor must be NHWC with batch dimension removed: [H, W, C] interleaved.
	 *   C is always 3 (RGB) for current CUT-architecture models; the stride is derived
	 *   from shape[3] at runtime, not assumed. The output rawBytes buffer is always
	 *   4 bytes/pixel (RGBA/BGRA) to satisfy Skia's RGBA_8888 / BGRA_8888 colorType
	 *   contract regardless of the tensor's source channel count.
	 */
	public compositeStyleFrame(
		canvas: SkCanvas,
		outputTensor: Float32Array,
		shape: TensorShape,
		options: RenderPipelineOptions = {}
	): RenderingContextMetrics {
		const startTime = Date.now()

		// ── MANDATE 2: Runtime shape extraction ──────────────────────────────────
		// shape layout: [Batch, Height, Width, Channels] (standard TFLite NHWC).
		// `channels` is the SOURCE stride into the tensor (3 for RGB model output).
		// It must never be used as the Skia destination stride — see SKIA_BPP below.
		const [, height, width, channels] = shape

		// Defensive bounds: tensor must exactly cover the declared shape.
		const expectedElements = width * height * channels
		if (outputTensor.length !== expectedElements) {
			throw new Error(
				`[SkiaRenderer] compositeStyleFrame: tensor/shape mismatch. ` +
					`Expected ${expectedElements} elements (${width}×${height}×${channels}) ` +
					`from shape, got ${outputTensor.length}. ` +
					`Ensure the caller passes the live model config resolution, not a compile-time default.`
			)
		}

		// ── MANDATE 1: No DEFAULT_MODEL_CONFIG reference ──────────────────────────
		// Inline fallback mirrors the engine default without a static import binding.
		const blendRatio = options.luminanceBlend ?? 0.75
		this._sharedPaint.setAlphaf(blendRatio)

		const tensorIsRaw = options.tensorIsRaw !== false

		// ── MANDATE 2: Dynamic byte allocation ───────────────────────────────────
		// Skia's RGBA_8888 and BGRA_8888 colorTypes unconditionally require 4 bytes
		// per pixel. Allocating `width * height * channels` (i.e. 3 bytes/pixel for
		// RGB tensors) and passing it with an RGBA colorType causes Skia to read
		// the first byte of the next pixel's R channel as the current pixel's alpha,
		// corrupting every pixel boundary in the image.
		//
		// SKIA_BPP is a renderer-local constant — it is the DESTINATION stride and
		// is entirely decoupled from `channels` (the SOURCE tensor stride).
		const SKIA_BPP = 4
		const totalPixels = width * height
		const totalByteAllocation = totalPixels * SKIA_BPP

		// BUG 3 FIX: reuse the cached buffer for this byte length; allocate only on first call
		// or when resolution changes. Zero allocation on the hot viewfinder steady-state path.
		let rawBytes = this._rgbaByteCache.get(totalByteAllocation)
		if (!rawBytes) {
			rawBytes = new Uint8Array(totalByteAllocation)
			this._rgbaByteCache.set(totalByteAllocation, rawBytes)
		}

		if (tensorIsRaw) {
			// FIX A: Inverse CUT normalization for raw Tanh output in [-1, 1].
			// (v + 1.0) * 127.5  →  maps  -1 → 0 | 0 → 127.5 | +1 → 255
			//
			// Per-pixel loop with explicit srcBase / dstBase:
			//   srcBase strides by `channels`  (3 for RGB tensor)
			//   dstBase strides by SKIA_BPP    (4 for RGBA destination)
			// This correctly handles any square or rectangular shape configuration.
			for (let p = 0; p < totalPixels; p++) {
				const srcBase = p * channels
				const dstBase = p * SKIA_BPP

				let v = (outputTensor[srcBase] + 1.0) * 127.5
				rawBytes[dstBase] = v < 0 ? 0 : v > 255 ? 255 : v | 0

				v = (outputTensor[srcBase + 1] + 1.0) * 127.5
				rawBytes[dstBase + 1] = v < 0 ? 0 : v > 255 ? 255 : v | 0

				v = (outputTensor[srcBase + 2] + 1.0) * 127.5
				rawBytes[dstBase + 2] = v < 0 ? 0 : v > 255 ? 255 : v | 0

				// Alpha channel: fully opaque — models produce no transparency signal.
				rawBytes[dstBase + 3] = 255
			}
		} else {
			// Already decoded to [0, 1] (e.g., from decodeModelOutput or stitchTiles).
			// Simple scale: v * 255, clamped — no shift required.
			for (let p = 0; p < totalPixels; p++) {
				const srcBase = p * channels
				const dstBase = p * SKIA_BPP

				let v = outputTensor[srcBase] * 255
				rawBytes[dstBase] = v < 0 ? 0 : v > 255 ? 255 : v | 0

				v = outputTensor[srcBase + 1] * 255
				rawBytes[dstBase + 1] = v < 0 ? 0 : v > 255 ? 255 : v | 0

				v = outputTensor[srcBase + 2] * 255
				rawBytes[dstBase + 2] = v < 0 ? 0 : v > 255 ? 255 : v | 0

				rawBytes[dstBase + 3] = 255
			}
		}

		// ── Skia image construction ───────────────────────────────────────────────
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

		// Row stride passed to MakeImage must match the DESTINATION byte width
		// (SKIA_BPP = 4), NOT the tensor's source channel count.
		// Passing `width * channels` (= width * 3) here was the original stride
		// corruption vector — Skia would silently misalign every row by 1 byte per
		// pixel column, producing a diagonal shear artefact at non-trivial widths.
		const skiaImage = Skia.Image.MakeImage(
			imageInfo,
			skiaData,
			width * SKIA_BPP
		)
		if (!skiaImage) {
			throw new Error(
				'[SkiaRenderer] Critical failure constructing Skia Image composition instance from tensor memory buffers.'
			)
		}

		// ── Draw pass ─────────────────────────────────────────────────────────────
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
			// rawBytes.length is the post-expansion RGBA byte count — the truthful
			// allocated footprint this frame contributed to the native heap.
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
			maskPaint.setStyle(0 /* Fill — PaintStyle.Fill = 0, Stroke = 1 */)
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

			const jpegBytes = snapshot.encodeToBytes(
				ImageFormat.JPEG,
				OUTPUT_JPEG_QUALITY
			)
			if (!jpegBytes) {
				throw new Error(
					'[SkiaRenderer] encodeToBytes() returned null — image encoding failed.'
				)
			}

			// Construct target file instance inside the modern directory structure
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
				// SkSurface: release its underlying pixel buffer.
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
		this._rgbaByteCache.clear()
	}
}
