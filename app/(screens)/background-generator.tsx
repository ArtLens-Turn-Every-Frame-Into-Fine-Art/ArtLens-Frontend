/**
 * ArtLens — BackgroundGenerator (Modal Stub)
 *
 * PRD § 3.9 — Current Status: UI stub.
 *
 * This screen presents the full planned UI for the prompt-based background
 * replacement feature. The generative API payload, mask selection engine,
 * and response polling logic are NOT yet implemented.
 *
 * Planned flow:
 *   1. Source image displayed; user draws/selects foreground mask
 *   2. User types a text prompt ("ancient ruins at sunset")
 *   3. Prompt + segmented foreground PNG sent to backend
 *   4. Blended result returned and passed back to EditCanvas for refinement
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
	Text,
	TextInput,
	View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Image } from 'expo-image'
import {
	ChevronLeft,
	Construction,
	Image as ImageIcon,
	Lightbulb,
	Sparkles,
	Wand2,
} from 'lucide-react-native'
import { LinearGradient } from 'expo-linear-gradient'

// — Stores ———————————————————————————————————————————————————————————————————
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'

import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('Background-Generator')

// — Design tokens —————————————————————————————————————————————————————————————
const C = {
	bg: '#080810',
	surface: '#10101C',
	surfaceHigh: '#181828',
	border: '#1E1E30',
	primary: '#6D28D9',
	primaryMid: '#7C3AED',
	accent: '#C026D3',
	text: '#F4F4FF',
	textMuted: '#7070A0',
	textDim: '#40405A',
	warning: '#D97706',
	white: '#FFFFFF',
} as const

// — Prompt suggestions (example prompts for the user) ————————————————————————
const PROMPT_SUGGESTIONS = [
	'Ancient ruins at sunset',
	'Starry night galaxy sky',
	'Dense misty forest',
	'Urban cyberpunk alley',
	'Rolling lavender fields',
	'Frozen Arctic tundra',
] as const

// — Suggestion chip ——————————————————————————————————————————————————————————
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

// — Main Screen ——————————————————————————————————————————————————————————————

export default function BackgroundGeneratorScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// — Params & job —————————————————————————————————————————————————————————
	const { jobId } = useLocalSearchParams<{ jobId?: string }>()
	const job = useStyleJobStore((s) =>
		jobId ? (s.jobs.find((j) => j.id === jobId) ?? null) : null
	)

	// — Local state ——————————————————————————————————————————————————————————
	const [prompt, setPrompt] = useState('')
	//const [isGenerating, setIsGenerating] = useState(false) // always false — stub

	const handleSuggestion = useCallback(
		(label: string) => setPrompt(label),
		[]
	)

	const handleGenerate = useCallback(() => {
		// STUB: generation logic not yet implemented.
		// When implemented, this will:
		//   1. Call the segmentation module on job.sourceUri
		//   2. Send prompt + foreground PNG to the backend API
		//   3. Poll for result
		//   4. Navigate back to EditCanvas with the blended result URI
		tracker.warn('[BackgroundGenerator] Generation not yet implemented.')
	}, [])

	// — Source image URI (for preview) ———————————————————————————————————————
	const sourceUri = job?.sourceUri

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
			style={[styles.screen, { backgroundColor: C.bg }]}
		>
			{/* ── Header ────────────────────────────────────────────────────── */}
			<View style={[styles.header, { paddingTop: insets.top + 4 }]}>
				<Pressable
					onPress={() => router.back()}
					style={styles.headerBtn}
					accessibilityRole="button"
					accessibilityLabel="Go back"
					hitSlop={12}
				>
					<ChevronLeft color={C.text} size={26} strokeWidth={1.8} />
				</Pressable>
				<View style={styles.headerCenter}>
					<Wand2 color={C.primaryMid} size={16} strokeWidth={1.8} />
					<Text style={styles.headerTitle}>BG Generator</Text>
				</View>
				<View style={{ width: 40 }} />
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={[
					styles.scrollContent,
					{ paddingBottom: insets.bottom + 24 },
				]}
				keyboardShouldPersistTaps="handled"
			>
				{/* ── Coming soon banner ────────────────────────────────────── */}
				<ComingSoonBanner />

				{/* ── Source image preview ──────────────────────────────────── */}
				<View style={styles.section}>
					<Text style={styles.sectionLabel}>Source photo</Text>
					<View style={styles.imageCard}>
						{sourceUri ? (
							<Image
								source={{ uri: sourceUri }}
								style={styles.sourceImage}
								contentFit="cover"
								cachePolicy="disk"
								accessibilityLabel="Source photo for background replacement"
							/>
						) : (
							<View style={styles.imagePlaceholder}>
								<ImageIcon
									color={C.textDim}
									size={36}
									strokeWidth={1.2}
								/>
								<Text style={styles.placeholderText}>
									No photo selected
								</Text>
							</View>
						)}

						{/* Mask selection — stub overlay */}
						{sourceUri && (
							<View
								style={styles.maskOverlay}
								pointerEvents="none"
							>
								<LinearGradient
									colors={[
										`${C.primary}00`,
										`${C.primary}40`,
									]}
									style={StyleSheet.absoluteFill}
								/>
								<View style={styles.maskBadge}>
									<Text style={styles.maskBadgeText}>
										Tap to select foreground mask (coming
										soon)
									</Text>
								</View>
							</View>
						)}
					</View>
				</View>

				{/* ── Prompt input ──────────────────────────────────────────── */}
				<View style={styles.section}>
					<Text style={styles.sectionLabel}>
						Describe the new background
					</Text>

					<View style={styles.promptCard}>
						<Sparkles
							color={C.primaryMid}
							size={18}
							strokeWidth={1.5}
						/>
						<TextInput
							style={styles.promptInput}
							placeholder="e.g. Ancient ruins at sunset, fog rolling in"
							placeholderTextColor={C.textDim}
							value={prompt}
							onChangeText={setPrompt}
							multiline
							maxLength={200}
							accessibilityLabel="Background prompt"
							returnKeyType="default"
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

				{/* ── Suggestions ──────────────────────────────────────────── */}
				<View style={styles.section}>
					<View style={styles.suggestionsHeader}>
						<Lightbulb
							color={C.textMuted}
							size={14}
							strokeWidth={1.5}
						/>
						<Text style={styles.sectionLabel}>
							Try a suggestion
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

				{/* ── Generate button (stub — disabled) ———————————————────── */}
				<View style={styles.generateWrap}>
					<Pressable
						onPress={handleGenerate}
						disabled={true} // stub: always disabled
						style={[styles.generateBtn, styles.generateBtnDisabled]}
						accessibilityRole="button"
						accessibilityLabel="Generate background (coming soon)"
						accessibilityState={{ disabled: true }}
					>
						<LinearGradient
							colors={[`${C.primary}50`, `${C.accent}50`]}
							start={{ x: 0, y: 0 }}
							end={{ x: 1, y: 0 }}
							style={styles.generateBtnGradient}
						>
							<Wand2
								color={`${C.white}66`}
								size={20}
								strokeWidth={1.8}
							/>
							<Text style={styles.generateBtnText}>
								Generate Background
							</Text>
						</LinearGradient>
					</Pressable>

					<Text style={styles.generateHint}>
						Background generation requires a stable connection.
						{'\n'}
						Processing time: ~10–20 seconds.
					</Text>
				</View>

				{/* ── How it will work section ─────────────────────────────── */}
				<View style={[styles.section, styles.howItWorksCard]}>
					<Text style={styles.howTitle}>How it will work</Text>
					{[
						{
							step: '1',
							text: 'AI segments your subject from the background automatically.',
						},
						{
							step: '2',
							text: 'Your text prompt generates a new background via Stable Diffusion.',
						},
						{
							step: '3',
							text: 'The subject is composited onto the new scene.',
						},
						{
							step: '4',
							text: 'Refine the blend and export your final artwork.',
						},
					].map(({ step, text }) => (
						<View key={step} style={styles.howRow}>
							<View style={styles.howStep}>
								<Text style={styles.howStepText}>{step}</Text>
							</View>
							<Text style={styles.howText}>{text}</Text>
						</View>
					))}
				</View>
			</ScrollView>
		</KeyboardAvoidingView>
	)
}

