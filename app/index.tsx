/**
 * ArtLens — Navigation Guider
 *
 * Immediately redirects the root "/" path to the Home tab.
 * Acts as an entry guard: could be extended to check onboarding state,
 * auth tokens, or deep-link payloads before deciding where to send the user.
 */

import { Redirect } from 'expo-router'
import Constants, { ExecutionEnvironment } from 'expo-constants'

const isExpoGo =
	Constants.executionEnvironment === ExecutionEnvironment.StoreClient

export default function Index(): React.ReactNode {
	if (isExpoGo) {
		console.warn('Nitro Modules are disabled in Expo Go.')
		return null
	}

	return <Redirect href="/(tabs)/home" />
}
