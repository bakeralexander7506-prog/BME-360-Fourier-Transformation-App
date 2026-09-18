import { DicomSlice, DicomMetadata, AnatomicalPlane } from '../types';

export interface PlaneInfo {
  name: string;
  short: string;
  description: string;
  axis: string;
  cutDirection: string;
  markers: {
    top: string;
    bottom: string;
    left: string;
    right: string;
  };
}

export const ANATOMICAL_PLANES: Record<AnatomicalPlane, PlaneInfo> = {
  axial: {
    name: 'Axial (Transverse)',
    short: 'Axial',
    description: 'Horizontal cut looking Cranio-Caudal (Head to Feet)',
    axis: 'Z',
    cutDirection: 'Superior ↔ Inferior',
    markers: {
      top: 'A (Anterior)',
      bottom: 'P (Posterior)',
      left: 'R (Right)',
      right: 'L (Left)',
    },
  },
  coronal: {
    name: 'Coronal (Frontal)',
    short: 'Coronal',
    description: 'Vertical cut dividing Anterior (Front) and Posterior (Back)',
    axis: 'Y',
    cutDirection: 'Anterior ↔ Posterior',
    markers: {
      top: 'S (Superior)',
      bottom: 'I (Inferior)',
      left: 'R (Right)',
      right: 'L (Left)',
    },
  },
  sagittal: {
    name: 'Sagittal (Lateral)',
    short: 'Sagittal',
    description: 'Vertical cut dividing Right and Left lateral sides',
    axis: 'X',
    cutDirection: 'Right ↔ Left',
    markers: {
      top: 'S (Superior)',
      bottom: 'I (Inferior)',
      left: 'A (Anterior)',
      right: 'P (Posterior)',
    },
  },
};

/**
 * Extracts an interpolated 2D slice from a 3D volumetric slice stack
 * along any of the 3 cardinal anatomical planes:
 * - Axial (XY plane, step along Z)
 * - Coronal (XZ plane, step along Y)
 * - Sagittal (YZ plane, step along X)
 */
export function extractMPRSlice(
  baseSlices: DicomSlice[],
  volWidth: number,
  volHeight: number,
  plane: AnatomicalPlane,
  sliceIdx: number,
  totalSlicesForPlane: number = 32,
  targetSize: number = 256
): Float32Array {
  const depth = baseSlices.length;
  const out = new Float32Array(targetSize * targetSize);

  if (depth === 0) {
    return out;
  }

  // AXIAL (Direct or resampled)
  if (plane === 'axial') {
    const clampedZ = Math.max(0, Math.min(depth - 1, sliceIdx));
    const srcSlice = baseSlices[clampedZ].pixelData;

    if (volWidth === targetSize && volHeight === targetSize) {
      out.set(srcSlice);
      return out;
    }

    const scaleX = volWidth / targetSize;
    const scaleY = volHeight / targetSize;

    for (let y = 0; y < targetSize; y++) {
      const srcY = Math.min(volHeight - 1, Math.floor(y * scaleY));
      const rowOffset = srcY * volWidth;
      const outRowOffset = y * targetSize;

      for (let x = 0; x < targetSize; x++) {
        const srcX = Math.min(volWidth - 1, Math.floor(x * scaleX));
        out[outRowOffset + x] = srcSlice[rowOffset + srcX];
      }
    }
    return out;
  }

  // If we only have 1 single slice in depth, replicate it across depth for visual representation
  if (depth === 1) {
    const srcSlice = baseSlices[0].pixelData;
    out.set(srcSlice);
    return out;
  }

  // CORONAL (XZ cut at fixed Y)
  // X axis (horizontal) = Patient Right to Left
  // Y axis in view (vertical) = Superior (Z=0) to Inferior (Z=depth-1)
  if (plane === 'coronal') {
    const numSlices = Math.max(1, totalSlicesForPlane);
    // Map sliceIdx to source Y coordinate [0, volHeight - 1]
    const normY = numSlices > 1 ? sliceIdx / (numSlices - 1) : 0.5;
    const srcY = Math.max(0, Math.min(volHeight - 1, Math.round(normY * (volHeight - 1))));

    for (let outY = 0; outY < targetSize; outY++) {
      // Z ratio from 0 (Superior / Apex) to depth-1 (Inferior / Base)
      const exactZ = (outY / (targetSize - 1)) * (depth - 1);
      const z0 = Math.floor(exactZ);
      const z1 = Math.min(depth - 1, z0 + 1);
      const t = exactZ - z0;

      const slice0 = baseSlices[z0].pixelData;
      const slice1 = baseSlices[z1].pixelData;

      const yOffset = srcY * volWidth;
      const outOffset = outY * targetSize;

      for (let outX = 0; outX < targetSize; outX++) {
        const srcX = Math.min(volWidth - 1, Math.floor((outX / (targetSize - 1)) * (volWidth - 1)));
        const idx = yOffset + srcX;

        const val0 = slice0[idx];
        const val1 = slice1[idx];
        out[outOffset + outX] = val0 * (1 - t) + val1 * t;
      }
    }
    return out;
  }

  // SAGITTAL (YZ cut at fixed X)
  // X axis in view (horizontal) = Anterior to Posterior (Y=0 to Y=volHeight-1)
  // Y axis in view (vertical) = Superior (Z=0) to Inferior (Z=depth-1)
  if (plane === 'sagittal') {
    const numSlices = Math.max(1, totalSlicesForPlane);
    // Map sliceIdx to source X coordinate [0, volWidth - 1]
    const normX = numSlices > 1 ? sliceIdx / (numSlices - 1) : 0.5;
    const srcX = Math.max(0, Math.min(volWidth - 1, Math.round(normX * (volWidth - 1))));

    for (let outY = 0; outY < targetSize; outY++) {
      // Z ratio from 0 (Superior / Apex) to depth-1 (Inferior / Base)
      const exactZ = (outY / (targetSize - 1)) * (depth - 1);
      const z0 = Math.floor(exactZ);
      const z1 = Math.min(depth - 1, z0 + 1);
      const t = exactZ - z0;

      const slice0 = baseSlices[z0].pixelData;
      const slice1 = baseSlices[z1].pixelData;

      const outOffset = outY * targetSize;

      for (let outX = 0; outX < targetSize; outX++) {
        // Anterior to Posterior along Y
        const srcY = Math.min(volHeight - 1, Math.floor((outX / (targetSize - 1)) * (volHeight - 1)));
        const idx = srcY * volWidth + srcX;

        const val0 = slice0[idx];
        const val1 = slice1[idx];
        out[outOffset + outX] = val0 * (1 - t) + val1 * t;
      }
    }
    return out;
  }

  return out;
}

