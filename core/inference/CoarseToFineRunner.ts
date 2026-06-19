/**
 * @file CoarseToFineRunner.ts
 * @description Coarse-to-fine guided upsampling pipeline for ArtLens.
 *              Drop-in replacement for TiledInferenceRunner.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TILING APPROACH FAILS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  The previous TiledInferenceRunner sliced the 4K image into native-resolution
 *  patches and fed each independently to the model. This broke in two ways:
 *
 *  1. InstanceNorm statistics collapse.
 *     Each model tile is normalised to its own mean and variance. A uniformly
 *     dark sky tile and a uniformly bright skin tile both collapse to μ≈0, σ≈1,
 *     so the generator assigns them near-identical colour treatments despite being
 *     perceptually opposite scene regions. The visible seam is InstanceNorm
 *     discovering its own per-tile statistics at every boundary — no amount of
 *     Gaussian blending fully conceals a fundamental normalisation mismatch.
 *
 *  2. Sequential tile latency.
 *     At native 4K a single 512×512 tile covers ≈1.8% of the canvas, requiring
 *     ≈56 forward passes. On mid-range hardware: > 3 minutes per image.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOLUTION: COARSE-TO-FINE TOPOLOGY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────────────────────────────┐
 *  │ Phase 0  CONFIG     getModelConfig → inferenceRes                        │
 *  │ Phase 1  DECODE     sourceUri → SkImage (full-res, NO readPixels yet)    │
 *  │ Phase 2  DOWNSAMPLE Skia surface: full-res SkImage → modelDim×modelDim  │
 *  │                     via drawImageRect (FilterQuality.High = bicubic)     │
 *  │          readPixels → scratchRgba Uint8Array  [modelDim²×4]              │
 *  │          guideSkImage stays alive for Phase 5                            │
 *  │ Phase 3  NORMALISE  prepareInputTensor(scratchRgba, inputBuf)            │
 *  │                     pixel/127.5 − 1.0 → float32 NHWC [-1,1]             │
 *  │ Phase 4  INFER      runInferenceSync(slot, inputBuf) → rawOutput         │
 *  │                     ONE forward pass (vs ≈56 in tiling approach)        │
 *  │          InstanceNorm now sees GLOBAL image statistics → no seams       │
 *  │ Phase 5  DENORM     (v + 1.0) × 0.5 × 255 → RGBA Uint8 [modelDim²×4]  │
 *  │ Phase 6  UPSAMPLE   GuidedUpsamplePass: stylised → native resolution    │
 *  │                     + style-adaptive guide injection (Skia BlendMode)   │
 *  │ Phase 7  EXPORT     _encodeAndSave → JPEG → cache URI                   │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PEAK MEMORY BUDGET (4K source, 512px model)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Full-res guideSkImage      ~31.6 MB (native-backed SkImage, released Phase 7)
 *  Downscaled RGBA scratch    ~1.0 MB (Skia readPixels return, GC after Phase 3)
 *  Float32 input buffer       ~3.1 MB (registry-backed, reused across calls)
 *  Float32 output buffer      ~3.1 MB (native TFLite, slice-free single pass)
 *  Denorm RGBA (512×512)      ~1.0 MB (released after Phase 6)
 *  Output surface (4K)        ~31.6 MB (disposed in GuidedUpsamplePass)
 *  ─────────────────────────────────────────────────────────────────────────
 *  Peak working set           ~71 MB   (vs 3+ GB for native-res tiling)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PUBLIC API CONTRACT (drop-in replacement for TiledInferenceRunner)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Exports:
 *    runCoarseToFineInference        — main (teacher) slot, mirrors runTiledInference
 *    runCoarseToFinePreviewInference — preview (student) slot, mirrors runPreviewInference
 *    InferenceAbortError             — same class, re-exported for StyleJobService compat
 *    CoarseToFineCallbacks           — same shape as TiledInferenceCallbacks
 *    CoarseToFineResult              — same shape as TiledInferenceResult
 *
 *  StyleJobService changes required:
 *    1. Update import path: '@/core/inference/CoarseToFineRunner'
 *    2. Rename runTiledInference  → runCoarseToFineInference
 *    3. Rename runPreviewInference → runCoarseToFinePreviewInference
 *    4. No other changes — result shape, callbacks, and error types are identical.
 *       result.totalTiles is always 1 (single global forward pass).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MODEL PRECISION — float32 (both slots) — unchanged from TiledInferenceRunner
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Teacher (Main)    — [1, R, R, 3] float32 NHWC in/out [-1, 1]  (R = config.mainModel)
 *  Student (Preview) — [1, R, R, 3] float32 NHWC in/out [-1, 1]  (R = config.previewModel)
 *
 *  Input normalisation:  normalised = pixel / 127.5 − 1.0      → [-1, 1]
 *  Output denormalisation: display  = (model_out + 1.0) × 0.5  → [0, 1]
 *
 * PRD § 4.z — src/core/inference/CoarseToFineRunner.ts
 */

'use strict'

