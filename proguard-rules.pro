# Keep JSI and C++ bridge methods from being stripped out
-keep class com.facebook.jni.HybridData { *; }
-keep class * extends com.facebook.jni.HybridData { *; }

# Keep react-native-fast-tflite bindings intact
-keep class com.tflite.** { *; }
-keep class com.mrousavy.camera.** { *; }
-dontwarn com.tflite.**

# Keep Margelo Nitro Modules infrastructure intact
-keep class com.margelo.nitro.** { *; }
-keep class com.artlens.ArtLens.** { *; }

# Keep Skia graphics framework targets
-keep class com.shopify.reactnative.skia.** { *; }
