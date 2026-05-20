import ImageEditor from '@react-native-community/image-editor';
import ImageResizer from 'react-native-image-resizer';
import RNFS from 'react-native-fs';

/**
 * Extracts a marker from a high-resolution photo, applies rotation correction,
 * and resizes it to 300×300px for storage.
 *
 * @param photoUri - Full-resolution photo URI from camera.takePhoto()
 * @param boundingBox - Bounding box in FRAME coordinates (not screen coordinates)
 * @param rotation - Detected marker rotation (0, 90, 180, or 270)
 * @returns File path with 'file://' prefix, or null on error
 */
export async function extractAndProcessMarker(
  photoUri: string,
  boundingBox: { x: number; y: number; w: number; h: number },
  rotation: 0 | 90 | 180 | 270,
): Promise<string | null> {
  try {
    const startTime = Date.now();
    console.log(`[ImageProcessor] Starting processing: ${photoUri}, box: ${boundingBox.w}x${boundingBox.h}, rotation: ${rotation}°`);

    // Ensure URI has file:// prefix
    const cleanUri = photoUri.startsWith('file://') ? photoUri : `file://${photoUri}`;

    // ── STEP 1: Crop to bounding box ────────────────────────────────────────
    const croppedResult = await ImageEditor.cropImage(cleanUri, {
      offset: { x: boundingBox.x, y: boundingBox.y },
      size: { width: boundingBox.w, height: boundingBox.h },
    });

    const croppedUri = typeof croppedResult === 'string' ? croppedResult : croppedResult.uri;
    console.log(`[ImageProcessor] Cropped to: ${croppedUri}`);

    // ── STEP 2: Rotate and resize to 300×300 ────────────────────────────────
    // Rotation mapping: goal is to have the corner dot in the top-left after rotation
    // 0° → no rotation needed (dot already top-left)
    // 90° → rotate 270° to move dot from top-right to top-left
    // 180° → rotate 180° to move dot from bottom-right to top-left
    // 270° → rotate 90° to move dot from bottom-left to top-left
    let rotationDegrees = 0;
    if (rotation === 90) {
      rotationDegrees = 270;
    } else if (rotation === 180) {
      rotationDegrees = 180;
    } else if (rotation === 270) {
      rotationDegrees = 90;
    }

    const resizedResult = await ImageResizer.createResizedImage(
      croppedUri,
      300,
      300,
      'JPEG',
      95,
      rotationDegrees,
    );

    console.log(`[ImageProcessor] Resized and rotated to: ${resizedResult.uri}`);

    // ── STEP 3: Move to persistent storage ──────────────────────────────────
    const markersDir = `${RNFS.DocumentDirectoryPath}/markers`;

    // Create directory if it doesn't exist
    const dirExists = await RNFS.exists(markersDir);
    if (!dirExists) {
      await RNFS.mkdir(markersDir);
      console.log(`[ImageProcessor] Created directory: ${markersDir}`);
    }

    // Generate unique filename
    const timestamp = Date.now();
    const destPath = `${markersDir}/marker_${timestamp}.jpg`;

    // Strip 'file://' prefix for RNFS operations
    const sourcePath = resizedResult.uri.replace('file://', '');
    const cleanDestPath = destPath.replace('file://', '');

    // Move file from cache to persistent storage
    await RNFS.moveFile(sourcePath, cleanDestPath);

    // Clean up cropped temp file
    try {
      const croppedPath = croppedUri.replace('file://', '');
      if (await RNFS.exists(croppedPath)) {
        await RNFS.unlink(croppedPath);
      }
    } catch (cleanupError) {
      console.warn('[ImageProcessor] Failed to clean up temp file:', cleanupError);
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[ImageProcessor] ✓ Processed marker — rotation: ${rotation}°, size: 300×300, time: ${elapsed}ms, saved to: ${destPath}`,
    );

    // Return with 'file://' prefix for React Native Image components
    return `file://${cleanDestPath}`;
  } catch (error) {
    console.error('[ImageProcessor] ✗ Failed to process marker:', error);
    if (error instanceof Error) {
      console.error('[ImageProcessor] Error message:', error.message);
      console.error('[ImageProcessor] Error stack:', error.stack);
    }
    return null;
  }
}
