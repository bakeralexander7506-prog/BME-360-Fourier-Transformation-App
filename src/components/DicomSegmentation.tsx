import React, { useState, useEffect, useRef, useMemo } from 'react';
import { DicomMetadata, SegmentationSettings, DicomSlice, AnatomicalPlane } from '../types';
import {
  applyDicomWindowing,
  WINDOW_PRESETS,
} from '../utils/dicom';
import { ANATOMICAL_PLANES } from '../utils/mpr';
import { DicomSliceNavigator } from './DicomSliceNavigator';
import {
  computeOtsuThreshold,
  segmentByThreshold,
  seededRegionGrowing,
  applyMorphology,
  SegmentationResult,
} from '../utils/segmentation';
import {
  Sliders,
  Crosshair,
  Sparkles,
  Layers,
  Activity,
  FileSpreadsheet,
  Download,
  Send,
  Eye,
  CheckCircle2,
} from 'lucide-react';

interface DicomSegmentationProps {
  rawPixelData: Float32Array; // values in HU or raw
  metadata: DicomMetadata;
  imageSize: number;
  onSendToFourier: (imageBytes: Uint8ClampedArray) => void;
  slices?: DicomSlice[];
  currentSliceIndex?: number;
  onSelectSlice?: (index: number) => void;
  onOpenDicomViewer?: () => void;
  activePlane?: AnatomicalPlane;
  onChangePlane?: (plane: AnatomicalPlane) => void;
}

