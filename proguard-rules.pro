# ==============================================================================
# 1. CORE REACT NATIVE & JSI HYBRID ARCHITECTURE (Merged & Expanded)
# ==============================================================================
-keep class com.facebook.jni.HybridData { *; }
-keep class * extends com.facebook.jni.HybridData { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-dontwarn com.facebook.react.**

# Fix for local application package module stripping
-keep class com.artlens.artlens.** { *; }

# ==============================================================================
# 2. TENSORFLOW LITE (react-native-fast-tflite ^3.0.1)
# ==============================================================================
# Updated from old 'com.tflite.**' package structure to actual runtime bindings
-keep class org.tensorflow.lite.** { *; }
-dontwarn org.tensorflow.lite.**

# ==============================================================================
# 3. SHOPIFY SKIA GRAPHICS FRAMEWORK (From Old File)
# ==============================================================================
-keep class com.shopify.reactnative.skia.** { *; }
-dontwarn com.shopify.reactnative.skia.**

# ==============================================================================
# 4. VISION CAMERA & WORKLETS PIPELINE
# ==============================================================================
-keep class com.mrousavy.camera.** { *; }
-keep class com.mrousavy.camera.frameprocessors.** { *; }
-dontwarn com.mrousavy.camera.**

# ==============================================================================
# 5. MARGELO NITRO MODULES INFRASTRUCTURE
# ==============================================================================
-keep class com.margelo.nitro.** { *; }
-dontwarn com.margelo.nitro.**

# ==============================================================================
# 6. MMKV RAPID STORAGE SYSTEM
# ==============================================================================
-keep class com.tencent.mmkv.** { *; }
-keep class com.reactnativemmkv.** { *; }
-dontwarn com.tencent.mmkv.**
