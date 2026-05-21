# 🧪 Testing Instructions - Mutex Lock & Two-Stage Detection

## What Was Fixed

### 1. **CameraX Buffer Overflow (CRITICAL)**
- ✅ Implemented SharedValue mutex lock
- ✅ Frames drop instantly when processing
- ✅ Prevents `maxImages (6)` crash
- ✅ 1.5s cooldown between detections

### 2. **Two-Stage Detection Pipeline**
- ✅ Stage 1: Fast bounding box (400×400 ROI, stride-8)
- ✅ Stage 2: Quadrant density validation (anchor dot detection)
- ✅ Eliminates false positives (hands, wrinkles, shadows)

### 3. **Strict Thresholds**
- ✅ `DARK_THRESHOLD = 50` (pure black ink only)
- ✅ Aspect ratio: 0.70 - 1.35 (allows perspective)
- ✅ 60% max size failsafe
- ✅ Anchor density: >15% with 1.5x contrast

## How to Test

### Step 1: Start Log Monitoring

Open a PowerShell terminal and run:

```powershell
adb logcat | Select-String -Pattern "Mutex|Detection|Heartbeat-ROI|State"
```

### Step 2: Launch the App

Open the MarkerScanner app on your device.

### Step 3: Test Marker Detection

#### Valid Marker Test:
1. Hold your 140×140 marker with black border and anchor dot
2. Position 8-18 inches from camera
3. Center the marker in the viewfinder
4. Watch for detection

**Expected Logs:**
```
[Heartbeat-ROI] DarkPixels: 2500 | w: 185 h: 180 | ratio: 1.03 | bounds: (520,280)-(705,460)
[Detection] ✓ Marker validated: 185x180 | Anchor: TR (62.3%) | Quadrants: TL=5.2% TR=62.3% BL=8.1% BR=9.5%
[Mutex] Locked - processing marker
[State] Captured marker 1/20
[Mutex] Unlocked - ready for next marker
```

#### False Positive Test (Should Reject):
1. Hold your hand in front of camera
2. Show bedsheet wrinkles
3. Point at random shadows

**Expected Logs:**
```
[Heartbeat-ROI] DarkPixels: 1800 | w: 150 h: 145 | ratio: 1.03 | bounds: (550,300)-(700,445)
```
*No detection log = rejected by quadrant validation*

### Step 4: Test Mutex Lock (No Crash)

1. Detect a valid marker
2. Immediately move marker rapidly
3. App should NOT crash
4. Should see "Mutex locked" in logs
5. After 1.5s, should see "Mutex unlocked"

**Expected Behavior:**
- ✅ No `maxImages (6)` crash
- ✅ Smooth UI during processing
- ✅ 1.5s cooldown before next detection
- ✅ Frames silently dropped during lock

## Log Interpretation Guide

### ✅ Perfect Detection
```
[Heartbeat-ROI] DarkPixels: 2500 | w: 185 h: 180 | ratio: 1.03
[Detection] ✓ Marker validated: 185x180 | Anchor: TR (62.3%)
[Mutex] Locked - processing marker
[State] Captured marker 1/20
[Mutex] Unlocked - ready for next marker
```

### ⚠️ No Dark Pixels (Marker Too Light)
```
[Heartbeat-ROI] DarkPixels: 45 | w: 0 h: 0 | ratio: 0
```
**Fix:** Increase `DARK_THRESHOLD` to 70-80

### ⚠️ Bad Aspect Ratio (Background Detected)
```
[Heartbeat-ROI] DarkPixels: 1250 | w: 850 h: 120 | ratio: 7.08
```
**Fix:** Increase `MARGIN_RATIO` to 0.20 or decrease `DARK_THRESHOLD` to 40

### ⚠️ Failed Quadrant Validation (No Anchor)
```
[Heartbeat-ROI] DarkPixels: 2200 | w: 170 h: 165 | ratio: 1.03
```
*No detection log = anchor density check failed*
**Fix:** Ensure marker has distinct anchor dot (20×20 black square)

### ⚠️ Bail-out (Dark Environment)
```
[Heartbeat-ROI] Bail-out: 52000 dark pixels (threshold: 50000)
```
**Fix:** Increase `MAX_DARK_PIXELS` to 100,000 or improve lighting

## Tuning Parameters

If detection isn't working, you can adjust these parameters in `CameraScreen.tsx`:

### Location: Frame Processor (around line 360)

```typescript
// ── STEP 1: ROI Definition ──
const ROI_SIZE = 400;  // Size of center search area

// ── STEP 3: Thresholds ──
const DARK_THRESHOLD = 50;      // Lower = more sensitive (30-80)
const MAX_DARK_PIXELS = 50000;  // Bail-out limit (50k-100k)

// ── STEP 4: Validation ──
if (w < 30 || h < 30) return;           // Min size
if (w > 600 || h > 500) return;         // Max size
if (aspectRatio < 0.70 || aspectRatio > 1.35) return;  // Aspect ratio

// ── STEP 5: Anchor Validation ──
if (anchorDensity < 0.15) return;                      // Min anchor density
if (anchorDensity <= otherDensityAvg * 1.5) return;    // Anchor contrast
```

## Quick Fixes

### Marker Not Detected:
```typescript
const DARK_THRESHOLD = 70;  // Increase from 50
```

### Too Many False Positives:
```typescript
const DARK_THRESHOLD = 40;  // Decrease from 50
if (anchorDensity < 0.20) return;  // Increase from 0.15
```

### Dark Environment:
```typescript
const MAX_DARK_PIXELS = 100000;  // Increase from 50000
```

## Success Criteria

- ✅ Detects valid markers with anchor dot
- ✅ Rejects hands, wrinkles, shadows
- ✅ No crashes during rapid movement
- ✅ Smooth UI (no lag or freezing)
- ✅ 1.5s cooldown between captures
- ✅ Captures 20 markers successfully
- ✅ Navigates to Results screen

## Troubleshooting

### App Crashes on Detection:
- Check logs for `maxImages` error
- Verify mutex lock/unlock logs appear
- Ensure `isProcessing.value` is being set

### No Detections at All:
- Check heartbeat logs for bounding box stats
- Verify `w` and `h` are non-zero
- Check if aspect ratio is in range
- Verify anchor density is >15%

### False Positives:
- Increase anchor density threshold to 0.20
- Increase anchor contrast multiplier to 2.0
- Decrease `DARK_THRESHOLD` to 40

### Performance Issues:
- Verify ROI is 400×400 (not full frame)
- Check stride is 8 (not lower)
- Ensure mutex is dropping frames during processing

## Build & Deploy

```powershell
# Build
cd MarkerScanner/android
./gradlew assembleDebug

# Install
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Monitor
adb logcat | Select-String -Pattern "Mutex|Detection|Heartbeat-ROI"
```

## Expected Performance

- **Frame Processing:** <5ms per frame
- **Detection Rate:** ~2 FPS (500ms throttle)
- **Mutex Lock Time:** 240ms (perspective crop)
- **Cooldown:** 1.5s between detections
- **Frames Dropped:** ~45 per detection (safe)
- **Memory:** Stable (no GC pauses)

**Test thoroughly and report any issues!** 🧪

