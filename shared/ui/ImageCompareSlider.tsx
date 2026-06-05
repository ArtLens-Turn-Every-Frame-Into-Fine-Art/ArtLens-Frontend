import React, { useState, useRef } from 'react'
import {
	View,
	Image,
	StyleSheet,
	PanResponder,
	LayoutChangeEvent,
} from 'react-native'

interface ImageCompareSliderProps {
	beforeUri: string
	afterUri: string
	width: number
	height: number
}

export const ImageCompareSlider: React.FC<ImageCompareSliderProps> = ({
	beforeUri,
	afterUri,
	width,
	height,
}) => {
	const [sliderPosition, setSliderPosition] = useState(width / 2)
	const containerLeftX = useRef(0)

	// Measure container screen position to accurately map absolute gestures
	const handleLayout = (event: LayoutChangeEvent) => {
		containerLeftX.current = event.nativeEvent.layout.x
	}

	const panResponder = useRef(
		PanResponder.create({
			onStartShouldSetPanResponder: () => true,
			onMoveShouldSetPanResponder: () => true,
			onPanResponderMove: (evt) => {
				// Calculate touch location relative to the image canvas bounds
				const relativeX = evt.nativeEvent.pageX - containerLeftX.current
				const boundedX = Math.max(0, Math.min(relativeX, width))
				setSliderPosition(boundedX)
			},
		})
	).current

	return (
		<View
			style={[styles.container, { width, height }]}
			onLayout={handleLayout}
		>
			{/* AFTER IMAGE: Lives permanently in the background layer */}
			<Image
				source={{ uri: afterUri }}
				style={{ width, height, resizeMode: 'contain' }}
			/>

			{/* BEFORE IMAGE: Dynamic horizontal clipping wrapper */}
			<View
				style={[
					styles.clipContainer,
					{ width: sliderPosition, height },
				]}
			>
				<Image
					source={{ uri: beforeUri }}
					style={{ width, height, resizeMode: 'contain' }}
				/>
			</View>

			{/* SLIDER CONTROLLER HANDLE */}
			<View
				{...panResponder.panHandlers}
				style={[styles.handleLine, { left: sliderPosition - 20 }]}
			>
				<View style={styles.centerDivider} />
				<View style={styles.handleBadge}>
					<View style={styles.arrowLeft} />
					<View style={styles.arrowRight} />
				</View>
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	container: {
		position: 'relative',
		backgroundColor: '#1C1C1E',
		borderRadius: 16,
		overflow: 'hidden',
		alignSelf: 'center',
	},
	clipContainer: {
		position: 'absolute',
		top: 0,
		left: 0,
		overflow: 'hidden', // Clips the underlying image cleanly
	},
	handleLine: {
		position: 'absolute',
		top: 0,
		bottom: 0,
		width: 40, // Expanded touch target size for frictionless dragging
		alignItems: 'center',
		justifyContent: 'center',
		zIndex: 10,
	},
	centerDivider: {
		position: 'absolute',
		top: 0,
		bottom: 0,
		width: 2,
		backgroundColor: '#FFFFFF',
	},
	handleBadge: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: '#FFFFFF',
		borderWidth: 1,
		borderColor: '#E5E5EA',
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 4,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.2,
		shadowRadius: 4,
		elevation: 4,
	},
	arrowLeft: {
		width: 0,
		height: 0,
		borderTopWidth: 4,
		borderTopColor: 'transparent',
		borderBottomWidth: 4,
		borderBottomColor: 'transparent',
		borderRightWidth: 5,
		borderRightColor: '#7B61FF', // Matches C.primaryMid
	},
	arrowRight: {
		width: 0,
		height: 0,
		borderTopWidth: 4,
		borderTopColor: 'transparent',
		borderBottomWidth: 4,
		borderBottomColor: 'transparent',
		borderLeftWidth: 5,
		borderLeftColor: '#7B61FF',
	},
})
