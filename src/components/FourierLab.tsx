import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ComplexArray2D,
  fft2D,
  ifft2D,
  fftShift2D,
  computeMagnitudeSpectrum,
  computePhaseSpectrum,
  generateFilterMask,
  applyFilterMask,
  calculatePSNR,
} from '../utils/fft2d';
import {
  FilterSettings,
  FilterType,
  FilterShape,
  SpectrumViewMode,
  ToolMode,
  NotchPoint,
  DicomSlice,
  AnatomicalPlane,
} from '../types';
import { DicomSliceNavigator } from './DicomSliceNavigator';
import {
  Sliders,
  Paintbrush,
  Square,
  Crosshair,
  Eraser,
  RotateCcw,
  Download,
  Info,
  Layers,
  ZoomIn,
  Eye,
  EyeOff,
} from 'lucide-react';

interface FourierLabProps {
  originalImageBytes: Uint8ClampedArray; // Grayscale 0-255, length = size * size
  imageSize: number; // e.g. 256
  filterSettings: FilterSettings;
  onFilterChange: (settings: FilterSettings) => void;
  customMask: Float32Array;
  onCustomMaskChange: (mask: Float32Array) => void;
  activeNotchHarmonics?: { u: number; v: number }[];
  slices?: DicomSlice[];
  currentSliceIndex?: number;
  onSelectSlice?: (index: number) => void;
  onOpenDicomViewer?: () => void;
  activePlane?: AnatomicalPlane;
  onChangePlane?: (plane: AnatomicalPlane) => void;
}

