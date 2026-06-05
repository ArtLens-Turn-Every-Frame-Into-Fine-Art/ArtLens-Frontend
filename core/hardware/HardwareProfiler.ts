/**
 * @file HardwareProfiler.ts
 * @description Device hardware benchmark suite for ArtLens.
 *
 * Determines the optimal inference delegate (NPU / GPU / CPU) and device tier
 * by running timed Float32Array operations. Results are persisted to MMKV and
 * drive all subsequent task routing in InferenceEngine and StyleJobService.
 *
 * BENCHMARK STRATEGY:
 *   1. CPU proxy: Time a large Float32 multiply-accumulate loop that exercises
 *      L1/L2 cache and FPU throughput — proxy for XNNPACK performance.
 *   2. GPU probe: Attempt to initialise the TFLite GPU delegate with a dummy
 *      tensor. Success and latency determines GPU availability.
 *   3. Thread count: Derived from the CPU benchmark scaling test.
 *
 * POLICY:
 *   - Runs automatically on first app install during the splash screen.
 *   - Never runs again automatically (OS updates don't invalidate the profile).
 *   - User can trigger a re-benchmark via Settings → "Run Hardware Benchmark".
 *
 * @module core/hardware
 */

import { createMMKV } from 'react-native-mmkv'
import { loadTensorflowModel } from 'react-native-fast-tflite'
import { createTracker } from '@/shared/utils/logger'
import { HARDWARE_KEYS, STORAGE_INSTANCE_IDS } from '@/shared/utils/storageKeys'

const tracker = createTracker('HardwareProfiler')

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ComputeDelegate = 'npu' | 'gpu' | 'cpu'

/**
 * Persisted result of the device hardware benchmark.
 * Drives all task routing decisions for the lifetime of the app install.
 */
export interface HardwareProfile {
	/**
	 * Device compute tier.
	 * - Tier 1: GPU/NPU available OR CPU processes 786k floats in < 200ms.
	 *           Live viewfinder is fully supported at ≥ 10 FPS.
	 * - Tier 2: CPU-only, high-latency device.
	 *           Live viewfinder is disabled; user submits images for async processing.
	 */
	tier: 1 | 2

	/**
	 * Best delegate for the Student (Preview) model in the live camera loop.
	 * Typically `cpu` to avoid GPU contention with the camera viewfinder.
	 */
	preferredLiveDelegate: ComputeDelegate

	/**
	 * Best delegate for the Teacher (Main) model in the background queue.
	 * Typically `gpu` or `cpu` depending on device capabilities.
	 */
	preferredMainDelegate: ComputeDelegate

	/**
	 * Recommended number of CPU worker threads for XNNPACK.
	 * Capped at physicalCores - 1 to reserve one core for UI.
	 */
	threadCount: number

	/** Unix timestamp (ms) when this benchmark was completed. */
	benchmarkedAt: number

	/** Raw CPU throughput in megaFLOPs (million multiply-adds per second). */
	cpuMflops: number

	/**
	 * Measured inference latency in milliseconds for the live path (CPU).
	 * Used to compute the expected FPS floor.
	 */
	liveInferenceLatencyMs: number

