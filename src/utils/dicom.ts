import dicomParser from 'dicom-parser';
import { DicomMetadata, DicomSlice, ActiveDataset } from '../types';

export interface ParsedDicomImage {
  metadata: DicomMetadata;
  pixelData: Float32Array; // values in Hounsfield Units or raw intensity of active slice
  width: number;
  height: number;
  minVal: number;
  maxVal: number;
  slices: DicomSlice[];
  currentSliceIndex: number;
}

/**
 * Parses an uploaded DICOM (.dcm) binary buffer.
 * Supports multi-frame DICOMs as well as single-frame files.
 */
export function parseDicomFile(buffer: ArrayBuffer, fileName?: string): ParsedDicomImage {
  const byteArray = new Uint8Array(buffer);
  const dataSet = dicomParser.parseDicom(byteArray);

  const rows = dataSet.uint16('x00280010') || 256;
  const cols = dataSet.uint16('x00280011') || 256;
  const bitsAllocated = dataSet.uint16('x00280100') || 16;
  const pixelRepresentation = dataSet.uint16('x00280103') || 0; // 0 = unsigned, 1 = 2's complement
  const rescaleIntercept = dataSet.floatString('x00281052') ?? 0;
  const rescaleSlope = dataSet.floatString('x00281053') ?? 1;

  let windowCenter = dataSet.floatString('x00281050') ?? 40;
  let windowWidth = dataSet.floatString('x00281051') ?? 400;

  // Modality & Study
  const modality = (dataSet.string('x00080060') || 'CT') as DicomMetadata['modality'];
  const patientId = dataSet.string('x00100020') || 'ANON-BME360';
  const patientName =
    dataSet.string('x00100010') || (fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Teaching Case');
  const studyDate = dataSet.string('x00080020') || new Date().toISOString().split('T')[0];
  const seriesDesc = dataSet.string('x0008103e') || `${modality} Study`;

  const pixelSpacingStr = dataSet.string('x00280030');
  let pixelSpacing: [number, number] | undefined;
  if (pixelSpacingStr) {
    const parts = pixelSpacingStr.split('\\').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      pixelSpacing = [parts[0], parts[1]];
    }
  }

  const sliceThickness = dataSet.floatString('x00180050') ?? 2.5;
  const sliceLocation = dataSet.floatString('x00201041');
  const instanceNumber = dataSet.uint16('x00200013') ?? (dataSet.intString('x00200013') ?? 1);

  const pixelElement = dataSet.elements.x7fe00010;
  if (!pixelElement) {
    throw new Error('No pixel data found in DICOM file (x7fe00010).');
  }

  const numPixels = rows * cols;
  const bytesPerPixel = bitsAllocated === 16 ? 2 : 1;
  const frameBytes = numPixels * bytesPerPixel;
  const isSigned = pixelRepresentation === 1;

  // Multi-frame detection
  const numFramesStr = dataSet.string('x00280008');
  let numberOfFrames = numFramesStr ? parseInt(numFramesStr, 10) : 1;
  if (isNaN(numberOfFrames) || numberOfFrames < 1) {
    numberOfFrames = 1;
  }
  if (pixelElement.length >= frameBytes * 2) {
    const calcFrames = Math.floor(pixelElement.length / frameBytes);
    if (calcFrames > numberOfFrames) {
      numberOfFrames = calcFrames;
    }
  }

  const slices: DicomSlice[] = [];
  const baseLoc = sliceLocation ?? 0;

  for (let f = 0; f < numberOfFrames; f++) {
    const frameOffset = pixelElement.dataOffset + f * frameBytes;
    const slicePixels = new Float32Array(numPixels);
    let sMin = Infinity;
    let sMax = -Infinity;

    if (bitsAllocated === 16) {
      const availBytes = Math.max(0, Math.min(numPixels * 2, byteArray.byteLength - frameOffset));
      const view = new DataView(byteArray.buffer, byteArray.byteOffset + frameOffset, availBytes);
      const limit = Math.min(numPixels, Math.floor(availBytes / 2));
      for (let i = 0; i < limit; i++) {
        const rawVal = isSigned ? view.getInt16(i * 2, true) : view.getUint16(i * 2, true);
        const huVal = rawVal * rescaleSlope + rescaleIntercept;
        slicePixels[i] = huVal;
        if (huVal < sMin) sMin = huVal;
        if (huVal > sMax) sMax = huVal;
      }
    } else {
      const limit = Math.min(numPixels, byteArray.length - frameOffset);
      for (let i = 0; i < limit; i++) {
        const rawVal = byteArray[frameOffset + i];
        const huVal = rawVal * rescaleSlope + rescaleIntercept;
        slicePixels[i] = huVal;
        if (huVal < sMin) sMin = huVal;
        if (huVal > sMax) sMax = huVal;
      }
    }

    slices.push({
      index: f,
      sliceLocation: Number((baseLoc + f * sliceThickness).toFixed(2)),
      instanceNumber: instanceNumber + f,
      pixelData: slicePixels,
      description: numberOfFrames > 1 ? `Frame ${f + 1} / ${numberOfFrames}` : `Slice #${instanceNumber}`,
      minVal: sMin === Infinity ? 0 : sMin,
      maxVal: sMax === -Infinity ? 255 : sMax,
    });
  }

  const initialIndex = 0;
  const initialSlice = slices[initialIndex] || {
    index: 0,
    pixelData: new Float32Array(numPixels),
    minVal: 0,
    maxVal: 255,
  };

  const metadata: DicomMetadata = {
    patientId,
    patientName,
    studyDate,
    modality,
    rows,
    columns: cols,
    windowCenter,
    windowWidth,
    rescaleIntercept,
    rescaleSlope,
    pixelSpacing,
    sliceThickness,
    seriesDescription: seriesDesc,
  };

  return {
    metadata,
    pixelData: initialSlice.pixelData,
    width: cols,
    height: rows,
    minVal: initialSlice.minVal ?? 0,
    maxVal: initialSlice.maxVal ?? 255,
    slices,
    currentSliceIndex: initialIndex,
  };
}

