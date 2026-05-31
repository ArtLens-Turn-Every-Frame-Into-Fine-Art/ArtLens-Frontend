const config = {
	API_BASE: process.env.EXPO_PUBLIC_API_BASE ?? 'http://localhost:10000',
} as const

export default config
