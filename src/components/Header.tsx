import React, { useRef } from 'react';
import {
  Upload,
  Brain,
  Activity,
  FileCode,
  Sparkles,
  Layers,
  RotateCcw,
  Camera,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface HeaderProps {
  currentTab: 'fourier' | 'tiger' | 'segmentation';
  onTabChange: (tab: 'fourier' | 'tiger' | 'segmentation') => void;
  onPresetSelect: (preset: 'tiger' | 'mri' | 'ct' | 'pet' | 'joint') => void;
  onFileUpload: (file: File | File[]) => void;
  onOpenCamera: () => void;
  onOpenAITutor: () => void;
  onReset: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onTabChange,
  onPresetSelect,
  onFileUpload,
  onOpenCamera,
  onOpenAITutor,
  onReset,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      const filesArray = Array.from(fileList);
      onFileUpload(filesArray.length === 1 ? filesArray[0] : filesArray);
    }
    if (e.target) {
      e.target.value = '';
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 text-white px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Brand & Course Title */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-md shadow-sky-950 border border-sky-400/30">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-widest text-sky-400 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/60">
                  BME 360
                </span>
                <h1 className="text-sm sm:text-base font-bold text-slate-100 tracking-tight">
                  Bioimaging Fourier & DICOM Studio
                </h1>
              </div>
              <p className="text-[11px] text-slate-400">
                2D k-Space Filtering • Inverse FFT • Medical Segmentation
              </p>
            </div>
          </div>

          {/* Mobile Actions */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              id="mobile-open-camera-btn"
              onClick={onOpenCamera}
              className="p-2 rounded-lg bg-sky-600/20 text-sky-400 border border-sky-500/40 hover:bg-sky-600/30 transition"
              title="Take Photo with Device Camera"
            >
              <Camera className="w-4 h-4" />
            </button>
            <PWAInstallButton />
            <button
              onClick={onOpenAITutor}
              className="p-2 rounded-lg bg-sky-600/20 text-sky-400 border border-sky-500/40"
              title="AI Tutor"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Center Mode Navigation Tabs */}
        <div className="flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800 text-xs font-medium w-full md:w-auto justify-center">
          <button
            id="tab-fourier-btn"
            onClick={() => onTabChange('fourier')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              currentTab === 'fourier'
                ? 'bg-sky-600 text-white shadow-xs font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Fourier & k-Space</span>
          </button>

          <button
            id="tab-tiger-btn"
            onClick={() => onTabChange('tiger')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              currentTab === 'tiger'
                ? 'bg-amber-600 text-white shadow-xs font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span className="text-amber-400">🐯</span>
            <span>Free the Tiger</span>
          </button>

          <button
            id="tab-segmentation-btn"
            onClick={() => onTabChange('segmentation')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              currentTab === 'segmentation'
                ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>DICOM Segmentation</span>
          </button>
        </div>

        {/* Right Controls: Presets, Upload, AI Tutor, Install */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end flex-wrap sm:flex-nowrap">
          {/* Preset Selector */}
          <div className="relative">
            <select
              id="preset-selector"
              onChange={(e) => {
                const val = e.target.value as any;
                if (val) onPresetSelect(val);
              }}
              defaultValue=""
              className="bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs rounded-lg px-2.5 py-1.5 appearance-none pr-7 focus:outline-none cursor-pointer"
            >
              <option value="" disabled>
                Load Preset Case...
              </option>
              <option value="tiger">🐯 Free the Tiger (Fourier Challenge)</option>
              <option value="mri">🧠 Brain MRI (Axial T2 TSE)</option>
              <option value="ct">🫁 Chest CT (Thorax & HU Windowing)</option>
              <option value="pet">☢️ Whole Body PET (Tracer Hotspot)</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400 text-[10px]">
              ▼
            </div>
          </div>

          {/* Camera Capture Button */}
          <button
            id="open-camera-btn"
            onClick={onOpenCamera}
            className="flex items-center gap-1.5 bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
            title="Take a picture directly from device camera"
          >
            <Camera className="w-3.5 h-3.5 text-sky-400" />
            <span>Take Photo</span>
          </button>

          {/* Upload Button */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp,.dcm,.dicom"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            id="upload-image-btn"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
            title="Upload any PNG, JPG, or medical DICOM (.dcm) file"
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Upload</span>
            <span className="text-[10px] text-slate-400 font-mono hidden md:inline">(.dcm/png)</span>
          </button>

          {/* Reset Button */}
          <button
            id="reset-lab-btn"
            onClick={onReset}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-slate-200 border border-slate-700 transition"
            title="Reset Filters and Masks"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* AI Bioimaging Tutor Button */}
          <button
            id="open-ai-tutor-btn"
            onClick={onOpenAITutor}
            className="hidden md:flex items-center gap-1.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Tutor</span>
          </button>

          {/* PWA Install */}
          <div className="hidden md:block">
            <PWAInstallButton />
          </div>
        </div>
      </div>
    </header>
  );
};
