/**
 * @file InferenceEngine.ts
 * @description Dual-slot TFLite lifecycle manager for ArtLens.
 *              react-native-fast-tflite v3.x (Nitro Module).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES (this revision)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  FIX A — Ghost-Unload root cause eliminated.
 *    Slot isolation was previously called AFTER `await _checkBatteryGuard()`.
 *    During that async gap, `prioritizeJob()` or `pauseJob()` could set
 *    `_abortCurrentJob = true`. When loadModel returned, the first check in
 *    the StyleJobService for loop saw the flag and immediately unloaded.
 *    Fix: Isolation is now the FIRST operation inside the try block, before
 *    any await, guaranteeing synchronous exclusivity under JS's single-
 *    threaded execution model.
 *
 *  FIX B — Platform-guarded delegate resolution.
 *    `fast-tflite` validates ALL delegates upfront before loading. Passing
 *    `['nnapi', 'android-gpu', 'core-ml']` on Android throws immediately
 *    because CoreML is Apple-only — even if the other delegates are valid.
 *    Fix: `_getDefaultDelegates()` uses `Platform.OS` to produce a safe,
 *    platform-correct array. CoreML is strictly iOS-only. The CPU fallback
 *    is retained for robustness but will now only trigger if the platform-
 *    specific delegates (NNAPI/GPU, Metal/CoreML) are genuinely unavailable.
 *
 *  FIX C — Opposing-slot loading guard during async gaps.
 *    A `loadPreviewModel` call arriving while main is battery-checking could
 *    both slots to load concurrently. Added `_loading[opposing]` check in
 *    the isolation step to abort (no-op) if the other slot is mid-load.
 */

'use strict'

import { loadTensorflowModel } from 'react-native-fast-tflite'
import type {
	TfliteModel,
	TensorflowModelDelegate,
} from 'react-native-fast-tflite'
import { Platform } from 'react-native'
import * as Battery from 'expo-battery'

import type { ModelSlot, ModelConfig } from '@/types'
import { BATTERY_LIMITS, INFERENCE_DELEGATES } from '@/shared/utils/constants'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('InferenceEngine')

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — MODULE-LEVEL STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-slot ModelConfig snapshot captured at load time.
 *
 * Populated by loadMainModel / loadPreviewModel when a config is supplied by
 * the caller. Cleared synchronously by unloadModel. Allows downstream
 * consumers — TiledInferenceRunner, validateInputBuffer, etc. — to query the
 * live runtime resolution for a mounted model without reaching back to the
 * manifest store.
 *
 * Null when no model is loaded OR when the caller did not supply a config.
 * Callers should treat a null result as "resolution unknown, refetch from
 * ModelManager if sizing is required."
 */
const _loadedConfigs: Record<ModelSlot, ModelConfig | null> = {
	preview: null,
	main: null,
}

let _previewModel: TfliteModel | null = null
let _mainModel: TfliteModel | null = null

const _activeModelPaths: Record<ModelSlot, string | null> = {
	preview: null,
	main: null,
}

const _loading: Record<ModelSlot, boolean> = {
	preview: false,
	main: false,
}

