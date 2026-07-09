/**
 * ArtLens — Native Sharing Intent Receiver Route (Light Theme Variant)
 * Extracts native shared payload binary streams using expo-sharing hooks.
 */

import React, { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { clearSharedPayloads, useIncomingShare } from 'expo-sharing'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('expo-sharing')

export default function ExpoSharingReceiver(): React.JSX.Element {
	// Hook captures the incoming binary data stream from the OS share sheet
	const { resolvedSharedPayloads, isResolving } = useIncomingShare()

	useEffect(() => {
		// 1. Wait until native platform finishes extracting/caching the file completely
		if (isResolving) return

		// 2. Fallback check: If truly resolved and completely empty, route home
		if (!resolvedSharedPayloads || resolvedSharedPayloads.length === 0) {
			tracker.warn('Sharing link invoked but no payloads resolved.')
			router.replace('/(tabs)/home')
			return
		}

		tracker.log(
			'Native share intent payloads resolved from background cache',
			{ payloadCount: resolvedSharedPayloads.length }
		)

		// Look for the first shared item matching an image or file asset type
		const imagePayload = resolvedSharedPayloads.find(
			(payload) =>
				payload.contentType === 'image' ||
				payload.contentType === 'file'
		)

		if (imagePayload?.contentUri) {
			tracker.log(
				'Valid shared asset path resolved; forwarding to styles view',
				{ uri: imagePayload.contentUri.substring(0, 30) + '...' }
			)

			const encodedUri = encodeURIComponent(imagePayload.contentUri)

			router.replace({
				pathname: '/(screens)/StyleSelectionScreen',
				params: { sourceUri: encodedUri },
			})

			// Clear cache ONLY after successful execution routing
			setTimeout(() => clearSharedPayloads(), 500)
		} else {
			tracker.warn(
				'Sharing link invoked but no valid image target asset payload found'
			)
			router.replace('/(tabs)/home')
			setTimeout(() => clearSharedPayloads(), 500)
		}
	}, [resolvedSharedPayloads, isResolving])

	return (
		<View style={styles.container}>
			<ActivityIndicator color="#7B61FF" size="large" />
			<Text style={styles.text}>Importing shared artwork...</Text>
		</View>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#F8F9FB',
		justifyContent: 'center',
		alignItems: 'center',
		gap: 16,
	},
	text: {
		color: '#1C1C1E',
		fontSize: 16,
		fontWeight: '600',
	},
})