import {
	Skia,
	AlphaType,
	ColorType,
	ImageFormat,
	type SkImage,
} from '@shopify/react-native-skia'
import { File, Paths } from 'expo-file-system'

import * as InferenceEngine from '@/core/inference/InferenceEngine'
import {
	prepareInputTensor,
	getOrAllocateBuffer,
	alphaBlend,
} from '@/shared/utils/tensorUtils'
import { getModelConfig } from '@/core/storage/ModelManager'
import { createTracker } from '@/shared/utils/logger'
import type { StyleId, ColourMode } from '@/types'
import {
	OUTPUT_JPEG_QUALITY,
	PERFORMANCE_LIMITS,
	SYSTEM_BOUNDS,
	DEFAULT_MODEL_CONFIG,
} from '@/shared/utils/constants'
import {
	runGuidedUpsamplePass,
	type StyleBlendProfile,
	BAROQUE_PROFILE,
	VANGOGH_PROFILE,
	ANIME_PROFILE,
} from '@/core/postprocess/GuidedUpsamplePass'

const tracker = createTracker('CoarseToFineRunner')

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const RGBA_CH = SYSTEM_BOUNDS.RGBA_CHANNELS
const STITCH_MAX_PIXELS = PERFORMANCE_LIMITS.STITCH_MAX_PIXELS

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — ABORT SIGNAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when shouldAbort() returns true.
 * StyleJobService catches this specifically → BATTERY_PAUSED.
 * Identical to the class in TiledInferenceRunner — re-exported for compat.
 */
