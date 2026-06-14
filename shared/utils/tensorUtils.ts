/**
 * @file tensorUtils.ts
 * @description Production-grade tensor manipulation utilities for ArtLens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REFACTOR CHANGES (v4 — lazy buffer registry, dynamic Gaussian window)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX R1 — CRITICAL: Compile-time resolution locking eliminated.
 *    The v3 module-scope `PREVIEW_RES` and `INFERENCE_RES` constants resolved
 *    DEFAULT_MODEL_CONFIG values at script evaluation time. Nine ArrayBuffer /
 *    Uint8Array allocations were then sized from those constants — locking every
 *    model I/O buffer to 256 / 512 for the entire process lifetime regardless of
 *    any over-the-air config update.
 *
 *    Fix: All model-specific I/O buffers are now managed by the internal buffer
 *    registry (_bufferRegistry). Buffers are allocated lazily on first access for
 *    a given resolution, re-used on subsequent accesses, and grown automatically
 *    if a larger resolution is requested later. The only static allocations that
 *    remain are the stitch accumulators (_stitchNumerator, _stitchDenominator),
 *    which are correctly sized to PERFORMANCE_LIMITS.STITCH_MAX_PIXELS — a
 *    hardware capacity limit, not a model-specific resolution.
 *
 *  FIX R2 — CRITICAL: Gaussian window is now lazy and resolution-agnostic.
 *    `_gaussianWindow512` was computed once at module load for a hardcoded 512.
 *    This caused two bugs:
 *      (a) The window size was fixed even if DEFAULT_MODEL_CONFIG.mainModel
 *          changed.
 *      (b) stitchTiles called with tileSize=256 (preview pipeline) indexed the
 *          window as [ty * 256 + tx], which addressed incorrect positions in a
 *          512-wide table — producing subtly wrong stitch weights.
 *    Fix: `getGaussianWindow(resolution)` builds a resolution×resolution window
 *    lazily, caches it per resolution, and returns the cached copy on repeat
 *    calls. stitchTiles now calls getGaussianWindow(tileSize) so both the main
 *    and preview stitch paths use correctly-sized windows.
 *
 *  FIX R3 — decodeModelOutput signature changed from slot to resolution.
 *    The slot-based signature hid the runtime resolution behind a string enum,
 *    forcing the function to resolve resolution from module-scope constants.
 *    The new signature `decodeModelOutput(rawBuf, resolution)` accepts the
 *    resolution directly from the caller, which always has the runtime config.
 *
 *  FIX R4 — f32ToPreviewRgba / f32ToMainRgba accept an explicit resolution.
 *    These functions wrote into fixed-size module-scope Uint8Array singletons
 *    (262 KB and 1 MB). They now accept a `resolution` parameter and write into
 *    a lazily-allocated registry buffer sized for that resolution.
 *
 *  FIX R5 — alphaBlend shared fallback buffer is lazy and growable.
 *    The old sharedBlendBuffer was sized at module load for INFERENCE_RES.
 *    Blending a stitch output larger than that size would throw. The lazy
 *    registry buffer grows to accommodate any length without extra allocation.
 *
 *  FIX R6 — _GAUSSIAN_SIGMA_DIV and GAUSSIAN_FLOOR_EPSILON extracted.
 *    Magic numbers embedded in the IIFE are now canonical constants imported
 *    from constants.ts.
 *
 * PRD § 5 — src/shared/utils/tensorUtils.ts
 */

import type { ModelConfig } from '@/types'
import {
	PERFORMANCE_LIMITS,
	SYSTEM_BOUNDS,
	MODEL_PREPROCESS,
	MODEL_GAUSSIAN_SIGMA_DIV,
	GAUSSIAN_FLOOR_EPSILON,
} from '@/shared/utils/constants'

import { createTracker } from '@/shared/utils/logger'
const tracker = createTracker('tensorUtils')

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — PRIVATE BUFFER REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// All model I/O buffers (inputs, outputs, RGBA decode targets, blend
// workspaces, decode workspaces) are stored in this Map, keyed by a
// descriptor string encoding their purpose, resolution, and element width.
//
// Properties of the registry:
//   • Zero-allocation on the hot path: buffers are created once and reused.
//   • Grows automatically: if a larger resolution is requested for an existing
//     key, _getOrAllocF32 / _getOrAllocU8 replace the buffer.
//   • No runtime locking: since the JS event loop is single-threaded, no mutex
//     is needed around registry reads and writes.

const _bufferRegistry = new Map<string, ArrayBuffer>()

/**
 * Returns a Float32Array view backed by a cached ArrayBuffer.
 * If the existing buffer for `key` is too small for `elements` elements,
 * a new larger buffer is allocated and the old one is discarded.
 */
function _getOrAllocF32(key: string, elements: number): Float32Array {
	const byteLen = elements * SYSTEM_BOUNDS.F32_BYTES
	const existing = _bufferRegistry.get(key)
	if (existing !== undefined && existing.byteLength >= byteLen) {
		return new Float32Array(existing, 0, elements)
	}
	const newBuf = new ArrayBuffer(byteLen)
	_bufferRegistry.set(key, newBuf)
	return new Float32Array(newBuf)
}

