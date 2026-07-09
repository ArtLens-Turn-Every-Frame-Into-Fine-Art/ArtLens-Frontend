/**
 * ArtLens — SettingsScreen
 *
 * Sections:
 *  - Queue Activity: live counts + Clear Completed / Clear Failed actions
 *  - Data & Storage: model cache with real size
 *  - Default Export Format: format picker
 *  - Storage Management: per-model delete rows + total
 *  - About: Privacy Policy + Contact Us
 *
 * Directory: app/(tabs)/settings.tsx
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import {
	AlertCircle,
	CheckCircle2,
	Clock,
	FileImage,
	HardDrive,
	Images,
	MessageCircle,
	Settings,
	ShieldCheck,
	Trash2,
	Zap,
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
import { Row, Colors, QueueStat, FormatPicker, Section } from '@/shared/ui'

const tracker = createTracker('SettingsScreen')

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
	if (bytes <= 0) return '0 B'
	if (bytes < 1_024) return `${bytes} B`
	if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
	if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`
	return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE ROW — per-downloaded-model delete row
// ─────────────────────────────────────────────────────────────────────────────

interface StorageRowProps {
	model: StyleModel
	catalog: StyleModel[]
	setCatalog: (catalog: StyleModel[]) => void
}

const StorageRow = React.memo<StorageRowProps>(
	({ model, catalog, setCatalog }) => {
		const [sizeBytes, setSizeBytes] = useState(0)

		// Defer the filesystem read off the render cycle
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
								setCatalog(
									catalog.map((m) =>
										m.id === model.id
											? {
													...m,
													downloadStatus:
														'not_downloaded' as const,
												}
											: m
									)
								)
							} catch (error: any) {
								tracker.error(
									'Failed to delete style assets',
									error
								)
								Alert.alert(
									'Error',
									'Could not remove this style from device.'
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
						color={Colors.textMuted}
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
								color={Colors.error}
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
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// ── Store subscriptions ────────────────────────────────────────────────────
	const catalog = useModelStore(useShallow((s) => s.catalog))
	const setGlobalCatalog = useModelStore((s) => s.updateCatalog)
	const exportFormat = useModelStore(useShallow((s) => s.exportFormat))
	const setExportFormat = useModelStore(useShallow((s) => s.setExportFormat))

	const jobs = useStyleJobStore((s) => s.jobs)
	const clearCompleted = useStyleJobStore((s) => s.clearCompleted)
	const removeJob = useStyleJobStore((s) => s.removeJob)

	// ── Derived job counts ─────────────────────────────────────────────────────
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

	// ── Downloaded models + total footprint ────────────────────────────────────
	const downloadedModels = useMemo(
		() => catalog.filter((m) => m.downloadStatus === 'downloaded'),
		[catalog]
	)

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

	// ── Handlers ───────────────────────────────────────────────────────────────

	const handleFormatSelect = useCallback(
		(fmt: ExportFormat) => {
			tracker.log('Export format updated', { selectedFormat: fmt })
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
						downloadedModels.forEach((m) => {
							try {
								deleteStyleAssets(m.id)
							} catch {
								// Per-model failure is silent — best-effort cleanup
							}
						})
						setGlobalCatalog(
							catalog.map((m) =>
								m.downloadStatus === 'downloaded'
									? {
											...m,
											downloadStatus:
												'not_downloaded' as const,
										}
									: m
							)
						)
					},
				},
			]
		)
	}, [totalBytes, downloadedModels, catalog, setGlobalCatalog])

	const handleAboutContact = useCallback(() => {
		router.push('/(screens)/about-contact')
	}, [])

	const scrollContentStyle = useMemo(
		() => [
			styles.scrollContent,
			{ paddingTop: insets.top + 16, paddingBottom: insets.bottom - 17 },
		],
		[insets.top, insets.bottom]
	)

	// ── Format note — derived from current selection ───────────────────────────
	const formatNote =
		exportFormat === 'HEIC' || exportFormat === 'HEIF'
			? 'HEIC/HEIF: smallest file size, Apple devices. May not open on Windows without conversion.'
			: exportFormat === 'PNG'
				? 'PNG: lossless quality, larger files.'
				: 'JPEG/JPG: universal compatibility, compressed.'

	return (
		<ScrollView
			style={[styles.screen, { backgroundColor: Colors.bg }]}
			contentContainerStyle={scrollContentStyle}
			showsVerticalScrollIndicator={false}
		>
			{/* Page header */}
			<View style={styles.pageHeader}>
				<Settings color={Colors.primary} size={22} strokeWidth={1.6} />
				<Text style={styles.pageTitle}>Settings</Text>
			</View>

			{/* ── Queue Activity ─────────────────────────────────────────────── */}
			{jobs.length > 0 && (
				<Section title="Queue Activity">
					<View style={styles.queueStatsGrid}>
						{processingCount > 0 && (
							<QueueStat
								icon={
									<Zap
										color={Colors.primary}
										size={14}
										strokeWidth={2}
									/>
								}
								label="Processing"
								count={processingCount}
								color={Colors.primary}
							/>
						)}
						{queuedCount > 0 && (
							<QueueStat
								icon={
									<Clock
										color={Colors.textMuted}
										size={14}
										strokeWidth={2}
									/>
								}
								label="Queued"
								count={queuedCount}
								color={Colors.textMuted}
							/>
						)}
						{batteryPausedCount > 0 && (
							<QueueStat
								icon={
									<Zap
										color={Colors.warning}
										size={14}
										strokeWidth={2}
									/>
								}
								label="Paused"
								count={batteryPausedCount}
								color={Colors.warning}
							/>
						)}
						{doneCount > 0 && (
							<QueueStat
								icon={
									<CheckCircle2
										color={Colors.success}
										size={14}
										strokeWidth={2}
									/>
								}
								label="Completed"
								count={doneCount}
								color={Colors.success}
							/>
						)}
						{errorCount > 0 && (
							<QueueStat
								icon={
									<AlertCircle
										color={Colors.errorDeep}
										size={14}
										strokeWidth={2}
									/>
								}
								label="Failed"
								count={errorCount}
								color={Colors.errorDeep}
							/>
						)}
					</View>

					{doneCount > 0 && (
						<Row
							icon={
								<Images
									color={Colors.textMuted}
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
									color={Colors.error}
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
			<Section title="Data & Storage">
				<Row
					icon={
						<HardDrive
							color={Colors.successLegacy}
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

			{/* ── Export Format ──────────────────────────────────────────────── */}
			<Section title="Default export format">
				<View style={styles.formatSection}>
					<View style={styles.formatHeader}>
						<FileImage
							color={Colors.textMuted}
							size={16}
							strokeWidth={1.5}
						/>
						<Text style={styles.formatLabel}>Save photos as</Text>
					</View>
					<FormatPicker
						selected={exportFormat}
						onSelect={handleFormatSelect}
					/>
					<Text style={styles.formatNote}>{formatNote}</Text>
				</View>
			</Section>

			{/* ── Storage Management ─────────────────────────────────────────── */}
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
					<View style={[styles.totalRow]}>
						<View style={styles.totalLeft}>
							<HardDrive
								color={Colors.primary}
								size={16}
								strokeWidth={1.5}
							/>
							<Text style={styles.totalLabel}>
								Total space used
							</Text>
						</View>
						<Text style={styles.totalBytes}>
							{formatBytes(totalBytes)}
						</Text>
					</View>
				)}
			</Section>

			{/* ── About ──────────────────────────────────────────────────────── */}
			<Section title="About">
				<Row
					icon={
						<ShieldCheck
							color={Colors.primary}
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
							color={Colors.textMuted}
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
		color: Colors.text,
		fontSize: 26,
		fontWeight: '800',
		letterSpacing: -0.5,
	},

	// Queue stats grid
	queueStatsGrid: {
		padding: 16,
		paddingBottom: 8,
		gap: 10,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: Colors.border,
	},

	// Format section
	formatSection: { padding: 16, gap: 14 },
	formatHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
	formatLabel: { color: Colors.textMuted, fontSize: 14, fontWeight: '500' },
	formatNote: { color: Colors.textDim, fontSize: 12, lineHeight: 17 },

	// Storage row accessories
	storageRowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
	storageSize: { color: Colors.textMuted, fontSize: 13, fontWeight: '500' },
	deleteIcon: {
		width: 28,
		height: 28,
		borderRadius: 8,
		backgroundColor: `${Colors.error}15`,
		justifyContent: 'center',
		alignItems: 'center',
	},

	// Total row
	totalRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 16,
		paddingVertical: 14,
		backgroundColor: `${Colors.primary}0D`,
	},
	totalLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
	totalLabel: { color: Colors.text, fontSize: 15, fontWeight: '500' },
	totalBytes: { color: Colors.primary, fontSize: 14, fontWeight: '700' },

	// Misc
	emptyRow: { padding: 20, alignItems: 'center' },
	emptyRowText: { color: Colors.textMuted, fontSize: 14 },
	cacheLabel: { color: Colors.textMuted, fontSize: 13 },
	versionFooter: {
		color: Colors.textDim,
		fontSize: 11,
		textAlign: 'center',
		marginTop: 8,
	},
})
