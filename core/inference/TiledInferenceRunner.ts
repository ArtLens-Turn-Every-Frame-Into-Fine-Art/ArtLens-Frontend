/**
 * @file TiledInferenceRunner.ts
 * @description Production-grade tiled inference + Gaussian stitch pipeline for ArtLens.
 *              TypeScript port of artlens_infer_v5.py — tiling strategy and
 *              Gaussian windowed overlap-add reconstruction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PIPELINE OVERVIEW
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────────────────────────────┐
 *  │ Phase 0  CONFIG     getModelConfig(styleId) → tileOverlap, inferenceRes  │
 *  │ Phase 1  DECODE     file:// URI → Skia decode → fullRgba Uint8Array      │
 *  │ Phase 2  GRID       tileImage(W, H, config) → TileGrid                  │
 *  │ Phase 3  HOT LOOP   for each TileCoord:                                  │
 *  │            A) extractTileRgba → _tileScratch[512×512×4]                 │
 *  │            B) prepareInputTensor → mainInputBuffer[512×512×3×fp16]      │
 *  │            C) runInferenceSync('main') → rawFp16 ArrayBuffer            │
 *  │            D) push ProcessedTile{ coord, rawFp16 }                      │
 *  │            E) onProgress(k/total), yield to event loop                  │
 *  │ Phase 4  STITCH     stitchTiles(grid, tiles) → Float32Array [H×W×3]     │
 *  │ Phase 5  EXPORT     f32StitchedToRgba → Skia JPEG encode → cache write  │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUFFER FLOW (per tile — zero new allocations in hot loop)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  fullRgba : Uint8Array[imageW × imageH × 4]     ← decoded once at Phase 1
 *       │ _extractTileRgba()  row-by-row memcpy + zero-pad boundary tiles
 *       ▼
 *  _tileScratch : Uint8Array[512 × 512 × 4]       ← module singleton, reused
 *       │ prepareInputTensor(…, toUint8=false)     strip A, normalize /255, fp16
 *       ▼
 *  mainInputBuffer : ArrayBuffer[512 × 512 × 3 × 2]  ← tensorUtils singleton
 *       │ InferenceEngine.runInferenceSync('main')  TFLite forward pass (sync)
 *       ▼
 *  rawOutput : ArrayBuffer[512 × 512 × 3 × 2]    ← new alloc per tile (native)
 *       │ ProcessedTile { coord, rawFp16: rawOutput }
 *       ▼
 *  stitchTiles(grid, tiles)                        ← Gaussian overlap-add
 *       ▼
 *  stitchedF32 : Float32Array[imageH × imageW × 3] ← single alloc post-loop
 *       │ f32StitchedToRgba()
 *       ▼
 *  rgbaOut : Uint8Array[imageH × imageW × 4]       ← single alloc
 *       │ Skia JPEG encode → File.write()
 *       ▼
 *  resultUri : string  (file:// in Paths.cache)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TILE BYTE-OFFSET MATH (_extractTileRgba)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  fullRgba layout : row-major RGBA, 4 bytes/pixel
 *    pixel(px, py) → fullRgba[ (py * imageW + px) * 4 ]
 *
 *  For tile (coord.x, coord.y) with dimensions (coord.w × coord.h):
 *    source pixel (tx, ty) → image pixel (coord.x + tx, coord.y + ty)
 *    src byte start of row ty : (coord.y + ty) * imageW * 4 + coord.x * 4
 *    dst byte start of row ty :  ty * INFERENCE_RES * 4
 *    bytes per row            :  coord.w * 4
 *
 *  Boundary tiles (coord.w < INFERENCE_RES or coord.h < INFERENCE_RES):
 *    _tileScratch is zero-filled before each extraction.
 *    Rows [0, coord.h) are populated; rows [coord.h, 512) stay zero (black).
 *    Columns [0, coord.w) are populated; columns [coord.w, 512) stay zero.
 *    prepareInputTensor maps zero RGBA → fp16(0/255) = fp16(0.0) = black pixel.
 *    The Gaussian window assigns near-zero weight to tile edges, so these
 *    black-padded pixels have negligible influence on the final stitch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREAD SAFETY & CONCURRENCY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  _tileScratch and mainInputBuffer are module-level singletons shared across
 *  tiles. They are safe because:
 *    1. StyleJobService._processingLock guarantees only one job runs at a time.
 *    2. The hot loop is sequential — each tile's extraction + prepareInputTensor
 *       + runInferenceSync completes before the next tile begins.
 *    3. runInferenceSync is synchronous — it cannot interleave with itself.
 *
 * PRD § 4.x — src/core/inference/TiledInferenceRunner.ts
 */

