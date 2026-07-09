/**
 * @file tensorUtils.ts
 * @description Production-grade tensor manipulation utilities for ArtLens.
 * PRD § 5 — src/shared/utils/tensorUtils.ts
 */

import { MODEL_PREPROCESS, SYSTEM_BOUNDS } from './constants'

import { createTracker } from '@/shared/utils/logger'
const tracker = createTracker('tensorUtils')

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE BUFFER REGISTRY
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

// ─────────────────────────────────────────────────────────────────────────────
// INPUT PRE-PROCESSING: RGBA → FLOAT32 MODEL INPUT
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
// PUBLIC BUFFER API  (REPLACE existing getOrAllocateBuffer)
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
// ALPHA / LUMINANCE BLENDING
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
