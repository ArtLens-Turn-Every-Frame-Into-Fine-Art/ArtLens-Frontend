/**
 * ArtLens — StylesScreen (Catalog Browser Tab)
 *
 * Full style catalog with search, category filter, pull-to-refresh manifest
 * sync, per-model download, and a detail bottom sheet.
 *
 * Uses FlatList for the grid to keep the main thread free during scroll.
 * handleDownload reads catalog state via Zustand getState() (not the hook)
 * to preserve a stable function identity across renders and prevent unnecessary
 * re-renders of non-downloading StyleGridCard instances.
 *
 * Directory: app/(tabs)/styles.tsx
 */

import React, { useCallback, useMemo, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
	Alert,
	FlatList,
	Platform,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
	Download,
	Eye,
	HelpCircle,
	Search,
	Sparkles,
} from 'lucide-react-native'

import { useModelStore } from '@/shared/stores/useModelStore'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { syncManifest } from '@/services/api'
import {
	downloadStyleAssets,
	_writeRegistryEntry,
} from '@/core/storage/ModelManager'

import {
	CatalogInfoItem,
	CatalogFaqItem,
	StyleGridCard,
	ModelDetailSheet,
} from '@/features/styles/components'

import type { StyleModel } from '@/types'
import { createTracker } from '@/shared/utils/logger'
import { DEFAULT_MODEL_CONFIG } from '@/shared/utils/constants'
import { Colors } from '@/shared/ui'

const tracker = createTracker('StylesScreen')

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const H_PADDING = 20

