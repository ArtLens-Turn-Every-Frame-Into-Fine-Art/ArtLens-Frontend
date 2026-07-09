/**
 * ArtLens — StyleSelectionScreen
 *
 * Post-pick art style browser and queue pipeline entry point.
 *
 * Interaction lifecycle:
 *   1. Receives `sourceUri` from navigation params (set by useImageSelection).
 *   2. Reads the active style catalog from useModelStore.
 *   3. User selects a downloaded style card → selectedStyleId updates.
 *   4. If a job for this image is already PROCESSING, a progress overlay shows.
 *   5. "Apply Fine-Art Style" tap → enqueue() + processNextJobInQueue() (fire-and-forget).
 *   6. Immediately navigates to the Gallery tab.
 *
 * Guard: if sourceUri is absent or invalid, renders a full-screen error state
 * with a "Go Back" button rather than crashing or silently failing.
 *
 * PRD § 3.3 — Directory: app/(screens)/StyleSelectionScreen.tsx
 */

import React, { useState, useCallback, useMemo } from 'react'
import {
	View,
	Text,
	TouchableOpacity,
	StyleSheet,
	ActivityIndicator,
	Platform,
	Alert,
	ScrollView,
	TextInput,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { Image } from 'expo-image'
import {
	AlertCircle,
	ChevronLeft,
	Download,
	Eye,
	HelpCircle,
	Search,
	Sparkles,
} from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useModelStore } from '@/shared/stores/useModelStore'
import { useShallow } from 'zustand/react/shallow'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { StyleJobService } from '@/features/style-transfer/StyleJobService'

import type { JobPayload, StyleId } from '@/types'
import { createTracker } from '@/shared/utils/logger'
import {
	EmptyStyleCatalog,
	SelectionStyleCard,
} from '@/features/style-selection/components'

import { CatalogInfoItem, CatalogFaqItem } from '@/features/styles/components'
import { Colors } from '@/shared/ui'

const tracker = createTracker('StyleSelectionScreen')

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const H_PADDING = 20
const COLUMN_GAP = 10