'use strict'

import {
	Skia,
	AlphaType,
	ColorType,
	ImageFormat,
} from '@shopify/react-native-skia'
import { File, Paths } from 'expo-file-system'

import * as InferenceEngine from '@/core/inference/InferenceEngine'
import {
	tileImage,
	prepareInputTensor,
	stitchTiles,
	f32StitchedToRgba,
	mainInputBuffer,
	type TileCoord,
	type ProcessedTile,
	type TileGrid,
} from '@/shared/utils/tensorUtils'
import { getModelConfig } from '@/core/storage/ModelManager'
import { DEFAULT_MODEL_CONFIG } from '@/shared/utils/constants'
import { createTracker } from '@/shared/utils/logger'
import type { StyleId } from '@/types'

const tracker = createTracker('TiledInferenceRunner')

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — FALLBACK CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The exact pixel dimension the CUT ResNet generator was trained on.
 * DO NOT change — alters InstanceNorm running statistics.
 */
const INFERENCE_RES: number = DEFAULT_MODEL_CONFIG.inferenceResolution // 512

/**
 * RGBA byte depth — 4 channels per pixel (Red, Green, Blue, Alpha).
 */
const RGBA_CH = 4

/**
 * JPEG output quality [1–100].
 * 90 preserves impasto texture detail without excessive file size.
 */
const OUTPUT_JPEG_QUALITY = 90

/**
 * Maximum supported image pixel count — must match STITCH_MAX_PIXELS in
 * tensorUtils.ts. Images exceeding this limit cannot use the pre-allocated
 * stitch accumulator buffers.
 */
const STITCH_MAX_PIXELS = 4085 * 3065 // 12,520,525 px ≈ 12.5 MP

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — PUBLIC API TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callbacks injected by StyleJobService.
 * Decouples the runner from module-level variables in the service.
 */
export interface TiledInferenceCallbacks {
	/**
	 * Called after each tile completes inference.
	 * @param fraction - Strict [0.0, 1.0] — completedTiles / totalTiles.
	 *                   Matches the StyleJob.progress type definition.
	 */
	onProgress: (fraction: number) => void

	/**
	 * Returns true if the job should be interrupted at the next tile boundary.
	 * Typically reads the _abortCurrentJob flag from StyleJobService.
	 */
	shouldAbort: () => boolean
}

/**
 * Returned on successful pipeline completion.
 */
