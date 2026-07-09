/**
 * @file shared/ui/DesignTokens.ts
 * @description App-wide design token palette for ArtLens.
 *
 * All screens and components import colors from this file instead of
 * defining their own local objects. This guarantees a single source of truth.
 *
 * Naming conventions:
 *   - `surface*`   — background surfaces (cards, sheets, screens)
 *   - `text*`      — typographic shades
 *   - `primary*`   — brand accent family
 *   - `error*`     — destructive / failure states
 *   - `success*`   — confirmation / downloaded states
 *   - `warning*`   — caution / battery states
 */

export const Colors = {
	// ── Backgrounds & Surfaces ──────────────────────────────────────────────────
	bg: '#F8F9FB', // Maps to background
	surface: '#FFFFFF', // Maps to white
	surfaceCard: '#FBFBFF', // Maps to cardBg
	surfaceHigh: '#F2F2F7', // Higher contrast surface elements

	// ── Borders ────────────────────────────────────────────────────────────────
	border: '#E5E5EA', // Standard layout borders
	borderSubtle: '#F2F2F7', // Maps to border

	// ── Brand / Primary ────────────────────────────────────────────────────────
	primary: '#7B61FF', // Maps to primary
	primaryMid: '#7B61FF',
	primaryLight: '#A291FF', // Maps to primaryLight
	primarySoft: '#F0EDFF',

	// ── Typography ─────────────────────────────────────────────────────────────
	text: '#1C1C1E', // Maps to text
	textMuted: '#8E8E93', // Maps to textMuted
	textDim: '#AEAEB2',

	// ── Statuses ───────────────────────────────────────────────────────────────
	success: '#34C759', // UI success state
	successLegacy: '#4CD964', // Maps to success / downloaded
	warning: '#FF9500', // Maps to warning
	warningDark: '#FF9F0A',
	warningSoft: '#FFF5E6',
	error: '#FF7675', // Maps to accent / error
	errorDeep: '#FF3B30',
	errorSoft: '#FF3B30',

	// ── Neutrals ───────────────────────────────────────────────────────────────
	white: '#FFFFFF', // Maps to white
	black: '#000000', // Maps to black
} as const
