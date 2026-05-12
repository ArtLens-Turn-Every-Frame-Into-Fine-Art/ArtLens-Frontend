import { Skia, AlphaType, ColorType } from "@shopify/react-native-skia";

const MODEL_SIZE = 256;

/**
 * Convert a float32 NHWC tensor [1, H, W, 3] with values [0,1]
 * into a Uint8ClampedArray RGBA buffer for Skia rendering.
 */
export function tensorToRGBA(tensor: Float32Array): Uint8ClampedArray {
	const pixels = MODEL_SIZE * MODEL_SIZE;
	const rgba = new Uint8ClampedArray(pixels * 4);

	for (let i = 0; i < pixels; i++) {
		rgba[i * 4] = Math.round(tensor[i * 3] * 255); // R
		rgba[i * 4 + 1] = Math.round(tensor[i * 3 + 1] * 255); // G
		rgba[i * 4 + 2] = Math.round(tensor[i * 3 + 2] * 255); // B
		rgba[i * 4 + 3] = 255; // A (fully opaque)
	}
	return rgba;
}

/**
 * Alpha-blend stylized output with original frame.
 * intensity = 0.0 → pure original, 1.0 → pure stylized
 */
export function alphaBlend(
	original: Float32Array,
	stylized: Float32Array,
	intensity: number, // [0.0, 1.0]
): Float32Array {
	const result = new Float32Array(original.length);
	const inv = 1 - intensity;
	for (let i = 0; i < original.length; i++) {
		result[i] = inv * original[i] + intensity * stylized[i];
	}
	return result;
}

/**
 * Make a Skia SkImage from an RGBA Uint8ClampedArray.
 */
export function makeSkiaImage(rgbaBuffer: Uint8ClampedArray) {
	// Must pass through SkData instance to MakeImage
	const data = Skia.Data.fromBytes(new Uint8Array(rgbaBuffer.buffer));
	return Skia.Image.MakeImage(
		{
			width: MODEL_SIZE,
			height: MODEL_SIZE,
			alphaType: AlphaType.Opaque,
			colorType: ColorType.RGBA_8888,
		},
		data,
		MODEL_SIZE * 4, // bytesPerRow
	);
}