const CATEGORIES = ['All', 'Popular', 'New', 'Downloaded']

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function StyleSelectionScreen(): React.ReactElement {
	const { sourceUri } = useLocalSearchParams<{ sourceUri?: string }>()
	const insets = useSafeAreaInsets()
	const router = useRouter()

	// ── Store subscriptions ────────────────────────────────────────────────────
	const downloadedModels = useModelStore(
		useShallow((state) =>
			state.catalog.filter(
				(m) => m.isActive && m.downloadStatus === 'downloaded'
			)
		)
	)
	const allActiveModels = useModelStore(
		useShallow((state) => state.catalog.filter((m) => m.isActive))
	)
	const processingJobs = useStyleJobStore(
		useShallow((state) =>
			state.jobs.filter(
				(j) => j.sourceUri === sourceUri && j.status === 'PROCESSING'
			)
		)
	)

	// ── Local state ────────────────────────────────────────────────────────────
	const [selectedStyleId, setSelectedStyleId] = useState<StyleId | null>(null)
	const [isEnqueuing, setIsEnqueuing] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const [activeCategory, setActiveCategory] = useState('All')

	// ── Derived: inference progress per style id ───────────────────────────────
	const progressByStyleId = useMemo<Map<StyleId, number>>(() => {
		const map = new Map<StyleId, number>()
		for (const job of processingJobs) {
			map.set(job.styleId, Math.round((job.progress ?? 0) * 100))
		}
		return map
	}, [processingJobs])

	// ── Filtered model list ────────────────────────────────────────────────────
	const filteredModels = useMemo(() => {
		return allActiveModels.filter((model) => {
			const matchesSearch = model.name
				.toLowerCase()
				.includes(searchQuery.toLowerCase())
			const matchesCategory =
				activeCategory !== 'Downloaded' ||
				model.downloadStatus === 'downloaded'
			return matchesSearch && matchesCategory
		})
	}, [allActiveModels, searchQuery, activeCategory])

	// ── Handlers ──────────────────────────────────────────────────────────────

	const handleStylePress = useCallback(
		(id: StyleId): void => {
			const model = allActiveModels.find((m) => m.id === id)
			if (model?.downloadStatus !== 'downloaded') {
				tracker.debug('Tap on non-downloaded style — ignoring', {
					styleId: id,
					downloadStatus: model?.downloadStatus,
				})
				return
			}
			// Toggle selection: tap the already-selected style to deselect
			setSelectedStyleId((prev) => (prev === id ? null : id))
		},
		[allActiveModels]
	)

	const handleApplyStyle = useCallback(async (): Promise<void> => {
		if (!selectedStyleId || isEnqueuing || !sourceUri) return

		setIsEnqueuing(true)
		try {
			const payload: JobPayload = { sourceUri, styleId: selectedStyleId }
			useStyleJobStore.getState().enqueue(payload)
			void StyleJobService.processNextJobInQueue()
			router.navigate({ pathname: '/(tabs)/gallery' })
		} catch (err) {
			tracker.error('Failed to enqueue style job', {
				styleId: selectedStyleId,
				hasSourceUri: Boolean(sourceUri),
				error:
					err instanceof Error
						? {
								name: err.name,
								message: err.message,
								stack: err.stack,
							}
						: String(err),
			})
			Alert.alert(
				'Queue Error',
				'Could not enqueue this image for style transfer. Please try again.'
			)
		} finally {
			setIsEnqueuing(false)
		}
	}, [selectedStyleId, isEnqueuing, sourceUri, router])

	// ── Guard: missing / invalid sourceUri ────────────────────────────────────
	if (
		!sourceUri ||
		typeof sourceUri !== 'string' ||
		sourceUri.trim() === ''
	) {
		tracker.warn('StyleSelectionScreen mounted without a valid sourceUri', {
			receivedType: typeof sourceUri,
			catalogSize: allActiveModels.length,
		})
		return (
			<View style={styles.errorContainer}>
				<StatusBar style="dark" />
				<AlertCircle size={48} color="#EF4444" strokeWidth={1.5} />
				<Text style={styles.errorTitle}>Missing Photo</Text>
				<Text style={styles.errorBody}>
					No source photo was provided. Please go back and select an
					image first.
				</Text>
				<TouchableOpacity
					style={styles.errorButton}
					onPress={() => router.back()}
					activeOpacity={0.8}
				>
					<Text style={styles.errorButtonText}>← Go Back</Text>
				</TouchableOpacity>
			</View>
		)
	}

	// ── Derived button state ───────────────────────────────────────────────────
	const canApply =
		selectedStyleId !== null &&
		!isEnqueuing &&
		downloadedModels.some((m) => m.id === selectedStyleId)

	const selectedModel = allActiveModels.find((m) => m.id === selectedStyleId)

	return (
		<View style={styles.screen}>
			<StatusBar style="dark" />

			{/* Header */}
			<View
				style={[
					styles.header,
					{ paddingTop: insets.top > 0 ? insets.top : 16 },
				]}
			>
				<TouchableOpacity
					style={styles.backButton}
					onPress={() => router.back()}
					activeOpacity={0.7}
					accessibilityRole="button"
					accessibilityLabel="Go back"
				>
					<ChevronLeft
						size={22}
						color={Colors.text}
						strokeWidth={2}
					/>
				</TouchableOpacity>
				<Text style={styles.headerTitle}>Style Explorer</Text>
				<View style={styles.headerSpacer} />
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={[
					styles.scrollContent,
					{ paddingBottom: insets.bottom + 40 },
				]}
			>
				{/* Page intro */}
				<Text style={styles.pageTitle}>Choose Your Style</Text>
				<Text style={styles.pageSubtitle}>
					Transform your photos into masterpieces using AI-powered
					artist profiles.
				</Text>

				{/* Source photo strip */}
				<View style={styles.sourceStrip}>
					<Image
						source={{ uri: sourceUri }}
						style={styles.sourceThumb}
						contentFit="cover"
						transition={200}
						cachePolicy="memory"
					/>
					<View style={styles.sourceInfo}>
						<Text style={styles.sourceLabel}>Source Photo</Text>
						<Text style={styles.sourceHint} numberOfLines={2}>
							Select a style below to apply to this image
						</Text>
					</View>
				</View>

				{/* Info chips */}
				<View style={styles.infoBox}>
					<CatalogInfoItem
						icon={<Sparkles size={16} color={Colors.primary} />}
						label="AI Curated"
					/>
					<CatalogInfoItem
						icon={<Eye size={16} color={Colors.primary} />}
						label="Live Preview"
					/>
					<CatalogInfoItem
						icon={<Download size={16} color={Colors.primary} />}
						label="Offline Use"
					/>
				</View>

				{/* Search */}
				<View style={styles.searchContainer}>
					<Search size={20} color={Colors.textMuted} />
					<TextInput
						placeholder="Search styles..."
						style={styles.searchInput}
						value={searchQuery}
						onChangeText={setSearchQuery}
						placeholderTextColor={Colors.textMuted}
					/>
				</View>

				{/* Category pills */}
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					style={styles.categoryScroll}
				>
					{CATEGORIES.map((cat) => (
						<TouchableOpacity
							key={cat}
							onPress={() => setActiveCategory(cat)}
							style={[
								styles.pill,
								activeCategory === cat && styles.activePill,
							]}
						>
							<Text
								style={[
									styles.pillText,
									activeCategory === cat &&
										styles.activePillText,
								]}
							>
								{cat}
							</Text>
						</TouchableOpacity>
					))}
				</ScrollView>

				{/* Style grid */}
				{filteredModels.length === 0 ? (
					<EmptyStyleCatalog />
				) : (
					<View style={styles.grid}>
						{filteredModels.map((item) => (
							<SelectionStyleCard
								key={item.id}
								model={item}
								isSelected={item.id === selectedStyleId}
								progressPercent={
									progressByStyleId.get(item.id) ?? null
								}
								onPress={handleStylePress}
							/>
						))}
					</View>
				)}

				{/* FAQ */}
				<View style={styles.faqSection}>
					<View style={styles.faqHeaderRow}>
						<HelpCircle size={22} color={Colors.text} />
						<Text style={styles.faqHeader}>Help &amp; Tips</Text>
					</View>
					<CatalogFaqItem
						question="How do I download a new style?"
						answer="Tap on any style. If it's not in your library, the download will begin automatically."
					/>
					<CatalogFaqItem
						question="Can I combine styles?"
						answer="Currently, ArtLens applies one primary style per image for the best resolution results."
					/>
				</View>
			</ScrollView>

			{/* Sticky action bar */}
			<View style={[styles.actionBar, { paddingBottom: 18 }]}>
				{selectedModel ? (
					<View style={styles.actionBarInfo}>
						<Text
							style={styles.actionBarStyleName}
							numberOfLines={1}
						>
							{selectedModel.name}
						</Text>
						<Text style={styles.actionBarStyleHint}>
							{(selectedModel.description?.length ?? 0) > 60
								? `${selectedModel.description?.slice(0, 57)}…`
								: (selectedModel.description ??
									'No description available')}
						</Text>
					</View>
				) : (
					<View style={styles.actionBarInfo}>
						<Text style={styles.actionBarPlaceholder}>
							Select a style to continue
						</Text>
					</View>
				)}

				<TouchableOpacity
					style={[
						styles.applyButton,
						!canApply && styles.applyButtonDisabled,
					]}
					onPress={handleApplyStyle}
					disabled={!canApply}
					activeOpacity={0.8}
					accessibilityRole="button"
					accessibilityLabel="Apply Fine-Art Style"
					accessibilityState={{ disabled: !canApply }}
				>
					{isEnqueuing ? (
						<ActivityIndicator size="small" color="#FFF" />
					) : (
						<>
							<Sparkles
								size={16}
								color={canApply ? '#FFF' : Colors.textMuted}
								strokeWidth={2}
							/>
							<Text
								style={[
									styles.applyButtonText,
									!canApply && styles.applyButtonTextDisabled,
								]}
							>
								Apply Fine-Art Style
							</Text>
						</>
					)}
				</TouchableOpacity>
			</View>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: '#FFFFFF' },

	// Error fallback
	errorContainer: {
		flex: 1,
		backgroundColor: '#FFFFFF',
		alignItems: 'center',
		justifyContent: 'center',
		padding: 32,
		gap: 16,
	},
	errorTitle: {
		fontSize: 22,
		fontWeight: '600',
		color: Colors.text,
		textAlign: 'center',
	},
	errorBody: {
		fontSize: 15,
		color: Colors.textMuted,
		textAlign: 'center',
		lineHeight: 22,
	},
	errorButton: {
		marginTop: 8,
		paddingVertical: 12,
		paddingHorizontal: 24,
		backgroundColor: Colors.border,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: Colors.border,
	},
	errorButtonText: {
		fontSize: 15,
		fontWeight: '600',
		color: Colors.text,
	},

	// Header
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: H_PADDING,
		paddingBottom: 12,
		backgroundColor: '#FFFFFF',
		borderBottomWidth: 1,
		borderBottomColor: Colors.border,
	},
	backButton: {
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: Colors.border,
		alignItems: 'center',
		justifyContent: 'center',
	},
	headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
	headerSpacer: { width: 40 },

	scrollContent: { padding: H_PADDING },

	pageTitle: {
		fontSize: 32,
		fontWeight: '800',
		color: Colors.text,
		marginBottom: 8,
		letterSpacing: -0.5,
	},
	pageSubtitle: {
		fontSize: 16,
		color: Colors.textMuted,
		marginBottom: 20,
		lineHeight: 22,
	},

	// Source photo strip
	sourceStrip: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: '#F8F3FF',
		borderRadius: 16,
		padding: 14,
		marginBottom: 20,
		gap: 14,
	},
	sourceThumb: {
		width: 54,
		height: 54,
		borderRadius: 10,
		backgroundColor: Colors.border,
	},
	sourceInfo: { flex: 1 },
	sourceLabel: {
		fontSize: 11,
		fontWeight: '700',
		color: Colors.primary,
		letterSpacing: 1,
		textTransform: 'uppercase',
		marginBottom: 4,
	},
	sourceHint: { fontSize: 13, color: Colors.textMuted, lineHeight: 18 },

	// Info chips
	infoBox: {
		flexDirection: 'row',
		backgroundColor: '#F8F3FF',
		borderRadius: 16,
		padding: 16,
		marginBottom: 24,
		justifyContent: 'space-around',
	},

	// Search
	searchContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: Colors.border,
		borderRadius: 12,
		paddingHorizontal: 12,
		height: 48,
		marginBottom: 20,
	},
	searchInput: {
		flex: 1,
		fontSize: 16,
		marginLeft: 8,
		color: Colors.text,
	},

	// Category pills
	categoryScroll: { marginBottom: 24 },
	pill: {
		paddingHorizontal: 18,
		paddingVertical: 10,
		borderRadius: 25,
		backgroundColor: Colors.border,
		marginRight: 10,
	},
	activePill: { backgroundColor: Colors.primary },
	pillText: { fontSize: 14, color: Colors.textMuted, fontWeight: '600' },
	activePillText: { color: '#FFF' },

	// Grid
	grid: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		justifyContent: 'space-between',
		gap: COLUMN_GAP,
	},

	// FAQ
	faqSection: {
		marginTop: 20,
		paddingTop: 30,
		borderTopWidth: 1,
		borderTopColor: Colors.border,
		marginBottom: 20,
	},
	faqHeaderRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		marginBottom: 20,
	},
	faqHeader: { fontSize: 20, fontWeight: '800', color: Colors.text },

	// Sticky action bar
	actionBar: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 16,
		paddingTop: 14,
		backgroundColor: '#FFFFFF',
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: Colors.border,
		gap: 12,
		...Platform.select({
			ios: {
				shadowColor: '#000',
				shadowOffset: { width: 0, height: -4 },
				shadowOpacity: 0.06,
				shadowRadius: 8,
			},
			android: { elevation: 8 },
		}),
	},
	actionBarInfo: { flex: 1, justifyContent: 'center', gap: 3 },
	actionBarStyleName: {
		fontSize: 15,
		fontWeight: '700',
		color: Colors.text,
	},
	actionBarStyleHint: {
		fontSize: 11,
		color: Colors.textMuted,
		lineHeight: 15,
	},
	actionBarPlaceholder: {
		fontSize: 13,
		color: Colors.textMuted,
		fontStyle: 'italic',
	},
	applyButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: Colors.primary,
		borderRadius: 12,
		paddingVertical: 13,
		paddingHorizontal: 18,
		gap: 7,
		minWidth: 180,
		...Platform.select({
			ios: {
				shadowColor: Colors.primary,
				shadowOffset: { width: 0, height: 4 },
				shadowOpacity: 0.35,
				shadowRadius: 10,
			},
			android: { elevation: 8 },
		}),
	},
	applyButtonDisabled: {
		backgroundColor: Colors.border,
		...Platform.select({
			ios: { shadowOpacity: 0 },
			android: { elevation: 0 },
		}),
	},
	applyButtonText: {
		fontSize: 14,
		fontWeight: '700',
		color: '#FFF',
		letterSpacing: 0.3,
	},
	applyButtonTextDisabled: { color: Colors.textMuted },
})
