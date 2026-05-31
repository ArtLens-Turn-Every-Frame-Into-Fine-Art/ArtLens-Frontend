/**
 * ArtLens — Native Sharing Intent Receiver Route
 * Extracts native shared payload binary streams using expo-sharing hooks.
 */

import React, { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useIncomingShare } from 'expo-sharing' // <-- Hook to extract the actual files
import { createTracker } from '@/shared/utils/logger'

const tracker = createTracker('expo-sharing')

export default function ExpoSharingReceiver(): React.JSX.Element {
	// Hook captures the incoming binary data stream from the OS share sheet
	const { resolvedSharedPayloads, isResolving } = useIncomingShare()

	useEffect(() => {
		// Wait until native platform finishes extracting/caching the file
		if (isResolving) return

		tracker.log(
			'Native share intent payloads resolved from background cache',
			{
				payloadCount: resolvedSharedPayloads?.length,
			}
		)

		// Look for the first shared item matching an image or file asset type
		const imagePayload = resolvedSharedPayloads?.find(
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

			// Forward the native cache content path seamlessly to your style tab view
			router.replace({
				pathname: '/StyleSelectionScreen',
				params: { externalUri: imagePayload.contentUri },
			})
		} else {
			tracker.warn(
				'Sharing link invoked but no valid image target asset payload was found'
			)
			router.replace('/')
		}
	}, [resolvedSharedPayloads, isResolving])

	return (
		<View style={styles.container}>
			<ActivityIndicator color="#7C3AED" size="large" />
			<Text style={styles.text}>Importing shared artwork...</Text>
		</View>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#080810',
		justifyContent: 'center',
		alignItems: 'center',
		gap: 16,
	},
	text: {
		color: '#F4F4FF',
		fontSize: 16,
		fontWeight: '600',
	},
})
