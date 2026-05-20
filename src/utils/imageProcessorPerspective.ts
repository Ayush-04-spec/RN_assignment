import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';

const { PerspectiveTransform } = NativeModules;

type Corners = {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
};

/**
 * Extracts a marker from a high-resolution photo using 4-point perspective transform.
 * This produces a perfectly flat, tightly cropped 300×300px image with zero geometric skew.
 *
 * @param photoUri - Full-resolution photo URI from camera.takePhoto()
 * @param corners - 4 corner coordinates of the marker in photo coordinates
 * @param rotation - Detected marker rotation (0, 90, 180, or 270)
 * @returns File path with 'file://' prefix, or null on error
 */
export async function extractAndProcessMarkerPerspective(
  photoUri: string,
  corners: Corners,
  rotation: 0 | 90 | 180 | 270,
): Promise<string | null> {
  try {
    const startTime = Date.now();
    console.log(
      `[ImageProcessor] Starting perspective transform: ${photoUri}, rotation: ${rotation}°`,
    );
    console.log(
      `[ImageProcessor] Corners: TL(${corners.topLeft.x.toFixed(0)},${corners.topLeft.y.toFixed(0)}) ` +
      `TR(${corners.topRight.x.toFixed(0)},${corners.topRight.y.toFixed(0)}) ` +
      `BR(${corners.bottomRight.x.toFixed(0)},${corners.bottomRight.y.toFixed(0)}) ` +
      `BL(${corners.bottomLeft.x.toFixed(0)},${corners.bottomLeft.y.toFixed(0)})`
    );

    // Ensure URI has file:// prefix
    const cleanUri = photoUri.startsWith('file://') ? photoUri : `file://${photoUri}`;

    // Call native module to perform perspective transform
    const outputUri = await PerspectiveTransform.transformImage(
      cleanUri,
      corners,
      rotation,
    );

    const elapsed = Date.now() - startTime;
    console.log(
      `[ImageProcessor] ✓ Perspective transform complete — rotation: ${rotation}°, size: 300×300, time: ${elapsed}ms, saved to: ${outputUri}`,
    );

    return outputUri;
  } catch (error) {
    console.error('[ImageProcessor] ✗ Failed to perform perspective transform:', error);
    if (error instanceof Error) {
      console.error('[ImageProcessor] Error message:', error.message);
      console.error('[ImageProcessor] Error stack:', error.stack);
    }
    return null;
  }
}

/**
 * Fallback: If perspective transform fails, use the old bounding box method.
 * This is kept for backwards compatibility.
 */
export async function extractAndProcessMarkerFallback(
  photoUri: string,
  boundingBox: { x: number; y: number; w: number; h: number },
  rotation: 0 | 90 | 180 | 270,
): Promise<string | null> {
  // Import the old implementation
  const { extractAndProcessMarker } = require('./imageProcessor');
  return extractAndProcessMarker(photoUri, boundingBox, rotation);
}
