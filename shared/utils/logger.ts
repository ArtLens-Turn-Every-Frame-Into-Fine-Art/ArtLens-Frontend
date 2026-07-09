/**
 * @file shared/utils/logger.ts
 * @description Developer-only structured logging utility for ArtLens.
 *
 * In production builds (__DEV__ === false) every createTracker() call returns
 * a no-op object so zero logging code runs in release bundles — no overhead,
 * no console noise, and no accidental data leakage.
 *
 * In development, the module attempts to lazy-load `react-native-logger` for
 * richer filtering and log grouping in the Flipper / Metro console. If the
 * package is absent (e.g. a fresh install before running `npm install`), it
 * silently falls back to the standard console.* APIs.
 */

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPE
// ─────────────────────────────────────────────────────────────────────────────

export interface Tracker {
	log: (message: string, context?: Record<string, unknown>) => void
	warn: (message: string, context?: Record<string, unknown>) => void
	/** `context` accepts any value — Errors are serialized to plain objects. */
	error: (message: string, context?: unknown) => void
	debug: (message: string, context?: Record<string, unknown>) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Returns a Tracker whose every method is a silent no-op. Used in production. */
function createNoOpTracker(): Tracker {
	const noop = (): void => {}
	return { log: noop, warn: noop, error: noop, debug: noop }
}

/**
 * Normalizes any thrown or passed value to a plain object so it can be safely
 * serialized to JSON for console output or remote logging.
 *
 * Returns `undefined` for null/undefined (no context to log).
 */
function safeNormalizeContext(
	context: unknown
): Record<string, unknown> | undefined {
	if (context === null || context === undefined) return undefined
	try {
		if (context instanceof Error) {
			return {
				name: context.name,
				message: context.message,
				stack: context.stack,
			}
		}
		if (typeof context === 'object')
			return context as Record<string, unknown>
	} catch {
		// Suppress any secondary errors during normalization
	}
	return { rawContextValue: String(context) }
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONAL NATIVE LOGGER (dev-only, lazy)
// ─────────────────────────────────────────────────────────────────────────────

// Dynamic import avoids a hard dependency: the package is optional and may not
// be installed in all environments. Uses `import()` rather than `require()` to
// stay compatible with strict ESLint `@typescript-eslint/no-require-imports`.
let nativeLoggerModule: Record<string, (...args: unknown[]) => void> | null =
	null

if (__DEV__) {
	import('react-native-logger')
		.then((mod) => {
			nativeLoggerModule = mod.default || mod
		})
		.catch((err) => {
			console.warn(
				'[logger.ts] Dynamic lazy load for dev-dependency package failed:',
				err
			)
		})
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a namespaced Tracker for a given module or screen.
 *
 * Usage:
 *   const tracker = createTracker('GalleryScreen')
 *   tracker.log('Job completed', { jobId })
 *   tracker.error('Pipeline crash', error)
 *
 * The namespace is validated: non-string values and strings longer than 100
 * characters fall back to 'Unknown' to prevent accidentally leaking large
 * objects or stack traces as the namespace label.
 */
export function createTracker(namespace: unknown): Tracker {
	// Return no-ops in production — zero runtime cost.
	if (!__DEV__) return createNoOpTracker()

	const resolvedNamespace =
		typeof namespace === 'string' &&
		namespace.trim().length > 0 &&
		namespace.length <= 100
			? namespace.trim()
			: 'Unknown'

	const prefix = `[ArtLens:${resolvedNamespace}]`

	/** Dispatches to native logger if available, otherwise falls back to console. */
	function dispatch(
		level: 'log' | 'warn' | 'error' | 'debug',
		message: string,
		context?: Record<string, unknown>
	): void {
		if (nativeLoggerModule?.[level]) {
			nativeLoggerModule[level](prefix, message, context)
		} else {
			const consoleFn = level === 'debug' ? console.log : console[level]
			const tag = level === 'debug' ? `${prefix}[DEBUG]` : prefix
			if (context) {
				consoleFn(tag, message, JSON.stringify(context))
			} else {
				consoleFn(tag, message)
			}
		}
	}

	return {
		log: (message, context) => dispatch('log', message, context),
		warn: (message, context) => dispatch('warn', message, context),
		error: (message, context) =>
			dispatch('error', message, safeNormalizeContext(context)),
		debug: (message, context) => dispatch('debug', message, context),
	}
}