/**
 * Parses multiple DICOM files (e.g. from multi-file series selection or folder drop)
 * and consolidates them into a sorted volumetric series.
 */
export async function parseMultipleDicomFiles(files: File[]): Promise<ParsedDicomImage> {
  if (files.length === 1) {
    const buf = await files[0].arrayBuffer();
    return parseDicomFile(buf, files[0].name);
  }

  const parsedList: ParsedDicomImage[] = [];
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseDicomFile(buf, file.name);
      parsedList.push(parsed);
    } catch (e) {
      console.warn(`Could not parse file ${file.name} as DICOM:`, e);
    }
  }

  if (parsedList.length === 0) {
    throw new Error('None of the selected files could be parsed as valid DICOM.');
  }

  const allSlices: DicomSlice[] = [];
  let counter = 0;
  for (const p of parsedList) {
    for (const sl of p.slices) {
      allSlices.push({
        ...sl,
        index: counter++,
      });
    }
  }

  // Sort slices by sliceLocation (or instanceNumber)
  allSlices.sort((a, b) => {
    if (a.sliceLocation !== undefined && b.sliceLocation !== undefined && a.sliceLocation !== b.sliceLocation) {
      return a.sliceLocation - b.sliceLocation;
    }
    if (a.instanceNumber !== undefined && b.instanceNumber !== undefined) {
      return a.instanceNumber - b.instanceNumber;
    }
    return a.index - b.index;
  });

  // Normalize indices
  allSlices.forEach((sl, idx) => {
    sl.index = idx;
    sl.description = `Slice ${idx + 1} / ${allSlices.length}`;
  });

  const base = parsedList[0];
  const midIdx = Math.floor(allSlices.length / 2);
  const activeSlice = allSlices[midIdx] || allSlices[0];

  return {
    metadata: {
      ...base.metadata,
      seriesDescription: `${base.metadata.seriesDescription} (${allSlices.length} Slices)`,
    },
    pixelData: activeSlice.pixelData,
    width: base.width,
    height: base.height,
    minVal: activeSlice.minVal ?? 0,
    maxVal: activeSlice.maxVal ?? 255,
    slices: allSlices,
    currentSliceIndex: midIdx,
  };
}

