  import React, { useCallback, useEffect, useRef, useState } from 'react';
  import {
    ActivityIndicator,
    Animated,
    Dimensions,
    Linking,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
  } from 'react-native';
  import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
  import { Worklets, useSharedValue } from 'react-native-worklets-core';
  import { Gesture, GestureDetector } from 'react-native-gesture-handler';
  import type { StackNavigationProp } from '@react-navigation/stack';
  import { useNavigation } from '@react-navigation/native';
  import {
    Camera,
    useCameraDevice,
    useCameraFormat,
    useCameraPermission,
    useFrameProcessor,
  } from 'react-native-vision-camera';
import { extractAndProcessMarkerPerspective } from '../utils/imageProcessorPerspective';
  import type { DetectionResult, RootStackParamList } from '../types';

  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
  const VIEWFINDER_SIZE = SCREEN_WIDTH * 0.8;
  const VIEWFINDER_TOP = (SCREEN_HEIGHT - VIEWFINDER_SIZE) / 2;
  const VIEWFINDER_SIDE = (SCREEN_WIDTH - VIEWFINDER_SIZE) / 2;
  const CORNER_LENGTH = 20;
  const CORNER_THICKNESS = 2;
  const OVERLAY_COLOR = 'rgba(0, 0, 0, 0.55)';
  const BOTTOM_BAR_HEIGHT = 120;

  export const CameraScreen = () => {
    // ── Navigation ─────────────────────────────────────────────────────────────
    const navigation = useNavigation<StackNavigationProp<RootStackParamList, 'Camera'>>();

    // ── Shared Values ──────────────────────────────────────────────────────────
    const frameCounter = useSharedValue(0);
    const lastDetectionTime = useSharedValue(0);
    const lastProcessTime = useSharedValue(0); // For 250ms throttle
    const isProcessing = useSharedValue(false); // Mutex lock to prevent buffer overflow
    const lastStatus = useSharedValue<'SEARCHING' | 'TRACKING' | 'CAPTURED'>('SEARCHING'); // Track status changes

    // ── State ──────────────────────────────────────────────────────────────────
    const [capturedCount, setCapturedCount] = useState<number>(0);
    const [isScanning, setIsScanning] = useState<boolean>(true);
    const [capturedImages, setCapturedImages] = useState<string[]>([]);
    const [detectionBox, setDetectionBox] = useState<{
      x: number; y: number; w: number; h: number;
    } | null>(null);
    const [lockedExposure, setLockedExposure] = useState<number | undefined>(undefined);
    const [status, setStatus] = useState<'SEARCHING' | 'TRACKING' | 'CAPTURED'>('SEARCHING');

    // ── Refs ───────────────────────────────────────────────────────────────────
    const cameraRef = useRef<Camera>(null);
    const capturedImagesRef = useRef<string[]>(capturedImages);
    
    // ── Focus circle state ─────────────────────────────────────────────────────
    const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
    const focusCircleAnim = useRef(new Animated.Value(0)).current;
    

    useEffect(() => {
      capturedImagesRef.current = capturedImages;
    }, [capturedImages]);

    // ── Flash animation ────────────────────────────────────────────────────────
    const flashAnim = useRef(new Animated.Value(0)).current;

    const triggerCaptureFlash = useCallback(() => {
      Animated.sequence([
        Animated.timing(flashAnim, {
          toValue: 0.4,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(flashAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }, [flashAnim]);

    // ── Corner animation ───────────────────────────────────────────────────────
    const cornerAnim = useRef(new Animated.Value(0)).current;

    const triggerCornerAnimation = useCallback(() => {
      Animated.sequence([
        Animated.timing(cornerAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: false,
        }),
        Animated.timing(cornerAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: false,
        }),
      ]).start();
    }, [cornerAnim]);

    // ── Status text pulse animation ────────────────────────────────────────────
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
      if (isScanning) {
        const pulseLoop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 0.5,
              duration: 750,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 1.0,
              duration: 750,
              useNativeDriver: true,
            }),
          ]),
        );
        pulseLoop.start();

        return () => {
          pulseLoop.stop();
          pulseAnim.setValue(1);
        };
      } else {
        pulseAnim.setValue(1);
      }
    }, [isScanning, pulseAnim]);

    // ── Reticle animation (state-driven) ───────────────────────────────────────
    const reticleScale = useRef(new Animated.Value(1)).current;
    const reticleOpacity = useRef(new Animated.Value(1)).current;

    useEffect(() => {
      if (status === 'TRACKING') {
        // Pulsing animation for TRACKING state
        const pulseLoop = Animated.loop(
          Animated.sequence([
            Animated.timing(reticleScale, {
              toValue: 1.05,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(reticleScale, {
              toValue: 1.0,
              duration: 500,
              useNativeDriver: true,
            }),
          ]),
        );
        pulseLoop.start();
        return () => {
          pulseLoop.stop();
          reticleScale.setValue(1);
        };
      } else if (status === 'CAPTURED') {
        // Flash animation for CAPTURED state
        Animated.sequence([
          Animated.timing(reticleOpacity, {
            toValue: 0.3,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(reticleOpacity, {
            toValue: 1,
            duration: 100,
            useNativeDriver: true,
          }),
        ]).start();
        reticleScale.setValue(1);
      } else {
        // SEARCHING state - reset
        reticleScale.setValue(1);
        reticleOpacity.setValue(1);
      }
    }, [status, reticleScale, reticleOpacity]);

    // Get reticle color based on status
    const getReticleColor = () => {
      switch (status) {
        case 'SEARCHING':
          return '#ffffff';
        case 'TRACKING':
          return '#4A90E2'; // Blue
        case 'CAPTURED':
          return '#00FF00'; // Green
        default:
          return '#ffffff';
      }
    };

    // ── Status update handler (JS thread) ──────────────────────────────────────
    const handleStatusUpdate = useCallback((newStatus: 'SEARCHING' | 'TRACKING' | 'CAPTURED') => {
      setStatus(newStatus);
    }, []);

    // ── Haptic feedback handler (JS thread) ────────────────────────────────────
    const triggerHaptic = useCallback(() => {
      ReactNativeHapticFeedback.trigger('impactHeavy', {
        enableVibrateFallback: true,
        ignoreAndroidSystemSettings: false,
      });
    }, []);

    // ── Tap-to-focus handler ───────────────────────────────────────────────────
    const handleTapToFocus = useCallback(async (x: number, y: number) => {
      if (!cameraRef.current) return;

      try {
        // Set focus point for visual feedback
        setFocusPoint({ x, y });

        // Lock exposure to stop hunting
        setLockedExposure(0);

        // Trigger focus circle animation
        focusCircleAnim.setValue(0);
        Animated.sequence([
          Animated.timing(focusCircleAnim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.timing(focusCircleAnim, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
          }),
        ]).start(() => {
          // Clear focus point after animation
          setFocusPoint(null);
        });

        // Focus camera at tapped point with exposure lock
        await cameraRef.current.focus({ x, y });
        console.log(`[CameraScreen] Focused at (${x.toFixed(0)}, ${y.toFixed(0)})`);
      } catch (error) {
        console.error('[CameraScreen] Focus failed:', error);
      }
    }, [focusCircleAnim]);

    // ── Gesture detector for tap-to-focus ──────────────────────────────────────
    const tapGesture = Gesture.Tap()
      .onEnd((event) => {
        handleTapToFocus(event.x, event.y);
      });

    // ── Camera permission ──────────────────────────────────────────────────────
    const { hasPermission, requestPermission } = useCameraPermission();

    useEffect(() => {
      requestPermission();
    }, []);

    // ── Camera device & format ─────────────────────────────────────────────────
    const device = useCameraDevice('back');
    
    // CRITICAL: Force 720p video resolution to prevent 12MP overload
    // This ensures frame processor receives manageable frame sizes
    const format = useCameraFormat(device, [
      { videoResolution: { width: 1280, height: 720 } },
      { fps: 30 },
    ]);

    useEffect(() => {
      if (format == null) {
        console.warn('[CameraScreen] No camera format available');
        return;
      }
      console.log(
        `[CameraScreen] Camera format: ${format.videoWidth}x${format.videoHeight} @ ${format.maxFps}fps`,
      );
      console.log(
        `[CameraScreen] Photo resolution: ${format.photoWidth}x${format.photoHeight}`,
      );
    }, [format]);

// ── Marker detection handler (JS thread) ──────────────────────────────────
    const handleMarkerDetected = useCallback(
      async (
        boundingBox: DetectionResult['boundingBox'],
        corners: DetectionResult['corners'],
        rotation: DetectionResult['rotation'],
        frameWidth: number,
        frameHeight: number,
      ) => {
        
        // 1. Check if already processing (should be locked by worklet, but double-check)
        if (!boundingBox || rotation === null) {
          return;
        }

        // 2. TRIGGER THE VISUAL FEEDBACK IMMEDIATELY
        // This tells the user "I saw it!" before the heavy processing even starts
        triggerCaptureFlash();
        triggerCornerAnimation();

        if (!cameraRef.current) {
          // Unlock on error
          isProcessing.value = false;
          return;
        }

        // 3. Take Photo and Process
        try {
          const photo = await cameraRef.current.takePhoto();
          const photoUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;

          const processedPath = await extractAndProcessMarkerPerspective(
            photoUri,
            corners!,
            rotation
          );

          if (processedPath) {
            setCapturedImages(prev => {
              const next = [...prev, processedPath];
              if (next.length >= 20) {
                setIsScanning(false);
                setTimeout(() => {
                  navigation.navigate('Results', { images: next });
                }, 500);
              }
              return next;
            });
            // Update the counter on the screen
            setCapturedCount(prev => Math.min(prev + 1, 20));
            console.log(`[State] Captured marker ${capturedCount + 1}/20`);
          }
        } catch (error) {
          console.error('[CameraScreen] processing failed:', error);
        } finally {
          // Unlock after 1.5 seconds cooldown (gives user time to move to next marker)
          setTimeout(() => {
            isProcessing.value = false;
            console.log('[Mutex] Unlocked - ready for next marker');
          }, 1500);
        }
      },
      [triggerCaptureFlash, triggerCornerAnimation, navigation, isProcessing, capturedCount],
    );

    // ── Bridge: worklet → JS thread ────────────────────────────────────────────
    const handleMarkerDetectedJS = Worklets.createRunOnJS(handleMarkerDetected);
    const handleStatusUpdateJS = Worklets.createRunOnJS(handleStatusUpdate);
    const triggerHapticJS = Worklets.createRunOnJS(triggerHaptic);

    // ── Pre-allocated buffers for ZERO-ALLOCATION processing ───────────────────
    // CRITICAL: These dimensions MUST match the camera format (720p = 1280×720)
    // If camera is in portrait, dimensions may be swapped (720×1280)
    const TARGET_WIDTH = 1280;
    const TARGET_HEIGHT = 720;
    const TOTAL_PIXELS = TARGET_WIDTH * TARGET_HEIGHT; // 921,600 pixels
    
    const grayBuffer = useRef(new Uint8Array(TOTAL_PIXELS)).current;
    const edgeBuffer = useRef(new Uint8Array(TOTAL_PIXELS)).current;
    const binaryBuffer = useRef(new Uint8Array(TOTAL_PIXELS)).current;
    const labelBuffer = useRef(new Int32Array(TOTAL_PIXELS)).current;
    const parentBuffer = useRef(new Int32Array(TOTAL_PIXELS * 2)).current;
    const compStatsBuffer = useRef(new Int32Array(TOTAL_PIXELS * 5)).current;

    // ── Frame processor with ULTRA-FAST single-pass detection ──────────────────
    // DIRECT PROCESSING: 1280×720 (no downscaling needed)
    const frameProcessor = useFrameProcessor((frame) => {
      'worklet';
      
      // ── MUTEX LOCK: Instantly drop frames if processing ────────────────────
      // This prevents CameraX buffer overflow (maxImages: 6)
      if (isProcessing.value) {
        return; // Drop frame immediately (0.001ms) to prevent buffer pile-up
      }
      
      // ── FAILSAFE: Check frame size matches our buffers ─────────────────────
      const framePixels = frame.width * frame.height;
      if (framePixels > TOTAL_PIXELS) {
        if (frameCounter.value === 0) {
          console.log(`[FrameProcessor] ⚠️ Frame too large: ${frame.width}x${frame.height} (expected ${TARGET_WIDTH}x${TARGET_HEIGHT}). Skipping.`);
        }
        frameCounter.value++;
        return;
      }
      
      // ── AGGRESSIVE THROTTLE: 500ms (2 FPS processing) ──────────────────────
      const currentTime = Date.now();
      
      if (currentTime - lastProcessTime.value < 500) {
        return;
      }
      lastProcessTime.value = currentTime;
      
      if (currentTime - lastDetectionTime.value < 1500) {
        return;
      }
      
      if (frameCounter.value === 0) {
        console.log(`[FrameProcessor] ✓ Ultra-fast processor initialized! Frame: ${frame.width}x${frame.height}`);
      }
      
      if (!isScanning) return;

      frameCounter.value += 1;
      if (frameCounter.value >= 600) {
        frameCounter.value = 0;
      }

      const buffer = frame.toArrayBuffer();
      const pixelData = new Uint8Array(buffer);
      const sourceWidth = frame.width;
      const sourceHeight = frame.height;

      // ── STEP 1: DEFINE STRICT 400x400 CENTER ROI ───────────────────────────
      const ROI_SIZE = 400;
      const centerX = Math.floor(TARGET_WIDTH / 2);
      const centerY = Math.floor(TARGET_HEIGHT / 2);
      const startX = centerX - 200; // 440 at 1280 width
      const endX = centerX + 200;   // 840 at 1280 width
      const startY = centerY - 200; // 160 at 720 height
      const endY = centerY + 200;   // 560 at 720 height
      
      // ── STEP 2: ULTRA-FAST DOWNSAMPLING (stride 8, ROI only) ───────────────
      // Only sample every 8th pixel within the 400x400 center ROI
      const STRIDE = 8;
      let idx = 0;
      
      for (let dy = startY; dy < endY; dy += STRIDE) {
        const rowOffset = dy * sourceWidth;
        for (let dx = startX; dx < endX; dx += STRIDE) {
          if (idx < TOTAL_PIXELS) {
            grayBuffer[idx++] = pixelData[rowOffset + dx];
          }
        }
      }

      // ── STEP 3: SINGLE-PASS BOUNDING BOX (ROI only) ────────────────────────
      const DARK_THRESHOLD = 50; // STRICT: Only pure black ink
      const MAX_DARK_PIXELS = 50000; // Bail-out to prevent hang
      
      let minX = sourceWidth;
      let maxX = 0;
      let minY = sourceHeight;
      let maxY = 0;
      let darkCount = 0;
      
      // Single pass through sampled pixels (ROI only)
      idx = 0;
      for (let dy = startY; dy < endY; dy += STRIDE) {
        for (let dx = startX; dx < endX; dx += STRIDE) {
          if (idx >= TOTAL_PIXELS) break;
          
          const pixelValue = grayBuffer[idx++];
          
          if (pixelValue < DARK_THRESHOLD) {
            darkCount++;
            
            // Bail-out if too many dark pixels (pointing at dark surface)
            if (darkCount > MAX_DARK_PIXELS) {
              if (frameCounter.value % 30 === 0) {
                console.log(`[Heartbeat-ROI] Bail-out: ${darkCount} dark pixels (threshold: ${MAX_DARK_PIXELS})`);
              }
              return; // Exit immediately to prevent hang
            }
            
            // Track bounding box
            if (dx < minX) minX = dx;
            if (dx > maxX) maxX = dx;
            if (dy < minY) minY = dy;
            if (dy > maxY) maxY = dy;
          }
        }
      }
      
      // ── HEARTBEAT LOG: Always log bounding box stats every 1 second ────────
      if (frameCounter.value % 30 === 0) { // ~1 second at 2 FPS processing
        const w = minX < maxX ? maxX - minX + 1 : 0;
        const h = minY < maxY ? maxY - minY + 1 : 0;
        const ratio = h > 0 ? (w / h).toFixed(2) : 0;
        console.log(`[Heartbeat-ROI] DarkPixels: ${darkCount} | w: ${w} h: ${h} | ratio: ${ratio} | bounds: (${minX},${minY})-(${maxX},${maxY})`);
      }
      
      // ── STEP 4: STAGE 1 VALIDATION (FAST PASS) ─────────────────────────────
      if (darkCount < 100) {
        // No marker found - update status to SEARCHING
        if (lastStatus.value !== 'SEARCHING') {
          lastStatus.value = 'SEARCHING';
          handleStatusUpdateJS('SEARCHING');
        }
        return;
      }
      
      if (minX >= maxX || minY >= maxY) {
        // Invalid bounds - update status to SEARCHING
        if (lastStatus.value !== 'SEARCHING') {
          lastStatus.value = 'SEARCHING';
          handleStatusUpdateJS('SEARCHING');
        }
        return;
      }
      
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      
      // CRITICAL: Maximum physical size check (reject before aspect ratio)
      // Marker will never take up >60% of screen unless phone is touching paper
      const maxWidth = TARGET_WIDTH * 0.6;   // 768 pixels at 1280 width
      const maxHeight = TARGET_HEIGHT * 0.6; // 432 pixels at 720 height
      if (w > maxWidth || h > maxHeight) {
        // Too large - update status to SEARCHING
        if (lastStatus.value !== 'SEARCHING') {
          lastStatus.value = 'SEARCHING';
          handleStatusUpdateJS('SEARCHING');
        }
        return;
      }
      
      // Basic size check
      if (w < 30 || h < 30) {
        // Too small - update status to SEARCHING
        if (lastStatus.value !== 'SEARCHING') {
          lastStatus.value = 'SEARCHING';
          handleStatusUpdateJS('SEARCHING');
        }
        return;
      }
      if (w > 600 || h > 500) {
        // Too large - update status to SEARCHING
        if (lastStatus.value !== 'SEARCHING') {
          lastStatus.value = 'SEARCHING';
          handleStatusUpdateJS('SEARCHING');
        }
        return;
      }
      
      // Relaxed aspect ratio check (allow perspective skewing)
      const aspectRatio = w / h;
      if (aspectRatio < 0.70 || aspectRatio > 1.35) {
        // Bad aspect ratio - update status to SEARCHING
        if (lastStatus.value !== 'SEARCHING') {
          lastStatus.value = 'SEARCHING';
          handleStatusUpdateJS('SEARCHING');
        }
        return;
      }
      
      // Basic frame area check
      const frameArea = sourceWidth * sourceHeight;
      const rectArea = w * h;
      const frameRatio = rectArea / frameArea;
      if (frameRatio < 0.01 || frameRatio > 0.80) {
        // Bad frame ratio - update status to SEARCHING
        if (lastStatus.value !== 'SEARCHING') {
          lastStatus.value = 'SEARCHING';
          handleStatusUpdateJS('SEARCHING');
        }
        return;
      }
      
      // ── STAGE 1 PASSED: Square detected, update to TRACKING ────────────────
      if (lastStatus.value !== 'TRACKING') {
        lastStatus.value = 'TRACKING';
        handleStatusUpdateJS('TRACKING');
      }

      // ── STEP 5: STAGE 2 STRUCTURAL VERIFICATION (QUADRANT DENSITY) ─────────
      // Divide bounding box into 4 quadrants and check for anchor dot
      const midX = Math.floor((minX + maxX) / 2);
      const midY = Math.floor((minY + maxY) / 2);
      
      // Quadrant counters
      let tlDark = 0, tlTotal = 0; // Top-Left
      let trDark = 0, trTotal = 0; // Top-Right
      let blDark = 0, blTotal = 0; // Bottom-Left
      let brDark = 0, brTotal = 0; // Bottom-Right
      
      // Sample bounding box with stride-4 for speed
      const QUAD_STRIDE = 4;
      for (let dy = minY; dy <= maxY; dy += QUAD_STRIDE) {
        const rowOffset = dy * sourceWidth;
        for (let dx = minX; dx <= maxX; dx += QUAD_STRIDE) {
          const pixelValue = pixelData[rowOffset + dx];
          const isDark = pixelValue < DARK_THRESHOLD;
          
          // Determine quadrant
          if (dy < midY) {
            if (dx < midX) {
              // Top-Left
              tlTotal++;
              if (isDark) tlDark++;
            } else {
              // Top-Right
              trTotal++;
              if (isDark) trDark++;
            }
          } else {
            if (dx < midX) {
              // Bottom-Left
              blTotal++;
              if (isDark) blDark++;
            } else {
              // Bottom-Right
              brTotal++;
              if (isDark) brDark++;
            }
          }
        }
      }
      
      // Calculate densities (0.0 to 1.0)
      const tlDensity = tlTotal > 0 ? tlDark / tlTotal : 0;
      const trDensity = trTotal > 0 ? trDark / trTotal : 0;
      const blDensity = blTotal > 0 ? blDark / blTotal : 0;
      const brDensity = brTotal > 0 ? brDark / brTotal : 0;
      
      // Find anchor quadrant (highest density)
      let anchorDensity = tlDensity;
      let anchorQuadrant = 'TL';
      if (trDensity > anchorDensity) { anchorDensity = trDensity; anchorQuadrant = 'TR'; }
      if (blDensity > anchorDensity) { anchorDensity = blDensity; anchorQuadrant = 'BL'; }
      if (brDensity > anchorDensity) { anchorDensity = brDensity; anchorQuadrant = 'BR'; }
      
      // Calculate average density of other three quadrants
      const allDensities = [tlDensity, trDensity, blDensity, brDensity];
      const otherDensities = allDensities.filter(d => d !== anchorDensity);
      const otherDensityAvg = otherDensities.reduce((sum, d) => sum + d, 0) / otherDensities.length;
      
      // ANCHOR VALIDATION LOGIC
      // 1. Anchor must have significant density (>15% dark pixels)
      // 2. Anchor must be noticeably darker than other quadrants (1.5x multiplier)
      if (anchorDensity < 0.15) {
        // No anchor dot found - stay in TRACKING (Stage 1 passed but Stage 2 failed)
        if (lastStatus.value !== 'TRACKING') {
          lastStatus.value = 'TRACKING';
          handleStatusUpdateJS('TRACKING');
        }
        return;
      }
      
      if (anchorDensity <= otherDensityAvg * 1.5) {
        // Anchor not distinct enough - stay in TRACKING
        if (lastStatus.value !== 'TRACKING') {
          lastStatus.value = 'TRACKING';
          handleStatusUpdateJS('TRACKING');
        }
        return;
      }
      
      // ── STAGE 2 PASSED: Valid marker with anchor dot detected! ─────────────
      if (lastStatus.value !== 'CAPTURED') {
        lastStatus.value = 'CAPTURED';
        handleStatusUpdateJS('CAPTURED');
        triggerHapticJS(); // Haptic feedback on successful detection
      }
      
      // ── STEP 6: EXTRACT CORNERS (SIMPLE SCAN) ──────────────────────────────
      // ── STEP 6: EXTRACT CORNERS (SIMPLE SCAN) ──────────────────────────────
      // Scan only the bounding box region (not entire frame)
      let tlX = sourceWidth, tlY = sourceHeight, tlSum = sourceWidth + sourceHeight;
      let trX = 0, trY = sourceHeight, trDiff = -sourceWidth;
      let brX = 0, brY = 0, brSum = 0;
      let blX = sourceWidth, blY = 0, blDiff = sourceWidth;
      
      // Scan with stride for speed
      for (let dy = minY; dy <= maxY; dy += 2) {
        const rowOffset = dy * sourceWidth;
        for (let dx = minX; dx <= maxX; dx += 2) {
          const pixelValue = pixelData[rowOffset + dx];
          
          if (pixelValue < DARK_THRESHOLD) {
            const sum = dx + dy;
            const diff = dx - dy;
            
            if (sum < tlSum) { tlX = dx; tlY = dy; tlSum = sum; }
            if (diff > trDiff) { trX = dx; trY = dy; trDiff = diff; }
            if (sum > brSum) { brX = dx; brY = dy; brSum = sum; }
            if (diff < blDiff) { blX = dx; blY = dy; blDiff = diff; }
          }
        }
      }
      
      // Corners are already in original coordinates (no scaling needed)
      const corners = {
        topLeft: { x: tlX, y: tlY },
        topRight: { x: trX, y: trY },
        bottomRight: { x: brX, y: brY },
        bottomLeft: { x: blX, y: blY },
      };
      
      const scaledBox = {
        x: minX,
        y: minY,
        w: w,
        h: h,
      };

      // ── TRIGGER ──────────────────────────────────────────────────────────────
      // Lock the mutex IMMEDIATELY to prevent buffer overflow
      isProcessing.value = true;
      console.log('[Mutex] Locked - processing marker');
      
      lastDetectionTime.value = currentTime;
      
      // Default rotation (no quadrant detection in fast mode)
      const rotation = 0;
      
      if (frameCounter.value % 20 === 0) {
        console.log(`[Detection] ✓ Marker validated: ${w}x${h} | Anchor: ${anchorQuadrant} (${(anchorDensity * 100).toFixed(1)}%) | Quadrants: TL=${(tlDensity * 100).toFixed(1)}% TR=${(trDensity * 100).toFixed(1)}% BL=${(blDensity * 100).toFixed(1)}% BR=${(brDensity * 100).toFixed(1)}%`);
      }
      
      handleMarkerDetectedJS(scaledBox, corners, rotation, sourceWidth, sourceHeight);
    }, [isScanning]);

    // ── Render ─────────────────────────────────────────────────────────────────
    if (!hasPermission) {
      return (
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>
            Camera permission required. Please enable it in Settings.
          </Text>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => Linking.openSettings()}>
            <Text style={styles.settingsButtonText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // ── Corner interpolations ──────────────────────────────────────────────────
    const cornerBorderColor = cornerAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['#ffffff', '#00FF00'],
    });

    const cornerScale = cornerAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1.0, 1.1],
    });

    return (
      <View style={styles.root}>
        {/* ── Layer 1 (bottom): Camera preview with tap-to-focus ── */}
        {device != null ? (
          <GestureDetector gesture={tapGesture}>
            <View style={styles.cameraContainer}>
              <Camera
                ref={cameraRef}
                style={styles.cameraPreview}
                device={device}
                isActive={isScanning}
                photo={true}
                video={false}
                format={format}
                fps={30}
                exposure={lockedExposure}
                pixelFormat="rgb"
                frameProcessor={frameProcessor}
              />
            </View>
          </GestureDetector>
        ) : (
          <View style={[styles.cameraPreview, styles.cameraFallback]}>
            <Text style={styles.fallbackText}>
              No back camera found on this device.
            </Text>
          </View>
        )}

        {/* ── Layer 2: Viewfinder overlay ── */}
        <View style={styles.overlayTop} pointerEvents="none" />
        <View style={styles.overlayMiddleRow} pointerEvents="none">
          <View style={styles.overlaySide} />
          <Animated.View 
            style={[
              styles.viewfinderBorder,
              {
                borderColor: getReticleColor(),
                opacity: reticleOpacity,
                transform: [{ scale: reticleScale }],
              },
            ]}
          >
            <Animated.View
              style={[
                styles.corner,
                styles.cornerTopLeft,
                {
                  backgroundColor: getReticleColor(),
                  transform: [{ scale: cornerScale }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.corner,
                styles.cornerTopRight,
                {
                  backgroundColor: getReticleColor(),
                  transform: [{ scale: cornerScale }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.corner,
                styles.cornerBottomLeft,
                {
                  backgroundColor: getReticleColor(),
                  transform: [{ scale: cornerScale }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.corner,
                styles.cornerBottomRight,
                {
                  backgroundColor: getReticleColor(),
                  transform: [{ scale: cornerScale }],
                },
              ]}
            />
          </Animated.View>
          <View style={styles.overlaySide} />
        </View>
        <View style={styles.overlayBottom} pointerEvents="none" />

        {/* ── Layer 2.5: Detection box ── */}
        {detectionBox != null && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: detectionBox.x,
              top: detectionBox.y,
              width: detectionBox.w,
              height: detectionBox.h,
              borderWidth: 3,
              borderColor: '#00FF00',
              backgroundColor: 'transparent',
            }}
          />
        )}

        {/* ── Layer 3: Bottom bar ── */}
        <View style={styles.bottomBar} pointerEvents="none">
          {capturedCount >= 20 ? (
            <View style={styles.completionContainer}>
              <Text style={styles.statusText}>Complete! Loading results…</Text>
              <ActivityIndicator
                size="small"
                color="#fff"
                style={styles.completionSpinner}
              />
            </View>
          ) : (
            <Animated.Text style={[styles.statusText, { opacity: pulseAnim }]}>
              {isScanning
                ? `Scanning… (${capturedCount} / 20)`
                : `Done (${capturedCount} / 20)`}
            </Animated.Text>
          )}
        </View>

        {/* ── Layer 4: Focus circle visual feedback ── */}
        {focusPoint && (
          <Animated.View
            style={[
              styles.focusCircle,
              {
                left: focusPoint.x - 40,
                top: focusPoint.y - 40,
                opacity: focusCircleAnim,
                transform: [
                  {
                    scale: focusCircleAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1.2, 1.0],
                    }),
                  },
                ],
              },
            ]}
            pointerEvents="none"
          />
        )}

        {/* ── Layer 5: Green capture flash ── */}
        <Animated.View
          style={[styles.flashOverlay, { opacity: flashAnim }]}
          pointerEvents="none"
        />
      </View>
    );
  };

  const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000' },
    permissionContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#000',
      padding: 24,
    },
    permissionText: {
      color: '#fff',
      fontSize: 16,
      textAlign: 'center',
      marginBottom: 20,
    },
    settingsButton: {
      backgroundColor: '#fff',
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
    },
    settingsButtonText: { color: '#000', fontSize: 16, fontWeight: '600' },
    cameraContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    cameraPreview: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    cameraFallback: {
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#000',
    },
    fallbackText: { color: '#fff', fontSize: 16, textAlign: 'center' },
    overlayTop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: VIEWFINDER_TOP,
      backgroundColor: OVERLAY_COLOR,
    },
    overlayMiddleRow: {
      position: 'absolute',
      top: VIEWFINDER_TOP,
      left: 0,
      right: 0,
      height: VIEWFINDER_SIZE,
      flexDirection: 'row',
    },
    overlaySide: { width: VIEWFINDER_SIDE, backgroundColor: OVERLAY_COLOR },
    overlayBottom: {
      position: 'absolute',
      top: VIEWFINDER_TOP + VIEWFINDER_SIZE,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: OVERLAY_COLOR,
    },
    viewfinderBorder: {
      width: VIEWFINDER_SIZE,
      height: VIEWFINDER_SIZE,
      borderWidth: 2,
      borderColor: '#fff',
    },
    corner: { position: 'absolute', backgroundColor: '#fff' },
    cornerTopLeft: {
      top: -CORNER_THICKNESS,
      left: -CORNER_THICKNESS,
      width: CORNER_LENGTH,
      height: CORNER_THICKNESS,
    },
    cornerTopRight: {
      top: -CORNER_THICKNESS,
      right: -CORNER_THICKNESS,
      width: CORNER_LENGTH,
      height: CORNER_THICKNESS,
    },
    cornerBottomLeft: {
      bottom: -CORNER_THICKNESS,
      left: -CORNER_THICKNESS,
      width: CORNER_LENGTH,
      height: CORNER_THICKNESS,
    },
    cornerBottomRight: {
      bottom: -CORNER_THICKNESS,
      right: -CORNER_THICKNESS,
      width: CORNER_LENGTH,
      height: CORNER_THICKNESS,
    },
    bottomBar: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: BOTTOM_BAR_HEIGHT,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    statusText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    completionContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    completionSpinner: {
      marginLeft: 12,
    },
    flashOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: '#00ff00',
    },
    focusCircle: {
      position: 'absolute',
      width: 80,
      height: 80,
      borderRadius: 40,
      borderWidth: 2,
      borderColor: '#FFD700',
      backgroundColor: 'transparent',
    },
  });
