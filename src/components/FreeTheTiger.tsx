import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { Sparkles, CheckCircle2, RotateCcw, ArrowRight, ShieldCheck, Zap } from 'lucide-react';
import { FourierLab } from './FourierLab';
import { FilterSettings } from '../types';
import { generateSyntheticDataset } from '../utils/dicom';

interface FreeTheTigerProps {
  imageSize: number;
}

export const FreeTheTiger: React.FC<FreeTheTigerProps> = ({ imageSize }) => {
  const [tigerDataset] = useState(() => generateSyntheticDataset('tiger', imageSize));
  const [filterSettings, setFilterSettings] = useState<FilterSettings>({
    type: 'notch',
    shape: 'butterworth',
    cutoff: 30,
    butterworthOrder: 2,
    notches: [],
    invert: false,
  });

  const [customMask, setCustomMask] = useState<Float32Array>(
    () => new Float32Array(imageSize * imageSize).fill(1.0)
  );

  const [missionStep, setMissionStep] = useState<number>(1);
  const [isFreed, setIsFreed] = useState<boolean>(false);

  // Check if all primary cage harmonics are notched or suppressed
  useEffect(() => {
    if (!tigerDataset.harmonics) return;
    const center = imageSize / 2;
    let suppressedCount = 0;

    for (const h of tigerDataset.harmonics) {
      const idx = (center + h.v) * imageSize + (center + h.u);
      // check if suppressed in customMask OR in filterSettings.notches
      const isCustomSuppressed = customMask[idx] < 0.2;
      const isNotchSuppressed = filterSettings.notches.some(
        (n) => Math.hypot(n.u - h.u, n.v - h.v) <= n.radius + 3
      );

      if (isCustomSuppressed || isNotchSuppressed) {
        suppressedCount++;
      }
    }

    if (suppressedCount >= 4 && !isFreed) {
      setIsFreed(true);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    } else if (suppressedCount < 4 && isFreed) {
      setIsFreed(false);
    }
  }, [customMask, filterSettings.notches, tigerDataset.harmonics, imageSize, isFreed]);

  const handleAutoFreeTiger = () => {
    // Automatically apply notch filters to the periodic cage harmonics
    if (!tigerDataset.harmonics) return;
    const notches = tigerDataset.harmonics.slice(0, 4).map((h, i) => ({
      id: `auto-notch-${i}`,
      u: Math.abs(h.u),
      v: h.v,
      radius: 6,
    }));

    setFilterSettings({
      ...filterSettings,
      type: 'notch',
      shape: 'butterworth',
      butterworthOrder: 2,
      notches,
    });

    setMissionStep(4);
    setIsFreed(true);
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.5 },
    });
  };

  const handleResetChallenge = () => {
    setFilterSettings({
      type: 'notch',
      shape: 'butterworth',
      cutoff: 30,
      butterworthOrder: 2,
      notches: [],
      invert: false,
    });
    setCustomMask(new Float32Array(imageSize * imageSize).fill(1.0));
    setMissionStep(1);
    setIsFreed(false);
  };

  return (
    <div className="space-y-6">
      {/* Banner & Challenge Mission Brief */}
      <div className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-slate-900 border border-amber-500/40 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl p-2.5 bg-amber-500/20 border border-amber-500/30 rounded-2xl">
              🐯
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">
                  Classic Bioimaging Challenge: "Free the Tiger!"
                </h2>
                {isFreed && (
                  <span className="flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full text-xs font-semibold animate-pulse">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Tiger Freed!
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                A periodic steel cage traps the tiger. Because the bars repeat periodically in space, their Fourier transform concentrates into distinct harmonic spikes along the horizontal frequency axis.
                <strong> Delete those frequencies to remove the cage bars without damaging the tiger!</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-center">
            <button
              id="auto-free-tiger-btn"
              onClick={handleAutoFreeTiger}
              className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs shadow-md transition"
            >
              <Zap className="w-4 h-4" />
              <span>Auto-Notch Harmonics</span>
            </button>
            <button
              onClick={handleResetChallenge}
              className="p-2 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl border border-slate-700 transition"
              title="Reset Tiger Challenge"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Guided Steps Progression */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 mt-4 pt-4 border-t border-slate-800 text-xs">
          <div className={`p-2.5 rounded-xl border ${missionStep === 1 ? 'bg-slate-800 border-amber-500/60 text-white font-medium' : 'bg-slate-950/60 border-slate-800/80 text-slate-400'}`}>
            <span className="text-[10px] font-bold text-amber-400 block mb-1">STEP 1</span>
            Observe the periodic vertical cage bars (period T = 16px).
          </div>
          <div className={`p-2.5 rounded-xl border ${missionStep === 2 ? 'bg-slate-800 border-amber-500/60 text-white font-medium' : 'bg-slate-950/60 border-slate-800/80 text-slate-400'}`}>
            <span className="text-[10px] font-bold text-amber-400 block mb-1">STEP 2</span>
            Locate yellow harmonic circles at u = ±16 and ±32 in k-space.
          </div>
          <div className={`p-2.5 rounded-xl border ${missionStep === 3 ? 'bg-slate-800 border-amber-500/60 text-white font-medium' : 'bg-slate-950/60 border-slate-800/80 text-slate-400'}`}>
            <span className="text-[10px] font-bold text-amber-400 block mb-1">STEP 3</span>
            Click on the spikes with the Notch tool or Brush them out.
          </div>
          <div className={`p-2.5 rounded-xl border ${isFreed ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 font-bold' : 'bg-slate-950/60 border-slate-800/80 text-slate-400'}`}>
            <span className="text-[10px] font-bold text-emerald-400 block mb-1">STEP 4</span>
            Inverse FFT: Cage is filtered out; the tiger is free!
          </div>
        </div>
      </div>

      {/* Interactive Fourier Lab with Tiger Dataset */}
      <FourierLab
        originalImageBytes={new Uint8ClampedArray(tigerDataset.pixelData)}
        imageSize={imageSize}
        filterSettings={filterSettings}
        onFilterChange={setFilterSettings}
        customMask={customMask}
        onCustomMaskChange={setCustomMask}
        activeNotchHarmonics={tigerDataset.harmonics}
      />
    </div>
  );
};