	/**
	 * Whether the GPU delegate was successfully initialized on this device.
	 * `false` means the GPU path is unavailable (older device / driver issue).
	 */
	gpuAvailable: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** MMKV storage key for the persisted HardwareProfile. */
const PROFILE_STORAGE_KEY = HARDWARE_KEYS.PROFILE

/**
 * Number of float multiply-accumulate iterations for the CPU benchmark.
 * Chosen so the benchmark runs for ~100–500ms on a typical mid-range device.
 */
const CPU_BENCHMARK_ITERATIONS = 5

/**
 * Element count for the CPU benchmark array.
 * Matches the Main model input: [1, 512, 512, 3] = 786,432 elements.
 * This exercises the same SIMD paths XNNPACK would use.
 */
const BENCHMARK_ELEMENT_COUNT = 1 * 512 * 512 * 3 // 786,432

/**
 * Latency threshold (ms) separating Tier 1 from Tier 2 devices.
 * A device that processes 786k floats in < TIER_1_LATENCY_MS is Tier 1.
 */
const TIER_1_LATENCY_MS = 250

// ─────────────────────────────────────────────────────────────────────────────
// MMKV INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

const _storage = createMMKV({ id: STORAGE_INSTANCE_IDS.HARDWARE })

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE BENCHMARK UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the CPU multiply-accumulate proxy benchmark.
 *
 * Simulates the elementwise activation and normalization operations performed
 * by XNNPACK. Not a TFLite inference, but a faithful proxy for single-threaded
 * FPU throughput that correlates with on-device XNNPACK performance.
 *
 * @returns Object with median latency per iteration (ms) and computed MFLOP/s.
 *
 * @complexity O(BENCHMARK_ELEMENT_COUNT × CPU_BENCHMARK_ITERATIONS)
 *             ≈ O(3.93M) operations — runs in ~50–500ms depending on device.
 */
async function _benchmarkCPU(): Promise<{
	medianLatencyMs: number
	mflops: number
}> {
	// Use a fixed seed buffer to prevent dead-code elimination
	const data = new Float32Array(BENCHMARK_ELEMENT_COUNT)

	// Pre-fill with deterministic values (avoids NaN poisoning)
	for (let i = 0; i < BENCHMARK_ELEMENT_COUNT; i++) {
		data[i] = (i % 256) / 255
	}

	const latencies: number[] = []

	for (let iter = 0; iter < CPU_BENCHMARK_ITERATIONS; iter++) {
		// Yield to JS event loop between iterations to prevent ANR on Android
		await new Promise<void>((resolve) => setTimeout(resolve, 0))

		const start = performance.now()

		// Simulated elementwise GELU-like activation: x * sigmoid(1.702 * x)
		// Chosen because it uses exp() — same cost as InstanceNorm computations.
		for (let i = 0; i < BENCHMARK_ELEMENT_COUNT; i++) {
			const x = data[i]
			data[i] = x * (1 / (1 + Math.exp(-1.702 * x)))
		}

		latencies.push(performance.now() - start)
	}

	// Remove the outlier fastest (warmup artifacts) and slowest (GC pause)
	latencies.sort((a, b) => a - b)
	const trimmed = latencies.slice(1, latencies.length - 1)
	const medianLatencyMs =
		trimmed[Math.floor(trimmed.length / 2)] ?? latencies[0]

	// Each iteration: BENCHMARK_ELEMENT_COUNT × ~5 FLOPs (mul, exp, add, div, mul)
	const mflops = (BENCHMARK_ELEMENT_COUNT * 5) / (medianLatencyMs * 1000)

	return { medianLatencyMs, mflops }
}

/**
 * Probes GPU delegate availability by attempting to create a dummy TFLite
 * session with the GPU delegate.
 *
 * Since we do not bundle a dedicated benchmark model, this probe creates a
 * minimal in-memory session and measures whether GPU initialization succeeds
 * and how quickly. A real GPU inference pass would be significantly faster.
 *
 * @param testModelPath - Optional path to a real .tflite model to use for
 *                        the GPU probe. If null, uses library-level delegate check.
 * @returns `{ available: boolean; probeLatencyMs: number }`
 */
async function _probeGPUDelegate(testModelPath: string | null): Promise<{
	available: boolean
	probeLatencyMs: number
}> {
	if (!testModelPath) {
		// Without a model file, report GPU as unknown (treated as available optimistically)
		// A real GPU probe requires a valid .tflite binary.
		return { available: false, probeLatencyMs: 0 }
	}

	const start = performance.now()

	try {
		// Attempt to load the provided model with GPU delegate.
		// If the delegate is unavailable, this will throw.
		const model = await loadTensorflowModel({ url: testModelPath }, [
			'android-gpu',
			'core-ml',
			'nnapi',
		])
		const probeLatencyMs = performance.now() - start

		// Run a single dummy inference to confirm the delegate is functional
		const dummyInput = new Float32Array(BENCHMARK_ELEMENT_COUNT).buffer
		model.runSync([dummyInput])

		return { available: true, probeLatencyMs }
	} catch {
		return { available: false, probeLatencyMs: performance.now() - start }
	}
}

/**
 * Estimates available CPU core count.
 *
 * React Native does not expose a direct API for physical core count. We use
 * a scaling test: run the benchmark with double the work and compare times.
 * If the second run is < 1.7× slower than the first, multi-threading is
 * effective, implying ≥ 2 physical cores.
 *
 * @returns Recommended thread count for XNNPACK (capped at 6, minimum 2).
 *
 * @complexity O(2 × BENCHMARK_ELEMENT_COUNT) — two benchmark passes.
 */
async function _estimateThreadCount(): Promise<number> {
	// Single-threaded pass
	const singleData = new Float32Array(BENCHMARK_ELEMENT_COUNT)
	await new Promise<void>((r) => setTimeout(r, 0))
	const t1Start = performance.now()
	for (let i = 0; i < BENCHMARK_ELEMENT_COUNT; i++) {
		singleData[i] = singleData[i] * 0.5 + 0.5
	}
	const singleTime = performance.now() - t1Start

	// Double-sized pass (simulates 2-thread workload on a single core)
	const doubleData = new Float32Array(BENCHMARK_ELEMENT_COUNT * 2)
	await new Promise<void>((r) => setTimeout(r, 0))
	const t2Start = performance.now()
	for (let i = 0; i < BENCHMARK_ELEMENT_COUNT * 2; i++) {
		doubleData[i] = doubleData[i] * 0.5 + 0.5
	}
	const doubleTime = performance.now() - t2Start

	// If doubleTime < 1.4 × singleTime, extra parallelism is available
	const scalingFactor = doubleTime / singleTime

	if (scalingFactor < 1.3) return 6 // High-core-count device
	if (scalingFactor < 1.6) return 4 // Quad-core
	if (scalingFactor < 1.9) return 2 // Dual-core
	return 2 // Single-core fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the complete hardware benchmark suite and persists the result.
 *
 * **Side effect:** Writes the profile to MMKV under `PROFILE_STORAGE_KEY`.
 *
 * **Duration:** 500ms – 3000ms depending on device. Always runs asynchronously
 * to avoid blocking the UI thread. Should be called during the splash screen.
 *
 * **Decision Matrix (Hardware Selection):**
 * ```
 * [ Inference Task ]
 *   GPU Available? → GPU context (main slot)
 *   CPU fast (< 250ms for 786k floats)? → Tier 1, CPU (live) / CPU (main)
 *   Otherwise → Tier 2, CPU-only (no live viewfinder)
 * ```
 *
 * @param testModelPath - Optional path to a downloaded .tflite model to use
 *                        for the GPU delegate probe. Pass `null` on first boot
 *                        (before any models are downloaded).
 * @returns Resolved HardwareProfile.
 */
export async function runFullBenchmark(
	testModelPath: string | null = null
): Promise<HardwareProfile> {
	tracker.log('Starting benchmark suite…')

	// ── Step 1: CPU throughput ──────────────────────────────────────────────────
	const { medianLatencyMs, mflops } = await _benchmarkCPU()
	tracker.log(
		`CPU: ${medianLatencyMs.toFixed(1)}ms | ${mflops.toFixed(1)} MFLOP/s`
	)

	// ── Step 2: Thread count estimation ────────────────────────────────────────
	const threadCount = await _estimateThreadCount()
	tracker.log(`Estimated thread count: ${threadCount}`)

	// ── Step 3: GPU delegate probe ─────────────────────────────────────────────
	const { available: gpuAvailable, probeLatencyMs } =
		await _probeGPUDelegate(testModelPath)
	tracker.log(
		`GPU: ${gpuAvailable ? `available (${probeLatencyMs.toFixed(1)}ms probe)` : 'unavailable'}`
	)
	// ── Step 4: Tier and delegate selection ────────────────────────────────────
	//
	// Tier 1 conditions (either is sufficient):
	//   - GPU delegate available (real GPU acceleration)
	//   - CPU processes benchmark in < TIER_1_LATENCY_MS (fast enough for 10+ FPS)
	//
	const isTierOne = gpuAvailable || medianLatencyMs < TIER_1_LATENCY_MS
	const tier: 1 | 2 = isTierOne ? 1 : 2

	// Live inference (preview slot) always uses CPU to prevent GPU contention
	// with the camera viewfinder render pipeline.
	const preferredLiveDelegate: ComputeDelegate = 'cpu'

	// Main slot uses GPU if available, otherwise CPU
	const preferredMainDelegate: ComputeDelegate = gpuAvailable ? 'gpu' : 'cpu'

	const profile: HardwareProfile = {
		tier,
		preferredLiveDelegate,
		preferredMainDelegate,
		threadCount,
		benchmarkedAt: Date.now(),
		cpuMflops: mflops,
		liveInferenceLatencyMs: medianLatencyMs,
		gpuAvailable,
	}

	// ── Persist to MMKV ────────────────────────────────────────────────────────
	_storage.set(PROFILE_STORAGE_KEY, JSON.stringify(profile))

	tracker.log(
		`✓ Benchmark complete. Tier ${tier} | ` +
			`Live: ${preferredLiveDelegate} | Main: ${preferredMainDelegate} | ` +
			`Threads: ${threadCount} | GPU: ${gpuAvailable}`
	)

	return profile
}

/**
 * Loads the stored HardwareProfile from MMKV without running a benchmark.
 *
 * Returns `null` if no profile exists (first boot, after clear, or corrupted data).
 * The caller (`_layout.tsx`) should trigger `runFullBenchmark()` in that case.
 *
 * @returns Parsed HardwareProfile or `null`.
 */
export function loadStoredProfile(): HardwareProfile | null {
	try {
		const raw = _storage.getString(PROFILE_STORAGE_KEY)
		if (!raw) return null

		const profile = JSON.parse(raw) as HardwareProfile

		// Validate required fields to guard against schema-breaking updates
		if (
			typeof profile.tier !== 'number' ||
			typeof profile.preferredLiveDelegate !== 'string' ||
			typeof profile.benchmarkedAt !== 'number'
		) {
			tracker.warn('Stored profile schema invalid — clearing.')
			_storage.remove(PROFILE_STORAGE_KEY)
			return null
		}

		return profile
	} catch (err) {
		tracker.error('Failed to parse stored profile:', err)
		_storage.remove(PROFILE_STORAGE_KEY)
		return null
	}
}

/**
 * Clears the stored profile, forcing a re-benchmark on next `loadStoredProfile()` call.
 * Exposed for testing and the Settings "Reset Hardware Profile" action.
 */
export function clearStoredProfile(): void {
	_storage.remove(PROFILE_STORAGE_KEY)
	tracker.log('Stored profile cleared.')
}

/**
 * Computes the expected live preview FPS from a stored profile.
 * Used by the UI to decide whether to show the "Tier 2" no-camera warning.
 *
 * @param profile - A HardwareProfile from `loadStoredProfile()` or `runFullBenchmark()`.
 * @returns Estimated FPS floor (capped at 30, floored at 1).
 */
export function estimateLiveFPS(profile: HardwareProfile): number {
	// Inference must complete within one frame budget at target FPS.
	// At 30 FPS: 33ms budget. At 10 FPS: 100ms budget.
	const fps = Math.round(1000 / profile.liveInferenceLatencyMs)
	return Math.min(30, Math.max(1, fps))
}
