import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  RotateCw,
  X,
  Check,
  Zap,
  ZapOff,
  AlertCircle,
  Upload,
  RefreshCw,
  Image as ImageIcon,
  Sparkles,
} from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCapture,
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'color' | 'grayscale'>('grayscale');
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  // Stop current active media stream tracks
  const stopStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }, [stream]);

  // Start media stream with current facingMode
  const startCamera = useCallback(async () => {
    stopStream();
    setCameraError(null);
    setIsTorchOn(false);
    setHasTorch(false);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API (getUserMedia) is not supported in this browser environment.');
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1080 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      setStream(mediaStream);

      // Check for torch capability
      const videoTrack = mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities: any = typeof videoTrack.getCapabilities === 'function' ? videoTrack.getCapabilities() : {};
        if (capabilities.torch) {
          setHasTorch(true);
        }
      }
    } catch (err: any) {
      console.warn('Camera stream error:', err);
      let msg = 'Could not access device camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission was denied. You can use the device photo selector below or enable camera access in browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No camera device found on this device.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg = 'Camera is currently in use by another application.';
      } else if (err.message) {
        msg = err.message;
      }
      setCameraError(msg);
    }
  }, [facingMode, stopStream]);

  // Connect stream to video element when stream or videoRef updates
  useEffect(() => {
    if (isOpen && !capturedBlob) {
      startCamera();
    }
    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, capturedBlob]);

  // Attach stream to video tag
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch((e) => console.debug('Video play caught:', e));
    }
  }, [stream]);

  // Toggle Torch/Flash
  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    try {
      const nextTorch = !isTorchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextTorch }],
      });
      setIsTorchOn(nextTorch);
    } catch (err) {
      console.error('Failed to toggle torch:', err);
    }
  };

  // Switch between front and rear cameras
  const toggleCameraFacing = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Capture current frame from video stream with square center crop
  const takeSnapshot = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    // Trigger visual shutter flash
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 200);

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropSize = Math.min(vw, vh);
    const startX = (vw - cropSize) / 2;
    const startY = (vh - cropSize) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle user/front camera horizontal flip
    if (facingMode === 'user') {
      ctx.translate(512, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, startX, startY, cropSize, cropSize, 0, 0, 512, 512);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        setCapturedBlob(blob);
        setCapturedDataUrl(url);
        stopStream();
      },
      'image/jpeg',
      0.92
    );
  };

  // Retake photo
  const handleRetake = () => {
    if (capturedDataUrl) {
      URL.revokeObjectURL(capturedDataUrl);
    }
    setCapturedBlob(null);
    setCapturedDataUrl(null);
  };

  // Confirm photo upload
  const handleConfirm = () => {
    if (!capturedBlob) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = new File([capturedBlob], `camera-capture-${timestamp}.jpg`, {
      type: 'image/jpeg',
    });
    onCapture(file);
    handleClose();
  };

  // Handle native device file input fallback (e.g. mobile camera prompt)
  const handleFallbackFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onCapture(file);
      handleClose();
    }
  };

  const handleClose = () => {
    stopStream();
    if (capturedDataUrl) {
      URL.revokeObjectURL(capturedDataUrl);
    }
    setCapturedBlob(null);
    setCapturedDataUrl(null);
    setCameraError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      id="camera-capture-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md transition-opacity"
    >
      <div
        id="camera-capture-modal"
        className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]"
      >
        {/* Shutter Flash effect */}
        {isFlashing && (
          <div className="absolute inset-0 bg-white/90 z-50 pointer-events-none transition-opacity duration-200" />
        )}

        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-600/20 text-sky-400 border border-sky-500/30 flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">
                {capturedBlob ? 'Review Bioimaging Photo' : 'Device Camera Capture'}
              </h2>
              <p className="text-[11px] text-slate-400">
                {capturedBlob
                  ? 'Inspect framed image for 2D Fourier & Segmentation'
                  : 'Square framing optimized for 256×256 2D FFT'}
              </p>
            </div>
          </div>

          <button
            id="close-camera-modal-btn"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Close camera"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Viewfinder / Capture Review Body */}
        <div className="p-4 flex flex-col items-center justify-center bg-slate-950 flex-1 min-h-[340px] relative overflow-hidden">
          {cameraError && !capturedBlob ? (
            /* Error & Fallback View */
            <div className="w-full max-w-md p-5 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-rose-950/50 border border-rose-800/80 text-rose-400 mx-auto flex items-center justify-center">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-200">Camera Access Notice</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{cameraError}</p>
              </div>

              {/* Native device camera prompt fallback */}
              <div className="pt-2 flex flex-col gap-2">
                <input
                  ref={fallbackInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFallbackFileChange}
                  className="hidden"
                />
                <button
                  id="device-camera-fallback-btn"
                  onClick={() => fallbackInputRef.current?.click()}
                  className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Take Picture Using Device Camera App</span>
                </button>
                <button
                  onClick={startCamera}
                  className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Live Stream</span>
                </button>
              </div>
            </div>
          ) : capturedBlob && capturedDataUrl ? (
            /* Photo Review Mode */
            <div className="relative w-full max-w-[340px] aspect-square rounded-xl overflow-hidden border border-slate-700 bg-slate-900 shadow-xl flex items-center justify-center">
              <img
                src={capturedDataUrl}
                alt="Captured sample"
                className={`w-full h-full object-cover transition-all ${
                  previewMode === 'grayscale' ? 'filter grayscale contrast-110' : ''
                }`}
              />

              {/* Grayscale vs Color Preview Toggle Pill */}
              <div className="absolute top-2.5 right-2.5 flex items-center bg-slate-950/80 backdrop-blur-md rounded-lg p-0.5 border border-slate-700 text-[10px] font-medium shadow-md">
                <button
                  type="button"
                  onClick={() => setPreviewMode('grayscale')}
                  className={`px-2 py-1 rounded transition ${
                    previewMode === 'grayscale'
                      ? 'bg-sky-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Grayscale (FFT)
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('color')}
                  className={`px-2 py-1 rounded transition ${
                    previewMode === 'color'
                      ? 'bg-sky-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Original
                </button>
              </div>

              {/* Bioimaging 256x256 Badge */}
              <div className="absolute bottom-2.5 left-2.5 bg-slate-950/85 backdrop-blur-md px-2 py-1 rounded border border-slate-700 text-[10px] font-mono text-sky-400 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-sky-400" />
                <span>256×256 Bioimaging Matrix</span>
              </div>
            </div>
          ) : (
            /* Live Camera Viewfinder Mode */
            <div className="relative w-full max-w-[340px] aspect-square rounded-xl overflow-hidden border border-slate-700 bg-black shadow-inner flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover ${
                  facingMode === 'user' ? 'scale-x-[-1]' : ''
                }`}
              />

              {/* Square Bioimaging Reticle Overlay */}
              <div className="absolute inset-0 pointer-events-none border-2 border-sky-400/40 rounded-xl">
                {/* Rule of thirds grid lines */}
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-sky-400/20" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-sky-400/20" />
                <div className="absolute top-1/3 left-0 right-0 h-px bg-sky-400/20" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-sky-400/20" />

                {/* Center crosshair for DC component alignment */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 pointer-events-none">
                  <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-sky-400/80 -translate-y-1/2" />
                  <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-sky-400/80 -translate-x-1/2" />
                  <div className="w-2.5 h-2.5 rounded-full border border-sky-300 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>

                {/* Reticle corner accents */}
                <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-sky-400" />
                <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-sky-400" />
                <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-sky-400" />
                <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-sky-400" />
              </div>

              {/* Viewfinder Top Badges */}
              <div className="absolute top-2.5 left-2.5 flex items-center gap-2">
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[10px] font-mono text-emerald-400 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
                <span className="text-[10px] font-mono text-slate-300 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md border border-slate-700">
                  {facingMode === 'environment' ? 'Rear Cam' : 'Front Cam'}
                </span>
              </div>

              {/* Viewfinder Top Controls (Torch & Camera Switch) */}
              <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                {hasTorch && (
                  <button
                    type="button"
                    onClick={toggleTorch}
                    className={`p-2 rounded-lg backdrop-blur-md border transition cursor-pointer ${
                      isTorchOn
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-black/60 text-slate-300 border-slate-700 hover:text-white'
                    }`}
                    title={isTorchOn ? 'Turn Flashlight Off' : 'Turn Flashlight On'}
                  >
                    {isTorchOn ? <Zap className="w-3.5 h-3.5" /> : <ZapOff className="w-3.5 h-3.5" />}
                  </button>
                )}

                <button
                  type="button"
                  id="switch-camera-facing-btn"
                  onClick={toggleCameraFacing}
                  className="p-2 rounded-lg bg-black/60 text-slate-300 hover:text-white backdrop-blur-md border border-slate-700 hover:bg-slate-800 transition cursor-pointer"
                  title="Switch Front/Rear Camera"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Reticle Guide Text */}
              <div className="absolute bottom-2 inset-x-2 text-center pointer-events-none">
                <span className="text-[10px] text-sky-200/90 font-medium bg-slate-950/80 px-2.5 py-0.5 rounded-full border border-sky-500/30 backdrop-blur-sm">
                  Center specimen or pattern in reticle
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-4 py-3.5 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-3">
          {capturedBlob ? (
            /* Review Actions */
            <div className="flex items-center justify-between w-full gap-3">
              <button
                id="camera-retake-btn"
                type="button"
                onClick={handleRetake}
                className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retake Photo</span>
              </button>

              <button
                id="camera-confirm-btn"
                type="button"
                onClick={handleConfirm}
                className="flex-1 py-2.5 px-4 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Upload & Analyze</span>
              </button>
            </div>
          ) : (
            /* Live Capture Controls */
            <div className="flex items-center justify-between w-full gap-2">
              {/* Native device camera prompt link / file picker */}
              <input
                ref={fallbackInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFallbackFileChange}
                className="hidden"
              />
              <button
                id="native-camera-fallback-btn"
                type="button"
                onClick={() => fallbackInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
                title="Use system camera app directly or choose photo"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">System Camera / Library</span>
              </button>

              {/* Shutter Button */}
              <div className="flex items-center justify-center flex-1">
                <button
                  id="camera-shutter-btn"
                  type="button"
                  onClick={takeSnapshot}
                  disabled={!stream || !!cameraError}
                  className={`w-14 h-14 rounded-full border-4 flex items-center justify-center transition-all shadow-lg cursor-pointer ${
                    !stream || cameraError
                      ? 'border-slate-700 bg-slate-800 text-slate-600 cursor-not-allowed'
                      : 'border-white bg-sky-500 hover:bg-sky-400 text-white active:scale-95 ring-4 ring-sky-500/30'
                  }`}
                  title="Snap Photo"
                >
                  <div className="w-5 h-5 rounded-full bg-white" />
                </button>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
