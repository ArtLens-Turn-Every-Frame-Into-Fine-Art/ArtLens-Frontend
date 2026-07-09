/**
 * @file features/home/components/FeatureItem.tsx
 * @description A small icon + label chip used in the features strip on HomeScreen.
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

interface FeatureItemProps {
	label: string
	icon: React.ReactNode
}

export const FeatureItem = React.memo<FeatureItemProps>(({ label, icon }) => (
	<View style={styles.item}>
		<View style={styles.circle}>{icon}</View>
		<Text style={styles.label}>{label}</Text>
	</View>
))
FeatureItem.displayName = 'FeatureItem'

const styles = StyleSheet.create({
	item: {
		alignItems: 'center',
		width: 90,
	},
	circle: {
		width: 50,
		height: 50,
		borderRadius: 15,
		backgroundColor: '#F0EDFF',
		marginBottom: 8,
		justifyContent: 'center',
		alignItems: 'center',
	},
	label: {
		fontSize: 11,
		fontWeight: '700',
		color: '#1C1C1E',
		textAlign: 'center',
	},
})
