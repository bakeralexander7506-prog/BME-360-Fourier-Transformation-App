/**
 * High-performance 2D Fast Fourier Transform (Cooley-Tukey Radix-2)
 * for BME 360 Bioimaging frequency domain analysis and k-space reconstruction.
 */

import { FilterSettings, FilterShape, NotchPoint } from '../types';

export interface ComplexArray2D {
  real: Float32Array;
  imag: Float32Array;
  size: number;
}

/**
 * 1D Cooley-Tukey in-place Radix-2 FFT
 */
function fft1D(real: Float32Array, imag: Float32Array, n: number, inverse: boolean) {
  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempR = real[i];
      const tempI = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = tempR;
      imag[j] = tempI;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly computations
  const direction = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (direction * 2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wR = 1;
      let wI = 0;
      for (let k = 0; k < halfLen; k++) {
        const posEven = i + k;
        const posOdd = i + k + halfLen;

        const uR = real[posEven];
        const uI = imag[posEven];

        const vR = real[posOdd] * wR - imag[posOdd] * wI;
        const vI = real[posOdd] * wI + imag[posOdd] * wR;

        real[posEven] = uR + vR;
        imag[posEven] = uI + vI;

        real[posOdd] = uR - vR;
        imag[posOdd] = uI - vI;

        const nextWR = wR * wStepR - wI * wStepI;
        wI = wR * wStepI + wI * wStepR;
        wR = nextWR;
      }
    }
  }

  // Normalization for IFFT
  if (inverse) {
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imag[i] /= n;
    }
  }
}

/**
 * 2D Fast Fourier Transform
 */
export function fft2D(inputReal: Float32Array, size: number, inverse = false): ComplexArray2D {
  const real = new Float32Array(inputReal);
  const imag = new Float32Array(size * size);

  // 1. Transform each row
  const rowReal = new Float32Array(size);
  const rowImag = new Float32Array(size);

  for (let y = 0; y < size; y++) {
    const offset = y * size;
    for (let x = 0; x < size; x++) {
      rowReal[x] = real[offset + x];
      rowImag[x] = imag[offset + x];
    }
    fft1D(rowReal, rowImag, size, inverse);
    for (let x = 0; x < size; x++) {
      real[offset + x] = rowReal[x];
      imag[offset + x] = rowImag[x];
    }
  }

  // 2. Transform each column
  const colReal = new Float32Array(size);
  const colImag = new Float32Array(size);

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const idx = y * size + x;
      colReal[y] = real[idx];
      colImag[y] = imag[idx];
    }
    fft1D(colReal, colImag, size, inverse);
    for (let y = 0; y < size; y++) {
      const idx = y * size + x;
      real[idx] = colReal[y];
      imag[idx] = colImag[y];
    }
  }

  return { real, imag, size };
}

/**
 * 2D Inverse FFT from complex spectrum
 */
export function ifft2D(complex: ComplexArray2D): Float32Array {
  const size = complex.size;
  const real = new Float32Array(complex.real);
  const imag = new Float32Array(complex.imag);

  // Transform rows inverse
  const rowReal = new Float32Array(size);
  const rowImag = new Float32Array(size);
  for (let y = 0; y < size; y++) {
    const offset = y * size;
    for (let x = 0; x < size; x++) {
      rowReal[x] = real[offset + x];
      rowImag[x] = imag[offset + x];
    }
    fft1D(rowReal, rowImag, size, true);
    for (let x = 0; x < size; x++) {
      real[offset + x] = rowReal[x];
      imag[offset + x] = rowImag[x];
    }
  }

  // Transform cols inverse
  const colReal = new Float32Array(size);
  const colImag = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const idx = y * size + x;
      colReal[y] = real[idx];
      colImag[y] = imag[idx];
    }
    fft1D(colReal, colImag, size, true);
    for (let y = 0; y < size; y++) {
      const idx = y * size + x;
      real[idx] = colReal[y];
      imag[idx] = colImag[y];
    }
  }

  return real;
}

/**
 * Shifts the DC component (0,0) to center (size/2, size/2)
 * Or reverses the shift if called a second time (for even sizes, forward == inverse)
 */
export function fftShift2D(data: ComplexArray2D): ComplexArray2D {
  const { real, imag, size } = data;
  const half = size / 2;
  const shiftedReal = new Float32Array(size * size);
  const shiftedImag = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    const shiftedY = (y + half) % size;
    const srcRow = y * size;
    const destRow = shiftedY * size;

    for (let x = 0; x < size; x++) {
      const shiftedX = (x + half) % size;
      const srcIdx = srcRow + x;
      const destIdx = destRow + shiftedX;

      shiftedReal[destIdx] = real[srcIdx];
      shiftedImag[destIdx] = imag[srcIdx];
    }
  }

  return { real: shiftedReal, imag: shiftedImag, size };
}

/**
 * Calculates log magnitude spectrum: log(1 + |F(u,v)|)
 * Normalized to 0-255 uint8 for optimal visual dynamic range.
 */
