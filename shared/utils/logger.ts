/**
 * @file utils/logger.ts
 * @description Developer-only, structured logging utility for ArtLens.
 */

export interface Tracker {
	log: (message: string, context?: Record<string, unknown>) => void
	warn: (message: string, context?: Record<string, unknown>) => void
	error: (message: string, context?: unknown) => void
	debug: (message: string, context?: Record<string, unknown>) => void
}

/** Pure no-op template fallback */
const noOp = (): void => {}

function createNoOpTracker(): Tracker {
	return {
		log: noOp,
		warn: noOp,
		error: noOp,
		debug: noOp,
	}
}

function safeNormalizeContext(
	context: unknown
): Record<string, unknown> | undefined {
	if (context === undefined || context === null) return undefined

	try {
		if (context instanceof Error) {
			return {
				name: context.name,
				message: context.message,
				stack: context.stack,
			}
		}
		if (typeof context === 'object') {
			return context as Record<string, unknown>
		}
	} catch {
		// Suppress fallback exceptions
	}

	return { rawContextValue: String(context) }
}

// Global placeholder variable for the native logger engine instance
let nativeLoggerModule: Record<string, (...args: any[]) => void> | null = null

// FIXED: Asynchronously load dev-dependency logger context safely without triggering ESLint 'require' constraints
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

export function createTracker(namespace: unknown): Tracker {
	// If not running in development mode, return early to prevent release bundle overhead
	if (!__DEV__) {
		return createNoOpTracker()
	}

	const resolvedNamespace =
		typeof namespace === 'string' &&
		namespace.trim().length > 0 &&
		namespace.length <= 100
			? namespace.trim()
			: 'Unknown'

	const prefix = `[ArtLens:${resolvedNamespace}]`

	return {
		log: (message, context) => {
			if (nativeLoggerModule?.log) {
				nativeLoggerModule.log(prefix, message, context)
			} else {
				if (context) {
					console.log(prefix, message, JSON.stringify(context))
				} else {
					console.log(prefix, message)
				}
			}
		},
		warn: (message, context) => {
			if (nativeLoggerModule?.warn) {
				nativeLoggerModule.warn(prefix, message, context)
			} else {
				if (context) {
					console.warn(prefix, message, JSON.stringify(context))
				} else {
					console.warn(prefix, message)
				}
			}
		},
		error: (message, context) => {
			const cleanContext = safeNormalizeContext(context)
			if (nativeLoggerModule?.error) {
				nativeLoggerModule.error(prefix, message, cleanContext)
			} else {
				if (cleanContext) {
					console.error(prefix, message, JSON.stringify(cleanContext))
				} else {
					console.error(prefix, message)
				}
			}
		},
		debug: (message, context) => {
			if (nativeLoggerModule?.debug) {
				nativeLoggerModule.debug(prefix, message, context)
			} else {
				if (context) {
					console.log(
						`${prefix}[DEBUG]`,
						message,
						JSON.stringify(context)
					)
				} else {
					console.log(`${prefix}[DEBUG]`, message)
				}
			}
		},
	}
}
