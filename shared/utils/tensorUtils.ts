/**
 * @file tensorUtils.ts
 * @description Production-grade tensor manipulation utilities for ArtLens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES vs v1 (audit-driven fixes)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX 1 — Critical rendering bug: Dead code path in toRGBAWorklet.
 *    The float16 loop contained a first nested block that:
 *      a) Decoded channel R and wrote to outputBuffer[d] using stale `s` index
 *         (from prior pixel iteration, not `i*3`).
 *      b) Incremented `s += 1; d += 1`.
 *      c) Then fell into `s = i * 3; d = i * 4` resetting both.
 *      d) Then the canonical decode blocks ran and wrote correct values.
 *    Net effect: for each pixel, one extra fp16 decode ran on a stale index,
 *    and its result was overwritten by the canonical blocks — 65,536 wasted
 *    ops per frame at 256×256. Additionally `void raw; void sign` at the
 *    bottom confirmed the dead nature of the first block.
 *    Fix: Removed the dead first block entirely. The canonical three-channel
 *    decode blocks (R/G/B) are the only decode path, running against the
 *    correct `s = i * 3` index.
 *
 *  FIX 2 — Performance: `stitchTiles` used DataView for every fp16 decode.
 *    The stitch inner loop called `_f32ScratchView.setInt32` + `getFloat32`
 *    per channel per pixel. For a 4032×3024 image: ~12.6M DataView read-write
 *    pairs — 3–5× slower than arithmetic-path fp16 decoding.
 *    Fix: Pre-compute a 65,536-entry Float32 lookup table at module init
 *    (256KB static, one-time cost). stitchTiles now resolves every fp16 value
 *    with a single array index lookup — O(1), zero DataView overhead.
 *
 *  FIX 3 — Critical: alphaBlend broken for full-resolution stitched images.
 *    sharedBlendBuffer = Float32Array[512×512×3 = 786,432 elements].
 *    RefineScreen calls alphaBlend on a stitched full-res image
 *    (e.g., 4032×3024×3 = ~36.6M elements). The capacity check threw:
 *    "[tensorUtils] alphaBlend: tensors exceed sharedBlendBuffer capacity"
 *    — RefineScreen was completely non-functional for any image > 512×512.
 *    Fix: alphaBlend accepts an optional `out: Float32Array` parameter.
 *    Callers with large images supply their own buffer. Small images
 *    (≤ 512×512×3) still use sharedBlendBuffer with no allocation.
 *
 *  FIX 4 — DEFAULT_MODEL_CONFIG.tileOverlap = 64 is wrong.
 *    ModelConfig.tileOverlap is a fraction [0, 1] per the type definition.
 *    The old value of 64 (pixel count) produced 64/512 = 12.5% overlap,
 *    far below the PRD-specified 50% default, causing visible seam artifacts
 *    in all fallback-config styles.
 *    Fix: This file references DEFAULT_MODEL_CONFIG from constants.ts which
 *    has been corrected to tileOverlap: 0.5. No change needed here, but the
 *    tileImage() dual-interpretation branch (> 1 = pixels, ≤ 1 = fraction)
 *    is retained for backward compatibility with any legacy config.json files
 *    that may still supply pixel counts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNCHANGED ARCHITECTURAL CONTRACTS
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. All persistent ArrayBuffers allocated once at module scope — zero GC.
 *  2. Float16 ↔ Float32 conversion via lookup table (module init) or manual
 *     bitwise arithmetic (worklet path, no module scope access allowed).
 *  3. toRGBAWorklet is fully worklet-safe: no module-scope closures, no
 *     Math.min/max, no global references — all parameters explicit.
 *  4. stitchTiles uses pre-allocated accumulator arrays — zero per-stitch
 *     allocation except the final output Float32Array (unavoidable).
 *
 * PRD § 5 — src/shared/utils/tensorUtils.ts
 */

