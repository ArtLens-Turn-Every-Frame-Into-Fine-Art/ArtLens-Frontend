import { BlurView } from "expo-blur";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { Layers, RotateCw, X, Zap } from "lucide-react-native";
import React, { useState } from "react";
import {
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// 1. Import global constants
import { COLORS, LAYOUT } from "@/utils/constants";

const FILTERS = [
    { id: "1", name: "Impression", image: "https://picsum.photos/id/10/200" },
    { id: "2", name: "Cyberpunk", image: "https://picsum.photos/id/1044/200" },
    { id: "3", name: "Oil Paint", image: "https://picsum.photos/id/1025/200" },
    { id: "4", name: "Sketch", image: "https://picsum.photos/id/1062/200" },
    { id: "5", name: "Classic", image: "https://picsum.photos/id/1081/200" },
];

export default function CameraScreen() {
    const insets = useSafeAreaInsets();
    const [permission, requestPermission] = useCameraPermissions();
    const [activeFilter, setActiveFilter] = useState("2");
    const [facing, setFacing] = useState<"front" | "back">("back");

    if (!permission) return <View style={styles.blackBg} />;

    if (!permission.granted) {
        return (
            <View style={styles.center}>
                <Zap
                    size={48}
                    color={COLORS.primary}
                    style={{ marginBottom: 20 }}
                />
                <Text style={styles.whiteText}>
                    Camera access is required to create art.
                </Text>
                <TouchableOpacity
                    style={styles.permissionBtn}
                    onPress={requestPermission}
                >
                    <Text style={styles.permissionBtnText}>Enable Camera</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <CameraView style={styles.absoluteFill} facing={facing}>
                {/* Top Controls Overlay - Uses insets.top for notch safety */}
                <View
                    style={[
                        styles.topOverlay,
                        { paddingTop: insets.top || 20 },
                    ]}
                >
                    <TouchableOpacity
                        style={styles.glassBtn}
                        onPress={() => router.back()}
                    >
                        <X color={COLORS.white} size={22} />
                    </TouchableOpacity>

                    <BlurView
                        intensity={30}
                        tint="dark"
                        style={styles.modeBadge}
                    >
                        <View style={styles.activeDot} />
                        <Text style={styles.modeText}>AI LIVE PREVIEW</Text>
                    </BlurView>

                    <TouchableOpacity
                        style={styles.glassBtn}
                        onPress={() =>
                            setFacing(facing === "back" ? "front" : "back")
                        }
                    >
                        <RotateCw color={COLORS.white} size={22} />
                    </TouchableOpacity>
                </View>

                {/* Bottom UI Area - Uses insets.bottom for home indicator safety */}
                <View
                    style={[
                        styles.bottomArea,
                        { paddingBottom: insets.bottom || 40 },
                    ]}
                >
                    {/* Filter Selector */}
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.filterScroll}
                    >
                        {FILTERS.map((f) => (
                            <TouchableOpacity
                                key={f.id}
                                onPress={() => setActiveFilter(f.id)}
                                style={styles.filterItem}
                            >
                                <View
                                    style={[
                                        styles.filterRing,
                                        activeFilter === f.id && {
                                            borderColor: COLORS.primary,
                                        },
                                    ]}
                                >
                                    <Image
                                        source={{ uri: f.image }}
                                        style={styles.filterImg}
                                    />
                                </View>
                                <Text
                                    style={[
                                        styles.filterLabel,
                                        activeFilter === f.id && {
                                            color: COLORS.primary,
                                            fontWeight: "800",
                                        },
                                    ]}
                                >
                                    {f.name}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>

                    {/* Main Actions */}
                    <View style={styles.actionRow}>
                        <TouchableOpacity
                            style={styles.sideAction}
                            onPress={() => router.push("/BackgroundGenerator")}
                        >
                            <BlurView
                                intensity={20}
                                tint="light"
                                style={styles.sideIconBox}
                            >
                                <Layers color={COLORS.white} size={24} />
                            </BlurView>
                            <Text style={styles.sideText}>BG Gen</Text>
                        </TouchableOpacity>

                        {/* Shutter Button */}
                        <TouchableOpacity
                            style={styles.shutterOuter}
                            activeOpacity={0.8}
                            onPress={() => router.push("/EditCanvas")}
                        >
                            <View style={styles.shutterInner} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.sideAction}
                            onPress={() => router.push("/GalleryScreen")}
                        >
                            <Image
                                source={{
                                    uri: "https://picsum.photos/id/64/100",
                                }}
                                style={styles.galleryPreview}
                            />
                            <Text style={styles.sideText}>Gallery</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </CameraView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.black },
    absoluteFill: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    blackBg: { flex: 1, backgroundColor: COLORS.black },
    center: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: COLORS.black,
        padding: 40,
    },
    whiteText: {
        color: COLORS.white,
        fontSize: 16,
        textAlign: "center",
        marginBottom: 30,
        opacity: 0.8,
    },
    permissionBtn: {
        backgroundColor: COLORS.primary,
        paddingHorizontal: 32,
        paddingVertical: 16,
        borderRadius: 30,
    },
    permissionBtnText: { color: COLORS.white, fontWeight: "800", fontSize: 16 },

    // Top Overlay
    topOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 20,
    },
    glassBtn: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: "rgba(255,255,255,0.15)",
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.2)",
    },
    modeBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 25,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.1)",
    },
    activeDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: "#00FF94", // Brand accent for "Live"
        marginRight: 8,
    },
    modeText: {
        color: COLORS.white,
        fontSize: 11,
        fontWeight: "900",
        letterSpacing: 1,
    },

    // Bottom Area
    bottomArea: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
    },
    filterScroll: {
        paddingHorizontal: 20,
        paddingBottom: 30,
    },
    filterItem: { alignItems: "center", marginRight: 20 },
    filterRing: {
        width: 66,
        height: 66,
        borderRadius: 33,
        borderWidth: 3,
        borderColor: "transparent",
        padding: 2,
        marginBottom: 8,
    },
    filterImg: { width: "100%", height: "100%", borderRadius: 30 },
    filterLabel: {
        color: COLORS.white,
        fontSize: 11,
        fontWeight: "600",
        opacity: 0.9,
    },

    actionRow: {
        flexDirection: "row",
        justifyContent: "space-evenly",
        alignItems: "center",
        paddingHorizontal: 20,
    },
    sideAction: { alignItems: "center", width: 70 },
    sideIconBox: {
        width: 50,
        height: 50,
        borderRadius: LAYOUT.borderRadius / 1.5,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
    },
    sideText: {
        color: COLORS.white,
        fontSize: 11,
        fontWeight: "700",
        marginTop: 8,
    },
    galleryPreview: {
        width: 50,
        height: 50,
        borderRadius: LAYOUT.borderRadius / 1.5,
        borderWidth: 2,
        borderColor: COLORS.white,
    },

    shutterOuter: {
        width: 88,
        height: 88,
        borderRadius: 44,
        borderWidth: 5,
        borderColor: COLORS.white,
        justifyContent: "center",
        alignItems: "center",
    },
    shutterInner: {
        width: 68,
        height: 68,
        borderRadius: 34,
        backgroundColor: COLORS.white,
    },
});
