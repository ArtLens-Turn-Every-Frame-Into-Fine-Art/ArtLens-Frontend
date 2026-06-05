// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// ⚡ Crucial for react-native-fast-tflite:
// Tell Metro to treat .tflite files as static assets instead of failing to parse them as JavaScript code.
config.resolver.assetExts.push('tflite')

module.exports = config
