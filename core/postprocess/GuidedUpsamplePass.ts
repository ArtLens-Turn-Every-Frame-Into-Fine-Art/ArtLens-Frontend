/**
 * @file GuidedUpsamplePass.ts
 * @description Skia-native guided upsampling pass for the coarse-to-fine pipeline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITIES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Accept a 512×512 (or previewModel-res) stylised RGBA Uint8Array from the
 *     model output and a full-resolution SkImage of the original source photo.
 *  2. Create a Skia raster surface at the original photo's native resolution.
 *  3. Cubically upscale the stylised 512 image to native resolution via
 *     canvas.drawImageRect with FilterQuality.High.
 *  4. Apply a style-adaptive guide injection pass using Skia BlendModes:
 *     - Baroque:       No injection. Cubic interpolation only. No halos.
 *     - Van Gogh:      SoftLight at guideAlpha ≈ 0.22 — text readable without
 *                      flattening impasto brushstroke luminance.
 *     - Anime/Cartoon: Multiply at guideAlpha ≈ 0.55 — ink outlines and text
 *                      boundaries snap to their original positions cleanly.
 *  5. Snapshot the surface, extract raw RGBA bytes, dispose all intermediate
 *     Skia objects, and return the pixel buffer to the caller.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEMORY CONTRACT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  IN:  stylizedRgba   — Uint8Array  [modelDim²×4],  ~1 MB at 512 px
 *  IN:  guideSkImage   — SkImage (full-res source, owned by CoarseToFineRunner)
 *  IN:  outW × outH    — native output dimensions
 *  OUT: Uint8Array     [outW×outH×4] — caller passes to _encodeAndSave, then discards
 *
 *  Internal allocations (all disposed before return):
 *    stylized512        SkImage   — ~1 MB
 *    outSurface         SkSurface — ~31 MB at 4K (disposed before snapshot)
 *    outSnapshot        SkImage   — snapshot of outSurface (disposed after readPixels)
 *
 *  The guideSkImage is NOT disposed here — CoarseToFineRunner owns its lifecycle.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STYLE PROFILES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  GuideInjectionMode.None       → Baroque. Smooth chiaroscuro / deep gradients.
 *                                   Any high-pass guide injection would create
 *                                   halos around shadow-to-highlight transitions.
 *
 *  GuideInjectionMode.SoftBlend  → Van Gogh. Draws the original guide at
 *                                   SoftLight blend + low alpha. SoftLight
 *                                   preserves mid-tone brushstrokes while
 *                                   pulling dark boundary lines toward legibility.
 *                                   Alpha 0.22 preserves 78% of pure stylised
 *                                   impasto without snapping edges hard.
 *
 *  GuideInjectionMode.EdgeBlend  → Anime/Cartoon. Draws the guide at Multiply
 *                                   blend + mid alpha. Multiply darkens where
 *                                   guide pixels are dark (ink lines, text
 *                                   strokes) and is transparent where guide is
 *                                   light (flat fill regions). Result: flat
 *                                   colour blocks intact, outlines sharp.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AGSL SHADER NOTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  The Laplacian AGSL shader from the design document is intentionally NOT used
 *  here. Paint-based BlendMode injection achieves the same perceptual result
 *  without the GLSL compilation overhead on first use, and without any risk of
 *  shader-compilation failures on older Android GPU drivers. If you later need
 *  sub-pixel edge precision for extremely fine text (< 10px in the output),
 *  the AGSL path can be added as an optional fallback alongside this pass.
 *
 * PRD § 4.y — src/core/postprocess/GuidedUpsamplePass.ts
 */

'use strict'

import {
	Skia,
	AlphaType,
	ColorType,
	BlendMode,
	type SkImage,
} from '@shopify/react-native-skia'

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — STYLE BLEND PROFILES
// ─────────────────────────────────────────────────────────────────────────────

export const enum GuideInjectionMode {
	/** No guide overlay. Cubic interpolation is the only reconstruction pass. */
	None = 'none',
	/** SoftLight + low alpha — preserves painterly texture, recovers structure. */
	SoftBlend = 'softblend',
	/** Multiply + mid alpha — darkens ink lines, leaves flat fills intact. */
	EdgeBlend = 'edgeblend',
}