import type { ModelConfig } from '@/types'
import { DEFAULT_MODEL_CONFIG } from '@/shared/utils/constants'

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — DIMENSION CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_RES = DEFAULT_MODEL_CONFIG.previewResolution
const INFERENCE_RES = DEFAULT_MODEL_CONFIG.inferenceResolution
const CHANNELS = 3 as const
const RGBA_CHANNELS = 4 as const
const FP16_BYTES = 2 as const

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — PRE-ALLOCATED PERSISTENT BUFFERS
// ─────────────────────────────────────────────────────────────────────────────
//
// Static RAM budget (allocated once at module load):
//
//  INPUT SIDE
//   previewInputBuffer       256×256×3×2  =    393,216 B  (fp16)
//   previewInputU8Buffer     256×256×3×1  =    196,608 B  (uint8 fallback)
//   mainInputBuffer          512×512×3×2  =  1,572,864 B  (fp16)
//
//  OUTPUT SIDE
//   previewOutputBuffer      256×256×3×2  =    393,216 B  (fp16)
//   mainOutputBuffer         512×512×3×2  =  1,572,864 B  (fp16)
//
//  DISPLAY SIDE
//   sharedPreviewRgbaBuffer  256×256×4    =    262,144 B  (RGBA)
//   sharedMainRgbaBuffer     512×512×4    =  1,048,576 B  (RGBA)
//
//  BLEND WORKSPACE
//   sharedBlendBuffer        512×512×3×4  =  3,145,728 B  (float32, tile-size only)
//   _sharedF32Decode         512×512×3×4  =  3,145,728 B  (decode workspace)
//
//  STITCH ACCUMULATORS (4032×3024 = 12,192,768 px max — Android 12MP capture)
//   _stitchNumerator         12,192,768×3×4 ≈ 146 MB  (float32)
//   _stitchDenominator       12,192,768×4   ≈  46 MB  (float32)
//
//  FP16 LOOKUP TABLE (FIX 2)
//   _fp16LookupTable         65,536×4       =    256 KB  (float32, one entry per uint16)
//
// NOTE: The stitch accumulators (~192 MB total) are allocated at module init
// to avoid any per-stitch allocation. On 4 GB devices this is acceptable.
// For lower-RAM targets, replace with lazy init or a smaller cap.

const STITCH_MAX_PIXELS = 4085 * 3065 // 12,520,525 — 12 MP

