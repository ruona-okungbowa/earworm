import {
  SUPPORTED_FFT_SIZES,
  WINDOW_NAMES,
  windowCoefficients,
} from "./fft.js";
import type { WindowName } from "./fft.js";
import type { Band } from "./events.js";
import { err, ok } from "./types.js";
import type { Result } from "./types.js";

const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 192_000;
const MAX_BANDS = 32;
const FLOOR_DBFS = -120;

/** Three generic bands. Plain data; no band belongs to one app. */
export const BAND_PRESET: readonly Band[] = [
  { name: "low", lowHz: 0, highHz: 250 },
  { name: "mid", lowHz: 250, highHz: 2000 },
  { name: "high", lowHz: 2000, highHz: 8000 },
];

function describe(band: unknown, index: number): string {
  if (
    typeof band === "object" &&
    band !== null &&
    typeof (band as Band).name === "string" &&
    (band as Band).name !== ""
  ) {
    return `"${(band as Band).name}"`;
  }
  return `at index ${index}`;
}

/**
 * Level of each Band in dBFS (or normalised 0..1) from a dBFS magnitude
 * spectrum produced by `spectrum` with the same size, sample rate and window function.
 *
 * Bin k belongs to a Band when `lowHz <= k * sampleRate / size < highHz`.
 * Bin power uses the Parseval convention: P_0 = (m_0 * wMean)^2 and
 * P_k = m_k^2 * wMean^2 / 2; a bin at or below -120 dBFS has zero power.
 * Normalised is clamp((dBFS + 120) / 120, 0, 1). Band level = 10 log10(sum P / mean(w^2)), floored
 * at -120 dBFS. Validation order: size, sample rate, spectrum length, window,
 * unit, band list, each band. Never throws.
 */
export function bands(
  spectrum: Float32Array,
  sampleRate: number,
  size: number,
  window: WindowName = "hann",
  bandList: readonly Band[],
  unit: "dbfs" | "normalised" = "dbfs",
): Result<Record<string, number>> {
  if (typeof size !== "number" || !SUPPORTED_FFT_SIZES.includes(size)) {
    return err(
      "invalid-spectrum",
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
      "invalid-spectrum",
      "Sample rate must be a finite number from 8000 to 192000 Hz",
    );
  }
  if (!(spectrum instanceof Float32Array) || spectrum.length !== size / 2) {
    return err("invalid-spectrum", "Spectrum length must be size / 2");
  }
  if (typeof window !== "string" || !WINDOW_NAMES.includes(window)) {
    return err("invalid-window", "Unknown window function");
  }
  if (unit !== "dbfs" && unit !== "normalised") {
    return err("invalid-unit", "Unit must be dbfs or normalised");
  }
  for (let k = 0; k < spectrum.length; k++) {
    if (!Number.isFinite(spectrum[k])) {
      return err("invalid-spectrum", "Spectrum values must be finite numbers");
    }
  }

  if (!Array.isArray(bandList) || bandList.length === 0) {
    return err("invalid-band", "Band list must not be empty");
  }
  if (bandList.length > MAX_BANDS) {
    return err(
      "invalid-band",
      `Band list must hold at most ${MAX_BANDS} bands`,
    );
  }
  const nyquist = sampleRate / 2;
  const seen = new Set<string>();
  for (let i = 0; i < bandList.length; i++) {
    const b = bandList[i] as unknown;
    const label = describe(b, i);
    const fail = (why: string): Result<Record<string, number>> =>
      err("invalid-band", `Band ${label}: ${why}`, {
        field:
          typeof (b as Band | null)?.name === "string"
            ? (b as Band).name
            : String(i),
      });
    if (typeof b !== "object" || b === null) return fail("not an object");
    const { name, lowHz, highHz } = b as Band;
    if (typeof name !== "string" || name === "") {
      return fail("name must be a non-empty string");
    }
    if (
      typeof lowHz !== "number" ||
      typeof highHz !== "number" ||
      !Number.isFinite(lowHz) ||
      !Number.isFinite(highHz)
    ) {
      return fail("lowHz and highHz must be finite numbers");
    }
    if (lowHz < 0) return fail("lowHz must not be below 0");
    if (highHz > nyquist) return fail(`highHz must not exceed ${nyquist} Hz`);
    if (!(lowHz < highHz)) return fail("lowHz must be below highHz");
    if (seen.has(name)) return fail("duplicate band name");
    seen.add(name);
  }

  const w = windowCoefficients(window, size);
  if (!w.ok) return w;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < size; i++) {
    const wi = w.value[i] as number;
    sum += wi;
    sumSq += wi * wi;
  }
  const wMean = sum / size;
  const wMeanSq = sumSq / size;

  const binPower = new Float64Array(spectrum.length);
  for (let k = 0; k < spectrum.length; k++) {
    const m = Math.pow(10, (spectrum[k] as number) / 20);
    binPower[k] =
      (spectrum[k] as number) <= FLOOR_DBFS
        ? 0
        : k === 0
          ? (m * wMean) ** 2
          : (m * m * wMean * wMean) / 2;
  }

  const binHz = sampleRate / size;
  const out: Record<string, number> = {};
  for (const band of bandList) {
    let total = 0;
    let any = false;
    for (let k = 0; k < binPower.length; k++) {
      const f = k * binHz;
      if (f >= band.lowHz && f < band.highHz) {
        total += binPower[k] as number;
        any = true;
      }
    }
    let db = any && total > 0 ? 10 * Math.log10(total / wMeanSq) : FLOOR_DBFS;
    if (!(db > FLOOR_DBFS)) db = FLOOR_DBFS;
    out[band.name] =
      unit === "normalised"
        ? Math.min(1, Math.max(0, (db - FLOOR_DBFS) / 120))
        : db;
  }
  return ok(out);
}
