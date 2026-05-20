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
  import { Worklets, useSharedValue } from 'react-native-worklets-core';
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

    // ── State ──────────────────────────────────────────────────────────────────
    const [capturedCount, setCapturedCount] = useState<number>(0);
    const [isScanning, setIsScanning] = useState<boolean>(true);
    const [capturedImages, setCapturedImages] = useState<string[]>([]);
    const [detectionBox, setDetectionBox] = useState<{
      x: number; y: number; w: number; h: number;
    } | null>(null);

    // ── Refs ───────────────────────────────────────────────────────────────────
    const cameraRef = useRef<Camera>(null);
    const isProcessingRef = useRef<boolean>(false);
    const capturedImagesRef = useRef<string[]>(capturedImages);
    

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

    // ── Camera permission ──────────────────────────────────────────────────────
    const { hasPermission, requestPermission } = useCameraPermission();

    useEffect(() => {
      requestPermission();
    }, []);

    // ── Camera device & format ─────────────────────────────────────────────────
    const device = useCameraDevice('back');
    const format = useCameraFormat(device, [{ photoResolution: 'max' }]);

    useEffect(() => {
      if (format == null) {
        return;
      }
      if (format.photoWidth < 2000 || format.photoHeight < 2000) {
        console.warn(
          `[CameraScreen] Best available format is below 2000px: ${format.photoWidth}x${format.photoHeight}. Falling back to highest available.`,
        );
      } else {
        console.log(
          `[CameraScreen] Selected camera format: ${format.photoWidth}x${format.photoHeight}`,
        );
      }
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
        
        // 1. Debounce: ignore if a capture is already being processed
        if (isProcessingRef.current || !boundingBox || rotation === null) {
          return;
        }
        isProcessingRef.current = true;

        const currentCount = capturedImagesRef.current.length;
        console.log(`[CameraScreen] Marker detected — rotation: ${rotation}°, captures so far: ${currentCount + 1}/20`);

        // 2. Coordinate scaling: frame → screen (for UI overlay only)
        const scaleX = SCREEN_WIDTH / frameWidth;
        const scaleY = SCREEN_HEIGHT / frameHeight;
        const scaledBox = {
          x: boundingBox.x * scaleX,
          y: boundingBox.y * scaleY,
          w: boundingBox.w * scaleX,
          h: boundingBox.h * scaleY,
        };

        // 3. Show detection overlay & flash
        setDetectionBox(scaledBox);
        triggerCaptureFlash();
        triggerCornerAnimation();

        if (!cameraRef.current) {
          console.error('[CameraScreen] Camera ref is null');
          isProcessingRef.current = false;
          return;
        }

        // 4. Take Photo and Process with OpenCV
        try {
          const photo = await cameraRef.current.takePhoto({ qualityPrioritization: 'speed' });
          
          // Ensure photo.path has 'file://' prefix
          const photoUri = photo.path.startsWith('file://')
            ? photo.path
            : `file://${photo.path}`;

          // 👇 THE OPENCV MAGIC 👇
          const processedPath = await extractAndProcessMarkerPerspective(
            photoUri,
            corners!,
            rotation
          );

          if (processedPath) {
            // Append to captured images and check if we hit 20
            setCapturedImages(prev => {
              const next = [...prev, processedPath];
              if (next.length >= 20) {
                setIsScanning(false);
                // Navigate to Results screen
                setTimeout(() => {
                  navigation.navigate('Results', { images: next });
                }, 500);
              }
              return next;
            });
            setCapturedCount(prev => Math.min(prev + 1, 20));
          } else {
            console.error('[CameraScreen] Image processing failed');
          }

        } catch (error) {
          console.error('[CameraScreen] takePhoto/processing failed:', error);
        } finally {
          // Clean up detection overlay and release debounce lock
          setTimeout(() => setDetectionBox(null), 1000);
          setTimeout(() => {
            isProcessingRef.current = false;
          }, 1500);
        }
      },
      [triggerCaptureFlash, triggerCornerAnimation, navigation],
    );

    // ── Bridge: worklet → JS thread ────────────────────────────────────────────
    const handleMarkerDetectedJS = Worklets.createRunOnJS(handleMarkerDetected);

    // ── Frame processor with INLINE 8-step detection ───────────────────────────
    // DOWNSCALED PROCESSING: 480×270 (quarter resolution of 1920×1080)
    const frameProcessor = useFrameProcessor((frame) => {
      'worklet';
      
      // Log once at startup
      if (frameCounter.value === 0) {
        console.log('[FrameProcessor] ✓ Frame processor initialized and running!');
      }
      
      if (!isScanning) return;

      // ── STEP 1 — Frame sampling (every 4th frame) ──────────────────────────
      frameCounter.value += 1;
      if (frameCounter.value >= 600) {
        frameCounter.value = 0;
      }
      if (frameCounter.value % 4 !== 0) {
        return;
      }

      const buffer = frame.toArrayBuffer();
      const pixelData = new Uint8Array(buffer);
      const sourceWidth = frame.width;
      const sourceHeight = frame.height;

      // Downscale target: 480×270 (quarter resolution)
      const TARGET_WIDTH = 480;
      const TARGET_HEIGHT = 270;
      const scaleX = sourceWidth / TARGET_WIDTH;
      const scaleY = sourceHeight / TARGET_HEIGHT;

      // Log once on first processed frame
      if (frameCounter.value === 4) {
        console.log(`[Detection] Processing at downscaled size: ${TARGET_WIDTH}x${TARGET_HEIGHT} (source: ${sourceWidth}x${sourceHeight})`);
      }

      const totalPixels = TARGET_WIDTH * TARGET_HEIGHT;

      // ── STEP 2 — Grayscale conversion with downsampling ────────────────────
      const grayData = new Float32Array(totalPixels);
      for (let dy = 0; dy < TARGET_HEIGHT; dy++) {
        for (let dx = 0; dx < TARGET_WIDTH; dx++) {
          const sourceX = Math.floor(dx * scaleX);
          const sourceY = Math.floor(dy * scaleY);
          const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
          
          const gray = (0.299 * pixelData[sourceIndex] +
                       0.587 * pixelData[sourceIndex + 1] +
                       0.114 * pixelData[sourceIndex + 2]) / 255;
          
          grayData[dy * TARGET_WIDTH + dx] = gray;
        }
      }

      // ── STEP 3 — Adaptive thresholding (8×8 blocks for downscaled frame) ───
      const BLOCK = 8;
      const binaryData = new Uint8Array(totalPixels); // 0 = BLACK, 1 = WHITE

      const blocksX = Math.ceil(TARGET_WIDTH / BLOCK);
      const blocksY = Math.ceil(TARGET_HEIGHT / BLOCK);

      for (let by = 0; by < blocksY; by++) {
        for (let bx = 0; bx < blocksX; bx++) {
          const x0 = bx * BLOCK;
          const y0 = by * BLOCK;
          const x1 = Math.min(x0 + BLOCK, TARGET_WIDTH);
          const y1 = Math.min(y0 + BLOCK, TARGET_HEIGHT);

          // Compute block mean
          let sum = 0;
          let count = 0;
          for (let py = y0; py < y1; py++) {
            for (let px = x0; px < x1; px++) {
              sum += grayData[py * TARGET_WIDTH + px];
              count++;
            }
          }
          const blockMean = count > 0 ? sum / count : 0.5;
          const threshold = blockMean - 0.07;

          // Threshold each pixel in this block
          for (let py = y0; py < y1; py++) {
            for (let px = x0; px < x1; px++) {
              const idx = py * TARGET_WIDTH + px;
              binaryData[idx] = grayData[idx] < threshold ? 0 : 1;
            }
          }
        }
      }

      // ── STEP 4 — Connected component labeling (two-pass, 4-connectivity) ───
      // Union-Find helpers (inline)
      const findRoot = (parent: Int32Array, i: number): number => {
        while (parent[i] !== i) {
          parent[i] = parent[parent[i]];
          i = parent[i];
        }
        return i;
      };

      const union = (parent: Int32Array, a: number, b: number): void => {
        const ra = findRoot(parent, a);
        const rb = findRoot(parent, b);
        if (ra !== rb) {
          parent[rb] = ra;
        }
      };

      const labels = new Int32Array(totalPixels).fill(-1);
      const parent = new Int32Array(totalPixels * 2);
      let nextLabel = 0;

      // First pass: assign provisional labels
      for (let row = 0; row < TARGET_HEIGHT; row++) {
        for (let col = 0; col < TARGET_WIDTH; col++) {
          const idx = row * TARGET_WIDTH + col;
          if (binaryData[idx] !== 0) continue; // WHITE pixel

          const above = row > 0 ? labels[(row - 1) * TARGET_WIDTH + col] : -1;
          const left = col > 0 ? labels[row * TARGET_WIDTH + (col - 1)] : -1;

          if (above === -1 && left === -1) {
            parent[nextLabel] = nextLabel;
            labels[idx] = nextLabel;
            nextLabel++;
          } else if (above !== -1 && left === -1) {
            labels[idx] = above;
          } else if (above === -1 && left !== -1) {
            labels[idx] = left;
          } else {
            const ra = findRoot(parent, above);
            const rl = findRoot(parent, left);
            labels[idx] = Math.min(ra, rl);
            if (ra !== rl) {
              union(parent, ra, rl);
            }
          }
        }
      }

      // Second pass: resolve labels to roots
      for (let i = 0; i < totalPixels; i++) {
        if (labels[i] !== -1) {
          labels[i] = findRoot(parent, labels[i]);
        }
      }

      // Collect per-component stats
      const compMinX = new Int32Array(nextLabel).fill(TARGET_WIDTH);
      const compMaxX = new Int32Array(nextLabel).fill(-1);
      const compMinY = new Int32Array(nextLabel).fill(TARGET_HEIGHT);
      const compMaxY = new Int32Array(nextLabel).fill(-1);
      const compCount = new Int32Array(nextLabel);

      for (let row = 0; row < TARGET_HEIGHT; row++) {
        for (let col = 0; col < TARGET_WIDTH; col++) {
          const idx = row * TARGET_WIDTH + col;
          const lbl = labels[idx];
          if (lbl === -1) continue;
          const root = findRoot(parent, lbl);
          if (col < compMinX[root]) compMinX[root] = col;
          if (col > compMaxX[root]) compMaxX[root] = col;
          if (row < compMinY[root]) compMinY[root] = row;
          if (row > compMaxY[root]) compMaxY[root] = row;
          compCount[root]++;
        }
      }

      const frameArea = TARGET_WIDTH * TARGET_HEIGHT;

      // Filter candidates
      const candidates: Array<{ x: number; y: number; w: number; h: number }> = [];
      let totalComponents = 0;
      let filteredByAspect = 0;
      let filteredByArea = 0;
      let filteredBySolidity = 0;

      for (let lbl = 0; lbl < nextLabel; lbl++) {
        if (compMaxX[lbl] === -1) continue;
        if (findRoot(parent, lbl) !== lbl) continue;

        totalComponents++;

        const x = compMinX[lbl];
        const y = compMinY[lbl];
        const w = compMaxX[lbl] - x + 1;
        const h = compMaxY[lbl] - y + 1;
        if (w <= 0 || h <= 0) continue;

        const pixelCount = compCount[lbl];
        const aspectRatio = w / h;
        const rectArea = w * h;
        const solidity = pixelCount / rectArea;
        const frameAreaRatio = rectArea / frameArea;

        // Log details for components that are close to passing (for debugging)
        if (aspectRatio >= 0.7 && aspectRatio <= 1.3 && frameAreaRatio >= 0.005 && frameAreaRatio <= 0.5) {
          console.log(`[Detection] Component ${lbl}: size=${w}x${h}, aspect=${aspectRatio.toFixed(2)}, frameArea=${(frameAreaRatio*100).toFixed(1)}%, solidity=${solidity.toFixed(2)}`);
        }

        // Track why components are filtered
        if (aspectRatio < 0.85 || aspectRatio > 1.15) {
          filteredByAspect++;
          continue;
        }
        // FIX 2: Frame area 0.5% to 40% (was 1% to 40%)
        if (frameAreaRatio < 0.005 || frameAreaRatio > 0.4) {
          filteredByArea++;
          continue;
        }
        // FIX 1: CRITICAL — Hollow frame solidity 0.03 to 0.60 (was 0.15 to 0.55)
        if (solidity <= 0.03 || solidity >= 0.60) {
          filteredBySolidity++;
          continue;
        }

        // Log when a component PASSES all filters
        console.log(`[Detection] PASSED filter — size: ${w}x${h}, solidity: ${solidity.toFixed(3)}, frameArea: ${(frameAreaRatio*100).toFixed(1)}%`);

        candidates.push({ x, y, w, h });
      }

      // ── STEPS 5–7: Validate each candidate ─────────────────────────────────
      for (const cand of candidates) {
        const { x, y, w, h } = cand;

        // ── STEP 5 — Border darkness validation ──────────────────────────────
        const bandW = Math.max(1, Math.floor(w * 0.12));
        const bandH = Math.max(1, Math.floor(h * 0.12));

        let borderSum = 0;
        let borderCount = 0;

        // Top band
        for (let row = y; row < Math.min(y + bandH, TARGET_HEIGHT); row++) {
          for (let col = x; col < Math.min(x + w, TARGET_WIDTH); col++) {
            borderSum += grayData[row * TARGET_WIDTH + col];
            borderCount++;
          }
        }
        // Bottom band
        for (
          let row = Math.max(0, y + h - bandH);
          row < Math.min(y + h, TARGET_HEIGHT);
          row++
        ) {
          for (let col = x; col < Math.min(x + w, TARGET_WIDTH); col++) {
            borderSum += grayData[row * TARGET_WIDTH + col];
            borderCount++;
          }
        }
        // Left band
        for (
          let row = Math.min(y + bandH, TARGET_HEIGHT);
          row < Math.max(0, y + h - bandH);
          row++
        ) {
          for (let col = x; col < Math.min(x + bandW, TARGET_WIDTH); col++) {
            borderSum += grayData[row * TARGET_WIDTH + col];
            borderCount++;
          }
        }
        // Right band
        for (
          let row = Math.min(y + bandH, TARGET_HEIGHT);
          row < Math.max(0, y + h - bandH);
          row++
        ) {
          for (
            let col = Math.max(0, x + w - bandW);
            col < Math.min(x + w, TARGET_WIDTH);
            col++
          ) {
            borderSum += grayData[row * TARGET_WIDTH + col];
            borderCount++;
          }
        }

        if (borderCount === 0) {
          console.log(`[Detection] Rejected at Step 5 — borderCount=0`);
          continue;
        }
        const borderMean = borderSum / borderCount;
        // Border darkness threshold: 0.72 (relaxed for real lighting)
        if (borderMean > 0.72) {
          console.log(`[Detection] Rejected at Step 5 — border mean: ${borderMean.toFixed(2)}`);
          continue;
        }

        // ── STEP 6 REMOVED — FIX 3: Inner white validation deleted entirely ───
        // The marker has content inside (pig drawing), so we skip inner validation.
        // Corner dot check in Step 7 is sufficient to identify our specific marker.

        // ── STEP 7 — Corner dot detection and orientation ────────────────────
        // Define inner area (inset by 12% on each side)
        const innerX = Math.floor(x + w * 0.12);
        const innerY = Math.floor(y + h * 0.12);
        const innerW = Math.floor(w * 0.76);
        const innerH = Math.floor(h * 0.76);

        // Define 15%×15% corner search regions positioned at very corner edges
        const qW = Math.floor(innerW * 0.15);
        const qH = Math.floor(innerH * 0.15);

        const quadrants = [
          { x0: innerX, y0: innerY }, // TL: top-left corner
          { x0: innerX + Math.floor(innerW * 0.85), y0: innerY }, // TR: top-right corner
          { x0: innerX, y0: innerY + Math.floor(innerH * 0.85) }, // BL: bottom-left corner
          { x0: innerX + Math.floor(innerW * 0.85), y0: innerY + Math.floor(innerH * 0.85) }, // BR: bottom-right corner
        ];

        const densities: number[] = [];
        for (const q of quadrants) {
          let blackCount = 0;
          let total = 0;
          for (let row = q.y0; row < Math.min(q.y0 + qH, TARGET_HEIGHT); row++) {
            for (let col = q.x0; col < Math.min(q.x0 + qW, TARGET_WIDTH); col++) {
              if (binaryData[row * TARGET_WIDTH + col] === 0) {
                blackCount++;
              }
              total++;
            }
          }
          densities.push(total > 0 ? blackCount / total : 0);
        }

        // ── RELATIVE/DYNAMIC THRESHOLDING (Robust Corner Detection) ──────────
        // Find highest and second-highest densities
        let maxDensity = -1;
        let maxIndex = -1;
        let secondMaxDensity = -1;

        for (let i = 0; i < densities.length; i++) {
          if (densities[i] > maxDensity) {
            secondMaxDensity = maxDensity;
            maxDensity = densities[i];
            maxIndex = i;
          } else if (densities[i] > secondMaxDensity) {
            secondMaxDensity = densities[i];
          }
        }

        // Validation criteria for a valid single-corner marker:
        // 1. Highest density must be sufficiently dark (> 0.25)
        // 2. Second highest must be sufficiently light (< 0.18) - no competing corners
        // 3. Highest must be distinctly higher than second (> 2x gap)
        const MIN_ACTIVE_DENSITY = 0.25;
        const MAX_NOISE_DENSITY = 0.18;
        const MIN_CONTRAST_RATIO = 2.0;

        const isHighestSufficientlyDark = maxDensity > MIN_ACTIVE_DENSITY;
        const isSecondHighestSufficientlyLight = secondMaxDensity < MAX_NOISE_DENSITY;
        const hasDistinctGap = maxDensity > secondMaxDensity * MIN_CONTRAST_RATIO;

        // Enhanced logging with relative thresholding diagnostics
        console.log(
          `[Detection] Corner densities (relative) — TL: ${densities[0].toFixed(3)}, TR: ${densities[1].toFixed(3)}, BR: ${densities[3].toFixed(3)}, BL: ${densities[2].toFixed(3)} | ` +
          `max: ${maxDensity.toFixed(3)}, 2nd: ${secondMaxDensity.toFixed(3)}, ratio: ${(maxDensity / (secondMaxDensity + 0.001)).toFixed(2)}x | ` +
          `innerArea: ${Math.round(innerW)}x${Math.round(innerH)}`
        );

        if (!isHighestSufficientlyDark) {
          console.log(`[Detection] Rejected at Step 7 — highest density too low (${maxDensity.toFixed(3)} < ${MIN_ACTIVE_DENSITY})`);
          continue;
        }

        if (!isSecondHighestSufficientlyLight) {
          console.log(`[Detection] Rejected at Step 7 — second highest too high (${secondMaxDensity.toFixed(3)} > ${MAX_NOISE_DENSITY}), competing corners detected`);
          continue;
        }

        if (!hasDistinctGap) {
          console.log(`[Detection] Rejected at Step 7 — insufficient contrast ratio (${(maxDensity / (secondMaxDensity + 0.001)).toFixed(2)}x < ${MIN_CONTRAST_RATIO}x)`);
          continue;
        }

        // Determine rotation based on which corner has the highest density
        let rotation: 0 | 90 | 180 | 270;
        if (maxIndex === 0) {
          rotation = 0; // TL
        } else if (maxIndex === 1) {
          rotation = 90; // TR
        } else if (maxIndex === 3) {
          rotation = 180; // BR
        } else {
          rotation = 270; // BL (maxIndex === 2)
        }


        // ── NEW: EXTRACT 4 CORNER POINTS ──────────────────────────────────────
        let topLeft = { x: TARGET_WIDTH, y: TARGET_HEIGHT, sum: TARGET_WIDTH + TARGET_HEIGHT };
        let topRight = { x: 0, y: TARGET_HEIGHT, diff: -TARGET_WIDTH };
        let bottomRight = { x: 0, y: 0, sum: 0 };
        let bottomLeft = { x: TARGET_WIDTH, y: 0, diff: TARGET_WIDTH };

        // Iterate through the specific bounding box to find extreme points
        for (let row = y; row < Math.min(y + h, TARGET_HEIGHT); row++) {
          for (let col = x; col < Math.min(x + w, TARGET_WIDTH); col++) {
            const idx = row * TARGET_WIDTH + col;
            if (binaryData[idx] === 0) { // If it's a black pixel
              const sum = col + row;
              const diff = col - row;
              
              if (sum < topLeft.sum) topLeft = { x: col, y: row, sum };
              if (diff > topRight.diff) topRight = { x: col, y: row, diff };
              if (sum > bottomRight.sum) bottomRight = { x: col, y: row, sum };
              if (diff < bottomLeft.diff) bottomLeft = { x: col, y: row, diff };
            }
          }
        }

        // Scale the 4 corners back up to the original high-res photo coordinates
        const corners = {
          topLeft: { x: Math.floor(topLeft.x * scaleX), y: Math.floor(topLeft.y * scaleY) },
          topRight: { x: Math.floor(topRight.x * scaleX), y: Math.floor(topRight.y * scaleY) },
          bottomRight: { x: Math.floor(bottomRight.x * scaleX), y: Math.floor(bottomRight.y * scaleY) },
          bottomLeft: { x: Math.floor(bottomLeft.x * scaleX), y: Math.floor(bottomLeft.y * scaleY) },
        };

        // ── START THE COOLDOWN TIMER ──────────────────────────────────────────
        // (We already checked the throttle at the very top of the worklet)
        // Now that we have a success, we just update the timestamp.
        lastDetectionTime.value = Date.now();

   

        // ── STEP 8 — Scale bounding box back to original frame coordinates ────
        // Bounding box is in downscaled coordinates, scale back up for photo cropping
        const scaledBox = {
          x: Math.floor(x * scaleX),
          y: Math.floor(y * scaleY),
          w: Math.floor(w * scaleX),
          h: Math.floor(h * scaleY),
        };

        console.log(`[FrameProcessor] ✓ MARKER DETECTED! Box: ${w}x${h} (downscaled) → ${scaledBox.w}x${scaledBox.h} (original), Rotation: ${rotation}°`);
handleMarkerDetectedJS(scaledBox, corners, rotation, sourceWidth, sourceHeight);
        return; // Stop after first valid marker
      }
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
        {/* ── Layer 1 (bottom): Camera preview ── */}
        {device != null ? (
          <Camera
            ref={cameraRef}
            style={styles.cameraPreview}
            device={device}
            isActive={isScanning}
            photo={true}
            video={false}
            format={format}
            pixelFormat="rgb"
            frameProcessor={frameProcessor}
          />
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
          <View style={styles.viewfinderBorder}>
            <Animated.View
              style={[
                styles.corner,
                styles.cornerTopLeft,
                {
                  backgroundColor: cornerBorderColor,
                  transform: [{ scale: cornerScale }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.corner,
                styles.cornerTopRight,
                {
                  backgroundColor: cornerBorderColor,
                  transform: [{ scale: cornerScale }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.corner,
                styles.cornerBottomLeft,
                {
                  backgroundColor: cornerBorderColor,
                  transform: [{ scale: cornerScale }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.corner,
                styles.cornerBottomRight,
                {
                  backgroundColor: cornerBorderColor,
                  transform: [{ scale: cornerScale }],
                },
              ]}
            />
          </View>
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

        {/* ── Layer 4: Green capture flash ── */}
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
  });
