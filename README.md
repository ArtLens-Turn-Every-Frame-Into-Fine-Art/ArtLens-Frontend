# ArtLens — Turn Every Frame Into Fine Art

**ArtLens** is an AI-powered mobile application developed as a Final Year Project for the BSSE program at the University of Central Punjab. It leverages Deep Learning to transform real-time camera feeds and gallery images into high-quality fine art using Neural Style Transfer (NST) and Generative AI.

## 🚀 Overview

The project focuses on the intersection of Computer Vision and Mobile Computing. Unlike standard filter apps, ArtLens performs real-time semantic segmentation to separate subjects from backgrounds, allowing users to apply artistic styles to the foreground while using Stable Diffusion to generate custom backgrounds via text prompts.

### Key Features

-   **Real-time Style Transfer:** Apply famous artistic styles (e.g., Van Gogh, Picasso) to your live camera feed at 20-30 FPS.
-   **Prompt-Based Backgrounds:** Integration with Stable Diffusion API to generate unique environments from text descriptions.
-   **AI Segmentation:** Intelligent foreground/background separation using MediaPipe/DeepLabV3.
-   **High-Performance UI:** Built with React Native (Expo) and Shopify FlashList for smooth asset browsing.
-   **MERN Stack Backend:** Robust Node.js/Express backend for handling generative AI requests and user data.

---

## 🛠️ Tech Stack

**Frontend:**

-   **Framework:** React Native (Expo)
-   **Navigation:** Expo Router (File-based)
-   **Image Processing:** Expo Image

---

## 📂 Project Structure

```text
├── app/               # Expo Router screens (Camera, Edit, Gallery)
├── assets/            # ML Models, Fonts, and Images
├── components/        # Reusable UI components (Modals, Buttons)
├── hooks/             # Custom React hooks for ML logic
├── services/          # API services for Backend/Stable Diffusion
└── utils/             # Helper functions and Constants

```

---

## ⚙️ Getting Started

### Prerequisites

-   Node.js (v18+)
-   Expo Go app on your mobile device
-   NPM or Yarn

### Installation

1. **Clone the repository:**

```bash
git clone https://github.com/ArtLens/ArtLens-Frontend.git
cd ArtLens-Frontend

```

2. **Install Frontend Dependencies:**

```bash
npm ci

```

3. **Start the App:**

```bash
npx expo start

```

**OR**

```bash
npm run android release

```
