# How to Test Rotation Support

## Setup (3 Terminals)

### Terminal 1: Metro Bundler
```powershell
cd C:\RN_assignment\MarkerScanner
npm start
```
**Keep running** - Metro bundler

---

### Terminal 2: Logs
```powershell
adb logcat | Select-String -Pattern "Detection|FrameProcessor|PerspectiveTransform|OpenCV"
```
**Keep running** - Monitor detection and rotation logs

---

### Terminal 3: (Optional) Full Logs
```powershell
adb logcat -s ReactNativeJS:V
```
**Keep running** - See all React Native logs

---

## On Your Phone

1. **Open MarkerScanner app**
2. **Grant camera permission**
3. **Start scanning!**

---

## Test 1: Verify Rotation Detection

### What to do:
1. Hold marker **upright** (pig facing up)
2. Watch Terminal 2 logs

### Expected logs:
```
[FrameProcessor] ✓ DETECTED! Throttle active for 1.5s
[ImageProcessor] Starting perspective transform: file://..., rotation: 0°
[PerspectiveTransform] Starting perspective transform: file://..., rotation: 0°
[PerspectiveTransform] No rotation applied (0°)
[PerspectiveTransform] ✓ Perspective transform complete: 45ms, rotation: 0°, saved to: ...
```

---

## Test 2: Verify Rotation Correction

### What to do:
1. **Rotate the marker 90° clockwise** (pig facing right)
2. Scan it
3. Watch Terminal 2 logs

### Expected logs:
```
[FrameProcessor] ✓ DETECTED! Throttle active for 1.5s
[ImageProcessor] Starting perspective transform: file://..., rotation: 90°
[PerspectiveTransform] Starting perspective transform: file://..., rotation: 90°
[PerspectiveTransform] Applied 90° clockwise rotation
[PerspectiveTransform] ✓ Perspective transform complete: 52ms, rotation: 90°, saved to: ...
```

### What to check:
- ✓ Logs show `rotation: 90°`
- ✓ Logs show `Applied 90° clockwise rotation`
- ✓ Image in Results screen is **upright** (pig facing up)

---

## Test 3: All 4 Rotations

### Scan the marker in all 4 orientations:

| Physical Marker | Expected Log | Expected Result |
|----------------|--------------|-----------------|
| Pig facing **up** | `rotation: 0°`, `No rotation applied` | Image upright |
| Pig facing **right** | `rotation: 90°`, `Applied 90° clockwise` | Image upright |
| Pig facing **down** | `rotation: 180°`, `Applied 180° rotation` | Image upright |
| Pig facing **left** | `rotation: 270°`, `Applied 270° clockwise` | Image upright |

### Visual Check:
After scanning 20 markers at different angles:
1. Go to Results screen
2. **ALL 20 images should be upright** (pig facing up)
3. No images should be sideways or upside down

---

## Test 4: Mixed Rotations

### What to do:
1. Scan 5 markers **upright** (0°)
2. Scan 5 markers **rotated 90° CW**
3. Scan 5 markers **upside down** (180°)
4. Scan 5 markers **rotated 90° CCW** (270°)
5. Go to Results screen

### Expected:
- ✓ All 20 images are **upright**
- ✓ No visual difference between images scanned at different angles
- ✓ Consistent orientation across the grid

---

## Success Criteria

✅ **Logs show correct rotation values** (0, 90, 180, 270)  
✅ **Logs show rotation being applied** ("Applied X° rotation")  
✅ **All images in Results screen are upright**  
✅ **No images are sideways or upside down**  
✅ **Consistent orientation regardless of physical marker angle**  

---

## Troubleshooting

### If rotation is not being applied:
1. Check Terminal 2 logs - do you see `rotation: X°`?
2. If yes, but images are still rotated → Java module issue
3. If no → TypeScript not passing rotation parameter

### If app crashes with "TurboModule argument count" error:
- The 3-argument fix didn't work
- Check that Java method signature has `double rotation` parameter
- Rebuild: `cd android && ./gradlew clean && ./gradlew assembleDebug`

### If images are rotated incorrectly:
- Check the rotation mapping in logs
- Verify OpenCV constants match the rotation values
- See `ROTATION_PIPELINE_SYNCHRONIZED.md` for mapping table

---

## Quick Test Command

Run all 3 terminals at once (PowerShell):

```powershell
# Terminal 1
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd C:\RN_assignment\MarkerScanner; npm start"

# Terminal 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "adb logcat | Select-String -Pattern 'Detection|FrameProcessor|PerspectiveTransform|OpenCV'"

# Then open the app on your phone
```

---

**Ready to test!** 📱🔄
