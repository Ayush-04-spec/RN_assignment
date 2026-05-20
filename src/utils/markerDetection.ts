'worklet';
// break cache
import type { DetectionResult } from '../types';

// ── Module-level frame counter ─────────────────────────────────────────────
// Incremented on every call; only every 6th frame is actually processed.
let frameCounter = 0;

// ── Union-Find helpers for connected components ────────────────────────────
function findRoot(parent: Int32Array, i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]]; // path compression
    i = parent[i];
  }
  return i;
}

function union(parent: Int32Array, a: number, b: number): void {
  const ra = findRoot(parent, a);
  const rb = findRoot(parent, b);
  if (ra !== rb) {
    parent[rb] = ra;
  }
}

// ── Main export ────────────────────────────────────────────────────────────
export function detectMarker(
  frameData: Uint8Array,
  frameWidth: number,
  frameHeight: number,
): DetectionResult {
  const NONE: DetectionResult = { detected: false, boundingBox: null, corners: null, rotation: null };

  // ── STEP 1 — Frame sampling ──────────────────────────────────────────────
  // Record total detection time from function entry.
  const startTime = Date.now();

  frameCounter += 1;
  if (frameCounter >= 600) {
    frameCounter = 0;
  }
  if (frameCounter % 6 !== 0) {
    return NONE;
  }

  const totalPixels = frameWidth * frameHeight;

  // ── STEP 2 — Grayscale conversion (RGBA input, 4 bytes/pixel) ───────────
  // pixelFormat="rgb" is set on the Camera component, so the buffer is RGBA.
  // R = frameData[i*4+0], G = frameData[i*4+1], B = frameData[i*4+2]
  const grayData = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const base = i * 4;
    grayData[i] =
      (0.299 * frameData[base] + 0.587 * frameData[base + 1] + 0.114 * frameData[base + 2]) /
      255;
  }

  // ── STEP 3 — Adaptive thresholding (16×16 blocks) ───────────────────────
  // For each block: compute mean gray value, then threshold each pixel
  // relative to that block mean. Handles uneven lighting.
  const BLOCK = 16;
  const binaryData = new Uint8Array(totalPixels); // 0 = BLACK, 1 = WHITE

  const blocksX = Math.ceil(frameWidth / BLOCK);
  const blocksY = Math.ceil(frameHeight / BLOCK);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const x0 = bx * BLOCK;
      const y0 = by * BLOCK;
      const x1 = Math.min(x0 + BLOCK, frameWidth);
      const y1 = Math.min(y0 + BLOCK, frameHeight);

      // Compute block mean
      let sum = 0;
      let count = 0;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          sum += grayData[py * frameWidth + px];
          count++;
        }
      }
      const blockMean = count > 0 ? sum / count : 0.5;
      const threshold = blockMean - 0.10;

      // Threshold each pixel in this block
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const idx = py * frameWidth + px;
          binaryData[idx] = grayData[idx] < threshold ? 0 : 1;
        }
      }
    }
  }

  // ── STEP 4 — Connected component labeling (two-pass, 4-connectivity) ────
  // Connect BLACK pixels (binaryData === 0).
  const labels = new Int32Array(totalPixels).fill(-1);
  const parent = new Int32Array(totalPixels * 2); // generous upper bound
  let nextLabel = 0;

  // First pass: assign provisional labels and record equivalences
  for (let row = 0; row < frameHeight; row++) {
    for (let col = 0; col < frameWidth; col++) {
      const idx = row * frameWidth + col;
      if (binaryData[idx] !== 0) {
        continue; // WHITE pixel — skip
      }

      const above = row > 0 ? labels[(row - 1) * frameWidth + col] : -1;
      const left = col > 0 ? labels[row * frameWidth + (col - 1)] : -1;

      if (above === -1 && left === -1) {
        // New label
        parent[nextLabel] = nextLabel;
        labels[idx] = nextLabel;
        nextLabel++;
      } else if (above !== -1 && left === -1) {
        labels[idx] = above;
      } else if (above === -1 && left !== -1) {
        labels[idx] = left;
      } else {
        // Both neighbours — use smaller root, record equivalence
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
  const compMinX = new Int32Array(nextLabel).fill(frameWidth);
  const compMaxX = new Int32Array(nextLabel).fill(-1);
  const compMinY = new Int32Array(nextLabel).fill(frameHeight);
  const compMaxY = new Int32Array(nextLabel).fill(-1);
  const compCount = new Int32Array(nextLabel);

  for (let row = 0; row < frameHeight; row++) {
    for (let col = 0; col < frameWidth; col++) {
      const idx = row * frameWidth + col;
      const lbl = labels[idx];
      if (lbl === -1) {
        continue;
      }
      const root = findRoot(parent, lbl);
      if (col < compMinX[root]) { compMinX[root] = col; }
      if (col > compMaxX[root]) { compMaxX[root] = col; }
      if (row < compMinY[root]) { compMinY[root] = row; }
      if (row > compMaxY[root]) { compMaxY[root] = row; }
      compCount[root]++;
    }
  }

  const frameArea = frameWidth * frameHeight;

  // Collect candidate components that pass the shape filter
  interface Candidate {
    x: number; y: number; w: number; h: number;
  }
  const candidates: Candidate[] = [];

  for (let lbl = 0; lbl < nextLabel; lbl++) {
    if (compMaxX[lbl] === -1) {
      continue; // empty / merged away
    }
    if (findRoot(parent, lbl) !== lbl) {
      continue; // not a root — skip duplicates
    }

    const x = compMinX[lbl];
    const y = compMinY[lbl];
    const w = compMaxX[lbl] - x + 1;
    const h = compMaxY[lbl] - y + 1;
    if (w <= 0 || h <= 0) { continue; }

    const pixelCount = compCount[lbl];
    const aspectRatio = w / h;
    const rectArea = w * h;
    const solidity = pixelCount / rectArea;
    const frameAreaRatio = rectArea / frameArea;

    if (
      aspectRatio >= 0.85 && aspectRatio <= 1.15 &&
      frameAreaRatio >= 0.01 && frameAreaRatio <= 0.40 &&
      solidity > 0.80
    ) {
      candidates.push({ x, y, w, h });
    }
  }

  // ── STEPS 5–7: validate each candidate ──────────────────────────────────
  for (const cand of candidates) {
    const { x, y, w, h } = cand;

    // ── STEP 5 — Border darkness validation ─────────────────────────────
    // Sample the outer 12% band on all four sides using float grayData.
    const bandW = Math.max(1, Math.floor(w * 0.12));
    const bandH = Math.max(1, Math.floor(h * 0.12));

    let borderSum = 0;
    let borderCount = 0;

    // Top band
    for (let row = y; row < Math.min(y + bandH, frameHeight); row++) {
      for (let col = x; col < Math.min(x + w, frameWidth); col++) {
        borderSum += grayData[row * frameWidth + col];
        borderCount++;
      }
    }
    // Bottom band
    for (let row = Math.max(0, y + h - bandH); row < Math.min(y + h, frameHeight); row++) {
      for (let col = x; col < Math.min(x + w, frameWidth); col++) {
        borderSum += grayData[row * frameWidth + col];
        borderCount++;
      }
    }
    // Left band (excluding corners already counted)
    for (let row = Math.min(y + bandH, frameHeight); row < Math.max(0, y + h - bandH); row++) {
      for (let col = x; col < Math.min(x + bandW, frameWidth); col++) {
        borderSum += grayData[row * frameWidth + col];
        borderCount++;
      }
    }
    // Right band (excluding corners already counted)
    for (let row = Math.min(y + bandH, frameHeight); row < Math.max(0, y + h - bandH); row++) {
      for (let col = Math.max(0, x + w - bandW); col < Math.min(x + w, frameWidth); col++) {
        borderSum += grayData[row * frameWidth + col];
        borderCount++;
      }
    }

    if (borderCount === 0) { continue; }
    const borderMean = borderSum / borderCount;
    if (borderMean > 0.35) {
      continue; // border too bright — not a dark frame
    }

    // ── STEP 6 — Inner white area validation ────────────────────────────
    const innerX = Math.floor(x + w * 0.20);
    const innerY = Math.floor(y + h * 0.20);
    const innerW = Math.floor(w * 0.60);
    const innerH = Math.floor(h * 0.60);

    let innerSum = 0;
    let innerCount = 0;
    for (let row = innerY; row < Math.min(innerY + innerH, frameHeight); row++) {
      for (let col = innerX; col < Math.min(innerX + innerW, frameWidth); col++) {
        innerSum += grayData[row * frameWidth + col];
        innerCount++;
      }
    }

    if (innerCount === 0) { continue; }
    const innerMean = innerSum / innerCount;
    if (innerMean < 0.55) {
      continue; // interior too dark — not a white-filled marker
    }

    // ── STEP 7 — Corner dot detection and orientation ────────────────────
    // Inner area = bbox inset by 12% on each side
    const iaX = Math.floor(x + w * 0.12);
    const iaY = Math.floor(y + h * 0.12);
    const iaW = Math.floor(w * 0.76);
    const iaH = Math.floor(h * 0.76);

    // Four quadrant regions, each 25%×25% of inner area
    const qW = Math.floor(iaW * 0.25);
    const qH = Math.floor(iaH * 0.25);

    const quadrants = [
      { name: 'TL', x0: iaX,            y0: iaY            },
      { name: 'TR', x0: iaX + iaW - qW, y0: iaY            },
      { name: 'BL', x0: iaX,            y0: iaY + iaH - qH },
      { name: 'BR', x0: iaX + iaW - qW, y0: iaY + iaH - qH },
    ] as const;

    const densities: number[] = [];
    for (const q of quadrants) {
      let blackCount = 0;
      let total = 0;
      for (let row = q.y0; row < Math.min(q.y0 + qH, frameHeight); row++) {
        for (let col = q.x0; col < Math.min(q.x0 + qW, frameWidth); col++) {
          if (binaryData[row * frameWidth + col] === 0) {
            blackCount++;
          }
          total++;
        }
      }
      densities.push(total > 0 ? blackCount / total : 0);
    }

    // densities[0]=TL, [1]=TR, [2]=BL, [3]=BR
    const activeCorners = densities.filter(d => d > 0.40);
    if (activeCorners.length !== 1) {
      continue; // 0 or >1 active corners — not a valid marker
    }

    let rotation: 0 | 90 | 180 | 270;
    if      (densities[0] > 0.40) { rotation = 0;   }  // TL
    else if (densities[1] > 0.40) { rotation = 90;  }  // TR
    else if (densities[3] > 0.40) { rotation = 180; }  // BR
    else                          { rotation = 270; }  // BL

    // ── STEP 8 — Return result ───────────────────────────────────────────
    const elapsed = Date.now() - startTime;
    console.log(
      `[Detection] Marker found — bbox: ${x},${y} ${w}×${h}, rotation: ${rotation}°, time: ${elapsed}ms`,
    );

    return {
      detected: true,
      boundingBox: { x, y, w, h },
      corners: null, // TODO: Extract 4 corner points from connected component
      rotation,
    };
  }

  return NONE;
}
