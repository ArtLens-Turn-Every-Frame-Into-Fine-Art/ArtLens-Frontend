/**
 * @file TiledInferenceRunner.ts
 * @description Production-grade tiled inference + Gaussian stitch pipeline for ArtLens.
 *              TypeScript port of artlens_infer_v5.py — tiling strategy and
 *              Gaussian windowed overlap-add reconstruction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REFACTOR CHANGES (v2 — full coverage, reflection extraction, colour correction)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX 1 (preserved) — rawOutput buffer aliasing
 *    rawOutput.slice(0) creates an owned copy before the next runInferenceSync
 *    overwrites the native TFLite output buffer. Without this, all ProcessedTile
 *    entries reference the same memory location — holding only the last tile's
 *    output — producing the repeating-grid artifact.
 *
 *  FIX 2 — Black border from incomplete tile coverage  [_buildFullCoverageTileGrid]
 *    tensorUtils.tileImage() positions the last tile at (numCols−1)×step, which
 *    may leave pixels near the right/bottom image edges uncovered when
 *    (imageW − tileSize) is not exactly divisible by step. Those uncovered pixels
 *    accumulate denominator=0 in the Gaussian stitch and are emitted as black,
 *    producing the visible dark border band around the output image.
 *
 *    Fix: _buildFullCoverageTileGrid() always appends a final tile positioned
 *    at (imageW−tileSize, imageH−tileSize), guaranteeing every canvas pixel is
 *    covered by at least one tile regardless of step or image dimensions.
 *
 *  FIX 3 — Edge tile boundary distortion  [_extractTileRgba — reflection upgrade]
 *    The previous implementation used edge-clamping (replication padding) for
 *    out-of-bounds pixels at image boundaries. The generator's InstanceNorm layers
 *    compute statistics over the full tile, so replicated constant-value rows/
 *    columns at the edges bias the per-tile mean and std, producing a brightness
 *    or colour shift in the edge zone of boundary tiles.
 *
 *    Fix: Replace edge-clamping with reflection padding (symmetric mirroring).
 *    Out-of-bounds pixels are mapped to their reflected counterpart within the
 *    image. Tile size and TFLite input shape are unchanged — the fixed-shape
 *    contract is preserved.
 *
 *  FIX 4 — Per-tile InstanceNorm colour drift  [_applyTextureOnlyColour]
 *    InstanceNorm2d computes per-tile mean/std independently. Tiles from different
 *    image regions (sky vs ground, light vs dark) are normalised to different
 *    statistics, producing mutually inconsistent colour outputs after stylisation.
 *    Visible symptom: adjacent tiles have distinct colour casts with hard
 *    boundaries even after Gaussian blending.
 *
 *    Fix: Post-stitch YCbCr luminance transfer.
 *    Algorithm: compute BT.601 luma (Y) for both stylised and original images,
 *    blend the Y channels (impasto texture from stylised, brightness anchor from
 *    original), then scale the original RGB values by the luminance ratio.
 *    This keeps the original image's chrominance (Cb, Cr) intact while transferring
 *    Van Gogh brushstroke luminance structure onto the original palette.
 *    Mirrors artlens_infer_v5.py::colour_mode_texture_only() in sRGB/YCbCr space.
 *
 *  FIX 5 — Minimum overlap enforcement  [_buildFullCoverageTileGrid]
 *    tileOverlap values below MIN_TILE_OVERLAP (0.5) produce a step so large
 *    that the Gaussian tails from adjacent tiles do not overlap meaningfully —
 *    seams are visible regardless of Gaussian sigma. The grid builder clamps
 *    to MIN_TILE_OVERLAP and emits a tracker warning so the misconfiguration is
 *    observable in logs without silently corrupting output quality.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PIPELINE OVERVIEW (v2)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────────────────────────────┐
 *  │ Phase 0  CONFIG     getModelConfig → inferenceRes, tileOverlap           │
 *  │ Phase 1  DECODE     sourceUri → Skia → fullRgba Uint8Array               │
 *  │ Phase 2  GRID       _buildFullCoverageTileGrid → TileGrid [FIX 2+5]      │
 *  │ Phase 3  HOT LOOP   for each TileCoord:                                  │
 *  │            A) _extractTileRgba (reflection) → scratch  [FIX 3]          │
 *  │            B) prepareInputTensor → inputBuf                              │
 *  │            C) runInferenceSync → rawF32.slice(0)        [FIX 1]         │
 *  │            D) push ProcessedTile{ coord, rawF32 }                       │
 *  │            E) onProgress, yield to event loop                           │
 *  │ Phase 4  STITCH     _stitchTilesLocal → Float32Array [H×W×3] in [0,1]   │
 *  │ Phase 4b COLOUR     _applyTextureOnlyColour → corrected [H×W×3] [FIX 4] │
 *  │ Phase 5  EXPORT     _f32StitchedToRgba → Skia JPEG → cache write        │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MODEL PRECISION — float32 (both slots)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Teacher (Main)   — [1, R, R, 3] float32 NHWC in/out [-1, 1]  (R = config.mainModel)
 *  Student (Preview)— [1, R, R, 3] float32 NHWC in/out [-1, 1]  (R = config.previewModel)
 *
 *  Input normalisation:  normalised = pixel / 127.5 − 1.0      → [-1, 1]
 *  Output denormalisation: display  = (model_out + 1.0) × 0.5  → [0, 1]
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
	prepareInputTensor,
	getOrAllocateBuffer,
	type TileCoord,
	type ProcessedTile,
	type TileGrid,
} from '@/shared/utils/tensorUtils'
import { getModelConfig } from '@/core/storage/ModelManager'
import { createTracker } from '@/shared/utils/logger'
import type { StyleId, ModelConfig } from '@/types'
import {
	OUTPUT_JPEG_QUALITY,
	PERFORMANCE_LIMITS,
	MODEL_GAUSSIAN_SIGMA_DIV,
	GAUSSIAN_FLOOR_EPSILON,
	SYSTEM_BOUNDS,
	DEFAULT_MODEL_CONFIG,
} from '@/shared/utils/constants'

const tracker = createTracker('TiledInferenceRunner')

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** RGBA byte depth — 4 channels per pixel. */
const RGBA_CH = SYSTEM_BOUNDS.RGBA_CHANNELS

