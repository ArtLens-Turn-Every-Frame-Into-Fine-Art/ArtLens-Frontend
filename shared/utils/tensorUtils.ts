/**
 * @file tensorUtils.ts
 * @description Production-grade tensor manipulation utilities for ArtLens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MODEL PRECISION GROUND TRUTH  (from artlens_convert_v2.py metadata)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Teacher (Main slot)  — artlens_teacher_ngf64_e179_ph1_zpad_simplified_float32.tflite
 *    Input  : [1, 512, 512, 3]  float32  NHWC
 *    Output : [1, 512, 512, 3]  float32  NHWC  (Tanh activation → [-1, 1])
 *    ngf    : 64
 *
 *  Student (Preview slot) — artlens_student_ngf32_b4_e150_zpad_simplified_float32.tflite
 *    Input  : [1, 256, 256, 3]  float32  NHWC
 *    Output : [1, 256, 256, 3]  float32  NHWC  (Tanh activation → [-1, 1])
 *    ngf_s  : 32  n_blocks: 4
 *
 *  Both models use the CUT training normalisation (artlens_teacher_train_v3_1_5.py):
 *    transforms.Normalize(mean=(0.5, 0.5, 0.5), std=(0.5, 0.5, 0.5))
 *    which applied AFTER ToTensor() (pixel/255 → [0,1]) gives:
 *      normalised = (pixel/255 − 0.5) / 0.5  =  pixel/127.5 − 1.0  →  [-1, 1]
 *
 *  Denormalisation (output → display):
 *      display_f32  = (model_out + 1.0) / 2.0              →  [0, 1]
 *      display_u8   = ((model_out + 1.0) * 127.5) clamped  →  [0, 255]
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES (v2 → v3 — float32 model integration)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX A — CRITICAL: All input/output model buffers changed from fp16 to float32.
 *    The previous pipeline allocated `CHANNELS * FP16_BYTES (=2)` bytes per pixel.
 *    Both TFLite models have float32 I/O (4 bytes/element), so buffers were half
 *    the required size — every model.runSync() call would read/write out-of-bounds.
 *    Fix: Introduce F32_BYTES = 4. All model I/O buffers now use F32_BYTES.
 *    Static RAM impact: input/output buffers double. mainInputBuffer 1.5 MB → 3 MB.
 *
 *  FIX B — CRITICAL: prepareInputTensor normalization corrected.
 *    Was: float16(channel / 255)  →  [0, 1] fp16
 *    Now: float32((channel / 127.5) − 1.0)  →  [-1, 1] fp32
 *    Using the wrong normalization offsets every pixel value by 0.5 in model space,
 *    producing severe colour drift and incorrect style transfer output.
 *
 *  FIX C — CRITICAL: stitchTiles / decodeModelOutput fp16 path removed.
 *    Was: Uint16Array view + _fp16LookupTable[src16[i]] per pixel.
 *    Now: Float32Array view + (v + 1.0) * 0.5 denormalization.
 *    The old lookup table returned nonsense for float32 bit patterns.
 *
 *  FIX D — CRITICAL: toRGBAWorklet float32 path updated.
 *    Was: inline fp16 arithmetic decode (sign / exponent / mantissa bit-ops).
 *    Now: float32 with denormalization: ((v + 1.0) * 127.5), clamped via ternary.
 *    Ternary clamping preserves Hermes worklet constraint (no Math.min/Math.max).
 *
 *  FIX E — ProcessedTile.rawFp16 renamed to rawF32.
 *    The buffer holds float32 model output, not fp16. The name change prevents
 *    future callers from misinterpreting the data type.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRESERVED FROM v2 (unchanged)
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. fp16 ↔ float32 utility functions retained (future INT8/fp16 model support).
 *  2. All persistent accumulator arrays pre-allocated at module scope — zero GC.
 *  3. _gaussianWindow512 Gaussian mask pre-computed at module init.
 *  4. stitchTiles Gaussian overlap-add algorithm unchanged (only data type changed).
 *  5. alphaBlend FIX 3 preserved — optional `out` parameter for large images.
 *
 * PRD § 5 — src/shared/utils/tensorUtils.ts
 */

