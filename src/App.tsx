import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { FourierLab } from './components/FourierLab';
import { FreeTheTiger } from './components/FreeTheTiger';
import { DicomSegmentation } from './components/DicomSegmentation';
import { AITutorModal } from './components/AITutorModal';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { DicomSeriesViewerModal } from './components/DicomSeriesViewerModal';
import { FilterSettings, DicomMetadata, ActiveDataset, AnatomicalPlane, DicomSlice } from './types';
import { generateSyntheticDataset, parseDicomFile, parseMultipleDicomFiles } from './utils/dicom';
import { ANATOMICAL_PLANES, generatePlaneSlices } from './utils/mpr';
import { BookOpen, HelpCircle, Activity, Sparkles, AlertCircle, Camera, CheckCircle2, Layers } from 'lucide-react';

const DEFAULT_SIZE = 256;

export default function App() {
  const [currentTab, setCurrentTab] = useState<'fourier' | 'tiger' | 'segmentation'>('fourier');

  // Active dataset state
  const [currentDatasetType, setCurrentDatasetType] = useState<
    'tiger' | 'mri' | 'ct' | 'pet' | 'joint' | 'custom'
  >('mri');
  const [activeDataset, setActiveDataset] = useState<ActiveDataset>(() =>
    generateSyntheticDataset('mri', DEFAULT_SIZE)
  );

  // Active anatomical viewing plane ('axial' | 'coronal' | 'sagittal')
  const [activePlane, setActivePlane] = useState<AnatomicalPlane>('axial');

  // Base 3D volume stack (typically axial) to reconstruct any plane on demand
  const [baseVolumeSlices, setBaseVolumeSlices] = useState<DicomSlice[]>(() => {
    const initial = generateSyntheticDataset('mri', DEFAULT_SIZE);
    return initial.slices || [];
  });

  // Grayscale bytes currently loaded into FourierLab
  const [fourierImageBytes, setFourierImageBytes] = useState<Uint8ClampedArray>(() => {
    const raw = generateSyntheticDataset('mri', DEFAULT_SIZE).pixelData;
    const bytes = new Uint8ClampedArray(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = Math.max(0, Math.min(255, Math.round(raw[i])));
    }
    return bytes;
  });

  // Filter settings for FourierLab
  const [filterSettings, setFilterSettings] = useState<FilterSettings>({
    type: 'lowpass',
    shape: 'butterworth',
    cutoff: 40,
    cutoffInner: 15,
    cutoffOuter: 60,
    butterworthOrder: 2,
    notches: [],
    invert: false,
  });

  // Custom 2D frequency deletion mask (1.0 = pass, 0.0 = delete)
  const [customMask, setCustomMask] = useState<Float32Array>(
    () => new Float32Array(DEFAULT_SIZE * DEFAULT_SIZE).fill(1.0)
  );

  // Modals & notices
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isAITutorOpen, setIsAITutorOpen] = useState(false);
  const [isDicomViewerOpen, setIsDicomViewerOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Preset loading handler
  const handlePresetSelect = (preset: 'tiger' | 'mri' | 'ct' | 'pet' | 'joint') => {
    setUploadError(null);
    if (preset === 'tiger') {
      setCurrentTab('tiger');
      return;
    }

    setCurrentDatasetType(preset);
    const dataset = generateSyntheticDataset(preset, DEFAULT_SIZE);
    setBaseVolumeSlices(dataset.slices || []);
    setActivePlane('axial');
    setActiveDataset(dataset);

    // Normalize or window to 0-255 for FourierLab
    const bytes = new Uint8ClampedArray(dataset.pixelData.length);
    if (dataset.metadata.modality === 'CT') {
      const half = 200;
      for (let i = 0; i < dataset.pixelData.length; i++) {
        const hu = dataset.pixelData[i];
        bytes[i] = Math.max(0, Math.min(255, Math.round(((hu - (40 - half)) / 400) * 255)));
      }
    } else {
      for (let i = 0; i < dataset.pixelData.length; i++) {
        bytes[i] = Math.max(0, Math.min(255, Math.round(dataset.pixelData[i])));
      }
    }

    setFourierImageBytes(bytes);
    setCustomMask(new Float32Array(DEFAULT_SIZE * DEFAULT_SIZE).fill(1.0));
  };

  // Change anatomical reconstruction plane (Axial, Coronal, Sagittal)
  const handleChangePlane = useCallback(
    (newPlane: AnatomicalPlane) => {
      if (!baseVolumeSlices || baseVolumeSlices.length === 0) return;

      const reconstructed = generatePlaneSlices(
        baseVolumeSlices,
        DEFAULT_SIZE,
        DEFAULT_SIZE,
        newPlane,
        activeDataset.metadata
      );

      const newIdx = Math.floor(reconstructed.length / 2);
      const targetSlice = reconstructed[newIdx] || reconstructed[0];

      // Update Fourier display bytes for this plane slice
      const bytes = new Uint8ClampedArray(DEFAULT_SIZE * DEFAULT_SIZE);
      const half = (activeDataset.metadata.windowWidth || 400) / 2;
      const lower = (activeDataset.metadata.windowCenter || 40) - half;
      const range = activeDataset.metadata.windowWidth || 400;

      for (let i = 0; i < targetSlice.pixelData.length; i++) {
        const val = targetSlice.pixelData[i];
        bytes[i] = Math.max(0, Math.min(255, Math.round(((val - lower) / range) * 255)));
      }

      setActivePlane(newPlane);
      setFourierImageBytes(bytes);
      setActiveDataset((prev) => ({
        ...prev,
        slices: reconstructed,
        currentSliceIndex: newIdx,
        pixelData: targetSlice.pixelData,
        activePlane: newPlane,
      }));

      setSuccessNotice(
        `Switched view to ${ANATOMICAL_PLANES[newPlane].name} plane (${reconstructed.length} slices).`
      );
      setTimeout(() => setSuccessNotice(null), 4000);
    },
    [baseVolumeSlices, activeDataset.metadata]
  );

  // Slice navigation handler (synchronizes DICOM Segmentation & Fourier Lab)
  const handleSelectSlice = useCallback(
    (sliceIndex: number, plane?: AnatomicalPlane) => {
      if (plane && plane !== activePlane && baseVolumeSlices && baseVolumeSlices.length > 0) {
        const reconstructed = generatePlaneSlices(
          baseVolumeSlices,
          DEFAULT_SIZE,
          DEFAULT_SIZE,
          plane,
          activeDataset.metadata
        );
        const validIdx = Math.max(0, Math.min(reconstructed.length - 1, sliceIndex));
        const targetSlice = reconstructed[validIdx] || reconstructed[0];

        const bytes = new Uint8ClampedArray(DEFAULT_SIZE * DEFAULT_SIZE);
        const half = (activeDataset.metadata.windowWidth || 400) / 2;
        const lower = (activeDataset.metadata.windowCenter || 40) - half;
        const range = activeDataset.metadata.windowWidth || 400;

        for (let i = 0; i < targetSlice.pixelData.length; i++) {
          const val = targetSlice.pixelData[i];
          bytes[i] = Math.max(0, Math.min(255, Math.round(((val - lower) / range) * 255)));
        }

        setActivePlane(plane);
        setFourierImageBytes(bytes);
        setActiveDataset((prev) => ({
          ...prev,
          slices: reconstructed,
          currentSliceIndex: validIdx,
          pixelData: targetSlice.pixelData,
          activePlane: plane,
        }));
        return;
      }

      setActiveDataset((prev) => {
        if (!prev.slices || !prev.slices[sliceIndex]) return prev;
        const targetSlice = prev.slices[sliceIndex];

        // Update Fourier display bytes for this slice
        const bytes = new Uint8ClampedArray(DEFAULT_SIZE * DEFAULT_SIZE);
        const half = (prev.metadata.windowWidth || 400) / 2;
        const lower = (prev.metadata.windowCenter || 40) - half;
        const range = prev.metadata.windowWidth || 400;

        for (let i = 0; i < targetSlice.pixelData.length; i++) {
          const val = targetSlice.pixelData[i];
          bytes[i] = Math.max(0, Math.min(255, Math.round(((val - lower) / range) * 255)));
        }

        setFourierImageBytes(bytes);

        return {
          ...prev,
          pixelData: targetSlice.pixelData,
          currentSliceIndex: sliceIndex,
        };
      });
    },
    [activePlane, baseVolumeSlices, activeDataset.metadata]
  );

  // Upload handler for PNG, JPG, or DICOM .dcm files (supporting single or multiple files)
  const handleFileUpload = async (fileOrFiles: File | File[]) => {
    setUploadError(null);
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    if (files.length === 0) return;

    const firstFile = files[0];
    const isDicom = files.some((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith('.dcm') || n.endsWith('.dicom');
    });

    try {
      if (isDicom || files.length > 1) {
        // DICOM file(s) parsing (multi-frame or multi-file series)
        const parsed =
          files.length > 1
            ? await parseMultipleDicomFiles(files)
            : await (async () => {
                const arrayBuffer = await firstFile.arrayBuffer();
                return parseDicomFile(arrayBuffer, firstFile.name);
              })();

        // Resample slices to DEFAULT_SIZE if needed
        const resampledSlices = parsed.slices.map((sl) => ({
          ...sl,
          pixelData: resampleFloatArray(
            sl.pixelData,
            parsed.width,
            parsed.height,
            DEFAULT_SIZE,
            DEFAULT_SIZE
          ),
        }));

        const initialIdx = parsed.currentSliceIndex ?? 0;
        const initialSlice = resampledSlices[initialIdx] || resampledSlices[0];

        setBaseVolumeSlices(resampledSlices);
        setActivePlane('axial');
        setActiveDataset({
          pixelData: initialSlice.pixelData,
          metadata: parsed.metadata,
          slices: resampledSlices,
          currentSliceIndex: initialIdx,
          activePlane: 'axial',
        });
        setCurrentDatasetType('custom');

        // Convert active slice to display bytes for Fourier
        const bytes = new Uint8ClampedArray(DEFAULT_SIZE * DEFAULT_SIZE);
        const half = (parsed.metadata.windowWidth || 400) / 2;
        const lower = (parsed.metadata.windowCenter || 40) - half;
        const range = parsed.metadata.windowWidth || 400;

        for (let i = 0; i < initialSlice.pixelData.length; i++) {
          const val = initialSlice.pixelData[i];
          bytes[i] = Math.max(0, Math.min(255, Math.round(((val - lower) / range) * 255)));
        }

        setFourierImageBytes(bytes);
        setCustomMask(new Float32Array(DEFAULT_SIZE * DEFAULT_SIZE).fill(1.0));
        setCurrentTab('segmentation'); // Guide user to segmentation view on DICOM upload

        if (resampledSlices.length > 1) {
          setIsDicomViewerOpen(true);
          setSuccessNotice(
            `Loaded DICOM series with ${resampledSlices.length} slices. Opened DICOM viewer to scroll and select the slice you want to analyze.`
          );
        } else {
          setSuccessNotice(`Loaded DICOM image (${parsed.metadata.patientName || firstFile.name}).`);
        }
        setTimeout(() => setSuccessNotice(null), 8000);
      } else {
        // Standard Image File (PNG, JPG, WEBP)
        const file = firstFile;
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const canvas = document.createElement('canvas');
          canvas.width = DEFAULT_SIZE;
          canvas.height = DEFAULT_SIZE;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          ctx.drawImage(img, 0, 0, DEFAULT_SIZE, DEFAULT_SIZE);
          const imgData = ctx.getImageData(0, 0, DEFAULT_SIZE, DEFAULT_SIZE);
          const bytes = new Uint8ClampedArray(DEFAULT_SIZE * DEFAULT_SIZE);
          const rawData = new Float32Array(DEFAULT_SIZE * DEFAULT_SIZE);

          // Convert RGB to standard luminance grayscale: 0.299R + 0.587G + 0.114B
          for (let i = 0; i < bytes.length; i++) {
            const idx = i * 4;
            const gray = Math.round(
              0.299 * imgData.data[idx] +
                0.587 * imgData.data[idx + 1] +
                0.114 * imgData.data[idx + 2]
            );
            bytes[i] = gray;
            rawData[i] = gray;
          }

          const isCamera = file.name.startsWith('camera-capture');
          const metadata: DicomMetadata = {
            patientId: isCamera ? 'DEVICE-CAMERA' : 'USER-UPLOAD',
            patientName: isCamera ? 'Device Camera Capture' : file.name,
            studyDate: new Date().toISOString().split('T')[0],
            modality: 'OTHER',
            rows: DEFAULT_SIZE,
            columns: DEFAULT_SIZE,
            windowCenter: 128,
            windowWidth: 256,
            rescaleIntercept: 0,
            rescaleSlope: 1,
            seriesDescription: isCamera ? 'Live Device Camera Snapshot' : `Uploaded: ${file.name}`,
          };

          setActiveDataset({ pixelData: rawData, metadata });
          setCurrentDatasetType('custom');
          setFourierImageBytes(bytes);
          setCustomMask(new Float32Array(DEFAULT_SIZE * DEFAULT_SIZE).fill(1.0));
          setCurrentTab('fourier');

          if (isCamera) {
            setSuccessNotice('Photo captured successfully! 2D Fourier spectrum computed for your custom sample.');
            setTimeout(() => setSuccessNotice(null), 6000);
          }
        };

        img.onerror = () => {
          setUploadError('Failed to decode the image file. Please upload a valid PNG, JPG, or DICOM file.');
        };

        img.src = objectUrl;
      }
    } catch (err: any) {
      console.error('File parsing error:', err);
      setUploadError(err.message || 'Error parsing file. Ensure it is a valid DICOM or image file.');
    }
  };

  // Reset entire lab
  const handleReset = () => {
    handlePresetSelect('mri');
    setFilterSettings({
      type: 'lowpass',
      shape: 'butterworth',
      cutoff: 40,
      cutoffInner: 15,
      cutoffOuter: 60,
      butterworthOrder: 2,
      notches: [],
      invert: false,
    });
    setCustomMask(new Float32Array(DEFAULT_SIZE * DEFAULT_SIZE).fill(1.0));
    setUploadError(null);
  };

  // Callback when sending windowed DICOM to Fourier
  const handleSendToFourier = useCallback((imageBytes: Uint8ClampedArray) => {
    setFourierImageBytes(new Uint8ClampedArray(imageBytes));
    setCustomMask(new Float32Array(DEFAULT_SIZE * DEFAULT_SIZE).fill(1.0));
    setCurrentTab('fourier');
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white">
      {/* Header with Navigation & Presets */}
      <Header
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        onPresetSelect={handlePresetSelect}
        onFileUpload={handleFileUpload}
        onOpenCamera={() => setIsCameraOpen(true)}
        onOpenAITutor={() => setIsAITutorOpen(true)}
        onReset={handleReset}
      />

      {/* Main Work Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Upload Error Alert */}
        {uploadError && (
          <div className="flex items-center gap-2 p-3 text-xs text-rose-300 bg-rose-950/40 border border-rose-800/80 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Success Notice Banner */}
        {successNotice && (
          <div className="flex items-center justify-between gap-2 p-3 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800/80 rounded-xl">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successNotice}</span>
            </div>
            <button
              onClick={() => setSuccessNotice(null)}
              className="text-emerald-400 hover:text-emerald-200 text-xs px-2 py-0.5 rounded cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tab 1: Fourier & k-Space Filtering Lab */}
        {currentTab === 'fourier' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-sky-400" />
                  <span>2D Fourier Transform & Frequency Domain Filtering</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Observe how spatial frequencies shape bioimaging contrast, boundaries, and artifacts in real time.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {activeDataset.slices && activeDataset.slices.length > 1 && (
                  <button
                    onClick={() => setIsDicomViewerOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-sky-300 border border-slate-700 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                    title="Open clinical DICOM viewer to scroll slices and select one to analyze"
                  >
                    <Layers className="w-3.5 h-3.5 text-sky-400" />
                    <span>Browse Slices ({activeDataset.slices.length})</span>
                  </button>
                )}

                <button
                  id="fourier-take-photo-btn"
                  onClick={() => setIsCameraOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  title="Take a picture directly with device camera to analyze in 2D Fourier space"
                >
                  <Camera className="w-3.5 h-3.5 text-sky-400" />
                  <span>Take Photo</span>
                </button>
              </div>
            </div>

            <FourierLab
              originalImageBytes={fourierImageBytes}
              imageSize={DEFAULT_SIZE}
              filterSettings={filterSettings}
              onFilterChange={setFilterSettings}
              customMask={customMask}
              onCustomMaskChange={setCustomMask}
              activeNotchHarmonics={activeDataset.harmonics}
              slices={activeDataset.slices}
              currentSliceIndex={activeDataset.currentSliceIndex ?? 0}
              onSelectSlice={handleSelectSlice}
              onOpenDicomViewer={() => setIsDicomViewerOpen(true)}
              activePlane={activePlane}
              onChangePlane={handleChangePlane}
            />
          </div>
        )}

        {/* Tab 2: Free the Tiger Challenge */}
        {currentTab === 'tiger' && <FreeTheTiger imageSize={DEFAULT_SIZE} />}

        {/* Tab 3: Medical DICOM Segmentation Lab */}
        {currentTab === 'segmentation' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <span>Medical DICOM Analysis & Tissue Segmentation</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Inspect Hounsfield Units (HU), adjust Window Center/Width, and scroll through volumetric slices.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {activeDataset.slices && activeDataset.slices.length > 1 && (
                  <button
                    onClick={() => setIsDicomViewerOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-emerald-300 border border-slate-700 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                    title="Open clinical DICOM viewer to scroll slices and select one to analyze"
                  >
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Browse Slices ({activeDataset.slices.length})</span>
                  </button>
                )}

                <button
                  id="segmentation-take-photo-btn"
                  onClick={() => setIsCameraOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  title="Snap a photo of an X-ray, scan printout, or specimen to segment"
                >
                  <Camera className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Take Photo</span>
                </button>
              </div>
            </div>

            <DicomSegmentation
              rawPixelData={activeDataset.pixelData}
              metadata={activeDataset.metadata}
              imageSize={DEFAULT_SIZE}
              onSendToFourier={handleSendToFourier}
              slices={activeDataset.slices}
              currentSliceIndex={activeDataset.currentSliceIndex ?? 0}
              onSelectSlice={handleSelectSlice}
              onOpenDicomViewer={() => setIsDicomViewerOpen(true)}
              activePlane={activePlane}
              onChangePlane={handleChangePlane}
            />
          </div>
        )}

        {/* BME 360 Educational Reference Card & Formulas */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg mt-8">
          <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-800">
            <BookOpen className="w-4 h-4 text-sky-400" />
            <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
              BME 360 Bioimaging Theory & Reference Equations
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-300">
            <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/70 space-y-1.5">
              <span className="font-bold text-sky-400 block">2D Discrete Fourier Transform (2D DFT)</span>
              <p className="font-mono text-[11px] text-slate-400 bg-slate-900 p-1.5 rounded">
                F(u, v) = ∑∑ f(x, y) e^{'{'}-j 2π (ux/M + vy/N){'}'}
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Decomposes a spatial 2D image into orthogonal spatial frequencies. Low frequencies lie near the centered DC peak (u=0, v=0), while high frequencies encode edges.
              </p>
            </div>

            <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/70 space-y-1.5">
              <span className="font-bold text-indigo-400 block">Frequency Filtering & Convolution Theorem</span>
              <p className="font-mono text-[11px] text-slate-400 bg-slate-900 p-1.5 rounded">
                g(x, y) = f(x, y) * h(x, y) ⟺ G(u, v) = F(u, v) · H(u, v)
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Spatial convolution is equivalent to point-wise multiplication in k-space. Notch filtering zeroes out periodic harmonic spikes to eliminate periodic noise (e.g. the tiger cage).
              </p>
            </div>

            <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/70 space-y-1.5">
              <span className="font-bold text-emerald-400 block">CT Hounsfield Units & Segmentation</span>
              <p className="font-mono text-[11px] text-slate-400 bg-slate-900 p-1.5 rounded">
                HU = 1000 × (μ - μ_water) / μ_water
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Calibrated X-ray attenuation: Air is -1000 HU, Water is 0 HU, Soft Tissue is +30 to +60 HU, Bone is +400 to +1500 HU. Thresholding isolates specific tissue classes.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 text-slate-500 text-xs py-4 px-6 text-center">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>BME 360 Introduction to Bioimaging • Biomedical Engineering Educational Suite</span>
          <button
            onClick={() => setIsAITutorOpen(true)}
            className="flex items-center gap-1.5 text-sky-400 hover:text-sky-300 transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Need Help? Ask AI Bioimaging Tutor</span>
          </button>
        </div>
      </footer>

      {/* DICOM Series PACS Viewer Modal */}
      {(baseVolumeSlices.length > 0 || (activeDataset.slices && activeDataset.slices.length > 0)) && (
        <DicomSeriesViewerModal
          isOpen={isDicomViewerOpen}
          onClose={() => setIsDicomViewerOpen(false)}
          metadata={activeDataset.metadata}
          slices={baseVolumeSlices.length > 0 ? baseVolumeSlices : (activeDataset.slices || [])}
          currentSliceIndex={activeDataset.currentSliceIndex ?? 0}
          initialPlane={activePlane}
          onSelectSlice={(idx, plane) => handleSelectSlice(idx, plane)}
          onAnalyzeSlice={(idx, plane) => {
            handleSelectSlice(idx, plane);
            setIsDicomViewerOpen(false);
          }}
        />
      )}

      {/* AI Tutor Modal */}
      <AITutorModal
        isOpen={isAITutorOpen}
        onClose={() => setIsAITutorOpen(false)}
        activeTopic={
          currentTab === 'tiger'
            ? 'Free the Tiger Periodic Notch'
            : currentTab === 'segmentation'
            ? 'DICOM Segmentation & Hounsfield Units'
            : '2D Fourier Transform & Filtering'
        }
        currentFilter={filterSettings}
        dicomMetadata={activeDataset.metadata}
      />

      {/* Camera Capture Modal */}
      <CameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={handleFileUpload}
      />
    </div>
  );
}

/**
 * Resamples a float array (e.g. DICOM pixel matrix) from (srcW x srcH) to (destW x destH)
 * using nearest-neighbor interpolation.
 */
function resampleFloatArray(
  src: Float32Array,
  srcW: number,
  srcH: number,
  destW: number,
  destH: number
): Float32Array {
  if (srcW === destW && srcH === destH) {
    return new Float32Array(src);
  }

  const dest = new Float32Array(destW * destH);
  const scaleX = srcW / destW;
  const scaleY = srcH / destH;

  for (let y = 0; y < destH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y * scaleY));
    const srcRow = srcY * srcW;
    const destRow = y * destW;

    for (let x = 0; x < destW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(x * scaleX));
      dest[destRow + x] = src[srcRow + srcX];
    }
  }

  return dest;
}