// — Styles ————————————————————————————————————————————————————————————————————
const styles = StyleSheet.create({
	screen: { flex: 1 },

	// Header
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 12,
		paddingBottom: 10,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: '#1E1E30',
	},
	headerBtn: {
		width: 40,
		height: 40,
		borderRadius: 20,
		justifyContent: 'center',
		alignItems: 'center',
	},
	headerCenter: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 6,
	},
	headerTitle: {
		color: C.text,
		fontSize: 17,
		fontWeight: '700',
		letterSpacing: -0.2,
	},

	// Scroll
	scrollContent: {
		paddingHorizontal: 20,
		paddingTop: 16,
		gap: 4,
	},

	// Coming soon banner
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

	// Sections
	section: { marginBottom: 24 },
	sectionLabel: {
		color: C.textMuted,
		fontSize: 11,
		fontWeight: '700',
		letterSpacing: 0.8,
		textTransform: 'uppercase',
		marginBottom: 10,
	},
	suggestionsHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		marginBottom: 10,
	},

	// Image card
	imageCard: {
		height: 200,
		borderRadius: 16,
		overflow: 'hidden',
		backgroundColor: C.surface,
		borderWidth: 1,
		borderColor: '#1E1E30',
	},
	sourceImage: {
		width: '100%',
		height: '100%',
	},
	imagePlaceholder: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		gap: 10,
	},
	placeholderText: {
		color: C.textDim,
		fontSize: 13,
	},
	maskOverlay: {
		...StyleSheet.absoluteFillObject,
		justifyContent: 'flex-end',
		padding: 12,
	},
	maskBadge: {
		backgroundColor: 'rgba(8,8,16,0.75)',
		borderRadius: 8,
		paddingHorizontal: 10,
		paddingVertical: 5,
		alignSelf: 'center',
	},
	maskBadgeText: {
		color: C.textMuted,
		fontSize: 11,
		textAlign: 'center',
	},

	// Prompt
	promptCard: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 10,
		backgroundColor: C.surface,
		borderRadius: 14,
		borderWidth: 1,
		borderColor: '#1E1E30',
		padding: 14,
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

	// Chips
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

	// Generate
	generateWrap: {
		marginBottom: 24,
		gap: 12,
	},
	generateBtn: {
		borderRadius: 16,
		overflow: 'hidden',
	},
	generateBtnDisabled: {
		opacity: 0.55,
	},
	generateBtnGradient: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 10,
		height: 56,
	},
	generateBtnText: {
		color: `${C.white}80`,
		fontSize: 16,
		fontWeight: '800',
	},
	generateHint: {
		color: C.textDim,
		fontSize: 12,
		textAlign: 'center',
		lineHeight: 18,
	},

	// How it works
	howItWorksCard: {
		backgroundColor: C.surface,
		borderRadius: 16,
		borderWidth: 1,
		borderColor: '#1E1E30',
		padding: 20,
		gap: 14,
		marginBottom: 8,
	},
	howTitle: {
		color: C.textMuted,
		fontSize: 13,
		fontWeight: '700',
		letterSpacing: 0.3,
		marginBottom: 2,
	},
	howRow: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: 12,
	},
	howStep: {
		width: 22,
		height: 22,
		borderRadius: 11,
		backgroundColor: `${C.primaryMid}20`,
		borderWidth: 1,
		borderColor: `${C.primaryMid}40`,
		justifyContent: 'center',
		alignItems: 'center',
		marginTop: 1,
	},
	howStepText: {
		color: C.primaryMid,
		fontSize: 11,
		fontWeight: '800',
	},
	howText: {
		flex: 1,
		color: C.textMuted,
		fontSize: 13,
		lineHeight: 19,
	},
})