export function computeMagnitudeSpectrum(complex: ComplexArray2D): Uint8ClampedArray {
  const { real, imag, size } = complex;
  const length = size * size;
  const rawMag = new Float32Array(length);
  let maxLog = 0;

  for (let i = 0; i < length; i++) {
    const mag = Math.hypot(real[i], imag[i]);
    const logMag = Math.log(1 + mag);
    rawMag[i] = logMag;
    if (logMag > maxLog) maxLog = logMag;
  }

  const output = new Uint8ClampedArray(length);
  const scale = maxLog > 0 ? 255 / maxLog : 1;

  for (let i = 0; i < length; i++) {
    output[i] = Math.round(rawMag[i] * scale);
  }

  return output;
}

/**
 * Calculates phase spectrum: atan2(imag, real)
 * Mapped to 0-255 uint8 (-PI to +PI -> 0 to 255)
 */
export function computePhaseSpectrum(complex: ComplexArray2D): Uint8ClampedArray {
  const { real, imag, size } = complex;
  const length = size * size;
  const output = new Uint8ClampedArray(length);

  for (let i = 0; i < length; i++) {
    const phase = Math.atan2(imag[i], real[i]); // -PI to +PI
    output[i] = Math.round(((phase + Math.PI) / (2 * Math.PI)) * 255);
  }

  return output;
}

/**
 * Computes standard 2D frequency mask H(u,v) in range [0, 1]
 * with DC centered at (size/2, size/2).
 */
export function generateFilterMask(
  size: number,
  settings: FilterSettings,
  userCustomMask?: Float32Array
): Float32Array {
  const mask = new Float32Array(size * size);
  const center = size / 2;

  if (settings.type === 'custom' && userCustomMask) {
    mask.set(userCustomMask);
    return mask;
  }

  for (let y = 0; y < size; y++) {
    const dy = y - center;
    const rowOffset = y * size;

    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const r = Math.hypot(dx, dy);
      let h = 1.0;

      if (settings.type === 'lowpass') {
        h = calcLowpass(r, settings.cutoff, settings.shape, settings.butterworthOrder);
      } else if (settings.type === 'highpass') {
        h = 1.0 - calcLowpass(r, settings.cutoff, settings.shape, settings.butterworthOrder);
      } else if (settings.type === 'bandpass') {
        const inner = settings.cutoffInner ?? 15;
        const outer = settings.cutoffOuter ?? 60;
        const lowOuter = calcLowpass(r, outer, settings.shape, settings.butterworthOrder);
        const lowInner = calcLowpass(r, inner, settings.shape, settings.butterworthOrder);
        h = Math.max(0, lowOuter - lowInner);
      } else if (settings.type === 'notch') {
        h = 1.0;
        // Evaluate all notch coordinates and their conjugate symmetries
        for (const notch of settings.notches) {
          const d1 = Math.hypot(x - (center + notch.u), y - (center + notch.v));
          const d2 = Math.hypot(x - (center - notch.u), y - (center - notch.v));
          const notchH1 = calcHighpass(d1, notch.radius, settings.shape, settings.butterworthOrder);
          const notchH2 = calcHighpass(d2, notch.radius, settings.shape, settings.butterworthOrder);
          h *= notchH1 * notchH2;
        }
      }

      if (settings.invert) {
        h = 1.0 - h;
      }

      mask[rowOffset + x] = Math.max(0, Math.min(1, h));
    }
  }

  // Combine with any user custom drawn deletions if provided
  if (userCustomMask) {
    for (let i = 0; i < mask.length; i++) {
      mask[i] *= userCustomMask[i];
    }
  }

  return mask;
}

function calcLowpass(r: number, d0: number, shape: FilterShape, order: number): number {
  if (d0 <= 0) return 0;
  if (shape === 'ideal') {
    return r <= d0 ? 1.0 : 0.0;
  } else if (shape === 'butterworth') {
    return 1.0 / (1.0 + Math.pow(r / d0, 2 * order));
  } else {
    // Gaussian
    return Math.exp(-(r * r) / (2 * d0 * d0));
  }
}

function calcHighpass(r: number, d0: number, shape: FilterShape, order: number): number {
  return 1.0 - calcLowpass(r, d0, shape, order);
}

/**
 * Multiplies shifted complex spectrum by frequency mask H(u,v)
 */
export function applyFilterMask(
  shiftedSpectrum: ComplexArray2D,
  mask: Float32Array
): ComplexArray2D {
  const { real, imag, size } = shiftedSpectrum;
  const filteredReal = new Float32Array(size * size);
  const filteredImag = new Float32Array(size * size);

  for (let i = 0; i < mask.length; i++) {
    const weight = mask[i];
    filteredReal[i] = real[i] * weight;
    filteredImag[i] = imag[i] * weight;
  }

  return { real: filteredReal, imag: filteredImag, size };
}

/**
 * Calculates PSNR (Peak Signal to Noise Ratio) between original and reconstructed image
 */
export function calculatePSNR(orig: Float32Array, altered: Float32Array): { psnr: number; mse: number } {
  let mse = 0;
  const len = orig.length;
  for (let i = 0; i < len; i++) {
    const diff = orig[i] - altered[i];
    mse += diff * diff;
  }
  mse /= len;

  if (mse < 1e-6) {
    return { psnr: 99.9, mse: 0 };
  }

  const psnr = 10 * Math.log10((255 * 255) / mse);
  return { psnr: Number(psnr.toFixed(2)), mse: Number(mse.toFixed(2)) };
}