export interface StyleBlendProfile {
	readonly guideMode: GuideInjectionMode
	/**
	 * Opacity of the guide overlay drawn on top of the upscaled stylised image.
	 * Meaningful for SoftBlend and EdgeBlend; ignored for None.
	 */
	readonly guideAlpha: number
	/** Skia paint blend mode for the guide draw call. */
	readonly blendMode: BlendMode
}

/**
 * Baroque — smooth gradients, deep chiaroscuro.
 * Any structural guide overlay introduces high-frequency halos at major
 * luminance transitions (shadow-to-highlight). Cubic upscale is sufficient.
 */
export const BAROQUE_PROFILE: StyleBlendProfile = {
	guideMode: GuideInjectionMode.None,
	guideAlpha: 0,
	blendMode: BlendMode.Src,
}

/**
 * Van Gogh impasto — heavy brushstrokes, strong texture.
 * SoftLight at ~22% alpha:
 *   - Pulls boundary lines toward legibility (dark guide lines darken softly).
 *   - Leaves impasto highlight ridges and colour masses intact.
 *   - Avoids hard-snapping outlines that would flatten the painterly character.
 * Tune guideAlpha up toward 0.35 if text is still unreadable; down toward 0.12
 * if the brushstroke texture feels washed out.
 */
export const VANGOGH_PROFILE: StyleBlendProfile = {
	guideMode: GuideInjectionMode.SoftBlend,
	guideAlpha: 0.22,
	blendMode: BlendMode.SoftLight,
}

/**
 * Anime / Cartoonizer — flat colour fills, crisp ink outlines.
 * Multiply at ~55% alpha:
 *   - Guide pixels that are dark (ink, text) multiply to darken the stylised fill.
 *   - Guide pixels that are light (interior fill regions) are near 1.0 — multiply
 *     changes the stylised colour minimally.
 *   - Net effect: ink outlines and text edges snap back to original boundaries.
 * Tune guideAlpha down toward 0.40 if thin lines develop dark halos; up toward
 * 0.70 if outlines remain blurry after upscaling.
 */
