/**
 * @file services/api.ts
 * @description Centralized API HTTP network client for the ArtLens backend orchestration layer.
 *
 * RESPONSIBILITIES:
 * - Handle native asynchronous fetch executions safely with strict JSON serialization policies
 * - Wrap smart server-side delta manifest sync mutations cleanly for the Zustand catalog engine
 * - Enforce structural network isolation — no raw fetch blocks scattered throughout the UI layer
 * - Provide a specialized status interceptor for HTTP 304 (Not Modified) optimizations
 *
 * PRD § 5.2 — Directory: src/services/api.ts
 */

import config from '@/shared/utils/config'
import { ContactPayload, ManifestResponse, SyncResult } from '@/types'

const BASE_URL = config.API_BASE

// ─────────────────────────────────────────────────────────────────────────────
// CENTRALIZED NETWORK HTTP CLIENT UTILS
// ─────────────────────────────────────────────────────────────────────────────

const api = {
	/**
	 * Dispatches an asynchronous hardware-bound POST action over global fetch operations.
	 * Returns null if a target resource yields an HTTP 304 context status map pointer.
	 */
	post: async <T>(path: string, body: unknown): Promise<T | null> => {
		const response = await fetch(`${BASE_URL}${path}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify(body),
		})

		// HTTP 304 status map flag: Manifest is up-to-date; short-circuit execution cascades safely
		if (response.status === 304) {
			return null
		}

		if (!response.ok) {
			let errorMessage = `HTTP ${response.status}`
			try {
				const errorBody = await response.json()
				errorMessage =
					errorBody?.message ?? errorBody?.error ?? errorMessage
			} catch {
				// Suppress individual parser validation runtime errors on dropped context channels
			}
			throw new Error(errorMessage)
		}

		return response.json() as Promise<T>
	},
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT IMPLEMENTATIONS (ALIGNED WORD-FOR-WORD WITH SRC/TYPES/INDEX.TS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatches a smart delta manifest synchronization handshake request down to remote servers.
 * Maps incoming parameters cleanly onto the network layer and returns a validated SyncResult structure.
 *
 * @param req - Manifest request payload matching parameters allowed by backend sync routers
 * @returns Fully updated delta changes object metadata layout, or null if nothing changed (304)
 */
export async function syncManifest(
	req: {
		clientHash?: string
		localModels?: { id: string; version: number }[]
	} = {}
): Promise<SyncResult> {
	// Remote server yields full structural 200 payload map on updates
	const result = await api.post<ManifestResponse>('/api/models-manifest', req)

	if (!result) {
		return null
	}

	return {
		manifestHash: result.manifestHash,
		updates: result.updates,
		deleted: result.deleted,
	}
}

/**
 * Transmits support inquiries or custom application technical reports back onto centralized databases.
 *
 * @param data - Raw customer engagement text parameters tracking message data configurations matching ContactPayload
 * @returns Operations validation confirmation metrics containing confirmation messages from the server
 */
export async function submitContactForm(
	data: ContactPayload
): Promise<{ success: boolean; message: string }> {
	const response = await api.post<{ success: boolean; message: string }>(
		'/api/contact-us',
		data
	)

	if (!response) {
		throw new Error(
			'[API] Empty confirmation footprint received from contact submission channel.'
		)
	}

	return response
}
