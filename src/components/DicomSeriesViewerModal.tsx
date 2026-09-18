import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { DicomMetadata, DicomSlice, AnatomicalPlane } from '../types';
import { applyDicomWindowing, WINDOW_PRESETS } from '../utils/dicom';
import { ANATOMICAL_PLANES, generatePlaneSlices, extractMPRSlice } from '../utils/mpr';
import {
  X,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Sliders,
  Layers,
  Sparkles,
  CheckCircle2,
  Activity,
  ArrowRight,
  RotateCcw,
  ZoomIn,
  Move,
  Info,
  Compass,
  Grid3X3,
  Columns,
  Eye,
} from 'lucide-react';

interface DicomSeriesViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  metadata: DicomMetadata;
  slices: DicomSlice[]; // Base volume (axial) slices
  currentSliceIndex: number;
  initialPlane?: AnatomicalPlane;
  onSelectSlice: (index: number, plane?: AnatomicalPlane) => void;
  onAnalyzeSlice: (sliceIndex: number, plane?: AnatomicalPlane) => void;
}

export const DicomSeriesViewerModal: React.FC<DicomSeriesViewerModalProps> = ({
  isOpen,
  onClose,
  metadata,
  slices: baseAxialSlices,
  currentSliceIndex,
  initialPlane = 'axial',
  onSelectSlice,
  onAnalyzeSlice,
}) => {
  // Current anatomical viewing plane ('axial' | 'coronal' | 'sagittal')
  const [activePlane, setActivePlane] = useState<AnatomicalPlane>(initialPlane);
  // View mode: 'single' plane or 'mpr_tri' (3 orthogonal planes side-by-side)
  const [viewLayout, setViewLayout] = useState<'single' | 'mpr_tri'>('single');

  // Slice indices for all 3 planes so they stay synchronized
  const [axialIdx, setAxialIdx] = useState<number>(currentSliceIndex);
  const [coronalIdx, setCoronalIdx] = useState<number>(12);
  const [sagittalIdx, setSagittalIdx] = useState<number>(12);

  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(12);

  // Windowing state
  const [wc, setWc] = useState<number>(metadata.windowCenter || 40);
  const [ww, setWw] = useState<number>(metadata.windowWidth || 400);

  // Interaction mode: 'scroll' | 'window' | 'crosshair'
  const [mouseTool, setMouseTool] = useState<'scroll' | 'window' | 'crosshair'>('scroll');
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; startWc: number; startWw: number } | null>(null);

  // Probe readout
  const [probe, setProbe] = useState<{ x: number; y: number; val: number } | null>(null);

  // Canvases
  const singleCanvasRef = useRef<HTMLCanvasElement>(null);
  const triAxialCanvasRef = useRef<HTMLCanvasElement>(null);
  const triCoronalCanvasRef = useRef<HTMLCanvasElement>(null);
  const triSagittalCanvasRef = useRef<HTMLCanvasElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);

  const volWidth = metadata.columns || 256;
  const volHeight = metadata.rows || 256;

  // Memoize generated slices for each plane
  const axialSlices = baseAxialSlices;
  const coronalSlices = useMemo(() => {
    return generatePlaneSlices(baseAxialSlices, volWidth, volHeight, 'coronal', metadata);
  }, [baseAxialSlices, volWidth, volHeight, metadata]);

  const sagittalSlices = useMemo(() => {
    return generatePlaneSlices(baseAxialSlices, volWidth, volHeight, 'sagittal', metadata);
  }, [baseAxialSlices, volWidth, volHeight, metadata]);

  // Slices corresponding to currently active single plane
  const currentPlaneSlices = useMemo(() => {
    if (activePlane === 'coronal') return coronalSlices;
    if (activePlane === 'sagittal') return sagittalSlices;
    return axialSlices;
  }, [activePlane, axialSlices, coronalSlices, sagittalSlices]);

  // Current slice index for the active plane
  const activeIdx = useMemo(() => {
    if (activePlane === 'coronal') return Math.min(coronalSlices.length - 1, coronalIdx);
    if (activePlane === 'sagittal') return Math.min(sagittalSlices.length - 1, sagittalIdx);
    return Math.min(axialSlices.length - 1, axialIdx);
  }, [activePlane, coronalIdx, sagittalIdx, axialIdx, coronalSlices.length, sagittalSlices.length, axialSlices.length]);

  const setActiveIdxForCurrentPlane = useCallback(
    (newIdx: number | ((prev: number) => number)) => {
      if (activePlane === 'coronal') {
        setCoronalIdx((prev) => {
          const val = typeof newIdx === 'function' ? newIdx(prev) : newIdx;
          return Math.max(0, Math.min(coronalSlices.length - 1, val));
        });
      } else if (activePlane === 'sagittal') {
        setSagittalIdx((prev) => {
          const val = typeof newIdx === 'function' ? newIdx(prev) : newIdx;
          return Math.max(0, Math.min(sagittalSlices.length - 1, val));
        });
      } else {
        setAxialIdx((prev) => {
          const val = typeof newIdx === 'function' ? newIdx(prev) : newIdx;
          return Math.max(0, Math.min(axialSlices.length - 1, val));
        });
      }
    },
    [activePlane, coronalSlices.length, sagittalSlices.length, axialSlices.length]
  );

  const totalSlices = currentPlaneSlices.length;
  const activeSlice = currentPlaneSlices[activeIdx] || currentPlaneSlices[0];
  const planeInfo = ANATOMICAL_PLANES[activePlane];

  // Sync internal index when modal opens
  useEffect(() => {
    if (isOpen) {
      setAxialIdx(currentSliceIndex);
      setActivePlane(initialPlane);
    }
  }, [currentSliceIndex, initialPlane, isOpen]);

  // Cine loop for single view
  useEffect(() => {
    if (!isPlaying || totalSlices <= 1 || !isOpen || viewLayout === 'mpr_tri') return;

    const interval = 1000 / fps;
    const timer = setInterval(() => {
      setActiveIdxForCurrentPlane((prev) => (prev + 1) % totalSlices);
    }, interval);

    return () => clearInterval(timer);
  }, [isPlaying, totalSlices, fps, isOpen, viewLayout, setActiveIdxForCurrentPlane]);

  // Scroll active thumbnail into view in filmstrip
  useEffect(() => {
    if (filmstripRef.current) {
      const activeEl = filmstripRef.current.children[activeIdx] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeIdx]);

  // Render Single Viewport Canvas
  useEffect(() => {
    if (!isOpen || viewLayout !== 'single' || !singleCanvasRef.current || !activeSlice) return;

    const canvas = singleCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 256;
    const height = 256;
    canvas.width = width;
    canvas.height = height;

    const windowed = applyDicomWindowing(activeSlice.pixelData, wc, ww);
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    for (let i = 0; i < windowed.length; i++) {
      const g = windowed[i];
      const idx = i * 4;
      data[idx] = g;
      data[idx + 1] = g;
      data[idx + 2] = g;
      data[idx + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
  }, [activeSlice, wc, ww, isOpen, viewLayout]);

  // Helper to render an MPR canvas with crosshair reference lines
  const renderTriCanvas = useCallback(
    (
      canvas: HTMLCanvasElement | null,
      slice: DicomSlice | undefined,
      crosshair?: { xNorm: number; yNorm: number; color: string }
    ) => {
      if (!canvas || !slice) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const size = 256;
      canvas.width = size;
      canvas.height = size;

      const windowed = applyDicomWindowing(slice.pixelData, wc, ww);
      const imgData = ctx.createImageData(size, size);
      const data = imgData.data;

      for (let i = 0; i < windowed.length; i++) {
        const g = windowed[i];
        const idx = i * 4;
        data[idx] = g;
        data[idx + 1] = g;
        data[idx + 2] = g;
        data[idx + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);

      // Draw crosshairs if present
      if (crosshair) {
        const cx = Math.round(crosshair.xNorm * size);
        const cy = Math.round(crosshair.yNorm * size);

        ctx.strokeStyle = crosshair.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);

        // Horizontal line
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(size, cy);
        ctx.stroke();

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, size);
        ctx.stroke();

        ctx.setLineDash([]);
      }
    },
    [wc, ww]
  );

  // Render Tri-Planar Viewports
  useEffect(() => {
    if (!isOpen || viewLayout !== 'mpr_tri') return;

    const normAxial = axialIdx / Math.max(1, axialSlices.length - 1);
    const normCoronal = coronalIdx / Math.max(1, coronalSlices.length - 1);
    const normSagittal = sagittalIdx / Math.max(1, sagittalSlices.length - 1);

    // Axial view (crosshairs: X=sagittal, Y=coronal)
    renderTriCanvas(triAxialCanvasRef.current, axialSlices[axialIdx], {
      xNorm: normSagittal,
      yNorm: normCoronal,
      color: '#38bdf8', // Sky
    });

    // Coronal view (crosshairs: X=sagittal, Y=axial)
    renderTriCanvas(triCoronalCanvasRef.current, coronalSlices[coronalIdx], {
      xNorm: normSagittal,
      yNorm: normAxial,
      color: '#34d399', // Emerald
    });

    // Sagittal view (crosshairs: X=coronal, Y=axial)
    renderTriCanvas(triSagittalCanvasRef.current, sagittalSlices[sagittalIdx], {
      xNorm: normCoronal,
      yNorm: normAxial,
      color: '#fbbf24', // Amber
    });
  }, [
    isOpen,
    viewLayout,
    axialIdx,
    coronalIdx,
    sagittalIdx,
    axialSlices,
    coronalSlices,
    sagittalSlices,
    renderTriCanvas,
  ]);

  // Handle mouse wheel scrolling for slice browsing
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      setIsPlaying(false);
      if (totalSlices <= 1) return;

      if (e.deltaY > 0) {
        setActiveIdxForCurrentPlane((prev) => Math.min(totalSlices - 1, prev + 1));
      } else if (e.deltaY < 0) {
        setActiveIdxForCurrentPlane((prev) => Math.max(0, prev - 1));
      }
    },
    [totalSlices, setActiveIdxForCurrentPlane]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setIsPlaying(false);
        setActiveIdxForCurrentPlane((prev) => (prev + 1) % totalSlices);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setIsPlaying(false);
        setActiveIdxForCurrentPlane((prev) => (prev <= 0 ? totalSlices - 1 : prev - 1));
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, totalSlices, onClose, setActiveIdxForCurrentPlane]);

  // Window/Level drag handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mouseTool === 'window') {
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        startWc: wc,
        startWw: ww,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = singleCanvasRef.current;
    if (!canvas || !activeSlice) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const cx = Math.floor((e.clientX - rect.left) * scaleX);
    const cy = Math.floor((e.clientY - rect.top) * scaleY);

    if (cx >= 0 && cx < canvas.width && cy >= 0 && cy < canvas.height) {
      const idx = cy * canvas.width + cx;
      const val = activeSlice.pixelData[idx];
      setProbe({ x: cx, y: cy, val });
    } else {
      setProbe(null);
    }

    if (isDragging && dragStartRef.current && mouseTool === 'window') {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      const newWw = Math.max(1, Math.round(dragStartRef.current.startWw + dx * 2));
      const newWc = Math.round(dragStartRef.current.startWc - dy * 2);

      setWw(newWw);
      setWc(newWc);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    dragStartRef.current = null;
  };

  // Crosshair click on Tri-Planar viewports
  const handleTriAxialClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = triAxialCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setSagittalIdx(Math.round(xNorm * (sagittalSlices.length - 1)));
    setCoronalIdx(Math.round(yNorm * (coronalSlices.length - 1)));
  };

  const handleTriCoronalClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = triCoronalCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setSagittalIdx(Math.round(xNorm * (sagittalSlices.length - 1)));
    setAxialIdx(Math.round(yNorm * (axialSlices.length - 1)));
  };

  const handleTriSagittalClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = triSagittalCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setCoronalIdx(Math.round(xNorm * (coronalSlices.length - 1)));
    setAxialIdx(Math.round(yNorm * (axialSlices.length - 1)));
  };

  const handleSelectAndClose = (planeToUse?: AnatomicalPlane, indexToUse?: number) => {
    const targetPlane = planeToUse || activePlane;
    const targetIdx = indexToUse !== undefined ? indexToUse : activeIdx;
    onSelectSlice(targetIdx, targetPlane);
    onAnalyzeSlice(targetIdx, targetPlane);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-6xl h-[94vh] max-h-[900px] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-4 sm:px-5 py-2.5 sm:py-3 border-b border-slate-800/90 flex items-center justify-between bg-slate-900/80 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-400 shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-sky-400 uppercase tracking-wide bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/70">
                  {metadata.modality} Multi-Planar Series
                </span>
                <h2 className="text-sm font-bold text-white truncate">
                  {metadata.seriesDescription || 'DICOM PACS Viewer'}
                </h2>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                Patient: <span className="text-slate-300 font-medium">{metadata.patientName}</span> • View from Axial, Coronal, or Sagittal planes
              </p>
            </div>
          </div>

          {/* Plane & Layout Switcher */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Anatomical Plane Tabs */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              {(['axial', 'coronal', 'sagittal'] as AnatomicalPlane[]).map((plane) => {
                const isActive = viewLayout === 'single' && activePlane === plane;
                return (
                  <button
                    key={plane}
                    onClick={() => {
                      setViewLayout('single');
                      setActivePlane(plane);
                      setIsPlaying(false);
                    }}
                    className={`px-2.5 py-1 rounded-lg font-semibold capitalize transition cursor-pointer ${
                      isActive
                        ? 'bg-sky-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                    title={ANATOMICAL_PLANES[plane].description}
                  >
                    {plane}
                  </button>
                );
              })}

              {/* Tri-Planar MPR Button */}
              <button
                onClick={() => {
                  setViewLayout('mpr_tri');
                  setIsPlaying(false);
                }}
                className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1.5 border-l border-slate-800 ml-1 pl-2 ${
                  viewLayout === 'mpr_tri'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
                title="Tri-Planar Orthogonal View (Axial, Coronal, and Sagittal simultaneously)"
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Tri-Planar (MPR)</span>
              </button>
            </div>

            <button
              onClick={() => handleSelectAndClose()}
              className="hidden md:flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Select {planeInfo.short} #{activeIdx + 1}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Close viewer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Work Area */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Main Stage Viewport */}
          <div
            onWheel={handleWheel}
            className="flex-1 relative bg-black flex items-center justify-center overflow-hidden select-none p-3"
          >
            {/* LAYOUT A: SINGLE ANATOMICAL PLANE VIEW */}
            {viewLayout === 'single' && (
              <div className="relative border border-slate-800/80 rounded-xl overflow-hidden shadow-2xl bg-slate-950 max-w-full max-h-[56vh] md:max-h-[64vh] aspect-square flex items-center justify-center">
                <canvas
                  ref={singleCanvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={() => {
                    handleMouseUp();
                    setProbe(null);
                  }}
                  className={`w-full h-full object-contain ${
                    mouseTool === 'window' ? 'cursor-crosshair' : 'cursor-ns-resize'
                  }`}
                />

                {/* Anatomical Compass Orientation Markers on Borders */}
                <div className="absolute top-1.5 left-1/2 -translate-x-1/2 font-bold text-sky-400 font-mono text-[11px] bg-black/60 px-1.5 py-0.5 rounded pointer-events-none">
                  {planeInfo.markers.top}
                </div>
                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 font-bold text-sky-400 font-mono text-[11px] bg-black/60 px-1.5 py-0.5 rounded pointer-events-none">
                  {planeInfo.markers.bottom}
                </div>
                <div className="absolute left-1.5 top-1/2 -translate-y-1/2 font-bold text-sky-400 font-mono text-[11px] bg-black/60 px-1 py-0.5 rounded pointer-events-none">
                  {planeInfo.markers.left}
                </div>
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 font-bold text-sky-400 font-mono text-[11px] bg-black/60 px-1 py-0.5 rounded pointer-events-none">
                  {planeInfo.markers.right}
                </div>

                {/* PACS Top-Left Overlay */}
                <div className="absolute top-2 left-2 pointer-events-none text-[11px] font-mono text-emerald-400/90 drop-shadow-md leading-tight">
                  <div className="font-bold">{planeInfo.name}</div>
                  <div className="text-slate-400 text-[10px]">{metadata.patientName || 'ANON-BME360'}</div>
                  <div className="text-slate-400 text-[10px]">{metadata.patientId || 'ID-001'}</div>
                </div>

                {/* PACS Top-Right Overlay */}
                <div className="absolute top-2 right-2 pointer-events-none text-right text-[11px] font-mono text-emerald-400/90 drop-shadow-md leading-tight">
                  <div>{metadata.modality}</div>
                  <div className="text-slate-400 text-[10px]">Cut: {planeInfo.cutDirection}</div>
                </div>

                {/* PACS Bottom-Left Overlay */}
                <div className="absolute bottom-2 left-2 pointer-events-none text-[11px] font-mono text-emerald-400/90 drop-shadow-md leading-tight">
                  <div>WC: {wc} / WW: {ww}</div>
                  {probe && (
                    <div className="text-sky-300 text-[10px]">
                      X:{probe.x} Y:{probe.y} Val:{probe.val.toFixed(1)} {metadata.modality === 'CT' ? 'HU' : ''}
                    </div>
                  )}
                </div>

                {/* PACS Bottom-Right Overlay */}
                <div className="absolute bottom-2 right-2 pointer-events-none text-right text-[11px] font-mono text-emerald-400/90 drop-shadow-md leading-tight">
                  <div className="text-white font-bold text-xs">
                    {planeInfo.short} {activeIdx + 1} / {totalSlices}
                  </div>
                  {activeSlice?.sliceLocation !== undefined && (
                    <div className="text-amber-300 text-[10px]">
                      {planeInfo.axis}: {activeSlice.sliceLocation > 0 ? `+${activeSlice.sliceLocation}` : activeSlice.sliceLocation} mm
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* LAYOUT B: TRI-PLANAR (MPR 3-VIEW) */}
            {viewLayout === 'mpr_tri' && (
              <div className="w-full h-full grid grid-cols-1 md:grid-cols-3 gap-3 p-1">
                {/* 1. Axial Viewport */}
                <div className="flex flex-col bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-lg relative">
                  <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs">
                    <span className="font-bold text-sky-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-sky-400" />
                      <span>Axial (XY)</span>
                    </span>
                    <span className="font-mono text-slate-400 text-[11px]">
                      #{axialIdx + 1}/{axialSlices.length}
                    </span>
                  </div>

                  <div className="flex-1 relative flex items-center justify-center p-2 bg-black min-h-[160px]">
                    <canvas
                      ref={triAxialCanvasRef}
                      onClick={handleTriAxialClick}
                      className="max-h-[36vh] w-auto aspect-square object-contain cursor-crosshair border border-slate-900 rounded"
                    />
                    <div className="absolute top-1 left-2 text-[10px] font-bold text-sky-400/80 pointer-events-none">A</div>
                    <div className="absolute bottom-1 left-2 text-[10px] font-bold text-sky-400/80 pointer-events-none">P</div>
                    <div className="absolute left-1 top-1/2 text-[10px] font-bold text-sky-400/80 pointer-events-none">R</div>
                    <div className="absolute right-1 top-1/2 text-[10px] font-bold text-sky-400/80 pointer-events-none">L</div>
                  </div>

                  <div className="p-2 bg-slate-900/90 border-t border-slate-800 flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={axialSlices.length - 1}
                      value={axialIdx}
                      onChange={(e) => setAxialIdx(parseInt(e.target.value, 10))}
                      className="w-full h-1.5 bg-slate-800 rounded appearance-none accent-sky-500 cursor-pointer"
                    />
                    <button
                      onClick={() => {
                        setActivePlane('axial');
                        setViewLayout('single');
                      }}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 shrink-0 font-medium"
                    >
                      Focus
                    </button>
                  </div>
                </div>

                {/* 2. Coronal Viewport */}
                <div className="flex flex-col bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-lg relative">
                  <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>Coronal (XZ)</span>
                    </span>
                    <span className="font-mono text-slate-400 text-[11px]">
                      #{coronalIdx + 1}/{coronalSlices.length}
                    </span>
                  </div>

                  <div className="flex-1 relative flex items-center justify-center p-2 bg-black min-h-[160px]">
                    <canvas
                      ref={triCoronalCanvasRef}
                      onClick={handleTriCoronalClick}
                      className="max-h-[36vh] w-auto aspect-square object-contain cursor-crosshair border border-slate-900 rounded"
                    />
                    <div className="absolute top-1 left-2 text-[10px] font-bold text-emerald-400/80 pointer-events-none">S</div>
                    <div className="absolute bottom-1 left-2 text-[10px] font-bold text-emerald-400/80 pointer-events-none">I</div>
                    <div className="absolute left-1 top-1/2 text-[10px] font-bold text-emerald-400/80 pointer-events-none">R</div>
                    <div className="absolute right-1 top-1/2 text-[10px] font-bold text-emerald-400/80 pointer-events-none">L</div>
                  </div>

                  <div className="p-2 bg-slate-900/90 border-t border-slate-800 flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={coronalSlices.length - 1}
                      value={coronalIdx}
                      onChange={(e) => setCoronalIdx(parseInt(e.target.value, 10))}
                      className="w-full h-1.5 bg-slate-800 rounded appearance-none accent-emerald-500 cursor-pointer"
                    />
                    <button
                      onClick={() => {
                        setActivePlane('coronal');
                        setViewLayout('single');
                      }}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 shrink-0 font-medium"
                    >
                      Focus
                    </button>
                  </div>
                </div>

                {/* 3. Sagittal Viewport */}
                <div className="flex flex-col bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-lg relative">
                  <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs">
                    <span className="font-bold text-amber-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      <span>Sagittal (YZ)</span>
                    </span>
                    <span className="font-mono text-slate-400 text-[11px]">
                      #{sagittalIdx + 1}/{sagittalSlices.length}
                    </span>
                  </div>

                  <div className="flex-1 relative flex items-center justify-center p-2 bg-black min-h-[160px]">
                    <canvas
                      ref={triSagittalCanvasRef}
                      onClick={handleTriSagittalClick}
                      className="max-h-[36vh] w-auto aspect-square object-contain cursor-crosshair border border-slate-900 rounded"
                    />
                    <div className="absolute top-1 left-2 text-[10px] font-bold text-amber-400/80 pointer-events-none">S</div>
                    <div className="absolute bottom-1 left-2 text-[10px] font-bold text-amber-400/80 pointer-events-none">I</div>
                    <div className="absolute left-1 top-1/2 text-[10px] font-bold text-amber-400/80 pointer-events-none">A</div>
                    <div className="absolute right-1 top-1/2 text-[10px] font-bold text-amber-400/80 pointer-events-none">P</div>
                  </div>

                  <div className="p-2 bg-slate-900/90 border-t border-slate-800 flex items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={sagittalSlices.length - 1}
                      value={sagittalIdx}
                      onChange={(e) => setSagittalIdx(parseInt(e.target.value, 10))}
                      className="w-full h-1.5 bg-slate-800 rounded appearance-none accent-amber-500 cursor-pointer"
                    />
                    <button
                      onClick={() => {
                        setActivePlane('sagittal');
                        setViewLayout('single');
                      }}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 shrink-0 font-medium"
                    >
                      Focus
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Wheel Scroll Hint */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-slate-900/90 border border-slate-800 text-slate-400 text-[10px] px-3 py-1 rounded-full pointer-events-none backdrop-blur-sm flex items-center gap-1.5 shadow-lg">
              <Move className="w-3 h-3 text-sky-400" />
              <span>
                {viewLayout === 'single'
                  ? `Scroll wheel to browse ${planeInfo.short} slices`
                  : 'Click crosshairs in any view to synchronize 3D position'}
              </span>
            </div>
          </div>

          {/* Right Sidebar Controls */}
          <div className="w-full md:w-72 bg-slate-900/70 border-t md:border-t-0 md:border-l border-slate-800 p-4 space-y-4 overflow-y-auto">
            {/* Slice Navigation Panel */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-sky-400" />
                  <span>{planeInfo.short} Position</span>
                </span>
                <span className="font-mono text-sky-400 font-bold">
                  {activeIdx + 1} / {totalSlices}
                </span>
              </div>

              {/* Slider */}
              <input
                type="range"
                min={0}
                max={totalSlices - 1}
                value={activeIdx}
                onChange={(e) => {
                  setIsPlaying(false);
                  setActiveIdxForCurrentPlane(parseInt(e.target.value, 10));
                }}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
              />

              {/* Step & Cine Buttons */}
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                <button
                  onClick={() => {
                    setIsPlaying(false);
                    setActiveIdxForCurrentPlane((prev) => (prev <= 0 ? totalSlices - 1 : prev - 1));
                  }}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer"
                  title="Previous Slice"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className={`col-span-2 p-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition cursor-pointer border ${
                    isPlaying
                      ? 'bg-amber-600/30 text-amber-300 border-amber-500/50'
                      : 'bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border-sky-500/40'
                  }`}
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isPlaying ? 'Pause' : 'Cine Loop'}</span>
                </button>

                <button
                  onClick={() => {
                    setIsPlaying(false);
                    setActiveIdxForCurrentPlane((prev) => (prev + 1) % totalSlices);
                  }}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer"
                  title="Next Slice"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Cine Speed */}
              {isPlaying && (
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                  <span>Playback Speed:</span>
                  <div className="flex items-center gap-1">
                    {[5, 12, 20, 30].map((s) => (
                      <button
                        key={s}
                        onClick={() => setFps(s)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer ${
                          fps === s ? 'bg-amber-500 text-black font-bold' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {s}fps
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Viewport Mouse Action */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 block">Viewport Mouse Action</label>
              <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                <button
                  onClick={() => setMouseTool('scroll')}
                  className={`py-1.5 rounded-lg font-medium flex items-center justify-center gap-1 transition cursor-pointer ${
                    mouseTool === 'scroll' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Move className="w-3 h-3" />
                  <span>Scroll Slices</span>
                </button>
                <button
                  onClick={() => setMouseTool('window')}
                  className={`py-1.5 rounded-lg font-medium flex items-center justify-center gap-1 transition cursor-pointer ${
                    mouseTool === 'window' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sliders className="w-3 h-3" />
                  <span>Drag W / L</span>
                </button>
              </div>
            </div>

            {/* Window Presets */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 block">Window / Level Presets</label>
              <div className="grid grid-cols-2 gap-1">
                {WINDOW_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => {
                      setWc(preset.wc);
                      setWw(preset.ww);
                    }}
                    className={`px-2 py-1.5 rounded-lg text-[11px] text-left transition cursor-pointer border truncate ${
                      wc === preset.wc && ww === preset.ww
                        ? 'bg-sky-600/30 text-sky-200 border-sky-500/50 font-semibold'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                    }`}
                    title={`${preset.name} (WC: ${preset.wc}, WW: ${preset.ww})`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Anatomical Plane Information Card */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] space-y-1.5 text-slate-300">
              <span className="font-semibold text-white block text-xs pb-1 border-b border-slate-800 flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-sky-400" />
                <span>Anatomical Plane Guide</span>
              </span>
              <div className="flex justify-between">
                <span className="text-slate-500">Active View:</span>
                <span className="font-bold text-sky-400">{planeInfo.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cut Axis:</span>
                <span className="font-mono text-emerald-400">{planeInfo.axis} axis</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cut Direction:</span>
                <span className="font-mono text-slate-300">{planeInfo.cutDirection}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Position ({planeInfo.axis}):</span>
                <span className="font-mono text-amber-300">
                  {activeSlice?.sliceLocation !== undefined ? `${activeSlice.sliceLocation} mm` : 'N/A'}
                </span>
              </div>
            </div>

            {/* Action CTA */}
            <button
              onClick={() => handleSelectAndClose()}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-sky-950 transition cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Select {planeInfo.short} #{activeIdx + 1} for Analysis</span>
            </button>
          </div>
        </div>

        {/* Bottom Filmstrip Carousel */}
        <div className="border-t border-slate-800 bg-slate-900/90 p-2.5 flex items-center gap-2 overflow-hidden">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 hidden sm:inline">
            {planeInfo.short} Slices:
          </span>

          <div
            ref={filmstripRef}
            className="flex-1 flex items-center gap-2 overflow-x-auto py-1 px-1 scrollbar-thin scrollbar-thumb-slate-700"
          >
            {currentPlaneSlices.map((slice, idx) => (
              <button
                key={`${activePlane}-${slice.index}`}
                onClick={() => {
                  setIsPlaying(false);
                  setActiveIdxForCurrentPlane(idx);
                }}
                className={`shrink-0 flex flex-col items-center p-1 rounded-lg border transition cursor-pointer ${
                  activeIdx === idx
                    ? 'bg-sky-600/30 border-sky-400 shadow-md shadow-sky-950 scale-105'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="w-12 h-12 rounded bg-slate-900 flex items-center justify-center text-[10px] font-mono text-slate-400 overflow-hidden border border-slate-800">
                  <span className="font-bold text-slate-200">#{idx + 1}</span>
                </div>
                <span
                  className={`text-[9px] mt-1 font-mono ${
                    activeIdx === idx ? 'text-sky-300 font-bold' : 'text-slate-400'
                  }`}
                >
                  {slice.sliceLocation !== undefined ? `${slice.sliceLocation}mm` : `#${idx + 1}`}
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => handleSelectAndClose()}
            className="sm:hidden shrink-0 bg-sky-600 text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold"
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
};