export const ANIME_PROFILE: StyleBlendProfile = {
	guideMode: GuideInjectionMode.EdgeBlend,
	guideAlpha: 0.55,
	blendMode: BlendMode.Multiply,
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

const RGBA_CH = 4

/**
 * Upsamples a stylised model output to the guide image's native resolution,
 * then injects structural detail from the guide according to the style profile.
 *
 * @param stylizedRgba  Raw RGBA8 bytes from _denormalizeOutputToRgba (modelDim²×4)
 * @param modelDim      Spatial dimension used for inference (e.g. 512 or 256)
 * @param guideSkImage  Full-resolution original source image (owned by caller — NOT disposed here)
 * @param outW          Output canvas width (= source image width)
 * @param outH          Output canvas height (= source image height)
 * @param profile       Style-specific blend profile
 * @returns             RGBA8 Uint8Array at outW×outH resolution — caller passes to _encodeAndSave
 */
export function runGuidedUpsamplePass(
	stylizedRgba: Uint8Array,
	modelDim: number,
	guideSkImage: SkImage,
	outW: number,
	outH: number,
	profile: StyleBlendProfile
): Uint8Array {
	// ── Step 1: Wrap model output bytes in SkData, create 512×512 SkImage ────
	//
	// Skia.Image.MakeImage takes an SkData wrapper, not a raw Uint8Array directly.
	// Skia.Data.fromBytes performs a zero-copy reference count on the underlying
	// ArrayBuffer managed by the JS engine — no heap copy occurs here.
	const stylizedSkData = Skia.Data.fromBytes(stylizedRgba)
	const stylized512 = Skia.Image.MakeImage(
		{
			width: modelDim,
			height: modelDim,
			colorType: ColorType.RGBA_8888,
			alphaType: AlphaType.Opaque,
		},
		stylizedSkData,
		modelDim * RGBA_CH
	)

	if (!stylized512) {
		throw new Error(
			`[GuidedUpsamplePass] Skia.Image.MakeImage failed for ${modelDim}×${modelDim} stylised output.`
		)
	}

	// ── Step 2: Create output raster surface at native resolution ─────────────
	//
	// MakeRasterN32Premul allocates a CPU-backed ARGB_8888 surface.
	// drawImageRect still leverages the hardware rasteriser on devices where
	// Skia is configured with GPU backend even for raster output destinations.
	const outSurface = Skia.Surface.MakeOffscreen(outW, outH)
	if (!outSurface) {
		try {
			stylized512.dispose()
		} catch {
			/* best-effort */
		}
		throw new Error(
			`[GuidedUpsamplePass] Could not allocate ${outW}×${outH} output surface. ` +
				'Possible OOM — check STITCH_MAX_PIXELS limit.'
		)
	}

	const canvas = outSurface.getCanvas()
	const srcRect = { x: 0, y: 0, width: modelDim, height: modelDim }
	const dstRect = { x: 0, y: 0, width: outW, height: outH }

	// ── Step 3: Cubic upscale — stylised 512 → native resolution ─────────────
	//
	const upscalePaint = Skia.Paint()
	// drawImageRect does NOT default to cubic — it defaults to nearest-neighbour.
	// Without explicit cubic sampling, the 512→4K (≈7.5×) upscale is a hard
	// nearest-neighbour blow-up: every model pixel becomes a flat ~7×7 block.
	// This is precisely the "blocky vector segments" / jagged, pixelated,
	// "low-quality automatic tracing filter" look reported for anime outputs,
	// and the geometric "warp/buckle/melt" look for Van Gogh — straight lines
	// and curves degrade into staircase blocks before the guide overlay even
	// runs. Use Mitchell-Netravali bicubic (B=C=1/3) to reconstruct smooth
	// gradients and edges from the low-res model output.
	canvas.drawImageRectCubic(
		stylized512,
		srcRect,
		dstRect,
		1 / 3,
		1 / 3,
		upscalePaint
	)

	// stylized512 is no longer needed after the upscale draw call.
	try {
		stylized512.dispose()
	} catch {
		/* best-effort */
	}

	// ── Step 4: Style-adaptive guide injection ────────────────────────────────
	//
	// The guide (original photo at native resolution) is drawn ON TOP of the
	// upscaled stylised content using a Skia blend mode. The blend mode controls
	// how the guide's pixel values interact with the already-drawn stylised base:
	//
	//   SoftBlend (Van Gogh):
	//     SoftLight blend formula — W3C compositing spec.
	//     Where guide is dark: output darkens slightly (boundary recovery).
	//     Where guide is mid/bright: output brightens slightly (texture lift).
	//     Net: brushstroke character preserved, major edges gain legibility.
	//
	//   EdgeBlend (Anime):
	//     Multiply blend formula — output = stylised × guide.
	//     Where guide pixel ≈ 0 (ink line): output darkens toward 0 (sharp line).
	//     Where guide pixel ≈ 1 (flat fill): output unchanged (flat colour kept).
	//     Net: ink outlines and text snap to original positions cleanly.
	//
	//   None (Baroque):
	//     No draw call. Cubic upscale is the complete output.
	//     Baroque's smooth chiaroscuro gradients must not be sharpened —
	//     any high-frequency structural injection creates visible halos.
	if (profile.guideMode !== GuideInjectionMode.None) {
		const guideRect = { x: 0, y: 0, width: outW, height: outH }
		const guidePaint = Skia.Paint()
		guidePaint.setBlendMode(profile.blendMode)
		guidePaint.setAlphaf(profile.guideAlpha)
		canvas.drawImageRectCubic(
			guideSkImage,
			guideRect,
			dstRect,
			1 / 3,
			1 / 3,
			guidePaint
		)
	}

	// ── Step 5: Snapshot → RGBA bytes → surface disposal ─────────────────────
	const outSnapshot = outSurface.makeImageSnapshot()
	outSurface.dispose() // Surface released immediately — snapshot is the owner now

	const finalPixels = outSnapshot.readPixels(0, 0, {
		width: outW,
		height: outH,
		colorType: ColorType.RGBA_8888,
		alphaType: AlphaType.Opaque,
	}) as Uint8Array | null

	try {
		outSnapshot.dispose()
	} catch {
		/* best-effort */
	}

	if (!finalPixels || finalPixels.byteLength !== outW * outH * RGBA_CH) {
		throw new Error(
			`[GuidedUpsamplePass] readPixels returned unexpected data: ` +
				`expected ${outW * outH * RGBA_CH}B, ` +
				`got ${finalPixels?.byteLength ?? 0}B.`
		)
	}

	return finalPixels
}