/**
 * Applies medical windowing (Window Center / Window Width) to HU values
 * outputting standard 0-255 grayscale values.
 */
export function applyDicomWindowing(
  pixelData: Float32Array,
  windowCenter: number,
  windowWidth: number
): Uint8ClampedArray {
  const length = pixelData.length;
  const output = new Uint8ClampedArray(length);
  const halfWidth = windowWidth / 2;
  const lower = windowCenter - halfWidth;
  const upper = windowCenter + halfWidth;
  const range = upper - lower || 1;

  for (let i = 0; i < length; i++) {
    const val = pixelData[i];
    if (val <= lower) {
      output[i] = 0;
    } else if (val >= upper) {
      output[i] = 255;
    } else {
      output[i] = Math.round(((val - lower) / range) * 255);
    }
  }

  return output;
}

/**
 * Standard CT / Medical Window Presets
 */
export const WINDOW_PRESETS = [
  { name: 'CT Soft Tissue', wc: 40, ww: 400 },
  { name: 'CT Lung', wc: -600, ww: 1500 },
  { name: 'CT Bone', wc: 400, ww: 1800 },
  { name: 'Brain (Stroke/Gray-White)', wc: 40, ww: 80 },
  { name: 'PET / Hot Iron (High Contrast)', wc: 150, ww: 250 },
  { name: 'Full Dynamic Range', wc: 128, ww: 256 },
];

/**
 * Generates synthetic teaching datasets with volumetric multi-slice series
 * allowing real-time slice navigation like a clinical PACS DICOM viewer.
 */
