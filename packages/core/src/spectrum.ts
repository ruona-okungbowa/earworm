import { fft, SUPPORTED_FFT_SIZES, windowCoefficients } from "./fft.js";
import type { WindowName } from "./fft.js";
import { err, ok } from "./types.js";
import type { Result } from "./types.js";

const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 192_000;
const FLOOR_DBFS = -120;
const CAP_DBFS = 6;

/**
 * Magnitude spectrum in dBFS. Returns `size / 2` bins, bin k at
 * `k * sampleRate / size` Hz. Bin 0 is scaled by 1/Σw and the others by 2/Σw,
 * so a full-scale sine on a bin centre reads about 0 dBFS. Every bin is
 * clamped to -120..+6 dBFS.
 *
 * Buffers shorter than `size` are zero-padded after the samples; longer ones
 * use their last `size` samples. The input is never modified. Validation order:
 * size, sample rate, window, samples. Never throws.
 */
export function spectrum(
  samples: Float32Array,
  sampleRate: number,
  size: number,
  window: WindowName = "hann",
): Result<Float32Array> {
  if (typeof size !== "number" || !SUPPORTED_FFT_SIZES.includes(size)) {
    return err(
      "invalid-fft-size",
      "FFT size must be a power of two from 256 to 8192",
    );
  }
  if (
    typeof sampleRate !== "number" ||
    !Number.isFinite(sampleRate) ||
    sampleRate < MIN_SAMPLE_RATE ||
    sampleRate > MAX_SAMPLE_RATE
  ) {
    return err(
      "invalid-sample-rate",
      "Sample rate must be a finite number from 8000 to 192000 Hz",
    );
  }
  const w = windowCoefficients(window, size);
  if (!w.ok) return w;
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    return err("invalid-samples", "Samples must be a non-empty Float32Array");
  }
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) {
      return err("invalid-samples", "Samples must all be finite numbers");
    }
  }

  const win = w.value;
  const start = Math.max(0, samples.length - size);
  const count = samples.length - start;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let sumW = 0;
  for (let i = 0; i < size; i++) {
    const wi = win[i] as number;
    sumW += wi;
    if (i < count) re[i] = (samples[start + i] as number) * wi;
  }

  const transformed = fft(re, im);
  if (!transformed.ok) return transformed;

  const bins = size / 2;
  const out = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    const scale = (k === 0 ? 1 : 2) / sumW;
    const mag = Math.hypot(re[k] as number, im[k] as number) * scale;
    let db = mag > 0 ? 20 * Math.log10(mag) : FLOOR_DBFS;
    if (!(db > FLOOR_DBFS)) db = FLOOR_DBFS;
    else if (db > CAP_DBFS) db = CAP_DBFS;
    out[k] = db;
  }
  return ok(out);
}