import type { ModelConfig } from '@/types'
import { DEFAULT_MODEL_CONFIG } from '@/shared/utils/constants'

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — DIMENSION CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_RES = DEFAULT_MODEL_CONFIG.previewResolution // 256
const INFERENCE_RES = DEFAULT_MODEL_CONFIG.inferenceResolution // 512
const CHANNELS = 3 as const
const RGBA_CHANNELS = 4 as const

/**
 * Bytes per element for FLOAT32 model I/O.
 * Both teacher and student TFLite models have float32 input/output tensors.
 * This is the primary precision for all model buffers.
 */
const F32_BYTES = 4 as const

/**
 * Bytes per element for FLOAT16.
 * Retained for legacy utility functions and potential future fp16 model support.
 * NOT used by the current teacher/student model I/O buffers.
 */
//const FP16_BYTES = 2 as const

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — PRE-ALLOCATED PERSISTENT BUFFERS
// ─────────────────────────────────────────────────────────────────────────────
//
// Static RAM budget (allocated once at module load):
//
//  MODEL INPUT BUFFERS (float32 — FIX A: was fp16, now 2× larger)
//   previewInputBuffer       256×256×3×4  =    786,432 B  (fp32, [-1,1])
//   previewInputU8Buffer     256×256×3×1  =    196,608 B  (uint8, for INT8 models)
//   mainInputBuffer          512×512×3×4  =  3,145,728 B  (fp32, [-1,1])
//
//  MODEL OUTPUT BUFFERS (float32 — FIX A: was fp16, now 2× larger)
//   previewOutputBuffer      256×256×3×4  =    786,432 B  (fp32, [-1,1] raw)
//   mainOutputBuffer         512×512×3×4  =  3,145,728 B  (fp32, [-1,1] raw)
//
//  DISPLAY SIDE (unchanged — these hold decoded RGBA bytes, not model I/O)
//   sharedPreviewRgbaBuffer  256×256×4    =    262,144 B  (RGBA uint8)
//   sharedMainRgbaBuffer     512×512×4    =  1,048,576 B  (RGBA uint8)
//
//  DECODE WORKSPACE (unchanged size — holds float32 [0,1] after denorm)
//   _sharedF32Decode         512×512×3×4  =  3,145,728 B  (float32, [0,1])
//
//  BLEND WORKSPACE (unchanged)
//   sharedBlendBuffer        512×512×3×4  =  3,145,728 B  (float32)
//
//  STITCH ACCUMULATORS (unchanged — working buffers for Gaussian overlap-add)
//   _stitchNumerator         12,520,525×3×4  ≈  150 MB  (float32)
//   _stitchDenominator       12,520,525×4    ≈   48 MB  (float32)
//
//  FP16 LOOKUP TABLE (retained for legacy use — NOT used by current models)
//   _fp16LookupTable         65,536×4    =    256 KB  (float32)

const STITCH_MAX_PIXELS = 4085 * 3065 // 12,520,525 — 12.5 MP

// ── Input buffers (float32 model inputs) ─────────────────────────────────────
export const previewInputBuffer = new ArrayBuffer(
	PREVIEW_RES * PREVIEW_RES * CHANNELS * F32_BYTES // 786,432 B
)
export const previewInputU8Buffer = new ArrayBuffer(
	PREVIEW_RES * PREVIEW_RES * CHANNELS // 196,608 B (INT8 model fallback)
)
export const mainInputBuffer = new ArrayBuffer(
	INFERENCE_RES * INFERENCE_RES * CHANNELS * F32_BYTES // 3,145,728 B
)

// ── Output reference buffers (unused by pipeline, kept for external consumers) ─
export const previewOutputBuffer = new ArrayBuffer(
	PREVIEW_RES * PREVIEW_RES * CHANNELS * F32_BYTES // 786,432 B
)
export const mainOutputBuffer = new ArrayBuffer(
	INFERENCE_RES * INFERENCE_RES * CHANNELS * F32_BYTES // 3,145,728 B
)

