# Setup & Installation

## Prerequisites
- Node.js 18+
- Android Studio with Android SDK (API 26+)
- Java 17
- An Android device (API 26+) or emulator with camera support
- ADB installed and in PATH

## Install Dependencies
```bash
npm install
```

## Run on Device (Development)
1. Connect Android device via USB with USB debugging enabled
2. Run:
```bash
npm run android
```

## Build Release APK
```bash
cd android
gradlew assembleRelease
```
APK output: `android/app/build/outputs/apk/release/app-release.apk`

## Install APK on Device
```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```
Or copy the APK to your phone and install manually (enable "Install from unknown sources" in Settings).

## Permissions Required
- Camera (requested at runtime on first launch)
- Read/Write External Storage (for saving captured markers)

## Troubleshooting
**Camera permission denied:** Go to Settings → Apps → MarkerScanner → Permissions → Enable Camera.

**App crashes on launch:** Ensure your device runs Android 8.0 (API 26) or higher.

**Marker not detected:** Ensure good lighting. Hold the camera 15–30cm from the printed marker. The marker should fill at least 20% of the frame.

**Build fails with CMake error:** Run `cd android && gradlew clean` then retry assembleRelease.
