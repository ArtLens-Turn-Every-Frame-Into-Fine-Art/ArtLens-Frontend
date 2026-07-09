/**
 * @file features/home/components/ErrorBanner.tsx
 * @description Dismissible inline error banner shown at the top of HomeScreen
 *              when the image picker or another operation fails.
 */

import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { X, Zap } from 'lucide-react-native'
import { Colors } from '@/shared/ui'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ErrorBannerProps {
	message: string
	onDismiss: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export const ErrorBanner = React.memo<ErrorBannerProps>(
	({ message, onDismiss }) => (
		<Animated.View
			style={styles.banner}
			entering={FadeInDown.duration(260)}
			exiting={FadeOutDown.duration(200)}
		>
			<View style={styles.content}>
				<Zap color="#EF4444" size={16} strokeWidth={2} />
				<Text style={styles.text} numberOfLines={2}>
					{message}
				</Text>
			</View>
			<Pressable
				onPress={onDismiss}
				style={styles.closeBtn}
				hitSlop={10}
				accessibilityRole="button"
				accessibilityLabel="Dismiss error"
			>
				<X color={Colors.textMuted} size={14} strokeWidth={2} />
			</Pressable>
		</Animated.View>
	)
)
ErrorBanner.displayName = 'ErrorBanner'

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
	banner: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		backgroundColor: '#FFF5F5',
		borderRadius: 12,
		borderWidth: 1,
		borderColor: '#FED7D7',
		paddingHorizontal: 14,
		paddingVertical: 10,
		marginHorizontal: 20,
		marginBottom: 12,
	},
	content: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		flex: 1,
	},
	text: {
		fontSize: 13,
		color: '#C53030',
		flex: 1,
	},
	closeBtn: {
		marginLeft: 8,
	},
})