// ── Display buffers ───────────────────────────────────────────────────────────
export const sharedPreviewRgbaBuffer = new Uint8Array(
	PREVIEW_RES * PREVIEW_RES * RGBA_CHANNELS // 262,144 B
)
export const sharedMainRgbaBuffer = new Uint8Array(
	INFERENCE_RES * INFERENCE_RES * RGBA_CHANNELS // 1,048,576 B
)

// ── Blend workspace ───────────────────────────────────────────────────────────
export const sharedBlendBuffer = new Float32Array(
	INFERENCE_RES * INFERENCE_RES * CHANNELS // 786,432 f32 elements
)

// ── Decode workspace (float32 [0,1] after denormalization) ───────────────────
const _sharedF32Decode = new Float32Array(
	INFERENCE_RES * INFERENCE_RES * CHANNELS // 786,432 f32 elements
)

// ── Stitch accumulators ───────────────────────────────────────────────────────
const _stitchNumerator = new Float32Array(STITCH_MAX_PIXELS * CHANNELS)
const _stitchDenominator = new Float32Array(STITCH_MAX_PIXELS)

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — FP16 LOOKUP TABLE (legacy utility — NOT used by current pipeline)
// ─────────────────────────────────────────────────────────────────────────────
//
// Retained for:
//   • Future INT8/fp16 quantized model variants
//   • External code that imports fp16ToNumber / decodeFp16Buffer
//
// The current teacher/student float32 pipeline does NOT use this table.
// stitchTiles and decodeModelOutput now use Float32Array views directly.

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
// SECTION 4 — FLOAT16 ↔ FLOAT32 CONVERSION UTILITIES (legacy / future use)
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
// SECTION 5 — INPUT PRE-PROCESSING: RGBA → FLOAT32 MODEL INPUT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts raw RGBA camera/image bytes into the model's float32 input buffer.
 *
 * NORMALIZATION CONTRACT (FIX B — was pixel/255 → [0,1], now [-1,1]):
 *   CUT training uses: transforms.Normalize(mean=0.5, std=0.5) after ToTensor()
 *   Equivalent formula: normalised = (pixel / 255 − 0.5) / 0.5 = pixel/127.5 − 1.0
 *   Range: [0, 255] → [-1.0, 1.0]
 *
 *   Alpha channel (rgbaSource[src+3]) is discarded — both models are RGB-only.
 *
 * NHWC LAYOUT:
 *   Output interleaved: R₀ G₀ B₀ R₁ G₁ B₁ … (H×W pixels, 3 channels each)
 *   Matches TFLite input tensor layout [1, H, W, 3].
 *
 * @param rgbaSource   - Source RGBA bytes (row-major, 4 bytes per pixel)
 * @param targetBuffer - Pre-allocated ArrayBuffer to write into.
 *                       Float32 models: must be resolution² × 3 × 4 bytes.
 *                       Uint8  models:  must be resolution² × 3 × 1 bytes.
 * @param resolution   - Tile size (512 for main/teacher, 256 for preview/student)
 * @param toUint8      - true = INT8 quantized model (write raw uint8 bytes)
 *                       false = Float32 model (write float32 [-1,1] values) ← default
 */
