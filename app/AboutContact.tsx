import { APP_INFO, COLORS } from "@/utils/constants";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
    Award,
    ChevronLeft,
    Globe,
    Mail,
    MessageSquare,
    Star,
    Twitter,
} from "lucide-react-native";
import React, { useState } from "react";
import {
    Alert,
    Image,
    KeyboardAvoidingView,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

export default function AboutContact() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");

    const handleSendMessage = () => {
        if (!name || !email || !message) {
            Alert.alert("Error", "Please fill in all fields.");
            return;
        }
        Alert.alert(
            "Message Sent",
            "We'll get back to you as soon as possible!"
        );
        setName("");
        setEmail("");
        setMessage("");
    };

    const openLink = (url: string) => {
        Linking.openURL(url).catch(() =>
            Alert.alert("Error", "Could not open link")
        );
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.container}
        >
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backBtn}
                >
                    <ChevronLeft size={24} color={COLORS.textMain} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>About & Contact</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                {/* Hero Section */}
                <View style={styles.heroSection}>
                    <Text style={styles.mainTitle}>
                        Hello from {APP_INFO.name}
                    </Text>
                    <Text style={styles.subtitle}>
                        We're on a mission to democratize creativity through the
                        power of AI.
                    </Text>
                </View>

                {/* Stats Grid */}
                <View style={styles.statsGrid}>
                    <StatBox
                        icon={
                            <MessageSquare size={18} color={COLORS.primary} />
                        }
                        value="100k+"
                        label="Artworks"
                    />
                    <StatBox
                        icon={<Star size={18} color={COLORS.primary} />}
                        value="4.8"
                        label="Rating"
                    />
                    <StatBox
                        icon={<Globe size={18} color={COLORS.primary} />}
                        value="12"
                        label="Countries"
                    />
                </View>

                {/* Mission Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Our Vision</Text>
                    <View style={styles.missionCard}>
                        <Text style={styles.missionText}>
                            {APP_INFO.name} empowers everyone to be an artist.
                            By combining intuitive design with cutting-edge
                            generative AI, we transform your vision into reality
                            instantly.
                        </Text>
                    </View>
                </View>

                {/* Team Section */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>The Creative Minds</Text>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.teamScroll}
                    >
                        <TeamMember
                            name="Sarah J."
                            role="CEO"
                            image="https://i.pravatar.cc/150?u=sarah"
                        />
                        <TeamMember
                            name="David K."
                            role="AI Lead"
                            image="https://i.pravatar.cc/150?u=david"
                        />
                        <TeamMember
                            name="Elena R."
                            role="Design"
                            image="https://i.pravatar.cc/150?u=elena"
                        />
                        <TeamMember
                            name="Marcus T."
                            role="Eng"
                            image="https://i.pravatar.cc/150?u=marcus"
                        />
                    </ScrollView>
                </View>

                {/* Support Channels */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Quick Support</Text>
                    <View style={styles.contactRow}>
                        <ContactMethod
                            title="Email Us"
                            sub={APP_INFO.supportEmail}
                            icon={<Mail color={COLORS.white} size={20} />}
                            color={COLORS.primary}
                            onPress={() =>
                                openLink(`mailto:${APP_INFO.supportEmail}`)
                            }
                        />
                        <ContactMethod
                            title="Twitter"
                            sub={APP_INFO.twitterHandle}
                            icon={<Twitter color={COLORS.white} size={20} />}
                            color="#1DA1F2"
                            onPress={() =>
                                openLink(
                                    `https://twitter.com/${APP_INFO.twitterHandle.replace(
                                        "@",
                                        ""
                                    )}`
                                )
                            }
                        />
                    </View>
                </View>

                {/* Message Form */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Direct Message</Text>
                    <View style={styles.formCard}>
                        <TextInput
                            style={styles.input}
                            placeholder="Your Name"
                            placeholderTextColor={COLORS.textGray}
                            value={name}
                            onChangeText={setName}
                        />
                        <TextInput
                            style={styles.input}
                            placeholder="Email Address"
                            placeholderTextColor={COLORS.textGray}
                            value={email}
                            onChangeText={setEmail}
                            keyboardType="email-address"
                        />
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            placeholder="Tell us what's on your mind..."
                            placeholderTextColor={COLORS.textGray}
                            value={message}
                            onChangeText={setMessage}
                            multiline
                        />
                        <TouchableOpacity onPress={handleSendMessage}>
                            <LinearGradient
                                colors={[COLORS.primary, COLORS.primaryLight]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={styles.sendBtn}
                            >
                                <Text style={styles.sendBtnText}>
                                    Submit Message
                                </Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Footer */}
                <View style={styles.footer}>
                    <View style={styles.badgeRow}>
                        <Award size={14} color={COLORS.textGray} />
                        <Text style={styles.footerText}>Best AI App 2024</Text>
                    </View>
                    <Text style={styles.footerSubText}>
                        v{APP_INFO.version} • Built with ❤️ by {APP_INFO.name}{" "}
                        Inc.
                    </Text>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

// Sub-components
const StatBox = ({ icon, value, label }: any) => (
    <View style={styles.statBox}>
        <View style={styles.statIconWrapper}>{icon}</View>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
    </View>
);

const TeamMember = ({ name, role, image }: any) => (
    <View style={styles.teamMember}>
        <Image source={{ uri: image }} style={styles.memberImg} />
        <Text style={styles.memberName}>{name}</Text>
        <Text style={styles.memberRole}>{role}</Text>
    </View>
);

const ContactMethod = ({ title, sub, icon, color, onPress }: any) => (
    <TouchableOpacity
        style={[styles.contactCard, { borderColor: color + "33" }]}
        onPress={onPress}
    >
        <View style={[styles.contactIcon, { backgroundColor: color }]}>
            {icon}
        </View>
        <View>
            <Text style={styles.contactCardTitle}>{title}</Text>
            <Text style={styles.contactCardSub}>{sub}</Text>
        </View>
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.white },
    header: {
        flexDirection: "row",
        height: 60,
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 15,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
    },
    backBtn: { padding: 8 },
    headerTitle: { fontSize: 18, fontWeight: "800", color: COLORS.textMain },
    scrollContent: { padding: 20, paddingBottom: 40 },
    heroSection: { alignItems: "center", marginBottom: 30 },
    mainTitle: {
        fontSize: 32,
        fontWeight: "900",
        color: COLORS.textMain,
        marginBottom: 10,
    },
    subtitle: {
        fontSize: 16,
        color: COLORS.textGray,
        textAlign: "center",
        lineHeight: 22,
        paddingHorizontal: 10,
    },
    statsGrid: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 35,
    },
    statBox: {
        width: "31%",
        backgroundColor: "#F9F9FF",
        padding: 15,
        borderRadius: 20,
        alignItems: "center",
    },
    statIconWrapper: { marginBottom: 8 },
    statValue: { fontSize: 18, fontWeight: "800", color: COLORS.textMain },
    statLabel: { fontSize: 12, color: COLORS.textGray, marginTop: 2 },
    section: { marginBottom: 35 },
    sectionLabel: {
        fontSize: 18,
        fontWeight: "800",
        color: COLORS.textMain,
        marginBottom: 15,
    },
    missionCard: {
        padding: 20,
        borderRadius: 20,
        backgroundColor: COLORS.cardBg,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    missionText: { fontSize: 15, color: "#444", lineHeight: 24 },
    teamScroll: { marginLeft: -5 },
    teamMember: { alignItems: "center", marginRight: 25 },
    memberImg: {
        width: 70,
        height: 70,
        borderRadius: 35,
        marginBottom: 10,
        borderWidth: 3,
        borderColor: COLORS.border,
    },
    memberName: { fontSize: 15, fontWeight: "700", color: COLORS.textMain },
    memberRole: { fontSize: 12, color: COLORS.textGray },
    contactRow: { flexDirection: "row", justifyContent: "space-between" },
    contactCard: {
        width: "48%",
        padding: 12,
        borderRadius: 15,
        borderWidth: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    contactIcon: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: "center",
        alignItems: "center",
    },
    contactCardTitle: {
        fontSize: 13,
        fontWeight: "700",
        color: COLORS.textMain,
    },
    contactCardSub: { fontSize: 11, color: COLORS.textGray },
    formCard: { gap: 15 },
    input: {
        backgroundColor: "#F5F5F7",
        borderRadius: 15,
        padding: 16,
        fontSize: 15,
        color: COLORS.textMain,
    },
    textArea: { height: 120, textAlignVertical: "top" },
    sendBtn: { padding: 18, borderRadius: 15, alignItems: "center" },
    sendBtnText: { color: COLORS.white, fontSize: 16, fontWeight: "800" },
    footer: { alignItems: "center", marginTop: 20 },
    badgeRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginBottom: 8,
    },
    footerText: { fontSize: 13, fontWeight: "600", color: COLORS.textGray },
    footerSubText: { fontSize: 12, color: "#C7C7CC" },
});
