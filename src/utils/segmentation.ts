/**
 * Medical Image Segmentation Algorithms for BME 360:
 * - Global & Adaptive Thresholding
 * - Otsu's Multi-Level Thresholding (variance maximization)
 * - Seeded Region Growing with 8-connectivity
 * - Morphological Operations (Dilation, Erosion, Opening, Closing)
 * - Tissue volume & area quantification
 */

export interface SegmentationResult {
  mask: Uint8Array; // 1 for foreground, 0 for background
  areaPixels: number;
  areaMm2?: number;
  meanIntensity: number;
  stdIntensity: number;
  minIntensity: number;
  maxIntensity: number;
}

/**
 * Computes Otsu's optimal threshold by maximizing inter-class variance
 */
export function computeOtsuThreshold(grayPixels: Uint8ClampedArray): number {
  const histogram = new Int32Array(256);
  const total = grayPixels.length;

  for (let i = 0; i < total; i++) {
    histogram[grayPixels[i]]++;
  }

  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVariance = 0;
  let optimalThreshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    // Between-class variance
    const varianceBetween = wB * wF * (mB - mF) * (mB - mF);

    if (varianceBetween > maxVariance) {
      maxVariance = varianceBetween;
      optimalThreshold = t;
    }
  }

  return optimalThreshold;
}

/**
 * Range Thresholding Segmentation
 */
export function segmentByThreshold(
  rawValues: Float32Array,
  lower: number,
  upper: number,
  pixelSpacing?: [number, number]
): SegmentationResult {
  const length = rawValues.length;
  const mask = new Uint8Array(length);

  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < length; i++) {
    const val = rawValues[i];
    if (val >= lower && val <= upper) {
      mask[i] = 1;
      count++;
      sum += val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }

  const mean = count > 0 ? sum / count : 0;
  let varianceSum = 0;

  for (let i = 0; i < length; i++) {
    if (mask[i] === 1) {
      const diff = rawValues[i] - mean;
      varianceSum += diff * diff;
    }
  }

  const std = count > 0 ? Math.sqrt(varianceSum / count) : 0;
  const pixelAreaMm2 = pixelSpacing ? pixelSpacing[0] * pixelSpacing[1] : undefined;
  const areaMm2 = pixelAreaMm2 !== undefined ? count * pixelAreaMm2 : undefined;

  return {
    mask,
    areaPixels: count,
    areaMm2,
    meanIntensity: Number(mean.toFixed(1)),
    stdIntensity: Number(std.toFixed(1)),
    minIntensity: count > 0 ? Number(min.toFixed(1)) : 0,
    maxIntensity: count > 0 ? Number(max.toFixed(1)) : 0,
  };
}

/**
 * Seeded Region Growing (Queue-based Flood Fill) with 8-connectivity
 */
export function seededRegionGrowing(
  rawValues: Float32Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number,
  pixelSpacing?: [number, number]
): SegmentationResult {
  const size = width * height;
  const mask = new Uint8Array(size);
  const visited = new Uint8Array(size);

  const seedIdx = seedY * width + seedX;
  const targetVal = rawValues[seedIdx];

  const queueX = new Int32Array(size);
  const queueY = new Int32Array(size);
  let head = 0;
  let tail = 0;

  queueX[tail] = seedX;
  queueY[tail] = seedY;
  tail++;
  visited[seedIdx] = 1;

  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dy = [-1, -1, -1, 0, 0, 1, 1, 1];

  while (head < tail) {
    const cx = queueX[head];
    const cy = queueY[head];
    head++;

    const cIdx = cy * width + cx;
    const cVal = rawValues[cIdx];

    if (Math.abs(cVal - targetVal) <= tolerance) {
      mask[cIdx] = 1;
      count++;
      sum += cVal;
      if (cVal < min) min = cVal;
      if (cVal > max) max = cVal;

      for (let k = 0; k < 8; k++) {
        const nx = cx + dx[k];
        const ny = cy + dy[k];

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (visited[nIdx] === 0) {
            visited[nIdx] = 1;
            queueX[tail] = nx;
            queueY[tail] = ny;
            tail++;
          }
        }
      }
    }
  }

  const mean = count > 0 ? sum / count : 0;
  let varianceSum = 0;
  for (let i = 0; i < size; i++) {
    if (mask[i] === 1) {
      const diff = rawValues[i] - mean;
      varianceSum += diff * diff;
    }
  }

  const std = count > 0 ? Math.sqrt(varianceSum / count) : 0;
  const pixelAreaMm2 = pixelSpacing ? pixelSpacing[0] * pixelSpacing[1] : undefined;
  const areaMm2 = pixelAreaMm2 !== undefined ? count * pixelAreaMm2 : undefined;

  return {
    mask,
    areaPixels: count,
    areaMm2,
    meanIntensity: Number(mean.toFixed(1)),
    stdIntensity: Number(std.toFixed(1)),
    minIntensity: count > 0 ? Number(min.toFixed(1)) : 0,
    maxIntensity: count > 0 ? Number(max.toFixed(1)) : 0,
  };
}

/**
 * 3x3 Morphological Operations: Dilation, Erosion, Opening, Closing
 */
export function applyMorphology(
  mask: Uint8Array,
  width: number,
  height: number,
  operation: 'dilate' | 'erode' | 'open' | 'close'
): Uint8Array {
  if (operation === 'open') {
    const eroded = applyMorphology(mask, width, height, 'erode');
    return applyMorphology(eroded, width, height, 'dilate');
  }
  if (operation === 'close') {
    const dilated = applyMorphology(mask, width, height, 'dilate');
    return applyMorphology(dilated, width, height, 'erode');
  }

  const output = new Uint8Array(mask.length);
  const isDilate = operation === 'dilate';

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let hit = false;
      let allOn = true;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const val = mask[ny * width + nx];
          if (val === 1) hit = true;
          else allOn = false;
        }
      }

      output[rowOffset + x] = isDilate ? (hit ? 1 : 0) : (allOn ? 1 : 0);
    }
  }

  return output;
}