export const DicomSegmentation: React.FC<DicomSegmentationProps> = ({
  rawPixelData,
  metadata,
  imageSize,
  onSendToFourier,
  slices,
  currentSliceIndex = 0,
  onSelectSlice,
  onOpenDicomViewer,
  activePlane = 'axial',
  onChangePlane,
}) => {
  const planeInfo = ANATOMICAL_PLANES[activePlane];
  // Windowing state
  const [wc, setWc] = useState<number>(metadata.windowCenter || 40);
  const [ww, setWw] = useState<number>(metadata.windowWidth || 400);
  const [lutMode, setLutMode] = useState<'gray' | 'hot_iron' | 'rainbow'>('gray');

  // Segmentation state
  const [segMode, setSegMode] = useState<'threshold' | 'otsu' | 'region_grow' | 'multiclass'>('threshold');
  const [lowerThresh, setLowerThresh] = useState<number>(() => (metadata.modality === 'CT' ? 30 : 80));
  const [upperThresh, setUpperThresh] = useState<number>(() => (metadata.modality === 'CT' ? 100 : 220));
  const [tolerance, setTolerance] = useState<number>(25);
  const [seedPoint, setSeedPoint] = useState<{ x: number; y: number } | null>(null);
  const [overlayColor, setOverlayColor] = useState<string>('#10b981'); // Emerald
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.45);
  const [showOverlay, setShowOverlay] = useState<boolean>(true);

  // Morphological operations history
  const [morphMask, setMorphMask] = useState<Uint8Array | null>(null);

  // Canvases
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverPixel, setHoverPixel] = useState<{ x: number; y: number; val: number } | null>(null);

  // Calculate Base Grayscale Image using WC & WW
  const windowedGrayscale = useMemo(() => {
    return applyDicomWindowing(rawPixelData, wc, ww);
  }, [rawPixelData, wc, ww]);

  // Compute Active Segmentation Result
  const segResult: SegmentationResult = useMemo(() => {
    if (morphMask) {
      // Return metrics from morphed mask
      let count = 0;
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < rawPixelData.length; i++) {
        if (morphMask[i] === 1) {
          const v = rawPixelData[i];
          count++;
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      const mean = count > 0 ? sum / count : 0;
      const pixelSpacing = metadata.pixelSpacing;
      const areaMm2 = pixelSpacing ? count * pixelSpacing[0] * pixelSpacing[1] : undefined;

      return {
        mask: morphMask,
        areaPixels: count,
        areaMm2,
        meanIntensity: Number(mean.toFixed(1)),
        stdIntensity: 0,
        minIntensity: count > 0 ? Number(min.toFixed(1)) : 0,
        maxIntensity: count > 0 ? Number(max.toFixed(1)) : 0,
      };
    }

    if (segMode === 'otsu') {
      const otsuCut = computeOtsuThreshold(windowedGrayscale);
      return segmentByThreshold(
        new Float32Array(windowedGrayscale),
        otsuCut,
        255,
        metadata.pixelSpacing
      );
    }

    if (segMode === 'region_grow' && seedPoint) {
      return seededRegionGrowing(
        rawPixelData,
        imageSize,
        imageSize,
        seedPoint.x,
        seedPoint.y,
        tolerance,
        metadata.pixelSpacing
      );
    }

    // Default threshold
    return segmentByThreshold(rawPixelData, lowerThresh, upperThresh, metadata.pixelSpacing);
  }, [
    rawPixelData,
    windowedGrayscale,
    segMode,
    lowerThresh,
    upperThresh,
    seedPoint,
    tolerance,
    morphMask,
    metadata.pixelSpacing,
    imageSize,
  ]);

  // Reset morphological override when segmentation settings change
  const handleThreshChange = (low: number, up: number) => {
    setMorphMask(null);
    setLowerThresh(low);
    setUpperThresh(up);
  };

  // Render to Canvas with LUT & Segmentation Mask Overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(imageSize, imageSize);
    const hexToRgb = (hex: string) => {
      const bigint = parseInt(hex.replace('#', ''), 16);
      return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
    };
    const [or, og, ob] = hexToRgb(overlayColor);

    for (let i = 0; i < windowedGrayscale.length; i++) {
      const g = windowedGrayscale[i];
      const idx = i * 4;

      let r = g;
      let gr = g;
      let b = g;

      if (lutMode === 'hot_iron') {
        // Medical Hot Iron Pseudocolor for PET
        r = Math.min(255, g * 2);
        gr = g > 128 ? (g - 128) * 2 : 0;
        b = g > 200 ? (g - 200) * 4 : 0;
      } else if (lutMode === 'rainbow') {
        const norm = g / 255;
        r = Math.round(255 * Math.sin(norm * Math.PI));
        gr = Math.round(255 * Math.sin(norm * Math.PI * 1.5));
        b = Math.round(255 * Math.cos(norm * Math.PI));
      }

      // Blend segmentation overlay
      if (showOverlay && segResult.mask[i] === 1) {
        r = Math.round(r * (1 - overlayOpacity) + or * overlayOpacity);
        gr = Math.round(gr * (1 - overlayOpacity) + og * overlayOpacity);
        b = Math.round(b * (1 - overlayOpacity) + ob * overlayOpacity);
      }

      imgData.data[idx] = r;
      imgData.data[idx + 1] = gr;
      imgData.data[idx + 2] = b;
      imgData.data[idx + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);

    // Draw Seed Point Marker if in Region Grow
    if (segMode === 'region_grow' && seedPoint) {
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(seedPoint.x, seedPoint.y, 5, 0, Math.PI * 2);
      ctx.moveTo(seedPoint.x - 8, seedPoint.y);
      ctx.lineTo(seedPoint.x + 8, seedPoint.y);
      ctx.moveTo(seedPoint.x, seedPoint.y - 8);
      ctx.lineTo(seedPoint.x, seedPoint.y + 8);
      ctx.stroke();
    }
  }, [
    windowedGrayscale,
    segResult.mask,
    lutMode,
    showOverlay,
    overlayColor,
    overlayOpacity,
    segMode,
    seedPoint,
    imageSize,
  ]);

  // Canvas Mouse Interactions (Seed Point click & hover HU readout)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * imageSize);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * imageSize);

    if (x >= 0 && x < imageSize && y >= 0 && y < imageSize) {
      setMorphMask(null);
      setSeedPoint({ x, y });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * imageSize);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * imageSize);

    if (x >= 0 && x < imageSize && y >= 0 && y < imageSize) {
      const idx = y * imageSize + x;
      setHoverPixel({ x, y, val: Number(rawPixelData[idx].toFixed(1)) });
    }
  };

  const handleApplyMorphology = (op: 'dilate' | 'erode' | 'open' | 'close') => {
    const nextMask = applyMorphology(segResult.mask, imageSize, imageSize, op);
    setMorphMask(nextMask);
  };

  const handleSendToFourier = () => {
    // Send the current windowed medical image to Fourier Lab
    onSendToFourier(windowedGrayscale);
  };

  const handleDownloadMask = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `dicom_segmented_${metadata.modality}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: DICOM Metadata Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-extrabold text-xs">
            {metadata.modality}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-white">
                {metadata.seriesDescription || 'Medical DICOM Series'}
              </h2>
              <span className="text-[10px] font-mono bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                ID: {metadata.patientId}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Matrix: {metadata.rows}×{metadata.columns} • Rescale: y = {metadata.rescaleSlope}x + {metadata.rescaleIntercept} • Modality: {metadata.modality}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end md:self-center">
          <button
            id="send-to-fourier-btn"
            onClick={handleSendToFourier}
            className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded-xl text-xs font-semibold shadow-xs transition"
            title="Load this medical scan directly into Fourier & k-Space Lab"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send to Fourier Lab</span>
          </button>

          <button
            onClick={handleDownloadMask}
            className="p-1.5 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl border border-slate-700 transition"
            title="Download Overlayed Image"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Volumetric Slice Navigator (when multi-slice DICOM is loaded) */}
      {slices && slices.length > 1 && onSelectSlice && (
        <DicomSliceNavigator
          slices={slices}
          currentSliceIndex={currentSliceIndex}
          onSelectSlice={onSelectSlice}
          onOpenDicomViewer={onOpenDicomViewer}
          activePlane={activePlane}
          onChangePlane={onChangePlane}
          showPlaneSelector={true}
          className="shadow-sm"
        />
      )}

      {/* Main Grid: Viewer Canvas (Left) + Controls & Biomarkers (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: Medical Canvas View (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center">
          <div className="w-full flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wider">
                DICOM Medical Slice & Overlay
              </h3>
            </div>

            {/* LUT Pseudocolor toggle */}
            <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px]">
              <button
                onClick={() => setLutMode('gray')}
                className={`px-2 py-0.5 rounded ${lutMode === 'gray' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
              >
                Gray
              </button>
              <button
                onClick={() => setLutMode('hot_iron')}
                className={`px-2 py-0.5 rounded ${lutMode === 'hot_iron' ? 'bg-amber-600 text-white font-semibold' : 'text-slate-400'}`}
                title="Hot Iron for PET"
              >
                Hot
              </button>
              <button
                onClick={() => setLutMode('rainbow')}
                className={`px-2 py-0.5 rounded ${lutMode === 'rainbow' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'}`}
                title="Rainbow Colormap"
              >
                Jet
              </button>
            </div>
          </div>

          <div
            onWheel={(e) => {
              if (slices && slices.length > 1 && onSelectSlice) {
                e.preventDefault();
                if (e.deltaY > 0) {
                  onSelectSlice(Math.min(slices.length - 1, currentSliceIndex + 1));
                } else if (e.deltaY < 0) {
                  onSelectSlice(Math.max(0, currentSliceIndex - 1));
                }
              }
            }}
            className="relative aspect-square w-full max-w-[380px] bg-black rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center cursor-crosshair shadow-2xl"
          >
            <canvas
              ref={canvasRef}
              width={imageSize}
              height={imageSize}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={() => setHoverPixel(null)}
              className="w-full h-full object-contain image-pixelated"
            />

            {/* Anatomical Compass Orientation Markers on Borders */}
            <div className="absolute top-1 left-1/2 -translate-x-1/2 font-bold text-emerald-400 font-mono text-[10px] bg-black/60 px-1.5 py-0.5 rounded pointer-events-none">
              {planeInfo.markers.top}
            </div>
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 font-bold text-emerald-400 font-mono text-[10px] bg-black/60 px-1.5 py-0.5 rounded pointer-events-none">
              {planeInfo.markers.bottom}
            </div>
            <div className="absolute left-1 top-1/2 -translate-y-1/2 font-bold text-emerald-400 font-mono text-[10px] bg-black/60 px-1 py-0.5 rounded pointer-events-none">
              {planeInfo.markers.left}
            </div>
            <div className="absolute right-1 top-1/2 -translate-y-1/2 font-bold text-emerald-400 font-mono text-[10px] bg-black/60 px-1 py-0.5 rounded pointer-events-none">
              {planeInfo.markers.right}
            </div>

            {/* Live Pixel Value Readout Badge */}
            <div className="absolute top-2 left-2 bg-slate-900/90 backdrop-blur-xs border border-slate-700/80 px-2.5 py-1 rounded-lg text-[10px] font-mono text-slate-200">
              {hoverPixel ? (
                <>
                  x: {hoverPixel.x}, y: {hoverPixel.y} •{' '}
                  <span className="text-emerald-400 font-bold">
                    {hoverPixel.val} {metadata.modality === 'CT' ? 'HU' : 'Intensity'}
                  </span>
                </>
              ) : (
                'Hover to read Hounsfield Units'
              )}
            </div>

            {/* Overlay visibility toggle */}
            <button
              onClick={() => setShowOverlay(!showOverlay)}
              className="absolute top-2 right-2 bg-slate-900/80 hover:bg-slate-850 p-1.5 rounded-lg border border-slate-700 text-slate-300 transition"
              title="Toggle Mask Overlay"
            >
              <Eye className={`w-3.5 h-3.5 ${showOverlay ? 'text-emerald-400' : 'text-slate-500'}`} />
            </button>
          </div>

          {/* Seed Point Instructions / Status */}
          <div className="mt-3 w-full text-[11px] text-slate-400 bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/60">
            {segMode === 'region_grow' ? (
              <span className="text-amber-400 font-medium">
                🎯 <strong>Region Growing Mode:</strong> Click anywhere on the image above to set the seed voxel!
              </span>
            ) : (
              <span>
                💡 <strong>Bioimaging Tip:</strong> Window Center (WC) sets tissue midpoint; Window Width (WW) controls contrast stretch.
              </span>
            )}
          </div>
        </div>

        {/* RIGHT: Windowing, Segmentation Tools & Metrics (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* SECTION 1: Window Center & Window Width (HU) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                  Grayscale Windowing (WC & WW)
                </h3>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                WC: {wc} HU | WW: {ww} HU
              </span>
            </div>

            {/* Quick Clinical Presets */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {WINDOW_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setWc(p.wc);
                    setWw(p.ww);
                  }}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition ${
                    wc === p.wc && ww === p.ww
                      ? 'bg-sky-950 border-sky-500 text-sky-300 font-semibold'
                      : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {/* WC / WW Sliders */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>Window Center (WC):</span>
                  <span className="font-mono text-sky-400">{wc} HU</span>
                </div>
                <input
                  type="range"
                  min="-1000"
                  max="1200"
                  value={wc}
                  onChange={(e) => setWc(Number(e.target.value))}
                  className="w-full accent-sky-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>Window Width (WW):</span>
                  <span className="font-mono text-sky-400">{ww} HU</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="2500"
                  value={ww}
                  onChange={(e) => setWw(Number(e.target.value))}
                  className="w-full accent-sky-500 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: Medical Segmentation Methods */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                  Segmentation Algorithm
                </h3>
              </div>

              {/* Overlay Color Picker */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400">Color:</span>
                {['#10b981', '#f43f5e', '#38bdf8', '#fbbf24', '#a855f7'].map((c) => (
                  <button
                    key={c}
                    onClick={() => setOverlayColor(c)}
                    className={`w-4 h-4 rounded-full border transition ${overlayColor === c ? 'scale-125 border-white ring-1 ring-white' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Segmentation Method Tabs */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <button
                onClick={() => {
                  setMorphMask(null);
                  setSegMode('threshold');
                }}
                className={`py-2 px-2.5 rounded-xl border text-xs font-semibold text-center transition ${
                  segMode === 'threshold'
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Threshold (HU)
              </button>

              <button
                onClick={() => {
                  setMorphMask(null);
                  setSegMode('otsu');
                }}
                className={`py-2 px-2.5 rounded-xl border text-xs font-semibold text-center transition ${
                  segMode === 'otsu'
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Otsu Auto
              </button>

              <button
                onClick={() => {
                  setMorphMask(null);
                  setSegMode('region_grow');
                }}
                className={`py-2 px-2.5 rounded-xl border text-xs font-semibold text-center transition ${
                  segMode === 'region_grow'
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Region Growing
              </button>
            </div>

            {/* Controls for Threshold */}
            {segMode === 'threshold' && (
              <div className="space-y-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <div className="flex gap-2 mb-2 flex-wrap">
                  {metadata.modality === 'CT' ? (
                    <>
                      <button
                        onClick={() => handleThreshChange(-950, -500)}
                        className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 hover:bg-slate-700"
                      >
                        🫁 Lungs (-950 to -500 HU)
                      </button>
                      <button
                        onClick={() => handleThreshChange(20, 80)}
                        className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 hover:bg-slate-700"
                      >
                        ❤️ Soft Tissue (+20 to +80 HU)
                      </button>
                      <button
                        onClick={() => handleThreshChange(400, 1500)}
                        className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 hover:bg-slate-700"
                      >
                        🦴 Cortical Bone (+400 to +1500 HU)
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleThreshChange(180, 255)}
                        className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 hover:bg-slate-700"
                      >
                        CSF / Hotspot (180 to 255)
                      </button>
                      <button
                        onClick={() => handleThreshChange(110, 160)}
                        className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 hover:bg-slate-700"
                      >
                        Gray Matter (110 to 160)
                      </button>
                      <button
                        onClick={() => handleThreshChange(70, 110)}
                        className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-300 hover:bg-slate-700"
                      >
                        White Matter (70 to 110)
                      </button>
                    </>
                  )}
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Lower Bound:</span>
                    <span className="font-mono text-emerald-400">{lowerThresh}</span>
                  </div>
                  <input
                    type="range"
                    min={metadata.modality === 'CT' ? -1000 : 0}
                    max={metadata.modality === 'CT' ? 1000 : 255}
                    value={lowerThresh}
                    onChange={(e) => handleThreshChange(Number(e.target.value), upperThresh)}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Upper Bound:</span>
                    <span className="font-mono text-emerald-400">{upperThresh}</span>
                  </div>
                  <input
                    type="range"
                    min={metadata.modality === 'CT' ? -1000 : 0}
                    max={metadata.modality === 'CT' ? 1500 : 255}
                    value={upperThresh}
                    onChange={(e) => handleThreshChange(lowerThresh, Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* Controls for Region Growing */}
            {segMode === 'region_grow' && (
              <div className="space-y-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Seed Coordinate:</span>
                  <span className="font-mono text-emerald-400">
                    {seedPoint ? `(${seedPoint.x}, ${seedPoint.y})` : 'None (Click image to seed)'}
                  </span>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Growing Tolerance (±Δ):</span>
                    <span className="font-mono text-emerald-400">{tolerance}</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="150"
                    value={tolerance}
                    onChange={(e) => {
                      setMorphMask(null);
                      setTolerance(Number(e.target.value));
                    }}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* Morphological Post-processing */}
            <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-semibold text-slate-300">Morphological Cleanup:</span>
              <div className="flex gap-1">
                <button
                  onClick={() => handleApplyMorphology('dilate')}
                  className="text-[11px] bg-slate-800 hover:bg-slate-750 px-2 py-1 rounded text-slate-200 border border-slate-700"
                  title="3x3 Dilation (Expands boundary)"
                >
                  Dilation
                </button>
                <button
                  onClick={() => handleApplyMorphology('erode')}
                  className="text-[11px] bg-slate-800 hover:bg-slate-750 px-2 py-1 rounded text-slate-200 border border-slate-700"
                  title="3x3 Erosion (Shrinks boundary)"
                >
                  Erosion
                </button>
                <button
                  onClick={() => handleApplyMorphology('open')}
                  className="text-[11px] bg-slate-800 hover:bg-slate-750 px-2 py-1 rounded text-slate-200 border border-slate-700"
                  title="Opening (Erosion then Dilation: removes speckle noise)"
                >
                  Open
                </button>
                <button
                  onClick={() => handleApplyMorphology('close')}
                  className="text-[11px] bg-slate-800 hover:bg-slate-750 px-2 py-1 rounded text-slate-200 border border-slate-700"
                  title="Closing (Dilation then Erosion: fills holes)"
                >
                  Close
                </button>
              </div>
            </div>
          </div>

          {/* SECTION 3: Quantitative Biomarker Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-800">
              <FileSpreadsheet className="w-4 h-4 text-sky-400" />
              <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                Segmentation Biomarkers & Quantitative Metrics
              </h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Volume / Area</span>
                <span className="text-sm font-bold text-emerald-400 font-mono">
                  {segResult.areaMm2 !== undefined ? `${segResult.areaMm2.toFixed(0)} mm²` : `${segResult.areaPixels} px`}
                </span>
              </div>

              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Mean Intensity</span>
                <span className="text-sm font-bold text-sky-400 font-mono">
                  {segResult.meanIntensity} {metadata.modality === 'CT' ? 'HU' : ''}
                </span>
              </div>

              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Std Deviation</span>
                <span className="text-sm font-bold text-amber-400 font-mono">
                  ±{segResult.stdIntensity}
                </span>
              </div>

              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Range [Min, Max]</span>
                <span className="text-xs font-bold text-slate-300 font-mono mt-0.5 block">
                  [{segResult.minIntensity}, {segResult.maxIntensity}]
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
