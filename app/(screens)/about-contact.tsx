/**
 * ArtLens — AboutContact (Modal)
 *
 * Sections:
 *   1. Hero — branding + tagline
 *   2. Stats grid — artworks, rating, countries
 *   3. Our vision — mission card
 *   4. Team — horizontal scroll of members
 *   5. Quick support — email + X (Twitter) deep links
 *   6. Contact form — name, email, message; submitted via api.submitContactForm()
 *   7. Footer — version + award badge
 *
 * Uses ContactContext for form state (isSubmitting / successMessage / error).
 *
 * PRD § 5.2 — Communication Requirements (about/contact navigation)
 *
 * Dependencies:
 *   - src/context/ContactContext
 *   - src/services/api.ts  (wired inside ContactProvider)
 *   - src/shared/utils/constants.ts  (APP_INFO)
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	KeyboardAvoidingView,
	Linking,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import {
	ChevronLeft,
	//Globe,
	Mail,
	//MessageCircle,
	Send,
	Sparkles,
	//Star,
	Twitter,
} from 'lucide-react-native'

// — Context & Services ————————————————————————————————————————————————————————
import { useContact } from '@/context/ContactContext'

// — Design tokens & App constants ————————————————————————————————————————————
import { APP_INFO, COLORS } from '@/shared/utils/constants'

// Alias for ergonomic local use — maps to the light-theme tokens in constants.ts
const C = {
	bg: COLORS.white,
	surface: COLORS.cardBg,
	surfaceHigh: COLORS.background,
	border: COLORS.border,
	primary: COLORS.primary,
	primaryMid: COLORS.primaryLight,
	accent: COLORS.accent,
	text: COLORS.textMain,
	textMuted: COLORS.textGray,
	textDim: COLORS.textGray,
	success: COLORS.success,
	error: '#DC2626',
	white: COLORS.white,
} as const

// — Team data ————————————————————————————————————————————————————————————————
const TEAM = [
	{
		name: 'Muhammad Ahmad',
		role: 'PM · AI',
		avatar: 'https://i.pravatar.cc/100?u=ahmad',
	},
	{
		name: 'Yasir Iftikhar',
		role: 'Algorithm',
		avatar: 'https://i.pravatar.cc/100?u=yasir',
	},
	{
		name: 'Kaif Baig',
		role: 'UI/UX',
		avatar: 'https://i.pravatar.cc/100?u=kaif',
	},
	{
		name: 'Abdullah Amir',
		role: 'Backend · API',
		avatar: 'https://i.pravatar.cc/100?u=amir',
	},
] as const

// — Team member card ——————————————————————————————————————————————————————————
interface TeamMemberProps {
	name: string
	role: string
	avatar: string
}

const TeamMemberCard = React.memo<TeamMemberProps>(({ name, role, avatar }) => (
	<View style={styles.teamCard}>
		<Image
			source={{ uri: avatar }}
			style={styles.teamAvatar}
			contentFit="cover"
			cachePolicy="disk"
			accessibilityLabel={`${name} profile photo`}
		/>
		<Text style={styles.teamName} numberOfLines={1}>
			{name}
		</Text>
		<Text style={styles.teamRole}>{role}</Text>
	</View>
))
TeamMemberCard.displayName = 'TeamMemberCard'

// — Contact method card ———————————————————————————————————————————————————————
interface ContactMethodProps {
	title: string
	sub: string
	icon: React.ReactNode
	tint: string
	onPress: () => void
}

const ContactMethod = React.memo<ContactMethodProps>(
	({ title, sub, icon, tint, onPress }) => (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [
				styles.contactCard,
				{ borderColor: `${tint}30` },
				pressed && { opacity: 0.8 },
			]}
			accessibilityRole="button"
			accessibilityLabel={`${title}: ${sub}`}
		>
			<View style={[styles.contactIcon, { backgroundColor: tint }]}>
				{icon}
			</View>
			<View style={styles.contactText}>
				<Text style={styles.contactTitle}>{title}</Text>
				<Text style={styles.contactSub} numberOfLines={1}>
					{sub}
				</Text>
			</View>
		</Pressable>
	)
)
ContactMethod.displayName = 'ContactMethod'

// — Divider ———————————————————————————————————————————————————————————————————
const Divider: React.FC = () => <View style={styles.divider} />

// — Main Screen ——————————————————————————————————————————————————————————————

export default function AboutContactScreen(): React.JSX.Element {
	const insets = useSafeAreaInsets()

	// — Contact context ————————————————————————————————————————————————————
	const { submit, isSubmitting, successMessage, error, reset } = useContact()

	// — Form state —————————————————————————————————————————————————————————
	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [message, setMessage] = useState('')

	// — Feedback effects ———————————————————————————————————————————————————
	useEffect(() => {
		if (successMessage) {
			Alert.alert(
				'Message Sent!',
				"We'll get back to you as soon as possible.",
				[
					{
						text: 'OK',
						onPress: () => {
							reset()
							setName('')
							setEmail('')
							setMessage('')
						},
					},
				]
			)
		}
	}, [successMessage, reset])

	useEffect(() => {
		if (error) {
			Alert.alert('Send Failed', error, [{ text: 'OK', onPress: reset }])
		}
	}, [error, reset])

	// — Handlers ———————————————————————————————————————————————————————————

	const handleSend = useCallback(async () => {
		const trimName = name.trim()
		const trimEmail = email.trim()
		const trimMessage = message.trim()

		if (!trimName || !trimEmail || !trimMessage) {
			Alert.alert(
				'Incomplete',
				'Please fill in all fields before submitting.'
			)
			return
		}

		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
		if (!emailRegex.test(trimEmail)) {
			Alert.alert('Invalid email', 'Please enter a valid email address.')
			return
		}

		await submit({ name: trimName, email: trimEmail, message: trimMessage })
	}, [name, email, message, submit])

	const openLink = useCallback((url: string) => {
		Linking.openURL(url).catch(() =>
			Alert.alert('Error', 'Could not open link.')
		)
	}, [])

	const handleEmail = useCallback(
		() => openLink(`mailto:${APP_INFO.supportEmail}`),
		[openLink]
	)
	const handleTwitter = useCallback(
		() => openLink(`https://x.com/${APP_INFO.xHandle.replace('@', '')}`),
		[openLink]
	)

	// — Render ————————————————————————————————————————————————————————————————

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
			style={[styles.screen, { backgroundColor: C.bg }]}
		>
			{/* ── Header ────────────────────────────────────────────────────── */}
			<View style={[styles.header, { paddingTop: insets.top + 4 }]}>
				<Pressable
					onPress={() => router.back()}
					style={styles.headerBtn}
					accessibilityRole="button"
					accessibilityLabel="Go back"
					hitSlop={12}
				>
					<ChevronLeft color={C.text} size={26} strokeWidth={1.8} />
				</Pressable>
				<Text style={styles.headerTitle}>About & Contact</Text>
				<View style={{ width: 40 }} />
			</View>

			<ScrollView
				showsVerticalScrollIndicator={false}
				contentContainerStyle={[
					styles.scrollContent,
					{ paddingBottom: 24 },
				]}
				keyboardShouldPersistTaps="handled"
			>
				{/* ── Hero ──────────────────────────────────────────────────── */}
				<View style={styles.hero}>
					<LinearGradient
						colors={[
							`${C.primary}20`,
							`${C.accent}10`,
							'transparent',
						]}
						style={StyleSheet.absoluteFill}
						start={{ x: 0, y: 0 }}
						end={{ x: 1, y: 1 }}
					/>
					<View style={styles.heroIconRow}>
						<Sparkles
							color={C.primaryMid}
							size={22}
							strokeWidth={1.5}
							fill={`${C.primaryMid}40`}
						/>
						<Text style={styles.heroBrand}>{APP_INFO.name}</Text>
					</View>
					<Text style={styles.heroTitle}>
						Creativity,{'\n'}democratized.
					</Text>
					<Text style={styles.heroSub}>
						On-device AI art transfer for everyone.{'\n'}No cloud.
						No subscription. Just art.
					</Text>
				</View>

				{/* ── Stats ─────────────────────────────────────────────────── */}
				{/*<View style={styles.statsRow}>
					<StatBox
						icon={
							<MessageCircle
								color={C.primaryMid}
								size={18}
								strokeWidth={1.5}
							/>
						}
						value="100k+"
						label="Artworks"
					/>
					<StatBox
						icon={
							<Star
								color={C.primaryMid}
								size={18}
								strokeWidth={1.5}
								fill={`${C.primaryMid}30`}
							/>
						}
						value="4.8"
						label="Rating"
					/>
					<StatBox
						icon={
							<Globe
								color={C.primaryMid}
								size={18}
								strokeWidth={1.5}
							/>
						}
						value="12"
						label="Countries"
					/>
				</View>

				<Divider />*/}

				{/* ── Vision ────────────────────────────────────────────────── */}
				<View style={styles.section}>
					<Text style={styles.sectionTitle}>Our Vision</Text>
					<View style={styles.visionCard}>
						<Text style={styles.visionText}>
							{APP_INFO.name} empowers everyone to be an artist.
							By combining intuitive design with cutting-edge
							on-device generative AI, we transform your everyday
							photos into gallery-worthy fine art — instantly,
							privately, and beautifully.
						</Text>
					</View>
				</View>

				<Divider />

				{/* ── Team ──────────────────────────────────────────────────── */}
				<View style={styles.section}>
					<Text style={styles.sectionTitle}>The Team</Text>
					<Text style={styles.sectionSub}>
						Group F25SE004 · University of Central Punjab
					</Text>
					<ScrollView
						horizontal
						showsHorizontalScrollIndicator={false}
						contentContainerStyle={styles.teamScroll}
					>
						{TEAM.map((member) => (
							<TeamMemberCard key={member.name} {...member} />
						))}
					</ScrollView>
				</View>

				<Divider />

				{/* ── Quick support ─────────────────────────────────────────── */}
				<View style={styles.section}>
					<Text style={styles.sectionTitle}>Quick Support</Text>
					<View style={styles.contactRow}>
						<ContactMethod
							title="Email us"
							sub={APP_INFO.supportEmail}
							icon={
								<Mail
									color={C.white}
									size={18}
									strokeWidth={1.8}
								/>
							}
							tint={C.primaryMid}
							onPress={handleEmail}
						/>
						<ContactMethod
							title="Follow on X"
							sub={APP_INFO.xHandle}
							icon={
								<Twitter
									color={C.white}
									size={18}
									strokeWidth={1.8}
								/>
							}
							tint="#1DA1F2"
							onPress={handleTwitter}
						/>
					</View>
				</View>

				<Divider />

				{/* ── Contact form ──────────────────────────────────────────── */}
				<View style={styles.section}>
					<Text style={styles.sectionTitle}>Send us a message</Text>

					<View style={styles.formCard}>
						<TextInput
							style={styles.input}
							placeholder="Your name"
							placeholderTextColor={C.textDim}
							value={name}
							onChangeText={setName}
							autoCapitalize="words"
							returnKeyType="next"
							accessibilityLabel="Your name"
						/>
						<TextInput
							style={styles.input}
							placeholder="Email address"
							placeholderTextColor={C.textDim}
							value={email}
							onChangeText={setEmail}
							keyboardType="email-address"
							autoCapitalize="none"
							returnKeyType="next"
							accessibilityLabel="Email address"
						/>
						<TextInput
							style={[styles.input, styles.textArea]}
							placeholder="Tell us what's on your mind…"
							placeholderTextColor={C.textDim}
							value={message}
							onChangeText={setMessage}
							multiline
							maxLength={500}
							textAlignVertical="top"
							accessibilityLabel="Message"
						/>

						{/* Character count */}
						<Text style={styles.charCount}>
							{message.length}/500
						</Text>

						{/* Submit */}
						<Pressable
							onPress={handleSend}
							disabled={isSubmitting}
							style={({ pressed }) => [
								styles.sendBtn,
								isSubmitting && { opacity: 0.65 },
								pressed && !isSubmitting && { opacity: 0.88 },
							]}
							accessibilityRole="button"
							accessibilityLabel="Submit message"
						>
							<LinearGradient
								colors={[C.primary, C.primaryMid, C.accent]}
								start={{ x: 0, y: 0 }}
								end={{ x: 1, y: 0 }}
								style={styles.sendBtnGradient}
							>
								{isSubmitting ? (
									<ActivityIndicator
										color={C.white}
										size="small"
									/>
								) : (
									<>
										<Send
											color={C.white}
											size={18}
											strokeWidth={2}
										/>
										<Text style={styles.sendBtnText}>
											Submit Message
										</Text>
									</>
								)}
							</LinearGradient>
						</Pressable>
					</View>
				</View>

				{/* ── Footer ────────────────────────────────────────────────── */}
				<View style={styles.footer}>
					<Text style={styles.footerSub}>
						v{APP_INFO.version} · Built by {APP_INFO.name} Inc.
					</Text>
				</View>
			</ScrollView>
		</KeyboardAvoidingView>
	)
}