const _quantized: Record<ModelSlot, boolean | null> = {
	preview: null,
	main: null,
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — FIX B: PLATFORM-GUARDED DELEGATE RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a platform-safe, ordered delegate array for the given slot.
 *
 * MANDATE 4: All delegate literals are now sourced exclusively from the
 * canonical INFERENCE_DELEGATES map in constants.ts. The engine does not
 * maintain its own inline delegate arrays — any future platform additions
 * or reorderings are made once, in constants.ts, and automatically reflected
 * here.
 *
 * CRITICAL: fast-tflite validates the ENTIRE delegate array before loading.
 * Mixed-platform arrays (e.g. 'core-ml' + 'android-gpu') throw immediately
 * on the incompatible platform, even if individual delegates are valid.
 * Platform.select() guarantees each platform receives only delegates that
 * are native to that runtime.
 *
 * Preview is always CPU/XNNPACK (empty array): GPU delegates add scheduling
 * latency for the small student model and cause frame drops in the live
 * viewfinder (PRD §2.3.3).
 *
 * The spread copies the readonly const arrays into mutable arrays so
 * TypeScript does not widen the inferred return type.
 */
function _getDefaultDelegates(slot: ModelSlot): TensorflowModelDelegate[] {
	if (slot === 'preview') return [...INFERENCE_DELEGATES.preview]

	const platformDelegates =
		Platform.select<readonly TensorflowModelDelegate[]>({
			android: INFERENCE_DELEGATES.main.android,
			ios: INFERENCE_DELEGATES.main.ios,
			default: INFERENCE_DELEGATES.main.default,
		}) ?? INFERENCE_DELEGATES.main.default

	return [...platformDelegates]
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _getModel(slot: ModelSlot): TfliteModel | null {
	return slot === 'preview' ? _previewModel : _mainModel
}

function _setModel(slot: ModelSlot, model: TfliteModel, path: string): void {
	if (slot === 'preview') {
		_previewModel = model
	} else {
		_mainModel = model
	}
	_activeModelPaths[slot] = path
}

/**
 * Reads the quantization mode directly from the model's tensor signature.
 *
 * Returns true  (INT8/UINT8 quantized model),
 *         false (FLOAT32 model), or
 *         null  (dataType field is absent — metadata not available).
 *
 * Separation of concern: this is the only place that touches model.inputs.
 * It returns null rather than a default so that _detectQuantization can
 * make an explicit policy decision on the absent-metadata case.
 */
function _readQuantizationFromTensorSignature(
	slot: ModelSlot,
	model: TfliteModel
): boolean | null {
	try {
		const inputs = model.inputs
		if (!inputs || inputs.length === 0) return null

		const first = inputs[0]
		if (!('dataType' in first) || typeof first.dataType !== 'string') {
			return null
		}

		const dt = (first.dataType as string).toLowerCase()
		const isQuantized = dt === 'uint8' || dt === 'int8'
		tracker.log(
			`[quantize-detect] slot="${slot}" tensor.dataType="${first.dataType}" ` +
				`→ isQuantized=${isQuantized}`
		)
		return isQuantized
	} catch {
		return null
	}
}

/**
 * Resolves the quantization profile for a freshly-loaded slot.
 *
 * MANDATE 2 — Resolution order (no path-heuristic guesswork):
 *
 *  1. Config manifest hint — if the caller supplied a ModelConfig that
 *     carries an explicit `quantized: boolean` field, that is the contract.
 *     The tensor signature is still read and a warning is emitted on conflict
 *     (config says quantized but tensor says float32 is a manifest error).
 *
 *  2. Tensor signature introspection — reading `model.inputs[0].dataType`
 *     is the authoritative source of truth from the binary itself.
 *
 *  3. No fallback guesswork. If both sources are absent, the model defaults
 *     to non-quantized (float32) and logs an explicit warning. Callers that
 *     need guaranteed quantization status must supply a ModelConfig.
 *
 * @param slot   - Slot being loaded (for tracker context only)
 * @param model  - Successfully mounted TfliteModel
 * @param config - Optional ModelConfig supplied by the caller at load time
 */
function _detectQuantization(
	slot: ModelSlot,
	model: TfliteModel,
	config?: ModelConfig
): boolean {
	// ── Branch 1: Config-manifest authoritative hint ─────────────────────────
	//
	// ModelConfig does not currently define a `quantized` field, but the
	// engine is forward-compatible: if the manifest schema ever adds one,
	// this branch activates automatically without a code change.
	if (
		config != null &&
		'quantized' in config &&
		typeof (config as Record<string, unknown>).quantized === 'boolean'
	) {
		const configHint = (config as Record<string, unknown>)
			.quantized as boolean
		const tensorResult = _readQuantizationFromTensorSignature(slot, model)

		if (tensorResult !== null && tensorResult !== configHint) {
			tracker.warn(
				`[quantize-detect] slot="${slot}" CONFLICT: config.quantized=${configHint} ` +
					`disagrees with tensor signature (isQuantized=${tensorResult}). ` +
					`Trusting tensor signature — update the manifest config to resolve.`
			)
			return tensorResult
		}

		tracker.log(
			`[quantize-detect] slot="${slot}" → config manifest hint: isQuantized=${configHint}`
		)
		return configHint
	}

	// ── Branch 2: Tensor signature introspection ─────────────────────────────
	const tensorResult = _readQuantizationFromTensorSignature(slot, model)
	if (tensorResult !== null) return tensorResult

	// ── Branch 3: No guesswork — default float32 with explicit warning ───────
	tracker.warn(
		`[quantize-detect] slot="${slot}" — tensor dataType field is absent and no ` +
			`ModelConfig hint was supplied. Defaulting to float32 (non-quantized). ` +
			`Supply a ModelConfig with quantization metadata to suppress this warning.`
	)
	return false
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — BATTERY GUARD
// ─────────────────────────────────────────────────────────────────────────────

async function _checkBatteryGuard(slot: ModelSlot): Promise<void> {
	if (slot !== 'main') return

	let level: number
	try {
		level = (await Battery.getBatteryLevelAsync()) * 100
	} catch (err) {
		tracker.log(
			`[battery-guard] Unable to read battery: ${err}. Proceeding (assume safe).`
		)
		return
	}

	if (level <= BATTERY_LIMITS.CRITICAL_THRESHOLD_PERCENT) {
		const msg =
			`[InferenceEngine] Battery at ${level.toFixed(1)}% — below ` +
			`critical threshold (${BATTERY_LIMITS.CRITICAL_THRESHOLD_PERCENT}%). ` +
			`Main slot blocked.`
		throw new BatteryGuardError(msg, level)
	}

	tracker.log(
		`[battery-guard] Level=${level.toFixed(1)}% — OK to load 'main'.`
	)
}

export class BatteryGuardError extends Error {
	public readonly batteryLevel: number
	constructor(message: string, batteryLevel: number) {
		super(message)
		this.name = 'BatteryGuardError'
		this.batteryLevel = batteryLevel
		Object.setPrototypeOf(this, BatteryGuardError.prototype)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — PUBLIC: unloadModel (SYNCHRONOUS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Severs all references to the native TFLite model mounted in `slot` and
 * zeroes every associated tracking index synchronously.
 *
 * MANDATE 3 — Synchronous reference purge:
 *   This function is intentionally synchronous. loadMainModel and loadPreviewModel
 *   call it as the very first operation inside their try blocks — before any await.
 *   JS single-threaded execution guarantees the entire unload sequence completes
 *   atomically relative to the calling task: no microtask or macrotask can observe
 *   a partial-unload state where, e.g., _activeModelPaths is null but _mainModel
 *   is still live.
 *
 * Native dispose():
 *   Called fire-and-forget (void). The TFLite runtime may need an extra tick to
 *   release GPU/DSP allocations, but the JS reference is severed immediately.
 *   The try/catch ensures a faulty dispose() implementation does not abort the
 *   cleanup sequence — reference nullification IS the primary GC signal for the
 *   JS heap. The native side will reclaim its memory when the refcount drops.
 *
 * @param slot - The model slot to unload.
 */
export function unloadModel(slot: ModelSlot): void {
	const model = _getModel(slot)

	if (model !== null) {
		try {
			void (
				model as unknown as { dispose?: () => Promise<void> | void }
			).dispose?.()
		} catch {
			// Non-fatal: dispose() is best-effort. JS reference nullification
			// below is the authoritative cleanup step.
		}

		// ── Sever native reference synchronously and unconditionally ─────────
		if (slot === 'preview') {
			_previewModel = null
		} else {
			_mainModel = null
		}
	}

	// ── Zero all tracking indices, regardless of whether a model was mounted ─
	// This guarantees consistency even when unloadModel is called on an already-
	// empty slot (e.g., error-path cleanup in loadMainModel after a failed load).
	_activeModelPaths[slot] = null
	_quantized[slot] = null
	_loadedConfigs[slot] = null

	tracker.log(
		`unloadModel('${slot}'): native reference severed, all tracking state cleared.`
	)
}

export function unloadAllModels(): void {
	unloadModel('preview')
	unloadModel('main')
	tracker.log('Both slots unloaded.')
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — PUBLIC: loadMainModel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads a TFLite model into the MAIN (teacher) slot.
 *
 * MANDATE 3 — Synchronous opposing-slot reclamation:
 *   The `preview` slot is unloaded and ALL its tracking references are set to
 *   null SYNCHRONOUSLY as the very first operation inside the try block — before
 *   any await (battery read, filesystem/network model fetch). JS single-threaded
 *   execution guarantees that no other microtask or macrotask can run between
 *   `_loading['main'] = true` and the first `await`, making this phase
 *   atomically exclusive. Both models can never coexist in memory.
 *
 * MANDATE 4 — Delegate resolution:
 *   Delegates are sourced exclusively from INFERENCE_DELEGATES via
 *   _getDefaultDelegates(). On primary load failure, the engine drops cleanly
 *   to CPU-only execution and logs the failing delegate set through tracker so
 *   the crash analytics pipeline captures the device's delegate rejection reason.
 *
 * MANDATE 2 — Quantization:
 *   _detectQuantization() is called with the caller-supplied config, enabling
 *   manifest-driven quantization verification against the tensor signature.
 *
 * @param modelPath        - Absolute file:// URI or network URL of the .tflite binary
 * @param config           - Optional hydrated ModelConfig for the mounted style.
 *                           Stored on the slot and returned by getActiveModelConfig().
 * @param delegateOverride - If provided, bypasses _getDefaultDelegates() entirely.
 *                           Useful for hardware benchmark and delegate probe tests.
 */
export async function loadMainModel(
	modelPath: string,
	config?: ModelConfig,
	delegateOverride?: TensorflowModelDelegate[]
): Promise<void> {
	const slot: ModelSlot = 'main'
	const opposing: ModelSlot = 'preview'

	if (_loading[slot]) {
		tracker.log(`loadMainModel: already in progress — skipping.`)
		return
	}

	if (_activeModelPaths[slot] === modelPath && _getModel(slot) !== null) {
		tracker.log(`loadMainModel: '${modelPath}' already loaded — no-op.`)
		return
	}

	// ── MANDATE 3: Acquire loading guard — synchronous, no await precedes this ─
	_loading[slot] = true

	try {
		// ── MANDATE 3: Opposing-slot synchronous reclamation ─────────────────────
		//
		// FIX C: If preview is mid-load, abort rather than race it. The opposing
		// slot check is the very first operation — the only JS that runs between
		// _loading[slot] = true above and this block is the const assignment.
		if (_loading[opposing]) {
			tracker.warn(
				`loadMainModel: opposing slot '${opposing}' is mid-load — ` +
					`deferring to prevent concurrent native allocation.`
			)
			return
		}

		// Sever the preview model from native memory before any I/O begins.
		// unloadModel is synchronous; after it returns, _previewModel === null,
		// _activeModelPaths['preview'] === null, _quantized['preview'] === null,
		// _loadedConfigs['preview'] === null. No async gap has opened.
		if (
			_getModel(opposing) !== null ||
			_activeModelPaths[opposing] !== null
		) {
			tracker.log(
				`loadMainModel: synchronously releasing '${opposing}' slot ` +
					`before any model I/O begins.`
			)
			unloadModel(opposing)
		}

		// ── Battery guard (main slot only — safe to await post-isolation) ────────
		await _checkBatteryGuard(slot)

		// ── MANDATE 4: Platform-safe delegate resolution via INFERENCE_DELEGATES ─
		const delegates: TensorflowModelDelegate[] =
			delegateOverride ?? _getDefaultDelegates(slot)

		tracker.log(
			`loadMainModel: mounting '${modelPath}' ` +
				`delegates=[${delegates.join(', ') || 'cpu-xnnpack'}]`
		)

		// ── Primary load with explicit CPU fallback diagnostics ───────────────────
		let model: TfliteModel
		try {
			model = await loadTensorflowModel({ url: modelPath }, delegates)
		} catch (primaryErr) {
			if (delegates.length > 0) {
				// MANDATE 4: Log the exact failing delegate set so the tracker
				// pipeline captures device-specific delegate rejection reasons.
				tracker.warn(
					`loadMainModel: hardware delegate boot failed ` +
						`(delegates=[${delegates.join(', ')}]) — ` +
						`dropping to CPU execution context. Error: ${primaryErr}`
				)
				try {
					model = await loadTensorflowModel({ url: modelPath }, [])
				} catch (cpuErr) {
					tracker.error(
						`loadMainModel: CPU-only fallback also failed. Error: ${cpuErr}`
					)
					throw cpuErr
				}
			} else {
				throw primaryErr
			}
		}

		// ── Commit to module state ────────────────────────────────────────────────
		_setModel(slot, model, modelPath)
		_loadedConfigs[slot] = config ?? null
		// MANDATE 2: Pass config so manifest-driven quantization can be enforced.
		_quantized[slot] = _detectQuantization(slot, model, config)

		tracker.log(
			`loadMainModel: SUCCESS '${modelPath}' isQuantized=${_quantized[slot]}`
		)
	} catch (err) {
		// Synchronous cleanup — unloadModel is sync, no race risk.
		unloadModel(slot)
		throw err
	} finally {
		_loading[slot] = false
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — PUBLIC: loadPreviewModel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads a TFLite model into the PREVIEW (student) slot.
 *
 * MANDATE 3 — Synchronous opposing-slot reclamation:
 *   The `main` slot is unloaded synchronously before any await, by the same
 *   mechanism as loadMainModel. Both models can never coexist in memory.
 *
 * Battery guard is intentionally absent for this slot. The preview model runs
 * CPU/XNNPACK-only (see INFERENCE_DELEGATES.preview) and its memory footprint
 * is an order of magnitude smaller than the teacher. Blocking the live
 * viewfinder at low battery would degrade UX without meaningful power saving.
 *
 * @param modelPath        - Absolute file:// URI or network URL of the .tflite binary
 * @param config           - Optional hydrated ModelConfig for the mounted style.
 * @param delegateOverride - If provided, bypasses _getDefaultDelegates().
 */
export async function loadPreviewModel(
	modelPath: string,
	config?: ModelConfig,
	delegateOverride?: TensorflowModelDelegate[]
): Promise<void> {
	const slot: ModelSlot = 'preview'
	const opposing: ModelSlot = 'main'

	if (_loading[slot]) {
		tracker.log(`loadPreviewModel: already in progress — skipping.`)
		return
	}

	if (_activeModelPaths[slot] === modelPath && _getModel(slot) !== null) {
		tracker.log(`loadPreviewModel: '${modelPath}' already loaded — no-op.`)
		return
	}

	// ── MANDATE 3: Acquire loading guard — synchronous, no await precedes this ─
	_loading[slot] = true

	try {
		// ── MANDATE 3: Opposing-slot synchronous reclamation ─────────────────────
		//
		// FIX C: Opposing-slot mid-load guard.
		if (_loading[opposing]) {
			tracker.warn(
				`loadPreviewModel: opposing slot '${opposing}' is mid-load — ` +
					`deferring to prevent concurrent native allocation.`
			)
			return
		}

		// Release main model before any I/O begins. See loadMainModel for the
		// detailed synchronous-atomicity rationale.
		if (
			_getModel(opposing) !== null ||
			_activeModelPaths[opposing] !== null
		) {
			tracker.log(
				`loadPreviewModel: synchronously releasing '${opposing}' slot ` +
					`before any model I/O begins.`
			)
			unloadModel(opposing)
		}

		// ── No battery guard for preview slot — see JSDoc above ──────────────────

		// ── MANDATE 4: Delegate resolution ───────────────────────────────────────
		const delegates: TensorflowModelDelegate[] =
			delegateOverride ?? _getDefaultDelegates(slot)

		tracker.log(
			`loadPreviewModel: mounting '${modelPath}' ` +
				`delegates=[${delegates.join(', ') || 'cpu-xnnpack'}]`
		)

		// ── Primary load with CPU fallback ────────────────────────────────────────
		//
		// delegateOverride is the only realistic path for delegates.length > 0 on
		// the preview slot (INFERENCE_DELEGATES.preview is empty). The fallback
		// block is retained defensively for custom override scenarios.
		let model: TfliteModel
		try {
			model = await loadTensorflowModel({ url: modelPath }, delegates)
		} catch (primaryErr) {
			if (delegates.length > 0) {
				tracker.warn(
					`loadPreviewModel: delegate load failed ` +
						`(delegates=[${delegates.join(', ')}]) — ` +
						`dropping to CPU execution context. Error: ${primaryErr}`
				)
				try {
					model = await loadTensorflowModel({ url: modelPath }, [])
				} catch (cpuErr) {
					tracker.error(
						`loadPreviewModel: CPU-only fallback also failed. Error: ${cpuErr}`
					)
					throw cpuErr
				}
			} else {
				throw primaryErr
			}
		}

		// ── Commit to module state ────────────────────────────────────────────────
		_setModel(slot, model, modelPath)
		_loadedConfigs[slot] = config ?? null
		_quantized[slot] = _detectQuantization(slot, model, config)

		tracker.log(
			`loadPreviewModel: SUCCESS '${modelPath}' isQuantized=${_quantized[slot]}`
		)
	} catch (err) {
		unloadModel(slot)
		throw err
	} finally {
		_loading[slot] = false
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — PUBLIC: loadModel (backward-compat dispatch shim)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic slot dispatcher retained for backward compatibility.
 *
 * Prefer the explicit loadMainModel / loadPreviewModel call sites in all new
 * code — they carry full JSDoc, slot-specific guard logic (battery guard,
 * delegate rationale), and are easier to grep in the call graph.
 *
 * @deprecated Use loadMainModel / loadPreviewModel directly.
 */
export async function loadModel(
	slot: ModelSlot,
	modelPath: string,
	delegateOverride?: TensorflowModelDelegate[]
): Promise<void> {
	return slot === 'main'
		? loadMainModel(modelPath, undefined, delegateOverride)
		: loadPreviewModel(modelPath, undefined, delegateOverride)
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — PUBLIC: runInferenceSync (worklet-safe)
// ─────────────────────────────────────────────────────────────────────────────

export function runInferenceSync(
	slot: ModelSlot,
	inputBuffer: ArrayBuffer
): ArrayBuffer {
	'worklet'

	const model = _getModel(slot)

	if (model == null) {
		throw new Error(
			`[InferenceEngine] runInferenceSync: slot '${slot}' is not loaded. ` +
				`Call loadPreviewModel / loadMainModel first.`
		)
	}

	if (
		typeof SharedArrayBuffer !== 'undefined' &&
		inputBuffer != null &&
		inputBuffer.constructor?.name === 'SharedArrayBuffer'
	) {
		throw new Error(
			`[InferenceEngine] runInferenceSync: SharedArrayBuffer unsupported. Use plain ArrayBuffer.`
		)
	}

	const outputs: ArrayBuffer[] = model.runSync([inputBuffer])

	if (!outputs || outputs.length === 0) {
		throw new Error(
			`[InferenceEngine] runInferenceSync: empty output from slot '${slot}'. ` +
				`Possible model signature mismatch or corrupt .tflite file.`
		)
	}

	return outputs[0]
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — PUBLIC: STATE INSPECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if a native TFLite model is currently mounted in the given slot.
 * Thread-safe under JS's single-threaded model — no observable torn state.
 */
export function isModelLoaded(slot: ModelSlot): boolean {
	return _getModel(slot) !== null
}

/**
 * Returns true if the model currently loaded in `slot` is INT8/UINT8 quantized.
 *
 * MANDATE 2: This value is resolved once at load time via _detectQuantization()
 * using either the manifest config hint or the tensor signature — never via a
 * runtime path heuristic. Returns false if no model is mounted (null sentinel).
 */
export function isModelQuantized(slot: ModelSlot): boolean {
	return _quantized[slot] === true
}

/**
 * Returns the absolute file:// URI or network URL of the currently-mounted model
 * for the given slot, or null if the slot is empty.
 */
export function getActiveModelPath(slot: ModelSlot): string | null {
	return _activeModelPaths[slot]
}

/**
 * Returns the ModelConfig snapshot that was supplied at load time for `slot`,
 * or null if the slot is empty or was loaded without a config.
 *
 * MANDATE 1: Callers (e.g. TiledInferenceRunner) can use this to retrieve the
 * live runtime resolution (config.mainModel / config.previewModel) for the
 * mounted model without re-querying the manifest store, and without relying on
 * any static size constant. A null return signals that sizing must be resolved
 * from getModelConfig(styleId) in ModelManager.
 */
export function getActiveModelConfig(slot: ModelSlot): ModelConfig | null {
	return _loadedConfigs[slot]
}

export function isModelLoading(slot: ModelSlot): boolean {
	return _loading[slot]
}

export function isPreviewModelReady(): boolean {
	return _previewModel !== null
}
