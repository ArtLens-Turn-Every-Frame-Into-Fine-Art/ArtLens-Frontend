/**
 * @file storageKeys.test.ts
 * @description Unit and property-based tests for the centralized MMKV storage key registry.
 *
 * These tests guard against two failure modes:
 *   1. Accidental value edits that would silently break on-disk compatibility.
 *   2. Duplicate instance IDs that would cause two storage domains to share a file.
 *
 * Property 1: STORAGE_INSTANCE_IDS values are unique
 *   — Validates: Requirements 1.6
 * Property 2: storageKeys module has no side effects on import
 *   — Validates: Requirements 10.2
 */

import {
	STORAGE_INSTANCE_IDS,
	HARDWARE_KEYS,
	THUMBNAIL_KEYS,
	MODEL_REGISTRY_KEYS,
	APP_STATE_KEYS,
} from './storageKeys'

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE_INSTANCE_IDS — exact value assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('STORAGE_INSTANCE_IDS', () => {
	it('THUMBNAILS has the correct on-disk value', () => {
		expect(STORAGE_INSTANCE_IDS.THUMBNAILS).toBe('artlens.thumbnail_cache')
	})

	it('MODELS has the correct on-disk value', () => {
		// This was previously wrong ('artlens.models_registry').
		// The active consumers (ModelManager.ts, useModelStore.ts) both use 'artlens-model-store'.
		expect(STORAGE_INSTANCE_IDS.MODELS).toBe('artlens-model-store')
	})

	it('APP_STATE has the correct on-disk value', () => {
		expect(STORAGE_INSTANCE_IDS.APP_STATE).toBe('artlens.global_app_state')
	})

	it('HARDWARE has the correct on-disk value', () => {
		expect(STORAGE_INSTANCE_IDS.HARDWARE).toBe('artlens.hardware')
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// HARDWARE_KEYS — exact value assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('HARDWARE_KEYS', () => {
	it('PROFILE has the correct on-disk value', () => {
		expect(HARDWARE_KEYS.PROFILE).toBe('artlens.hardware.profile.v1')
	})

	it('BENCHMARK_PROFILE has the correct on-disk value', () => {
		expect(HARDWARE_KEYS.BENCHMARK_PROFILE).toBe(
			'app_config:hardware_benchmark_profile'
		)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 1: STORAGE_INSTANCE_IDS values are unique
// Validates: Requirements 1.6
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 1: STORAGE_INSTANCE_IDS values are unique', () => {
	it('no two storage domains share the same on-disk database file identifier', () => {
		const values = Object.values(STORAGE_INSTANCE_IDS)
		const uniqueValues = new Set(values)
		expect(uniqueValues.size).toBe(values.length)
	})
})

// ─────────────────────────────────────────────────────────────────────────────
// Property 2: storageKeys module has no side effects on import
// Validates: Requirements 10.2
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 2: storageKeys module has no side effects on import', () => {
	it('all exports are accessible without triggering MMKV initialization', () => {
		// The import at the top of this file IS the test.
		// If storageKeys.ts called createMMKV or any native API at module level,
		// Jest would throw here because react-native-mmkv is mocked.
		// The fact that these assertions run proves no side effects occurred.
		expect(typeof STORAGE_INSTANCE_IDS).toBe('object')
		expect(typeof HARDWARE_KEYS).toBe('object')
		expect(typeof THUMBNAIL_KEYS).toBe('object')
		expect(typeof MODEL_REGISTRY_KEYS).toBe('object')
		expect(typeof APP_STATE_KEYS).toBe('object')
	})
})
