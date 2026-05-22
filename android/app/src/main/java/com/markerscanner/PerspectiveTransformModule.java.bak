package com.markerscanner;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Log;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;

import org.opencv.android.OpenCVLoader;
import org.opencv.android.Utils;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.MatOfPoint2f;
import org.opencv.core.Point;
import org.opencv.core.Size;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.Imgproc;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Native module for performing 4-point perspective transform using OpenCV.
 * Extracts a skewed marker from a high-res photo and produces a flat 300x300px output.
 */
public class PerspectiveTransformModule extends ReactContextBaseJavaModule {
    private static final String TAG = "PerspectiveTransform";
    private static final int OUTPUT_SIZE = 300;
    private static final String MODULE_NAME = "PerspectiveTransform";

    private final ReactApplicationContext reactContext;

    static {
        // Initialize OpenCV
        if (!OpenCVLoader.initDebug()) {
            Log.e(TAG, "❌ OpenCV initialization failed!");
        } else {
            Log.d(TAG, "✓ OpenCV initialized successfully");
        }
    }

    public PerspectiveTransformModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return MODULE_NAME;
    }

    /**
     * Performs 4-point perspective transform on an image with rotation correction.
     *
     * @param imageUri Source image URI from camera.takePhoto() (with file:// prefix)
     * @param corners  ReadableMap containing 4 corner points:
     *                 {
     *                   topLeft: {x: number, y: number},
     *                   topRight: {x: number, y: number},
     *                   bottomRight: {x: number, y: number},
     *                   bottomLeft: {x: number, y: number}
     *                 }
     * @param rotation Physical rotation of the marker in degrees (0, 90, 180, or 270)
     * @param promise  Promise to resolve with output URI or reject with error
     */
    @ReactMethod
    public void transformImage(String imageUri, ReadableMap corners, double rotation, Promise promise) {
        long startTime = System.currentTimeMillis();
        Mat srcMat = null;
        Mat warpedMat = null;
        Mat rotatedMat = null;
        Mat transformMatrix = null;

        try {
            Log.d(TAG, "Starting perspective transform: " + imageUri + ", rotation: " + rotation + "°");

            // ── STEP 1: Strip file:// prefix and load image ────────────────────
            String imagePath = imageUri.replace("file://", "");
            Log.d(TAG, "Loading image from: " + imagePath);

            // Verify file exists
            File imageFile = new File(imagePath);
            if (!imageFile.exists()) {
                promise.reject("FILE_NOT_FOUND", "Image file does not exist: " + imagePath);
                return;
            }

            // Load image using OpenCV
            srcMat = Imgcodecs.imread(imagePath);
            if (srcMat.empty()) {
                promise.reject("LOAD_ERROR", "OpenCV failed to load image from: " + imagePath);
                return;
            }

            int srcWidth = srcMat.cols();
            int srcHeight = srcMat.rows();
            Log.d(TAG, "Loaded image: " + srcWidth + "x" + srcHeight);

            // ── STEP 2: Extract corner coordinates from ReadableMap ───────────
            if (!corners.hasKey("topLeft") || !corners.hasKey("topRight") ||
                !corners.hasKey("bottomRight") || !corners.hasKey("bottomLeft")) {
                promise.reject("INVALID_CORNERS", "Missing corner coordinates in ReadableMap");
                return;
            }

            ReadableMap tl = corners.getMap("topLeft");
            ReadableMap tr = corners.getMap("topRight");
            ReadableMap br = corners.getMap("bottomRight");
            ReadableMap bl = corners.getMap("bottomLeft");

            if (tl == null || tr == null || br == null || bl == null) {
                promise.reject("INVALID_CORNERS", "One or more corner maps are null");
                return;
            }

            // Extract coordinates
            double tlX = tl.getDouble("x");
            double tlY = tl.getDouble("y");
            double trX = tr.getDouble("x");
            double trY = tr.getDouble("y");
            double brX = br.getDouble("x");
            double brY = br.getDouble("y");
            double blX = bl.getDouble("x");
            double blY = bl.getDouble("y");

            Log.d(TAG, String.format("Corners: TL(%.0f,%.0f) TR(%.0f,%.0f) BR(%.0f,%.0f) BL(%.0f,%.0f)",
                    tlX, tlY, trX, trY, brX, brY, blX, blY));

            // Validate coordinates are within image bounds
            if (!isPointValid(tlX, tlY, srcWidth, srcHeight) ||
                !isPointValid(trX, trY, srcWidth, srcHeight) ||
                !isPointValid(brX, brY, srcWidth, srcHeight) ||
                !isPointValid(blX, blY, srcWidth, srcHeight)) {
                promise.reject("INVALID_COORDINATES", "One or more corner points are outside image bounds");
                return;
            }

            // ── STEP 3: Create source and destination point matrices ──────────
            // Source points: 4 corners of the skewed marker in the photo
            Point[] srcPoints = new Point[]{
                    new Point(tlX, tlY),  // Top-Left
                    new Point(trX, trY),  // Top-Right
                    new Point(brX, brY),  // Bottom-Right
                    new Point(blX, blY)   // Bottom-Left
            };

            // Destination points: perfect 300x300 square
            Point[] dstPoints = new Point[]{
                    new Point(0, 0),                        // Top-Left
                    new Point(OUTPUT_SIZE - 1, 0),          // Top-Right
                    new Point(OUTPUT_SIZE - 1, OUTPUT_SIZE - 1),  // Bottom-Right
                    new Point(0, OUTPUT_SIZE - 1)           // Bottom-Left
            };

            MatOfPoint2f srcMat2f = new MatOfPoint2f(srcPoints);
            MatOfPoint2f dstMat2f = new MatOfPoint2f(dstPoints);

            // ── STEP 4: Compute perspective transform matrix ──────────────────
            transformMatrix = Imgproc.getPerspectiveTransform(srcMat2f, dstMat2f);
            Log.d(TAG, "Computed perspective transform matrix");

            // ── STEP 5: Apply perspective warp ────────────────────────────────
            warpedMat = new Mat();
            Imgproc.warpPerspective(
                    srcMat,
                    warpedMat,
                    transformMatrix,
                    new Size(OUTPUT_SIZE, OUTPUT_SIZE),
                    Imgproc.INTER_LINEAR
            );

            Log.d(TAG, "Applied perspective warp: " + warpedMat.cols() + "x" + warpedMat.rows());

            // ── STEP 6: Apply rotation correction ─────────────────────────────
            // Map physical rotation (0, 90, 180, 270) to OpenCV rotation constants
            Mat finalMat;
            int rotationInt = (int) Math.round(rotation);
            
            if (rotationInt == 0) {
                // No rotation needed
                finalMat = warpedMat;
                Log.d(TAG, "No rotation applied (0°)");
            } else if (rotationInt == 90) {
                // Rotate 90° clockwise
                rotatedMat = new Mat();
                Core.rotate(warpedMat, rotatedMat, Core.ROTATE_90_CLOCKWISE);
                finalMat = rotatedMat;
                Log.d(TAG, "Applied 90° clockwise rotation");
            } else if (rotationInt == 180) {
                // Rotate 180°
                rotatedMat = new Mat();
                Core.rotate(warpedMat, rotatedMat, Core.ROTATE_180);
                finalMat = rotatedMat;
                Log.d(TAG, "Applied 180° rotation");
            } else if (rotationInt == 270) {
                // Rotate 270° clockwise (= 90° counter-clockwise)
                rotatedMat = new Mat();
                Core.rotate(warpedMat, rotatedMat, Core.ROTATE_90_COUNTERCLOCKWISE);
                finalMat = rotatedMat;
                Log.d(TAG, "Applied 270° clockwise rotation");
            } else {
                Log.w(TAG, "Invalid rotation value: " + rotation + "°, defaulting to 0°");
                finalMat = warpedMat;
            }

            // ── STEP 7: Save output to cache directory ────────────────────────
            File cacheDir = reactContext.getCacheDir();
            File outputFile = new File(cacheDir, "marker_" + System.currentTimeMillis() + ".jpg");

            boolean success = Imgcodecs.imwrite(outputFile.getAbsolutePath(), finalMat);
            if (!success) {
                promise.reject("SAVE_ERROR", "Failed to save warped image to: " + outputFile.getAbsolutePath());
                return;
            }

            // ── STEP 8: Return output URI with file:// prefix ─────────────────
            String outputUri = "file://" + outputFile.getAbsolutePath();
            long elapsed = System.currentTimeMillis() - startTime;

            Log.d(TAG, "✓ Perspective transform complete: " + elapsed + "ms, rotation: " + rotation + "°, saved to: " + outputUri);
            promise.resolve(outputUri);

        } catch (Exception e) {
            Log.e(TAG, "✗ Perspective transform failed", e);
            promise.reject("TRANSFORM_ERROR", "Perspective transform failed: " + e.getMessage(), e);
        } finally {
            // ── STEP 9: Cleanup OpenCV matrices ───────────────────────────────
            if (srcMat != null) {
                srcMat.release();
            }
            if (warpedMat != null && warpedMat != rotatedMat) {
                warpedMat.release();
            }
            if (rotatedMat != null) {
                rotatedMat.release();
            }
            if (transformMatrix != null) {
                transformMatrix.release();
            }
        }
    }

    /**
     * Validates that a point is within image bounds.
     */
    private boolean isPointValid(double x, double y, int width, int height) {
        return x >= 0 && x < width && y >= 0 && y < height;
    }
}
