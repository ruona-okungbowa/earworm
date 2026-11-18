import { err, ok } from "./types.js";
import type { Result } from "./types.js";

export type WindowName = "hann" | "hamming" | "blackman" | "rectangular";

export const SUPPORTED_FFT_SIZES: readonly number[] = [
  256, 512, 1024, 2048, 4096, 8192,
];

export const WINDOW_NAMES: readonly WindowName[] = [
  "hann",
  "hamming",
  "blackman",
  "rectangular",
];

function isFftSize(n: number): boolean {
  return SUPPORTED_FFT_SIZES.includes(n);
}

/**
 * In-place iterative radix-2 FFT (forward, no scaling). `re` and `im` hold the
 * real and imaginary parts and must have the same length, a power of two from
 * 256 to 8192. Returns `invalid-fft-size` and leaves the arrays untouched
 * otherwise.
 */
export function fft(re: Float64Array, im: Float64Array): Result<void> {
  const n = re.length;
  if (im.length !== n || !isFftSize(n)) {
    return err(
      "invalid-fft-size",
      "FFT size must be a power of two from 256 to 8192 and re and im must match",
    );
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = (-2 * Math.PI) / len;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(step * k);
      const wi = Math.sin(step * k);
      for (let i = k; i < n; i += len) {
        const j = i + half;
        const xr = re[j] as number;
        const xi = im[j] as number;
        const tr = xr * wr - xi * wi;
        const ti = xr * wi + xi * wr;
        const ur = re[i] as number;
        const ui = im[i] as number;
        re[j] = ur - tr;
        im[j] = ui - ti;
        re[i] = ur + tr;
        im[i] = ui + ti;
      }
    }
  }
  return ok(undefined);
}

/**
 * Window coefficients of length `size`. Windows are periodic (denominator
 * `size`), the usual choice for spectral analysis. Returns `invalid-window`
 * for an unknown name and `invalid-fft-size` for an unsupported size.
 */
export function windowCoefficients(
  name: WindowName,
  size: number,
): Result<Float64Array> {
  if (!isFftSize(size)) {
    return err(
      "invalid-fft-size",
      "FFT size must be a power of two from 256 to 8192",
    );
  }
  if (!WINDOW_NAMES.includes(name)) {
    return err(
      "invalid-window",
      "Window must be hann, hamming, blackman or rectangular",
    );
  }
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const x = (2 * Math.PI * i) / size;
    switch (name) {
      case "hann":
        w[i] = 0.5 - 0.5 * Math.cos(x);
        break;
      case "hamming":
        w[i] = 0.54 - 0.46 * Math.cos(x);
        break;
      case "blackman":
        w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
        break;
      case "rectangular":
        w[i] = 1;
        break;
    }
  }
  return ok(w);
}
