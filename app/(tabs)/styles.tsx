/**
 * ArtLens — StyleSelection Screen
 *
 * Performance-Optimized Edition:
 * - Converted main ScrollView container to FlatList to prevent DOM thread choking.
 * - Decoupled handleDownload from the component-scoped catalog hook using Zustand's getState()
 * to preserve strict React.memo isolation across non-downloading cards.
 */

import React, { useCallback, useMemo, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
	ActivityIndicator,
	Alert,
	Dimensions,
	FlatList,
	Modal,
	Platform,
	Pressable,
	RefreshControl,
	ScrollView,
	StatusBar,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import {
	Check,
	Download,
	Eye,
	HardDrive,
	HelpCircle,
	Info,
	Search,
	Sparkles,
	Trash2,
	X,
	Zap,
} from 'lucide-react-native'

// ── Stores / Services / Core ──────────────────────────────────────────────────
import { useModelStore } from '@/shared/stores/useModelStore'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'
import { syncManifest } from '@/services/api'
import {
	downloadStyleAssets,
	_writeRegistryEntry,
} from '@/core/storage/ModelManager'

// ── Types ─────────────────────────────────────────────────────────────────────
import type { StyleModel } from '@/types'

import { createTracker } from '@/shared/utils/logger'
import { COLORS, DEFAULT_MODEL_CONFIG } from '@/shared/utils/constants'

// Initialize namespaced module logger at module scope
const tracker = createTracker('StylesScreen')

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window')
const H_PADDING = 20
const COLUMN_GAP = 10
const COLUMNS = 2
const CARD_W = (SCREEN_W - H_PADDING * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS

const CATEGORIES = ['All', 'Popular', 'New', 'Downloaded']

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD PROGRESS RING
// ─────────────────────────────────────────────────────────────────────────────

interface ProgressRingProps {
	progress: number
}

const ProgressRing = React.memo<ProgressRingProps>(({ progress }) => (
	<View style={styles.progressRingWrap}>
		<ActivityIndicator color={COLORS.primary} size="small" />
		<Text style={styles.progressPercent}>
			{Math.round(progress * 100)}%
		</Text>
	</View>
))
ProgressRing.displayName = 'ProgressRing'

// ─────────────────────────────────────────────────────────────────────────────
// INFO ITEM
// ─────────────────────────────────────────────────────────────────────────────

interface InfoItemProps {
	icon: React.ReactNode
	label: string
}

const InfoItem = React.memo<InfoItemProps>(({ icon, label }) => (
	<View style={styles.infoItem}>
		{icon}
		<Text style={styles.infoText}>{label}</Text>
	</View>
))
InfoItem.displayName = 'InfoItem'

// ─────────────────────────────────────────────────────────────────────────────
// FAQ ITEM
// ─────────────────────────────────────────────────────────────────────────────

interface FaqItemProps {
	question: string
	answer: string
}

const FaqItem = React.memo<FaqItemProps>(({ question, answer }) => (
	<View style={styles.faqItem}>
		<Text style={styles.faqQuestion}>{question}</Text>
		<Text style={styles.faqAnswer}>{answer}</Text>
	</View>
))
FaqItem.displayName = 'FaqItem'

// ─────────────────────────────────────────────────────────────────────────────
// STYLE GRID CARD
// ─────────────────────────────────────────────────────────────────────────────

interface StyleCardProps {
	item: StyleModel
	isSelected: boolean
	onSelect: (item: StyleModel) => void
	onDownload: (id: string) => void
}

const StyleGridCard = React.memo<StyleCardProps>(
	({ item, isSelected, onSelect, onDownload }) => {
		const handlePress = useCallback(() => onSelect(item), [item, onSelect])
		const handleDownload = useCallback(
			(e: any) => {
				e.stopPropagation()
				onDownload(item.id)
			},
			[item.id, onDownload]
		)

		const isDownloaded = item.downloadStatus === 'downloaded'
		const isDownloading = item.downloadStatus === 'downloading'

		return (
			<TouchableOpacity
				activeOpacity={0.9}
				onPress={handlePress}
				style={[
					styles.styleCard,
					isSelected && styles.styleCardSelected,
				]}
				accessibilityRole="button"
				accessibilityLabel={`${item.name} style, ${item.downloadStatus}`}
			>
				{/* Thumbnail */}
				{item.thumbnailUrl ? (
					<Image
						source={{ uri: item.thumbnailUrl }}
						style={styles.styleImage}
						contentFit="cover"
						cachePolicy="disk"
						transition={250}
					/>
				) : (
					<View style={[styles.styleImage, styles.comingSoonBg]}>
						<Text style={styles.comingSoonText}>COMING SOON</Text>
					</View>
				)}

				{/* Download status badge — top-right */}
				<View style={styles.cardBadge}>
					{isDownloaded ? (
						<View style={styles.badgeDownloaded}>
							<Zap
								color={COLORS.success}
								size={10}
								fill={COLORS.success}
							/>
						</View>
					) : isDownloading ? (
						<ProgressRing progress={item.downloadProgress ?? 0} />
					) : (
						<TouchableOpacity
							style={styles.badgeCloud}
							onPress={handleDownload}
							hitSlop={12}
						>
							<Download
								color="#FFF"
								size={11}
								strokeWidth={2.5}
							/>
						</TouchableOpacity>
					)}
				</View>

				{/* Card footer */}
				<View style={styles.cardInfo}>
					<Text style={styles.styleName}>{item.name}</Text>
					<Text style={styles.styleGenre}>{item.fileSize}</Text>
				</View>
			</TouchableOpacity>
		)
	}
)
StyleGridCard.displayName = 'StyleGridCard'

// ─────────────────────────────────────────────────────────────────────────────
// MODEL DETAIL SHEET
// ─────────────────────────────────────────────────────────────────────────────

interface DetailSheetProps {
	item: StyleModel | null
	visible: boolean
	onClose: () => void
	onDownload: (id: string) => void
	onDelete: (id: string) => void
}

const ModelDetailSheet = React.memo<DetailSheetProps>(
	({ item, visible, onClose, onDownload, onDelete }) => {
		if (!item) return null

		const isDownloaded = item.downloadStatus === 'downloaded'
		const isDownloading = item.downloadStatus === 'downloading'

		return (
			<Modal
				visible={visible}
				animationType="slide"
				presentationStyle={
					Platform.OS === 'ios' ? 'pageSheet' : 'formSheet'
				}
				onRequestClose={onClose}
			>
				<View style={styles.sheet}>
					<View style={styles.sheetHandle} />
					<Pressable
						onPress={onClose}
						style={styles.sheetClose}
						accessibilityRole="button"
						accessibilityLabel="Close"
					>
						<X color={COLORS.textGray} size={20} strokeWidth={2} />
					</Pressable>

					<ScrollView
						style={styles.sheetScroll}
						showsVerticalScrollIndicator={false}
					>
						<View style={styles.sheetHero}>
							<Image
								source={{ uri: item.thumbnailUrl }}
								style={styles.sheetHeroImage}
								contentFit="cover"
								cachePolicy="disk"
							/>
						</View>

						<View style={styles.sheetContent}>
							<Text style={styles.sheetTitle}>{item.name}</Text>
							<Text style={styles.sheetDescription}>
								{item.description}
							</Text>

							<View style={styles.sheetMeta}>
								<View style={styles.sheetMetaItem}>
									<HardDrive
										color={COLORS.textGray}
										size={14}
										strokeWidth={1.5}
									/>
									<Text style={styles.sheetMetaText}>
										{item.fileSize}
									</Text>
								</View>
								<View style={styles.sheetMetaItem}>
									<Info
										color={COLORS.textGray}
										size={14}
										strokeWidth={1.5}
									/>
									<Text style={styles.sheetMetaText}>
										v{item.version}
									</Text>
								</View>
							</View>

							{isDownloaded ? (
								<View style={styles.sheetActions}>
									<View style={styles.sheetDownloadedRow}>
										<Check
											color={COLORS.success}
											size={18}
											strokeWidth={2.5}
										/>
										<Text
											style={styles.sheetDownloadedText}
										>
											Style ready
										</Text>
									</View>
									<Pressable
										onPress={() => onDelete(item.id)}
										style={styles.sheetDeleteButton}
										accessibilityRole="button"
										accessibilityLabel={`Delete ${item.name}`}
									>
										<Trash2
											color="#DC2626"
											size={16}
											strokeWidth={1.8}
										/>
										<Text style={styles.sheetDeleteText}>
											Remove from device
										</Text>
									</Pressable>
								</View>
							) : isDownloading ? (
								<View style={styles.sheetDownloadingRow}>
									<ActivityIndicator
										color={COLORS.primary}
										size="small"
									/>
									<Text style={styles.sheetDownloadingText}>
										Downloading…{' '}
										{Math.round(
											(item.downloadProgress ?? 0) * 100
										)}
										%
									</Text>
								</View>
							) : (
								<Pressable
									onPress={() => onDownload(item.id)}
									style={styles.sheetDownloadButton}
									accessibilityRole="button"
									accessibilityLabel={`Download ${item.name}`}
								>
									<Download
										color="#FFF"
										size={18}
										strokeWidth={2}
									/>
									<Text
										style={styles.sheetDownloadButtonText}
									>
										Download ({item.fileSize})
									</Text>
								</Pressable>
							)}
						</View>
					</ScrollView>
				</View>
			</Modal>
		)
	}
)
ModelDetailSheet.displayName = 'ModelDetailSheet'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function StyleSelectionScreen(): React.JSX.Element {
	const router = useRouter()
	const insets = useSafeAreaInsets()

	const { sourceUri } = useLocalSearchParams<{ sourceUri?: string }>()

	const catalog = useModelStore((s) => s.catalog)
	const clientHash = useModelStore((s) => s.clientHash)
	const setClientHash = useModelStore((s) => s.setClientHash)
	const applyManifestUpdate = useModelStore((s) => s.applyManifestUpdate)
	const updateDownloadStatus = useModelStore((s) => s.updateDownloadStatus)
	const enqueueJob = useStyleJobStore((s) => s.enqueue)

	const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const [activeCategory, setActiveCategory] = useState('All')
	const [detailItem, setDetailItem] = useState<StyleModel | null>(null)
	const [detailVisible, setDetailVisible] = useState(false)

	const activeStyles = useMemo(
		() => catalog.filter((m) => m.isActive),
		[catalog]
	)

	// Category-aware filter: map download status to old category labels
	const filteredStyles = useMemo(() => {
		return activeStyles.filter((style) => {
			const matchesSearch = style.name
				.toLowerCase()
				.includes(searchQuery.toLowerCase())

			let matchesCategory = true
			if (activeCategory === 'Downloaded') {
				matchesCategory = style.downloadStatus === 'downloaded'
			} else if (activeCategory === 'New') {
				matchesCategory = !style.isActive
			} else if (activeCategory === 'Popular') {
				matchesCategory = true
			}

			return matchesSearch && matchesCategory
		})
	}, [activeStyles, searchQuery, activeCategory])

	const selectedStyle = useMemo(
		() => catalog.find((m) => m.id === selectedStyleId),
		[catalog, selectedStyleId]
	)

	// Sync remote catalog manifests on pull-to-refresh
	const handleRefresh = useCallback(async () => {
		tracker.log('Syncing asset manifest changes from server platform')
		setRefreshing(true)
		try {
			const result = await syncManifest({
				clientHash: clientHash ?? undefined,
			})
			if (result) {
				applyManifestUpdate(
					{
						updates: result.updates,
						deleted: result.deleted || [],
					},
					result.manifestHash
				)
				setClientHash(result.manifestHash)
				tracker.log(
					'Manifest delta sync successfully integrated into store state.'
				)
			}
		} catch (error) {
			tracker.error(
				'Failed operational manifest background syncing sequence',
				error
			)
		} finally {
			setRefreshing(false)
		}
	}, [clientHash, applyManifestUpdate, setClientHash])

	// On-device download execution pipeline
	// OPTIMIZATION: Bypassed scope catalog reference to retain stable function identity during downloads
	const handleDownload = useCallback(
		async (styleId: string) => {
			const currentCatalog = useModelStore.getState().catalog
			const model = currentCatalog.find((m) => m.id === styleId)
			if (!model) return

			if (!model.previewModelUrl || !model.mainModelUrl) {
				Alert.alert(
					'Catalog Outdated',
					'Download links are missing. Please pull down to refresh catalog entries.'
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
				tracker.log(
					'Successfully completed local parameter hardware dump sync structural storage mapping',
					{ styleId }
				)
			} catch (err) {
				tracker.error(
					'Fatal crash inside asset stream network extractor compilation layers',
					err
				)
				updateDownloadStatus(styleId, 'not_downloaded')
				Alert.alert(
					'Download Interrupted',
					'Connection closed while grabbing package parameters. Try again.'
				)
			}
		},
		[updateDownloadStatus]
	)

	const handleSelectStyle = useCallback((item: StyleModel) => {
		setSelectedStyleId(item.id)
		setDetailItem(item)
		setDetailVisible(true)
	}, [])

	const handleCloseDetail = useCallback(() => {
		setDetailVisible(false)
	}, [])

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

	// Commit selected style configurations into active background engine pipelines
	const handleApplyStyle = useCallback(() => {
		if (!sourceUri) {
			Alert.alert(
				'Missing Asset Context',
				'No target file source provided to apply neural weights against.'
			)
			return
		}
		if (!selectedStyle || selectedStyle.downloadStatus !== 'downloaded') {
			Alert.alert(
				'Weights Unavailable',
				'Please download the style assets package down into local hardware layers first.'
			)
			return
		}

		tracker.log(
			'Routing parameters validated; staging dynamic core engine stylized task enqueue pass'
		)
		enqueueJob({
			sourceUri,
			styleId: selectedStyle.id,
		})

		router.replace('/(tabs)/gallery')
	}, [sourceUri, selectedStyle, enqueueJob, router])

	// ── FlatList Sub-Render Blocks to keep layout frames fully insulated ───────
	const renderHeader = useMemo(
		() => (
			<View style={styles.headerLayoutGap}>
				<Text style={styles.pageTitle}>Choose Your Style</Text>
				<Text style={styles.pageSubtitle}>
					Transform your photos into masterpieces using AI-powered
					artist profiles.
				</Text>

				{/* Info Box */}
				<View style={styles.infoBox}>
					<InfoItem
						icon={<Sparkles size={16} color={COLORS.primary} />}
						label="AI Curated"
					/>
					<InfoItem
						icon={<Eye size={16} color={COLORS.primary} />}
						label="Preview Before Download"
					/>
					<InfoItem
						icon={<Download size={16} color={COLORS.primary} />}
						label="Offline Use"
					/>
				</View>

				{/* Search Bar */}
				<View style={styles.searchContainer}>
					<Search size={20} color={COLORS.textGray} />
					<TextInput
						placeholder="Search styles..."
						style={styles.searchInput}
						value={searchQuery}
						onChangeText={setSearchQuery}
						placeholderTextColor={COLORS.textGray}
					/>
				</View>

				{/* Category Pills */}
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
					<HelpCircle size={22} color={COLORS.textMain} />
					<Text style={styles.faqHeader}>Help &amp; Tips</Text>
				</View>
				<FaqItem
					question="How do I download a new style?"
					answer="Tap on any style. If it's not in your library, the download will begin automatically."
				/>
				<FaqItem
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
				<Sparkles color={COLORS.textGray} size={36} />
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
			<StatusBar barStyle="dark-content" />

			{/* Header */}
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
				contentContainerStyle={styles.scrollContent}
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
						tintColor={COLORS.primary}
						colors={[COLORS.primary]}
					/>
				}
			/>

			{/* Action Bar — shown when a style is selected and sourceUri is present */}
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

			{/* Model Detail Sheet */}
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

	// ── Header ─────────────────────────────────────────────────────────────────
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: H_PADDING,
		paddingBottom: 12,
		borderBottomWidth: 1,
		borderBottomColor: COLORS.border,
		backgroundColor: '#FFFFFF',
	},
	headerTitle: {
		fontSize: 17,
		fontWeight: '700',
		color: COLORS.textMain,
		top: 4,
	},

	// ── Scroll ─────────────────────────────────────────────────────────────────
	scrollContent: { padding: H_PADDING, paddingBottom: 100 },
	headerLayoutGap: { marginBottom: 4 },

	// ── Page intro ─────────────────────────────────────────────────────────────
	pageTitle: {
		fontSize: 32,
		fontWeight: '800',
		color: COLORS.textMain,
		marginBottom: 8,
		letterSpacing: -0.5,
	},
	pageSubtitle: {
		fontSize: 16,
		color: COLORS.textGray,
		marginBottom: 24,
		lineHeight: 22,
	},

	// ── Info Box ───────────────────────────────────────────────────────────────
	infoBox: {
		flexDirection: 'row',
		backgroundColor: '#F8F3FF',
		borderRadius: 16,
		padding: 16,
		marginBottom: 24,
		justifyContent: 'space-around',
	},
	infoItem: { alignItems: 'center', gap: 6 },
	infoText: { fontSize: 11, fontWeight: '600', color: COLORS.primary },

	// ── Search ─────────────────────────────────────────────────────────────────
	searchContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: COLORS.border,
		borderRadius: 12,
		paddingHorizontal: 12,
		height: 48,
		marginBottom: 20,
	},
	searchInput: {
		flex: 1,
		fontSize: 16,
		marginLeft: 8,
		color: COLORS.textMain,
	},

	// ── Category Pills ─────────────────────────────────────────────────────────
	categoryScroll: { marginBottom: 12 },
	categoryScrollContent: { paddingRight: 20 },
	pill: {
		paddingHorizontal: 18,
		paddingVertical: 10,
		borderRadius: 25,
		backgroundColor: COLORS.border,
		marginRight: 10,
	},
	activePill: { backgroundColor: COLORS.primary },
	pillText: { fontSize: 14, color: COLORS.textGray, fontWeight: '600' },
	activePillText: { color: '#FFF' },

	// ── Grid ───────────────────────────────────────────────────────────────────
	columnWrapper: {
		justifyContent: 'space-between',
	},
	styleCard: {
		width: CARD_W,
		backgroundColor: '#FFF',
		borderRadius: 16,
		marginBottom: 20,
		borderWidth: 1,
		borderColor: COLORS.border,
		...Platform.select({
			ios: {
				shadowColor: '#000',
				shadowOffset: { width: 0, height: 4 },
				shadowOpacity: 0.1,
				shadowRadius: 8,
			},
			android: { elevation: 4 },
		}),
	},
	styleCardSelected: {
		borderColor: COLORS.primary,
		borderWidth: 2,
	},
	styleImage: {
		width: '100%',
		height: CARD_W,
		borderTopLeftRadius: 16,
		borderTopRightRadius: 16,
	},
	comingSoonBg: {
		backgroundColor: COLORS.textMain,
		justifyContent: 'center',
		alignItems: 'center',
	},
	comingSoonText: {
		color: '#FFF',
		fontWeight: '900',
		fontSize: 12,
		letterSpacing: 1,
	},
	cardBadge: {
		position: 'absolute',
		top: 8,
		right: 8,
	},
	badgeDownloaded: {
		width: 22,
		height: 22,
		borderRadius: 11,
		backgroundColor: `${COLORS.success}30`,
		borderWidth: 1,
		borderColor: `${COLORS.success}60`,
		justifyContent: 'center',
		alignItems: 'center',
	},
	badgeCloud: {
		width: 26,
		height: 26,
		borderRadius: 13,
		backgroundColor: 'rgba(0,0,0,0.55)',
		justifyContent: 'center',
		alignItems: 'center',
	},
	cardInfo: { padding: 12 },
	styleName: { fontSize: 16, fontWeight: '700', color: COLORS.textMain },
	styleGenre: { fontSize: 12, color: COLORS.textGray, marginTop: 2 },

	// ── Progress ring ──────────────────────────────────────────────────────────
	progressRingWrap: { alignItems: 'center', gap: 2 },
	progressPercent: {
		color: COLORS.textMain,
		fontSize: 9,
		fontWeight: '700',
	},

	// ── Empty state ────────────────────────────────────────────────────────────
	emptyState: {
		width: '100%',
		paddingVertical: 40,
		alignItems: 'center',
		gap: 12,
	},
	emptyStateText: {
		color: COLORS.textGray,
		fontSize: 16,
		textAlign: 'center',
	},

	// ── FAQ ────────────────────────────────────────────────────────────────────
	faqSection: {
		marginTop: 10,
		paddingTop: 24,
		borderTopWidth: 1,
		borderTopColor: COLORS.border,
	},
	faqHeaderRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		marginBottom: 20,
	},
	faqHeader: { fontSize: 20, fontWeight: '800', color: COLORS.textMain },
	faqItem: { marginBottom: 24 },
	faqQuestion: {
		fontSize: 16,
		fontWeight: '700',
		color: COLORS.textMain,
		marginBottom: 6,
	},
	faqAnswer: { fontSize: 14, color: COLORS.textGray, lineHeight: 20 },

	// ── Action Bar ─────────────────────────────────────────────────────────────
	actionBar: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: '#FFF',
		borderTopWidth: StyleSheet.hairlineWidth,
		borderColor: COLORS.border,
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
		color: COLORS.textMain,
		fontSize: 15,
		fontWeight: '700',
	},
	actionStyleStatus: {
		color: COLORS.textGray,
		fontSize: 11,
		marginTop: 2,
	},
	applyButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: COLORS.primary,
		borderRadius: 12,
		paddingVertical: 13,
		paddingHorizontal: 16,
		gap: 6,
		minWidth: 140,
	},
	applyButtonDisabled: { opacity: 0.4 },
	applyButtonText: { color: '#FFF', fontSize: 14, fontWeight: '700' },

	// ── Model Detail Sheet ─────────────────────────────────────────────────────
	sheet: {
		flex: 1,
		backgroundColor: '#FFFFFF',
		borderTopLeftRadius: 24,
		borderTopRightRadius: 24,
		paddingTop: 8,
	},
	sheetHandle: {
		width: 40,
		height: 4,
		borderRadius: 2,
		backgroundColor: COLORS.border,
		alignSelf: 'center',
		marginBottom: 16,
	},
	sheetClose: {
		position: 'absolute',
		top: 16,
		right: 16,
		width: 36,
		height: 36,
		borderRadius: 18,
		backgroundColor: COLORS.border,
		justifyContent: 'center',
		alignItems: 'center',
		zIndex: 10,
	},
	sheetScroll: { flex: 1 },
	sheetHero: { height: 260, overflow: 'hidden' },
	sheetHeroImage: { width: '100%', height: '100%' },
	sheetContent: { padding: 24, gap: 12 },
	sheetTitle: {
		color: COLORS.textMain,
		fontSize: 26,
		fontWeight: '800',
		letterSpacing: -0.5,
	},
	sheetDescription: { color: COLORS.textGray, fontSize: 15, lineHeight: 22 },
	sheetMeta: { flexDirection: 'row', gap: 20, marginVertical: 4 },
	sheetMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
	sheetMetaText: { color: COLORS.textGray, fontSize: 13, fontWeight: '500' },
	sheetActions: { gap: 12, marginTop: 8 },
	sheetDownloadedRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: `${COLORS.success}15`,
		borderRadius: 12,
		padding: 14,
		borderWidth: 1,
		borderColor: `${COLORS.success}30`,
	},
	sheetDownloadedText: {
		color: COLORS.success,
		fontSize: 15,
		fontWeight: '600',
	},
	sheetDeleteButton: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		justifyContent: 'center',
		padding: 14,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: '#DC262630',
		backgroundColor: '#DC262610',
	},
	sheetDeleteText: { color: '#DC2626', fontSize: 14, fontWeight: '600' },
	sheetDownloadButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 10,
		backgroundColor: COLORS.primary,
		borderRadius: 14,
		padding: 16,
		marginTop: 8,
	},
	sheetDownloadButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
	sheetDownloadingRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		justifyContent: 'center',
		padding: 16,
		backgroundColor: '#F0EDFF',
		borderRadius: 14,
		borderWidth: 1,
		borderColor: `${COLORS.primary}30`,
	},
	sheetDownloadingText: {
		color: COLORS.primary,
		fontSize: 14,
		fontWeight: '600',
	},
})
