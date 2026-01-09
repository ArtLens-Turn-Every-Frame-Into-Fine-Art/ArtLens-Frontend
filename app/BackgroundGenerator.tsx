import { BlurView } from "expo-blur";
import { router } from "expo-router";
import {
    ChevronLeft,
    Plus,
    RotateCcw,
    Scissors,
    Sparkles,
    UserCheck,
} from "lucide-react-native";
import React, { useState } from "react";
import {
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

// 1. Import global constants
import { COLORS, LAYOUT } from "@/utils/constants";

export default function BackgroundGenerator() {
    const [prompt, setPrompt] = useState("");
    const [keepSubject, setKeepSubject] = useState(true);
    const [selectedVariation, setSelectedVariation] = useState(0);

    const variations = [
        "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400",
        "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400",
        "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400",
    ];

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.container}
        >
            {/* Header - Aligned with root layout background */}
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backBtn}
                >
                    <ChevronLeft color={COLORS.textMain} size={28} />
                </TouchableOpacity>
                <View style={styles.titleContainer}>
                    <Text style={styles.headerTitle}>Background</Text>
                    <Text
                        style={[styles.headerTitle, { color: COLORS.primary }]}
                    >
                        Generator
                    </Text>
                </View>
                <TouchableOpacity>
                    <Text style={styles.resetText}>Reset</Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                {/* Main Preview Area */}
                <View style={styles.previewContainer}>
                    <Image
                        source={{
                            uri:
                                variations[selectedVariation] ||
                                "https://images.unsplash.com/photo-1473163928189-39a0c8a95641?w=800",
                        }}
                        style={styles.mainPreview}
                    />
                    <BlurView
                        intensity={60}
                        tint="dark"
                        style={styles.subjectBadge}
                    >
                        <UserCheck size={14} color="#00FF94" />
                        <Text style={styles.subjectBadgeText}>
                            Subject Isolated
                        </Text>
                    </BlurView>
                </View>

                {/* Prompt Section */}
                <View style={styles.section}>
                    <View style={styles.labelRow}>
                        <Text style={styles.sectionLabel}>AI PROMPT</Text>
                        <Sparkles size={14} color={COLORS.primary} />
                    </View>
                    <View style={styles.inputWrapper}>
                        <TextInput
                            style={styles.textInput}
                            placeholder="e.g., 'Cyberpunk city at night with neon lights'..."
                            placeholderTextColor={COLORS.textGray}
                            value={prompt}
                            onChangeText={setPrompt}
                            multiline
                        />
                    </View>
                </View>

                {/* Settings Toggle */}
                <View style={styles.toggleCard}>
                    <View style={styles.toggleLeft}>
                        <View style={styles.iconCircle}>
                            <Scissors size={18} color={COLORS.primary} />
                        </View>
                        <View>
                            <Text style={styles.toggleLabel}>Keep Subject</Text>
                            <Text style={styles.toggleSub}>
                                Maintain original person details
                            </Text>
                        </View>
                    </View>
                    <Switch
                        value={keepSubject}
                        onValueChange={setKeepSubject}
                        trackColor={{
                            false: COLORS.border,
                            true: COLORS.primary,
                        }}
                        thumbColor={COLORS.white}
                    />
                </View>

                {/* Variations Gallery */}
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>VARIATIONS</Text>
                    <View style={styles.variationRow}>
                        {variations.map((uri, index) => (
                            <TouchableOpacity
                                key={index}
                                style={[
                                    styles.variationThumb,
                                    selectedVariation === index && {
                                        borderColor: COLORS.primary,
                                    },
                                ]}
                                onPress={() => setSelectedVariation(index)}
                            >
                                <Image
                                    source={{ uri }}
                                    style={styles.variationImg}
                                />
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity style={styles.addVariation}>
                            <Plus size={24} color={COLORS.white} />
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>

            {/* Sticky Footer */}
            <View style={styles.footer}>
                <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => router.back()}
                >
                    <Text style={styles.cancelBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[
                        styles.regenerateBtn,
                        { backgroundColor: COLORS.primary },
                    ]}
                >
                    <RotateCcw size={18} color={COLORS.white} />
                    <Text style={styles.regenerateBtnText}>Regenerate</Text>
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background, // Match root layout
    },
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingBottom: 15,
        backgroundColor: COLORS.white,
    },
    backBtn: { marginLeft: -10, padding: 10 },
    titleContainer: { alignItems: "center" },
    headerTitle: {
        fontSize: 14,
        fontWeight: "900",
        color: COLORS.textMain,
        textTransform: "uppercase",
        letterSpacing: 1,
    },
    resetText: {
        color: COLORS.primary,
        fontWeight: "700",
        fontSize: 14,
    },
    scrollContent: {
        padding: LAYOUT.padding,
        paddingBottom: 120, // Extra space for sticky footer
    },
    previewContainer: {
        marginBottom: 25,
        borderRadius: LAYOUT.borderRadius,
        overflow: "hidden",
        backgroundColor: COLORS.border,
        elevation: 5,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
    },
    mainPreview: {
        width: "100%",
        height: 380,
        borderRadius: LAYOUT.borderRadius,
    },
    subjectBadge: {
        position: "absolute",
        top: 15,
        left: 15,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        overflow: "hidden",
    },
    subjectBadgeText: {
        color: COLORS.white,
        fontSize: 11,
        fontWeight: "700",
        marginLeft: 6,
    },
    section: { marginBottom: 25 },
    labelRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginBottom: 10,
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: "800",
        color: COLORS.textGray,
        letterSpacing: 0.5,
    },
    inputWrapper: {
        backgroundColor: COLORS.white,
        borderRadius: LAYOUT.borderRadius,
        padding: 15,
        minHeight: 100,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    textInput: {
        flex: 1,
        fontSize: 15,
        color: COLORS.textMain,
        textAlignVertical: "top",
        lineHeight: 22,
    },
    toggleCard: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: COLORS.white,
        padding: 16,
        borderRadius: 18,
        marginBottom: 25,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    toggleLeft: { flexDirection: "row", alignItems: "center", gap: 15 },
    iconCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: `${COLORS.primary}1A`, // 10% opacity
        justifyContent: "center",
        alignItems: "center",
    },
    toggleLabel: { fontSize: 16, fontWeight: "700", color: COLORS.textMain },
    toggleSub: { fontSize: 12, color: COLORS.textGray, marginTop: 2 },
    variationRow: { flexDirection: "row", gap: 12 },
    variationThumb: {
        width: 70,
        height: 70,
        borderRadius: 14,
        overflow: "hidden",
        borderWidth: 2,
        borderColor: "transparent",
    },
    variationImg: { width: "100%", height: "100%" },
    addVariation: {
        width: 70,
        height: 70,
        borderRadius: 14,
        backgroundColor: COLORS.textMain,
        justifyContent: "center",
        alignItems: "center",
    },
    footer: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: "row",
        paddingHorizontal: 20,
        paddingTop: 15,
        paddingBottom: 30,
        backgroundColor: "rgba(255,255,255,0.95)",
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
        gap: 12,
    },
    cancelBtn: {
        flex: 1,
        height: 54,
        borderRadius: 27,
        borderWidth: 1,
        borderColor: COLORS.border,
        justifyContent: "center",
        alignItems: "center",
    },
    cancelBtnText: { fontSize: 16, fontWeight: "700", color: COLORS.textMain },
    regenerateBtn: {
        flex: 2,
        height: 54,
        borderRadius: 27,
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 10,
        elevation: 4,
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    regenerateBtnText: { fontSize: 16, fontWeight: "700", color: COLORS.white },
});
