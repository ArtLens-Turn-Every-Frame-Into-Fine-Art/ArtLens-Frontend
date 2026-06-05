/**
 * ArtLens — Native Sharing Intent Receiver Route (Light Theme Variant)
 * Extracts native shared payload binary streams using expo-sharing hooks.
 */

import React, { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useIncomingShare } from 'expo-sharing'
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('expo-sharing')

export default function ExpoSharingReceiver(): React.JSX.Element {
	// Hook captures the incoming binary data stream from the OS share sheet
	const { resolvedSharedPayloads, isResolving } = useIncomingShare()

	useEffect(() => {
		// 1. Wait until native platform finishes extracting/caching the file completely
		if (isResolving) return

		// 2. STAGE 1 SAFEGUARD: Android frequently triggers an initial empty payload pass
		// while warm-starting the app cache. If it's undefined or completely empty, wait for the next tick.
		if (!resolvedSharedPayloads || resolvedSharedPayloads.length === 0) {
			tracker.log(
				'Share payload array is empty, waiting for native cache resolution...'
			)
			return
		}

		tracker.log(
			'Native share intent payloads resolved from background cache',
			{
				payloadCount: resolvedSharedPayloads.length,
			}
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
				{
					uri: imagePayload.contentUri.substring(0, 30) + '...',
				}
			)

			// 3. Safely URL encode the local file path string so slashes don't break Expo Router segments
			const encodedUri = encodeURIComponent(imagePayload.contentUri)

			// 4. Route explicitly to the screen.
			// NOTE: In Expo Router, you must route via the group folder layout it sits in,
			// which is likely '/(screens)/StyleSelectionScreen' based on your layout configuration.
			router.replace({
				pathname: '/(screens)/StyleSelectionScreen',
				params: { sourceUri: encodedUri },
			})
		} else {
			tracker.warn(
				'Sharing link invoked but no valid image target asset payload was found'
			)
			router.replace('/(tabs)/home')
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
