# ArtLens — On-Device Neural Style Transfer Engine

[![Expo SDK](https://img.shields.io/badge/Expo-SDK%2055-000000?style=flat-square&logo=expo)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React%20Native-0.83.6-61DAFB?style=flat-square&logo=react)](https://reactnative.dev/)
[![VisionCamera](https://img.shields.io/badge/VisionCamera-v5%20Nitro-blueviolet?style=flat-square)](https://react-native-vision-camera.com/)
[![TFLite](https://img.shields.io/badge/Fast%20TFLite-v3-orange?style=flat-square)](https://github.com/mrousavy/react-native-fast-tflite)
[![Target Architecture](https://img.shields.io/badge/Architecture-arm64--v8a-purple?style=flat-square)](https://github.com/ArtLens-Turn-Every-Frame-Into-Fine-Art/ArtLens-Frontend)
[![Platform Support](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-green?style=flat-square)](https://github.com/ArtLens-Turn-Every-Frame-Into-Fine-Art/ArtLens-Frontend)

**ArtLens** is a AI mobile application that transforms standard photography into high-fidelity artistic masterpieces using deep learning. Developed as an engineering Final Year Project (ID: **F25SE004**) for the BSSE program at the University of Central Punjab, ArtLens implements a cutting-edge **coarse-to-fine guided upsampling pipeline** to execute high-resolution Neural Style Transfer (NST) locally on consumer mobile hardware.

By running inference completely edge-side, the system guarantees network isolation, zero server-latency processing dependencies, and total user data privacy.

> [!IMPORTANT]
> **ArtLens cannot run inside Expo Go.** The codebase depends on low-level native layers — JSI Nitro Modules, VisionCamera v5, and Fast TFLite v3 — that require a **custom development build**. You must run `npx expo prebuild` followed by `npx expo run:android` or `npx expo run:ios` on a physical device. Emulators and simulators **will not work** due to missing native camera hardware and hardware-accelerated TFLite delegates (NNAPI / CoreML).

---

## Feature Highlights

- **True edge-AI inference.** No user imagery or model weights leave the device during the style-transfer lifecycle.
- **High-resolution output with a single forward pass.** The coarse-to-fine pipeline processes a 4K source image through one global TFLite pass.
- **Dual-slot inference engine.** A teacher (main) slot handles high-fidelity final transformations via NNAPI / CoreML delegates. A student (preview) slot runs a smaller model on XNNPACK CPU threads for fast, low-impact previews without contending for GPU resources (in-development).
- **Battery-aware resource guarding.** The main inference slot is blocked when battery ≤ 5% or low-power mode (battery-saver) is active. Affected jobs transition to `BATTERY_PAUSED` and auto-resume when power is restored.
- **Persistent asynchronous queue.** Style jobs survive app restarts and OS terminations, backed by MMKV for zero-latency persistence.
- **Delta manifest sync.** The style catalogue is kept up to date via a cryptographic hash comparison. Only new or modified `.tflite` weights are downloaded, through a dual-stream concurrency-limited download pipeline.
- **VisionCamera v5 viewfinder.** Full-screen native capture with dynamic flash (Off / On / Auto), front/back lens switching, and battery-level UI guards.

---

## Tech Stack

| Layer            | Technology                                      | Version            |
| ---------------- | ----------------------------------------------- | ------------------ |
| Core framework   | React Native (Expo)                             | SDK 55 / RN 0.83.6 |
| Language         | TypeScript strict mode                          | ~5.9.2             |
| Routing          | Expo Router (file-system)                       | ~55.0.16           |
| Camera           | `react-native-vision-camera` v5 (Nitro Modules) | ^5.0.9             |
| ML inference     | `react-native-fast-tflite` v3 (Nitro Modules)   | ^3.0.1             |
| Graphics / GPU   | `@shopify/react-native-skia`                    | ^2.6.2             |
| Animations       | `react-native-reanimated`                       | ^4.3.1             |
| State management | Zustand                                         | ^5.0.5             |
| Persistence      | `react-native-mmkv` (Nitro)                     | ^4.3.1             |
| Nitro core       | `react-native-nitro-modules`                    | ^0.35.6            |
| Nitro image      | `react-native-nitro-image`                      | ^0.14.0            |

### Why Nitro Modules?

VisionCamera v5 and Fast TFLite v3 are both built on [Nitro Modules](https://nitro.margelo.com/), a high-performance JSI bridge that replaces the legacy React Native bridge with zero-copy typed interfaces between JavaScript and native code. This eliminates serialisation overhead on the critical path — frame capture and tensor I/O are handled without any JSON marshalling.

---

## Native Configuration

### Permissions (`app.json`)

**Android** (`android.permissions`):

| Permission                                 | Purpose                           |
| ------------------------------------------ | --------------------------------- |
| `CAMERA`                                   | Live viewfinder and photo capture |
| `INTERNET` + `ACCESS_NETWORK_STATE`        | Manifest sync and model downloads |
| `FOREGROUND_SERVICE` + `WAKE_LOCK`         | Background queue processing       |
| `READ_MEDIA_IMAGES` / `WRITE_MEDIA_IMAGES` | Gallery access and saving results |

**iOS** (`ios.infoPlist`):

| Key                                      | Purpose                                  |
| ---------------------------------------- | ---------------------------------------- |
| `NSCameraUsageDescription`               | Live viewfinder and photo capture        |
| `NSPhotoLibraryUsageDescription`         | Gallery selection                        |
| `NSPhotoLibraryAddUsageDescription`      | Saving stylised images                   |
| `UIBackgroundModes: [processing, fetch]` | Background queue continuation            |
| `BGTaskSchedulerPermittedIdentifiers`    | iOS background task scheduler identifier |

### Plugins

The following `app.json` plugins are required for native build generation:

| Plugin                     | Purpose                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `react-native-fast-tflite` | Enables Android GPU delegate libraries (`libOpenCL.so`, `libGLES_mali.so`)     |
| `expo-build-properties`    | Android: `largeHeap`, `minSdkVersion 29`, `arm64-v8a` only, ProGuard, JVM heap |
| `expo-image-picker`        | JPEG/PNG/JPG media picker with crop toolbar                                    |
| `expo-share-intent`        | Handles incoming `image/*` share intents on Android                            |

### Metro Configuration (`metro.config.js`)

`.tflite` model files are binary assets that Metro's default JavaScript resolver would reject. The config explicitly registers the extension as a static asset:

```js
// metro.config.js
const config = getDefaultConfig(__dirname)
config.resolver.assetExts.push('tflite')
module.exports = config
```

Without this line, any `require('./model.tflite')` or file-system access to a bundled `.tflite` asset will throw at build time.

---

## Architecture

```
app/
├── (tabs)/                        Persistent tab bar views
│   ├── home.tsx                   Entry screen
│   ├── camera.tsx                 VisionCamera v5 viewfinder + photo capture
│   ├── gallery.tsx                Style job queue and results
│   ├── styles.tsx                 Style catalogue + manifest sync
│   └── settings.tsx               User preferences
├── (screens)/                     Modal workflow screens
│   ├── StyleSelectionScreen.tsx   Pick a style → enqueue a job
│   ├── refine.tsx                 Blend intensity slider (Skia)
│   ├── edit-canvas.tsx            Before/after compare slider
│   ├── export.tsx                 Share / save to gallery
│   ├── about-contact.tsx          App info and contact form
│   └── background-generator.tsx   Background style generation screen
├── expo-sharing.tsx               Deep-link handler for incoming share intents
└── index.tsx                      Root entry point / redirect
│
context/
└── ContactContext.tsx             React context for contact form state
│
core/
├── inference/
│   ├── InferenceEngine.ts         Dual-slot TFLite lifecycle manager
│   └── CoarseToFineRunner.ts      7-phase inference pipeline
├── postprocess/
│   └── GuidedUpsamplePass.ts      Skia cubic upscale + blend injection
└── storage/
    └── ModelManager.ts            Manifest delta-sync + download multiplexer
│
features/
├── gallery/
│   └── components/                Gallery job list UI components
├── home/
│   └── components/                Home screen UI components
├── style-selection/
│   └── components/                Style picker card and skeleton components
├── style-transfer/
│   └── StyleJobService.ts         Background queue state machine
├── styles/
│   └── components/                Style catalogue grid and detail sheet
└── upload/
    └── hooks/
        └── useImageSelection.ts   Image picker hook (camera + library)
│
shared/
├── stores/                        Zustand reactive global state
│   ├── useStyleJobStore.ts        Job queue (QUEUED → PROCESSING → DONE)
│   ├── useModelStore.ts           Model catalogue and download status
│   └── useBatteryStore.ts         Battery level and power-saver monitor
├── ui/                            Reusable UI primitives and design tokens
│   ├── DesignTokens.ts            Colour palette, typography, spacing constants
│   ├── FormatPicker.tsx           Export format selector component
│   ├── ImageCompareSlider.tsx     Before/after swipe comparison widget
│   ├── QueueStat.tsx              Queue statistics display pill
│   ├── Row.tsx                    Flex row layout helper
│   ├── Section.tsx                Titled section wrapper
│   └── index.ts                  Barrel export
└── utils/
    ├── tensorUtils.ts             Float32 buffer allocation and normalisation
    ├── constants.ts               Inference delegates, thresholds, limits
    ├── config.ts                  Runtime environment configuration
    ├── logger.ts                  Structured logging wrapper
    ├── MediaPicker.ts             Camera / gallery media selection helpers
    └── storageKeys.ts             MMKV key constants
│
services/
└── api.ts                         Fetch-based manifest sync client
│
types/
├── index.ts                       Shared TypeScript type definitions
└── react-native-logger.d.ts       Type declarations for the logger module
```

### The Coarse-to-Fine Inference Pipeline

The core insight is that running the style model on the full-resolution image is not feasible on mobile, but the prior solution — tiling the image and stitching the results — breaks Instance Normalisation. Each tile computes its own mean and variance, so a uniformly dark tile and a uniformly bright tile receive the same colour treatment, creating visible seams at every boundary.

The coarse-to-fine pipeline solves this with a single global forward pass:

```
Phase 0  CONFIG      getModelConfig(styleId) → inferenceRes (e.g. 512)
Phase 1  DECODE      sourceUri → SkImage (full-res, native Skia surface)
Phase 2  DOWNSAMPLE  SkImage → modelDim×modelDim via drawImageRectCubic (bicubic)
                     readPixels → scratchRgba Uint8Array  [modelDim²×4]
                     guideSkImage kept alive for Phase 6
Phase 3  NORMALISE   prepareInputTensor: pixel/127.5 − 1.0 → float32 NHWC [-1, 1]
Phase 4  INFER       runInferenceSync(slot, inputBuf) → rawOutput
                     ONE forward pass  (vs ≈56 passes for native-res tiling)
                     InstanceNorm sees GLOBAL image statistics → no seams
Phase 5  DENORM      (v + 1.0) × 0.5 × 255 → RGBA Uint8 [modelDim²×4]
                     + optional YCbCr luma transfer for Van Gogh colour preservation
Phase 6  UPSAMPLE    GuidedUpsamplePass: drawImageRectCubic (512 → native res)
                     + style-adaptive guide injection via Skia BlendMode
                        Baroque   → none  (smooth chiaroscuro, no halos)
                        Van Gogh  → SoftLight @ 22% alpha
                        Anime     → Multiply @ 55% alpha (crisp ink outlines)
Phase 7  EXPORT      encodeToBytes(JPEG) → cache URI
```

**Peak memory budget (4K source, 512px model):**

| Allocation              | Size       |
| ----------------------- | ---------- |
| Full-res guide SkImage  | ~31.6 MB   |
| Downscaled RGBA scratch | ~1.0 MB    |
| Float32 input buffer    | ~3.1 MB    |
| Float32 output buffer   | ~3.1 MB    |
| Denorm RGBA (512×512)   | ~1.0 MB    |
| Output surface (4K)     | ~31.6 MB   |
| **Peak working set**    | **~71 MB** |

Compare this to the tile-based approach, which requires loading the full-resolution image into memory _and_ processing ~56 independent tiles, resulting in a 3+ GB working set on a 4K source.

### Dual-Slot Inference Engine (`InferenceEngine.ts`)

The engine manages two mutually exclusive model slots. Both models can never coexist in native memory. The slot releasing the opposing model does so **synchronously before any `await`**, exploiting JavaScript's single-threaded execution model to guarantee atomic exclusivity.

| Slot      | Model                  | Delegates                                                  | Purpose                               |
| --------- | ---------------------- | ---------------------------------------------------------- | ------------------------------------- |
| `main`    | Teacher (~512px input) | NNAPI (Android) / CoreML (iOS), GPU fallback, CPU fallback | Final high-fidelity transformations   |
| `preview` | Student (~256px input) | XNNPACK CPU only                                           | Fast live previews, no GPU contention |

Key behaviours:

- **Battery guard (main slot only).** If battery ≤ `CRITICAL_THRESHOLD_PERCENT` (5%), `loadMainModel` throws `BatteryGuardError` before touching the native runtime.
- **Platform-safe delegate arrays.** CoreML is iOS-only; NNAPI/GPU is Android-only. The engine uses `Platform.select` to guarantee each platform receives only its valid delegates — passing mixed-platform arrays to Fast TFLite causes an immediate native exception.
- **Quantization detection.** On load, the engine reads the tensor `dataType` field (`uint8` / `int8` vs `float32`) and stores the result for downstream normalisation logic.

### Style Job Queue (`StyleJobService.ts`)

A module-level singleton that drives the background stylisation queue using a cooperative concurrency model:

- **`_processingLock`** — a synchronous boolean mutex gating queue entry. The guard check and flag assignment have no `await` between them, making the lock acquisition atomic under the JS event loop.
- **`_abortCurrentJob`** — a cooperative abort signal polled by the inference runner at pipeline milestones. Maximum abort latency is equal to one inference pass time (~50–200 ms with GPU delegates).
- **Job status lifecycle:** `QUEUED` → `PROCESSING` → `DONE | ERROR | BATTERY_PAUSED`
- **`BATTERY_PAUSED` jobs** are resumed automatically via `resumeAll()` when the battery store reports recovery.
- **Preview jobs** (`PREVIEW_QUEUED`) are routed to the student model slot and take priority over main jobs in the dequeue order.

---

## Getting Started

### Prerequisites

- **Node.js** v22+
- **Android Studio** (for Android builds) with SDK 29–36 and NDK installed
- **Xcode 15+** and CocoaPods (for iOS builds)
- A **physical Android or iOS device** — emulators and simulators will not work due to missing native camera hardware and hardware-accelerated TFLite delegates

### Installation

```bash
git clone https://github.com/ArtLens-Turn-Every-Frame-Into-Fine-Art/ArtLens-Frontend.git
cd ArtLens-Frontend

npm ci
```

Create a `.env` file in the project root:

```env
EXPO_PUBLIC_API_BASE=https://artlens-backend-link.com
```

### Building and Running

Because ArtLens uses native modules that require a custom development build, you **cannot** use `expo start` alone for the first run. You must generate the native project and compile it:

```bash
# Step 1: generate native Android/iOS project files
npx expo prebuild

# Step 2: compile and install on a connected device
npx expo run:android        # Android debug build
npx expo run:ios            # iOS debug build (requires macOS + Xcode)
```

After the native build is installed on your device, you can use `npx expo start` for subsequent JS-only changes via Metro's fast refresh.

| Script                      | Description                                                 |
| --------------------------- | ----------------------------------------------------------- |
| `npm run android`           | Standard Android debug build                                |
| `npm run android:optimized` | Performance-profiled debug build (`debugOptimized` variant) |
| `npm run android:release`   | Production release build (ProGuard + minification enabled)  |
| `npm run ios`               | iOS debug build via Xcode / CocoaPods                       |

### Platform Requirements

| Platform | Minimum             | Notes                              |
| -------- | ------------------- | ---------------------------------- |
| Android  | API 29 (Android 10) | `arm64-v8a` architecture only      |
| iOS      | iOS 15.0            | Portrait + tablet layout supported |

---

## Backend Integration

The client syncs with a Node.js/Express orchestration service hosted on Render.

- **Base URL:** `https://artlens-backend-link.com`
- **`POST /api/models-manifest`** — delta sync gateway. Accepts `{ clientHash, localModels }`. Returns a structured payload of new/updated model URLs, or HTTP 304 when the client is already up to date.

Model binaries are streamed directly to the app's document directory via `expo-file-system` and indexed in a dedicated MMKV instance. A concurrency-limited download semaphore (max 2 simultaneous streams) prevents bandwidth saturation during large batch updates. Dynamic `Content-Length` probing before each download session enables accurate per-model progress reporting.

---

## Troubleshooting

**"App Not Installed" on Android**
The release build targets `arm64-v8a` exclusively. Devices with 32-bit ARM or x86 architectures are not supported.

**Camera shows a permanent loading spinner**
Restart the app and verify that camera permission is explicitly granted in the device's OS settings. If denied, the app's settings screen provides a deep link to the system permission panel.

**Jobs stuck in QUEUED**
Navigate to the Gallery tab — the queue monitor re-evaluates stalled jobs on focus. Also verify battery level is above 5%; jobs in `BATTERY_PAUSED` will not advance until battery recovers or the device is plugged in.

**Build fails with "cannot find :react-native-fast-tflite" or similar**
Ensure `npx expo prebuild` has been run after any dependency change. The native `android/` and `ios/` directories must be regenerated for plugin config changes (including the `react-native-fast-tflite` GPU library list in `app.json`) to take effect.

For further bug reporting, navigate to **Settings → About → Contact Us** within the app.

---

**Project Attribution:** ArtLens · F25SE004 · University of Central Punjab
