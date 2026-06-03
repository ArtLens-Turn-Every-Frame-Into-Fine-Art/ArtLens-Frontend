/**
 * ArtLens — SettingsScreen
 *
 * Sections:
 *  1. Default Export Format  (JPEG / PNG / HEIC)
 *  2. Storage Management     (per-style on-disk size + delete)
 *  3. Hardware Profile       (benchmark results + re-run)
 *  4. About / Contact        (navigation to about-contact modal)
 *
 * FIXES vs original:
 *  - `ModelManager` and `HardwareProfiler` are named exports (functions/consts),
 *    not classes. They cannot be called as `ModelManager.getPhysicalFootprint()`.
 *    Corrected to direct named-function imports.
 *  - `getPhysicalFootprint()` is synchronous in ModelManager.ts (uses
 *    expo-file-system/next `File.size` synchronously). Removed the spurious
 *    `.then()` / async wrapper — called synchronously in a useEffect.
 *  - `runFullBenchmark()` is a named export from HardwareProfiler.ts, not a
 *    static method on a class.
 *  - `deleteStylePack()` is a named export, not a method on ModelManager object.
 *  - Removed unused `textDim` style alias at the bottom of the StyleSheet (was
 *    a dead entry never referenced by any component in this file — the `C.textDim`
 *    token is used directly inline where needed).
 *  - `handleRunBenchmark`: the intermediate `firstModelPath` variable was always
 *    `null` regardless of whether models are downloaded (both branches assigned
 *    `null`). Simplified to pass `null` directly, matching the `runFullBenchmark`
 *    signature which accepts `string | null`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Switch,
	Text,
	View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import {
	Check,
	ChevronRight,
	CloudOff,
	Cpu,
	FileImage,
	HardDrive,
	Info,
	MessageCircle,
	RefreshCw,
	Settings,
	ShieldCheck,
	Sparkles,
	Trash2,
	User,
	Zap,
} from 'lucide-react-native'
import { useShallow } from 'zustand/shallow'

// ── Stores ────────────────────────────────────────────────────────────────────
import { useModelStore } from '@/shared/stores/useModelStore'
import { useHardwareProfileStore } from '@/shared/stores/useHardwareProfileStore'

// ── Core — named function imports (NOT class static methods) ──────────────────
import {
	getPhysicalFootprint,
	deleteStyleAssets,
} from '@/core/storage/ModelManager'
import {
	runFullBenchmark,
	estimateLiveFPS,
	HardwareProfile,
} from '@/core/hardware/HardwareProfiler'

// ── Types ─────────────────────────────────────────────────────────────────────
import type { StyleModel, ExportFormat } from '@/types'

import { createTracker } from '@/shared/utils/logger'

// Initialize namespaced module logger at module scope
const tracker = createTracker('SettingsScreen')

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const C = {
	bg: '#F8F9FB', // Soft off-white background
	surface: '#FFFFFF', // Pure white main cards
	surfaceHigh: '#F2F2F7', // Light high surface for chips and inputs
	border: '#E5E5EA', // Subtle light gray border split line
	primary: '#7B61FF', // Core brand purple
	primaryMid: '#7B61FF', // Unified with core purple
	text: '#1C1C1E', // Dark charcoal for high contrast text
	textMuted: '#8E8E93', // Standard medium gray for subtext
	textDim: '#AEAEB2', // Lighter muted text
	downloaded: '#4CD964', // iOS success green
	warning: '#FF9F0A', // Vibrant orange warning accent
	error: '#FF7675', // Pastel coral/pink red tone
	white: '#FFFFFF',
} as const

const EXPORT_FORMATS: ExportFormat[] = ['JPEG', 'JPG', 'PNG', 'HEIC', 'HEIF']

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
	if (bytes <= 0) return '0 B'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`
	return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}

function formatRelativeDate(ts: number): string {
	const diff = Date.now() - ts
	if (diff < 0) return 'just now'
	const minutes = Math.floor(diff / 60_000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours}h ago`
	return `${Math.floor(hours / 24)}d ago`
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
	title,
	children,
}) => (
	<View style={styles.section}>
		<Text style={styles.sectionTitle}>{title}</Text>
		<View style={styles.sectionCard}>{children}</View>
	</View>
)

interface RowProps {
	icon: React.ReactNode
	label: string
	right?: React.ReactNode
	onPress?: () => void
	danger?: boolean
	noBorder?: boolean
}

const Row = React.memo<RowProps>(
	({ icon, label, right, onPress, danger, noBorder }) => {
		const content = (
			<>
				<View style={styles.rowLeft}>
					<View
						style={[styles.rowIcon, danger && styles.rowIconDanger]}
					>
						{icon}
					</View>
					<Text
						style={[
							styles.rowLabel,
							danger && styles.rowLabelDanger,
						]}
					>
						{label}
					</Text>
				</View>
				<View style={styles.rowRight}>
					{right}
					{onPress && !right && (
						<ChevronRight
							color={C.textDim}
							size={16}
							strokeWidth={1.5}
						/>
					)}
				</View>
			</>
		)

		if (onPress) {
			return (
				<Pressable
					onPress={onPress}
					style={({ pressed }) => [
						styles.row,
						!noBorder && styles.rowBorder,
						pressed && styles.rowPressed,
					]}
					accessibilityRole="button"
					accessibilityLabel={label}
				>
					{content}
				</Pressable>
			)
		}

		return (
			<View style={[styles.row, !noBorder && styles.rowBorder]}>
				{content}
			</View>
		)
	}
)
Row.displayName = 'Row'

// ── Export Format Picker ──────────────────────────────────────────────────────

interface FormatPickerProps {
	selected: ExportFormat
	onSelect: (f: ExportFormat) => void
}

const FormatPicker = React.memo<FormatPickerProps>(({ selected, onSelect }) => (
	<View style={styles.formatPicker}>
		{EXPORT_FORMATS.map((fmt, i) => (
			<Pressable
				key={fmt}
				onPress={() => onSelect(fmt)}
				style={[
					styles.formatChip,
					selected === fmt && styles.formatChipSelected,
					i === 0 && styles.formatChipFirst,
					i === EXPORT_FORMATS.length - 1 && styles.formatChipLast,
				]}
				accessibilityRole="radio"
				accessibilityState={{ checked: selected === fmt }}
				accessibilityLabel={`${fmt} format`}
			>
				{selected === fmt && (
					<Check color={C.white} size={12} strokeWidth={3} />
				)}
				<Text
					style={[
						styles.formatChipText,
						selected === fmt && styles.formatChipTextSelected,
					]}
				>
					{fmt}
				</Text>
			</Pressable>
		))}
	</View>
))
FormatPicker.displayName = 'FormatPicker'

// ── Storage Row ───────────────────────────────────────────────────────────────

interface StorageRowProps {
	model: StyleModel
	catalog: StyleModel[]
	setCatalog: (catalog: StyleModel[]) => void
}

const StorageRow = React.memo<StorageRowProps>(
	({ model, catalog, setCatalog }) => {
		const [sizeBytes, setSizeBytes] = useState<number>(0)

		useEffect(() => {
			const timer = setTimeout(() => {
				try {
					setSizeBytes(getPhysicalFootprint(model.id))
				} catch {
					setSizeBytes(0)
				}
			}, 0)
			return () => clearTimeout(timer)
		}, [model.id, model.downloadStatus]) // Depend on status to update size recalculations instantly post-deletion

		const handleDelete = useCallback(() => {
			// 1. Evict assets from physical storage partitions
			try {
				deleteStyleAssets(model.id)

				// 2. Map the new state collection array
				const updated = catalog.map((m) =>
					m.id === model.id
						? { ...m, downloadStatus: 'not_downloaded' as const }
						: m
				)

				// 3. Fire the updated collection to the parent's Zustand dispatcher callback
				setCatalog(updated)
			} catch (error: any) {
				tracker.error('Physical disk partition eviction fault', error)
				Alert.alert('Error', 'Physical disk partition eviction fault.')
			}
		}, [model.id, catalog, setCatalog])

		return (
			<Row
				icon={
					<HardDrive
						color={C.textMuted}
						size={16}
						strokeWidth={1.5}
					/>
				}
				label={model.name}
				onPress={handleDelete}
				right={
					<View style={styles.storageRowRight}>
						<Text style={styles.storageSize}>
							{formatBytes(sizeBytes)}
						</Text>
						<View style={styles.deleteIcon}>
							<Trash2
								color={C.error}
								size={14}
								strokeWidth={1.8}
							/>
						</View>
					</View>
				}
			/>
		)
	}
)
StorageRow.displayName = 'StorageRow'

// ── Hardware Tier Badge ───────────────────────────────────────────────────────

const TierBadge: React.FC<{ tier: 1 | 2 }> = ({ tier }) => (
	<View style={[styles.tierBadge, tier === 1 && styles.tierBadge1]}>
		<Zap
			color={tier === 1 ? C.downloaded : C.warning}
			size={10}
			strokeWidth={2}
			fill={tier === 1 ? C.downloaded : C.warning}
		/>
		<Text
			style={[styles.tierBadgeText, tier === 1 && styles.tierBadgeText1]}
		>
			Tier {tier}
		</Text>
	</View>
)

// ── Toggle Row ────────────────────────────────────────────────────────────────

interface ToggleRowProps {
	icon: React.ReactNode
	label: string
	subtitle?: string
	value: boolean
	onValueChange: (val: boolean) => void
	noBorder?: boolean
}

const ToggleRow = React.memo<ToggleRowProps>(
	({ icon, label, subtitle, value, onValueChange, noBorder }) => (
		<View
			style={[
				styles.row,
				styles.toggleRow,
				!noBorder && styles.rowBorder,
			]}
		>
			<View style={styles.rowLeft}>
				<View style={styles.rowIcon}>{icon}</View>
				<View style={styles.toggleLabelBlock}>
					<Text style={styles.rowLabel}>{label}</Text>
					{subtitle && (
						<Text style={styles.toggleSubtitle}>{subtitle}</Text>
					)}
				</View>
			</View>
			<Switch
				value={value}
				onValueChange={onValueChange}
				trackColor={{ false: C.border, true: C.primaryMid }}
				thumbColor={Platform.OS === 'ios' ? undefined : C.white}
			/>
		</View>
	)
)
ToggleRow.displayName = 'ToggleRow'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN

// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// ── Stores ───────────────────────────────────────────────────────────────────
	const catalog = useModelStore(useShallow((s) => s.catalog))
	const setGlobalCatalog = useModelStore((s) => s.updateCatalog)
	const exportFormat = useModelStore(useShallow((s) => s.exportFormat))
	const setExportFormat = useModelStore(useShallow((s) => s.setExportFormat))
	//const updateDownloadStatus = useModelStore(useShallow((s) => s.updateDownloadStatus))

	// Use the real updateCatalog action from useModelStore.
	// The previous code used `(s as any).setCatalog` which does not exist on the
	// store — it silently resolved to a no-op, so deleting a model never updated
	// the displayed list until a full app restart.
	const setCatalog = useModelStore((s) => s.updateCatalog)

	// ── Old-screen toggle states ─────────────────────────────────────────────────
	const [performanceMode, setPerformanceMode] = useState(true)
	const [highQuality, setHighQuality] = useState(false)
	const [offlineUsage, setOfflineUsage] = useState(false)

	const [profile, setProfile] = useState<HardwareProfile | null>(null)
	const isBenchmarking = useHardwareProfileStore((s) => s.isBenchmarking)
	const setIsBenchmarking = useHardwareProfileStore(
		(s) => s.setIsBenchmarking
	)

	// ── Downloaded models ────────────────────────────────────────────────────────
	const downloadedModels = useMemo(
		() => catalog.filter((m) => m.downloadStatus === 'downloaded'),
		[catalog]
	)

	// ── Total storage — sum synchronous getPhysicalFootprint across all models ────
	const [totalBytes, setTotalBytes] = useState(0)

	useEffect(() => {
		const timer = setTimeout(() => {
			try {
				const total = downloadedModels.reduce(
					(acc, m) => acc + getPhysicalFootprint(m.id),
					0
				)
				setTotalBytes(total)
			} catch {
				setTotalBytes(0)
			}
		}, 0)
		return () => clearTimeout(timer)
	}, [downloadedModels])

	// ── Estimated live FPS from profile ──────────────────────────────────────────
	const estimatedFPS = useMemo(
		() => (profile ? estimateLiveFPS(profile) : null),
		[profile]
	)

	// ── Handlers ─────────────────────────────────────────────────────────────────

	const handleFormatSelect = useCallback(
		(fmt: ExportFormat) => {
			tracker.log('Default export asset compression type updated', {
				selectedFormat: fmt,
			})
			setExportFormat(fmt)
		},
		[setExportFormat]
	)

	const handleDeleteModel = useCallback(
		(styleId: string) => {
			const model = catalog.find((m) => m.id === styleId)
			if (!model) return

			tracker.log('Initiating local storage cache deletion sequence', {
				styleId,
			})

			Alert.alert(
				`Remove "${model.name}"?`,
				'This style will be removed from your device. You can re-download it later.',
				[
					{ text: 'Cancel', style: 'cancel' },
					{
						text: 'Remove',
						style: 'destructive',
						onPress: async () => {
							try {
								// Execute local purge sequence from physical storage
								deleteStyleAssets(styleId)

								tracker.log(
									'Storage pack deleted successfully from disk space storage',
									{ styleId }
								)

								const updated = catalog.map((m) =>
									m.id === styleId
										? {
												...m,
												downloadStatus:
													'not_downloaded' as const,
											}
										: m
								)

								// 3. Bubble up the updated collection directly to the Zustand state engine
								setCatalog(updated)
							} catch (err) {
								tracker.error(
									'Failed to purge style pack from disk space',
									err
								)
								Alert.alert(
									'Error',
									'Failed to remove the style. Please try again.'
								)
							}
						},
					},
				]
			)
		},
		[catalog, setCatalog]
	)

	const handleRunBenchmark = useCallback(async () => {
		if (isBenchmarking) return

		Alert.alert(
			'Run Hardware Benchmark',
			"This will test your device's AI capabilities. The app may be briefly unresponsive.",
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Run',
					onPress: async () => {
						tracker.log(
							'Launching hardware profiler engine suite baseline check'
						)
						setIsBenchmarking(true)
						try {
							const result = await runFullBenchmark(null)
							tracker.log(
								'Hardware profile evaluation completed successfully',
								{ score: result.benchmarkedAt }
							)
							setProfile(result)
						} catch (err) {
							tracker.error(
								'Hardware profile analysis exception pipeline error',
								err
							)
							Alert.alert(
								'Benchmark failed',
								'Could not complete hardware test. Please try again.'
							)
						} finally {
							setIsBenchmarking(false)
						}
					},
				},
			]
		)
	}, [isBenchmarking, setIsBenchmarking])

	const combinedScrollStyle = useMemo(
		() => [
			styles.scrollContent,
			{
				paddingTop: insets.top + 16,
				paddingBottom: insets.bottom + 96,
			},
		],
		[insets.top, insets.bottom]
	)

	const handleAboutContact = useCallback(() => {
		tracker.debug(
			'Routing viewport context out to information profile modal overlay'
		)
		router.push('/(screens)/about-contact')
	}, [])

	return (
		<ScrollView
			style={[styles.screen, { backgroundColor: C.bg }]}
			contentContainerStyle={combinedScrollStyle}
			showsVerticalScrollIndicator={false}
		>
			{/* Page header */}
			<View style={styles.pageHeader}>
				<Settings color={C.primaryMid} size={22} strokeWidth={1.6} />
				<Text style={styles.pageTitle}>Settings</Text>
			</View>

			{/* ── 0. Account ───────────────────────────────────────────────── */}
			<Section title="Account">
				<Row
					icon={
						<User
							color={C.primaryMid}
							size={16}
							strokeWidth={1.5}
						/>
					}
					label="Pro Plan"
					right={<Text style={styles.accountBadge}>Manage</Text>}
					onPress={() => {}}
					noBorder
				/>
			</Section>

			{/* ── Performance & Quality ─────────────────────────────────────── */}
			<Section title="Performance &amp; Quality">
				<ToggleRow
					icon={<Zap color="#FFD60A" size={16} strokeWidth={1.5} />}
					label="Performance Mode"
					subtitle="Prioritize speed over detail"
					value={performanceMode}
					onValueChange={setPerformanceMode}
				/>
				<ToggleRow
					icon={
						<Sparkles color="#FF9F0A" size={16} strokeWidth={1.5} />
					}
					label="Ultra Res Output"
					subtitle="Render in 4K resolution"
					value={highQuality}
					onValueChange={setHighQuality}
					noBorder
				/>
			</Section>

			{/* ── Data & Storage (quick-access toggles) ────────────────────── */}
			<Section title="Data &amp; Storage">
				<ToggleRow
					icon={
						<CloudOff color="#30B0C7" size={16} strokeWidth={1.5} />
					}
					label="Offline Mode"
					subtitle="Process without internet"
					value={offlineUsage}
					onValueChange={setOfflineUsage}
				/>
				<Row
					icon={
						<HardDrive
							color={C.downloaded}
							size={16}
							strokeWidth={1.5}
						/>
					}
					label="Clear Cache"
					right={<Text style={styles.cacheLabel}>Used: 124 MB</Text>}
					onPress={() => {}}
					noBorder
				/>
			</Section>

			{/* ── 1. Export Format ─────────────────────────────────────────────── */}
			<Section title="Default export format">
				<View style={styles.formatSection}>
					<View style={styles.formatHeader}>
						<FileImage
							color={C.textMuted}
							size={16}
							strokeWidth={1.5}
						/>
						<Text style={styles.formatLabel}>Save photos as</Text>
					</View>
					<FormatPicker
						selected={exportFormat}
						onSelect={handleFormatSelect}
					/>
					<Text style={styles.formatNote}>
						{exportFormat === 'HEIC' || exportFormat === 'HEIF'
							? 'HEIC/HEIF: smallest file size, Apple devices. May not open on Windows without conversion.'
							: exportFormat === 'PNG'
								? 'PNG: lossless quality, larger files.'
								: 'JPEG/JPG: universal compatibility, compressed.'}
					</Text>
				</View>
			</Section>

			{/* ── 2. Storage Management ────────────────────────────────────────── */}
			<Section title="Storage management">
				{downloadedModels.length === 0 ? (
					<View style={styles.emptyRow}>
						<Text style={styles.emptyRowText}>
							No styles downloaded yet.
						</Text>
					</View>
				) : (
					downloadedModels.map((model) => (
						<StorageRow
							key={model.id}
							model={model}
							catalog={catalog}
							setCatalog={setGlobalCatalog}
						/>
					))
				)}

				{downloadedModels.length > 0 && (
					<View style={[styles.row, styles.totalRow]}>
						<View style={styles.rowLeft}>
							<View style={styles.rowIcon}>
								<HardDrive
									color={C.primaryMid}
									size={16}
									strokeWidth={1.5}
								/>
							</View>
							<Text style={styles.rowLabel}>
								Total space used
							</Text>
						</View>
						<Text style={styles.totalBytes}>
							{formatBytes(totalBytes)}
						</Text>
					</View>
				)}
			</Section>

			{/* ── 3. Hardware Profile ──────────────────────────────────────────── */}
			<Section title="Hardware profile">
				{profile ? (
					<>
						<Row
							icon={
								<Cpu
									color={C.textMuted}
									size={16}
									strokeWidth={1.5}
								/>
							}
							label="Device tier"
							right={<TierBadge tier={profile.tier} />}
						/>
						<Row
							icon={
								<Zap
									color={C.textMuted}
									size={16}
									strokeWidth={1.5}
								/>
							}
							label="Live inference delegate"
							right={
								<Text style={styles.delegateText}>
									{profile.preferredLiveDelegate.toUpperCase()}
								</Text>
							}
						/>
						<Row
							icon={
								<Zap
									color={C.textMuted}
									size={16}
									strokeWidth={1.5}
								/>
							}
							label="Background delegate"
							right={
								<Text style={styles.delegateText}>
									{profile.preferredMainDelegate.toUpperCase()}
								</Text>
							}
						/>
						{estimatedFPS !== null && (
							<Row
								icon={
									<Zap
										color={C.textMuted}
										size={16}
										strokeWidth={1.5}
									/>
								}
								label="Estimated live FPS"
								right={
									<Text style={styles.delegateText}>
										{estimatedFPS} FPS
									</Text>
								}
							/>
						)}
						<Row
							icon={
								<Info
									color={C.textMuted}
									size={16}
									strokeWidth={1.5}
								/>
							}
							label="Last benchmarked"
							right={
								<Text style={styles.benchmarkDate}>
									{formatRelativeDate(profile.benchmarkedAt)}
								</Text>
							}
							noBorder
						/>
					</>
				) : (
					<View style={styles.emptyRow}>
						<Text style={styles.emptyRowText}>
							No benchmark data. Run one below.
						</Text>
					</View>
				)}

				<Pressable
					onPress={handleRunBenchmark}
					disabled={isBenchmarking}
					style={[
						styles.benchmarkButton,
						isBenchmarking && styles.benchmarkButtonDisabled,
					]}
					accessibilityRole="button"
					accessibilityLabel="Run hardware benchmark"
					accessibilityState={{ disabled: isBenchmarking }}
				>
					{isBenchmarking ? (
						<ActivityIndicator color={C.white} size="small" />
					) : (
						<RefreshCw color={C.white} size={16} strokeWidth={2} />
					)}
					<Text style={styles.benchmarkButtonText}>
						{isBenchmarking
							? 'Benchmarking…'
							: 'Run Hardware Benchmark'}
					</Text>
				</Pressable>
			</Section>

			{/* ── 4. About & Contact ──────────────────────────────────────────── */}
			<Section title="About">
				<Row
					icon={
						<ShieldCheck
							color={C.primaryMid}
							size={16}
							strokeWidth={1.5}
						/>
					}
					label="Privacy Policy"
					onPress={() => {}}
				/>
				<Row
					icon={
						<MessageCircle
							color={C.textMuted}
							size={16}
							strokeWidth={1.5}
						/>
					}
					label="Contact Us"
					onPress={handleAboutContact}
					noBorder
				/>
			</Section>

			<Text style={styles.versionFooter}>
				ArtLens · F25SE004 · University of Central Punjab
			</Text>
		</ScrollView>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	screen: { flex: 1 },
	scrollContent: { paddingHorizontal: 20 },

	pageHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		marginBottom: 28,
	},
	pageTitle: {
		color: C.text,
		fontSize: 26,
		fontWeight: '800',
		letterSpacing: -0.5,
	},

	section: { marginBottom: 28 },
	sectionTitle: {
		color: C.textMuted,
		fontSize: 11,
		fontWeight: '700',
		letterSpacing: 0.8,
		textTransform: 'uppercase',
		marginBottom: 10,
	},
	sectionCard: {
		backgroundColor: C.surface,
		borderRadius: 16,
		borderWidth: 1,
		borderColor: C.border,
		overflow: 'hidden',
	},

	row: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 16,
		paddingVertical: 14,
		minHeight: 52,
	},
	rowBorder: {
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: C.border,
	},
	rowPressed: { backgroundColor: C.surfaceHigh },
	rowLeft: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		flex: 1,
	},
	rowIcon: {
		width: 32,
		height: 32,
		borderRadius: 8,
		backgroundColor: C.surfaceHigh,
		justifyContent: 'center',
		alignItems: 'center',
	},
	rowIconDanger: { backgroundColor: `${C.error}15` },
	rowLabel: { color: C.text, fontSize: 15, fontWeight: '500', flex: 1 },
	rowLabelDanger: { color: C.error },
	rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

	formatSection: { padding: 16, gap: 14 },
	formatHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	formatLabel: { color: C.textMuted, fontSize: 14, fontWeight: '500' },
	formatPicker: {
		flexDirection: 'row',
		backgroundColor: C.surfaceHigh,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: C.border,
		overflow: 'hidden',
	},
	formatChip: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 4,
		paddingVertical: 10,
		borderRightWidth: StyleSheet.hairlineWidth,
		borderRightColor: C.border,
	},
	formatChipFirst: {},
	formatChipLast: { borderRightWidth: 0 },
	formatChipSelected: { backgroundColor: C.primary },
	formatChipText: { color: C.textMuted, fontSize: 13, fontWeight: '600' },
	formatChipTextSelected: { color: C.white },
	formatNote: { color: C.textDim, fontSize: 12, lineHeight: 17 },

	storageRowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
	storageSize: { color: C.textMuted, fontSize: 13, fontWeight: '500' },
	deleteIcon: {
		width: 28,
		height: 28,
		borderRadius: 8,
		backgroundColor: `${C.error}15`,
		justifyContent: 'center',
		alignItems: 'center',
	},
	totalRow: { backgroundColor: `${C.primary}0D` },
	totalBytes: { color: C.primary, fontSize: 14, fontWeight: '700' },

	tierBadge: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		backgroundColor: `${C.warning}15`,
		borderRadius: 8,
		paddingHorizontal: 8,
		paddingVertical: 4,
	},
	tierBadge1: { backgroundColor: `${C.downloaded}15` },
	tierBadgeText: { color: C.warning, fontSize: 12, fontWeight: '700' },
	tierBadgeText1: { color: C.downloaded },

	delegateText: {
		color: C.primaryMid,
		fontSize: 13,
		fontWeight: '700',
		letterSpacing: 0.5,
	},
	benchmarkDate: { color: C.textMuted, fontSize: 13 },

	benchmarkButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 8,
		margin: 12,
		marginTop: 4,
		backgroundColor: C.primaryMid,
		borderRadius: 12,
		paddingVertical: 12,
	},
	benchmarkButtonDisabled: { opacity: 0.6 },
	benchmarkButtonText: { color: C.white, fontSize: 14, fontWeight: '700' },

	emptyRow: { padding: 20, alignItems: 'center' },
	emptyRowText: { color: C.textMuted, fontSize: 14 },

	versionFooter: {
		color: C.textDim,
		fontSize: 11,
		textAlign: 'center',
		marginTop: 8,
	},

	toggleRow: { paddingVertical: 12 },
	toggleLabelBlock: { flex: 1 },
	toggleSubtitle: {
		color: C.textMuted,
		fontSize: 12,
		marginTop: 2,
	},

	accountBadge: {
		color: C.primaryMid,
		fontSize: 13,
		fontWeight: '600',
	},

	cacheLabel: {
		color: C.textMuted,
		fontSize: 13,
	},
})
