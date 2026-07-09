/**
 * @file features/home/components/RecentCard.tsx
 * @description Compact artwork card shown in the "Recent Artwork" horizontal
 *              scroll strip on HomeScreen. Tapping opens the edit-canvas screen.
 */

import React, { useCallback } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { CheckCircle2 } from 'lucide-react-native'
import type { StyleJob } from '@/types'
import { Colors } from '@/shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT CONSTANTS — kept in sync with home.tsx RECENT_CARD_W / RECENT_CARD_H
// ─────────────────────────────────────────────────────────────────────────────

const RECENT_CARD_W = 130
const RECENT_CARD_H = 130

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface RecentCardProps {
	job: StyleJob
	styleName: string
	onPress: (job: StyleJob) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const RecentCard = React.memo<RecentCardProps>(
	({ job, styleName, onPress }) => {
		const handlePress = useCallback(() => onPress(job), [job, onPress])

		return (
			<TouchableOpacity
				onPress={handlePress}
				style={styles.card}
				activeOpacity={0.88}
				accessibilityRole="button"
				accessibilityLabel={`Recent artwork: ${styleName}`}
			>
				<Image
					source={{ uri: job.resultUri ?? job.sourceUri }}
					style={styles.image}
					contentFit="cover"
					cachePolicy="disk"
					transition={250}
				/>
				<LinearGradient
					colors={['transparent', 'rgba(0,0,0,0.7)']}
					style={styles.gradient}
				>
					<Text style={styles.styleName} numberOfLines={1}>
						{styleName}
					</Text>
				</LinearGradient>
				<View style={styles.badge}>
					<CheckCircle2 color="#4CD964" size={12} strokeWidth={2.5} />
				</View>
			</TouchableOpacity>
		)
	}
)
RecentCard.displayName = 'RecentCard'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	card: {
		width: RECENT_CARD_W,
		height: RECENT_CARD_H,
		borderRadius: 16,
		overflow: 'hidden',
		marginRight: 12,
		backgroundColor: Colors.border,
	},
	image: {
		width: '100%',
		height: '100%',
	},
	gradient: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		paddingHorizontal: 10,
		paddingBottom: 8,
		paddingTop: 20,
	},
	styleName: {
		fontSize: 11,
		fontWeight: '700',
		color: '#FFFFFF',
	},
	badge: {
		position: 'absolute',
		top: 7,
		right: 7,
		width: 20,
		height: 20,
		borderRadius: 10,
		backgroundColor: 'rgba(0,0,0,0.45)',
		alignItems: 'center',
		justifyContent: 'center',
	},
})