/**
 * Returns a Uint8Array view backed by a cached ArrayBuffer.
 * If the existing buffer for `key` is too small for `bytes` bytes,
 * a new larger buffer is allocated and the old one is discarded.
 */
function _getOrAllocU8(key: string, bytes: number): Uint8Array {
	const existing = _bufferRegistry.get(key)
	if (existing !== undefined && existing.byteLength >= bytes) {
		return new Uint8Array(existing, 0, bytes)
	}
	const newBuf = new ArrayBuffer(bytes)
	_bufferRegistry.set(key, newBuf)
	return new Uint8Array(newBuf)
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — PUBLIC BUFFER API  (REPLACE existing getOrAllocateBuffer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The exclusive, type-safe gatekeeper for all model I/O ArrayBuffers.
 *
 * Callers must never allocate model buffers independently. All I/O surfaces
 * — input tensors, output tensors, RGBA decode targets, blend workspaces —
 * must flow through this function so the registry remains the single source
 * of truth for buffer identity and lifetime.
 *
 * KEY ISOLATION GUARANTEE
 * ───────────────────────
 * The registry key encodes slot, bufferType, resolution, and element encoding
 * as `${slot}:${bufferType}:${resolution}_${isU8}`. Concrete examples:
 *
 *   'main:input:512_false'    — float32 input for 512×512 teacher model
 *   'preview:input:256_false' — float32 input for 256×256 student model
 *   'preview:input:256_true'  — INT8 input for 256×256 quantized student model
 *
 * A 512_false and a 256_false buffer are therefore structurally distinct
 * registry entries with no shared backing memory. Passing a 512-slot buffer
 * to a 256-resolution model (the crash vector) is statically impossible when
 * callers supply `config.mainModel` / `config.previewModel` from the live
 * hydrated ModelConfig.
 *
 * ALLOCATION POLICY
 * ─────────────────
 * • Hit  — returns the cached ArrayBuffer; O(1), zero allocation.
 * • Miss — allocates a correctly-sized ArrayBuffer, caches it, logs via
 *   tracker.log, and returns it. Subsequent calls for the same key are hits.
 *
 * @param slot       - Model pipeline slot ('preview' | 'main')
 * @param bufferType - Logical buffer role within the slot
 * @param resolution - Runtime tile/model resolution in pixels (e.g. 256 or 512)
 * @param isU8       - false = float32 model, 4 bytes/element (default)
 *                     true  = INT8 quantized model, 1 byte/element
 *
 * @note `tracker` is expected to be available as a globally-injected logger
 *       instance. No import is required — access it as `tracker.log(...)`.
 */
export function getOrAllocateBuffer(
	slot: 'preview' | 'main',
	bufferType: 'input' | 'output' | 'rgba' | 'blend' | 'decode',
	resolution: number,
	isU8: boolean = false
): ArrayBuffer {
	const key = `${slot}:${bufferType}:${resolution}_${isU8}`
	const existing = _bufferRegistry.get(key)
	if (existing !== undefined) return existing

	const bytesPerElement: number = isU8 ? 1 : SYSTEM_BOUNDS.F32_BYTES

	const totalBytes: number =
		bufferType === 'rgba'
			? resolution * resolution * SYSTEM_BOUNDS.RGBA_CHANNELS
			: resolution * resolution * SYSTEM_BOUNDS.CHANNELS * bytesPerElement

	const newBuf = new ArrayBuffer(totalBytes)
	_bufferRegistry.set(key, newBuf)

	tracker.log(
		`[tensorUtils] getOrAllocateBuffer: allocated ${totalBytes}B ` +
			`key="${key}" (resolution=${resolution}, isU8=${isU8})`
	)

	return newBuf
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — STATIC STITCH ACCUMULATORS
// ─────────────────────────────────────────────────────────────────────────────
//
// The stitch numerator and denominator are sized to the hardware capacity
// limit (PERFORMANCE_LIMITS.STITCH_MAX_PIXELS), NOT to a model resolution.
// They are legitimately module-scope singletons — they will never be wrong-
// sized by an OTA model update because they are bounded by a physical
// constraint on the maximum image resolution we accept.
//
// BUG 6 FIX: LAZY ALLOCATION
// ───────────────────────────
// Previously these were allocated at module load:
//   _stitchNumerator    : STITCH_MAX_PIXELS × 3 × 4  ≈  150 MB
//   _stitchDenominator  : STITCH_MAX_PIXELS × 4      ≈   48 MB
//
// On import of tensorUtils, ~198 MB of virtual address space was committed
// instantly — before any model was ever loaded. On 32-bit Android this alone
// exhausts the virtual address space and crashes the process. On 64-bit devices
// under memory pressure, the OS OOM killer terminates the app before inference
// can begin.
//
// Fix: both arrays are `null` until the first call to `stitchTiles` or
// `clearAndResetStitchAccumulators`. Allocation occurs once per process
// lifetime, on first actual use. The same hardware-capacity sizing (STITCH_MAX_PIXELS)
// is preserved — lazy allocation does not change the runtime semantics.

const STITCH_MAX_PIXELS = PERFORMANCE_LIMITS.STITCH_MAX_PIXELS

let _stitchNumerator: Float32Array | null = null
let _stitchDenominator: Float32Array | null = null

/**
 * Returns the stitch numerator accumulator, allocating it on the first call.
 * Subsequent calls are O(1) null-checks with no allocation.
 */
function _getStitchNumerator(): Float32Array {
	if (_stitchNumerator === null) {
		_stitchNumerator = new Float32Array(
			STITCH_MAX_PIXELS * SYSTEM_BOUNDS.CHANNELS
		)
		tracker.log(
			`[tensorUtils] _stitchNumerator lazily allocated: ` +
				`${(_stitchNumerator.byteLength / 1_048_576).toFixed(0)} MB`
		)
	}
	return _stitchNumerator
}

/**
 * Returns the stitch denominator accumulator, allocating it on the first call.
 */
function _getStitchDenominator(): Float32Array {
	if (_stitchDenominator === null) {
		_stitchDenominator = new Float32Array(STITCH_MAX_PIXELS)
		tracker.log(
			`[tensorUtils] _stitchDenominator lazily allocated: ` +
				`${(_stitchDenominator.byteLength / 1_048_576).toFixed(0)} MB`
		)
	}
	return _stitchDenominator
}

/**
 * Completely re-zeros both stitch accumulator arrays across their full
 * hardware-bounded capacity.
 *
 * WHY THIS IS NECESSARY
 * ─────────────────────
 * stitchTiles() zeroes only the active pixel window [0, totalPixels) before
 * each pass. When a 512px-tiled job is followed immediately by a 256px-tiled
 * job on a smaller canvas, the tail region of both accumulators — the indices
 * above the new job's totalPixels — retains weighted residue from the prior
 * pass. If the tiling grid for the new job ever scans into those indices
 * (possible when the new canvas dimensions place a tile origin near the tail),
 * the denominator carries a non-zero phantom weight and the numerator carries
 * a ghost colour contribution. The normalisation in Pass 2 then silently
 * outputs subtly corrupted RGB values, which manifests as seam-coloured
 * halos or stripe artefacts near canvas edges.
 *
 * USAGE
 * ─────
 * Call once at the start of any tiling job whose canvas dimensions or tile
 * resolution differ from the immediately preceding job. It is safe (and cheap
 * relative to inference) to call unconditionally at job boundaries.
 *
 * NOT a substitute for the partial fill inside stitchTiles() — that fill
 * remains necessary to reset the active region between tile accumulation
 * passes within a single job.
 *
 * Time complexity : O(STITCH_MAX_PIXELS) — ~12.5 M float32 elements zeroed.
 * Memory          : In-place; no allocation, no GC pressure.
 */
export function clearAndResetStitchAccumulators(): void {
	_getStitchNumerator().fill(0)
	_getStitchDenominator().fill(0)
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — FP16 LOOKUP TABLE (legacy utility — NOT used by current pipeline)
// ─────────────────────────────────────────────────────────────────────────────
//
// Retained for:
//   • Future INT8/fp16 quantized model variants
//   • External code that imports fp16ToNumber / decodeFp16Buffer
//
// The current teacher/student float32 pipeline does NOT use this table.

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
				bits = s << 31
			} else {
				let nm = m,
					ne = 113
				while ((nm & 0x400) === 0) {
					nm <<= 1
					ne -= 1
				}
				nm &= 0x3ff
				bits = (s << 31) | (ne << 23) | (nm << 13)
			}
		} else if (e === 31) {
			bits = (s << 31) | (0xff << 23) | (m << 13)
		} else {
			bits = (s << 31) | ((e + 112) << 23) | (m << 13)
		}

		view.setInt32(0, bits, false)
		table[h] = view.getFloat32(0, false)
	}
	return table
})()

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — FLOAT16 ↔ FLOAT32 CONVERSION UTILITIES (legacy / future use)
// ─────────────────────────────────────────────────────────────────────────────

