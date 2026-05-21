# Buffer Truncation Diagnosis - Frame.toArrayBuffer() Investigation

## Critical Discovery

The 6-bit truncation (max value 63) persists even after replacing Int32Array with regular arrays. This points to a **buffer truncation at the source** - the `frame.toArrayBuffer()` call itself.

## Hypothesis

The frame buffer provided by `react-native-vision-camera` is being truncated to only 64 rows of data, meaning:
- Expected buffer size: `width × height × 4` bytes (RGBA)
- Actual buffer size: `width × 64 × 4` bytes (only 64 rows)

## Diagnostic Logging Added

### 1. Buffer Size Check (lines ~298-308)
```typescript
const buffer = frame.toArrayBuffer();
const pixelData = new Uint8Array(buffer);
const sourceWidth = frame.width;
const sourceHeight = frame.height;

const expectedBufferSize = sourceWidth * sourceHeight * 4; // RGBA
const actualBufferSize = buffer.byteLength;
console.log(`[Buffer Debug] Frame dimensions: ${sourceWidth}x${sourceHeight}`);
console.log(`[Buffer Debug] Expected buffer size: ${expectedBufferSize} bytes`);
console.log(`[Buffer Debug] Actual buffer size: ${actualBufferSize} bytes`);
console.log(`[Buffer Debug] Buffer covers ${Math.floor(actualBufferSize / (sourceWidth * 4))} rows`);
```

**What to look for:**
- If `actualBufferSize` < `expectedBufferSize`: Buffer is truncated at source
- If buffer covers only 64 rows: Confirms the 6-bit constraint is in the native layer

### 2. Pixel Read Test (lines ~325-335)
```typescript
for (let dy = 0; dy < TARGET_HEIGHT; dy++) {
  for (let dx = 0; dx < TARGET_WIDTH; dx++) {
    const sourceY = Math.floor(dy * scaleY);
    const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
    
    // Test if we can read beyond row 63
    if (dy > 63 && dx === 0) {
      const testValue = pixelData[sourceIndex];
      if (testValue === undefined) {
        console.log(`[Buffer Debug] CANNOT READ at dy=${dy}, sourceY=${sourceY}`);
      }
    }
  }
}
```

**What to look for:**
- If we see "CANNOT READ" messages: We're trying to read beyond the buffer
- If `pixelsReadAboveRow63 = 0`: No valid data exists beyond row 63

## Expected Test Results

### Scenario A: Buffer is Truncated (Most Likely)
```
[Buffer Debug] Frame dimensions: 1920x1080
[Buffer Debug] Expected buffer size: 8294400 bytes
[Buffer Debug] Actual buffer size: 491520 bytes  ← ONLY 64 ROWS!
[Buffer Debug] Buffer covers 64 rows
[Buffer Debug] CANNOT READ at dy=64, sourceY=256
```

**Root Cause:** `frame.toArrayBuffer()` is only returning 64 rows of data
**Fix Location:** Native C++ code in react-native-vision-camera

### Scenario B: Buffer is Complete, Data is Blank
```
[Buffer Debug] Frame dimensions: 1920x1080
[Buffer Debug] Expected buffer size: 8294400 bytes
[Buffer Debug] Actual buffer size: 8294400 bytes  ← FULL SIZE
[Buffer Debug] Buffer covers 1080 rows
[Downscale Debug] Successfully read pixels above row 63: 206
[Threshold Debug] Black pixels in rows 64-269: 0  ← NO BLACK PIXELS
```

**Root Cause:** Buffer is complete but rows 64+ contain only white/empty data
**Fix:** Camera configuration or frame format issue

### Scenario C: Everything Works (Unexpected)
```
[Buffer Debug] Frame dimensions: 1920x1080
[Buffer Debug] Expected buffer size: 8294400 bytes
[Buffer Debug] Actual buffer size: 8294400 bytes
[Buffer Debug] Buffer covers 1080 rows
[Threshold Debug] Black pixels in rows 64-269: 15000
[CCL Debug] Maximum compMaxY found: 180  ← FIXED!
```

**Root Cause:** Previous fix actually worked, just needed fresh install
**Action:** Celebrate! 🎉

## Potential Native Code Locations

If the buffer is truncated, the issue is in react-native-vision-camera's native code:

### Likely Files (C++/Java):
1. **Frame Buffer Allocation:**
   - `node_modules/react-native-vision-camera/android/src/main/cpp/frameprocessor/`
   - Look for: `toArrayBuffer()` implementation
   - Check: Buffer allocation size calculation

2. **JNI Bridge:**
   - `node_modules/react-native-vision-camera/android/src/main/cpp/`
   - Look for: Frame data copying logic
   - Check: Loop bounds when copying pixel data

3. **Java Frame Wrapper:**
   - `node_modules/react-native-vision-camera/android/src/main/java/com/mrousavy/camera/frameprocessor/`
   - Look for: Frame class implementation
   - Check: Height/size calculations

## Testing Instructions

```powershell
# Terminal 1: Metro
cd MarkerScanner
npm start

# Terminal 2: Logs
adb logcat | Select-String -Pattern "Buffer Debug|Downscale Debug|Threshold Debug|CCL Debug"
```

Point camera at marker and check the logs.

## Next Steps Based on Results

### If Buffer is Truncated:
1. Search react-native-vision-camera source for buffer allocation
2. Find where height is being capped at 64
3. Either:
   - Fix the library (submit PR)
   - Use a different frame access method
   - Process the frame in smaller chunks

### If Buffer is Complete:
1. Check why black pixels don't exist beyond row 63
2. Verify camera is actually capturing full frame
3. Check if there's a crop/region-of-interest setting

The diagnostic build is ready. Run it and share the `[Buffer Debug]` output!
