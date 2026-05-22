# MarkerScanner

An Android app built with React Native that detects a custom visual marker (Marker 1) using the device camera, extracts and corrects its orientation, and displays 20 captured markers in a grid.

## What It Does
- Live camera feed at 2000px+ resolution
- Real-time marker detection via frame processor (480×270 downscaled processing)
- Orientation correction using the corner dot position (top-left = 0°, top-right = 90°, bottom-right = 180°, bottom-left = 270°)
- Perspective transform via native OpenCV module
- Displays 20 captured markers at exactly 300×300px

## The Marker
Marker 1: A 140×140 unit square black border frame with a 20×20 unit solid black dot in one corner. The dot position indicates orientation.

## Tech Stack
- React Native CLI (Android only)
- react-native-vision-camera v4 (frame processing)
- react-native-worklets-core (worklet thread)
- expo-image-manipulator (crop, rotate, resize)
- react-native-fs (file storage)
- OpenCV (native Android module — perspective transform)

## Project Structure
src/
screens/
CameraScreen.tsx       — camera feed + detection worklet
ResultsScreen.tsx      — 4-column grid of 20 captured markers
utils/
imageProcessorPerspective.ts — crop, rotate, resize pipeline
android/
app/src/main/java/.../
PerspectiveTransformModule.java — native OpenCV module

## Setup & Installation
See [SETUP.md](SETUP.md) for full setup instructions, APK installation, and build steps.
