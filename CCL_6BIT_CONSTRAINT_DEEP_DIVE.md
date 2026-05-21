# CCL 6-Bit Constraint - Deep Diagnostic Build

## Confirmed Bug
**Maximum compMaxY found: 63** - This is exactly `0b111111` (6 bits), proving Y-coordinates are truncated.

## Comprehensive Debugging Added

I've added debugging at EVERY stage of the pipeline to isolate where the 6-bit constraint is applied:

### 1. Downscaling Stage (Step 2)
```
[Downscale Debug] Processed rows 0-X, grayData length: Y
```
**What to check:**
- Does `maxDyProcessed` reach 269?
- Is `grayData.length` exactly 129,600 (480 × 270)?

**If maxDyProcessed = 63:** The downscaling loop itself is constrained
**If maxDyProcessed = 269:** Downscaling is fine, bug is downstream

### 2. Thresholding Stage (Step 3)
```
[Threshold Debug] Blocks: 60x34, will cover rows 0-271
[Threshold Debug] Black pixels in rows 64-269: X
```
**What to check:**
- Are there 34 blocks vertically (blocksY)?
- Are there black pixels beyond row 63?

**If blackPixelsAbove63 = 0:** The thresholding is making everything white beyond row 63
**If blackPixelsAbove63 > 0:** Thresholding is fine, bug is in CCL

### 3. CCL Stats Collection (Step 4)
```
[CCL Debug] Scanning full frame: rows 0-270, cols 0-480
[CCL Debug] Max row iterated: X, Labeled pixels above row 63: Y
[CCL Debug] Attempting to set compMaxY[N] = X (currently Y)
```
**What to check:**
- Does `maxRowSeen` reach 269?
- Are there labeled pixels above row 63?
- Do we ever attempt to set compMaxY > 63?

**If maxRowSeen = 63:** The loop is somehow constrained (impossible based on code)
**If pixelsAboveRow63 = 0:** No black pixels are being labeled beyond row 63
**If we see "Attempting to set compMaxY[N] = 64+":** The assignment is being truncated

### 4. Final Result
```
[CCL Debug] Maximum compMaxY found: X (should be able to reach 269)
```

## Possible Root Causes

### Theory A: Downscaling Constraint
The `for (let dy = 0; dy < TARGET_HEIGHT; dy++)` loop is somehow only executing 64 times.
**Evidence:** `maxDyProcessed = 63`
**Fix:** Check if TARGET_HEIGHT is being overridden or if there's a worklet limitation

### Theory B: Thresholding Produces No Black Pixels Beyond Row 63
The adaptive thresholding is making all pixels white beyond row 63.
**Evidence:** `blackPixelsAbove63 = 0`
**Fix:** Check if `blocksY` calculation is wrong or if `by < blocksY` is constrained

### Theory C: CCL Labeling Skips Rows Beyond 63
The CCL first pass never labels pixels beyond row 63.
**Evidence:** `pixelsAboveRow63 = 0` in stats collection
**Fix:** Check the CCL first pass loop bounds

### Theory D: Int32Array Assignment Truncation
The assignment `compMaxY[root] = row` is being truncated to 6 bits.
**Evidence:** We see "Attempting to set compMaxY[N] = 100" but compMaxY stays at 63
**Fix:** Replace Int32Array with regular JavaScript array

### Theory E: Worklet Memory/Loop Limitation
React Native Worklets has an undocumented constraint on loop iterations or array sizes.
**Evidence:** All loops report correct bounds but execution stops at 64
**Fix:** Split processing into smaller chunks or reduce buffer size

## How to Test

```powershell
# Terminal 1: Metro
cd MarkerScanner
npm start

# Terminal 2: Logs
adb logcat | Select-String -Pattern "Debug|Detection"
```

Point camera at marker and watch for the debug output.

## Next Steps

Based on the log output, we'll know EXACTLY which stage is applying the 6-bit constraint and can apply the appropriate fix.