export const FourierLab: React.FC<FourierLabProps> = ({
  originalImageBytes,
  imageSize,
  filterSettings,
  onFilterChange,
  customMask,
  onCustomMaskChange,
  activeNotchHarmonics,
  slices,
  currentSliceIndex = 0,
  onSelectSlice,
  onOpenDicomViewer,
  activePlane = 'axial',
  onChangePlane,
}) => {
  const [viewMode, setViewMode] = useState<SpectrumViewMode>('magnitude');
  const [toolMode, setToolMode] = useState<ToolMode>('brush');
  const [brushSize, setBrushSize] = useState<number>(8);
  const [showDifference, setShowDifference] = useState<boolean>(false);
  const [showMaskOverlay, setShowMaskOverlay] = useState<boolean>(true);
  const [hoverCoord, setHoverCoord] = useState<{ u: number; v: number; r: number } | null>(null);

  // Canvases
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const reconstructedCanvasRef = useRef<HTMLCanvasElement>(null);

  // Drag selection state for box tool
  const [isDrawing, setIsDrawing] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxCurrent, setBoxCurrent] = useState<{ x: number; y: number } | null>(null);

  // 1. Compute Forward 2D FFT & Shifted Spectrum
  const { shiftedSpectrum, magSpectrum, phaseSpectrum } = useMemo(() => {
    const floatData = new Float32Array(originalImageBytes.length);
    for (let i = 0; i < originalImageBytes.length; i++) {
      floatData[i] = originalImageBytes[i];
    }
    const rawFft = fft2D(floatData, imageSize, false);
    const shifted = fftShift2D(rawFft);
    const mag = computeMagnitudeSpectrum(shifted);
    const phase = computePhaseSpectrum(shifted);
    return { shiftedSpectrum: shifted, magSpectrum: mag, phaseSpectrum: phase };
  }, [originalImageBytes, imageSize]);

  // 2. Generate Combined Filter Mask
  const filterMask = useMemo(() => {
    return generateFilterMask(imageSize, filterSettings, customMask);
  }, [imageSize, filterSettings, customMask]);

  // 3. Apply Filter & Compute 2D IFFT
  const { reconstructedPixels, psnrMetrics } = useMemo(() => {
    const filteredShifted = applyFilterMask(shiftedSpectrum, filterMask);
    // Unshift before running IFFT
    const unshifted = fftShift2D(filteredShifted);
    const reconstructedReal = ifft2D(unshifted);

    const origFloat = new Float32Array(originalImageBytes.length);
    for (let i = 0; i < originalImageBytes.length; i++) {
      origFloat[i] = originalImageBytes[i];
    }

    const metrics = calculatePSNR(origFloat, reconstructedReal);
    return { reconstructedPixels: reconstructedReal, psnrMetrics: metrics };
  }, [shiftedSpectrum, filterMask, imageSize, originalImageBytes]);

  // Render Original Image Canvas
  useEffect(() => {
    const canvas = originalCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(imageSize, imageSize);
    for (let i = 0; i < originalImageBytes.length; i++) {
      const val = originalImageBytes[i];
      const idx = i * 4;
      imgData.data[idx] = val;
      imgData.data[idx + 1] = val;
      imgData.data[idx + 2] = val;
      imgData.data[idx + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }, [originalImageBytes, imageSize]);

  // Render Frequency Spectrum Canvas (with Filter Mask Overlay & Notches)
  useEffect(() => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(imageSize, imageSize);
    const baseData = viewMode === 'magnitude' ? magSpectrum : phaseSpectrum;

    for (let i = 0; i < baseData.length; i++) {
      const val = baseData[i];
      const maskVal = filterMask[i]; // 0 to 1
      const idx = i * 4;

      if (showMaskOverlay && maskVal < 0.99) {
        // Red tinted suppression for deleted frequencies
        const rejectDim = Math.round(val * 0.3);
        const redWeight = Math.round((1 - maskVal) * 160);
        imgData.data[idx] = Math.min(255, rejectDim + redWeight);
        imgData.data[idx + 1] = Math.round(rejectDim * 0.4);
        imgData.data[idx + 2] = Math.round(rejectDim * 0.4);
        imgData.data[idx + 3] = 255;
      } else {
        imgData.data[idx] = val;
        imgData.data[idx + 1] = val;
        imgData.data[idx + 2] = val;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw UI Overlays (DC marker, axes, cutoff radius circle, active harmonic markers)
    const center = imageSize / 2;
    ctx.save();

    // Subtle axes lines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(center, 0);
    ctx.lineTo(center, imageSize);
    ctx.moveTo(0, center);
    ctx.lineTo(imageSize, center);
    ctx.stroke();

    // DC Component Center Point
    ctx.setLineDash([]);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(center, center, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Radial Cutoff Guide Circle (for Lowpass / Highpass / Bandpass)
    if (filterSettings.type === 'lowpass' || filterSettings.type === 'highpass') {
      ctx.strokeStyle = filterSettings.type === 'lowpass' ? '#38bdf8' : '#f43f5e';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(center, center, filterSettings.cutoff, 0, Math.PI * 2);
      ctx.stroke();
    } else if (filterSettings.type === 'bandpass') {
      const inner = filterSettings.cutoffInner ?? 15;
      const outer = filterSettings.cutoffOuter ?? 60;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(center, center, inner, 0, Math.PI * 2);
      ctx.arc(center, center, outer, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Notch points visualization
    if (filterSettings.type === 'notch') {
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.5;
      for (const notch of filterSettings.notches) {
        ctx.beginPath();
        ctx.arc(center + notch.u, center + notch.v, notch.radius, 0, Math.PI * 2);
        ctx.arc(center - notch.u, center - notch.v, notch.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Free the Tiger Harmonic Spikes guide markers
    if (activeNotchHarmonics && activeNotchHarmonics.length > 0) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 2]);
      for (const h of activeNotchHarmonics) {
        ctx.beginPath();
        ctx.arc(center + h.u, center + h.v, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Box selection preview
    if (isDrawing && toolMode === 'box' && boxStart && boxCurrent) {
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      const x = Math.min(boxStart.x, boxCurrent.x);
      const y = Math.min(boxStart.y, boxCurrent.y);
      const w = Math.abs(boxCurrent.x - boxStart.x);
      const h = Math.abs(boxCurrent.y - boxStart.y);
      ctx.strokeRect(x, y, w, h);
    }

    ctx.restore();
  }, [
    viewMode,
    magSpectrum,
    phaseSpectrum,
    filterMask,
    showMaskOverlay,
    filterSettings,
    imageSize,
    activeNotchHarmonics,
    isDrawing,
    toolMode,
    boxStart,
    boxCurrent,
  ]);

  // Render Reconstructed / Filtered Image Canvas
  useEffect(() => {
    const canvas = reconstructedCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(imageSize, imageSize);

    for (let i = 0; i < reconstructedPixels.length; i++) {
      const idx = i * 4;
      if (showDifference) {
        // Difference Image: |Original - Altered| magnified by 3x for clear perception
        const diff = Math.min(255, Math.abs(originalImageBytes[i] - reconstructedPixels[i]) * 3);
        imgData.data[idx] = diff;
        imgData.data[idx + 1] = diff > 80 ? 40 : diff; // highlight removed high frequencies
        imgData.data[idx + 2] = diff;
        imgData.data[idx + 3] = 255;
      } else {
        const val = Math.max(0, Math.min(255, Math.round(reconstructedPixels[i])));
        imgData.data[idx] = val;
        imgData.data[idx + 1] = val;
        imgData.data[idx + 2] = val;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [reconstructedPixels, originalImageBytes, showDifference, imageSize]);

  // Handle Interactive Frequency Deletion Canvas Events
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    setIsDrawing(true);

    if (toolMode === 'box') {
      setBoxStart(coords);
      setBoxCurrent(coords);
      return;
    }

    if (toolMode === 'notch_pair') {
      const center = imageSize / 2;
      const u = coords.x - center;
      const v = coords.y - center;

      // Add a conjugate notch filter pair
      const newNotch: NotchPoint = {
        id: `notch-${Date.now()}`,
        u,
        v,
        radius: brushSize,
      };

      onFilterChange({
        ...filterSettings,
        type: 'notch',
        notches: [...filterSettings.notches, newNotch],
      });
      return;
    }

    // Brush or Eraser
    applyBrushAt(coords.x, coords.y, toolMode === 'eraser' ? 1.0 : 0.0);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    const center = imageSize / 2;
    const u = coords.x - center;
    const v = coords.y - center;
    const r = Math.round(Math.hypot(u, v));
    setHoverCoord({ u, v, r });

    if (!isDrawing) return;

    if (toolMode === 'box') {
      setBoxCurrent(coords);
      return;
    }

    if (toolMode === 'brush' || toolMode === 'eraser') {
      applyBrushAt(coords.x, coords.y, toolMode === 'eraser' ? 1.0 : 0.0);
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && toolMode === 'box' && boxStart && boxCurrent) {
      applyBoxDeletion(boxStart, boxCurrent);
    }
    setIsDrawing(false);
    setBoxStart(null);
    setBoxCurrent(null);
  };

  // Direct frequency brush application onto customMask
  const applyBrushAt = (cx: number, cy: number, val: number) => {
    const newMask = new Float32Array(customMask);
    const r = brushSize;
    const rSq = r * r;
    const center = imageSize / 2;

    // Apply at clicked position AND conjugate symmetric position to preserve Hermitian symmetry!
    const pairs = [
      { x: cx, y: cy },
      { x: Math.round(2 * center - cx), y: Math.round(2 * center - cy) },
    ];

    for (const p of pairs) {
      for (let dy = -r; dy <= r; dy++) {
        const y = p.y + dy;
        if (y < 0 || y >= imageSize) continue;
        const row = y * imageSize;

        for (let dx = -r; dx <= r; dx++) {
          const x = p.x + dx;
          if (x < 0 || x >= imageSize) continue;
          if (dx * dx + dy * dy <= rSq) {
            newMask[row + x] = val;
          }
        }
      }
    }

    onCustomMaskChange(newMask);
  };

  const applyBoxDeletion = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    const newMask = new Float32Array(customMask);
    const xMin = Math.min(p1.x, p2.x);
    const xMax = Math.max(p1.x, p2.x);
    const yMin = Math.min(p1.y, p2.y);
    const yMax = Math.max(p1.y, p2.y);
    const center = imageSize / 2;

    for (let y = yMin; y <= yMax; y++) {
      if (y < 0 || y >= imageSize) continue;
      const row = y * imageSize;
      const symY = Math.round(2 * center - y);
      const symRow = symY >= 0 && symY < imageSize ? symY * imageSize : -1;

      for (let x = xMin; x <= xMax; x++) {
        if (x < 0 || x >= imageSize) continue;
        newMask[row + x] = 0.0;

        // Conjugate symmetry box
        const symX = Math.round(2 * center - x);
        if (symRow !== -1 && symX >= 0 && symX < imageSize) {
          newMask[symRow + symX] = 0.0;
        }
      }
    }

    onCustomMaskChange(newMask);
  };

  const handleClearCustomMask = () => {
    const cleanMask = new Float32Array(imageSize * imageSize).fill(1.0);
    onCustomMaskChange(cleanMask);
    onFilterChange({
      ...filterSettings,
      notches: [],
    });
  };

  const handleDownloadAltered = () => {
    const canvas = reconstructedCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `bme360_filtered_${filterSettings.type}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Volumetric Slice Navigator (when multi-slice dataset/DICOM is loaded) */}
      {slices && slices.length > 1 && onSelectSlice && (
        <DicomSliceNavigator
          slices={slices}
          currentSliceIndex={currentSliceIndex}
          onSelectSlice={onSelectSlice}
          onOpenDicomViewer={onOpenDicomViewer}
          activePlane={activePlane}
          onChangePlane={onChangePlane}
          showPlaneSelector={true}
        />
      )}

      {/* 3-Panel Side-by-Side Visualizer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* PANEL 1: Original Spatial Image */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center">
          <div className="w-full flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wider">
                1. Original Image f(x, y)
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded">
              {imageSize}×{imageSize}
            </span>
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
            className="relative aspect-square w-full max-w-[320px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center shadow-inner cursor-ns-resize"
            title={slices && slices.length > 1 ? 'Scroll mouse wheel to browse through slices' : undefined}
          >
            <canvas
              ref={originalCanvasRef}
              width={imageSize}
              height={imageSize}
              className="w-full h-full object-contain image-pixelated"
            />
          </div>

          <div className="mt-3 w-full text-[11px] text-slate-400 bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/60 leading-relaxed">
            <strong className="text-sky-300">Spatial Domain:</strong> Pixels represent signal intensity. Sharp edges, boundaries, and periodic bars correspond to high-frequency variations.
          </div>
        </div>

        {/* PANEL 2: Interactive Frequency Domain (k-Space Spectrum) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center">
          <div className="w-full flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wider">
                2. Frequency Domain F(u, v)
              </h3>
            </div>

            {/* Spectrum View Mode Switcher */}
            <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px]">
              <button
                onClick={() => setViewMode('magnitude')}
                className={`px-2 py-0.5 rounded ${
                  viewMode === 'magnitude' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'
                }`}
                title="Log Magnitude Spectrum"
              >
                Log|F|
              </button>
              <button
                onClick={() => setViewMode('phase')}
                className={`px-2 py-0.5 rounded ${
                  viewMode === 'phase' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'
                }`}
                title="Phase Spectrum (Angle)"
              >
                Phase
              </button>
            </div>
          </div>

          {/* Interactive Spectrum Canvas */}
          <div className="relative aspect-square w-full max-w-[320px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center cursor-crosshair shadow-inner group">
            <canvas
              ref={spectrumCanvasRef}
              width={imageSize}
              height={imageSize}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                setHoverCoord(null);
                setIsDrawing(false);
              }}
              className="w-full h-full object-contain image-pixelated select-none"
            />

            {/* Coordinates readout badge */}
            <div className="absolute top-2 left-2 bg-slate-900/90 backdrop-blur-xs border border-slate-700/80 px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 pointer-events-none">
              {hoverCoord
                ? `u: ${hoverCoord.u}, v: ${hoverCoord.v} (r: ${hoverCoord.r}px)`
                : `Center (DC): u=0, v=0`}
            </div>

            {/* Overlay toggle */}
            <button
              onClick={() => setShowMaskOverlay(!showMaskOverlay)}
              className="absolute top-2 right-2 bg-slate-900/80 hover:bg-slate-850 p-1.5 rounded-lg border border-slate-700 text-slate-300 transition"
              title={showMaskOverlay ? 'Hide Red Mask Overlay' : 'Show Red Mask Overlay'}
            >
              {showMaskOverlay ? <Eye className="w-3.5 h-3.5 text-sky-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-500" />}
            </button>
          </div>

          {/* Interactive Brush & Eraser Tools Toolbar */}
          <div className="mt-3 w-full flex items-center justify-between gap-1 bg-slate-950/80 border border-slate-800 p-1.5 rounded-xl flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setToolMode('brush')}
                className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition ${
                  toolMode === 'brush' ? 'bg-sky-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Frequency Deletion Brush (Zero out frequencies)"
              >
                <Paintbrush className="w-3.5 h-3.5" />
                <span className="text-[11px] hidden sm:inline">Brush</span>
              </button>

              <button
                onClick={() => setToolMode('notch_pair')}
                className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition ${
                  toolMode === 'notch_pair' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Conjugate Symmetric Notch Clicker"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span className="text-[11px] hidden sm:inline">Notch</span>
              </button>

              <button
                onClick={() => setToolMode('box')}
                className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition ${
                  toolMode === 'box' ? 'bg-sky-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Box Deletion Region"
              >
                <Square className="w-3.5 h-3.5" />
                <span className="text-[11px] hidden sm:inline">Box</span>
              </button>

              <button
                onClick={() => setToolMode('eraser')}
                className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition ${
                  toolMode === 'eraser' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Restore / Un-delete Frequencies"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span className="text-[11px] hidden sm:inline">Restore</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 font-mono">r={brushSize}</span>
              <input
                type="range"
                min="2"
                max="24"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-16 accent-sky-500 cursor-pointer"
                title="Brush Radius"
              />
              <button
                onClick={handleClearCustomMask}
                className="p-1 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                title="Clear Drawn Masks"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* PANEL 3: Reconstructed Altered Image */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col items-center">
          <div className="w-full flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wider">
                3. Altered Reconstructed g(x, y)
              </h3>
            </div>

            {/* Difference Map Toggle & Download */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowDifference(!showDifference)}
                className={`text-[10px] px-2 py-1 rounded-lg border transition ${
                  showDifference
                    ? 'bg-rose-950/80 border-rose-600 text-rose-300 font-semibold'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                }`}
                title="Toggle Difference Map |Original - Filtered|"
              >
                {showDifference ? 'Difference On' : 'Diff Map'}
              </button>

              <button
                onClick={handleDownloadAltered}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 transition"
                title="Download Reconstructed PNG"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="relative aspect-square w-full max-w-[320px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center shadow-inner">
            <canvas
              ref={reconstructedCanvasRef}
              width={imageSize}
              height={imageSize}
              className="w-full h-full object-contain image-pixelated"
            />
          </div>

          {/* Quantitative Bioimaging Metrics (PSNR / MSE) */}
          <div className="mt-3 w-full flex items-center justify-between text-[11px] font-mono text-slate-300 bg-slate-950/60 rounded-xl px-3 py-2 border border-slate-800/60">
            <div>
              <span className="text-slate-500">PSNR: </span>
              <span className="text-sky-400 font-semibold">{psnrMetrics.psnr} dB</span>
            </div>
            <div>
              <span className="text-slate-500">MSE: </span>
              <span className="text-emerald-400 font-semibold">{psnrMetrics.mse}</span>
            </div>
            <div className="text-[10px] text-slate-500">
              IFFT(F·H)
            </div>
          </div>
        </div>
      </div>

      {/* FILTER CONTROLS & BME 360 PARAMETERS PANEL */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 mb-4 border-b border-slate-800 gap-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-bold text-white tracking-wide uppercase">
              Filter Selection & Frequency Parameters
            </h2>
          </div>

          {/* Filter Inversion Toggle */}
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filterSettings.invert}
              onChange={(e) =>
                onFilterChange({ ...filterSettings, invert: e.target.checked })
              }
              className="rounded accent-sky-500"
            />
            <span>Invert Frequency Response (1 - H)</span>
          </label>
        </div>

        {/* Filter Type Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
          {(
            [
              { id: 'lowpass', label: 'Low-Pass (LPF)', desc: 'Smooths image, keeps gross contrast' },
              { id: 'highpass', label: 'High-Pass (HPF)', desc: 'Extracts edges, removes DC' },
              { id: 'bandpass', label: 'Band-Pass (BPF)', desc: 'Isolates mid-frequency texture' },
              { id: 'notch', label: 'Notch Filter', desc: 'Rejects periodic harmonic spikes' },
              { id: 'custom', label: 'Custom Eraser', desc: 'Pure direct k-space painting' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => onFilterChange({ ...filterSettings, type: item.id })}
              className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                filterSettings.type === item.id
                  ? 'bg-sky-950/70 border-sky-500/80 text-white shadow-xs'
                  : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <span className="text-xs font-bold block">{item.label}</span>
              <span className="text-[10px] text-slate-400 mt-1 line-clamp-1">{item.desc}</span>
            </button>
          ))}
        </div>

        {/* Dynamic Controls based on selected Filter Type */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
          {/* 1. Filter Mathematical Shape (Ideal, Butterworth, Gaussian) */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-2">
              Filter Transfer Function Profile:
            </label>
            <div className="grid grid-cols-3 gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
              {(
                [
                  { id: 'ideal', name: 'Ideal', tip: 'Sharp cutoff (causes Gibbs ringing)' },
                  { id: 'butterworth', name: 'Butterworth', tip: 'Smooth polynomial roll-off' },
                  { id: 'gaussian', name: 'Gaussian', tip: 'Smooth exponential (zero ringing)' },
                ] as const
              ).map((shape) => (
                <button
                  key={shape.id}
                  onClick={() => onFilterChange({ ...filterSettings, shape: shape.id })}
                  className={`py-1.5 px-2 text-xs rounded-lg transition text-center font-medium ${
                    filterSettings.shape === shape.id
                      ? 'bg-sky-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={shape.tip}
                >
                  {shape.name}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              {filterSettings.shape === 'ideal' && (
                <span className="text-amber-400">
                  ⚠️ <strong>Gibbs Phenomenon:</strong> Sharp frequency cutoffs create spatial sinc ringing around high-contrast edges.
                </span>
              )}
              {filterSettings.shape === 'butterworth' && (
                <span>
                  <strong>Butterworth:</strong> Controllable roll-off via order parameter <em>n</em>.
                </span>
              )}
              {filterSettings.shape === 'gaussian' && (
                <span className="text-emerald-400">
                  ✓ <strong>Gaussian:</strong> Inverse Fourier transform is also Gaussian; completely eliminates ringing artifacts!
                </span>
              )}
            </p>
          </div>

          {/* 2. Frequency Cutoff Sliders (D0, Inner, Outer) */}
          <div className="space-y-3">
            {filterSettings.type !== 'bandpass' && (
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-300 mb-1">
                  <span>Cutoff Frequency Radius (D₀):</span>
                  <span className="font-mono text-sky-400">{filterSettings.cutoff} px</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max={imageSize / 2}
                  value={filterSettings.cutoff}
                  onChange={(e) =>
                    onFilterChange({
                      ...filterSettings,
                      cutoff: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500 cursor-pointer"
                />
              </div>
            )}

            {filterSettings.type === 'bandpass' && (
              <>
                <div>
                  <div className="flex justify-between text-xs font-medium text-slate-300 mb-1">
                    <span>Inner Cutoff (D₁):</span>
                    <span className="font-mono text-sky-400">
                      {filterSettings.cutoffInner ?? 15} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max={imageSize / 4}
                    value={filterSettings.cutoffInner ?? 15}
                    onChange={(e) =>
                      onFilterChange({
                        ...filterSettings,
                        cutoffInner: Number(e.target.value),
                      })
                    }
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs font-medium text-slate-300 mb-1">
                    <span>Outer Cutoff (D₂):</span>
                    <span className="font-mono text-sky-400">
                      {filterSettings.cutoffOuter ?? 60} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max={imageSize / 2}
                    value={filterSettings.cutoffOuter ?? 60}
                    onChange={(e) =>
                      onFilterChange({
                        ...filterSettings,
                        cutoffOuter: Number(e.target.value),
                      })
                    }
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                </div>
              </>
            )}

            {/* Butterworth Order Slider (if butterworth selected) */}
            {filterSettings.shape === 'butterworth' && (
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-300 mb-1">
                  <span>Butterworth Order (n):</span>
                  <span className="font-mono text-sky-400">{filterSettings.butterworthOrder}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="8"
                  value={filterSettings.butterworthOrder}
                  onChange={(e) =>
                    onFilterChange({
                      ...filterSettings,
                      butterworthOrder: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500 cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* 3. Notch Filter Manager / Frequency Mask Status */}
          <div>
            <span className="text-xs font-semibold text-slate-300 block mb-2">
              Active Notch Reject Points:
            </span>
            {filterSettings.notches.length === 0 ? (
              <div className="text-xs text-slate-500 p-3 bg-slate-900 rounded-xl border border-slate-800 text-center">
                No active notch points. Select the <strong className="text-sky-400">Notch</strong> tool and click on frequency spikes in k-space!
              </div>
            ) : (
              <div className="max-h-28 overflow-y-auto space-y-1.5 pr-1">
                {filterSettings.notches.map((n, idx) => (
                  <div
                    key={n.id || idx}
                    className="flex items-center justify-between bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg text-xs font-mono text-slate-300"
                  >
                    <span>
                      ±({n.u}, {n.v}) r={n.radius}px
                    </span>
                    <button
                      onClick={() =>
                        onFilterChange({
                          ...filterSettings,
                          notches: filterSettings.notches.filter((_, i) => i !== idx),
                        })
                      }
                      className="text-rose-400 hover:text-rose-300 ml-2"
                      title="Remove Notch"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
