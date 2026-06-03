/**
 * @file constants.ts
 * @description Global configuration matrices, hardware parameters, and system constants for ArtLens.
 *
 * PRD § 5 — Directory: src/shared/utils/constants.ts
 */

import { Dimensions } from 'react-native'
import { ModelSlot, ModelConfig } from '@/types'
import { TensorflowModelDelegate } from 'react-native-fast-tflite'

const { width, height } = Dimensions.get('window')

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION CORE METADATA
// ─────────────────────────────────────────────────────────────────────────────

export const APP_INFO = {
	name: 'ArtLens',
	version: '2.4.0',
	buildNumber: '1024',
	/** @deprecated alias for buildNumber — retained for legacy callers */
	build: '1024',
	awardBadge: 'Awwwards Mobile Excellence 2026',
	supportEmail: 'support@artlens.app',
	twitterUrl: 'https://x.com/artlens_app',
	xHandle: '@ArtLensApp',
	album: 'ArtLens',
	success_reset_ms: 4000,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// UI COLORS & LAYOUT
// Palette sourced from constants_old.ts (light theme tokens).
// Dark-theme tokens live in ExportScreen's local `C` constant.
// ─────────────────────────────────────────────────────────────────────────────

export const COLORS = {
	primary: '#7B61FF',
	primaryLight: '#A291FF',
	accent: '#FF7675',
	background: '#F8F9FB',
	white: '#FFFFFF',
	black: '#000000',
	textMain: '#1C1C1E',
	textGray: '#8E8E93',
	border: '#F2F2F7',
	cardBg: '#FBFBFF',
	success: '#4CD964',
} as const

export const LAYOUT = {
	window: { width, height },
	isSmallDevice: width < 375,
	padding: 20,
	borderRadius: 15,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// HARDWARE & COMPUTE CONSTRAINTS
// ─────────────────────────────────────────────────────────────────────────────

export const BATTERY_LIMITS = {
	CRITICAL_THRESHOLD_PERCENT: 5,
	POLLING_INTERVAL_MS: 30000,
} as const

export const INFERENCE_DELEGATES: Record<
	ModelSlot,
	readonly TensorflowModelDelegate[]
> = {
	preview: [],
	main: ['nnapi', 'android-gpu', 'core-ml'],
} as const

// ─────────────────────────────────────────────────────────────────────────────
// CACHE & STORAGE POLICIES
// ─────────────────────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
	THUMBNAIL_PREFIX: 'thumb_meta:',
	MODEL_REGISTRY_PREFIX: 'model_meta:',
} as const

export const CACHE_POLICIES = {
	THUMB_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
	MAX_TOTAL_FOOTPRINT_BYTES: 500 * 1024 * 1024,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// STYLE MODEL SAFETY FALLBACKS
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
	inferenceResolution: 512,
	previewResolution: 256,
	tileOverlap: 64,
	luminanceBlend: 0.75,
	defaultColourMode: 'texture_only',
	preferredColourMode: 'texture_only',
} as const