// — Styles ————————————————————————————————————————————————————————————————————
const styles = StyleSheet.create({
	screen: { flex: 1 },

	// Header
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingHorizontal: 12,
		paddingBottom: 10,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: C.border,
	},
	headerBtn: {
		width: 40,
		height: 40,
		borderRadius: 20,
		justifyContent: 'center',
		alignItems: 'center',
	},
	headerTitle: {
		flex: 1,
		textAlign: 'center',
		color: C.text,
		fontSize: 17,
		fontWeight: '700',
		letterSpacing: -0.2,
	},

	// Scroll
	scrollContent: {
		paddingHorizontal: 20,
	},

	// Hero
	hero: {
		paddingVertical: 28,
		borderRadius: 20,
		marginVertical: 16,
		paddingHorizontal: 4,
		overflow: 'hidden',
		gap: 10,
	},
	heroIconRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	heroBrand: {
		color: C.primaryMid,
		fontSize: 13,
		fontWeight: '800',
		letterSpacing: 1.5,
		textTransform: 'uppercase',
	},
	heroTitle: {
		color: C.text,
		fontSize: 34,
		fontWeight: '900',
		lineHeight: 40,
		letterSpacing: -1,
	},
	heroSub: {
		color: C.textMuted,
		fontSize: 14,
		lineHeight: 21,
	},
	// Divider
	divider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: C.border,
		marginVertical: 20,
	},

	// Sections
	section: { marginBottom: 8 },
	sectionTitle: {
		color: C.text,
		fontSize: 20,
		fontWeight: '800',
		letterSpacing: -0.3,
		marginBottom: 6,
	},
	sectionSub: {
		color: C.textMuted,
		fontSize: 12,
		marginBottom: 14,
	},

	// Vision card
	visionCard: {
		backgroundColor: C.surface,
		borderRadius: 16,
		borderWidth: 1,
		borderColor: C.border,
		padding: 18,
	},
	visionText: {
		color: C.textMuted,
		fontSize: 14,
		lineHeight: 22,
	},

	// Team
	teamScroll: {
		gap: 16,
		paddingRight: 4,
		paddingTop: 4,
	},
	teamCard: {
		alignItems: 'center',
		gap: 6,
		width: 80,
	},
	teamAvatar: {
		width: 64,
		height: 64,
		borderRadius: 32,
		borderWidth: 2,
		borderColor: C.border,
	},
	teamName: {
		color: C.text,
		fontSize: 12,
		fontWeight: '700',
		textAlign: 'center',
	},
	teamRole: {
		color: C.textMuted,
		fontSize: 11,
		textAlign: 'center',
	},

	// Quick support
	contactRow: {
		flexDirection: 'row',
		gap: 12,
		marginTop: 10,
	},
	contactCard: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		backgroundColor: C.surface,
		borderRadius: 14,
		borderWidth: 1,
		padding: 12,
	},
	contactIcon: {
		width: 36,
		height: 36,
		borderRadius: 10,
		justifyContent: 'center',
		alignItems: 'center',
	},
	contactText: { flex: 1 },
	contactTitle: {
		color: C.text,
		fontSize: 13,
		fontWeight: '700',
	},
	contactSub: {
		color: C.textMuted,
		fontSize: 11,
		marginTop: 2,
	},

	// Form
	formCard: {
		marginTop: 12,
		gap: 12,
	},
	input: {
		backgroundColor: C.surface,
		borderRadius: 14,
		borderWidth: 1,
		borderColor: C.border,
		paddingHorizontal: 16,
		paddingVertical: 14,
		color: C.text,
		fontSize: 15,
	},
	textArea: {
		height: 120,
		textAlignVertical: 'top',
	},
	charCount: {
		color: C.textDim,
		fontSize: 11,
		textAlign: 'right',
		marginTop: -6,
	},
	sendBtn: {
		borderRadius: 16,
		overflow: 'hidden',
		marginTop: 4,
	},
	sendBtnGradient: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: 10,
		height: 56,
	},
	sendBtnText: {
		color: C.white,
		fontSize: 16,
		fontWeight: '800',
	},

	// Footer
	footer: {
		alignItems: 'center',
		paddingTop: 24,
		paddingBottom: 8,
		gap: 6,
	},
	footerSub: {
		color: C.textDim,
		fontSize: 11,
	},
})
