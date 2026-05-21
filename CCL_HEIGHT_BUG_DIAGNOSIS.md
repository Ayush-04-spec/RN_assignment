# CCL Height Bug Diagnosis - Debug Build Installed

## Problem Statement
Connected Component Labeling (CCL) algorithm is capping component heights at exactly 64 pixels, even though the working buffer is 480×270 pixels. Large shapes are being artificially sliced horizontally (e.g., 77×64, 55×64, 63×64).

## Investigation Completed
I've audited the entire CCL pipeline in `CameraScreen.tsx` and found:

### ✅ Verified Correct:
1. **Downscaling Loop** (lines 315-330): Correctly iterates `dy` from 0 to 270
   ```typescript
   for (let dy = 0; dy < TARGET_HEIGHT; dy++) // TARGET_HEIGHT = 270
   ```

2. **Adaptive Thresholding** (lines 333-365): Correctly processes all 34 blocks vertically
   ```typescript
   blocksY = Math.ceil(270 / 8) = 34 blocks
   for (let by = 0; by < blocksY; by++) // Covers all 270 rows
   ```

3. **CCL First Pass** (lines 392-415): Correctly iterates all rows
   ```typescript
   for (let row = 0; row < TARGET_HEIGHT; row++) // 0 to 270
   ```

4. **Stats Collection Loop** (lines 432-444): Correctly scans entire frame
   ```typescript
   for (let row = 0; row < TARGET_HEIGHT; row++) // 0 to 270
   ```

5. **Array Initialization**: All arrays sized correctly
   ```typescript
   compMinY.fill(TARGET_HEIGHT) // 270
   compMaxY.fill(-1) // Will be updated to actual max row
   ```

### 🔍 No Suspicious Patterns Found:
- ❌ No bitwise masks (e.g., `& 0x3F` or `& 63`)
- ❌ No hardcoded 64 values
- ❌ No Math.min() operations capping at 64
- ❌ No loop constraints using BLOCK size incorrectly

## Debug Logging Added

I've added three strategic debug logs to diagnose the issue:

### 1. Loop Bounds Verification (line 435)
```typescript
console.log(`[CCL Debug] Scanning full frame: rows 0-${TARGET_HEIGHT}, cols 0-${TARGET_WIDTH}`);
```
**Expected Output:** `[CCL Debug] Scanning full frame: rows 0-270, cols 0-480`

### 2. Maximum compMaxY Tracking (lines 447-453)
```typescript
let maxCompMaxY = -1;
for (let i = 0; i < nextLabel; i++) {
  if (compMaxY[i] > maxCompMaxY) maxCompMaxY = compMaxY[i];
}
console.log(`[CCL Debug] Maximum compMaxY found: ${maxCompMaxY} (should be able to reach 269)`);
```
**Expected Output:** `[CCL Debug] Maximum compMaxY found: <some value> (should be able to reach 269)`
**If Bug Present:** Value will be capped at 63 or 64

### 3. Per-Component Bounds (line 467)
```typescript
console.log(`[CCL Debug] Component ${lbl}: minY=${y}, maxY=${compMaxY[lbl]}, calculated h=${h}`);
```
**Expected Output:** Shows actual minY, maxY, and calculated height for each component
**If Bug Present:** maxY will never exceed 63/64

## How to Test

1. **Start Metro bundler** (if not already running):
   ```bash
   cd MarkerScanner
   npm start
   ```

2. **Launch the app** on your device

3. **Monitor logs** in a separate terminal:
   ```powershell
   adb logcat | Select-String -Pattern "CCL Debug|Detection"
   ```

4. **Point camera at marker** and watch for the debug output

## What to Look For

### If compMaxY is truly capped at 64:
- You'll see: `Maximum compMaxY found: 63` or `64`
- Component logs will show: `maxY=63` or `maxY=64` repeatedly
- This indicates a **runtime constraint** not visible in the source code (possibly a JavaScript engine issue, worklet limitation, or memory corruption)

### If compMaxY can exceed 64:
- You'll see values like: `Maximum compMaxY found: 150` or higher
- This means the bug is elsewhere (possibly in the corner extraction or scaling logic)

## Next Steps Based on Results

### Scenario A: compMaxY IS capped at 64
**Root Cause:** Likely a worklet memory limitation or typed array issue
**Solution:** 
- Try using regular arrays instead of Int32Array
- Split the processing into smaller chunks
- Reduce the working buffer size further

### Scenario B: compMaxY is NOT capped
**Root Cause:** Bug is in a different part of the pipeline
**Investigation:**
- Check the corner extraction loop (lines 656-670)
- Check the scaling back to original coordinates
- Verify the Java OpenCV module isn't constraining dimensions

## Files Modified
- `MarkerScanner/src/screens/CameraScreen.tsx` - Added debug logging to CCL algorithm

## Build Info
- **Build Time:** Just now
- **APK:** `android/app/build/outputs/apk/debug/app-debug.apk`
- **Installation:** Successful via `adb install -r`