/** JPEG output quality [1–100]. 90 balances impasto detail vs file size. */
// OUTPUT_JPEG_QUALITY

/** Maximum supported source image pixel count (≈ 12.5 MP). */
const STITCH_MAX_PIXELS = PERFORMANCE_LIMITS.STITCH_MAX_PIXELS

/**
 * Gaussian window sigma divisor.
 *   sigma = tileSize / MODEL_GAUSSIAN_SIGMA_DIV
 * 5.0 is optimal for 25–33% overlap. Matches artlens_infer_v5.py.
 */
// MODEL_GAUSSIAN_SIGMA_DIV

/**
 * Denominator floor added to every Gaussian window entry.
 * Prevents divide-by-zero in the stitch normalisation pass.
 */
//GAUSSIAN_FLOOR_EPSILON

/**
 * Minimum tile overlap fraction enforced by _buildFullCoverageTileGrid.
 *
 * At overlap < 0.5, the step = tileSize × (1 − overlap) is so large that
 * adjacent Gaussian tails do not cover the inter-tile gap, making seams
 * visible regardless of sigma. Any config value below this is clamped and
 * logged via tracker.warn() so the misconfiguration surfaces in telemetry.
 *
 * Matches artlens_infer_v5.py :: MIN_OVERLAP = 0.20 (raised to 0.5 here).
 */
const MIN_TILE_OVERLAP = 0.5

/**
 * Default luminance blend ratio for _applyTextureOnlyColour.
 *   1.0 = full impasto depth (all stylised luminance)
 *   0.85 = recommended (slight original brightness anchor)
 *   0.5  = softer result, better for portraits
 * Mirrors artlens_infer_v5.py :: --luminance_blend 0.85.
 */
const DEFAULT_LUMINANCE_BLEND = DEFAULT_MODEL_CONFIG.luminanceBlend

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — PUBLIC API TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callbacks injected by StyleJobService.
 * Decouples the runner from module-level abort/progress variables in the service.
 */
export interface TiledInferenceCallbacks {
	/**
	 * Called after each tile completes. fraction ∈ [0.0, 1.0].
	 * Matches StyleJob.progress type definition.
	 */
	onProgress: (fraction: number) => void

	/**
	 * Returns true if the job should be interrupted at the next tile boundary.
	 * Typically reads StyleJobService._abortCurrentJob synchronously.
	 */
	shouldAbort: () => boolean
}