const _f32ScratchBuf = new ArrayBuffer(4)
const _f32ScratchView = new DataView(_f32ScratchBuf)

/** Converts an fp16 bit-pattern (uint16) to a JS number via lookup table. */
export function fp16ToNumber(h: number): number {
	return _fp16LookupTable[h & 0xffff]
}

/** Converts a JS number to an fp16 bit-pattern (uint16). Round-to-nearest-even. */
export function numberToFp16Bits(value: number): number {
	_f32ScratchView.setFloat32(0, value, false)
	const bits32 = _f32ScratchView.getInt32(0, false) >>> 0
	const s32 = (bits32 >>> 31) & 0x1
	const e32 = (bits32 >>> 23) & 0xff
	const m32 = bits32 & 0x7fffff

	if (e32 === 0xff) return (s32 << 15) | (0x1f << 10) | (m32 !== 0 ? 1 : 0)
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
	const m16r = m16 + (roundUp ? 1 : 0)
	if (m16r > 0x3ff) return (s32 << 15) | ((e16 + 1) << 10)
	return (s32 << 15) | (e16 << 10) | m16r
}

/** Decodes a packed fp16 ArrayBuffer into a Float32Array via lookup table. */
export function decodeFp16Buffer(
	rawBuf: ArrayBuffer,
	outF32: Float32Array
): Float32Array {
	const u16 = new Uint16Array(rawBuf)
	const len = u16.length
	for (let i = 0; i < len; i++) outF32[i] = _fp16LookupTable[u16[i]]
	return outF32
}

