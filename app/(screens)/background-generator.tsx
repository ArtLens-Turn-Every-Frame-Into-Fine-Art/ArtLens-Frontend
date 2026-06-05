/**
 * ArtLens — BackgroundGeneratorScreen
 *
 * PRD § 3.9 — Merges the full planned UI from BackgroundGenerator_old.tsx
 * into the current dark-theme architecture.
 *
 * UI includes:
 *   - Main image preview with Subject Isolated badge
 *   - AI Prompt text input with suggestions
 *   - Keep Subject toggle
 *   - Variations gallery with add button
 *   - Sticky footer with Back + Regenerate actions
 *   - Coming-soon banner (feature stub)
 *
 * Generation flow (NOT yet implemented):
 *   1. Source image displayed; user draws/selects foreground mask
 *   2. User types a text prompt ("ancient ruins at sunset")
 *   3. Prompt + segmented foreground PNG sent to backend
 *   4. Blended result returned and passed back to EditCanvas
 *
 * Dependencies:
 *   - src/shared/stores/useStyleJobStore
 *   - src/types/index.ts
 */

import React, { useCallback, useState } from 'react'
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Switch,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Image } from 'expo-image'
import { BlurView } from 'expo-blur'
import {
	ChevronLeft,
	Construction,
	Lightbulb,
	Plus,
	RotateCcw,
	Scissors,
	Sparkles,
	UserCheck,
	Wand2,
} from 'lucide-react-native'

// — Stores ————————————————————————————————————————————————————————————————————
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('Background-Generator')

// — Design tokens — light palette matching app-wide theme —————————————————————
const C = {
	bg: '#F8F9FB',
	surface: '#FFFFFF',
	surfaceHigh: '#F2F2F7',
	border: '#E5E5EA',
	primary: '#7B61FF',
	primaryMid: '#7B61FF',
	primaryLight: '#A291FF',
	accent: '#FF7675',
	text: '#1C1C1E',
	textMuted: '#8E8E93',
	textDim: '#AEAEB2',
	warning: '#FF9F0A',
	warningSoft: '#FFF5E6',
	success: '#34C759',
	white: '#FFFFFF',
} as const

// — Prompt suggestions ————————————————————————————————————————————————————————
const PROMPT_SUGGESTIONS = [
	'Ancient ruins at sunset',
	'Starry night galaxy sky',
	'Dense misty forest',
	'Urban cyberpunk alley',
	'Rolling lavender fields',
	'Frozen Arctic tundra',
] as const

// — Fallback variation images —————————————————————————————————————————————————
const DEFAULT_VARIATIONS = [
	'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400',
	'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400',
	'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400',
] as const

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// — Suggestion chip ———————————————————————————————————————————————————————————
interface SuggestionChipProps {
	label: string
	onPress: (label: string) => void
}

const SuggestionChip = React.memo<SuggestionChipProps>(({ label, onPress }) => {
	const handlePress = useCallback(() => onPress(label), [label, onPress])
	return (
		<Pressable
			onPress={handlePress}
			style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
			accessibilityRole="button"
			accessibilityLabel={`Use prompt: ${label}`}
		>
			<Sparkles color={C.primaryMid} size={11} strokeWidth={1.5} />
			<Text style={styles.chipText}>{label}</Text>
		</Pressable>
	)
})
SuggestionChip.displayName = 'SuggestionChip'