const CATEGORIES = ['All', 'Popular', 'New', 'Downloaded']

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function StylesScreen(): React.JSX.Element {
	const router = useRouter()
	const insets = useSafeAreaInsets()
	const { sourceUri } = useLocalSearchParams<{ sourceUri?: string }>()

	// ── Store subscriptions ────────────────────────────────────────────────────
	const catalog = useModelStore((s) => s.catalog)
	const clientHash = useModelStore((s) => s.clientHash)
	const setClientHash = useModelStore((s) => s.setClientHash)
	const applyManifestUpdate = useModelStore((s) => s.applyManifestUpdate)
	const updateDownloadStatus = useModelStore((s) => s.updateDownloadStatus)
	const enqueueJob = useStyleJobStore((s) => s.enqueue)

	// ── UI state ───────────────────────────────────────────────────────────────
	const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const [activeCategory, setActiveCategory] = useState('All')
	const [detailItem, setDetailItem] = useState<StyleModel | null>(null)
	const [detailVisible, setDetailVisible] = useState(false)

	// ── Derived catalog views ─────────────────────────────────────────────────
	const activeStyles = useMemo(
		() => catalog.filter((m) => m.isActive),
		[catalog]
	)

	const filteredStyles = useMemo(() => {
		return activeStyles.filter((style) => {
			const matchesSearch = style.name
				.toLowerCase()
				.includes(searchQuery.toLowerCase())

			let matchesCategory = true
			if (activeCategory === 'Downloaded') {
				matchesCategory = style.downloadStatus === 'downloaded'
			} else if (activeCategory === 'New') {
				// 'New' category: styles not yet active (coming-soon state)
				matchesCategory = !style.isActive
			}
			// 'Popular' and 'All' show everything

			return matchesSearch && matchesCategory
		})
	}, [activeStyles, searchQuery, activeCategory])

	const selectedStyle = useMemo(
		() => catalog.find((m) => m.id === selectedStyleId),
		[catalog, selectedStyleId]
	)

	// ── Pull-to-refresh manifest sync ─────────────────────────────────────────
	const handleRefresh = useCallback(async () => {
		tracker.log('Syncing manifest from server')
		setRefreshing(true)
		try {
			const result = await syncManifest({
				clientHash: clientHash ?? undefined,
			})
			if (result) {
				applyManifestUpdate(
					{ updates: result.updates, deleted: result.deleted || [] },
					result.manifestHash
				)
				setClientHash(result.manifestHash)
				tracker.log('Manifest delta sync applied to store')
			}
		} catch (error) {
			tracker.error('Manifest sync failed', error)
		} finally {
			setRefreshing(false)
		}
	}, [clientHash, applyManifestUpdate, setClientHash])

	// ── Download ───────────────────────────────────────────────────────────────
	// Reads catalog via getState() to keep function identity stable and prevent
	// re-rendering all StyleGridCard instances when unrelated catalog state changes.
	const handleDownload = useCallback(
		async (styleId: string) => {
			const model = useModelStore
				.getState()
				.catalog.find((m) => m.id === styleId)
			if (!model) return

			if (!model.previewModelUrl || !model.mainModelUrl) {
				Alert.alert(
					'Catalog Outdated',
					'Download links are missing. Please pull down to refresh.'
				)
				return
			}

			try {
				updateDownloadStatus(styleId, 'downloading')
				_writeRegistryEntry(styleId, {
					id: model.id,
					name: model.name,
					version: model.version,
					downloadStatus: 'downloading',
					previewPath: null,
					mainPath: null,
					config: { ...DEFAULT_MODEL_CONFIG, ...model.config },
					previewSize: 0,
					mainSize: 0,
				})

				await downloadStyleAssets({
					id: model.id,
					name: model.name,
					version: model.version || 1,
					description: model.description || '',
					thumbnailUrl: model.thumbnailUrl,
					fileSize: model.fileSize,
					previewModelUrl: model.previewModelUrl,
					mainModelUrl: model.mainModelUrl,
					isActive: true,
					config: model.config,
				})

				updateDownloadStatus(styleId, 'downloaded')
				tracker.log('Download complete', { styleId })
			} catch (err) {
				tracker.error('Download failed', err)
				updateDownloadStatus(styleId, 'not_downloaded')
				Alert.alert(
					'Download Interrupted',
					'Connection lost while downloading. Please try again.'
				)
			}
		},
		[updateDownloadStatus]
	)

	// ── Selection / detail sheet ───────────────────────────────────────────────
	const handleSelectStyle = useCallback((item: StyleModel) => {
		setSelectedStyleId(item.id)
		setDetailItem(item)
		setDetailVisible(true)
	}, [])

	const handleCloseDetail = useCallback(() => setDetailVisible(false), [])

	const handleDelete = useCallback(
		(styleId: string) => {
			Alert.alert(
				'Remove Style',
				'This will delete the downloaded model files from your device.',
				[
					{ text: 'Cancel', style: 'cancel' },
					{
						text: 'Remove',
						style: 'destructive',
						onPress: () => {
							updateDownloadStatus(styleId, 'not_downloaded')
							setDetailVisible(false)
						},
					},
				]
			)
		},
		[updateDownloadStatus]
	)

	// ── Apply style and navigate (when opened with a sourceUri) ───────────────
	const handleApplyStyle = useCallback(() => {
		if (!sourceUri) {
			Alert.alert('Missing Photo', 'No source photo was provided.')
			return
		}
		if (!selectedStyle || selectedStyle.downloadStatus !== 'downloaded') {
			Alert.alert('Not Downloaded', 'Please download this style first.')
			return
		}

		tracker.log('Enqueueing style job', { styleId: selectedStyle.id })
		enqueueJob({ sourceUri, styleId: selectedStyle.id })
		router.replace('/(tabs)/gallery')
	}, [sourceUri, selectedStyle, enqueueJob, router])

	// ── FlatList sub-renderers ─────────────────────────────────────────────────

	const renderHeader = useMemo(
		() => (
			<View style={styles.headerBlock}>
				<Text style={styles.pageTitle}>Choose Your Style</Text>
				<Text style={styles.pageSubtitle}>
					Transform your photos into masterpieces using AI-powered
					artist profiles.
				</Text>

				<View style={styles.infoBox}>
					<CatalogInfoItem
						icon={<Sparkles size={16} color={Colors.primary} />}
						label="AI Curated"
					/>
					<CatalogInfoItem
						icon={<Eye size={16} color={Colors.primary} />}
						label="Preview Before Download"
					/>
					<CatalogInfoItem
						icon={<Download size={16} color={Colors.primary} />}
						label="Offline Use"
					/>
				</View>

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

				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					style={styles.categoryScroll}
					contentContainerStyle={styles.categoryScrollContent}
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
			</View>
		),
		[searchQuery, activeCategory]
	)

	const renderFooter = useMemo(
		() => (
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
		),
		[]
	)

	const renderCard = useCallback(
		({ item }: { item: StyleModel }) => (
			<StyleGridCard
				item={item}
				isSelected={selectedStyleId === item.id}
				onSelect={handleSelectStyle}
				onDownload={handleDownload}
			/>
		),
		[selectedStyleId, handleSelectStyle, handleDownload]
	)

	const renderEmptyGrid = useMemo(
		() => (
			<View style={styles.emptyState}>
				<Sparkles color={Colors.textMuted} size={36} />
				<Text style={styles.emptyStateText}>
					{searchQuery
						? `No styles found matching "${searchQuery}"`
						: 'No styles available. Pull down to sync.'}
				</Text>
			</View>
		),
		[searchQuery]
	)

	return (
		<View style={styles.container}>
			<StatusBar style="dark" />

			<View
				style={[
					styles.header,
					{ paddingTop: insets.top > 0 ? insets.top : 16 },
				]}
			>
				<Text style={styles.headerTitle}>Style Explorer</Text>
			</View>

			<FlatList
				data={filteredStyles}
				renderItem={renderCard}
				keyExtractor={(item) => item.id}
				numColumns={2}
				columnWrapperStyle={
					filteredStyles.length > 0 ? styles.columnWrapper : undefined
				}
				contentContainerStyle={[
					styles.scrollContent,
					{ paddingBottom: 5 },
				]}
				ListHeaderComponent={renderHeader}
				ListFooterComponent={renderFooter}
				ListEmptyComponent={renderEmptyGrid}
				showsVerticalScrollIndicator={false}
				initialNumToRender={6}
				maxToRenderPerBatch={10}
				windowSize={5}
				removeClippedSubviews={Platform.OS === 'android'}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={handleRefresh}
						tintColor={Colors.primary}
						colors={[Colors.primary]}
					/>
				}
			/>

			{/* Sticky action bar — only shown when a style is selected with a sourceUri */}
			{sourceUri && selectedStyle && (
				<View
					style={[
						styles.actionBar,
						{ paddingBottom: Math.max(insets.bottom, 16) },
					]}
				>
					<View style={styles.actionBarDetails}>
						<Text style={styles.actionStyleName} numberOfLines={1}>
							{selectedStyle.name}
						</Text>
						<Text style={styles.actionStyleStatus}>
							{selectedStyle.downloadStatus === 'downloaded'
								? 'Ready to process'
								: 'Requires local download'}
						</Text>
					</View>

					<TouchableOpacity
						activeOpacity={0.8}
						disabled={selectedStyle.downloadStatus !== 'downloaded'}
						onPress={handleApplyStyle}
						style={[
							styles.applyButton,
							selectedStyle.downloadStatus !== 'downloaded' &&
								styles.applyButtonDisabled,
						]}
					>
						<Sparkles color="#FFF" size={16} fill="#FFF" />
						<Text style={styles.applyButtonText}>Apply Style</Text>
					</TouchableOpacity>
				</View>
			)}

			<ModelDetailSheet
				item={detailItem}
				visible={detailVisible}
				onClose={handleCloseDetail}
				onDownload={handleDownload}
				onDelete={handleDelete}
			/>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: '#FFFFFF' },

	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: H_PADDING,
		paddingBottom: 12,
		borderBottomWidth: 1,
		borderBottomColor: Colors.border,
		backgroundColor: '#FFFFFF',
	},
	headerTitle: {
		fontSize: 17,
		fontWeight: '700',
		color: Colors.text,
		top: 4,
	},

	scrollContent: { padding: H_PADDING, paddingBottom: 100 },
	headerBlock: { marginBottom: 4 },

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
		marginBottom: 24,
		lineHeight: 22,
	},

	infoBox: {
		flexDirection: 'row',
		backgroundColor: '#F8F3FF',
		borderRadius: 16,
		padding: 16,
		marginBottom: 24,
		justifyContent: 'space-around',
	},

	searchContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: Colors.borderSubtle,
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

	categoryScroll: { marginBottom: 12 },
	categoryScrollContent: { paddingRight: 20 },
	pill: {
		paddingHorizontal: 18,
		paddingVertical: 10,
		borderRadius: 25,
		backgroundColor: Colors.borderSubtle,
		marginRight: 10,
	},
	activePill: { backgroundColor: Colors.primary },
	pillText: { fontSize: 14, color: Colors.textMuted, fontWeight: '600' },
	activePillText: { color: '#FFF' },

	columnWrapper: { justifyContent: 'space-between' },

	emptyState: {
		width: '100%',
		paddingVertical: 40,
		alignItems: 'center',
		gap: 12,
	},
	emptyStateText: {
		color: Colors.textMuted,
		fontSize: 16,
		textAlign: 'center',
	},

	faqSection: {
		marginTop: 10,
		paddingTop: 24,
		borderTopWidth: 1,
		borderTopColor: Colors.border,
	},
	faqHeaderRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		marginBottom: 20,
	},
	faqHeader: { fontSize: 20, fontWeight: '800', color: Colors.text },

	actionBar: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: '#FFF',
		borderTopWidth: StyleSheet.hairlineWidth,
		borderColor: Colors.border,
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 16,
		paddingTop: 14,
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
	actionBarDetails: { flex: 1, justifyContent: 'center' },
	actionStyleName: {
		color: Colors.text,
		fontSize: 15,
		fontWeight: '700',
	},
	actionStyleStatus: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
	applyButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: Colors.primary,
		borderRadius: 12,
		paddingVertical: 13,
		paddingHorizontal: 16,
		gap: 6,
		minWidth: 140,
	},
	applyButtonDisabled: { opacity: 0.4 },
	applyButtonText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
})
