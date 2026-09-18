import React, { useState, useEffect, useRef } from 'react';
import { DicomSlice, AnatomicalPlane } from '../types';
import { ANATOMICAL_PLANES } from '../utils/mpr';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Maximize2,
  Layers,
  FastForward,
  Compass,
} from 'lucide-react';

interface DicomSliceNavigatorProps {
  slices: DicomSlice[];
  currentSliceIndex: number;
  onSelectSlice: (index: number) => void;
  onOpenDicomViewer?: () => void;
  activePlane?: AnatomicalPlane;
  onChangePlane?: (plane: AnatomicalPlane) => void;
  showPlaneSelector?: boolean;
  className?: string;
  variant?: 'inline' | 'compact';
}

export const DicomSliceNavigator: React.FC<DicomSliceNavigatorProps> = ({
  slices,
  currentSliceIndex,
  onSelectSlice,
  onOpenDicomViewer,
  activePlane = 'axial',
  onChangePlane,
  showPlaneSelector = false,
  className = '',
  variant = 'inline',
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState<number>(10);
  const animFrameRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const totalSlices = slices.length;
  const currentSlice = slices[currentSliceIndex] || slices[0];
  const planeInfo = ANATOMICAL_PLANES[activePlane];

  // Axis dimension prefix (Z for axial, Y for coronal, X for sagittal)
  const axisPrefix = planeInfo.axis;

  // Cine playback loop
  useEffect(() => {
    if (!isPlaying || totalSlices <= 1) return;

    const intervalMs = 1000 / fps;
    const loop = (timestamp: number) => {
      if (timestamp - lastTickRef.current >= intervalMs) {
        lastTickRef.current = timestamp;
        onSelectSlice((currentSliceIndex + 1) % totalSlices);
      }
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPlaying, fps, currentSliceIndex, totalSlices, onSelectSlice]);

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPlaying(false);
    const prev = currentSliceIndex <= 0 ? totalSlices - 1 : currentSliceIndex - 1;
    onSelectSlice(prev);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPlaying(false);
    const next = (currentSliceIndex + 1) % totalSlices;
    onSelectSlice(next);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false);
    onSelectSlice(parseInt(e.target.value, 10));
  };

  // Mouse wheel scrolling on the navigator bar
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setIsPlaying(false);
    if (e.deltaY > 0) {
      // scroll down -> next slice
      onSelectSlice(Math.min(totalSlices - 1, currentSliceIndex + 1));
    } else if (e.deltaY < 0) {
      // scroll up -> prev slice
      onSelectSlice(Math.max(0, currentSliceIndex - 1));
    }
  };

  if (totalSlices <= 1 && !showPlaneSelector) {
    return null;
  }

  return (
    <div
      onWheel={handleWheel}
      className={`bg-slate-900/90 backdrop-blur-sm border border-slate-800 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-3 shadow-md ${className}`}
    >
      {/* Plane Selector Toggle Buttons (Axial, Coronal, Sagittal) */}
      {showPlaneSelector && onChangePlane && (
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 px-1.5 border-r border-slate-800 hidden sm:flex">
            <Compass className="w-3.5 h-3.5 text-sky-400" />
            <span>View:</span>
          </div>
          {(['axial', 'coronal', 'sagittal'] as AnatomicalPlane[]).map((p) => {
            const isActive = activePlane === p;
            return (
              <button
                key={p}
                onClick={() => {
                  setIsPlaying(false);
                  onChangePlane(p);
                }}
                className={`px-2 py-1 rounded text-xs font-semibold capitalize transition cursor-pointer ${
                  isActive
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
                title={`Switch to ${ANATOMICAL_PLANES[p].name}`}
              >
                {p}
              </button>
            );
          })}
        </div>
      )}

      {/* Slice Info & Step buttons */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-slate-950/80 px-2 py-1 rounded-lg border border-slate-800/80 text-xs">
          <Layers className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="font-semibold text-white">
            {planeInfo.short} {currentSliceIndex + 1}
          </span>
          <span className="text-slate-500">/ {totalSlices}</span>
          {currentSlice?.sliceLocation !== undefined && (
            <span className="text-slate-400 font-mono text-[11px] ml-1 pl-1 border-l border-slate-800">
              {axisPrefix}: {currentSlice.sliceLocation > 0 ? `+${currentSlice.sliceLocation}` : currentSlice.sliceLocation} mm
            </span>
          )}
        </div>

        {/* Prev / Next buttons */}
        <div className="flex items-center gap-0.5 bg-slate-950 rounded-lg p-0.5 border border-slate-800">
          <button
            onClick={handlePrev}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Previous slice (Wheel Up / Left Arrow)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleNext}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Next slice (Wheel Down / Right Arrow)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Cine Play/Pause */}
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition cursor-pointer border ${
            isPlaying
              ? 'bg-amber-600/30 text-amber-300 border-amber-500/50'
              : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border-slate-700'
          }`}
          title={isPlaying ? 'Pause Cine' : 'Play Cine Loop'}
        >
          {isPlaying ? <Pause className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-sky-400" />}
          <span className="hidden sm:inline">{isPlaying ? 'Pause' : 'Cine'}</span>
        </button>

        {isPlaying && (
          <div className="flex items-center gap-1 text-[11px] text-slate-400">
            <span className="text-[10px] font-mono text-amber-400">{fps} fps</span>
            <button
              onClick={() => setFps(fps === 10 ? 20 : fps === 20 ? 30 : 10)}
              className="p-0.5 hover:text-white text-slate-500 transition cursor-pointer"
              title="Change Cine Speed"
            >
              <FastForward className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Scrub Slider */}
      <div className="flex-1 min-w-[140px] max-w-xs sm:max-w-md flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={totalSlices - 1}
          value={currentSliceIndex}
          onChange={handleSliderChange}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500 focus:outline-hidden"
          title={`Scrub through ${planeInfo.name} slices`}
        />
      </div>

      {/* Full DICOM Viewer Button */}
      {onOpenDicomViewer && (
        <button
          onClick={onOpenDicomViewer}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 text-xs font-medium transition cursor-pointer shadow-xs"
          title="Open Clinical DICOM Series Viewer with Multi-Planar (Axial, Coronal, Sagittal) Reconstruction"
        >
          <Maximize2 className="w-3 h-3 text-sky-400" />
          <span className="hidden sm:inline">MPR Viewer</span>
        </button>
      )}
    </div>
  );
};
