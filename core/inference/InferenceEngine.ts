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

import type { ModelSlot } from '@/types'
import { BATTERY_LIMITS } from '@/shared/utils/constants'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('InferenceEngine')

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — MODULE-LEVEL STATE
// ─────────────────────────────────────────────────────────────────────────────

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
 * Returns a platform-safe, ordered delegate array for a given slot.
 *
 * CRITICAL: fast-tflite validates the ENTIRE array before loading.
 * Mixing platform-specific delegates (e.g., 'core-ml' + 'android-gpu')
 * causes an immediate throw on the incompatible platform, even if other
 * delegates in the list would have worked.
 *
 * Ordering rationale:
 *   - Android: 'android-gpu' (OpenCL, fastest) → 'nnapi' (vendor DSP/NPU, broad).
 *     A24 has an Exynos 1280 with Mali-G68 MP4 — GPU delegate should mount.
 *   - iOS:     'core-ml' first (ANE hardware), 'metal' as fallback.
 *   - Preview: always CPU/XNNPACK — GPU delegates add latency for the tiny
 *     student model and can cause frame drops in the live viewfinder.
 */
function _getDefaultDelegates(slot: ModelSlot): TensorflowModelDelegate[] {
	if (slot === 'preview') return [] // CPU/XNNPACK only — PRD §2.3.3

	return Platform.select<TensorflowModelDelegate[]>({
		android: ['android-gpu', 'nnapi'],
		ios: ['core-ml'],
		default: [],
	})!
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
 * Introspects a freshly-loaded TfliteModel to determine precision mode.
 * Prefers the `dataType` field; falls back to path-heuristic.
 */
function _detectQuantization(slot: ModelSlot, model: TfliteModel): boolean {
	try {
		const inputs = model.inputs
		if (!inputs || inputs.length === 0) return false

		const first = inputs[0]
		if ('dataType' in first && typeof first.dataType === 'string') {
			const dt = (first.dataType as string).toLowerCase()
			const isU8 = dt === 'uint8' || dt === 'int8'
			tracker.log(
				`[quantize-detect] slot="${slot}" dataType="${first.dataType}" → isQuantized=${isU8}`
			)
			return isU8
		}

		const pathHint = (_activeModelPaths[slot] ?? '').toLowerCase()
		const isU8 =
			pathHint.includes('quant') ||
			pathHint.includes('uint8') ||
			pathHint.includes('u8')
		tracker.log(
			`[quantize-detect] slot="${slot}" path-heuristic → isQuantized=${isU8}`
		)
		return isU8
	} catch {
		return false
	}
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

export function unloadModel(slot: ModelSlot): void {
	const model = _getModel(slot)
	if (model !== null) {
		try {
			void (
				model as unknown as { dispose?: () => Promise<void> | void }
			).dispose?.()
		} catch {
			// Non-fatal — reference nullification is the real cleanup.
		}
		if (slot === 'preview') {
			_previewModel = null
		} else {
			_mainModel = null
		}
	}
	_activeModelPaths[slot] = null
	_quantized[slot] = null
	tracker.log(`Slot '${slot}' unloaded — native reference released.`)
}

export function unloadAllModels(): void {
	unloadModel('preview')
	unloadModel('main')
	tracker.log('Both slots unloaded.')
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — PUBLIC: loadModel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads a TFLite model into the specified slot.
 *
 * KEY CHANGE (FIX A): Slot isolation is now SYNCHRONOUS and happens as the
 * very first operation inside the try block — before any `await`.
 *
 * JS single-threaded execution guarantees that between `_loading[slot] = true`
 * and the first `await`, no other JS code can run, so the isolation is
 * truly atomic. Previously, isolation occurred after `_checkBatteryGuard`
 * (an async call), creating a window where `_abortCurrentJob` could be set
 * by `prioritizeJob/pauseJob`, causing immediate "ghost unload" on return.
 *
 * KEY CHANGE (FIX B): Delegates are resolved via `_getDefaultDelegates()`,
 * which uses `Platform.OS` to exclude CoreML on Android and NNAPI on iOS.
 *
 * KEY CHANGE (FIX C): If the opposing slot is mid-load (_loading[opposing]),
 * we abort with a no-op rather than racing it.
 */
export async function loadModel(
	slot: ModelSlot,
	modelPath: string,
	delegateOverride?: TensorflowModelDelegate[]
): Promise<void> {
	if (_loading[slot]) {
		tracker.log(`loadModel('${slot}'): already in progress — skipping.`)
		return
	}

	if (_activeModelPaths[slot] === modelPath && _getModel(slot) !== null) {
		tracker.log(
			`loadModel('${slot}'): '${modelPath}' already loaded — no-op.`
		)
		return
	}

	// Set guard synchronously — no await between here and the isolation step.
	_loading[slot] = true

	try {
		// ── FIX A: SYNCHRONOUS isolation — before any await ───────────────────
		// This eliminates the race window where _abortCurrentJob could be set
		// between the battery guard resolution and the isolation call.
		const opposing: ModelSlot = slot === 'preview' ? 'main' : 'preview'

		// FIX C: Abort if opposing slot is mid-load to prevent concurrent loads.
		if (_loading[opposing]) {
			tracker.warn(
				`loadModel('${slot}'): opposing slot '${opposing}' is loading — deferring to prevent concurrent allocation.`
			)
			return
		}

		if (
			_getModel(opposing) !== null ||
			_activeModelPaths[opposing] !== null
		) {
			tracker.log(
				`loadModel('${slot}'): isolating — synchronously unloading '${opposing}'.`
			)
			unloadModel(opposing)
		}

		// ── Battery guard (only blocks 'main', await is safe here post-isolation) ─
		await _checkBatteryGuard(slot)

		// ── FIX B: Platform-safe delegate resolution ───────────────────────────
		const delegates: TensorflowModelDelegate[] =
			delegateOverride ?? _getDefaultDelegates(slot)

		tracker.log(
			`loadModel('${slot}'): loading '${modelPath}' delegates=[${delegates.join(', ') || 'cpu-xnnpack'}]`
		)

		// ── Primary load + CPU fallback ────────────────────────────────────────
		let model: TfliteModel
		try {
			model = await loadTensorflowModel({ url: modelPath }, delegates)
		} catch (primaryErr) {
			if (delegates.length > 0) {
				tracker.log(
					`loadModel('${slot}'): hardware delegate load failed — retrying CPU-only. ` +
						`Error: ${primaryErr}`
				)
				try {
					model = await loadTensorflowModel({ url: modelPath }, [])
				} catch (cpuErr) {
					tracker.error(
						`loadModel('${slot}'): CPU fallback also failed. Error: ${cpuErr}`
					)
					throw cpuErr
				}
			} else {
				throw primaryErr
			}
		}

		_setModel(slot, model, modelPath)
		_quantized[slot] = _detectQuantization(slot, model)

		tracker.log(
			`loadModel('${slot}'): SUCCESS '${modelPath}' isQuantized=${_quantized[slot]}`
		)
	} catch (err) {
		// Synchronous cleanup — no race risk since unloadModel is sync.
		unloadModel(slot)
		throw err
	} finally {
		_loading[slot] = false
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — PUBLIC: CONVENIENCE ALIASES
// ─────────────────────────────────────────────────────────────────────────────

export async function loadPreviewModel(
	modelPath: string,
	delegateOverride?: TensorflowModelDelegate[]
): Promise<void> {
	return loadModel('preview', modelPath, delegateOverride)
}

export async function loadMainModel(
	modelPath: string,
	delegateOverride?: TensorflowModelDelegate[]
): Promise<void> {
	return loadModel('main', modelPath, delegateOverride)
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — PUBLIC: runInferenceSync (worklet-safe)
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
// SECTION 9 — PUBLIC: STATE INSPECTION
// ─────────────────────────────────────────────────────────────────────────────

export function isModelLoaded(slot: ModelSlot): boolean {
	return _getModel(slot) !== null
}

export function isModelQuantized(slot: ModelSlot): boolean {
	return _quantized[slot] === true
}

export function getActiveModelPath(slot: ModelSlot): string | null {
	return _activeModelPaths[slot]
}

export function isModelLoading(slot: ModelSlot): boolean {
	return _loading[slot]
}

export function isPreviewModelReady(): boolean {
	return _previewModel !== null
}
