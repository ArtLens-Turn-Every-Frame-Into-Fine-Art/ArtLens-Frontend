/**
 * @file features/gallery/components/statusConfig.ts
 * @description Maps every JobStatus to a display label, color, and icon.
 *
 * Used by ActiveJobRow, FinalizedTile, and the main GalleryScreen to keep
 * status presentation logic in one place.
 */

import {
	AlertCircle,
	Battery,
	CheckCircle2,
	Clock,
	Zap,
} from 'lucide-react-native'
import type { JobStatus } from '@/types'
import { Colors } from '@/shared/ui'

interface StatusConfig {
	label: string
	color: string
	Icon: React.ComponentType<{
		color: string
		size: number
		strokeWidth?: number
	}>
}

export const STATUS_CONFIG: Record<JobStatus, StatusConfig> = {
	QUEUED: { label: 'Queued', color: Colors.textMuted, Icon: Clock },
	PROCESSING: { label: 'Working…', color: Colors.primary, Icon: Zap },
	DONE: { label: 'Done', color: Colors.successLegacy, Icon: CheckCircle2 },
	ERROR: { label: 'Failed', color: Colors.errorDeep, Icon: AlertCircle },
	BATTERY_PAUSED: { label: 'Paused', color: Colors.warning, Icon: Battery },
	PREVIEW_QUEUED: {
		label: 'Preview Queued',
		color: Colors.textMuted,
		Icon: Clock,
	},
}
