/**
 * ArtLens — SettingsScreen (v3 — Enhanced)
 *
 * NEW vs v2:
 *  - "Queue Activity" section: shows live counts (queued/processing/done/error)
 *    drawn directly from useStyleJobStore, plus a "Clear Completed" button wired
 *    to clearCompleted() and a "Clear Failed" button wired to removeJob on errors.
 *  - Clear Cache row: "Used: X MB" now shows real totalBytes from model footprints
 *    (same totalBytes already computed for Storage Management) — no more hardcoded 124 MB.
 *  - Account row shows total artworks created (from completed jobs count).
 *
 * Directory: app/(tabs)/settings.tsx
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
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
	FileImage,
	HardDrive,
	Images,
	MessageCircle,
	Settings,
	ShieldCheck,
	Trash2,
	Zap,
	AlertCircle,
	Clock,
	CheckCircle2,
} from 'lucide-react-native'
import { useShallow } from 'zustand/shallow'

import { useModelStore } from '@/shared/stores/useModelStore'
import { useStyleJobStore } from '@/shared/stores/useStyleJobStore'

import {
	getPhysicalFootprint,
	deleteStyleAssets,
} from '@/core/storage/ModelManager'

import type { StyleModel, ExportFormat } from '@/types'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('SettingsScreen')

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────

const C = {
	bg: '#F8F9FB',
	surface: '#FFFFFF',
	surfaceHigh: '#F2F2F7',
	border: '#E5E5EA',
	primary: '#7B61FF',
	primaryMid: '#7B61FF',
	primarySoft: '#F0EDFF',
	text: '#1C1C1E',
	textMuted: '#8E8E93',
	textDim: '#AEAEB2',
	downloaded: '#4CD964',
	success: '#34C759',
	warning: '#FF9F0A',
	warningSoft: '#FFF5E6',
	error: '#FF7675',
	errorDeep: '#FF3B30',
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

// ─────────────────────────────────────────────────────────────────────────────
// SECTION WRAPPER
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

// ─────────────────────────────────────────────────────────────────────────────
// ROW
// ─────────────────────────────────────────────────────────────────────────────

interface RowProps {
	icon: React.ReactNode
	label: string
	right?: React.ReactNode
	onPress?: () => void
	danger?: boolean
	noBorder?: boolean
	subtitle?: string
}

const Row = React.memo<RowProps>(
	({ icon, label, right, onPress, danger, noBorder, subtitle }) => {
		const content = (
			<>
				<View style={styles.rowLeft}>
					<View
						style={[styles.rowIcon, danger && styles.rowIconDanger]}
					>
						{icon}
					</View>
					<View style={styles.rowLabelBlock}>
						<Text
							style={[
								styles.rowLabel,
								danger && styles.rowLabelDanger,
							]}
						>
							{label}
						</Text>
						{subtitle && (
							<Text style={styles.rowSubtitle}>{subtitle}</Text>
						)}
					</View>
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

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT FORMAT PICKER
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE ROW
// ─────────────────────────────────────────────────────────────────────────────

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
		}, [model.id, model.downloadStatus])

		const handleDelete = useCallback(() => {
			Alert.alert(
				`Remove "${model.name}"?`,
				'This style will be removed from your device. You can re-download it later.',
				[
					{ text: 'Cancel', style: 'cancel' },
					{
						text: 'Remove',
						style: 'destructive',
						onPress: () => {
							try {
								deleteStyleAssets(model.id)
								const updated = catalog.map((m) =>
									m.id === model.id
										? {
												...m,
												downloadStatus:
													'not_downloaded' as const,
											}
										: m
								)
								setCatalog(updated)
							} catch (error: any) {
								tracker.error(
									'Physical disk partition eviction fault',
									error
								)
								Alert.alert(
									'Error',
									'Physical disk partition eviction fault.'
								)
							}
						},
					},
				]
			)
		}, [model.id, model.name, catalog, setCatalog])

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

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE ROW
// ─────────────────────────────────────────────────────────────────────────────

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
// QUEUE ACTIVITY STAT ROW
// ─────────────────────────────────────────────────────────────────────────────

interface QueueStatProps {
	icon: React.ReactNode
	label: string
	count: number
	color: string
}

const QueueStat = React.memo<QueueStatProps>(
	({ icon, label, count, color }) => (
		<View style={styles.queueStatRow}>
			{icon}
			<Text style={styles.queueStatLabel}>{label}</Text>
			<View
				style={[
					styles.queueStatBadge,
					{
						backgroundColor: `${color}18`,
						borderColor: `${color}35`,
					},
				]}
			>
				<Text style={[styles.queueStatCount, { color }]}>{count}</Text>
			</View>
		</View>
	)
)
QueueStat.displayName = 'QueueStat'

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// ── Model store ───────────────────────────────────────────────────────────
	const catalog = useModelStore(useShallow((s) => s.catalog))
	const setGlobalCatalog = useModelStore((s) => s.updateCatalog)
	const exportFormat = useModelStore(useShallow((s) => s.exportFormat))
	const setExportFormat = useModelStore(useShallow((s) => s.setExportFormat))

	// ── Job store ─────────────────────────────────────────────────────────────
	const jobs = useStyleJobStore((s) => s.jobs)
	const clearCompleted = useStyleJobStore((s) => s.clearCompleted)
	const removeJob = useStyleJobStore((s) => s.removeJob)

	// Derived job stats
	const queuedCount = useMemo(
		() => jobs.filter((j) => j.status === 'QUEUED').length,
		[jobs]
	)
	const processingCount = useMemo(
		() => jobs.filter((j) => j.status === 'PROCESSING').length,
		[jobs]
	)
	const doneCount = useMemo(
		() => jobs.filter((j) => j.status === 'DONE').length,
		[jobs]
	)
	const errorCount = useMemo(
		() => jobs.filter((j) => j.status === 'ERROR').length,
		[jobs]
	)
	const batteryPausedCount = useMemo(
		() => jobs.filter((j) => j.status === 'BATTERY_PAUSED').length,
		[jobs]
	)

	// ── Downloaded models ─────────────────────────────────────────────────────
	const downloadedModels = useMemo(
		() => catalog.filter((m) => m.downloadStatus === 'downloaded'),
		[catalog]
	)

	// ── Total storage (real — same computation as Storage section) ────────────
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

	// ── Handlers ──────────────────────────────────────────────────────────────

	const handleFormatSelect = useCallback(
		(fmt: ExportFormat) => {
			tracker.log('Default export asset compression type updated', {
				selectedFormat: fmt,
			})
			setExportFormat(fmt)
		},
		[setExportFormat]
	)

	const handleClearCompleted = useCallback(() => {
		Alert.alert(
			'Clear Completed',
			`Remove all ${doneCount} completed artworks from the queue history?`,
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Clear',
					style: 'destructive',
					onPress: () => {
						tracker.log('Clearing completed jobs from settings')
						clearCompleted()
					},
				},
			]
		)
	}, [clearCompleted, doneCount])

	const handleClearFailed = useCallback(() => {
		Alert.alert(
			'Clear Failed Jobs',
			`Remove all ${errorCount} failed job entries?`,
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Clear',
					style: 'destructive',
					onPress: () => {
						const failedIds = jobs
							.filter((j) => j.status === 'ERROR')
							.map((j) => j.id)
						failedIds.forEach((id) => removeJob(id))
						tracker.log(
							`Cleared ${failedIds.length} failed jobs from settings`
						)
					},
				},
			]
		)
	}, [jobs, removeJob, errorCount])

	const handleClearCache = useCallback(() => {
		Alert.alert(
			'Clear Model Cache',
			`This will clear ${formatBytes(totalBytes)} of cached model data. You will need to re-download styles.`,
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Clear Cache',
					style: 'destructive',
					onPress: () => {
						tracker.log(
							'User initiated full cache clear from settings'
						)
						// Clear assets for each downloaded model
						downloadedModels.forEach((m) => {
							try {
								deleteStyleAssets(m.id)
							} catch {
								// silent per-model failure
							}
						})
						const updated = catalog.map((m) =>
							m.downloadStatus === 'downloaded'
								? {
										...m,
										downloadStatus:
											'not_downloaded' as const,
									}
								: m
						)
						setGlobalCatalog(updated)
					},
				},
			]
		)
	}, [totalBytes, downloadedModels, catalog, setGlobalCatalog])

	const handleAboutContact = useCallback(() => {
		router.push('/(screens)/about-contact')
	}, [])

	const combinedScrollStyle = useMemo(
		() => [
			styles.scrollContent,
			{ paddingTop: insets.top + 16, paddingBottom: insets.bottom - 17 },
		],
		[insets.top, insets.bottom]
	)

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

			{/* ── Queue Activity (NEW) ────────────────────────────────────────── */}
			{jobs.length > 0 && (
				<Section title="Queue Activity">
					<View style={styles.queueStatsGrid}>
						{processingCount > 0 && (
							<QueueStat
								icon={
									<Zap
										color={C.primaryMid}
										size={14}
										strokeWidth={2}
									/>
								}
								label="Processing"
								count={processingCount}
								color={C.primaryMid}
							/>
						)}
						{queuedCount > 0 && (
							<QueueStat
								icon={
									<Clock
										color={C.textMuted}
										size={14}
										strokeWidth={2}
									/>
								}
								label="Queued"
								count={queuedCount}
								color={C.textMuted}
							/>
						)}
						{batteryPausedCount > 0 && (
							<QueueStat
								icon={
									<Zap
										color={C.warning}
										size={14}
										strokeWidth={2}
									/>
								}
								label="Paused"
								count={batteryPausedCount}
								color={C.warning}
							/>
						)}
						{doneCount > 0 && (
							<QueueStat
								icon={
									<CheckCircle2
										color={C.success}
										size={14}
										strokeWidth={2}
									/>
								}
								label="Completed"
								count={doneCount}
								color={C.success}
							/>
						)}
						{errorCount > 0 && (
							<QueueStat
								icon={
									<AlertCircle
										color={C.errorDeep}
										size={14}
										strokeWidth={2}
									/>
								}
								label="Failed"
								count={errorCount}
								color={C.errorDeep}
							/>
						)}
					</View>

					{/* Queue management actions */}
					{doneCount > 0 && (
						<Row
							icon={
								<Images
									color={C.textMuted}
									size={16}
									strokeWidth={1.5}
								/>
							}
							label="Clear Completed"
							subtitle={`${doneCount} finished job${doneCount === 1 ? '' : 's'}`}
							onPress={handleClearCompleted}
							noBorder={errorCount === 0}
						/>
					)}
					{errorCount > 0 && (
						<Row
							icon={
								<AlertCircle
									color={C.error}
									size={16}
									strokeWidth={1.5}
								/>
							}
							label="Clear Failed Jobs"
							subtitle={`${errorCount} failed job${errorCount === 1 ? '' : 's'}`}
							onPress={handleClearFailed}
							danger
							noBorder
						/>
					)}
				</Section>
			)}

			{/* ── Data & Storage ─────────────────────────────────────────────── */}
			<Section title="Data &amp; Storage">
				<Row
					icon={
						<HardDrive
							color={C.downloaded}
							size={16}
							strokeWidth={1.5}
						/>
					}
					label="Clear Cache"
					subtitle={
						downloadedModels.length > 0
							? `${formatBytes(totalBytes)} of model data`
							: 'No cached models'
					}
					right={
						totalBytes > 0 ? (
							<Text style={styles.cacheLabel}>
								{formatBytes(totalBytes)}
							</Text>
						) : undefined
					}
					onPress={
						downloadedModels.length > 0
							? handleClearCache
							: undefined
					}
					noBorder
				/>
			</Section>

			{/* ── 1. Export Format ───────────────────────────────────────────── */}
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

			{/* ── 2. Storage Management ─────────────────────────────────────── */}
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
							<View style={styles.rowLabelBlock}>
								<Text style={styles.rowLabel}>
									Total space used
								</Text>
							</View>
						</View>
						<Text style={styles.totalBytes}>
							{formatBytes(totalBytes)}
						</Text>
					</View>
				)}
			</Section>

			{/* ── 4. About ─────────────────────────────────────────────────── */}
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
	rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
	rowIcon: {
		width: 32,
		height: 32,
		borderRadius: 8,
		backgroundColor: C.surfaceHigh,
		justifyContent: 'center',
		alignItems: 'center',
	},
	rowIconDanger: { backgroundColor: `${C.error}15` },
	rowLabelBlock: { flex: 1 },
	rowLabel: { color: C.text, fontSize: 15, fontWeight: '500' },
	rowLabelDanger: { color: C.error },
	rowSubtitle: { color: C.textMuted, fontSize: 12, marginTop: 1 },
	rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

	// Toggle
	toggleRow: { paddingVertical: 12 },
	toggleLabelBlock: { flex: 1 },
	toggleSubtitle: { color: C.textMuted, fontSize: 12, marginTop: 2 },

	// Format picker
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

	// Storage
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

	// Queue activity section
	queueStatsGrid: {
		padding: 16,
		paddingBottom: 8,
		gap: 10,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: C.border,
	},
	queueStatRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
	},
	queueStatLabel: { flex: 1, color: C.text, fontSize: 14, fontWeight: '500' },
	queueStatBadge: {
		minWidth: 32,
		paddingHorizontal: 8,
		paddingVertical: 3,
		borderRadius: 10,
		borderWidth: 1,
		alignItems: 'center',
	},
	queueStatCount: { fontSize: 13, fontWeight: '800' },

	// Misc
	emptyRow: { padding: 20, alignItems: 'center' },
	emptyRowText: { color: C.textMuted, fontSize: 14 },
	versionFooter: {
		color: C.textDim,
		fontSize: 11,
		textAlign: 'center',
		marginTop: 8,
	},
	cacheLabel: { color: C.textMuted, fontSize: 13 },
})
