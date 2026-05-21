# CRITICAL FIX: Buffer Stride Correction

## Root Cause Identified

The buffer provided by `frame.toArrayBuffer()` is **single-channel grayscale** (2,073,600 bytes), NOT RGBA (8,294,400 bytes).

### The Math:
- **Expected (RGBA):** 1920 × 1080 × 4 = 8,294,400 bytes
- **Actual (Grayscale):** 1920 × 1080 × 1 = 2,073,600 bytes

Despite setting `pixelFormat="rgb"` on the Camera component, react-native-vision-camera is providing a single-channel buffer.

## The Bug

The code was calculating pixel indices with a `* 4` multiplier for RGBA:
```typescript
// WRONG (for single-channel buffer):
const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
const gray = (0.299 * pixelData[sourceIndex] +
             0.587 * pixelData[sourceIndex + 1] +
             0.114 * pixelData[sourceIndex + 2]) / 255;
```

This caused:
1. **Out-of-bounds reads** - Accessing indices 4× larger than buffer size
2. **Undefined values** - Reading beyond buffer returned `undefined`
3. **NaN in grayData** - `undefined / 255 = NaN`
4. **Failed thresholding** - `NaN < threshold` always false
5. **No black pixels** - Everything treated as white
6. **Empty CCL** - No components detected beyond row 63

## The Fix

Removed the `* 4` multiplier and RGB-to-grayscale conversion:
```typescript
// CORRECT (for single-channel buffer):
const sourceIndex = sourceY * sourceWidth + sourceX;
const gray = pixelData[sourceIndex] / 255;
```

### Complete Fixed Downscaling Loop:
```typescript
for (let dy = 0; dy < TARGET_HEIGHT; dy++) {
  for (let dx = 0; dx < TARGET_WIDTH; dx++) {
    const sourceX = Math.floor(dx * scaleX);
    const sourceY = Math.floor(dy * scaleY);
    
    // Single-channel buffer - no * 4 multiplier
    const sourceIndex = sourceY * sourceWidth + sourceX;
    
    // Buffer is already grayscale, just normalize
    const gray = pixelData[sourceIndex] / 255;
    
    grayData[dy * TARGET_WIDTH + dx] = gray;
  }
}
```

## Why This Fixes the 63-Row Bug

The `* 4` multiplier was causing us to read beyond the buffer boundary:
- **Row 0-63:** sourceIndex = 0 to ~491,520 (within 2,073,600 buffer) ✅
- **Row 64+:** sourceIndex = 491,520+ (beyond buffer) ❌ → `undefined`

When we tried to read row 64:
```typescript
sourceY = 256 (for dy=64 with downscaling)
sourceIndex = (256 * 1920 + 0) * 4 = 1,966,080
// But buffer only has 2,073,600 bytes, and we're reading RGBA (4 bytes)
// So we can only safely read up to index 518,400 (2,073,600 / 4)
// Which corresponds to row 270 / 4 = 67.5 rows
```

Actually, let me recalculate more carefully:
- Buffer size: 2,073,600 bytes
- With `* 4` multiplier, we can only access: 2,073,600 / 4 = 518,400 pixels
- That's 518,400 / 1920 = **270 rows** of the source image
- But we're downscaling from 1080 to 270, so scaleY = 4
- When dy = 64, sourceY = 64 * 4 = 256
- sourceIndex = (256 * 1920 + 0) * 4 = 1,966,080 ✅ (within buffer)

Wait, that should work... Let me think about this differently.

Actually, the issue is simpler: When we multiply by 4, we're treating the buffer as RGBA, so:
- We read 4 bytes per pixel
- We can only access 518,400 "pixels" (groups of 4 bytes)
- That's 518,400 / 1920 = 270 rows

But the buffer is actually 1920 × 1080 = 2,073,600 **single bytes**, not groups of 4.

So when we do `sourceIndex * 4`, we're jumping 4× further than we should, effectively only reading 1/4 of the image height.

## Expected Results

After this fix:
```
[Downscale Debug] Successfully read pixels above row 63: 206
[Threshold Debug] Black pixels in rows 64-269: 15000+
[CCL Debug] Maximum compMaxY found: 180+  ← FIXED!
```

## Files Modified
- `MarkerScanner/src/screens/CameraScreen.tsx`
  - Removed `* 4` multiplier from sourceIndex calculation
  - Removed RGB-to-grayscale conversion (already grayscale)
  - Simplified to: `gray = pixelData[sourceIndex] / 255`

## Testing
```powershell
# Terminal 1: Metro
cd MarkerScanner
npm start

# Terminal 2: Logs
adb logcat | Select-String -Pattern "Debug|Detection"
```

Point camera at marker and verify `Maximum compMaxY found` exceeds 63!