/** Returned on successful pipeline completion. */
export interface TiledInferenceResult {
	resultUri: string
	imageW: number
	imageH: number
	totalTiles: number
	durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — ABORT SIGNAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown by runTiledInference / runPreviewInference when shouldAbort() returns
 * true mid-loop. NOT an error — StyleJobService catches it specifically and
 * transitions the job to BATTERY_PAUSED rather than ERROR.
 */
export class InferenceAbortError extends Error {
	constructor() {
		super('[TiledInferenceRunner] Inference aborted by caller signal.')
		this.name = 'InferenceAbortError'
		Object.setPrototypeOf(this, InferenceAbortError.prototype)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — GAUSSIAN WINDOW CACHE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Module-level cache of pre-computed 2D Gaussian blend windows, keyed by tileSize.
 * Built once per tileSize on first call to _precomputeGaussianWindow().
 * Subsequent calls are O(1) Map lookups. Safe under JS single-thread execution.
 */
const _gaussianWindowCache = new Map<number, Float32Array>()

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — EVENT LOOP YIELD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Yields to the React Native JS event loop for one scheduler tick.
 * Critical for UI responsiveness — each synchronous TFLite forward pass blocks
 * the thread for 50–200ms. This yield allows bridge queue flushes, progress
 * store writes, and abort flag checks between tiles.
 */
const _yieldToEventLoop = (): Promise<void> =>
	new Promise<void>((resolve) => setTimeout(resolve, 0))

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — IMAGE DECODE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads a local image file and extracts its full raw RGBA pixel buffer.
 *
 * PIPELINE:
 *   1. expo-file-system File.bytes() → compressed bytes (filesystem read)
 *   2. Skia.Data.fromBytes() → native Skia buffer (zero-copy)
 *   3. Skia.Image.MakeImageFromEncoded() → hardware-decoded raster
 *   4. skImage.readPixels(RGBA_8888, Opaque) → flat Uint8Array, 4 bytes/pixel
 *   5. skImage.dispose() → release native VRAM immediately
 *
 * PIXEL LAYOUT: pixel(px, py) → fullRgba[(py * imageW + px) * 4 + ch]
 *   ch=0 R, ch=1 G, ch=2 B, ch=3 A (always 255 — AlphaType.Opaque)
 *
 * @param sourceUri - Absolute file:// URI of the source photo
 * @returns { fullRgba, imageW, imageH }
 */
async function _decodeSourceImage(sourceUri: string): Promise<{
	fullRgba: Uint8Array
	imageW: number
	imageH: number
}> {
	tracker.log(`Decoding: ${sourceUri}`)

	const srcFile = new File(sourceUri)
	if (!srcFile.exists) {
		throw new Error(
			`[TiledInferenceRunner] Source file not found: ${sourceUri}`
		)
	}

	const encodedBytes = await srcFile.bytes()
	const skData = Skia.Data.fromBytes(encodedBytes)
	const skImage = Skia.Image.MakeImageFromEncoded(skData)
	if (!skImage) {
		throw new Error(
			`[TiledInferenceRunner] Skia failed to decode "${sourceUri}". ` +
				'Ensure the file is a valid JPEG, PNG, or WebP.'
		)
	}

	const imageW: number = skImage.width()
	const imageH: number = skImage.height()
	tracker.log(`Decoded: ${imageW}×${imageH} px`)

	if (imageW * imageH > STITCH_MAX_PIXELS) {
		try {
			skImage.dispose()
		} catch {
			/* best-effort */
		}
		throw new Error(
			`[TiledInferenceRunner] Image ${imageW}×${imageH} (${imageW * imageH}px) ` +
				`exceeds stitch buffer limit of ${STITCH_MAX_PIXELS}px.`
		)
	}

	const pixelData = skImage.readPixels(0, 0, {
		width: imageW,
		height: imageH,
		colorType: ColorType.RGBA_8888,
		alphaType: AlphaType.Opaque,
	}) as Uint8Array | null

	try {
		skImage.dispose()
	} catch {
		/* best-effort */
	}

	const expectedBytes = imageW * imageH * RGBA_CH
	if (!pixelData || pixelData.byteLength !== expectedBytes) {
		throw new Error(
			`[TiledInferenceRunner] readPixels() returned unexpected data: ` +
				`expected ${expectedBytes}B, got ${pixelData?.byteLength ?? 0}B.`
		)
	}

	tracker.log(
		`RGBA buffer: ${(pixelData.byteLength / 1_048_576).toFixed(1)} MB`
	)
	return { fullRgba: pixelData, imageW, imageH }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — FULL-COVERAGE TILE GRID  [FIX 2 + FIX 5]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a tile grid that guarantees 100% canvas coverage.
 *
 * ════════════════════════════════════════════════════════════════════
 * BUG FIXED: UNCOVERED RIGHT/BOTTOM EDGE PIXELS → BLACK BORDER
 * ════════════════════════════════════════════════════════════════════
 *
 * ROOT CAUSE:
 *   tensorUtils.tileImage() positions tiles at multiples of step:
 *     x = col × step  for col in [0, numCols)
 *   When (imageW − tileSize) is not exactly divisible by step, the last
 *   tile ends at (numCols−1)×step + tileSize < imageW. Pixels in the gap
 *   between that point and imageW are never written to the numerator or
 *   denominator accumulators in _stitchTilesLocal. Their denominator stays
 *   at zero, and the normalisation produces 0.0 → black pixel band.
 *
 * EXAMPLE:
 *   imageW=930, tileSize=512, overlap=0.25 → step=384
 *   Standard grid: col=0 → x=0 (covers 0–511), col=1 → x=384 (covers 384–895)
 *   Pixels 896–929 (34 px) → denominator=0 → BLACK BORDER
 *
 * FIX:
 *   After the standard step positions, always append:
 *     finalX = imageW − tileSize   (last tile's right edge == imageW)
 *   Only added when the last standard tile does not already reach imageW.
 *   Same logic applied independently to the Y dimension.
 *
 *   Coverage proof for the above example:
 *     finalX = 930 − 512 = 418 → tile covers 418–929 ✓ complete
 *
 * FIX 5 — MINIMUM OVERLAP:
 *   tileOverlap is clamped to MIN_TILE_OVERLAP (0.5) before computing step.
 *   Values below this disable meaningful Gaussian blending.
 *
 * @param imageW      - Source image width in pixels
 * @param imageH      - Source image height in pixels
 * @param tileSize    - Model tile resolution (e.g. 512 or 256)
 * @param tileOverlap - Fractional overlap from ModelConfig
 */
function _buildFullCoverageTileGrid(
	imageW: number,
	imageH: number,
	tileSize: number,
	tileOverlap: number
): TileGrid {
	// ── FIX 5: enforce minimum overlap ────────────────────────────────────────
	const clampedOverlap = Math.max(tileOverlap, MIN_TILE_OVERLAP)
	if (tileOverlap < MIN_TILE_OVERLAP) {
		tracker.warn(
			`[_buildFullCoverageTileGrid] tileOverlap=${tileOverlap} < ` +
				`MIN_TILE_OVERLAP=${MIN_TILE_OVERLAP}. Clamping to ${MIN_TILE_OVERLAP}. ` +
				`Update ModelConfig.tileOverlap or DEFAULT_MODEL_CONFIG to resolve.`
		)
	}

	const overlapPx = Math.round(clampedOverlap * tileSize)
	const step = Math.max(1, tileSize - overlapPx)

	/**
	 * Builds the position array for one canvas dimension.
	 *
	 * Algorithm:
	 *   1. Emit positions at multiples of step while (pos + tileSize < length)
	 *      — these are all positions where the tile does not yet reach the edge.
	 *   2. Append (length − tileSize) as the final position if the last standard
	 *      position does not already guarantee edge coverage.
	 *
	 * This guarantees: positions.last + tileSize == length for any length > tileSize.
	 */
	function _buildPositions(length: number): number[] {
		if (length <= tileSize) return [0]

		const positions: number[] = []
		let pos = 0

		// Standard step positions: all tiles that do not yet reach the right/bottom edge
		while (pos + tileSize < length) {
			positions.push(pos)
			pos += step
		}

		// Edge-anchored final tile: ensures rightmost/bottommost pixels are covered
		const edgePos = length - tileSize
		if (
			positions.length === 0 ||
			positions[positions.length - 1] < edgePos
		) {
			positions.push(edgePos)
		}

		return positions
	}

	const xPositions = _buildPositions(imageW)
	const yPositions = _buildPositions(imageH)

	const numCols = xPositions.length
	const numRows = yPositions.length
	const total = numCols * numRows
	const coords: TileCoord[] = new Array(total)

	for (let row = 0; row < numRows; row++) {
		for (let col = 0; col < numCols; col++) {
			const x = xPositions[col]
			const y = yPositions[row]
			coords[row * numCols + col] = {
				col,
				row,
				index: row * numCols + col,
				x,
				y,
				w: Math.min(tileSize, imageW - x),
				h: Math.min(tileSize, imageH - y),
			}
		}
	}

	tracker.log(
		`[Grid] ${numCols}×${numRows} = ${total} tiles ` +
			`(step=${step}px, overlapPx=${overlapPx}px, ` +
			`xPos=[${xPositions.join(',')}], yPos=[${yPositions.join(',')}])`
	)

	return {
		imageW,
		imageH,
		tileSize,
		step,
		overlapPx,
		numCols,
		numRows,
		total,
		coords,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — TILE RGBA EXTRACTION WITH REFLECTION PADDING  [FIX 3]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Copies one tile's pixels from the full-image RGBA buffer into `output`,
 * using reflection (symmetric mirroring) for any out-of-bounds coordinates.
 *
 * ════════════════════════════════════════════════════════════════════
 * UPGRADE: EDGE-CLAMPING → REFLECTION PADDING
 * ════════════════════════════════════════════════════════════════════
 *
 * PREVIOUS (edge-clamping):
 *   globalX = Math.min(tileX + localX, imageW - 1)
 *   Out-of-bounds pixels replicated the last valid column/row as a constant.
 *   InstanceNorm2d processes the full tile and computes per-tile mean/std.
 *   Constant replicated rows near the edge bias these statistics upward/downward,
 *   producing a brightness or colour shift at boundary tile edges.
 *
 * CURRENT (reflection padding):
 *   Out-of-bounds pixel at globalX < 0       → mapped to -globalX
 *   Out-of-bounds pixel at globalX >= imageW → mapped to 2*(imageW-1) - globalX
 *   The reflected pixel is a real image pixel — it has a realistic local
 *   frequency distribution that minimises InstanceNorm statistics distortion.
 *
 * SAFETY: With _buildFullCoverageTileGrid, the last tile is always positioned at
 *   x = imageW - tileSize, so tileX + tileSize = imageW exactly.
 *   No tile pixel exceeds imageW in the X direction. Reflection is a defensive
 *   guard for numerical edge cases and future-proofing (e.g. preview tiles where
 *   the image is smaller than tileSize).
 *
 * TILE SIZE INVARIANT: Output is always tileSize×tileSize.
 *   TFLite fixed-shape input contract is fully preserved.
 *
 * PIXEL LAYOUT:
 *   Source: fullRgba[(globalY * imageW + globalX) * 4]  — stride: imageW
 *   Dest:   output[(localY * tileSize + localX) * 4]    — stride: tileSize
 *
 * @param fullRgba  - Full decoded RGBA image buffer (row-major, 4 bytes/pixel)
 * @param imageW    - Full image width (source row stride)
 * @param imageH    - Full image height
 * @param coord     - Tile descriptor from TileGrid.coords
 * @param tileSize  - Tile dimension in pixels
 * @param output    - Pre-allocated scratch: Uint8Array[tileSize × tileSize × 4]
 */
function _extractTileRgba(
	fullRgba: Uint8Array,
	imageW: number,
	imageH: number,
	coord: TileCoord,
	tileSize: number,
	output: Uint8Array
): void {
	const tileX = coord.x
	const tileY = coord.y

	for (let localY = 0; localY < tileSize; localY++) {
		// ── Global Y with reflection ───────────────────────────────────────────
		let globalY = tileY + localY
		if (globalY < 0) {
			globalY = -globalY // reflect over top edge
		} else if (globalY >= imageH) {
			globalY = 2 * (imageH - 1) - globalY // reflect over bottom edge
		}
		// Safety clamp: a double-reflection can still land out of bounds
		// for extremely small images (imageH < tileSize / 2).
		if (globalY < 0) globalY = 0
		else if (globalY >= imageH) globalY = imageH - 1

		for (let localX = 0; localX < tileSize; localX++) {
			// ── Global X with reflection ───────────────────────────────────────
			let globalX = tileX + localX
			if (globalX < 0) {
				globalX = -globalX
			} else if (globalX >= imageW) {
				globalX = 2 * (imageW - 1) - globalX
			}
			if (globalX < 0) globalX = 0
			else if (globalX >= imageW) globalX = imageW - 1

			// ── Row-major index arithmetic ─────────────────────────────────────
			// Source stride = imageW (FULL IMAGE width, not tileSize)
			// Dest   stride = tileSize
			const srcIdx = (globalY * imageW + globalX) * RGBA_CH
			const dstIdx = (localY * tileSize + localX) * RGBA_CH

			output[dstIdx] = fullRgba[srcIdx]
			output[dstIdx + 1] = fullRgba[srcIdx + 1]
			output[dstIdx + 2] = fullRgba[srcIdx + 2]
			output[dstIdx + 3] = fullRgba[srcIdx + 3]
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — GAUSSIAN BLEND WINDOW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the pre-computed 2D Gaussian blend window for a given tile size.
 * Builds and caches on first call; subsequent calls are O(1).
 *
 * FORMULA (matches artlens_infer_v5.py::_make_gaussian_window):
 *   sigma     = tileSize / MODEL_GAUSSIAN_SIGMA_DIV   (5.0)
 *   center    = (tileSize − 1) / 2
 *   w1d[i]    = exp(−(i − center)² / (2σ²))
 *   W2d[y,x]  = w1d[y] × w1d[x]               outer product
 *   W2d       = W2d / W2d.max()                peak → 1.0
 *   W2d      += GAUSSIAN_FLOOR_EPSILON (1e-6)           div-by-zero safety
 *
 * Centre weight = 1.0; edge weight ≈ 0.044 (σ_div=5.0) — near-zero edge weight
 * suppresses tile-boundary content in the weighted average.
 */
function _precomputeGaussianWindow(tileSize: number): Float32Array {
	const cached = _gaussianWindowCache.get(tileSize)
	if (cached !== undefined) return cached

	const sigma = tileSize / MODEL_GAUSSIAN_SIGMA_DIV
	const twoSigmaSq = 2.0 * sigma * sigma
	const center = (tileSize - 1) / 2.0

	const w1d = new Float32Array(tileSize)
	for (let i = 0; i < tileSize; i++) {
		const d = i - center
		w1d[i] = Math.exp(-(d * d) / twoSigmaSq)
	}

	const W2d = new Float32Array(tileSize * tileSize)
	let maxVal = 0.0
	for (let y = 0; y < tileSize; y++) {
		for (let x = 0; x < tileSize; x++) {
			const v = w1d[y] * w1d[x]
			W2d[y * tileSize + x] = v
			if (v > maxVal) maxVal = v
		}
	}

	const invMax = maxVal > 0.0 ? 1.0 / maxVal : 1.0
	for (let i = 0; i < W2d.length; i++) {
		W2d[i] = W2d[i] * invMax + GAUSSIAN_FLOOR_EPSILON
	}

	_gaussianWindowCache.set(tileSize, W2d)
	tracker.log(
		`Gaussian window: tileSize=${tileSize}, sigma=${sigma.toFixed(1)}, ` +
			`edgeWeight≈${Math.exp(-(MODEL_GAUSSIAN_SIGMA_DIV ** 2) / 8).toFixed(4)}`
	)
	return W2d
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — GAUSSIAN OVERLAP-ADD STITCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstructs the full stylised canvas from processed tiles using
 * Gaussian-weighted overlap-add accumulation.
 *
 * ALGORITHM:
 *   For each tile at global anchor (tileX, tileY), for each local pixel (lX, lY):
 *     globalX = tileX + lX    (skip if ≥ imageW)
 *     globalY = tileY + lY    (skip if ≥ imageH)
 *     w       = gaussianWindow[lY * tileSize + lX]
 *     val     = (rawF32[lY*T+lX] + 1.0) × 0.5      denormalise Tanh [-1,1] → [0,1]
 *
 *     numerator  [globalY*imageW+globalX] += val × w
 *     denominator[globalY*imageW+globalX] += w
 *
 *   output[px] = numerator[px] / denominator[px]    normalised weighted avg
 *
 * CANVAS STRIDE: All index arithmetic uses imageW as stride — not tileSize.
 *
 * @param grid      - TileGrid from _buildFullCoverageTileGrid
 * @param tiles     - All ProcessedTile objects from _runTiledHotLoop
 * @param imageW    - Canvas width (stride for all index math)
 * @param imageH    - Canvas height
 * @param tileSize  - Tile dimension (must match tiles' rawF32 layout)
 * @returns Float32Array[imageH × imageW × 3] in [0, 1]
 */
function _stitchTilesLocal(
	grid: TileGrid,
	tiles: ProcessedTile[],
	imageW: number,
	imageH: number,
	tileSize: number
): Float32Array {
	const totalPixels = imageW * imageH
	const numerator = new Float32Array(totalPixels * 3)
	const denominator = new Float32Array(totalPixels)
	const gaussianWindow = _precomputeGaussianWindow(tileSize)

	for (const tile of tiles) {
		const { coord, rawF32: rawOutput } = tile
		const tileF32 = new Float32Array(rawOutput)
		const tileX = coord.x
		const tileY = coord.y

		for (let localY = 0; localY < tileSize; localY++) {
			const globalY = tileY + localY
			if (globalY < 0 || globalY >= imageH) continue

			const canvasRowBase = globalY * imageW

			for (let localX = 0; localX < tileSize; localX++) {
				const globalX = tileX + localX
				if (globalX < 0 || globalX >= imageW) continue

				const weight = gaussianWindow[localY * tileSize + localX]
				const srcBase = (localY * tileSize + localX) * 3
				const dstBase = (canvasRowBase + globalX) * 3

				// Denormalise Tanh [-1,1] → [0,1]
				const r = (tileF32[srcBase] + 1.0) * 0.5
				const g = (tileF32[srcBase + 1] + 1.0) * 0.5
				const b = (tileF32[srcBase + 2] + 1.0) * 0.5

				numerator[dstBase] += r * weight
				numerator[dstBase + 1] += g * weight
				numerator[dstBase + 2] += b * weight
				denominator[canvasRowBase + globalX] += weight
			}
		}
	}

	// ── Normalise: weighted average → [0, 1] ──────────────────────────────────
	const stitchedF32 = new Float32Array(totalPixels * 3)
	for (let i = 0; i < totalPixels; i++) {
		const w = denominator[i]
		const invW = w > 1e-10 ? 1.0 / w : 0.0
		const b = i * 3

		let v = numerator[b] * invW
		stitchedF32[b] = v < 0 ? 0 : v > 1 ? 1 : v

		v = numerator[b + 1] * invW
		stitchedF32[b + 1] = v < 0 ? 0 : v > 1 ? 1 : v

		v = numerator[b + 2] * invW
		stitchedF32[b + 2] = v < 0 ? 0 : v > 1 ? 1 : v
	}

	return stitchedF32
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — TEXTURE-ONLY COLOUR CORRECTION  [FIX 4]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Corrects per-tile InstanceNorm colour drift via YCbCr luminance transfer.
 *
 * ════════════════════════════════════════════════════════════════════
 * ROOT CAUSE: PER-TILE INSTANCENORM COLOUR DRIFT
 * ════════════════════════════════════════════════════════════════════
 *
 * The generator's InstanceNorm2d layers normalise activations to zero mean
 * and unit variance PER TILE. Tiles covering different image regions —
 * e.g. a bright sky tile vs a dark ground tile — are normalised to completely
 * different statistics. After stylisation, tiles have inconsistent brightness
 * and colour biases that Gaussian blending only partially conceals at tile
 * boundaries; distinct colour blocks remain visible in the final output.
 *
 * ALGORITHM (mirrors artlens_infer_v5.py::colour_mode_texture_only):
 *
 *   For each pixel i:
 *     sY = 0.299×sR + 0.587×sG + 0.114×sB   (BT.601 luma, stylised)
 *     oY = 0.299×oR + 0.587×oG + 0.114×oB   (BT.601 luma, original)
 *
 *     blendedY = luminanceBlend × sY + (1 − luminanceBlend) × oY
 *       — impasto texture from stylised, global brightness anchored to original
 *
 *     yRatio = blendedY / oY   (guard: oY > 1e-6 to avoid div-by-zero)
 *
 *     outR = oR × yRatio       } scale original RGB by luminance ratio:
 *     outG = oG × yRatio       } preserves chrominance (Cb, Cr) exactly,
 *     outB = oB × yRatio       } transfers blended luma to original palette
 *
 * RESULT:
 *   The output has Van Gogh impasto brushstroke texture (from stylised Y) with
 *   the original photo's exact colour palette (Cb, Cr unchanged). Per-tile
 *   colour drift is eliminated because the final chrominance always comes from
 *   the globally-consistent original image, not the locally-normalised tiles.
 *
 * NOTE: This is a sRGB/YCbCr approximation of the CIE LAB approach used in
 * the Python reference (which requires skimage, unavailable in React Native).
 * BT.601 YCbCr produces equivalent perceptual results for luminance transfer.
 *
 * MEMORY: originalRgba is decoded inline — no separate Float32 intermediate
 * array is allocated. Peak overhead = output array only (3× float32 per pixel).
 *
 * @param stitchedF32     - Gaussian-blended model output [H×W×3] in [0,1]
 * @param originalRgba    - Source photo pixels [H×W×4] uint8 [0,255] — not modified
 * @param imageW          - Canvas width in pixels
 * @param imageH          - Canvas height in pixels
 * @param luminanceBlend  - Impasto depth blend ratio [0.0–1.0]; default 0.85
 * @returns               - Colour-corrected Float32Array [H×W×3] in [0,1]
 */
function _applyTextureOnlyColour(
	stitchedF32: Float32Array,
	originalRgba: Uint8Array,
	imageW: number,
	imageH: number,
	luminanceBlend: number
): Float32Array {
	const out = new Float32Array(stitchedF32.length)
	const totalPixels = imageW * imageH

	for (let i = 0; i < totalPixels; i++) {
		const sBase = i * 3
		const oBase = i * RGBA_CH

		// ── Stylised RGB in [0, 1] ─────────────────────────────────────────────
		const sR = stitchedF32[sBase]
		const sG = stitchedF32[sBase + 1]
		const sB = stitchedF32[sBase + 2]

		// ── Original RGB in [0, 1] — decoded inline to avoid extra allocation ──
		const oR = originalRgba[oBase] / 255.0
		const oG = originalRgba[oBase + 1] / 255.0
		const oB = originalRgba[oBase + 2] / 255.0

		// ── BT.601 luma (Y = 0.299R + 0.587G + 0.114B) ────────────────────────
		const sY = 0.299 * sR + 0.587 * sG + 0.114 * sB // stylised luminance
		const oY = 0.299 * oR + 0.587 * oG + 0.114 * oB // original luminance

		// ── Blended luminance: impasto texture + original brightness anchor ────
		const blendedY = luminanceBlend * sY + (1.0 - luminanceBlend) * oY

		// ── Chrominance-preserving luma transfer ───────────────────────────────
		// yRatio scales original RGB to achieve blendedY while keeping Cb, Cr.
		// Guard: very dark pixels (oY ≤ GAUSSIAN_FLOOR_EPSILON) receive absolute blendedY directly.
		const yRatio = oY > GAUSSIAN_FLOOR_EPSILON ? blendedY / oY : blendedY

		const r = yRatio * oR
		const g = yRatio * oG
		const b = yRatio * oB

		out[sBase] = r < 0 ? 0 : r > 1 ? 1 : r
		out[sBase + 1] = g < 0 ? 0 : g > 1 ? 1 : g
		out[sBase + 2] = b < 0 ? 0 : b > 1 ? 1 : b
	}

	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12 — FLOAT32 RGB → RGBA UINT8 CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a colour-corrected Float32Array [H×W×3] in [0,1] to a
 * Uint8Array [H×W×4] (RGBA_8888, alpha=255) for Skia encoding.
 *
 * display_u8 = round(clamp(f32, 0, 1) × 255)
 * Alpha is always 255 — the stylised output is fully opaque.
 */
function _f32StitchedToRgba(
	f32: Float32Array,
	imageW: number,
	imageH: number
): Uint8Array {
	const totalPixels = imageW * imageH
	const rgba = new Uint8Array(totalPixels * RGBA_CH)

	for (let i = 0; i < totalPixels; i++) {
		const s = i * 3
		const d = i * RGBA_CH

		let v = f32[s]
		rgba[d] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255)

		v = f32[s + 1]
		rgba[d + 1] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255)

		v = f32[s + 2]
		rgba[d + 2] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255)

		rgba[d + 3] = 255
	}

	return rgba
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13 — JPEG ENCODE & CACHE WRITE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encodes a raw RGBA Uint8Array as JPEG and writes it to the app's cache.
 *
 * PIPELINE:
 *   1. Skia.Data.fromBytes(rgbaBytes)
 *   2. Skia.Image.MakeImage(RGBA_8888, width*4 rowBytes)
 *   3. skImage.encodeToBytes(JPEG, quality) → Uint8Array; dispose SkImage
 *   4. File.write(jpegBytes) → cache URI
 *
 * OUTPUT URI: {Paths.cache}/artlens_{timestamp}_{random5}.jpg
 */
async function _encodeAndSave(
	rgbaBytes: Uint8Array,
	imageW: number,
	imageH: number
): Promise<string> {
	const skData = Skia.Data.fromBytes(rgbaBytes)
	const outputSkImage = Skia.Image.MakeImage(
		{
			width: imageW,
			height: imageH,
			colorType: ColorType.RGBA_8888,
			alphaType: AlphaType.Opaque,
		},
		skData,
		imageW * RGBA_CH
	)
	if (!outputSkImage) {
		throw new Error(
			`[TiledInferenceRunner] Skia.Image.MakeImage() failed for ${imageW}×${imageH}.`
		)
	}

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
			'[TiledInferenceRunner] encodeToBytes(JPEG) returned null.'
		)
	}

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
// SECTION 14 — SHARED TILED HOT LOOP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared hot loop for both runTiledInference (main) and runPreviewInference (preview).
 *
 * BUFFER ACQUISITION (registry-backed, zero allocation in hot loop):
 *   scratchBuf — getOrAllocateBuffer(slot, 'rgba', tileSize)  → tileSize²×4 bytes
 *   inputBuf   — getOrAllocateBuffer(slot, 'input', tileSize) → tileSize²×3×4 bytes
 *
 *   Both are O(1) registry hits after the first invocation for a given slot×tileSize.
 *
 * FIX 1 (preserved):
 *   rawOutput.slice(0) creates an owned copy of the TFLite output buffer.
 *   react-native-fast-tflite reuses the same native output buffer on every
 *   runSync() call. Without slice(0), every ProcessedTile would reference the
 *   same memory, all holding only the last tile's output.
 *
 * ABORT: shouldAbort() checked BEFORE each synchronous forward pass.
 *   Maximum abort latency = one tile's inference time (~50–200ms).
 */
async function _runTiledHotLoop(
	slot: 'main' | 'preview',
	tileSize: number,
	fullRgba: Uint8Array,
	imageW: number,
	imageH: number,
	grid: TileGrid,
	callbacks: TiledInferenceCallbacks
): Promise<ProcessedTile[]> {
	const { total: totalTiles, coords } = grid
	const processedTiles: ProcessedTile[] = []

	const scratchBuf = getOrAllocateBuffer(slot, 'rgba', tileSize)
	const scratch = new Uint8Array(scratchBuf, 0, tileSize * tileSize * RGBA_CH)
	const inputBuf = getOrAllocateBuffer(slot, 'input', tileSize, false)

	for (let tileIdx = 0; tileIdx < totalTiles; tileIdx++) {
		// ── Abort check ────────────────────────────────────────────────────────
		if (callbacks.shouldAbort()) {
			tracker.log(`Abort at tile ${tileIdx}/${totalTiles}`)
			throw new InferenceAbortError()
		}

		const coord = coords[tileIdx]

		// ── A: Reflection-padded tile extraction ──────────────────────────────
		_extractTileRgba(fullRgba, imageW, imageH, coord, tileSize, scratch)

		// ── B: RGBA → float32 RGB normalisation ───────────────────────────────
		// channel / 127.5 − 1.0 → float32 in [-1, 1]. Alpha discarded.
		prepareInputTensor(scratch, inputBuf, tileSize, false)

		// ── C: TFLite forward pass (synchronous, blocks JS thread) ────────────
		const rawOutput = InferenceEngine.runInferenceSync(slot, inputBuf)

		// ── FIX 1: Deep copy before next runSync overwrites native buffer ──────
		const rawOutputCopy = rawOutput.slice(0)

		// ── D: Accumulate with global tile anchor ──────────────────────────────
		processedTiles.push({ coord, rawF32: rawOutputCopy })

		// ── E: Progress report ─────────────────────────────────────────────────
		callbacks.onProgress((tileIdx + 1) / totalTiles)

		// ── F: Yield to event loop ─────────────────────────────────────────────
		await _yieldToEventLoop()
	}

	return processedTiles
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15 — MAIN ENTRY POINT (teacher model)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes the full tiled inference pipeline using the MAIN (teacher) slot.
 *
 * RESOLUTION: config.mainModel read directly — no module-scope constant override.
 *   Supports any tile resolution: 256, 384, 512, etc.
 *
 * COLOUR CORRECTION: _applyTextureOnlyColour applied post-stitch.
 *   luminanceBlend sourced from config.luminanceBlend if present,
 *   falling back to DEFAULT_LUMINANCE_BLEND (0.85).
 *
 * GRID: _buildFullCoverageTileGrid used instead of tensorUtils.tileImage.
 *   Guarantees 100% canvas coverage. Enforces MIN_TILE_OVERLAP (0.5).
 *
 * @param sourceUri - Absolute file:// URI of the source JPEG/PNG/WebP
 * @param styleId   - Style identifier for ModelConfig resolution
 * @param callbacks - { onProgress, shouldAbort } from StyleJobService
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

	if (!InferenceEngine.isModelLoaded('main')) {
		throw new Error(
			'[TiledInferenceRunner] Main model slot is not loaded. ' +
				'Caller must await InferenceEngine.loadMainModel() first.'
		)
	}

	// ── Phase 0: Load dynamic model config ────────────────────────────────────
	const config = await getModelConfig(styleId)
	const inferenceRes = config.mainModel
	const luminanceBlend =
		(config as ModelConfig & { luminanceBlend?: number }).luminanceBlend ??
		DEFAULT_LUMINANCE_BLEND

	tracker.log(
		`Config: inferenceRes=${inferenceRes}, tileOverlap=${config.tileOverlap}, ` +
			`luminanceBlend=${luminanceBlend}`
	)

	// ── Phase 1: Decode source image ──────────────────────────────────────────
	const { fullRgba, imageW, imageH } = await _decodeSourceImage(sourceUri)

	// ── Phase 2: Full-coverage tile grid  [FIX 2 + FIX 5] ────────────────────
	const grid = _buildFullCoverageTileGrid(
		imageW,
		imageH,
		inferenceRes,
		config.tileOverlap
	)
	const { total: totalTiles } = grid

	// ── Phase 3: Tiled hot loop  [FIX 1 + FIX 3] ─────────────────────────────
	const processedTiles = await _runTiledHotLoop(
		'main',
		inferenceRes,
		fullRgba,
		imageW,
		imageH,
		grid,
		callbacks
	)
	tracker.log(`Hot loop done: ${processedTiles.length} tiles`)

	// ── Phase 4: Gaussian overlap-add stitch ──────────────────────────────────
	const stitchedF32 = _stitchTilesLocal(
		grid,
		processedTiles,
		imageW,
		imageH,
		inferenceRes
	)
	tracker.log(
		`Stitch done: ${imageW}×${imageH}, ${(stitchedF32.byteLength / 1_048_576).toFixed(1)} MB`
	)

	// ── Phase 4b: Texture-only colour correction  [FIX 4] ─────────────────────
	// Replaces InstanceNorm-drifted tile colours with original photo chrominance.
	// fullRgba carries the original source pixels — always available at this point.
	const correctedF32 = _applyTextureOnlyColour(
		stitchedF32,
		fullRgba,
		imageW,
		imageH,
		luminanceBlend
	)
	tracker.log(`Colour correction done (luminanceBlend=${luminanceBlend})`)

	// ── Phase 5: Float32 RGB [0,1] → RGBA Uint8 ───────────────────────────────
	const rgbaBytes = _f32StitchedToRgba(correctedF32, imageW, imageH)

	// ── Phase 6: JPEG encode and write to cache ────────────────────────────────
	const resultUri = await _encodeAndSave(rgbaBytes, imageW, imageH)

	const durationMs = Date.now() - t0
	tracker.log(
		`Complete — ${totalTiles} tiles, ${durationMs}ms, uri=${resultUri}`
	)

	return { resultUri, imageW, imageH, totalTiles, durationMs }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 16 — PREVIEW ENTRY POINT (student model)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes the tiled inference pipeline using the PREVIEW (student) slot.
 *
 * RESOLUTION: config.previewModel is the authoritative tile dimension.
 *   A local previewConfig promotes previewModel → mainModel so that
 *   _buildFullCoverageTileGrid reads the correct resolution. The original
 *   config object is not mutated.
 *
 * COLOUR CORRECTION: applied with same luminanceBlend as main path.
 *   May be omitted for ultra-low-latency preview builds by setting
 *   luminanceBlend to 1.0 (no original contribution, skip correction).
 *
 * @param sourceUri - Absolute file:// URI of the source photo
 * @param styleId   - Style identifier for ModelConfig resolution
 * @param callbacks - { onProgress, shouldAbort } from StyleJobService
 */
export async function runPreviewInference(
	sourceUri: string,
	styleId: StyleId,
	callbacks: TiledInferenceCallbacks
): Promise<TiledInferenceResult> {
	const t0 = Date.now()
	tracker.log(
		`runPreviewInference — styleId="${styleId}", source="${sourceUri}"`
	)

	if (!InferenceEngine.isModelLoaded('preview')) {
		throw new Error(
			'[TiledInferenceRunner] Preview model slot is not loaded. ' +
				'Caller must await InferenceEngine.loadPreviewModel() first.'
		)
	}

	// ── Phase 0: Config — promote previewModel into mainModel for grid builder ─
	const config = await getModelConfig(styleId)
	const previewRes = config.previewModel
	const luminanceBlend =
		(config as ModelConfig & { luminanceBlend?: number }).luminanceBlend ??
		DEFAULT_LUMINANCE_BLEND

	// Local override: do NOT mutate the shared config object.
	const previewConfig: ModelConfig = { ...config, mainModel: previewRes }
	tracker.log(
		`Config (preview): inferenceRes=${previewRes}, ` +
			`tileOverlap=${config.tileOverlap}, luminanceBlend=${luminanceBlend}`
	)

	// ── Phase 1: Decode source image ──────────────────────────────────────────
	const { fullRgba, imageW, imageH } = await _decodeSourceImage(sourceUri)

	// ── Phase 2: Full-coverage tile grid at preview resolution ────────────────
	const grid = _buildFullCoverageTileGrid(
		imageW,
		imageH,
		previewRes,
		previewConfig.tileOverlap
	)
	const { total: totalTiles } = grid

	// ── Phase 3: Hot loop (preview / student slot) ────────────────────────────
	const processedTiles = await _runTiledHotLoop(
		'preview',
		previewRes,
		fullRgba,
		imageW,
		imageH,
		grid,
		callbacks
	)
	tracker.log(`Preview hot loop done: ${processedTiles.length} tiles`)

	// ── Phase 4: Gaussian stitch ──────────────────────────────────────────────
	const stitchedF32 = _stitchTilesLocal(
		grid,
		processedTiles,
		imageW,
		imageH,
		previewRes
	)
	tracker.log(`Preview stitch done: ${imageW}×${imageH}`)

	// ── Phase 4b: Colour correction ───────────────────────────────────────────
	const correctedF32 = _applyTextureOnlyColour(
		stitchedF32,
		fullRgba,
		imageW,
		imageH,
		luminanceBlend
	)

	// ── Phase 5 & 6: Convert and save ─────────────────────────────────────────
	const rgbaBytes = _f32StitchedToRgba(correctedF32, imageW, imageH)
	const resultUri = await _encodeAndSave(rgbaBytes, imageW, imageH)

	const durationMs = Date.now() - t0
	tracker.log(
		`Preview complete — ${totalTiles} tiles, ${durationMs}ms, uri=${resultUri}`
	)

	return { resultUri, imageW, imageH, totalTiles, durationMs }
}
