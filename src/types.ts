export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'custom';
export type FilterShape = 'ideal' | 'butterworth' | 'gaussian';
export type SpectrumViewMode = 'magnitude' | 'phase' | 'mask';

export interface NotchPoint {
  id: string;
  u: number; // frequency coordinate relative to center (-N/2 to N/2)
  v: number;
  radius: number;
}

export interface FilterSettings {
  type: FilterType;
  shape: FilterShape;
  cutoff: number; // radius D0 (1 to N/2)
  cutoffInner?: number; // for bandpass
  cutoffOuter?: number; // for bandpass
  butterworthOrder: number; // order n (1 to 10)
  notches: NotchPoint[];
  invert: boolean;
}

export type ToolMode = 'brush' | 'notch_pair' | 'box' | 'eraser';

export interface DicomMetadata {
  patientId?: string;
  patientName?: string;
  studyDate?: string;
  modality: 'CT' | 'MR' | 'PT' | 'US' | 'XR' | 'OTHER';
  rows: number;
  columns: number;
  windowCenter: number;
  windowWidth: number;
  rescaleIntercept: number;
  rescaleSlope: number;
  pixelSpacing?: [number, number];
  sliceThickness?: number;
  seriesDescription?: string;
}

export interface SegmentationSettings {
  mode: 'threshold' | 'otsu' | 'region_grow' | 'multiclass';
  lowerThreshold: number;
  upperThreshold: number;
  tolerance: number; // for region growing
  seedPoint: { x: number; y: number } | null;
  overlayColor: string;
  overlayOpacity: number;
  showOverlay: boolean;
  activeClass: 'all' | 'bone' | 'soft' | 'air';
}

export interface ImagePreset {
  id: string;
  name: string;
  category: 'tiger' | 'mri' | 'ct' | 'pet' | 'test';
  description: string;
  modality: string;
  defaultFilter?: Partial<FilterSettings>;
}

export type AnatomicalPlane = 'axial' | 'coronal' | 'sagittal';

export interface DicomSlice {
  index: number;
  sliceLocation?: number;
  instanceNumber?: number;
  pixelData: Float32Array;
  description?: string;
  minVal?: number;
  maxVal?: number;
}

export interface ActiveDataset {
  pixelData: Float32Array;
  metadata: DicomMetadata;
  harmonics?: { u: number; v: number }[];
  slices?: DicomSlice[];
  currentSliceIndex?: number;
  activePlane?: AnatomicalPlane;
}
