/**
 * ArtLens — Navigation Guider
 *
 * Immediately redirects the root "/" path to the Home tab.
 * Acts as an entry guard: could be extended to check onboarding state,
 * auth tokens, or deep-link payloads before deciding where to send the user.
 */

import { Redirect } from 'expo-router'

export default function Index(): React.JSX.Element {
	return <Redirect href="/(tabs)/home" />
}