export class InferenceAbortError extends Error {
	constructor() {
		super('[CoarseToFineRunner] Inference aborted by caller signal.')
		this.name = 'InferenceAbortError'
		Object.setPrototypeOf(this, InferenceAbortError.prototype)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — PUBLIC API TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callbacks injected by StyleJobService. Same interface as TiledInferenceCallbacks.
 * onProgress is called at coarse pipeline milestones rather than per-tile,
 * because the pipeline executes as a single forward pass.
 */
export interface CoarseToFineCallbacks {
	/**
	 * Called at key pipeline milestones. fraction ∈ [0.0, 1.0].
	 * Emission points:
	 *   0.00 — before inference begins
	 *   0.55 — inference complete
	 *   0.85 — guided upsample complete
	 *   1.00 — JPEG written to cache
	 */
	onProgress: (fraction: number) => void

	/**
	 * Returns true if the job should abort. Checked before the forward pass
	 * and before the upsample phase. Maximum abort latency = inference time.
	 */
	shouldAbort: () => boolean
}

/** Returned by runCoarseToFineInference / runCoarseToFinePreviewInference. */
export interface CoarseToFineResult {
	resultUri: string
	imageW: number
	imageH: number
	/**
	 * Always 1 for the coarse-to-fine pipeline (single global forward pass).
	 * Retained for drop-in compatibility with TiledInferenceResult and the
	 * StyleJobService log line: "${result.totalTiles} tiles @ ...".
	 */
	totalTiles: 1
	durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — STYLE PROFILE RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a styleId to a StyleBlendProfile for the guided upsample pass.
 *
 * Pattern matching is case-insensitive and substring-based to accommodate
 * any StyleId convention (e.g. 'vangogh', 'van-gogh', 'VanGogh', 'impasto').
 *
 * Falls back to BAROQUE_PROFILE (no guide injection) for unknown styleIds
 * — this is the safest default because it cannot corrupt any style.
 * If a new style consistently produces blurry text, add its pattern here.
 */
function _resolveBlendProfile(styleId: StyleId): StyleBlendProfile {
	const id = (styleId as string).toLowerCase()

	if (
		id.includes('anime') ||
		id.includes('cartoon') ||
		id.includes('manga') ||
		id.includes('ink') ||
		id.includes('sketch')
	) {
		return ANIME_PROFILE
	}

	if (
		id.includes('vangogh') ||
		id.includes('van_gogh') ||
		id.includes('van-gogh') ||
		id.includes('impasto') ||
		id.includes('starry') ||
		id.includes('expressio') // expressionist, expressionism
	) {
		return VANGOGH_PROFILE
	}

	if (
		id.includes('baroque') ||
		id.includes('chiaroscuro') ||
		id.includes('rembrandt') ||
		id.includes('caravaggio') ||
		id.includes('vermeer')
	) {
		return BAROQUE_PROFILE
	}

	// Unknown style: safe default — pure cubic upscale, no halos, no blending.
	tracker.warn(
		`[_resolveBlendProfile] Unrecognised styleId="${styleId}" — ` +
			`defaulting to BAROQUE_PROFILE (no guide injection). ` +
			`Add this styleId to the pattern table if guide injection is needed.`
	)
	return BAROQUE_PROFILE
}

/**
 * Resolves a styleId to the colour-treatment strategy for Phase 5.
 *
 * 'texture_only' — YCbCr luma substitution (_applyTextureOnlyColour). Keeps the
 *   ORIGINAL photo's colour and only borrows the model's luminance/texture.
 *   This exists specifically to fix Van Gogh's tendency to paint large uniform
 *   areas (sky, walls) a flat saturated blue/cyan — see _applyTextureOnlyColour
 *   docstring. It is NOT a generic "improve colour" step: applying it to a
 *   model whose own colour palette IS the style (Baroque) or whose flat
 *   saturated palette defines the look (AnimeGanV3) actively destroys that
 *   style by overwriting the model's colour with the source photo's colour.
 *
 * 'full_colour' — use the model's raw output colour untouched. Correct default
 *   for any model whose trained colour grading is part of what makes it look
 *   right (Baroque, Anime/Cartoonizer).
 *
 * 'luminance_blend' — soft RGB alpha blend between original and stylised
 *   (tensorUtils.alphaBlend) rather than a hard YCbCr swap. Middle ground for
 *   styles that need some colour grounding but not a full chroma override.
 *
 * Until this is exposed per-style from the manifest/ModelManager, resolve it
 * locally by styleId here — same pattern as _resolveBlendProfile above.
 */
function _resolveColourMode(styleId: StyleId): ColourMode {
	const id = (styleId as string).toLowerCase()

	if (
		id.includes('vangogh') ||
		id.includes('van_gogh') ||
		id.includes('van-gogh') ||
		id.includes('impasto') ||
		id.includes('starry') ||
		id.includes('expressio')
	) {
		return 'texture_only'
	}

	if (
		id.includes('baroque') ||
		id.includes('chiaroscuro') ||
		id.includes('rembrandt') ||
		id.includes('caravaggio') ||
		id.includes('vermeer') ||
		id.includes('anime') ||
		id.includes('cartoon') ||
		id.includes('manga') ||
		id.includes('ink') ||
		id.includes('sketch')
	) {
		return 'full_colour'
	}

	tracker.warn(
		`[_resolveColourMode] Unrecognised styleId="${styleId}" — ` +
			`defaulting to 'full_colour' (trust the model's own output).`
	)
	return 'full_colour'
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — IMAGE DECODE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decodes the source image to a hardware-backed SkImage WITHOUT calling
 * readPixels on the full-resolution bitmap.
 *
 * Unlike TiledInferenceRunner._decodeSourceImage which immediately called
 * readPixels to populate fullRgba for tile extraction, this function retains
 * the SkImage handle so it can be:
 *   (a) used as the GPU-side guide for drawImageRect in GuidedUpsamplePass, and
 *   (b) directly drawn into the downsample surface without a CPU round-trip.
 *
 * CALLER MUST DISPOSE the returned skImage after GuidedUpsamplePass completes.
 *
 * @param sourceUri - Absolute file:// URI of the source JPEG/PNG/WebP
 */
async function _decodeSourceSkImage(sourceUri: string): Promise<{
	skImage: SkImage
	imageW: number
	imageH: number
}> {
	tracker.log(`Decoding: ${sourceUri}`)

	const srcFile = new File(sourceUri)
	if (!srcFile.exists) {
		throw new Error(
			`[CoarseToFineRunner] Source file not found: ${sourceUri}`
		)
	}

	const encodedBytes = await srcFile.bytes()
	const skData = Skia.Data.fromBytes(encodedBytes)
	const skImage = Skia.Image.MakeImageFromEncoded(skData)

	if (!skImage) {
		throw new Error(
			`[CoarseToFineRunner] Skia failed to decode "${sourceUri}". ` +
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
			`[CoarseToFineRunner] Image ${imageW}×${imageH} ` +
				`(${imageW * imageH}px) exceeds pixel limit of ${STITCH_MAX_PIXELS}px.`
		)
	}

	return { skImage, imageW, imageH }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — GPU DOWNSCALE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Downscales the full-resolution source SkImage to modelDim×modelDim using
 * Skia's hardware-accelerated rasteriser with bicubic (FilterQuality.High)
 * interpolation.
 *
 * WHY THIS SOLVES INSTANCENORM SEAMS:
 *   The model now receives the ENTIRE image content compressed into modelDim
 *   pixels. InstanceNorm computes mean and variance across ALL modelDim²
 *   spatial positions simultaneously — global statistics, not local tile
 *   statistics. Adjacent "tiles" in the old approach each produced independent
 *   statistics; now there is only one set of statistics for the whole image.
 *
 * PIPELINE:
 *   1. MakeRasterN32Premul(modelDim, modelDim) — CPU-backed ARGB surface
 *   2. canvas.drawImageRect(fullResSkImage, srcRect, dstRect, cubicPaint)
 *      Hardware rasteriser performs bicubic downsampling in one GPU call.
 *   3. surface.makeImageSnapshot() — freeze canvas state to SkImage
 *   4. surface.dispose()           — release surface immediately
 *   5. snapshot.readPixels(...)    — extract raw RGBA8 Uint8Array
 *   6. snapshot.dispose()          — release snapshot
 *
 * OUTPUT: Uint8Array[modelDim × modelDim × 4] — RGBA8, row-major.
 *   Passed directly to prepareInputTensor for float32 normalisation.
 *
 * @param guideSkImage  Full-res SkImage from _decodeSourceSkImage (not disposed here)
 * @param imageW        Full image width (for src rect)
 * @param imageH        Full image height (for src rect)
 * @param modelDim      Target dimension (e.g. 512 for main, 256 for preview)
 */
function _downscaleToModelRes(
	guideSkImage: SkImage,
	imageW: number,
	imageH: number,
	modelDim: number
): Uint8Array {
	const surface = Skia.Surface.MakeOffscreen(modelDim, modelDim)
	if (!surface) {
		throw new Error(
			`[CoarseToFineRunner] Could not allocate ${modelDim}×${modelDim} downsample surface.`
		)
	}

	{
		const canvas = surface.getCanvas()
		const paint = Skia.Paint()
		// NOTE: canvas.drawImageRect does NOT default to cubic/bicubic sampling —
		// it defaults to nearest-neighbour (FilterMode.Nearest, MipmapMode.None).
		// FilterQuality / setFilterQuality were removed, but that does not mean
		// "cubic became the default"; it means sampling must now be specified
		// explicitly via drawImageRectCubic / drawImageRectOptions.
		//
		// At a 4K → 512 downsample (≈7.5× per axis), nearest-neighbour sampling
		// discards almost all high-frequency detail in a hard, aliased way —
		// fine text, logo line-work, jewellery, and anatomical edges collapse
		// into noise *before* the model ever sees them. The model then has no
		// choice but to render those regions as mush, which the guided upsample
		// pass cannot recover (it can only sharpen what's still present in the
		// guide — but the model output itself is already destroyed).
		//
		// Use Mitchell-Netravali bicubic (B=C=1/3) for high-quality downsampling.
		canvas.drawImageRectCubic(
			guideSkImage,
			{ x: 0, y: 0, width: imageW, height: imageH }, // src: full resolution
			{ x: 0, y: 0, width: modelDim, height: modelDim }, // dst: model input size
			1 / 3,
			1 / 3,
			paint
		)
	}

	const snapshot = surface.makeImageSnapshot()
	surface.dispose() // Surface done — snapshot is the independent owner

	const expectedBytes = modelDim * modelDim * RGBA_CH
	const pixelData = snapshot.readPixels(0, 0, {
		width: modelDim,
		height: modelDim,
		colorType: ColorType.RGBA_8888,
		alphaType: AlphaType.Opaque,
	}) as Uint8Array | null

	try {
		snapshot.dispose()
	} catch {
		/* best-effort */
	}

	if (!pixelData || pixelData.byteLength !== expectedBytes) {
		throw new Error(
			`[CoarseToFineRunner] Downsample readPixels failed: ` +
				`expected ${expectedBytes}B, got ${pixelData?.byteLength ?? 0}B.`
		)
	}

	tracker.log(
		`Downsample: ${imageW}×${imageH} → ${modelDim}×${modelDim} ` +
			`(${(pixelData.byteLength / 1024).toFixed(0)} KB RGBA)`
	)

	return pixelData
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — OUTPUT DENORMALISATION + TEXTURE-ONLY COLOUR CORRECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard Tanh output denormalisation: [-1, 1] → [0, 1] float32.
 *
 * Mirrors the per-pixel formula used by _stitchTilesLocal in TiledInferenceRunner:
 *   val = (rawF32 + 1.0) × 0.5
 *
 * Does NOT apply any adaptive contrast stretch. Colour normalisation is handled
 * downstream by _applyTextureOnlyColour, which transfers original-image chrominance
 * onto the stylised luminance — making per-channel remapping here both unnecessary
 * and counterproductive (it would amplify subtle inter-channel biases before
 * colour correction has a chance to neutralise them).
 *
 * @param rawOutput  ArrayBuffer from InferenceEngine.runInferenceSync [H×W×3] float32
 * @param modelDim   Spatial dimension of the model output (e.g. 512)
 * @returns          Float32Array[modelDim²×3] in [0, 1]
 */
function _tanhDenormToF32(
	rawOutput: ArrayBuffer,
	modelDim: number
): Float32Array {
	const f32in = new Float32Array(rawOutput)
	const n = modelDim * modelDim * 3
	const out = new Float32Array(n)
	for (let i = 0; i < n; i++) {
		const v = (f32in[i] + 1.0) * 0.5
		out[i] = v < 0 ? 0 : v > 1 ? 1 : v
	}
	return out
}

/**
 * Texture-only colour correction via YCbCr luminance transfer.
 *
 * Based on TiledInferenceRunner._applyTextureOnlyColour (Section 11), with the
 * luma-transfer step corrected from a multiplicative ratio to a YCbCr
 * substitution — see "BUGFIX" note below.
 * Applied here at model-dim resolution (512×512) using the downscaled original
 * as the chrominance source. Mirrors artlens_infer_v5.py::colour_mode_texture_only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE PRIMARY FIX FOR THE COLOUR CAST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  The Van Gogh model interprets near-white / large-uniform-area backgrounds as
 *  "sky" and paints them blue/cyan — this is intentional model behaviour, not a
 *  calibration artefact. TiledInferenceRunner corrected this by replacing the
 *  model's raw chrominance with the original photo's Cb/Cr after stitching.
 *  CoarseToFineRunner had no equivalent step, so the raw blue sky output flowed
 *  directly to GuidedUpsamplePass — the 22% SoftLight overlay was not nearly
 *  strong enough to overcome a global 100% cyan cast on a large uniform region.
 *
 * ALGORITHM (BT.601 YCbCr luma substitution):
 *
 *   sY       = 0.299×sR + 0.587×sG + 0.114×sB   (stylised luma — Van Gogh texture)
 *   oY       = 0.299×oR + 0.587×oG + 0.114×oB   (original luma — scene brightness)
 *   blendedY = luminanceBlend×sY + (1−luminanceBlend)×oY
 *
 *   Cb, Cr   = BT.601 chroma of the ORIGINAL pixel (deviation from neutral grey)
 *   outRGB   = YCbCr⁻¹(blendedY, Cb, Cr)         (swap in blendedY, keep Cb/Cr fixed)
 *
 *   Result: Van Gogh brushstroke luminance texture on the original colour palette.
 *   Cb and Cr are held EXACTLY constant → the grey background stays grey, skin
 *   stays skin, and a near-black pixel (Cb,Cr ≈ 0) stays neutral grey/black no
 *   matter how bright blendedY is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUGFIX — RED/ORANGE "HALOS" ON EYES, PUPILS, AND DEEP SHADOW
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  An earlier revision implemented the luma transfer as a multiplicative ratio:
 *
 *      yRatio = blendedY / oY     (oY > GAUSSIAN_FLOOR_EPSILON, else yRatio = blendedY)
 *      outRGB = originalRGB × yRatio
 *
 *  This does NOT actually preserve chrominance: scaling RGB by a scalar k also
 *  scales the Cb/Cr deviation from neutral by k. Near-black source pixels (dog
 *  eyes, pupils, deep shadow folds, ink-black clothing) are almost never
 *  perfectly neutral — JPEG compression and sensor noise leave a tiny residual
 *  colour cast (e.g. oRGB ≈ (0.024, 0, 0), oY ≈ 0.007). When the Van Gogh model
 *  paints that same region with a much higher luminance (blendedY ≈ 0.25–0.5,
 *  e.g. a bright impasto highlight stroke over what was a black eye), yRatio
 *  blows up to 10×–200×. The tiny residual colour cast is amplified by that same
 *  factor, turning a pixel that should read as "a bit black" into saturated
 *  red/orange — exactly the "red eye" / "orange shadow" artefact reported on the
 *  dog photos, hug photo, and ripped-jeans photo.
 *
 *  The YCbCr substitution above has no division and no multiplicative
 *  amplification: Cb/Cr offsets from neutral stay at their original (tiny)
 *  magnitude regardless of blendedY, so dark/near-neutral source pixels stay
 *  dark/near-neutral in the output. GAUSSIAN_FLOOR_EPSILON is no longer needed.
 *
 * @param stitchedF32   Tanh-denormed model output [H×W×3] in [0, 1]
 * @param originalRgba  Downscaled source photo [H×W×4] uint8 [0, 255] — not modified
 * @param imageW        Width of both arrays (= inferenceRes, e.g. 512)
 * @param imageH        Height of both arrays (= inferenceRes, e.g. 512)
 * @param luminanceBlend Impasto depth [0–1]; 1.0 = full stylised luma; 0.85 recommended
 * @returns Float32Array[H×W×3] in [0, 1] — original palette, Van Gogh texture
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

		// Stylised RGB in [0, 1]
		const sR = stitchedF32[sBase]
		const sG = stitchedF32[sBase + 1]
		const sB = stitchedF32[sBase + 2]

		// Original RGB in [0, 1] — decoded inline, no extra allocation
		const oR = originalRgba[oBase] / 255.0
		const oG = originalRgba[oBase + 1] / 255.0
		const oB = originalRgba[oBase + 2] / 255.0

		// BT.601 luma
		const sY = 0.299 * sR + 0.587 * sG + 0.114 * sB
		const oY = 0.299 * oR + 0.587 * oG + 0.114 * oB

		// Blended luminance: impasto texture + original brightness anchor
		const blendedY = luminanceBlend * sY + (1.0 - luminanceBlend) * oY

		// Chrominance-preserving luma transfer via BT.601 YCbCr substitution.
		//
		// Cb/Cr below are the ORIGINAL pixel's chroma, expressed as a signed
		// deviation from neutral grey (0 == perfectly neutral). We re-synthesise
		// RGB at `blendedY` while holding that deviation fixed — NOT by scaling
		// the original RGB by blendedY/oY (see file header for why the ratio
		// form blows up near-black pixels into saturated red/orange).
		//
		// When blendedY === oY this is an exact round-trip back to (oR, oG, oB).
		const cb = -0.168736 * oR - 0.331264 * oG + 0.5 * oB
		const cr = 0.5 * oR - 0.418688 * oG - 0.081312 * oB

		const r = blendedY + 1.402 * cr
		const g = blendedY - 0.344136 * cb - 0.714136 * cr
		const b = blendedY + 1.772 * cb

		out[sBase] = r < 0 ? 0 : r > 1 ? 1 : r
		out[sBase + 1] = g < 0 ? 0 : g > 1 ? 1 : g
		out[sBase + 2] = b < 0 ? 0 : b > 1 ? 1 : b
	}

	return out
}

/**
 * Converts an RGBA8 Uint8Array to a packed RGB Float32Array in [0,1],
 * dropping alpha. Used only by the 'luminance_blend' colour-mode branch to
 * feed tensorUtils.alphaBlend, which expects two same-shaped [0,1] RGB tensors.
 */
function _rgbaU8ToF32Rgb(rgba: Uint8Array, modelDim: number): Float32Array {
	const pixelCount = modelDim * modelDim
	const out = new Float32Array(pixelCount * 3)
	for (let i = 0; i < pixelCount; i++) {
		const s = i * RGBA_CH
		const d = i * 3
		out[d] = rgba[s] / 255
		out[d + 1] = rgba[s + 1] / 255
		out[d + 2] = rgba[s + 2] / 255
	}
	return out
}

/**
 * Converts a colour-corrected Float32Array [H×W×3] in [0, 1] to a
 * Uint8Array [H×W×4] (RGBA_8888, alpha=255) for GuidedUpsamplePass.
 *
 * Mirrors TiledInferenceRunner._f32StitchedToRgba. The (v*255+0.5)|0 pattern
 * is fast nearest-integer rounding without Math.round() overhead.
 */
function _f32ToRgba(f32: Float32Array, modelDim: number): Uint8Array {
	const pixelCount = modelDim * modelDim
	const rgba = new Uint8Array(pixelCount * RGBA_CH)
	for (let i = 0; i < pixelCount; i++) {
		const s = i * 3
		const d = i * RGBA_CH
		rgba[d] = ((f32[s] < 0 ? 0 : f32[s] > 1 ? 1 : f32[s]) * 255 + 0.5) | 0
		rgba[d + 1] =
			((f32[s + 1] < 0 ? 0 : f32[s + 1] > 1 ? 1 : f32[s + 1]) * 255 +
				0.5) |
			0
		rgba[d + 2] =
			((f32[s + 2] < 0 ? 0 : f32[s + 2] > 1 ? 1 : f32[s + 2]) * 255 +
				0.5) |
			0
		rgba[d + 3] = 255
	}
	return rgba
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — JPEG ENCODE & CACHE WRITE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encodes a raw RGBA Uint8Array as JPEG and writes it to the app's cache.
 *
 * Identical to TiledInferenceRunner._encodeAndSave — same File/Paths API,
 * same output URI pattern, same quality setting.
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
			`[CoarseToFineRunner] Skia.Image.MakeImage() failed for ${imageW}×${imageH}.`
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
			'[CoarseToFineRunner] encodeToBytes(JPEG) returned null.'
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
// SECTION 9 — SHARED COARSE-TO-FINE HOT PATH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core coarse-to-fine pipeline, shared by main and preview entry points.
 *
 * Extracted into a private helper to avoid duplicating the Phase 1-7 logic
 * across runCoarseToFineInference and runCoarseToFinePreviewInference.
 * The only differences between the two callers are:
 *   - slot:        'main' | 'preview'
 *   - inferenceRes: config.mainModel | config.previewModel
 *
 * @param slot         Model slot already loaded by the caller
 * @param sourceUri    Absolute file:// URI of the source photo
 * @param inferenceRes Spatial dimension for model I/O (e.g. 512 or 256)
 * @param styleId      Used to resolve the StyleBlendProfile for guide injection
 * @param callbacks    { onProgress, shouldAbort } from StyleJobService
 */
async function _runC2FPipeline(
	slot: 'main' | 'preview',
	sourceUri: string,
	inferenceRes: number,
	styleId: StyleId,
	callbacks: CoarseToFineCallbacks
): Promise<CoarseToFineResult> {
	const t0 = Date.now()

	const profile = _resolveBlendProfile(styleId)
	tracker.log(
		`Pipeline start — slot="${slot}", inferenceRes=${inferenceRes}, ` +
			`styleId="${styleId}", guideMode=${profile.guideMode}`
	)

	// ── Phase 1: Decode source → full-res SkImage ─────────────────────────────
	//
	// The SkImage is kept alive across all phases as the guide for
	// GuidedUpsamplePass. It is disposed in the finally block below.
	const {
		skImage: guideSkImage,
		imageW,
		imageH,
	} = await _decodeSourceSkImage(sourceUri)

	let guideDisposed = false

	try {
		// ── Phase 2: GPU bicubic downsample → modelDim×modelDim RGBA ─────────
		//
		// The entire image is captured in modelDim² pixels. InstanceNorm now
		// processes global image statistics — the root cause of per-tile seams
		// is eliminated at this step.
		const downscaledRgba = _downscaleToModelRes(
			guideSkImage,
			imageW,
			imageH,
			inferenceRes
		)
		tracker.log(
			`Phase 2 done: global downsample ${imageW}×${imageH} → ${inferenceRes}²`
		)

		// ── Phase 3: RGBA8 → float32 NHWC [-1, 1] ────────────────────────────
		//
		// prepareInputTensor(scratch, inputBuf, tileSize, fp16) performs:
		//   output[i*3+c] = (rgba[i*4+c] / 127.5) − 1.0
		// which is the identical normalisation used in TiledInferenceRunner.
		// The registry-backed inputBuf is pre-allocated per slot/tileSize pair.
		const inputBuf = getOrAllocateBuffer(slot, 'input', inferenceRes, false)
		prepareInputTensor(downscaledRgba, inputBuf, inferenceRes, false)
		tracker.log(`Phase 3 done: normalised to float32 [-1,1]`)

		// ── Abort check #1: before the forward pass ───────────────────────────
		if (callbacks.shouldAbort()) {
			tracker.log('Abort signal before inference')
			throw new InferenceAbortError()
		}
		callbacks.onProgress(0.0)

		// ── Phase 4: Single TFLite forward pass ───────────────────────────────
		//
		// runInferenceSync is marked 'worklet' in InferenceEngine — callable
		// from worklet threads and the JS thread alike. On the JS thread it
		// blocks for the duration of inference (~50–300ms on mid-range GPU
		// delegate). Since we have ONE pass instead of ≈56, the maximum
		// observable block time drops from minutes to a few seconds.
		//
		// No rawOutput.slice(0) needed — we call runInferenceSync exactly once,
		// so the native TFLite output buffer is never overwritten.
		const rawOutput = InferenceEngine.runInferenceSync(slot, inputBuf)

		tracker.log(`Phase 4 done: inference (${Date.now() - t0}ms so far)`)
		callbacks.onProgress(0.55)

		// ── Abort check #2: before the expensive upsample surface allocation ──
		if (callbacks.shouldAbort()) {
			tracker.log('Abort signal before upsampling')
			throw new InferenceAbortError()
		}

		// ── Phase 5: Denormalise + texture-only colour correction ────────────
		//
		// Step 5a: Tanh denorm — maps raw f32 [-1,1] → [0,1] float.
		//   Same formula used in TiledInferenceRunner._stitchTilesLocal:
		//   val = (v + 1) × 0.5, clamped to [0, 1].
		//
		// Step 5b: _applyTextureOnlyColour — replaces the model's chrominance
		//   with the original photo's Cb/Cr (BT.601 luma transfer). This is the
		//   primary fix for the blue/cyan cast: the Van Gogh model intentionally
		//   paints large uniform backgrounds (grey walls, sky) as blue. Without
		//   this step that blue flows directly to GuidedUpsamplePass; SoftLight
		//   at guideAlpha=0.22 is far too weak to overcome a full-canvas cyan
		//   blast. With luma transfer the original palette (grey, skin, etc.)
		//   is restored while the Van Gogh brushstroke texture is preserved.
		//   Uses downscaledRgba as the colour source — same resolution as the
		//   model output, no extra decode needed.
		//
		// Step 5c: _f32ToRgba — quantise [0,1] float to uint8 RGBA8 for Skia.
		const stitchedF32 = _tanhDenormToF32(rawOutput, inferenceRes)
		const luminanceBlend =
			InferenceEngine.getActiveModelConfig(slot)?.luminanceBlend ??
			DEFAULT_MODEL_CONFIG.luminanceBlend
		const colourMode = _resolveColourMode(styleId)
		let correctedF32: Float32Array
		switch (colourMode) {
			case 'full_colour':
				// Trust the model's own trained colour output untouched —
				// correct for Baroque/Anime, where the palette IS the style.
				correctedF32 = stitchedF32
				break
			case 'luminance_blend':
				// Soft RGB alpha blend, not a hard YCbCr chroma override.
				correctedF32 = alphaBlend(
					_rgbaU8ToF32Rgb(downscaledRgba, inferenceRes),
					stitchedF32,
					luminanceBlend
				)
				break
			case 'texture_only':
			default:
				// Van Gogh's "everything goes blue" fix — keep original chroma,
				// borrow only the model's luminance/texture. See docstring above.
				correctedF32 = _applyTextureOnlyColour(
					stitchedF32,
					downscaledRgba,
					inferenceRes,
					inferenceRes,
					luminanceBlend
				)
				break
		}
		const stylizedRgba = _f32ToRgba(correctedF32, inferenceRes)
		tracker.log(
			`Phase 5 done: denorm + colour-correct (mode=${colourMode}, luminanceBlend=${luminanceBlend.toFixed(2)}) ` +
				`→ RGBA8 ${inferenceRes}²`
		)

		// ── Phase 6: Guided upsampling → native resolution ────────────────────
		//
		// GuidedUpsamplePass:
		//   a) Creates a Skia surface at outW×outH
		//   b) Draws stylized512 via cubic upscale (Mitchell-Netravali B=C=1/3)
		//   c) Overlays guideSkImage with style-adaptive BlendMode + alpha
		//   d) Snapshots → readPixels → returns Uint8Array
		//   e) Disposes surface and snapshot internally
		const finalRgba = runGuidedUpsamplePass(
			stylizedRgba,
			inferenceRes,
			guideSkImage,
			imageW,
			imageH,
			profile
		)
		tracker.log(
			`Phase 6 done: guided upsample ${inferenceRes}² → ${imageW}×${imageH} ` +
				`(${Date.now() - t0}ms so far)`
		)
		callbacks.onProgress(0.85)

		// guideSkImage is no longer needed after GuidedUpsamplePass.
		// Dispose early to release ~31 MB before the JPEG encode allocates.
		try {
			guideSkImage.dispose()
		} catch {
			/* best-effort */
		}
		guideDisposed = true

		// ── Phase 7: JPEG encode → cache write ───────────────────────────────
		const resultUri = await _encodeAndSave(finalRgba, imageW, imageH)

		const durationMs = Date.now() - t0
		tracker.log(
			`Complete — slot="${slot}", ${durationMs}ms, uri=${resultUri}`
		)
		callbacks.onProgress(1.0)

		return {
			resultUri,
			imageW,
			imageH,
			totalTiles: 1, // always 1 — single global forward pass
			durationMs,
		}
	} finally {
		// Ensure the guide SkImage is always released even on error paths.
		// Double-dispose is guarded by the flag.
		if (!guideDisposed) {
			try {
				guideSkImage.dispose()
			} catch {
				/* best-effort */
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — MAIN ENTRY POINT (teacher model)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes the coarse-to-fine stylisation pipeline using the MAIN (teacher) slot.
 *
 * Drop-in replacement for TiledInferenceRunner.runTiledInference.
 * StyleJobService requires zero changes beyond the import rename.
 *
 * PRE-CONDITION: InferenceEngine.isModelLoaded('main') === true.
 *   Caller (StyleJobService) must await loadMainModel() before calling this.
 *
 * @param sourceUri  Absolute file:// URI of the source JPEG/PNG/WebP
 * @param styleId    Style identifier for ModelConfig + blend profile resolution
 * @param callbacks  { onProgress, shouldAbort } from StyleJobService
 */
export async function runCoarseToFineInference(
	sourceUri: string,
	styleId: StyleId,
	callbacks: CoarseToFineCallbacks
): Promise<CoarseToFineResult> {
	tracker.log(
		`runCoarseToFineInference — styleId="${styleId}", source="${sourceUri}"`
	)

	if (!InferenceEngine.isModelLoaded('main')) {
		throw new Error(
			'[CoarseToFineRunner] Main model slot is not loaded. ' +
				'Caller must await InferenceEngine.loadMainModel() first.'
		)
	}

	// getActiveModelConfig returns the ModelConfig stored at load time by
	// StyleJobService → loadMainModel(path, config). Use this as the
	// authoritative resolution source — no secondary manifest round-trip.
	const liveConfig = InferenceEngine.getActiveModelConfig('main')
	const config = liveConfig ?? getModelConfig(styleId)
	const inferenceRes = config.mainModel

	tracker.log(
		`Config: inferenceRes=${inferenceRes} (source: ${liveConfig ? 'slot' : 'manifest'})`
	)

	return _runC2FPipeline('main', sourceUri, inferenceRes, styleId, callbacks)
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — PREVIEW ENTRY POINT (student model)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes the coarse-to-fine stylisation pipeline using the PREVIEW (student) slot.
 *
 * Drop-in replacement for TiledInferenceRunner.runPreviewInference.
 *
 * Resolution: config.previewModel (e.g. 256) is used for inference.
 * The full-resolution source is still decoded and used as the guide for
 * GuidedUpsamplePass — the output remains at source-native resolution.
 *
 * PRE-CONDITION: InferenceEngine.isModelLoaded('preview') === true.
 *
 * @param sourceUri  Absolute file:// URI of the source JPEG/PNG/WebP
 * @param styleId    Style identifier for ModelConfig + blend profile resolution
 * @param callbacks  { onProgress, shouldAbort } from StyleJobService
 */
export async function runCoarseToFinePreviewInference(
	sourceUri: string,
	styleId: StyleId,
	callbacks: CoarseToFineCallbacks
): Promise<CoarseToFineResult> {
	tracker.log(
		`runCoarseToFinePreviewInference — styleId="${styleId}", source="${sourceUri}"`
	)

	if (!InferenceEngine.isModelLoaded('preview')) {
		throw new Error(
			'[CoarseToFineRunner] Preview model slot is not loaded. ' +
				'Caller must await InferenceEngine.loadPreviewModel() first.'
		)
	}

	const liveConfig = InferenceEngine.getActiveModelConfig('preview')
	const config = liveConfig ?? getModelConfig(styleId)
	const inferenceRes = config.previewModel

	tracker.log(
		`Config (preview): inferenceRes=${inferenceRes} (source: ${liveConfig ? 'slot' : 'manifest'})`
	)

	return _runC2FPipeline(
		'preview',
		sourceUri,
		inferenceRes,
		styleId,
		callbacks
	)
}