export const previewInputBuffer = new ArrayBuffer(
	PREVIEW_RES * PREVIEW_RES * CHANNELS * FP16_BYTES
)
export const previewInputU8Buffer = new ArrayBuffer(
	PREVIEW_RES * PREVIEW_RES * CHANNELS
)
export const mainInputBuffer = new ArrayBuffer(
	INFERENCE_RES * INFERENCE_RES * CHANNELS * FP16_BYTES
)
export const previewOutputBuffer = new ArrayBuffer(
	PREVIEW_RES * PREVIEW_RES * CHANNELS * FP16_BYTES
)
export const mainOutputBuffer = new ArrayBuffer(
	INFERENCE_RES * INFERENCE_RES * CHANNELS * FP16_BYTES
)
export const sharedPreviewRgbaBuffer = new Uint8Array(
	PREVIEW_RES * PREVIEW_RES * RGBA_CHANNELS
)
export const sharedMainRgbaBuffer = new Uint8Array(
	INFERENCE_RES * INFERENCE_RES * RGBA_CHANNELS
)
export const sharedBlendBuffer = new Float32Array(
	INFERENCE_RES * INFERENCE_RES * CHANNELS
)
const _sharedF32Decode = new Float32Array(
	INFERENCE_RES * INFERENCE_RES * CHANNELS
)
const _stitchNumerator = new Float32Array(STITCH_MAX_PIXELS * CHANNELS)
const _stitchDenominator = new Float32Array(STITCH_MAX_PIXELS)

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — FP16 LOOKUP TABLE  (FIX 2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Pre-compute float32 value for all 65,536 possible uint16 fp16 bit patterns.
// Memory cost: 256 KB allocated once at module init.
// Lookup cost: O(1) array read — eliminates all DataView operations from the
// hot stitch loop. For a 12MP image stitch: ~37M DataView calls → ~37M array reads.
//
// The table is build-once, read-only after construction.

const _fp16LookupTable: Float32Array = (() => {
	const table = new Float32Array(65536)
	const scratch = new ArrayBuffer(4)
	const view = new DataView(scratch)

	for (let h = 0; h < 65536; h++) {
		const s = (h >>> 15) & 0x1
		const e = (h >>> 10) & 0x1f
		const m = h & 0x3ff

		let bits: number

		if (e === 0) {
			if (m === 0) {
				bits = s << 31 // ±zero
			} else {
				// Subnormal fp16 → normalise to fp32
				let nm = m
				let ne = 113 // 127 - 15 + 1
				while ((nm & 0x400) === 0) {
					nm <<= 1
					ne -= 1
				}
				nm &= 0x3ff
				bits = (s << 31) | (ne << 23) | (nm << 13)
			}
		} else if (e === 31) {
			// ±Inf or NaN
			bits = (s << 31) | (0xff << 23) | (m << 13)
		} else {
			// Normal: re-bias exponent (127 - 15 = 112)
			bits = (s << 31) | ((e + 112) << 23) | (m << 13)
		}

		view.setInt32(0, bits, false)
		table[h] = view.getFloat32(0, false)
	}

	return table
})()

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — FLOAT16 ↔ FLOAT32 BITWISE CONVERSION  (JS thread)
// ─────────────────────────────────────────────────────────────────────────────

const _f32ScratchBuf = new ArrayBuffer(4)
const _f32ScratchView = new DataView(_f32ScratchBuf)

/**
 * Converts a single fp16 bit-pattern (uint16) to a JS number.
 * O(1) lookup from pre-computed table — replaces the old DataView arithmetic.
 */
export function fp16ToNumber(h: number): number {
	return _fp16LookupTable[h & 0xffff]
}

/**
 * Converts a JS number to an fp16 bit-pattern (uint16).
 * Round-to-nearest-even. Uses DataView for float32 bit extraction.
 * Not worklet-safe.
 */
export function numberToFp16Bits(value: number): number {
	_f32ScratchView.setFloat32(0, value, false)
	const bits32 = _f32ScratchView.getInt32(0, false) >>> 0

	const s32 = (bits32 >>> 31) & 0x1
	const e32 = (bits32 >>> 23) & 0xff
	const m32 = bits32 & 0x7fffff

	if (e32 === 0xff) {
		return (s32 << 15) | (0x1f << 10) | (m32 !== 0 ? 1 : 0)
	}

	const e16 = e32 - 112

	if (e16 >= 31) return (s32 << 15) | (0x1f << 10)

	if (e16 <= 0) {
		if (e16 < -10) return s32 << 15
		const shift = 1 - e16
		const m16 = (m32 | 0x800000) >>> (shift + 13)
		return (s32 << 15) | m16
	}

	const m16 = (m32 >>> 13) & 0x3ff
	const round = (m32 >>> 12) & 0x1
	const sticky = (m32 & 0xfff) !== 0
	const roundUp = round && (sticky || !!(m16 & 0x1))
	const m16Rounded = m16 + (roundUp ? 1 : 0)

	if (m16Rounded > 0x3ff) return (s32 << 15) | ((e16 + 1) << 10)
	return (s32 << 15) | (e16 << 10) | m16Rounded
}

/**
 * Decodes an entire raw ArrayBuffer of packed fp16 values into a Float32Array.
 * Zero allocation in the loop. Uses lookup table.
 */
export function decodeFp16Buffer(
	rawBuf: ArrayBuffer,
	outF32: Float32Array
): Float32Array {
	const u16 = new Uint16Array(rawBuf)
	const len = u16.length
	for (let i = 0; i < len; i++) {
		outF32[i] = _fp16LookupTable[u16[i]]
	}
	return outF32
}

/**
 * Encodes a Float32Array into a packed fp16 ArrayBuffer via Uint16Array view.
 * Zero allocation in the loop.
 */
export function encodeFp16Buffer(f32: Float32Array, rawBuf: ArrayBuffer): void {
	const u16 = new Uint16Array(rawBuf)
	const len = f32.length
	for (let i = 0; i < len; i++) {
		u16[i] = numberToFp16Bits(f32[i])
	}
}

/**
 * Decodes raw fp16 ArrayBuffer from model output into the shared Float32 workspace.
 * Returns a subarray view — valid until the next decodeModelOutput call.
 */
export function decodeModelOutput(
	rawBuf: ArrayBuffer,
	slot: 'preview' | 'main'
): Float32Array {
	const expectedElements =
		slot === 'preview'
			? PREVIEW_RES * PREVIEW_RES * CHANNELS
			: INFERENCE_RES * INFERENCE_RES * CHANNELS

	if (rawBuf.byteLength !== expectedElements * FP16_BYTES) {
		throw new Error(
			`[tensorUtils] decodeModelOutput: size mismatch. ` +
				`Expected ${expectedElements * FP16_BYTES}B for slot="${slot}", ` +
				`got ${rawBuf.byteLength}B.`
		)
	}

	return decodeFp16Buffer(
		rawBuf,
		_sharedF32Decode.subarray(0, expectedElements)
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — INPUT PRE-PROCESSING: CAMERA RGBA → MODEL INPUT BUFFER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads raw RGBA camera frame bytes, strips the alpha channel, normalises to
 * [0, 1] per channel, and writes packed RGB into `targetBuffer`.
 */
export function prepareInputTensor(
	rgbaSource: Uint8Array,
	targetBuffer: ArrayBuffer,
	resolution: number,
	toUint8: boolean
): void {
	const totalPixels = resolution * resolution

	if (toUint8) {
		const dst = new Uint8Array(targetBuffer)
		let src = 0
		let d = 0
		for (let i = 0; i < totalPixels; i++) {
			dst[d] = rgbaSource[src]
			dst[d + 1] = rgbaSource[src + 1]
			dst[d + 2] = rgbaSource[src + 2]
			src += 4
			d += 3
		}
	} else {
		const dst = new Uint16Array(targetBuffer)
		let src = 0
		let d = 0
		for (let i = 0; i < totalPixels; i++) {
			dst[d] = numberToFp16Bits(rgbaSource[src] / 255)
			dst[d + 1] = numberToFp16Bits(rgbaSource[src + 1] / 255)
			dst[d + 2] = numberToFp16Bits(rgbaSource[src + 2] / 255)
			src += 4
			d += 3
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — LIVE VIEWFINDER RGBA CONVERSION  (WORKLET-SAFE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts model output bytes (fp16 or uint8) into RGBA render bytes.
 * Writes into the caller-supplied `outputBuffer` — zero allocation.
 *
 * ⚡ WORKLET-SAFE constraints:
 *   ✓ 'worklet' directive.
 *   ✓ Zero closures over module-scope variables — all via parameters.
 *   ✓ No Math.min / Math.max (stripped in Hermes worklet serialisation).
 *   ✓ No intermediate buffers allocated.
 *   ✓ No lookup table access — lookup table is module-scope and worklets
 *     cannot safely close over module-level JS objects.
 *     Inline arithmetic fp16 decode is used instead.
 *
 * FIX 1: Removed the dead first-block in the fp16 path.
 *   The original code had two decode passes per pixel:
 *     1. A first block that decoded channel R with a stale `s` index and
 *        incremented s/d, then immediately had them reset by `s = i*3; d = i*4`.
 *     2. The canonical three-channel decode blocks.
 *   The first block was pure dead computation — its output was overwritten
 *   and it used wrong indices for all pixels after i=0.
 *   Fix: Only the canonical three-channel blocks remain, running against
 *   the correct s = i * 3 index. The outer `let s = 0; let d = 0` with
 *   `s += 3; d += 4` at the bottom is cleaner and avoids the multiply.
 */
export function toRGBAWorklet(
	inputBuffer: ArrayBuffer,
	outputBuffer: Uint8Array,
	resolution: number,
	isUint8: boolean
): void {
	'worklet'

	const totalPixels = resolution * resolution

	if (isUint8) {
		const src8 = new Uint8Array(inputBuffer)
		let s = 0
		let d = 0
		for (let i = 0; i < totalPixels; i++) {
			outputBuffer[d] = src8[s]
			outputBuffer[d + 1] = src8[s + 1]
			outputBuffer[d + 2] = src8[s + 2]
			outputBuffer[d + 3] = 255
			s += 3
			d += 4
		}
	} else {
		// FIX 1: Single clean decode pass per pixel — no dead first block.
		// Uses inline arithmetic fp16 decode (no lookup table — not worklet-safe).
		const src16 = new Uint16Array(inputBuffer)
		let s = 0
		let d = 0

		for (let i = 0; i < totalPixels; i++) {
			// ── Channel R ────────────────────────────────────────────────────────
			{
				const h = src16[s]
				const sign = (h >> 15) & 0x1
				const e = (h >> 10) & 0x1f
				const m = h & 0x3ff
				let byteVal: number
				if (e === 0) {
					byteVal = 0
				} else if (e === 31) {
					byteVal = sign ? 0 : 255
				} else {
					const exp = e - 15
					if (sign || exp >= 0) {
						byteVal = sign ? 0 : 255
					} else if (exp < -10) {
						byteVal = 0
					} else {
						const shift = 10 - exp
						const denom = 1024 >> shift
						const intV = (1024 + m) >> shift
						const raw = (intV * 255) / denom
						byteVal = raw < 0 ? 0 : raw > 255 ? 255 : raw | 0
					}
				}
				outputBuffer[d] = byteVal
			}

			// ── Channel G ────────────────────────────────────────────────────────
			{
				const h = src16[s + 1]
				const sign = (h >> 15) & 0x1
				const e = (h >> 10) & 0x1f
				const m = h & 0x3ff
				let byteVal: number
				if (e === 0) {
					byteVal = 0
				} else if (e === 31) {
					byteVal = sign ? 0 : 255
				} else {
					const exp = e - 15
					if (sign || exp >= 0) {
						byteVal = sign ? 0 : 255
					} else if (exp < -10) {
						byteVal = 0
					} else {
						const shift = 10 - exp
						const denom = 1024 >> shift
						const intV = (1024 + m) >> shift
						const raw = (intV * 255) / denom
						byteVal = raw < 0 ? 0 : raw > 255 ? 255 : raw | 0
					}
				}
				outputBuffer[d + 1] = byteVal
			}

			// ── Channel B ────────────────────────────────────────────────────────
			{
				const h = src16[s + 2]
				const sign = (h >> 15) & 0x1
				const e = (h >> 10) & 0x1f
				const m = h & 0x3ff
				let byteVal: number
				if (e === 0) {
					byteVal = 0
				} else if (e === 31) {
					byteVal = sign ? 0 : 255
				} else {
					const exp = e - 15
					if (sign || exp >= 0) {
						byteVal = sign ? 0 : 255
					} else if (exp < -10) {
						byteVal = 0
					} else {
						const shift = 10 - exp
						const denom = 1024 >> shift
						const intV = (1024 + m) >> shift
						const raw = (intV * 255) / denom
						byteVal = raw < 0 ? 0 : raw > 255 ? 255 : raw | 0
					}
				}
				outputBuffer[d + 2] = byteVal
			}

			outputBuffer[d + 3] = 255 // Alpha — fully opaque
			s += 3
			d += 4
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — TILE COORDINATE GRID
// ─────────────────────────────────────────────────────────────────────────────

export interface TileCoord {
	col: number
	row: number
	index: number
	x: number
	y: number
	w: number
	h: number
}

export interface TileGrid {
	imageW: number
	imageH: number
	tileSize: number
	step: number
	overlapPx: number
	numCols: number
	numRows: number
	total: number
	coords: TileCoord[]
}

/**
 * Computes the full overlap tile grid for an arbitrary source image.
 * Pure math — no I/O. O(numTiles).
 *
 * tileOverlap handling: if > 1, treats as pixel count (legacy config.json);
 * if ≤ 1, treats as fraction. The corrected DEFAULT_MODEL_CONFIG uses 0.5.
 */
export function tileImage(
	imageW: number,
	imageH: number,
	config: ModelConfig
): TileGrid {
	const tileSize = config.inferenceResolution

	const overlapPx =
		config.tileOverlap > 1
			? Math.round(config.tileOverlap)
			: Math.round(config.tileOverlap * tileSize)

	const step = tileSize - overlapPx

	if (step <= 0) {
		throw new Error(
			`[tensorUtils] tileImage: step=${step} must be > 0. ` +
				`tileSize=${tileSize}, overlapPx=${overlapPx}. Check ModelConfig.tileOverlap.`
		)
	}

	const numCols =
		imageW <= tileSize ? 1 : Math.ceil((imageW - tileSize) / step) + 1
	const numRows =
		imageH <= tileSize ? 1 : Math.ceil((imageH - tileSize) / step) + 1
	const total = numCols * numRows

	const coords: TileCoord[] = new Array(total)

	for (let row = 0; row < numRows; row++) {
		for (let col = 0; col < numCols; col++) {
			const x = col * step
			const y = row * step
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
// SECTION 8 — GAUSSIAN WEIGHT MASK  (pre-computed module singleton)
// ─────────────────────────────────────────────────────────────────────────────

const _GAUSSIAN_SIGMA_DIV = 5.0

const _gaussianWindow512 = (() => {
	const size = 512
	const sigma = size / _GAUSSIAN_SIGMA_DIV
	const twoS2 = 2 * sigma * sigma
	const half = (size - 1) / 2
	const win = new Float32Array(size * size)

	for (let y = 0; y < size; y++) {
		const dy = y - half
		for (let x = 0; x < size; x++) {
			const dx = x - half
			win[y * size + x] = Math.exp(-(dx * dx + dy * dy) / twoS2)
		}
	}

	let peak = 0
	for (let i = 0; i < win.length; i++) {
		if (win[i] > peak) peak = win[i]
	}
	const invPeak = 1.0 / peak
	for (let i = 0; i < win.length; i++) {
		win[i] = win[i] * invPeak + 1e-6
	}

	return win
})()

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — PROCESSED TILE DESCRIPTOR
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessedTile {
	coord: TileCoord
	rawFp16: ArrayBuffer
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — GAUSSIAN OVERLAP-ADD TILE STITCHING  (FIX 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstructs a full-resolution Float32 image from Gaussian-blended tiles.
 *
 * FIX 2: fp16 decode now uses _fp16LookupTable[src16[i]] — O(1) array lookup
 * per channel, replacing the previous `_f32ScratchView.setInt32 + getFloat32`
 * pair (2 DataView ops per channel → 6 per pixel → ~37M ops for 12MP images).
 *
 * @param grid  - TileGrid from tileImage().
 * @param tiles - All ProcessedTile objects covering the full grid.
 * @returns      Float32Array [imageH × imageW × 3] in [0, 1]. Fresh allocation per call.
 */
export function stitchTiles(
	grid: TileGrid,
	tiles: ProcessedTile[]
): Float32Array {
	const { imageW, imageH, tileSize } = grid
	const totalPixels = imageW * imageH

	if (totalPixels > STITCH_MAX_PIXELS) {
		throw new Error(
			`[tensorUtils] stitchTiles: ${imageW}×${imageH} (${totalPixels}px) ` +
				`exceeds stitch buffer capacity (${STITCH_MAX_PIXELS}px).`
		)
	}

	_stitchNumerator.fill(0, 0, totalPixels * CHANNELS)
	_stitchDenominator.fill(0, 0, totalPixels)

	// ── Pass 1: Weighted accumulation ────────────────────────────────────────
	for (let t = 0; t < tiles.length; t++) {
		const { coord, rawFp16 } = tiles[t]
		const { x: cx, y: cy, w: tileW, h: tileH } = coord

		const src16 = new Uint16Array(rawFp16) // zero-copy view

		for (let ty = 0; ty < tileH; ty++) {
			const canvasY = cy + ty
			if (canvasY >= imageH) continue

			const canvasRowBase = canvasY * imageW
			const tileRowBase = ty * tileSize

			for (let tx = 0; tx < tileW; tx++) {
				const canvasX = cx + tx
				if (canvasX >= imageW) continue

				const weight = _gaussianWindow512[tileRowBase + tx]
				const srcBase = (tileRowBase + tx) * CHANNELS

				// FIX 2: Lookup table replaces DataView — O(1) array read.
				const fR = _fp16LookupTable[src16[srcBase]]
				const fG = _fp16LookupTable[src16[srcBase + 1]]
				const fB = _fp16LookupTable[src16[srcBase + 2]]

				const numBase = (canvasRowBase + canvasX) * CHANNELS
				const denIdx = canvasRowBase + canvasX

				_stitchNumerator[numBase] +=
					fR < 0 ? 0 : fR > 1 ? 1 : fR * weight
				_stitchNumerator[numBase + 1] +=
					fG < 0 ? 0 : fG > 1 ? 1 : fG * weight
				_stitchNumerator[numBase + 2] +=
					fB < 0 ? 0 : fB > 1 ? 1 : fB * weight
				_stitchDenominator[denIdx] += weight
			}
		}
	}

	// ── Pass 2: Normalise and clamp ───────────────────────────────────────────
	const output = new Float32Array(totalPixels * CHANNELS)

	for (let p = 0; p < totalPixels; p++) {
		const invDen = 1.0 / _stitchDenominator[p] // denominator always > 0 (Gaussian floor)
		const srcBase = p * CHANNELS

		let v = _stitchNumerator[srcBase] * invDen
		output[srcBase] = v < 0 ? 0 : v > 1 ? 1 : v

		v = _stitchNumerator[srcBase + 1] * invDen
		output[srcBase + 1] = v < 0 ? 0 : v > 1 ? 1 : v

		v = _stitchNumerator[srcBase + 2] * invDen
		output[srcBase + 2] = v < 0 ? 0 : v > 1 ? 1 : v
	}

	return output
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — ALPHA / LUMINANCE BLENDING  (FIX 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blends original and stylized Float32 RGB tensors.
 * Writes into `out` if provided, otherwise writes into sharedBlendBuffer
 * (only valid for tensors ≤ 512×512×3 = 786,432 elements).
 *
 * FIX 3: The original function always wrote into sharedBlendBuffer and threw
 * for any image > 512×512. RefineScreen calls this on the full-resolution
 * stitched output (e.g., 4032×3024 = ~36.6M elements) — completely broken.
 * Fix: Accept optional `out` parameter. Callers with large images supply
 * a caller-allocated Float32Array. Tile-size callers continue using the
 * shared buffer with no allocation.
 *
 * @param original       - Original image Float32Array [H×W×3] in [0, 1].
 * @param stylized       - Stylized image Float32Array [H×W×3] in [0, 1].
 * @param luminanceBlend - 0.0 = fully original, 1.0 = fully stylized.
 * @param out            - Optional pre-allocated output buffer. If omitted,
 *                         uses sharedBlendBuffer (must fit: ≤ 786,432 elements).
 * @returns               Subarray of the output buffer containing blended values.
 */
export function alphaBlend(
	original: Float32Array,
	stylized: Float32Array,
	luminanceBlend: number,
	out?: Float32Array
): Float32Array {
	if (original.length !== stylized.length) {
		throw new Error(
			`[tensorUtils] alphaBlend: length mismatch. ` +
				`original=${original.length}, stylized=${stylized.length}.`
		)
	}

	// Resolve output buffer: use caller-supplied, or fall back to shared buffer.
	let outBuf: Float32Array
	if (out !== undefined) {
		if (out.length < original.length) {
			throw new Error(
				`[tensorUtils] alphaBlend: supplied out buffer (${out.length}) is smaller ` +
					`than input tensors (${original.length}).`
			)
		}
		outBuf = out
	} else {
		if (original.length > sharedBlendBuffer.length) {
			throw new Error(
				`[tensorUtils] alphaBlend: tensors (${original.length} elements) exceed ` +
					`sharedBlendBuffer (${sharedBlendBuffer.length} elements). ` +
					`Supply a pre-allocated 'out' Float32Array for images > 512×512.`
			)
		}
		outBuf = sharedBlendBuffer
	}

	const invAlpha = 1.0 - luminanceBlend
	const len = original.length

	for (let i = 0; i < len; i++) {
		const v = original[i] * invAlpha + stylized[i] * luminanceBlend
		outBuf[i] = v < 0 ? 0 : v > 1 ? 1 : v
	}

	return out !== undefined
		? outBuf.subarray(0, len)
		: sharedBlendBuffer.subarray(0, len)
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12 — FLOAT32 TENSOR → RGBA BYTE BUFFER
// ─────────────────────────────────────────────────────────────────────────────

export function f32ToPreviewRgba(f32: Float32Array): Uint8Array {
	const totalPixels = (f32.length / CHANNELS) | 0
	for (let i = 0; i < totalPixels; i++) {
		const s = i * CHANNELS
		const d = i * RGBA_CHANNELS
		sharedPreviewRgbaBuffer[d] = (f32[s] * 255) | 0
		sharedPreviewRgbaBuffer[d + 1] = (f32[s + 1] * 255) | 0
		sharedPreviewRgbaBuffer[d + 2] = (f32[s + 2] * 255) | 0
		sharedPreviewRgbaBuffer[d + 3] = 255
	}
	return sharedPreviewRgbaBuffer
}

export function f32ToMainRgba(f32: Float32Array): Uint8Array {
	const totalPixels = (f32.length / CHANNELS) | 0
	if (totalPixels * RGBA_CHANNELS > sharedMainRgbaBuffer.length) {
		throw new Error(
			`[tensorUtils] f32ToMainRgba: ${totalPixels}px exceeds sharedMainRgbaBuffer. ` +
				`Use f32StitchedToRgba() for stitched large images.`
		)
	}
	for (let i = 0; i < totalPixels; i++) {
		const s = i * CHANNELS
		const d = i * RGBA_CHANNELS
		sharedMainRgbaBuffer[d] = (f32[s] * 255) | 0
		sharedMainRgbaBuffer[d + 1] = (f32[s + 1] * 255) | 0
		sharedMainRgbaBuffer[d + 2] = (f32[s + 2] * 255) | 0
		sharedMainRgbaBuffer[d + 3] = 255
	}
	return sharedMainRgbaBuffer
}

/**
 * Converts a stitched full-resolution Float32Array to a fresh RGBA Uint8Array.
 * This DOES allocate — call only from the background queue, never the camera loop.
 */
export function f32StitchedToRgba(
	f32: Float32Array,
	imageW: number,
	imageH: number
): Uint8Array {
	const totalPixels = imageW * imageH
	const out = new Uint8Array(totalPixels * RGBA_CHANNELS)
	for (let i = 0; i < totalPixels; i++) {
		const s = i * CHANNELS
		const d = i * RGBA_CHANNELS
		out[d] = (f32[s] * 255) | 0
		out[d + 1] = (f32[s + 1] * 255) | 0
		out[d + 2] = (f32[s + 2] * 255) | 0
		out[d + 3] = 255
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13 — BUFFER VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function validateOutputBuffer(
	buf: ArrayBuffer,
	slot: 'preview' | 'main'
): void {
	const res = slot === 'preview' ? PREVIEW_RES : INFERENCE_RES
	const expected = res * res * CHANNELS * FP16_BYTES
	if (buf.byteLength !== expected) {
		throw new Error(
			`[tensorUtils] validateOutputBuffer: slot="${slot}" expected ${expected}B, ` +
				`got ${buf.byteLength}B.`
		)
	}
}

export function validateInputBuffer(
	buf: ArrayBuffer,
	slot: 'preview' | 'main',
	isU8: boolean
): void {
	const res = slot === 'preview' ? PREVIEW_RES : INFERENCE_RES
	const bytesPerEl = isU8 ? 1 : FP16_BYTES
	const expected = res * res * CHANNELS * bytesPerEl
	if (buf.byteLength !== expected) {
		throw new Error(
			`[tensorUtils] validateInputBuffer: slot="${slot}" isU8=${isU8} expected ` +
				`${expected}B, got ${buf.byteLength}B.`
		)
	}
}
