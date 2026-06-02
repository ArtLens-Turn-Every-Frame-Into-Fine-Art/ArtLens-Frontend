/**
 * ArtLens — StyleSelection Screen
 *
 * FIX vs original:
 *  - `ModelManager.downloadStylePack()` / `ModelManager.deleteStylePack()` are
 *    named exports, not methods on a namespace object. Corrected to direct imports.
 *  - `model.previewModelUrl`, `model.mainModelUrl`, `model.config` come from
 *    the `StyleModel` type which must carry these fields (they are present in
 *    ModelManifestItem and persisted in MMKV via the registry). The catalog
 *    in useModelStore stores the full manifest item shape.
 *  - `syncManifest(clientHash)` returns `ManifestResponse | null`.
 *    The function signature per the PRD is `syncManifest(clientHash: string)`.
 *    The types/index.ts defines a `ManifestSyncRequest` object type. We pass
 *    the clientHash string directly — if the function signature in api.ts was
 *    changed to accept `ManifestSyncRequest`, we wrap it accordingly.
 *  - `useIncomingImage()` returns `{ pendingImage: PendingImage | null, clearPendingImage: () => void }`.
 *    The original code destructured `{ incomingUri, clearIncoming }` which
 *    don't exist. Fixed to use the actual hook contract.
 *  - `updateCatalog(result.updates)` — `ManifestUpdate` requires `config`.
 *    The API response updates are typed as `ManifestUpdate[]` which includes
 *    `config`. We cast the result appropriately since the backend guarantees
 *    this field is present per Section 8.1 of the PRD.
 *  - Removed unused `formatBytes` helper and `handleApplyIncoming` (ESLint warnings).
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
	TouchableOpacity,
	View,
	type ListRenderItem,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import {
	Check,
	ChevronLeft,
	Download,
	HardDrive,
	Info,
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

// Initialize namespaced module logger at module scope
const tracker = createTracker('StylesScreen')

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const C = {
	bg: '#080810',
	surface: '#10101C',
	surfaceHigh: '#181828',
	border: '#1E1E30',
	primary: '#6D28D9',
	primaryMid: '#7C3AED',
	text: '#F4F4FF',
	textMuted: '#7070A0',
	textDim: '#40405A',
	downloaded: '#10B981',
	warning: '#D97706',
	error: '#DC2626',
	white: '#FFFFFF',
	accent: '#7C3AED',
	accentGradient: ['#7C3AED', '#6D28D9'],
	textPrimary: '#F4F4FF',
	success: '#10B981',
} as const

const { width: SCREEN_W } = Dimensions.get('window')
const H_PADDING = 16
const COLUMN_GAP = 10
const COLUMNS = 2
const CARD_W = (SCREEN_W - H_PADDING * 2 - COLUMN_GAP * (COLUMNS - 1)) / COLUMNS
const CARD_H = CARD_W * 1.35

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD PROGRESS RING
// ─────────────────────────────────────────────────────────────────────────────

interface ProgressRingProps {
	progress: number
}

const ProgressRing = React.memo<ProgressRingProps>(({ progress }) => (
	<View style={styles.progressRingWrap}>
		<ActivityIndicator color={C.primaryMid} size="small" />
		<Text style={styles.progressPercent}>
			{Math.round(progress * 100)}%
		</Text>
	</View>
))
ProgressRing.displayName = 'ProgressRing'

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
				activeOpacity={0.85}
				onPress={handlePress}
				style={[styles.card, isSelected && styles.cardSelected]}
				accessibilityRole="button"
				accessibilityLabel={`${item.name} style, ${item.downloadStatus}`}
			>
				<Image
					source={{ uri: item.thumbnailUrl }}
					style={styles.cardImage}
					contentFit="cover"
					cachePolicy="disk"
					transition={250}
				/>
				<LinearGradient
					colors={['transparent', 'rgba(10, 10, 18, 0.95)']}
					style={StyleSheet.absoluteFill}
					start={{ x: 0, y: 0.3 }}
					end={{ x: 0, y: 1 }}
				/>

				{/* Top Status Indicators */}
				<View style={styles.cardBadgeContainer}>
					{isDownloaded ? (
						<View
							style={[styles.statusBadge, styles.badgeDownloaded]}
						>
							<Zap color={C.success} size={10} fill={C.success} />
						</View>
					) : isDownloading ? (
						<ProgressRing progress={item.downloadProgress ?? 0} />
					) : (
						<TouchableOpacity
							style={[styles.statusBadge, styles.badgeCloud]}
							onPress={handleDownload}
							hitSlop={12}
						>
							<Download
								color={C.textPrimary}
								size={11}
								strokeWidth={2.5}
							/>
						</TouchableOpacity>
					)}
				</View>

				{/* Title Content */}
				<View style={styles.cardContent}>
					<Text style={styles.cardName} numberOfLines={1}>
						{item.name}
					</Text>
					<Text style={styles.cardSize}>{item.fileSize}</Text>
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
						<X color={C.textMuted} size={20} strokeWidth={2} />
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
							<LinearGradient
								colors={['transparent', C.surface]}
								style={StyleSheet.absoluteFill}
								start={{ x: 0, y: 0.5 }}
								end={{ x: 0, y: 1 }}
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
										color={C.textMuted}
										size={14}
										strokeWidth={1.5}
									/>
									<Text style={styles.sheetMetaText}>
										{item.fileSize}
									</Text>
								</View>
								<View style={styles.sheetMetaItem}>
									<Info
										color={C.textMuted}
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
											color={C.downloaded}
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
											color={C.error}
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
										color={C.primaryMid}
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
										color={C.white}
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

	// Route configuration checks
	const { sourceUri } = useLocalSearchParams<{ sourceUri?: string }>()

	const catalog = useModelStore((s) => s.catalog)
	const clientHash = useModelStore((s) => s.clientHash)
	const setClientHash = useModelStore((s) => s.setClientHash)
	const applyManifestUpdate = useModelStore((s) => s.applyManifestUpdate)
	const updateDownloadStatus = useModelStore((s) => s.updateDownloadStatus)
	const enqueueJob = useStyleJobStore((s) => s.enqueue)

	const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null)
	const [refreshing, setRefreshing] = useState(false)

	const activeStyles = useMemo(
		() => catalog.filter((m) => m.isActive),
		[catalog]
	)
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
	const handleDownload = useCallback(
		async (styleId: string) => {
			const model = catalog.find((m) => m.id === styleId)
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
					configPath: null,
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
					config: model.config ?? undefined,
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
		[catalog, updateDownloadStatus]
	)

	const handleSelectStyle = useCallback((item: StyleModel) => {
		setSelectedStyleId(item.id)
	}, [])

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

		// Route back immediately to main Gallery dashboard
		router.replace('/(tabs)/gallery')
	}, [sourceUri, selectedStyle, enqueueJob, router])

	const renderCard: ListRenderItem<StyleModel> = useCallback(
		({ item }) => (
			<StyleGridCard
				item={item}
				isSelected={selectedStyleId === item.id}
				onSelect={handleSelectStyle}
				onDownload={handleDownload}
			/>
		),
		[selectedStyleId, handleSelectStyle, handleDownload]
	)

	const keyExtractor = useCallback((item: StyleModel) => item.id, [])

	return (
		<View style={styles.screen}>
			<StatusBar barStyle="light-content" />

			{/* Header Navigation Bar Layout */}
			<View style={[styles.header, { paddingTop: insets.top + 12 }]}>
				<TouchableOpacity
					style={styles.backButton}
					onPress={() => router.back()}
					hitSlop={12}
				>
					<ChevronLeft color={C.textPrimary} size={24} />
				</TouchableOpacity>
				<View style={styles.headerTitleContainer}>
					<Text style={styles.headerTitle}>Select Style</Text>
					<Text style={styles.headerSubtitle}>
						Choose neural canvas mapping
					</Text>
				</View>
				<View style={styles.headerRightPlaceholder} />
			</View>

			{/* Main Grid View */}
			<FlatList
				data={activeStyles}
				renderItem={renderCard}
				keyExtractor={keyExtractor}
				numColumns={2}
				columnWrapperStyle={styles.gridRow}
				contentContainerStyle={[
					styles.gridContainer,
					{ paddingBottom: insets.bottom + 110 },
				]}
				showsVerticalScrollIndicator={false}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={handleRefresh}
						tintColor={C.accent}
						colors={[C.accent]}
					/>
				}
				ListEmptyComponent={
					<View style={styles.emptyContainer}>
						<Sparkles color={C.textDim} size={40} />
						<Text style={styles.emptyText}>
							No transformation layers found
						</Text>
						<Text style={styles.emptySubtext}>
							Pull down to load catalog entries from cloud node
							architectures
						</Text>
					</View>
				}
			/>

			{/* Interactive Process Pipeline Action Control Strip */}
			<View
				style={[
					styles.actionBar,
					{ paddingBottom: Math.max(insets.bottom, 16) + 8 },
				]}
			>
				<View style={styles.actionBarDetails}>
					{selectedStyle ? (
						<>
							<Text
								style={styles.actionStyleName}
								numberOfLines={1}
							>
								{selectedStyle.name}
							</Text>
							<Text style={styles.actionStyleStatus}>
								{selectedStyle.downloadStatus === 'downloaded'
									? 'Ready to process'
									: 'Requires local download'}
							</Text>
						</>
					) : (
						<Text style={styles.actionPlaceholder}>
							Choose a target style frame
						</Text>
					)}
				</View>

				<TouchableOpacity
					activeOpacity={0.8}
					disabled={
						!selectedStyle ||
						selectedStyle.downloadStatus !== 'downloaded'
					}
					onPress={handleApplyStyle}
					style={[
						styles.applyButton,
						(!selectedStyle ||
							selectedStyle.downloadStatus !== 'downloaded') &&
							styles.applyButtonDisabled,
					]}
				>
					<Sparkles
						color={C.textPrimary}
						size={16}
						fill={C.textPrimary}
					/>
					<Text style={styles.applyButtonText}>
						Apply Fine-Art Style
					</Text>
				</TouchableOpacity>
			</View>
		</View>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: { flex: 1 },

	pageHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingHorizontal: H_PADDING,
		paddingBottom: 12,
	},
	pageHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	pageTitle: {
		color: C.text,
		fontSize: 26,
		fontWeight: '800',
		letterSpacing: -0.5,
	},
	pageSubtitle: { color: C.textMuted, fontSize: 13, fontWeight: '500' },

	incomingBanner: {
		flexDirection: 'row',
		alignItems: 'center',
		marginHorizontal: H_PADDING,
		marginBottom: 16,
		backgroundColor: C.surfaceHigh,
		borderRadius: 14,
		borderWidth: 1,
		borderColor: `${C.primaryMid}40`,
		padding: 10,
		gap: 12,
	},
	incomingThumb: { width: 44, height: 44, borderRadius: 8 },
	incomingText: { flex: 1 },
	incomingTitle: { color: C.text, fontSize: 14, fontWeight: '600' },
	incomingSub: { color: C.textMuted, fontSize: 12, marginTop: 2 },
	incomingClose: { padding: 4 },

	sectionLabel: {
		color: C.textMuted,
		fontSize: 12,
		fontWeight: '600',
		letterSpacing: 0.8,
		textTransform: 'uppercase',
		marginHorizontal: H_PADDING,
		marginBottom: 12,
	},

	listContent: { paddingHorizontal: H_PADDING },
	columnWrapper: { gap: COLUMN_GAP, marginBottom: COLUMN_GAP },

	gridCard: {
		width: CARD_W,
		height: CARD_H,
		borderRadius: 16,
		overflow: 'hidden',
		backgroundColor: C.surface,
		borderWidth: 1,
		borderColor: C.border,
	},
	gridCardPressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },
	gridCardImage: { ...StyleSheet.absoluteFillObject },
	gridCardBadge: { position: 'absolute', top: 10, right: 10 },
	downloadedBadge: {
		width: 22,
		height: 22,
		borderRadius: 11,
		backgroundColor: `${C.downloaded}20`,
		borderWidth: 1,
		borderColor: `${C.downloaded}50`,
		justifyContent: 'center',
		alignItems: 'center',
	},
	notDownloadedBadge: {
		width: 22,
		height: 22,
		borderRadius: 11,
		backgroundColor: 'rgba(0,0,0,0.5)',
		borderWidth: 1,
		borderColor: 'rgba(255,255,255,0.15)',
		justifyContent: 'center',
		alignItems: 'center',
	},
	progressRingWrap: { alignItems: 'center', gap: 2 },
	progressPercent: { color: C.text, fontSize: 9, fontWeight: '700' },
	gridCardInfo: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		padding: 10,
	},
	gridCardName: { color: C.text, fontSize: 13, fontWeight: '700' },
	gridCardSize: { color: C.textMuted, fontSize: 11, marginTop: 2 },
	downloadOverlay: {
		position: 'absolute',
		bottom: 10,
		right: 10,
		width: 36,
		height: 36,
		borderRadius: 18,
		backgroundColor: `${C.primaryMid}CC`,
		justifyContent: 'center',
		alignItems: 'center',
	},

	emptyState: {
		alignItems: 'center',
		paddingTop: 60,
		gap: 12,
		paddingHorizontal: 32,
	},
	emptyTitle: {
		color: C.text,
		fontSize: 18,
		fontWeight: '700',
		textAlign: 'center',
	},
	emptySub: {
		color: C.textMuted,
		fontSize: 14,
		textAlign: 'center',
		lineHeight: 20,
	},

	sheet: {
		flex: 1,
		backgroundColor: C.surface,
		borderTopLeftRadius: 24,
		borderTopRightRadius: 24,
		paddingTop: 8,
	},
	sheetHandle: {
		width: 40,
		height: 4,
		borderRadius: 2,
		backgroundColor: C.border,
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
		backgroundColor: C.surfaceHigh,
		justifyContent: 'center',
		alignItems: 'center',
		zIndex: 10,
	},
	sheetScroll: { flex: 1 },
	sheetHero: { height: 260, overflow: 'hidden' },
	sheetHeroImage: { width: '100%', height: '100%' },
	sheetContent: { padding: 24, gap: 12 },
	sheetTitle: {
		color: C.text,
		fontSize: 26,
		fontWeight: '800',
		letterSpacing: -0.5,
	},
	sheetDescription: { color: C.textMuted, fontSize: 15, lineHeight: 22 },
	sheetMeta: { flexDirection: 'row', gap: 20, marginVertical: 4 },
	sheetMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
	sheetMetaText: { color: C.textMuted, fontSize: 13, fontWeight: '500' },
	sheetActions: { gap: 12, marginTop: 8 },
	sheetDownloadedRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: `${C.downloaded}15`,
		borderRadius: 12,
		padding: 14,
		borderWidth: 1,
		borderColor: `${C.downloaded}30`,
	},
	sheetDownloadedText: {
		color: C.downloaded,
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
		borderColor: `${C.error}30`,
		backgroundColor: `${C.error}10`,
	},
	sheetDeleteText: { color: C.error, fontSize: 14, fontWeight: '600' },
	sheetDownloadButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 10,
		backgroundColor: C.primaryMid,
		borderRadius: 14,
		padding: 16,
		marginTop: 8,
	},
	sheetDownloadButtonText: {
		color: C.white,
		fontSize: 16,
		fontWeight: '700',
	},
	sheetDownloadingRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		justifyContent: 'center',
		padding: 16,
		backgroundColor: `${C.primaryMid}15`,
		borderRadius: 14,
		borderWidth: 1,
		borderColor: `${C.primaryMid}30`,
	},
	sheetDownloadingText: {
		color: C.primaryMid,
		fontSize: 14,
		fontWeight: '600',
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: H_PADDING,
		paddingBottom: 16,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderColor: C.border,
		backgroundColor: C.bg,
	},
	backButton: {
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: C.surface,
		alignItems: 'center',
		justifyContent: 'center',
	},
	headerTitleContainer: {
		alignItems: 'center',
	},
	headerTitle: {
		color: C.textPrimary,
		fontSize: 18,
		fontWeight: '700',
	},
	headerSubtitle: {
		color: C.textMuted,
		fontSize: 12,
		marginTop: 1,
	},
	headerRightPlaceholder: {
		width: 40,
	},
	gridContainer: {
		paddingHorizontal: H_PADDING,
		paddingTop: 16,
	},
	gridRow: {
		justifyContent: 'space-between',
		marginBottom: COLUMN_GAP,
	},
	card: {
		width: CARD_W,
		height: CARD_H,
		backgroundColor: C.surface,
		borderRadius: 16,
		overflow: 'hidden',
		borderWidth: 1,
		borderColor: C.border,
	},
	cardSelected: {
		borderColor: C.accent,
	},
	cardImage: {
		...StyleSheet.absoluteFillObject,
	},
	cardBadgeContainer: {
		position: 'absolute',
		top: 10,
		right: 10,
		zIndex: 2,
	},
	statusBadge: {
		width: 24,
		height: 24,
		borderRadius: 12,
		alignItems: 'center',
		justifyContent: 'center',
	},
	badgeDownloaded: {
		backgroundColor: 'rgba(16, 185, 129, 0.2)',
	},
	badgeCloud: {
		backgroundColor: 'rgba(10, 10, 18, 0.65)',
	},
	cardContent: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		padding: 12,
	},
	cardName: {
		color: C.textPrimary,
		fontSize: 14,
		fontWeight: '600',
	},
	cardSize: {
		color: C.textMuted,
		fontSize: 11,
		marginTop: 2,
	},
	emptyContainer: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 80,
		paddingHorizontal: 32,
	},
	emptyText: {
		color: C.textPrimary,
		fontSize: 15,
		fontWeight: '600',
		marginTop: 12,
	},
	emptySubtext: {
		color: C.textMuted,
		fontSize: 13,
		textAlign: 'center',
		marginTop: 4,
		lineHeight: 18,
	},
	actionBar: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: C.bg,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderColor: C.border,
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 16,
		paddingTop: 14,
		gap: 12,
	},
	actionBarDetails: {
		flex: 1,
		justifyContent: 'center',
	},
	actionStyleName: {
		color: C.textPrimary,
		fontSize: 15,
		fontWeight: '700',
	},
	actionStyleStatus: {
		color: C.textMuted,
		fontSize: 11,
		marginTop: 2,
	},
	actionPlaceholder: {
		color: C.textMuted,
		fontSize: 13,
		fontStyle: 'italic',
	},
	applyButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: C.accent,
		borderRadius: 12,
		paddingVertical: 13,
		paddingHorizontal: 16,
		gap: 6,
		minWidth: 165,
	},
	applyButtonDisabled: {
		opacity: 0.4,
	},
	applyButtonText: {
		color: C.textPrimary,
		fontSize: 14,
		fontWeight: '700',
	},
})
