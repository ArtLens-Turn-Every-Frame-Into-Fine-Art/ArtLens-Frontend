/**
 * utils/config.ts
 *
 * Single source of truth for runtime configuration.
 * Uses expo-constants to pull values from app.json → extra.
 *
 * To override per-environment, set `extra.apiBase` in your eas.json build profiles:
 *   "preview":     { "env": { "API_BASE": "https://staging.api.artlens.app" } }
 *   "production":  { "env": { "API_BASE": "https://api.artlens.app" } }
 */

import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra ?? {};

const config = {
	API_BASE: (extra.apiBase as string | undefined) ?? "http://localhost:10000",
} as const;

export default config;