export function generateSyntheticDataset(
  type: 'tiger' | 'ct' | 'mri' | 'pet' | 'joint',
  size = 256
): ActiveDataset {
  const center = size / 2;

  if (type === 'tiger') {
    // 3 progressive slices with varying periodic cage spacing (16px, 12px, 20px)
    const slices: DicomSlice[] = [];
    const barPeriods = [16, 12, 20];
    const harmonics = [
      { u: 16, v: 0 },
      { u: -16, v: 0 },
      { u: 32, v: 0 },
      { u: -32, v: 0 },
      { u: 48, v: 0 },
      { u: -48, v: 0 },
    ];

    barPeriods.forEach((barPeriod, sIdx) => {
      const pixelData = new Float32Array(size * size);
      const barWidth = 3.5;

      for (let y = 0; y < size; y++) {
        const ny = (y - center) / (size * 0.45);
        for (let x = 0; x < size; x++) {
          const nx = (x - center) / (size * 0.45);
          const dist = Math.hypot(nx, ny);

          let intensity = 30;
          if (dist < 1.0) {
            const furBase = 150 - dist * 40;
            const stripe1 = Math.sin(nx * 14 + Math.cos(ny * 6) * 1.5);
            const stripe2 = Math.sin(ny * 12 + Math.sin(nx * 5) * 1.2);
            const stripeWeight = Math.min(stripe1, stripe2);

            let stripeIntensity = furBase;
            if (stripeWeight > 0.4 && dist < 0.9) {
              stripeIntensity = 25;
            }

            const eyeL = Math.hypot(nx + 0.3, ny + 0.1);
            const eyeR = Math.hypot(nx - 0.3, ny + 0.1);
            if (eyeL < 0.08 || eyeR < 0.08) {
              stripeIntensity = 230;
            } else if (eyeL < 0.12 || eyeR < 0.12) {
              stripeIntensity = 40;
            }

            if (Math.hypot(nx, ny - 0.35) < 0.3) {
              stripeIntensity = Math.min(235, stripeIntensity + 60);
            }
            if (Math.hypot(nx, ny - 0.18) < 0.1) {
              stripeIntensity = 45;
            }

            intensity = stripeIntensity;
          }

          const barPos = Math.abs((x % barPeriod) - barPeriod / 2);
          const isVerticalBar = barPos < barWidth / 2;
          if (isVerticalBar) {
            const shine = 1 - barPos / (barWidth / 2);
            intensity = 240 - shine * 30;
          }

          pixelData[y * size + x] = Math.max(0, Math.min(255, intensity));
        }
      }

      slices.push({
        index: sIdx,
        sliceLocation: sIdx * 5,
        instanceNumber: sIdx + 1,
        pixelData,
        description: `Cage Variation ${sIdx + 1} (Period = ${barPeriod}px)`,
        minVal: 0,
        maxVal: 255,
      });
    });

    const metadata: DicomMetadata = {
      patientId: 'BME-TIGER-001',
      patientName: 'Panthera Tigris (Behind Cage)',
      studyDate: '2026-09-11',
      modality: 'OTHER',
      rows: size,
      columns: size,
      windowCenter: 128,
      windowWidth: 256,
      rescaleIntercept: 0,
      rescaleSlope: 1,
      seriesDescription: 'Classic Fourier Cage Removal Challenge (3 Slices)',
    };

    return {
      pixelData: slices[0].pixelData,
      metadata,
      slices,
      currentSliceIndex: 0,
      harmonics,
    };
  }

  if (type === 'ct') {
    // 24-slice Axial Chest CT volume (Apex down to Diaphragm & Liver)
    const numSlices = 24;
    const slices: DicomSlice[] = [];

    for (let s = 0; s < numSlices; s++) {
      const zRatio = s / (numSlices - 1); // 0.0 (apex) to 1.0 (base/liver)
      const pixelData = new Float32Array(size * size);

      for (let y = 0; y < size; y++) {
        const ny = (y - center) / (size * 0.44);
        for (let x = 0; x < size; x++) {
          const nx = (x - center) / (size * 0.44);
          let hu = -1000; // room air

          // Body ellipse changes with z
          const bodyW = 0.95 + zRatio * 0.1;
          const bodyH = 0.7 + zRatio * 0.12;
          const bodyEllipse = (nx * nx) / (bodyW * bodyW) + (ny * ny) / (bodyH * bodyH);

          if (bodyEllipse <= 1.0) {
            hu = 35; // Subcutaneous fat and muscle

            // Vertebral body / Spine
            const spineDist = Math.hypot(nx, ny - 0.62);
            if (spineDist < 0.14) {
              hu = 850 + Math.sin(nx * 15) * 50; // Dense cancellous & cortical bone
            }

            // Ribs around perimeter
            if (bodyEllipse > 0.82 && bodyEllipse < 0.93) {
              const angle = Math.atan2(ny, nx);
              const ribMod = Math.sin(angle * (10 + s % 3));
              if (ribMod > 0.35) {
                hu = 820;
              }
            }

            // Sternum
            if (Math.hypot(nx, ny + 0.7) < 0.08) {
              hu = 780;
            }

            // Lungs: apex (small) to mid-chest (large) to base (displaced by diaphragm)
            const lungScale = Math.sin(zRatio * Math.PI * 0.85);
            const lungSize = 0.38 * Math.max(0.2, lungScale);

            const leftLung = Math.hypot(nx - 0.4, ny + 0.05 - (1 - zRatio) * 0.1);
            const rightLung = Math.hypot(nx + 0.4, ny + 0.05 - (1 - zRatio) * 0.1);

            if (leftLung < lungSize || rightLung < lungSize) {
              hu = -820; // Lung parenchyma

              // Bronchial / vascular tree
              const vascular = Math.sin(nx * 34 + zRatio * 5) * Math.cos(ny * 32);
              if (vascular > 0.62) {
                hu = -180;
              }
            }

            // Heart / Mediastinum (visible from mid-chest down: zRatio 0.35 to 0.85)
            if (zRatio > 0.3 && zRatio < 0.88) {
              const heartW = 0.28 * Math.sin((zRatio - 0.25) * 2.5);
              const heartDist = Math.hypot((nx - 0.08) / (heartW || 0.1), (ny - 0.05) / (heartW || 0.1));
              if (heartDist < 1.0) {
                hu = 45; // Myocardium & cardiac blood pool
              }
            }

            // Liver Dome & Spleen (lower slices: zRatio > 0.7)
            if (zRatio > 0.7) {
              const liverDist = Math.hypot(nx + 0.35, ny + 0.15);
              if (liverDist < 0.42 * (zRatio - 0.65) * 3) {
                hu = 60; // Liver parenchyma
              }
              const spleenDist = Math.hypot(nx - 0.45, ny + 0.2);
              if (spleenDist < 0.22 * (zRatio - 0.65) * 2) {
                hu = 45; // Spleen
              }
            }
          }

          pixelData[y * size + x] = hu;
        }
      }

      const zLocation = Number((-120 + s * 10.5).toFixed(1));
      slices.push({
        index: s,
        sliceLocation: zLocation,
        instanceNumber: s + 1,
        pixelData,
        description: `Axial Chest CT • Slice ${s + 1} / ${numSlices} (Z: ${zLocation} mm)`,
        minVal: -1000,
        maxVal: 900,
      });
    }

    const defaultIdx = 11; // Mid-chest slice
    const metadata: DicomMetadata = {
      patientId: 'CHEST-CT-VOL-24',
      patientName: 'Thorax Volumetric CT Series',
      studyDate: '2026-09-11',
      modality: 'CT',
      rows: size,
      columns: size,
      windowCenter: -600,
      windowWidth: 1500,
      rescaleIntercept: 0,
      rescaleSlope: 1,
      pixelSpacing: [0.75, 0.75],
      sliceThickness: 2.5,
      seriesDescription: 'Axial High-Res Chest CT Series (24 Slices)',
    };

    return {
      pixelData: slices[defaultIdx].pixelData,
      metadata,
      slices,
      currentSliceIndex: defaultIdx,
    };
  }

  if (type === 'mri') {
    // 24-slice Axial Brain T2-Weighted Series (Vertex down to Brainstem & Cerebellum)
    const numSlices = 24;
    const slices: DicomSlice[] = [];

    for (let s = 0; s < numSlices; s++) {
      const zRatio = s / (numSlices - 1); // 0.0 (top of head/vertex) to 1.0 (base/cerebellum)
      const pixelData = new Float32Array(size * size);

      for (let y = 0; y < size; y++) {
        const ny = (y - center) / (size * 0.43);
        for (let x = 0; x < size; x++) {
          const nx = (x - center) / (size * 0.43);

          // Head size changes from smaller at vertex to full width at mid-brain
          const skullScale = 0.75 + Math.sin(zRatio * Math.PI * 0.8) * 0.3;
          const r = Math.hypot(nx / skullScale, (ny * 1.12) / skullScale);

          let intensity = 10;

          if (r < 1.0) {
            if (r > 0.92) {
              intensity = 20; // Skull bone (signal void in MRI)
            } else if (r > 0.88) {
              intensity = 180; // Scalp subcutaneous fat (bright)
            } else {
              // Cortical gyri & sulci folding
              const sulci = Math.sin(nx * 22 + Math.sin(ny * 14)) * Math.cos(ny * 20);
              intensity = sulci > 0 ? 135 : 95; // Gray vs White matter

              // Subarachnoid space (CSF bright on T2)
              if (r > 0.83) {
                intensity = 210;
              }

              // Lateral Ventricles (visible from zRatio 0.32 to 0.72)
              if (zRatio > 0.32 && zRatio < 0.72) {
                const ventScale = Math.sin((zRatio - 0.32) * Math.PI * 2.5);
                const hornL = Math.hypot((nx + 0.15) * 1.6, (ny + 0.02) * 0.9) / Math.max(0.1, ventScale * 0.3);
                const hornR = Math.hypot((nx - 0.15) * 1.6, (ny + 0.02) * 0.9) / Math.max(0.1, ventScale * 0.3);
                if (hornL < 1.0 || hornR < 1.0) {
                  intensity = 245; // CSF hyperintense
                }
              }

              // Third Ventricle & Midline (zRatio 0.45 to 0.8)
              if (zRatio > 0.45 && zRatio < 0.8) {
                if (Math.abs(nx) < 0.025 && Math.abs(ny) < 0.22) {
                  intensity = 240;
                }
              }

              // Brainstem & Cerebellum (zRatio > 0.68)
              if (zRatio > 0.68) {
                const stem = Math.hypot(nx, ny - 0.15);
                if (stem < 0.22) {
                  intensity = 110; // Brainstem pons
                }
                const cerebL = Math.hypot(nx + 0.3, ny - 0.35);
                const cerebR = Math.hypot(nx - 0.3, ny - 0.35);
                if (cerebL < 0.28 || cerebR < 0.28) {
                  const folia = Math.sin(ny * 40);
                  intensity = folia > 0 ? 140 : 95; // Cerebellar folia
                }
              }

              // Interhemispheric fissure
              if (Math.abs(nx) < 0.018 && r < 0.85) {
                intensity = 215;
              }
            }
          }

          pixelData[y * size + x] = intensity;
        }
      }

      const zLocation = Number((45 - s * 3.7).toFixed(1));
      slices.push({
        index: s,
        sliceLocation: zLocation,
        instanceNumber: s + 1,
        pixelData,
        description: `Axial T2 Brain • Slice ${s + 1} / ${numSlices} (Z: ${zLocation} mm)`,
        minVal: 10,
        maxVal: 250,
      });
    }

    const defaultIdx = 11; // Ventricle level
    const metadata: DicomMetadata = {
      patientId: 'BRAIN-MRI-VOL-24',
      patientName: 'Neuro Volumetric Ax-T2W MRI',
      studyDate: '2026-09-11',
      modality: 'MR',
      rows: size,
      columns: size,
      windowCenter: 120,
      windowWidth: 220,
      rescaleIntercept: 0,
      rescaleSlope: 1,
      pixelSpacing: [0.9, 0.9],
      sliceThickness: 3.5,
      seriesDescription: 'Brain Axial T2-Weighted Series (24 Slices)',
    };

    return {
      pixelData: slices[defaultIdx].pixelData,
      metadata,
      slices,
      currentSliceIndex: defaultIdx,
    };
  }

  if (type === 'pet') {
    // 20-slice PET FDG Whole Body Oncology stack
    const numSlices = 20;
    const slices: DicomSlice[] = [];

    for (let s = 0; s < numSlices; s++) {
      const zRatio = s / (numSlices - 1);
      const pixelData = new Float32Array(size * size);

      for (let y = 0; y < size; y++) {
        const ny = (y - center) / (size * 0.45);
        for (let x = 0; x < size; x++) {
          const nx = (x - center) / (size * 0.45);
          let uptake = 15;

          if (Math.abs(nx) < 0.7 && ny > -0.95 && ny < 0.9) {
            uptake = 35 + ((x * 13 + y * 7 + s * 11) % 7); // Poisson emission texture

            // Brain high glucose metabolism (slices 0 to 3)
            if (s < 4 && Math.hypot(nx, ny + 0.75) < 0.22) {
              uptake = 220;
            }

            // Lung Tumor Hotspot (slices 5 to 10: slice 7 is center)
            if (s >= 5 && s <= 10) {
              const tumorRadius = 0.08 * (1 - Math.abs(s - 7.5) * 0.3);
              if (Math.hypot(nx + 0.24, ny + 0.15) < Math.max(0.02, tumorRadius)) {
                uptake = 250; // Hypermetabolic malignancy
              }
            }

            // Myocardium (slices 6 to 11)
            if (s >= 6 && s <= 11 && Math.hypot(nx - 0.08, ny + 0.1) < 0.14) {
              uptake = 185;
            }

            // Kidneys (slices 10 to 15)
            if (s >= 10 && s <= 15) {
              const kidneyL = Math.hypot(nx + 0.25, ny - 0.08);
              const kidneyR = Math.hypot(nx - 0.25, ny - 0.08);
              if (kidneyL < 0.12 || kidneyR < 0.12) {
                uptake = 230;
              }
            }

            // Bladder (slices 15 to 19)
            if (s >= 15 && Math.hypot(nx, ny - 0.55) < 0.16) {
              uptake = 255;
            }
          }

          pixelData[y * size + x] = uptake;
        }
      }

      slices.push({
        index: s,
        sliceLocation: Number((-80 + s * 8.4).toFixed(1)),
        instanceNumber: s + 1,
        pixelData,
        description: `PET 18F-FDG • Slice ${s + 1} / ${numSlices}`,
        minVal: 15,
        maxVal: 255,
      });
    }

    const defaultIdx = 7; // Tumor nodule slice
    const metadata: DicomMetadata = {
      patientId: 'PET-FDG-VOL-20',
      patientName: '18F-FDG Whole Body Oncology',
      studyDate: '2026-09-11',
      modality: 'PT',
      rows: size,
      columns: size,
      windowCenter: 120,
      windowWidth: 200,
      rescaleIntercept: 0,
      rescaleSlope: 1,
      pixelSpacing: [2.5, 2.5],
      sliceThickness: 3.27,
      seriesDescription: 'PET Whole Body Emission (20 Slices)',
    };

    return {
      pixelData: slices[defaultIdx].pixelData,
      metadata,
      slices,
      currentSliceIndex: defaultIdx,
    };
  }

  // Default: Joint (20 slices Knee MRI Sagittal/Coronal)
  const numSlices = 20;
  const slices: DicomSlice[] = [];

  for (let s = 0; s < numSlices; s++) {
    const zRatio = s / (numSlices - 1);
    const pixelData = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const ny = (y - center) / (size * 0.45);
      for (let x = 0; x < size; x++) {
        const nx = (x - center) / (size * 0.45);
        let intensity = 20;

        // Knee joint silhouette
        if (Math.abs(nx) < 0.75 && Math.abs(ny) < 0.9) {
          intensity = 50;

          // Femoral condyle (upper bone)
          const femur = Math.hypot(nx, ny + 0.38);
          if (femur < 0.4) {
            intensity = 160; // Bone marrow
            if (femur > 0.36) intensity = 25; // Cortical bone ring
          }

          // Tibial plateau (lower bone)
          const tibia = Math.hypot(nx, ny - 0.42);
          if (tibia < 0.38) {
            intensity = 155;
            if (tibia > 0.34) intensity = 25;
          }

          // Meniscus (wedge-shaped triangular dark fibrocartilage: zRatio 0.3 to 0.7)
          if (zRatio > 0.25 && zRatio < 0.75) {
            const meniscusL = Math.hypot(nx + 0.32, ny + 0.02);
            const meniscusR = Math.hypot(nx - 0.32, ny + 0.02);
            if (meniscusL < 0.09 || meniscusR < 0.09) {
              intensity = 15; // Low signal meniscus
            }
          }

          // Joint fluid effusion (hyperintense on T2)
          if (Math.abs(ny) < 0.06 && Math.abs(nx) < 0.3) {
            intensity = 235;
          }

          // Patella (anterior bone: visible in mid slices)
          if (zRatio > 0.3 && zRatio < 0.7 && Math.hypot(nx + 0.48, ny + 0.15) < 0.15) {
            intensity = 175;
          }
        }

        pixelData[y * size + x] = intensity;
      }
    }

    slices.push({
      index: s,
      sliceLocation: Number((-25 + s * 2.6).toFixed(1)),
      instanceNumber: s + 1,
      pixelData,
      description: `Knee Joint MRI • Slice ${s + 1} / ${numSlices}`,
      minVal: 15,
      maxVal: 240,
    });
  }

  const defaultIdx = 9;
  const metadata: DicomMetadata = {
    patientId: 'KNEE-MR-VOL-20',
    patientName: 'Knee Joint Volumetric MRI',
    studyDate: '2026-09-11',
    modality: 'MR',
    rows: size,
    columns: size,
    windowCenter: 100,
    windowWidth: 200,
    rescaleIntercept: 0,
    rescaleSlope: 1,
    pixelSpacing: [0.6, 0.6],
    sliceThickness: 3.0,
    seriesDescription: 'Knee Joint Volumetric MRI (20 Slices)',
  };

  return {
    pixelData: slices[defaultIdx].pixelData,
    metadata,
    slices,
    currentSliceIndex: defaultIdx,
  };
}