export function prepareInputTensor(
	rgbaSource: Uint8Array,
	targetBuffer: ArrayBuffer,
	resolution: number,
	toUint8: boolean
): void {
	const totalPixels = resolution * resolution

	if (toUint8) {
		// INT8 quantized model path: copy RGB bytes directly (no normalization)
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
		// Float32 model path (FIX B): normalize to [-1, 1] using CUT training formula
		// formula: (channel_byte / 127.5) - 1.0
		//   0   → -1.000
		//   128 ≈  0.003  (≈ 0)
		//   255 →  1.000
		const dst = new Float32Array(targetBuffer)
		let src = 0,
			d = 0
		for (let i = 0; i < totalPixels; i++) {
			dst[d] = rgbaSource[src] / 127.5 - 1.0 // R: [0,255] → [-1,1]
			dst[d + 1] = rgbaSource[src + 1] / 127.5 - 1.0 // G
			dst[d + 2] = rgbaSource[src + 2] / 127.5 - 1.0 // B
			// Alpha at rgbaSource[src + 3] is discarded — models are RGB-only
			src += 4
			d += 3
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — LIVE VIEWFINDER RGBA CONVERSION  (WORKLET-SAFE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts float32 model output (or uint8 raw bytes) into RGBA display bytes.
 * Writes into the caller-supplied `outputBuffer` — zero allocation.
 *
 * ⚡ WORKLET-SAFE constraints:
 *   ✓ 'worklet' directive.
 *   ✓ Zero closures over module-scope variables — all via parameters.
 *   ✓ No Math.min / Math.max — Hermes worklet constraint. Ternary clamps used.
 *   ✓ No intermediate buffers allocated.
 *   ✓ No lookup table access — module-scope objects unavailable in worklets.
 *
 * isUint8=false path (FIX D — replaces inline fp16 arithmetic):
 *   Reads Float32Array, values in [-1, 1] (raw Tanh model output).
 *   Denormalises: byte = ((v + 1.0) * 127.5) clamped to [0, 255].
 *   This is the inverse of prepareInputTensor's normalisation.
 *
 * isUint8=true path:
 *   Reads Uint8Array (RGB packed), copies directly to RGBA with alpha=255.
 *   Used for INT8 quantized models or pre-decoded uint8 outputs.
 *
 * @param inputBuffer  - Model output: Float32Array (isUint8=false) or Uint8Array (isUint8=true)
 * @param outputBuffer - RGBA uint8 destination (resolution × resolution × 4 bytes)
 * @param resolution   - 512 for main/teacher, 256 for preview/student
 * @param isUint8      - false for float32 models (default), true for uint8/INT8 models
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
		// INT8 model path: packed RGB uint8 → RGBA uint8
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
		// Float32 model path (FIX D): float32 [-1, 1] → uint8 [0, 255]
		// Denormalise: byte = ((v + 1.0) * 127.5)  clamped to [0, 255]
		// No Math.min/max — Hermes worklet requirement. Ternary clamps used.
		//
		// Derivation:
		//   model out v ∈ [-1, 1] (Tanh)
		//   (v + 1.0) ∈ [0, 2]
		//   * 127.5   ∈ [0, 255]
		const src32 = new Float32Array(inputBuffer)
		let s = 0,
			d = 0

		for (let i = 0; i < totalPixels; i++) {
			// Red channel
			let rv: number = (src32[s] + 1.0) * 127.5
			outputBuffer[d] = rv < 0 ? 0 : rv > 255 ? 255 : rv | 0

			// Green channel
			let gv: number = (src32[s + 1] + 1.0) * 127.5
			outputBuffer[d + 1] = gv < 0 ? 0 : gv > 255 ? 255 : gv | 0

			// Blue channel
			let bv: number = (src32[s + 2] + 1.0) * 127.5
			outputBuffer[d + 2] = bv < 0 ? 0 : bv > 255 ? 255 : bv | 0

			outputBuffer[d + 3] = 255 // Alpha: always fully opaque
			s += 3
			d += 4
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — MODEL OUTPUT DECODE: float32 [-1,1] → float32 [0,1]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decodes raw float32 model output into the shared decode workspace [0, 1].
 *
 * DENORMALISATION (FIX C — replaces fp16 lookup table decode):
 *   Raw model output: float32 in [-1, 1] (Tanh activation)
 *   Denormalised:     float32 in [0, 1]  via (v + 1.0) * 0.5
 *
 * Returns a subarray view of _sharedF32Decode — valid until the next call.
 * Callers must not hold the reference across await boundaries.
 *
 * Used by: live preview compositing path (camera → student model → SkiaRenderer)
 * NOT used by: stitchTiles (which denormalises inline during accumulation)
 *
 * @param rawBuf - ArrayBuffer from InferenceEngine.runInferenceSync()
 *                 Contains float32 values in [-1, 1], NHWC layout.
 *                 ByteLength must equal resolution² × 3 × 4 bytes.
 * @param slot   - 'preview' (256×256) or 'main' (512×512)
 */
export function decodeModelOutput(
	rawBuf: ArrayBuffer,
	slot: 'preview' | 'main'
): Float32Array {
	const expectedElements =
		slot === 'preview'
			? PREVIEW_RES * PREVIEW_RES * CHANNELS // 196,608
			: INFERENCE_RES * INFERENCE_RES * CHANNELS // 786,432

	const expectedBytes = expectedElements * F32_BYTES // × 4

	if (rawBuf.byteLength !== expectedBytes) {
		throw new Error(
			`[tensorUtils] decodeModelOutput: buffer size mismatch. ` +
				`Expected ${expectedBytes}B for slot="${slot}" (float32 model), ` +
				`got ${rawBuf.byteLength}B. ` +
				`If the model is INT8 quantized, use a separate decode path.`
		)
	}

	// Denormalize: float32 [-1, 1] → float32 [0, 1]
	// Inversion of CUT training normalization: (v + 1.0) * 0.5
	// Tanh output range is strictly (-1, 1); clamp for numerical safety.
	const f32Input = new Float32Array(rawBuf)
	const out = _sharedF32Decode.subarray(0, expectedElements)

	for (let i = 0; i < expectedElements; i++) {
		const v = f32Input[i]
		// Clamp to [-1, 1] then shift to [0, 1]
		out[i] = v < -1.0 ? 0.0 : v > 1.0 ? 1.0 : (v + 1.0) * 0.5
	}

	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — TILE COORDINATE GRID
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
 *
 * tileOverlap handling (backward-compatible):
 *   > 1  → treated as pixel count (legacy config.json: e.g. 64 px)
 *   ≤ 1  → treated as fraction (preferred: e.g. 0.25 = 25%)
 *
 * DEFAULT_MODEL_CONFIG.tileOverlap = 0.25 (25%) — updated from legacy 64 px.
 * At 25% overlap with 512px tiles: overlapPx = 128, step = 384.
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
				`tileSize=${tileSize}, overlapPx=${overlapPx}. ` +
				`Check ModelConfig.tileOverlap (should be 0.0–0.9 fraction or < tileSize px).`
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
// SECTION 9 — GAUSSIAN WEIGHT MASK (pre-computed at module init)
// ─────────────────────────────────────────────────────────────────────────────
//
// 2D Gaussian window σ = 512 / 5 = 102.4
// Properties:
//   Center weight = 1.0 (after normalisation to peak)
//   Edge weight   ≈ exp(−(256)² / (2 × 102.4²)) = exp(−3.125) ≈ 0.044
//   Floor         = 1e-6 (prevents division by zero in denominator)
//
// See artlens_infer_v5.py Section 5 (_make_gaussian_window) for derivation.

const _GAUSSIAN_SIGMA_DIV = 5.0

const _gaussianWindow512: Float32Array = (() => {
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
	for (let i = 0; i < win.length; i++) if (win[i] > peak) peak = win[i]
	const invPeak = 1.0 / peak
	for (let i = 0; i < win.length; i++) win[i] = win[i] * invPeak + 1e-6

	return win
})()

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — PROCESSED TILE DESCRIPTOR
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessedTile {
	coord: TileCoord
	/**
	 * Raw float32 model output for this tile.
	 * Layout: NHWC with batch=1 removed → [tileSize, tileSize, 3]
	 * Values: [-1, 1] (Tanh activation range, unnormalised)
	 * ByteLength: tileSize × tileSize × 3 × 4 = 3,145,728 B for 512px tiles.
	 *
	 * FIX E: Renamed from rawFp16 — both models are float32, not float16.
	 */
	rawF32: ArrayBuffer
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — GAUSSIAN OVERLAP-ADD TILE STITCHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstructs a full-resolution Float32 [0,1] image from Gaussian-blended tiles.
 *
 * ALGORITHM (two-pass Gaussian weighted overlap-add):
 *   Pass 1 — Accumulation:
 *     For each tile t at canvas position (cx, cy):
 *       For each pixel (tx, ty) within the tile:
 *         raw_v = src32[(ty × 512 + tx) × 3 + ch]    ← float32 in [-1, 1]
 *         f_v   = (raw_v + 1.0) × 0.5                 ← denormalize to [0, 1]
 *         weight = _gaussianWindow512[ty × 512 + tx]
 *         _stitchNumerator[(cy + ty) × imageW × 3 + (cx + tx) × 3 + ch]   += f_v × weight
 *         _stitchDenominator[(cy + ty) × imageW + (cx + tx)]               += weight
 *
 *   Pass 2 — Normalise:
 *     output[p × 3 + ch] = numerator[p × 3 + ch] / denominator[p]
 *     Denominator always > 1e-6 (Gaussian floor) — no div-by-zero possible.
 *
 * FIX C: Input is now Float32Array in [-1,1] (was Uint16Array fp16 with lookup table).
 *        Denormalization `(v + 1.0) * 0.5` replaces `_fp16LookupTable[src16[i]]`.
 *        Output remains Float32Array in [0,1] — downstream code unchanged.
 *
 * @param grid  - TileGrid from tileImage()
 * @param tiles - All ProcessedTile objects covering the full grid (any order)
 * @returns      Float32Array [imageH × imageW × 3] in [0, 1]. One fresh allocation per call.
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
				`Source image must be ≤ 4085×3065 px.`
		)
	}

	// Zero-fill pre-allocated accumulators (no per-stitch allocation)
	_stitchNumerator.fill(0, 0, totalPixels * CHANNELS)
	_stitchDenominator.fill(0, 0, totalPixels)

	// ── Pass 1: Gaussian-weighted accumulation ────────────────────────────────
	for (let t = 0; t < tiles.length; t++) {
		const { coord, rawF32 } = tiles[t] // FIX E: was rawFp16
		const { x: cx, y: cy, w: tileW, h: tileH } = coord

		// FIX C: Float32Array view — replaces Uint16Array + fp16 lookup
		const src32 = new Float32Array(rawF32)

		for (let ty = 0; ty < tileH; ty++) {
			const canvasY = cy + ty
			if (canvasY >= imageH) continue

			const canvasRowBase = canvasY * imageW
			const tileRowBase = ty * tileSize

			for (let tx = 0; tx < tileW; tx++) {
				const canvasX = cx + tx
				if (canvasX >= imageW) continue

				const weight = _gaussianWindow512[tileRowBase + tx]
				const srcBase = (tileRowBase + tx) * CHANNELS // index into src32

				// FIX C: Denormalise from [-1,1] to [0,1]: (v + 1.0) * 0.5
				// Clamp for numerical safety (Tanh is strictly < 1 but FP precision)
				const rawR = src32[srcBase]
				const rawG = src32[srcBase + 1]
				const rawB = src32[srcBase + 2]

				const fR =
					rawR < -1.0 ? 0.0 : rawR > 1.0 ? 1.0 : (rawR + 1.0) * 0.5
				const fG =
					rawG < -1.0 ? 0.0 : rawG > 1.0 ? 1.0 : (rawG + 1.0) * 0.5
				const fB =
					rawB < -1.0 ? 0.0 : rawB > 1.0 ? 1.0 : (rawB + 1.0) * 0.5

				const numBase = (canvasRowBase + canvasX) * CHANNELS
				const denIdx = canvasRowBase + canvasX

				_stitchNumerator[numBase] += fR * weight
				_stitchNumerator[numBase + 1] += fG * weight
				_stitchNumerator[numBase + 2] += fB * weight
				_stitchDenominator[denIdx] += weight
			}
		}
	}

	// ── Pass 2: Normalise → output [0, 1] ────────────────────────────────────
	const output = new Float32Array(totalPixels * CHANNELS)

	for (let p = 0; p < totalPixels; p++) {
		const invDen = 1.0 / _stitchDenominator[p] // always > 1e-6 (Gaussian floor)
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
// SECTION 12 — ALPHA / LUMINANCE BLENDING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blends original and stylized Float32 [0,1] tensors.
 *
 * Both tensors must be in [0,1] (post-denormalization). Supplying raw model
 * output in [-1,1] will produce incorrect blend results.
 *
 * Pass `out` for images > 512×512 (avoids sharedBlendBuffer overflow).
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

	let outBuf: Float32Array
	if (out !== undefined) {
		if (out.length < original.length) {
			throw new Error(
				`[tensorUtils] alphaBlend: supplied out buffer (${out.length}) ` +
					`is smaller than input tensors (${original.length}).`
			)
		}
		outBuf = out
	} else {
		if (original.length > sharedBlendBuffer.length) {
			throw new Error(
				`[tensorUtils] alphaBlend: tensors (${original.length} elements) ` +
					`exceed sharedBlendBuffer (${sharedBlendBuffer.length} elements). ` +
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
// SECTION 13 — FLOAT32 TENSOR → RGBA BYTE BUFFER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a Float32Array in [0,1] to a Uint8Array of RGBA pixels.
 * Input must be post-denormalized (call decodeModelOutput or stitchTiles first).
 */
export function f32ToPreviewRgba(f32: Float32Array): Uint8Array {
	const totalPixels = (f32.length / CHANNELS) | 0
	for (let i = 0; i < totalPixels; i++) {
		const s = i * CHANNELS,
			d = i * RGBA_CHANNELS
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
		const s = i * CHANNELS,
			d = i * RGBA_CHANNELS
		sharedMainRgbaBuffer[d] = (f32[s] * 255) | 0
		sharedMainRgbaBuffer[d + 1] = (f32[s + 1] * 255) | 0
		sharedMainRgbaBuffer[d + 2] = (f32[s + 2] * 255) | 0
		sharedMainRgbaBuffer[d + 3] = 255
	}
	return sharedMainRgbaBuffer
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
	const out = new Uint8Array(totalPixels * RGBA_CHANNELS)
	for (let i = 0; i < totalPixels; i++) {
		const s = i * CHANNELS,
			d = i * RGBA_CHANNELS
		out[d] = (f32[s] * 255) | 0
		out[d + 1] = (f32[s + 1] * 255) | 0
		out[d + 2] = (f32[s + 2] * 255) | 0
		out[d + 3] = 255
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14 — BUFFER VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a model output buffer has the expected byte size for float32 models.
 * Expected: resolution² × 3 channels × 4 bytes (F32_BYTES).
 */
export function validateOutputBuffer(
	buf: ArrayBuffer,
	slot: 'preview' | 'main'
): void {
	const res = slot === 'preview' ? PREVIEW_RES : INFERENCE_RES
	const expected = res * res * CHANNELS * F32_BYTES // FIX A: was FP16_BYTES
	if (buf.byteLength !== expected) {
		throw new Error(
			`[tensorUtils] validateOutputBuffer: slot="${slot}" ` +
				`expected ${expected}B (float32), got ${buf.byteLength}B.`
		)
	}
}

/**
 * Validates that a model input buffer has the expected byte size.
 * Float32 model (isU8=false): resolution² × 3 × 4 bytes.
 * INT8 model (isU8=true):     resolution² × 3 × 1 bytes.
 */
export function validateInputBuffer(
	buf: ArrayBuffer,
	slot: 'preview' | 'main',
	isU8: boolean
): void {
	const res = slot === 'preview' ? PREVIEW_RES : INFERENCE_RES
	const bytesPerEl = isU8 ? 1 : F32_BYTES // FIX A: was FP16_BYTES for float path
	const expected = res * res * CHANNELS * bytesPerEl
	if (buf.byteLength !== expected) {
		throw new Error(
			`[tensorUtils] validateInputBuffer: slot="${slot}" isU8=${isU8} ` +
				`expected ${expected}B, got ${buf.byteLength}B.`
		)
	}
}