// — Coming soon banner ————————————————————————————————————————————————————————
const ComingSoonBanner: React.FC = () => (
	<View style={styles.comingSoonBanner}>
		<Construction color={C.warning} size={18} strokeWidth={1.6} />
		<View style={styles.comingSoonText}>
			<Text style={styles.comingSoonTitle}>Feature in development</Text>
			<Text style={styles.comingSoonSub}>
				The AI background generator is coming in the next release. Your
				prompts are ready — just waiting on the model!
			</Text>
		</View>
	</View>
)

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function BackgroundGeneratorScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// — Params & job ——————————————————————————————————————————————————————————
	const { jobId } = useLocalSearchParams<{ jobId?: string }>()
	const job = useStyleJobStore((s) =>
		jobId ? (s.jobs.find((j) => j.id === jobId) ?? null) : null
	)

	// — Local state ———————————————————————————————————————————————————————————
	const [prompt, setPrompt] = useState('')
	const [keepSubject, setKeepSubject] = useState(true)
	const [selectedVariation, setSelectedVariation] = useState(0)

	// Use job source as first variation if available, otherwise fall back to defaults
	const variations: string[] = job?.sourceUri
		? [job.sourceUri, ...DEFAULT_VARIATIONS.slice(1)]
		: [...DEFAULT_VARIATIONS]

	const handleSuggestion = useCallback(
		(label: string) => setPrompt(label),
		[]
	)

	const handleReset = useCallback(() => {
		setPrompt('')
		setKeepSubject(true)
		setSelectedVariation(0)
	}, [])

	const handleGenerate = useCallback(() => {
		// STUB: generation logic not yet implemented.
		// When implemented, this will:
		//   1. Call the segmentation module on job.sourceUri
		//   2. Send prompt + foreground PNG to the backend API
		//   3. Poll for result
		//   4. Navigate back to EditCanvas with the blended result URI
		tracker.warn('[BackgroundGenerator] Generation not yet implemented.')
	}, [])

	const previewUri = variations[selectedVariation]

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
			style={[styles.screen, { backgroundColor: C.bg }]}
		>
			{/* ── Header ──────────────────────────────────────────────────────── */}
			<View style={[styles.header, { paddingTop: insets.top + 4 }]}>
				<TouchableOpacity
					onPress={() => router.back()}
					style={styles.headerBtn}
					accessibilityRole="button"
					accessibilityLabel="Go back"
					hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
				>
					<ChevronLeft color={C.text} size={26} strokeWidth={1.8} />
				</TouchableOpacity>

				<View style={styles.headerCenter}>
					<Wand2 color={C.primaryMid} size={15} strokeWidth={1.8} />
					<Text style={styles.headerTitleMain}>Background</Text>
					<Text
						style={[
							styles.headerTitleMain,
							{ color: C.primaryLight },
						]}
					>
						Generator
					</Text>
				</View>

				<TouchableOpacity
					onPress={handleReset}
					accessibilityRole="button"
					accessibilityLabel="Reset all fields"
				>
					<Text style={styles.resetText}>Reset</Text>
				</TouchableOpacity>
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={[
					styles.scrollContent,
					{ paddingBottom: insets.bottom + 100 },
				]}
				keyboardShouldPersistTaps="handled"
			>
				{/* ── Coming soon banner ───────────────────────────────────────── */}
				<ComingSoonBanner />

				{/* ── Main preview with Subject Isolated badge ─────────────────── */}
				<View style={styles.section}>
					<View style={styles.previewContainer}>
						<Image
							source={{ uri: previewUri }}
							style={styles.mainPreview}
							contentFit="cover"
							cachePolicy="disk"
							accessibilityLabel="Background preview"
						/>
						{/* Subject Isolated badge — mirrors BackgroundGenerator_old */}
						<BlurView
							intensity={60}
							tint="dark"
							style={styles.subjectBadge}
						>
							<UserCheck size={14} color={C.success} />
							<Text style={styles.subjectBadgeText}>
								Subject Isolated
							</Text>
						</BlurView>
					</View>
				</View>

				{/* ── Prompt section ───────────────────────────────────────────── */}
				<View style={styles.section}>
					<View style={styles.labelRow}>
						<Text style={styles.sectionLabel}>AI PROMPT</Text>
						<Sparkles
							size={13}
							color={C.primaryMid}
							strokeWidth={1.5}
						/>
					</View>
					<View style={styles.promptCard}>
						<Sparkles
							color={C.primaryMid}
							size={18}
							strokeWidth={1.5}
						/>
						<TextInput
							style={styles.promptInput}
							placeholder="e.g., 'Cyberpunk city at night with neon lights'..."
							placeholderTextColor={C.textDim}
							value={prompt}
							onChangeText={setPrompt}
							multiline
							maxLength={200}
							accessibilityLabel="Background prompt"
						/>
						{prompt.length > 0 && (
							<Pressable
								onPress={() => setPrompt('')}
								hitSlop={8}
								accessibilityRole="button"
								accessibilityLabel="Clear prompt"
							>
								<Text style={styles.clearBtn}>✕</Text>
							</Pressable>
						)}
					</View>
					<Text style={styles.charCount}>{prompt.length}/200</Text>
				</View>

				{/* ── Suggestions ──────────────────────────────────────────────── */}
				<View style={styles.section}>
					<View style={styles.labelRow}>
						<Lightbulb
							color={C.textMuted}
							size={13}
							strokeWidth={1.5}
						/>
						<Text style={styles.sectionLabel}>
							TRY A SUGGESTION
						</Text>
					</View>
					<View style={styles.chipsWrap}>
						{PROMPT_SUGGESTIONS.map((s) => (
							<SuggestionChip
								key={s}
								label={s}
								onPress={handleSuggestion}
							/>
						))}
					</View>
				</View>

				{/* ── Keep Subject toggle ───────────────────────────────────────── */}
				<View style={styles.toggleCard}>
					<View style={styles.toggleLeft}>
						<View style={styles.iconCircle}>
							<Scissors
								size={18}
								color={C.primaryMid}
								strokeWidth={1.8}
							/>
						</View>
						<View>
							<Text style={styles.toggleLabel}>Keep Subject</Text>
							<Text style={styles.toggleSub}>
								Maintain original person details
							</Text>
						</View>
					</View>
					<Switch
						value={keepSubject}
						onValueChange={setKeepSubject}
						trackColor={{ false: C.border, true: C.primaryMid }}
						thumbColor={C.white}
						accessibilityRole="switch"
						accessibilityLabel="Toggle keep subject"
					/>
				</View>

				{/* ── Variations gallery ────────────────────────────────────────── */}
				<View style={styles.section}>
					<Text style={styles.sectionLabel}>VARIATIONS</Text>
					<View style={styles.variationRow}>
						{variations.map((uri, index) => (
							<TouchableOpacity
								key={index}
								style={[
									styles.variationThumb,
									selectedVariation === index &&
										styles.variationThumbActive,
								]}
								onPress={() => setSelectedVariation(index)}
								accessibilityRole="button"
								accessibilityLabel={`Select variation ${index + 1}`}
								accessibilityState={{
									selected: selectedVariation === index,
								}}
							>
								<Image
									source={{ uri }}
									style={styles.variationImg}
									contentFit="cover"
									cachePolicy="disk"
								/>
							</TouchableOpacity>
						))}
						{/* Add variation — stub */}
						<TouchableOpacity
							style={styles.addVariation}
							accessibilityRole="button"
							accessibilityLabel="Add new variation (coming soon)"
						>
							<Plus size={22} color={C.white} strokeWidth={2} />
						</TouchableOpacity>
					</View>
				</View>
			</ScrollView>

			{/* ── Sticky footer ───────────────────────────────────────────────── */}
			<View
				style={[
					styles.footer,
					{ paddingBottom: Math.max(insets.bottom, 16) },
				]}
			>
				<TouchableOpacity
					style={styles.cancelBtn}
					onPress={() => router.back()}
					accessibilityRole="button"
					accessibilityLabel="Go back"
				>
					<Text style={styles.cancelBtnText}>Back</Text>
				</TouchableOpacity>

				<TouchableOpacity
					style={[
						styles.regenerateBtn,
						{ opacity: 0.55 }, // stub: always disabled
					]}
					onPress={handleGenerate}
					disabled={true}
					accessibilityRole="button"
					accessibilityLabel="Regenerate background (coming soon)"
					accessibilityState={{ disabled: true }}
				>
					<RotateCcw size={17} color={C.white} strokeWidth={2} />
					<Text style={styles.regenerateBtnText}>Regenerate</Text>
				</TouchableOpacity>
			</View>
		</KeyboardAvoidingView>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: { flex: 1 },

	// ── Header ────────────────────────────────────────────────────────────────
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingHorizontal: 16,
		paddingBottom: 12,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: C.border,
		backgroundColor: C.surface,
	},
	headerBtn: {
		width: 40,
		height: 40,
		borderRadius: 20,
		justifyContent: 'center',
		alignItems: 'center',
	},
	headerCenter: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 5,
	},
	headerTitleMain: {
		fontSize: 14,
		fontWeight: '900',
		color: C.text,
		textTransform: 'uppercase',
		letterSpacing: 1,
	},
	resetText: {
		color: C.primaryLight,
		fontWeight: '700',
		fontSize: 14,
	},

	// ── Scroll ────────────────────────────────────────────────────────────────
	scrollContent: {
		paddingHorizontal: 20,
		paddingTop: 16,
	},

	// ── Coming soon banner ────────────────────────────────────────────────────
	comingSoonBanner: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 12,
		backgroundColor: `${C.warning}12`,
		borderRadius: 14,
		borderWidth: 1,
		borderColor: `${C.warning}30`,
		padding: 14,
		marginBottom: 20,
	},
	comingSoonText: { flex: 1, gap: 4 },
	comingSoonTitle: {
		color: C.warning,
		fontSize: 14,
		fontWeight: '700',
	},
	comingSoonSub: {
		color: C.textMuted,
		fontSize: 12,
		lineHeight: 18,
	},

	// ── Section ───────────────────────────────────────────────────────────────
	section: { marginBottom: 24 },
	labelRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		marginBottom: 10,
	},
	sectionLabel: {
		fontSize: 11,
		fontWeight: '800',
		color: C.textMuted,
		letterSpacing: 0.8,
		textTransform: 'uppercase',
	},

	// ── Main preview ──────────────────────────────────────────────────────────
	previewContainer: {
		borderRadius: 18,
		overflow: 'hidden',
		backgroundColor: C.surface,
		borderWidth: 1,
		borderColor: C.border,
		elevation: 5,
		shadowColor: C.primary,
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.2,
		shadowRadius: 12,
	},
	mainPreview: {
		width: '100%',
		height: 340,
	},
	subjectBadge: {
		position: 'absolute',
		top: 14,
		left: 14,
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 12,
		paddingVertical: 7,
		borderRadius: 20,
		overflow: 'hidden',
		gap: 6,
	},
	subjectBadgeText: {
		color: C.white,
		fontSize: 11,
		fontWeight: '700',
	},

	// ── Prompt card ───────────────────────────────────────────────────────────
	promptCard: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 10,
		backgroundColor: C.surface,
		borderRadius: 14,
		borderWidth: 1,
		borderColor: C.border,
		padding: 14,
		minHeight: 90,
	},
	promptInput: {
		flex: 1,
		color: C.text,
		fontSize: 14,
		lineHeight: 21,
		maxHeight: 100,
		padding: 0,
		textAlignVertical: 'top',
	},
	clearBtn: {
		color: C.textDim,
		fontSize: 14,
		marginTop: 2,
	},
	charCount: {
		color: C.textDim,
		fontSize: 11,
		textAlign: 'right',
		marginTop: 6,
	},

	// ── Chips ─────────────────────────────────────────────────────────────────
	chipsWrap: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: 8,
	},
	chip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 5,
		backgroundColor: `${C.primaryMid}15`,
		borderRadius: 20,
		borderWidth: 1,
		borderColor: `${C.primaryMid}30`,
		paddingHorizontal: 12,
		paddingVertical: 7,
	},
	chipText: {
		color: C.primaryMid,
		fontSize: 12,
		fontWeight: '600',
	},

	// ── Toggle card ───────────────────────────────────────────────────────────
	toggleCard: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		backgroundColor: C.surface,
		padding: 16,
		borderRadius: 16,
		marginBottom: 24,
		borderWidth: 1,
		borderColor: C.border,
	},
	toggleLeft: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 14,
	},
	iconCircle: {
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: `${C.primaryMid}1A`,
		justifyContent: 'center',
		alignItems: 'center',
		borderWidth: 1,
		borderColor: `${C.primaryMid}30`,
	},
	toggleLabel: {
		fontSize: 15,
		fontWeight: '700',
		color: C.text,
	},
	toggleSub: {
		fontSize: 12,
		color: C.textMuted,
		marginTop: 2,
	},

	// ── Variations ────────────────────────────────────────────────────────────
	variationRow: {
		flexDirection: 'row',
		gap: 10,
		flexWrap: 'wrap',
	},
	variationThumb: {
		width: 68,
		height: 68,
		borderRadius: 14,
		overflow: 'hidden',
		borderWidth: 2,
		borderColor: 'transparent',
	},
	variationThumbActive: {
		borderColor: C.primaryMid,
	},
	variationImg: {
		width: '100%',
		height: '100%',
	},
	addVariation: {
		width: 68,
		height: 68,
		borderRadius: 14,
		backgroundColor: C.surfaceHigh,
		borderWidth: 1,
		borderColor: C.border,
		justifyContent: 'center',
		alignItems: 'center',
	},

	// ── Sticky footer ─────────────────────────────────────────────────────────
	footer: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		flexDirection: 'row',
		paddingHorizontal: 20,
		paddingTop: 14,
		backgroundColor: `${C.surface}F8`,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: C.border,
		gap: 12,
	},
	cancelBtn: {
		flex: 1,
		height: 52,
		borderRadius: 26,
		borderWidth: 1,
		borderColor: C.border,
		justifyContent: 'center',
		alignItems: 'center',
		backgroundColor: C.surfaceHigh,
	},
	cancelBtnText: {
		fontSize: 15,
		fontWeight: '700',
		color: C.text,
	},
	regenerateBtn: {
		flex: 2,
		height: 52,
		borderRadius: 26,
		flexDirection: 'row',
		justifyContent: 'center',
		alignItems: 'center',
		gap: 9,
		backgroundColor: C.primaryMid,
		elevation: 4,
		shadowColor: C.primary,
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.4,
		shadowRadius: 8,
	},
	regenerateBtnText: {
		fontSize: 15,
		fontWeight: '700',
		color: C.white,
	},
})