/** Encodes a Float32Array into a packed fp16 ArrayBuffer. */
export function encodeFp16Buffer(f32: Float32Array, rawBuf: ArrayBuffer): void {
	const u16 = new Uint16Array(rawBuf)
	for (let i = 0; i < f32.length; i++) u16[i] = numberToFp16Bits(f32[i])
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — LAZY GAUSSIAN WINDOW CACHE
// ─────────────────────────────────────────────────────────────────────────────
//
// FIX R2: The Gaussian window is no longer pre-computed for a fixed 512px tile
// at module load time. getGaussianWindow(resolution) computes and caches a
// resolution×resolution window on first call, then returns the cached copy.
//
// This fixes two bugs from the v3 code:
//   (a) The window is now correctly sized for any tile resolution, including
//       the 256-pixel preview (student) pipeline.
//   (b) stitchTiles indexes the window as [ty * tileSize + tx], which is
//       correct only when the window stride equals tileSize. Using a 512-wide
//       window with 256-pixel tiles produced incorrect stitch weights.

const _gaussianWindowCache = new Map<number, Float32Array>()

/**
 * Returns a pre-computed 2D Gaussian window of size resolution × resolution.
 * The result is cached per resolution — subsequent calls for the same
 * resolution are O(1) cache lookups with zero allocation.
 *
 * Properties of the returned window:
 *   σ = resolution / MODEL_GAUSSIAN_SIGMA_DIV
 *   Center weight = 1.0 (after peak normalisation)
 *   All weights are shifted by GAUSSIAN_FLOOR_EPSILON to prevent divide-
 *   by-zero in the stitch denominator accumulator.
 *
 * @param resolution - tile dimension in pixels (e.g. 256 for preview, 512 for main)
 */
export function getGaussianWindow(resolution: number): Float32Array {
	const cached = _gaussianWindowCache.get(resolution)
	if (cached !== undefined) return cached

	const sigma = resolution / MODEL_GAUSSIAN_SIGMA_DIV
	const twoS2 = 2.0 * sigma * sigma
	const half = (resolution - 1) / 2.0
	const win = new Float32Array(resolution * resolution)

	for (let y = 0; y < resolution; y++) {
		const dy = y - half
		for (let x = 0; x < resolution; x++) {
			const dx = x - half
			win[y * resolution + x] = Math.exp(-(dx * dx + dy * dy) / twoS2)
		}
	}

	let peak = 0.0
	for (let i = 0; i < win.length; i++) {
		if (win[i] > peak) peak = win[i]
	}
	const invPeak = 1.0 / peak
	for (let i = 0; i < win.length; i++) {
		win[i] = win[i] * invPeak + GAUSSIAN_FLOOR_EPSILON
	}

	_gaussianWindowCache.set(resolution, win)
	return win
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — INPUT PRE-PROCESSING: RGBA → FLOAT32 MODEL INPUT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts raw RGBA camera/image bytes into the model's float32 input buffer.
 *
 * NORMALIZATION CONTRACT:
 *   CUT training normalization: (pixel / MODEL_PREPROCESS.SCALE) - MODEL_PREPROCESS.SHIFT
 *   Range: [0, 255] → [-1.0, 1.0]
 *
 * Alpha channel (rgbaSource[src+3]) is discarded — models are RGB-only.
 *
 * @param rgbaSource   - Source RGBA bytes (row-major, 4 bytes per pixel)
 * @param targetBuffer - Pre-allocated ArrayBuffer. Float32: resolution²×3×4 bytes.
 *                       Uint8: resolution²×3×1 bytes.
 * @param resolution   - Tile size (512 for main/teacher, 256 for preview/student)
 * @param toUint8      - true = INT8 quantized model; false = Float32 model (default)
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
		let src = 0,
			d = 0
		for (let i = 0; i < totalPixels; i++) {
			dst[d] = rgbaSource[src]
			dst[d + 1] = rgbaSource[src + 1]
			dst[d + 2] = rgbaSource[src + 2]
			src += 4
			d += 3
		}
	} else {
		const dst = new Float32Array(targetBuffer)
		let src = 0,
			d = 0
		for (let i = 0; i < totalPixels; i++) {
			dst[d] =
				rgbaSource[src] / MODEL_PREPROCESS.SCALE -
				MODEL_PREPROCESS.SHIFT
			dst[d + 1] =
				rgbaSource[src + 1] / MODEL_PREPROCESS.SCALE -
				MODEL_PREPROCESS.SHIFT
			dst[d + 2] =
				rgbaSource[src + 2] / MODEL_PREPROCESS.SCALE -
				MODEL_PREPROCESS.SHIFT
			src += 4
			d += 3
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — LIVE VIEWFINDER RGBA CONVERSION  (WORKLET-SAFE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts float32 model output (or uint8 raw bytes) into RGBA display bytes.
 * Writes into the caller-supplied `outputBuffer` — zero allocation.
 *
 * ⚡ WORKLET-SAFE constraints:
 *   ✓ 'worklet' directive
 *   ✓ Zero closures over module-scope variables
 *   ✓ No Math.min / Math.max — Hermes worklet constraint; ternary clamps used
 *   ✓ No intermediate buffers allocated
 *   ✓ No lookup table access — module-scope objects unavailable in worklets
 *
 * isUint8=false path: float32 [-1, 1] → byte = ((v + 1.0) * MODEL_PREPROCESS.SCALE)
 * isUint8=true path:  RGB packed uint8 → RGBA uint8 with alpha=255
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
		let s = 0,
			d = 0
		for (let i = 0; i < totalPixels; i++) {
			outputBuffer[d] = src8[s]
			outputBuffer[d + 1] = src8[s + 1]
			outputBuffer[d + 2] = src8[s + 2]
			outputBuffer[d + 3] = 255
			s += 3
			d += 4
		}
	} else {
		const src32 = new Float32Array(inputBuffer)
		let s = 0,
			d = 0

		for (let i = 0; i < totalPixels; i++) {
			let rv: number = (src32[s] + 1.0) * MODEL_PREPROCESS.SCALE
			outputBuffer[d] = rv < 0 ? 0 : rv > 255 ? 255 : rv | 0

			let gv: number = (src32[s + 1] + 1.0) * MODEL_PREPROCESS.SCALE
			outputBuffer[d + 1] = gv < 0 ? 0 : gv > 255 ? 255 : gv | 0

			let bv: number = (src32[s + 2] + 1.0) * MODEL_PREPROCESS.SCALE
			outputBuffer[d + 2] = bv < 0 ? 0 : bv > 255 ? 255 : bv | 0

			outputBuffer[d + 3] = 255
			s += 3
			d += 4
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — MODEL OUTPUT DECODE: float32 [-1,1] → float32 [0,1]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decodes raw float32 model output into a lazily-allocated decode workspace
 * in the range [0, 1].
 *
 * FIX R3: Signature changed from `slot: 'preview' | 'main'` to
 * `resolution: number`. The caller already has the runtime model config and
 * therefore knows the resolution. Accepting it directly eliminates the
 * need to look up the resolution from module-scope constants.
 *
 * The returned Float32Array is a view into a lazily-allocated registry buffer.
 * It is valid until the next call to decodeModelOutput with the same resolution
 * (which would overwrite the same backing buffer). Callers must not hold the
 * reference across await boundaries.
 *
 * @param rawBuf    - ArrayBuffer from InferenceEngine.runInferenceSync().
 *                    ByteLength must equal resolution² × 3 × 4 bytes.
 * @param resolution - Runtime tile resolution (e.g. 256 or 512).
 */
export function decodeModelOutput(
	rawBuf: ArrayBuffer,
	resolution: number
): Float32Array {
	const expectedElements = resolution * resolution * SYSTEM_BOUNDS.CHANNELS
	const expectedBytes = expectedElements * SYSTEM_BOUNDS.F32_BYTES

	if (rawBuf.byteLength !== expectedBytes) {
		throw new Error(
			`[tensorUtils] decodeModelOutput: buffer size mismatch. ` +
				`Expected ${expectedBytes}B for resolution=${resolution} (float32 model), ` +
				`got ${rawBuf.byteLength}B. ` +
				`If the model is INT8 quantized, use a separate decode path.`
		)
	}

	// Lazy decode workspace — allocated once per resolution, re-used on repeat calls.
	const out = _getOrAllocF32(`decode:${resolution}`, expectedElements)
	const f32Input = new Float32Array(rawBuf)

	for (let i = 0; i < expectedElements; i++) {
		const v = f32Input[i]
		out[i] = v < -1.0 ? 0.0 : v > 1.0 ? 1.0 : (v + 1.0) * 0.5
	}

	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — TILE COORDINATE GRID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BUG 5 FIX: Minimum overlap clamp for tileImage, aligned with
 * TiledInferenceRunner.MIN_TILE_OVERLAP (0.5).
 *
 * The previous tileImage code clamped at 0.20, while TiledInferenceRunner
 * clamped at 0.5. A caller supplying a value in [0.20, 0.50) would get
 * inconsistent grids depending on which code path executed — tileImage
 * produced a coarser grid than TiledInferenceRunner, making external callers
 * unreliable when tileOverlap was set in that range.
 *
 * Both guards now agree at 0.5. Values below 0.5 disable meaningful Gaussian
 * blending regardless of sigma, so the stricter threshold is also correct.
 */
const MIN_TILEIMAGE_OVERLAP = 0.5

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
 *
 * tileOverlap handling (backward-compatible):
 *   > 1  → treated as pixel count (e.g. 64 px)
 *   ≤ 1  → treated as fraction (e.g. 0.25 = 25%)
 *
 * BUG 4 FIX: The previous implementation always derived `tileSize` from
 * `config.mainModel`. Any caller that needed a preview-resolution grid had
 * to rely on an implicit contract that config.mainModel was already set to
 * the preview resolution — which is never true in normal usage.
 *
 * Fix: accept an explicit `tileSize` parameter. When omitted the function
 * falls back to `config.mainModel` for full backward compatibility. Callers
 * that need the preview grid (student model, 256-resolution pipeline) must
 * pass `config.previewModel` explicitly:
 *   tileImage(w, h, config, config.previewModel)
 */
export function tileImage(
	imageW: number,
	imageH: number,
	config: ModelConfig,
	tileSize?: number // explicit override; omit to use config.mainModel
): TileGrid {
	const resolvedTileSize = tileSize ?? config.mainModel

	const clampedOverlap = Math.max(config.tileOverlap, MIN_TILEIMAGE_OVERLAP)
	if (config.tileOverlap < MIN_TILEIMAGE_OVERLAP) {
		tracker.warn(
			`[tensorUtils] tileImage: tileOverlap=${config.tileOverlap} is below ` +
				`minimum ${MIN_TILEIMAGE_OVERLAP}. Clamping to ${MIN_TILEIMAGE_OVERLAP} to prevent seam artifacts.`
		)
	}

	const overlapPx =
		clampedOverlap > 1
			? Math.round(clampedOverlap)
			: Math.round(clampedOverlap * resolvedTileSize)

	const step = resolvedTileSize - overlapPx

	if (step <= 0) {
		throw new Error(
			`[tensorUtils] tileImage: step=${step} must be > 0. ` +
				`tileSize=${resolvedTileSize}, overlapPx=${overlapPx}. ` +
				`Check ModelConfig.tileOverlap (should be 0.0–0.9 fraction or < tileSize px).`
		)
	}

	const numCols =
		imageW <= resolvedTileSize
			? 1
			: Math.ceil((imageW - resolvedTileSize) / step) + 1
	const numRows =
		imageH <= resolvedTileSize
			? 1
			: Math.ceil((imageH - resolvedTileSize) / step) + 1
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
				w: Math.min(resolvedTileSize, imageW - x),
				h: Math.min(resolvedTileSize, imageH - y),
			}
		}
	}

	return {
		imageW,
		imageH,
		tileSize: resolvedTileSize,
		step,
		overlapPx,
		numCols,
		numRows,
		total,
		coords,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — PROCESSED TILE DESCRIPTOR
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessedTile {
	coord: TileCoord
	/**
	 * Raw float32 model output for this tile.
	 * Layout: NHWC with batch=1 removed → [tileSize, tileSize, 3]
	 * Values: [-1, 1] (Tanh activation range, unnormalized)
	 * ByteLength: tileSize² × 3 × 4 bytes.
	 */
	rawF32: ArrayBuffer
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12 — GAUSSIAN OVERLAP-ADD TILE STITCHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstructs a full-resolution Float32 [0,1] image from Gaussian-blended tiles.
 *
 * FIX R2: Now calls getGaussianWindow(tileSize) instead of using the fixed
 * module-scope _gaussianWindow512. This correctly handles both the main
 * (512-pixel) and preview (256-pixel) pipelines, and any future resolution.
 *
 * The window is indexed as [ty * tileSize + tx], which is correct because
 * getGaussianWindow returns a tileSize×tileSize matrix with row stride tileSize.
 *
 * ALGORITHM (two-pass Gaussian weighted overlap-add):
 *   Pass 1 — Accumulation using pre-allocated _stitchNumerator/_stitchDenominator
 *   Pass 2 — Normalisation → output Float32Array in [0, 1]
 *
 * @param grid  - TileGrid from tileImage()
 * @param tiles - All ProcessedTile objects covering the full grid (any order)
 * @returns      Float32Array [imageH × imageW × 3] in [0, 1]. One fresh allocation.
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
				`exceeds stitch buffer capacity (${STITCH_MAX_PIXELS}px). ` +
				`Source image must be ≤ 7900×4500 px.`
		)
	}

	// FIX R2: Use resolution-appropriate Gaussian window from the lazy cache.
	const gaussianWindow = getGaussianWindow(tileSize)

	// Obtain lazily-allocated accumulators (Bug 6 fix: no longer module-load static).
	const stitchNum = _getStitchNumerator()
	const stitchDen = _getStitchDenominator()

	// Zero-fill pre-allocated accumulators (no per-stitch allocation)
	stitchNum.fill(0, 0, totalPixels * SYSTEM_BOUNDS.CHANNELS)
	stitchDen.fill(0, 0, totalPixels)

	// ── Pass 1: Gaussian-weighted accumulation ────────────────────────────────
	for (let t = 0; t < tiles.length; t++) {
		const { coord, rawF32 } = tiles[t]
		const { x: cx, y: cy, w: tileW, h: tileH } = coord

		const src32 = new Float32Array(rawF32)

		for (let ty = 0; ty < tileH; ty++) {
			const canvasY = cy + ty
			if (canvasY >= imageH) continue

			const canvasRowBase = canvasY * imageW
			const tileRowBase = ty * tileSize

			for (let tx = 0; tx < tileW; tx++) {
				const canvasX = cx + tx
				if (canvasX >= imageW) continue

				// FIX R2: index into the correctly-sized window for this tileSize
				const weight = gaussianWindow[tileRowBase + tx]
				const srcBase = (tileRowBase + tx) * SYSTEM_BOUNDS.CHANNELS

				const rawR = src32[srcBase]
				const rawG = src32[srcBase + 1]
				const rawB = src32[srcBase + 2]

				const fR =
					rawR < -1.0 ? 0.0 : rawR > 1.0 ? 1.0 : (rawR + 1.0) * 0.5
				const fG =
					rawG < -1.0 ? 0.0 : rawG > 1.0 ? 1.0 : (rawG + 1.0) * 0.5
				const fB =
					rawB < -1.0 ? 0.0 : rawB > 1.0 ? 1.0 : (rawB + 1.0) * 0.5

				const numBase =
					(canvasRowBase + canvasX) * SYSTEM_BOUNDS.CHANNELS
				const denIdx = canvasRowBase + canvasX

				stitchNum[numBase] += fR * weight
				stitchNum[numBase + 1] += fG * weight
				stitchNum[numBase + 2] += fB * weight
				stitchDen[denIdx] += weight
			}
		}
	}

	// ── Pass 2: Normalise → output [0, 1] ────────────────────────────────────
	const output = new Float32Array(totalPixels * SYSTEM_BOUNDS.CHANNELS)

	for (let p = 0; p < totalPixels; p++) {
		const invDen = 1.0 / stitchDen[p] // always > GAUSSIAN_FLOOR_EPSILON
		const srcBase = p * SYSTEM_BOUNDS.CHANNELS

		let v = stitchNum[srcBase] * invDen
		output[srcBase] = v < 0 ? 0 : v > 1 ? 1 : v

		v = stitchNum[srcBase + 1] * invDen
		output[srcBase + 1] = v < 0 ? 0 : v > 1 ? 1 : v

		v = stitchNum[srcBase + 2] * invDen
		output[srcBase + 2] = v < 0 ? 0 : v > 1 ? 1 : v
	}

	return output
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13 — ALPHA / LUMINANCE BLENDING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blends original and stylized Float32 [0,1] tensors.
 *
 * FIX R5: The shared blend fallback buffer is no longer a fixed-size module-scope
 * singleton. _getOrAllocF32 provides a lazily-allocated, growable buffer keyed
 * to the required element count. This removes the old upper bound that threw
 * when the input tensor exceeded INFERENCE_RES² × 3 elements.
 *
 * Both tensors must be in [0,1] (post-denormalization). Supplying raw model
 * output in [-1,1] will produce incorrect blend results.
 *
 * Pass `out` to write into a caller-managed buffer (e.g. for large stitched images).
 */
export function alphaBlend(
	original: Float32Array,
	stylized: Float32Array,
	luminanceBlend: number,
	out?: Float32Array
): Float32Array {
	if (original.length !== stylized.length) {
		throw new Error(
			`[tensorUtils] alphaBlend: length mismatch — ` +
				`original=${original.length}, stylized=${stylized.length}.`
		)
	}

	let target: Float32Array
	if (out !== undefined) {
		if (out.length < original.length) {
			throw new Error(
				`[tensorUtils] alphaBlend: supplied out buffer (${out.length}) ` +
					`is smaller than input tensors (${original.length}).`
			)
		}
		target = out
	} else {
		// FIX R5: lazy, growable shared blend buffer — no static size limit.
		target = _getOrAllocF32('blend:shared', original.length)
	}

	const invAlpha = 1.0 - luminanceBlend
	const len = original.length

	for (let i = 0; i < len; i++) {
		const v = original[i] * invAlpha + stylized[i] * luminanceBlend
		target[i] = v < 0 ? 0 : v > 1 ? 1 : v
	}

	return target.subarray(0, len)
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14 — FLOAT32 TENSOR → RGBA BYTE BUFFER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a Float32Array in [0,1] to a Uint8Array of RGBA pixels for
 * the preview (student model) display path.
 *
 * FIX R4: Accepts explicit `resolution` and writes into a lazily-allocated
 * registry buffer instead of a fixed-size module-scope singleton.
 *
 * @param f32        - Float32 tensor in [0,1], length = resolution² × CHANNELS
 * @param resolution - Runtime tile resolution (must match the model that produced f32)
 */
export function f32ToPreviewRgba(
	f32: Float32Array,
	resolution: number
): Uint8Array {
	const totalPixels = (f32.length / SYSTEM_BOUNDS.CHANNELS) | 0
	const rgbaBuf = _getOrAllocU8(
		`rgba:preview:${resolution}`,
		totalPixels * SYSTEM_BOUNDS.RGBA_CHANNELS
	)

	for (let i = 0; i < totalPixels; i++) {
		const s = i * SYSTEM_BOUNDS.CHANNELS
		const d = i * SYSTEM_BOUNDS.RGBA_CHANNELS
		rgbaBuf[d] = (f32[s] * 255) | 0
		rgbaBuf[d + 1] = (f32[s + 1] * 255) | 0
		rgbaBuf[d + 2] = (f32[s + 2] * 255) | 0
		rgbaBuf[d + 3] = 255
	}

	return rgbaBuf
}

/**
 * Converts a Float32Array in [0,1] to a Uint8Array of RGBA pixels for
 * the main (teacher model) display path.
 *
 * FIX R4: Accepts explicit `resolution` and writes into a lazily-allocated
 * registry buffer instead of a fixed-size module-scope singleton.
 *
 * @param f32        - Float32 tensor in [0,1], length = resolution² × CHANNELS
 * @param resolution - Runtime tile resolution (must match the model that produced f32)
 */
export function f32ToMainRgba(
	f32: Float32Array,
	resolution: number
): Uint8Array {
	const totalPixels = (f32.length / SYSTEM_BOUNDS.CHANNELS) | 0
	const rgbaBuf = _getOrAllocU8(
		`rgba:main:${resolution}`,
		totalPixels * SYSTEM_BOUNDS.RGBA_CHANNELS
	)

	for (let i = 0; i < totalPixels; i++) {
		const s = i * SYSTEM_BOUNDS.CHANNELS
		const d = i * SYSTEM_BOUNDS.RGBA_CHANNELS
		rgbaBuf[d] = (f32[s] * 255) | 0
		rgbaBuf[d + 1] = (f32[s + 1] * 255) | 0
		rgbaBuf[d + 2] = (f32[s + 2] * 255) | 0
		rgbaBuf[d + 3] = 255
	}

	return rgbaBuf
}

/**
 * Converts a stitched full-resolution Float32Array [0,1] to a fresh RGBA Uint8Array.
 * Allocates — call only from the background queue, never the camera loop.
 *
 * Input must be in [0, 1] (output of stitchTiles — already denormalized).
 */
export function f32StitchedToRgba(
	f32: Float32Array,
	imageW: number,
	imageH: number
): Uint8Array {
	const totalPixels = imageW * imageH
	const out = new Uint8Array(totalPixels * SYSTEM_BOUNDS.RGBA_CHANNELS)
	for (let i = 0; i < totalPixels; i++) {
		const s = i * SYSTEM_BOUNDS.CHANNELS
		const d = i * SYSTEM_BOUNDS.RGBA_CHANNELS
		out[d] = (f32[s] * 255) | 0
		out[d + 1] = (f32[s + 1] * 255) | 0
		out[d + 2] = (f32[s + 2] * 255) | 0
		out[d + 3] = 255
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15 — BUFFER VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a model output buffer has the expected byte size for float32 models.
 * Expected: resolution² × CHANNELS × F32_BYTES.
 *
 * Accepts the resolution as a runtime parameter — never resolved from static defaults.
 */
export function validateOutputBuffer(
	buf: ArrayBuffer,
	resolution: number
): void {
	const expected =
		resolution *
		resolution *
		SYSTEM_BOUNDS.CHANNELS *
		SYSTEM_BOUNDS.F32_BYTES

	if (buf.byteLength !== expected) {
		throw new Error(
			`[tensorUtils] validateOutputBuffer: ` +
				`expected ${expected}B (float32, resolution=${resolution}), ` +
				`got ${buf.byteLength}B.`
		)
	}
}

/**
 * Validates that a model input buffer has the expected byte size.
 * Float32 model (isU8=false): resolution² × CHANNELS × F32_BYTES.
 * INT8 model (isU8=true):     resolution² × CHANNELS × 1 byte.
 *
 * Accepts the resolution as a runtime parameter — never resolved from static defaults.
 */
export function validateInputBuffer(
	buf: ArrayBuffer,
	resolution: number,
	isU8: boolean
): void {
	const bytesPerEl = isU8 ? 1 : SYSTEM_BOUNDS.F32_BYTES
	const expected =
		resolution * resolution * SYSTEM_BOUNDS.CHANNELS * bytesPerEl

	if (buf.byteLength !== expected) {
		throw new Error(
			`[tensorUtils] validateInputBuffer: ` +
				`expected ${expected}B (resolution=${resolution}, isU8=${isU8}), ` +
				`got ${buf.byteLength}B.`
		)
	}
}