/**
 * Generates an array of DicomSlice instances for the requested anatomical plane
 * so that any UI component can treat the reconstructed plane as a first-class volumetric series.
 */
export function generatePlaneSlices(
  baseSlices: DicomSlice[],
  volWidth: number,
  volHeight: number,
  plane: AnatomicalPlane,
  metadata?: DicomMetadata,
  targetSize: number = 256
): DicomSlice[] {
  if (plane === 'axial') {
    return baseSlices;
  }

  const depth = baseSlices.length;
  // If only 1 slice, return it with plane marker
  if (depth <= 1) {
    return [
      {
        index: 0,
        pixelData: baseSlices[0]?.pixelData || new Float32Array(targetSize * targetSize),
        description: `${ANATOMICAL_PLANES[plane].name} (Single Slice)`,
        minVal: baseSlices[0]?.minVal,
        maxVal: baseSlices[0]?.maxVal,
      },
    ];
  }

  // Coronal: cuts from Anterior (front) to Posterior (back)
  // Sagittal: cuts from Right to Left
  const numSlices = 24; // 24 high-quality reconstructed cuts across the body depth
  const generated: DicomSlice[] = [];

  const pixelSpacingX = metadata?.pixelSpacing?.[0] || 0.8;
  const pixelSpacingY = metadata?.pixelSpacing?.[1] || 0.8;

  for (let i = 0; i < numSlices; i++) {
    const pixelData = extractMPRSlice(
      baseSlices,
      volWidth,
      volHeight,
      plane,
      i,
      numSlices,
      targetSize
    );

    let sMin = Infinity;
    let sMax = -Infinity;
    for (let p = 0; p < pixelData.length; p++) {
      const v = pixelData[p];
      if (v < sMin) sMin = v;
      if (v > sMax) sMax = v;
    }

    let locationVal = 0;
    let desc = '';

    if (plane === 'coronal') {
      // Y location in mm relative to center
      locationVal = Number(((i / (numSlices - 1) - 0.5) * volHeight * pixelSpacingY).toFixed(1));
      desc = `Coronal • Slice ${i + 1} / ${numSlices} (Y: ${locationVal > 0 ? `+${locationVal}` : locationVal} mm)`;
    } else {
      // X location in mm relative to center
      locationVal = Number(((i / (numSlices - 1) - 0.5) * volWidth * pixelSpacingX).toFixed(1));
      desc = `Sagittal • Slice ${i + 1} / ${numSlices} (X: ${locationVal > 0 ? `+${locationVal}` : locationVal} mm)`;
    }

    generated.push({
      index: i,
      sliceLocation: locationVal,
      instanceNumber: i + 1,
      pixelData,
      description: desc,
      minVal: sMin === Infinity ? 0 : sMin,
      maxVal: sMax === -Infinity ? 255 : sMax,
    });
  }

  return generated;
}