export interface TiledInferenceResult {
	/** Absolute file:// URI of the JPEG written to the device cache */
	resultUri: string
	/** Width of the stylised output image (matches source image) */
	imageW: number
	/** Height of the stylised output image (matches source image) */
	imageH: number
	/** Total tiles processed during inference */
	totalTiles: number
	/** Wall-clock duration from decode start to file write, in ms */
	durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — ABORT SIGNAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown by runTiledInference() when shouldAbort() returns true mid-loop.
 *
 * This is NOT an error — StyleJobService catches it specifically and
 * transitions the job to BATTERY_PAUSED rather than ERROR. It must NOT
 * be caught by the generic error handler or trigger failJob().
 */
export class InferenceAbortError extends Error {
	constructor() {
		super('[TiledInferenceRunner] Inference aborted by caller signal.')
		this.name = 'InferenceAbortError'
		Object.setPrototypeOf(this, InferenceAbortError.prototype)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — MODULE-LEVEL SCRATCH BUFFER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pre-allocated RGBA scratch buffer for tile pixel extraction.
 *
 * Allocated ONCE at module load: 512 × 512 × 4 = 1,048,576 bytes.
 * Overwritten at the start of each tile iteration via _extractTileRgba().
 * Immediately consumed by prepareInputTensor() with no async gap.
 *
 * Layout: row-major interleaved RGBA, 4 bytes per pixel.
 *   Pixel at (tx, ty) within tile → offset (ty * 512 + tx) * 4
 *   Channels: byte[+0]=R, byte[+1]=G, byte[+2]=B, byte[+3]=A
 *
 * Zero-init matters: fill(0) before each extraction ensures boundary tiles
 * (where coord.w < 512 or coord.h < 512) automatically have zero-padded
 * columns and rows. The model receives black pixels (fp16 0.0) at padding
 * positions. The Gaussian window's near-zero edge weight (~exp(-3.125) ≈ 0.04)
 * suppresses these padding pixels in the final overlap-add accumulation.
 */
const _tileScratch = new Uint8Array(INFERENCE_RES * INFERENCE_RES * RGBA_CH)

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — EVENT LOOP YIELD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Yields control to the React Native JS event loop for one scheduler tick.
 *
 * WHY THIS IS CRITICAL:
 *   InferenceEngine.runInferenceSync() is synchronous — it blocks the JS
 *   thread for the full TFLite forward pass (50–200ms on mid-range Android,
 *   e.g., Samsung A-series with Exynos 1280 / Mali-G68 MP4 GPU delegate).
 *
 *   Without yielding, a 165-tile job would freeze the JS thread for up to
 *   33 seconds, making the app completely unresponsive. Each yield allows:
 *     - React Native's bridge queue to flush pending UI updates
 *     - useStyleJobStore's 500ms MMKV debounce to land the progress write
 *     - The _abortCurrentJob flag to be set by prioritizeJob() / pauseJob()
 *       via events processed in the event loop during this gap
 *
 *   Cost: ~1 setTimeout(fn, 0) per tile ≈ 4–16ms overhead per tile.
 *   Acceptable for a background queue job (not a real-time camera loop).
 *
 * @returns Promise that resolves on the next event loop tick
 */
const _yieldToEventLoop = (): Promise<void> =>
	new Promise<void>((resolve) => setTimeout(resolve, 0))

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — IMAGE DECODE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads a local image file and extracts its full raw RGBA pixel buffer.
 *
 * DECODE PIPELINE:
 *   1. expo-file-system File.bytes() reads the compressed JPEG/PNG/WebP bytes.
 *      This is a filesystem read — does NOT decode pixels yet.
 *   2. Skia.Data.fromBytes() wraps the encoded buffer in a native Skia handle
 *      (zero-copy on most platforms — forwards the underlying JS ArrayBuffer).
 *   3. Skia.Image.MakeImageFromEncoded() hardware-decodes the image into a
 *      native raster at original dimensions, using the platform codec.
 *   4. skImage.readPixels(0, 0, RGBA_8888/Opaque) copies all decoded pixels
 *      into a flat Uint8Array in row-major RGBA order, 4 bytes per pixel.
 *      AlphaType.Opaque forces alpha=255 for every pixel regardless of source
 *      format (JPEG has no alpha; PNG may have — we discard it here since the
 *      model's input is RGB only and prepareInputTensor ignores the alpha byte).
 *   5. skImage.dispose() releases native VRAM immediately after the CPU copy.
 *
 * MEMORY NOTE:
 *   A 4032×3024 image produces fullRgba = 4032 × 3024 × 4 ≈ 46.5 MB.
 *   Peak memory during this call: encoded bytes (~8MB JPEG) + fullRgba (~46 MB).
 *   The encoded bytes are eligible for GC once skImage is created; the Skia
 *   image is disposed immediately after readPixels(). Only fullRgba persists.
 *
 * @param sourceUri - Absolute file:// URI of the source photo
 * @returns { fullRgba, imageW, imageH }
 * @throws If the file does not exist, cannot be read, or Skia decode fails
 */
async function _decodeSourceImage(sourceUri: string): Promise<{
	fullRgba: Uint8Array
	imageW: number
	imageH: number
}> {
	tracker.log(`Decoding: ${sourceUri}`)

	// ── Step 1: Read compressed bytes from filesystem ─────────────────────────
	const srcFile = new File(sourceUri)
	if (!srcFile.exists) {
		throw new Error(
			`[TiledInferenceRunner] Source file not found: ${sourceUri}`
		)
	}
	const encodedBytes = await srcFile.bytes()

	// ── Step 2: Wrap in Skia native buffer ───────────────────────────────────
	const skData = Skia.Data.fromBytes(encodedBytes)

	// ── Step 3: Hardware decode ───────────────────────────────────────────────
	const skImage = Skia.Image.MakeImageFromEncoded(skData)
	if (!skImage) {
		throw new Error(
			`[TiledInferenceRunner] Skia failed to decode "${sourceUri}". ` +
				'Ensure the file is a valid JPEG, PNG, or WebP.'
		)
	}

	// In @shopify/react-native-skia (Expo SDK 55 / RN 0.76 era):
	//   skImage.width() and skImage.height() are methods returning number.
	//   Some older typings expose them as properties — use the method form
	//   which is stable across v0.1.x through the Expo 55 bundled version.
	const imageW: number = skImage.width()
	const imageH: number = skImage.height()
	tracker.log(`Decoded: ${imageW}×${imageH} px`)

	// Pre-check before readPixels to surface a clear error for oversized images
	if (imageW * imageH > STITCH_MAX_PIXELS) {
		try {
			skImage.dispose()
		} catch {
			/* best-effort */
		}
		throw new Error(
			`[TiledInferenceRunner] Image ${imageW}×${imageH} (${imageW * imageH}px) ` +
				`exceeds the stitch buffer limit of ${STITCH_MAX_PIXELS}px. ` +
				`Resize the source image to ≤ 4085×3065 before stylisation.`
		)
	}

	// ── Step 4: Read full RGBA_8888 pixel buffer ──────────────────────────────
	//
	// readPixels(srcX, srcY, imageInfo) copies the decoded raster into a
	// Uint8Array in row-major RGBA order (4 bytes per pixel).
	//
	//   ColorType.RGBA_8888  : R,G,B,A interleaved, 1 byte each channel
	//   AlphaType.Opaque     : alpha byte forced to 255 for every pixel
	//
	// Pixel layout: (px, py) → fullRgba[(py * imageW + px) * 4 + ch]
	//   ch=0 → Red, ch=1 → Green, ch=2 → Blue, ch=3 → Alpha (always 255)
	//
	// Return type is Uint8Array | null in the RN Skia type surface.
	const pixelData: Uint8Array | null = skImage.readPixels(0, 0, {
		width: imageW,
		height: imageH,
		colorType: ColorType.RGBA_8888,
		alphaType: AlphaType.Opaque,
	}) as Uint8Array | null

	// ── Step 5: Dispose native VRAM immediately ───────────────────────────────
	// Must happen AFTER readPixels — the CPU copy is now in pixelData.
	try {
		skImage.dispose()
	} catch {
		/* best-effort disposal */
	}

	const expectedBytes = imageW * imageH * RGBA_CH
	if (!pixelData || pixelData.byteLength !== expectedBytes) {
		throw new Error(
			`[TiledInferenceRunner] readPixels() returned unexpected data: ` +
				`expected ${expectedBytes}B, got ${pixelData?.byteLength ?? 0}B.`
		)
	}

	const fullRgba = pixelData
	tracker.log(
		`RGBA buffer: ${(fullRgba.byteLength / 1_048_576).toFixed(1)} MB`
	)
	return { fullRgba, imageW, imageH }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — TILE RGBA EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Copies one tile's pixels from the full-image RGBA buffer into `output`.
 * Handles both interior tiles (full 512×512) and boundary tiles (partial).
 *
 * BYTE OFFSET MATH:
 *   fullRgba is row-major RGBA: pixel (px, py) starts at (py*imageW + px)*4.
 *
 *   For tile row `ty` (0-indexed within tile):
 *     srcY      = coord.y + ty          (absolute row in full image)
 *     srcStart  = (srcY * imageW + coord.x) * 4   (byte offset in fullRgba)
 *     dstStart  = ty * INFERENCE_RES * 4            (byte offset in output)
 *     bytesToCopy = coord.w * 4
 *
 * BOUNDARY ZERO-PADDING:
 *   output.fill(0) before copying ensures unwritten pixels stay zero (black).
 *   Boundary cases:
 *     Right edge:  coord.w < INFERENCE_RES — rightmost columns stay zero.
 *     Bottom edge: coord.h < INFERENCE_RES — bottom rows are never written.
 *   The Gaussian blend window assigns ≈ 0.04 weight at tile edges,
 *   so these zero pixels have negligible impact on the stitched output.
 *
 * PERFORMANCE:
 *   Uint8Array.set() is a typed array bulk copy — near-memcpy performance.
 *   Interior tile (512×512): 512 iterations × 2048 bytes = 1 MB per tile.
 *   Boundary tile (partial): fewer iterations and smaller rows.
 *
 * @param fullRgba  - Full image RGBA buffer (imageW × imageH × 4 bytes)
 * @param imageW    - Full image width in pixels
 * @param imageH    - Full image height in pixels (bounds guard)
 * @param coord     - TileCoord describing this tile's position and dimensions
 * @param tileSize  - Always INFERENCE_RES (512)
 * @param output    - Pre-allocated Uint8Array of tileSize × tileSize × 4 bytes
 */
function _extractTileRgba(
	fullRgba: Uint8Array,
	imageW: number,
	imageH: number,
	coord: TileCoord,
	tileSize: number,
	output: Uint8Array
): void {
	// Zero-fill: ensures stale data from a previous tile doesn't bleed through
	// in the boundary region (right and bottom edges of boundary tiles).
	output.fill(0)

	const srcRowStride = imageW * RGBA_CH // bytes per row in full image
	const dstRowStride = tileSize * RGBA_CH // bytes per row in tile (= 512 * 4)
	const copyH = coord.h // actual rows to copy (≤ tileSize)
	const copyW = coord.w // actual columns to copy per row (≤ tileSize)

	for (let ty = 0; ty < copyH; ty++) {
		const srcY = coord.y + ty

		// Safety clamp: should never trigger with a valid TileGrid, but guards
		// against floating-point rounding in edge-case image dimensions.
		if (srcY >= imageH) break

		// Byte offset of the first RGBA pixel of this row in the full image.
		// coord.x * RGBA_CH skips the horizontal offset within that row.
		const srcStart = srcY * srcRowStride + coord.x * RGBA_CH

		// Byte offset of the first pixel in this tile row within `output`.
		const dstStart = ty * dstRowStride

		// Clamp to available bytes in the source row to prevent over-read
		// at the right image edge (where coord.x + coord.w == imageW exactly).
		const bytesToCopy = Math.min(
			copyW * RGBA_CH,
			srcRowStride - coord.x * RGBA_CH
		)

		output.set(
			fullRgba.subarray(srcStart, srcStart + bytesToCopy),
			dstStart
		)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — JPEG ENCODE & CACHE WRITE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encodes a raw RGBA Uint8Array as JPEG and writes it to the app's cache.
 *
 * ENCODE PIPELINE:
 *   1. Skia.Data.fromBytes(rgbaBytes) wraps the Uint8Array in a Skia buffer.
 *   2. Skia.Image.MakeImage(imageInfo, data, rowBytes) creates a raster SkImage.
 *      rowBytes = imageW * 4 (RGBA_8888, contiguous rows, no stride padding).
 *   3. skImage.encodeToBytes(JPEG, quality) compresses to a Uint8Array.
 *      Disposes the SkImage immediately to release native memory.
 *   4. new File(outputUri).write(jpegBytes) writes to the cache directory.
 *
 * OUTPUT URI PATTERN:
 *   {Paths.cache.uri}artlens_<timestamp>_<random5>.jpg
 *   Timestamp + random suffix prevents URI collisions between rapid retries.
 *
 * @param rgbaBytes - Uint8Array from f32StitchedToRgba() — imageW × imageH × 4
 * @param imageW    - Output image width in pixels
 * @param imageH    - Output image height in pixels
 * @returns Absolute file:// URI of the written JPEG
 * @throws If Skia cannot create the image, encoding fails, or write fails
 */
async function _encodeAndSave(
	rgbaBytes: Uint8Array,
	imageW: number,
	imageH: number
): Promise<string> {
	// ── Step 1: Create Skia raster image ─────────────────────────────────────
	const skData = Skia.Data.fromBytes(rgbaBytes)
	const outputSkImage = Skia.Image.MakeImage(
		{
			width: imageW,
			height: imageH,
			colorType: ColorType.RGBA_8888,
			alphaType: AlphaType.Opaque,
		},
		skData,
		imageW * RGBA_CH // row stride = width * 4 bytes (no padding)
	)

	if (!outputSkImage) {
		throw new Error(
			`[TiledInferenceRunner] Skia.Image.MakeImage() failed for ` +
				`${imageW}×${imageH} RGBA image.`
		)
	}

	// ── Step 2: Encode to JPEG and dispose native handle ─────────────────────
	const jpegBytes = outputSkImage.encodeToBytes(
		ImageFormat.JPEG,
		OUTPUT_JPEG_QUALITY
	)
	try {
		outputSkImage.dispose()
	} catch {
		/* best-effort */
	}

	if (!jpegBytes) {
		throw new Error(
			'[TiledInferenceRunner] encodeToBytes(JPEG) returned null — encoding failed.'
		)
	}

	// ── Step 3: Build output URI and write to cache ───────────────────────────
	// Paths.cache.uri may or may not have a trailing slash — normalise it.
	const cacheBase = Paths.cache.uri.endsWith('/')
		? Paths.cache.uri
		: `${Paths.cache.uri}/`

	const suffix = Math.random().toString(36).slice(2, 7)
	const outputUri = `${cacheBase}artlens_${Date.now()}_${suffix}.jpg`

	const outputFile = new File(outputUri)
	await outputFile.write(jpegBytes)

	tracker.log(
		`Saved: ${outputUri}  (${(jpegBytes.byteLength / 1024).toFixed(0)} KB)`
	)
	return outputFile.uri
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes the full tiled inference pipeline for one style-transfer job.
 *
 * PREREQUISITES (caller's responsibility — StyleJobService):
 *   - InferenceEngine.loadMainModel(modelPath) must have been called and
 *     awaited successfully before this function is invoked.
 *   - InferenceEngine.unloadModel('main') must be called in the caller's
 *     finally block, NOT inside this function. The runner does not manage
 *     model lifecycle — it only consumes the already-loaded model.
 *
 * ABORT CONTRACT:
 *   - shouldAbort() is polled BEFORE each tile's synchronous inference call.
 *   - On true, throws InferenceAbortError immediately with no partial output.
 *   - All JS memory (fullRgba, processedTiles, etc.) becomes GC-eligible.
 *   - Caller catches InferenceAbortError and sets job status = BATTERY_PAUSED.
 *   - Caller's finally block handles model unload and job ID cleanup.
 *
 * PROGRESS CONTRACT:
 *   - onProgress(k / totalTiles) is called after tile k completes (k ∈ [1, N]).
 *   - The first onProgress call is onProgress(1/N), the last is onProgress(1.0).
 *   - All values are in the strict [0.0, 1.0] range matching StyleJob.progress.
 *   - The 500ms debounce in useStyleJobStore batches rapid progress writes to
 *     MMKV, so calling onProgress after every tile is safe and recommended.
 *
 * MEMORY LIFECYCLE:
 *   - fullRgba (~46 MB for 12MP): allocated in Phase 1, eligible for GC after
 *     the hot loop completes (no longer referenced post-loop).
 *   - processedTiles: grows during the loop (~1.5 MB × numTiles raw fp16).
 *     All ArrayBuffers are native-allocated by TFLite and GC-collected after
 *     stitchTiles() finishes consuming them.
 *   - stitchedF32 (~36 MB for 12MP): allocated by stitchTiles(), consumed by
 *     f32StitchedToRgba(), eligible for GC after _encodeAndSave() starts.
 *   - rgbaBytes (~46 MB for 12MP): allocated by f32StitchedToRgba(), consumed
 *     by Skia.Data.fromBytes() in _encodeAndSave(), then GC-eligible.
 *
 * @param sourceUri  - Absolute file:// URI of the source photo on device storage
 * @param styleId    - Style identifier used to fetch ModelConfig from MMKV
 * @param callbacks  - { onProgress, shouldAbort } provided by StyleJobService
 * @returns          TiledInferenceResult containing resultUri and timing metadata
 * @throws InferenceAbortError if shouldAbort() returns true during the hot loop
 * @throws Error for any decode / inference / encode / filesystem failure
 */
export async function runTiledInference(
	sourceUri: string,
	styleId: StyleId,
	callbacks: TiledInferenceCallbacks
): Promise<TiledInferenceResult> {
	const t0 = Date.now()
	tracker.log(
		`runTiledInference — styleId="${styleId}", source="${sourceUri}"`
	)

	// Guard: confirm model is loaded before attempting any tile inference.
	if (!InferenceEngine.isModelLoaded('main')) {
		throw new Error(
			'[TiledInferenceRunner] Main model slot is not loaded. ' +
				'Caller must await InferenceEngine.loadMainModel() first.'
		)
	}

	// ── Phase 0: Load dynamic model configuration ─────────────────────────────
	//
	// getModelConfig() reads config.json for this styleId from the MMKV registry.
	// Returns DEFAULT_CONFIG if the file is absent, unreadable, or malformed.
	//
	// Key fields:
	//   inferenceResolution : must be 512 — the CUT generator training resolution.
	//   tileOverlap         : fraction [0,1] OR legacy pixel count.
	//                         tileImage() handles both formats transparently.
	//   luminanceBlend      : informational here; used by SkiaRenderer for display.
	const config = await getModelConfig(styleId)
	tracker.log(
		`Config: inferenceRes=${config.inferenceResolution}, ` +
			`tileOverlap=${config.tileOverlap}`
	)

	// ── Phase 1: Decode source image → full RGBA buffer ───────────────────────
	const { fullRgba, imageW, imageH } = await _decodeSourceImage(sourceUri)

	// ── Phase 2: Compute overlap tile grid ───────────────────────────────────
	//
	// tileImage() performs pure arithmetic — no I/O, no allocation of buffers.
	// Returns TileGrid { coords[], total, step, overlapPx, numCols, numRows }.
	//
	// step = tileSize - overlapPx    (e.g., 512 - 256 = 256 at 50% overlap)
	// numCols = ceil((imageW - tileSize) / step) + 1  [or 1 if imageW ≤ tileSize]
	// numRows = similar for height
	//
	// Each TileCoord { col, row, index, x, y, w, h }:
	//   (x, y)  = top-left pixel in the full image
	//   (w, h)  = actual tile dimensions (≤ 512 at image edges)
	const grid: TileGrid = tileImage(imageW, imageH, config)
	const { total: totalTiles, coords } = grid

	tracker.log(
		`Grid: ${grid.numCols}×${grid.numRows} = ${totalTiles} tiles  ` +
			`(step=${grid.step}px, overlapPx=${grid.overlapPx}px)`
	)

	// ── Phase 3: Tiled hot loop ───────────────────────────────────────────────
	//
	// processedTiles accumulates raw fp16 ArrayBuffers from TFLite.
	// Each rawOutput is a fresh native allocation from model.runSync() —
	// it is safe to store long-term without copying.
	//
	// Estimated peak heap from tile buffers:
	//   165 tiles × 1.5 MB (fp16) ≈ 247 MB for a 4032×3024 image at 50% overlap.
	// The pre-allocated _stitchNumerator/Denominator in tensorUtils (~192 MB)
	// accounts for this scale — no additional allocation in the loop.
	const processedTiles: ProcessedTile[] = []

	for (let tileIdx = 0; tileIdx < totalTiles; tileIdx++) {
		// ── Abort boundary ────────────────────────────────────────────────────
		//
		// Checked BEFORE each synchronous inference call.
		// This is the only safe interruption point: runInferenceSync() is a
		// blocking native call with no internal cancellation mechanism.
		// The maximum abort latency is one tile's inference time (~200ms).
		if (callbacks.shouldAbort()) {
			tracker.log(`Abort signal at tile ${tileIdx}/${totalTiles}`)
			throw new InferenceAbortError()
		}

		const coord = coords[tileIdx]

		// ── Step A: Extract tile RGBA into scratch buffer ──────────────────
		//
		// _tileScratch is a module singleton reused across all tiles.
		// Zero-fill + row-by-row memcpy from fullRgba.
		// Boundary tiles (coord.w < 512 or coord.h < 512) are zero-padded
		// in their uncopied regions. See _extractTileRgba() for full math.
		_extractTileRgba(
			fullRgba,
			imageW,
			imageH,
			coord,
			INFERENCE_RES,
			_tileScratch
		)

		// ── Step B: Pack RGBA → fp16 RGB into mainInputBuffer ─────────────
		//
		// prepareInputTensor processes exactly INFERENCE_RES² pixels:
		//   For each pixel i:
		//     src = _tileScratch[i*4 .. i*4+2]  (R, G, B — alpha at +3 is ignored)
		//     dst = mainInputBuffer as Uint16Array at [i*3 .. i*3+2]
		//     value = numberToFp16Bits(src_channel / 255)
		//
		// Normalization: sRGB uint8 [0, 255] → fp16 float [0.0, 1.0]
		// toUint8=false: Teacher model expects Float16 precision input.
		//   Using uint8 would lose the sub-1/255 quantization precision the
		//   GPU delegate uses in its XNNPACK fp16 compute path.
		//
		// mainInputBuffer is a pre-allocated module singleton from tensorUtils.
		// It is safe to overwrite here because runInferenceSync() immediately
		// consumes it synchronously with no async gap.
		prepareInputTensor(_tileScratch, mainInputBuffer, INFERENCE_RES, false)

		// ── Step C: Run TFLite model inference (synchronous) ───────────────
		//
		// InferenceEngine.runInferenceSync() calls model.runSync([inputBuffer])
		// from react-native-fast-tflite (Nitro Module). This blocks the JS
		// thread for the full forward pass duration.
		//
		// The 9-block dilated CUT ResNet generator preserves spatial dimensions:
		//   Input:  [1, 512, 512, 3] fp16 → Encoder (×2 stride-2 downs) →
		//   Latent: [1, 128, 128, 256] → 9 DilatedResBlocks (dilation 1,2,4,4,4,4,4,2,1) →
		//   Output: [1, 512, 512, 3] fp16 via 2× transpose-conv upsample + Tanh/activation
		//
		// Output buffer: 512 × 512 × 3 × 2 = 1,572,864 bytes (fp16, HWC layout)
		// rawOutput is a NEW ArrayBuffer allocated by the native runtime per call.
		// It is safe to store across iterations.
		const rawOutput = InferenceEngine.runInferenceSync(
			'main',
			mainInputBuffer
		)

		// ── Step D: Store ProcessedTile ────────────────────────────────────
		//
		// We store rawFp16: ArrayBuffer (NOT a decoded Float32Array) because:
		//   1. stitchTiles() decodes fp16 inline using _fp16LookupTable — O(1)
		//      per channel — which is more efficient than allocating a full
		//      Float32Array per tile (would be 786,432 × 4 bytes each = 3 MB).
		//   2. decodeModelOutput() writes into the shared _sharedF32Decode
		//      workspace and the returned subarray view is invalidated on the
		//      next call. Storing it would require a copy anyway.
		//   3. Keeping fp16 (half the memory) matters for large image jobs.
		processedTiles.push({ coord, rawFp16: rawOutput })

		// ── Step E: Report progress ────────────────────────────────────────
		//
		// Fraction: (tileIdx + 1) / totalTiles → [1/N, 2/N, …, 1.0]
		// StyleJob.progress is typed as [0.0, 1.0] fraction. The UI multiplies
		// by 100 for display. Emitting integers (10, 20..100) would show "5000%"
		// in the header — this fractional form is correct per the type contract.
		callbacks.onProgress((tileIdx + 1) / totalTiles)

		// ── Step F: Yield to event loop ────────────────────────────────────
		//
		// Release the JS thread after each blocking forward pass.
		// This window allows the abort flag to be set if prioritizeJob() or
		// pauseJob() is called from UI — the new flag value will be read at
		// the NEXT iteration's abort check above.
		await _yieldToEventLoop()
	}

	tracker.log(`Hot loop done: ${processedTiles.length} tiles`)

	// ── Phase 4: Gaussian overlap-add stitch ─────────────────────────────────
	//
	// stitchTiles() performs two passes over all ProcessedTile data:
	//
	//   Pass 1 — Weighted accumulation:
	//     For each tile t at canvas position (cx, cy):
	//       For each pixel (tx, ty) within the tile:
	//         fp16_value → Float32 via _fp16LookupTable[uint16_index]  (O(1))
	//         weight = _gaussianWindow512[ty * 512 + tx]
	//         _stitchNumerator[(canvasY * imageW + canvasX) * 3 + ch] += fp32 * weight
	//         _stitchDenominator[canvasY * imageW + canvasX] += weight
	//
	//   Pass 2 — Normalisation:
	//     output[p] = numerator[p] / denominator[p]   (denominator always > 1e-6)
	//     Clamp to [0, 1].
	//
	// Both accumulator arrays are pre-allocated module singletons (~192 MB total).
	// Output is a FRESH Float32Array — the only new allocation post-loop.
	const stitchedF32 = stitchTiles(grid, processedTiles)
	tracker.log(
		`Stitch done: ${imageW}×${imageH}, ` +
			`${(stitchedF32.byteLength / 1_048_576).toFixed(1)} MB`
	)

	// ── Phase 5: Float32 RGB → RGBA Uint8 ────────────────────────────────────
	//
	// f32StitchedToRgba() allocates a fresh Uint8Array (imageW × imageH × 4).
	// Each channel: float32 [0,1] → Math.floor(v * 255) → uint8 [0, 255].
	// Alpha is always 255 (fully opaque). This is the final pixel-domain result.
	const rgbaBytes = f32StitchedToRgba(stitchedF32, imageW, imageH)

	// ── Phase 6: JPEG encode and write to cache ───────────────────────────────
	const resultUri = await _encodeAndSave(rgbaBytes, imageW, imageH)

	const durationMs = Date.now() - t0
	tracker.log(
		`Complete — ${totalTiles} tiles, ${durationMs}ms, uri=${resultUri}`
	)

	return { resultUri, imageW, imageH, totalTiles, durationMs }
}
