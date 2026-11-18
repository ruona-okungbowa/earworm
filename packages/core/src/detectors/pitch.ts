import { DEFAULTS, resolveConfig } from "../config.js";
import type { PartialConfig } from "../config.js";
import { createFrameGuard, frameLevelDb } from "../detector-utils.js";
import type { Detector, EarwormEvent, Frame } from "../events.js";
import { fft } from "../fft.js";
import { createSampleHistory } from "../sample-history.js";
import { err, ok } from "../types.js";
import type { Result } from "../types.js";

export type PitchDetectorConfig = PartialConfig<typeof DEFAULTS.pitch>;

export interface PitchDetector extends Detector {
  /** Number of samples held in the Sample_History, at most 2048. */
  readonly historyLength: number;
  /** Applies the given settings. On error nothing changes. */
  configure(partial: PitchDetectorConfig): Result<void>;
  /** Sets the Noise_Floor in dBFS. On a non-finite value nothing changes. */
  setNoiseFloor(db: number): Result<void>;
}

const WINDOW = 2048;
const MIN_HZ = 80;
const MAX_HZ = 2000;
/** Absolute threshold on the normalised difference function (YIN). */
const ABSOLUTE_THRESHOLD = 0.15;
/** Longest lag computed, so the integration window keeps at least half of the history. */
const MAX_LAG_CAP = WINDOW / 2 - 1;
// The longest lag is min(floor(sampleRate / 80), 1023). Above about 82 kHz the
// cap binds, so the lowest detectable pitch rises above 80 Hz.

function definedOnly(partial: PitchDetectorConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Monophonic pitch by the YIN method over the last 2048 samples. The
 * difference function is computed through FFT cross-correlation. The Event
 * Timestamp is the Frame Timestamp.
 */
export function createPitchDetector(
  config?: PitchDetectorConfig,
): Result<PitchDetector> {
  const resolved = resolveConfig(DEFAULTS.pitch, config);
  if (!resolved.ok) return resolved;

  const guard = createFrameGuard();
  const history = createSampleHistory(WINDOW);
  let { confidenceThreshold } = resolved.value;
  let noiseFloor: number = DEFAULTS.noiseFloorDb;

  // Preallocated work buffers.
  const snap = new Float32Array(WINDOW);
  const xr = new Float64Array(WINDOW);
  const xi = new Float64Array(WINDOW);
  const ar = new Float64Array(WINDOW);
  const ai = new Float64Array(WINDOW);
  const cs = new Float64Array(WINDOW + 1);
  const dn = new Float64Array(WINDOW);

  /** Returns [frequency, confidence] through `out`, or false when no pitch candidate exists. */
  const out = { frequency: 0, confidence: 0 };
  function analyse(sampleRate: number): boolean {
    const minLag = Math.max(2, Math.ceil(sampleRate / MAX_HZ));
    const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), MAX_LAG_CAP);
    if (maxLag <= minLag + 1) return false;
    const lagLimit = maxLag + 1; // one extra lag for interpolation
    const m = WINDOW - lagLimit;

    history.snapshot(snap);
    cs[0] = 0;
    for (let i = 0; i < WINDOW; i++) {
      const v = snap[i] as number;
      xr[i] = v;
      xi[i] = 0;
      ar[i] = i < m ? v : 0;
      ai[i] = 0;
      cs[i + 1] = (cs[i] as number) + v * v;
    }
    fft(ar, ai);
    fft(xr, xi);
    // P = conj(A) * X, then inverse FFT through conj(fft(conj(P))) / N.
    for (let i = 0; i < WINDOW; i++) {
      const a = ar[i] as number;
      const b = ai[i] as number;
      const c = xr[i] as number;
      const d = xi[i] as number;
      ar[i] = a * c + b * d;
      ai[i] = -(a * d - b * c);
    }
    fft(ar, ai);

    // Cumulative mean normalised difference d'(tau).
    const base = cs[m] as number;
    let running = 0;
    dn[0] = 1;
    for (let tau = 1; tau <= lagLimit; tau++) {
      const r = (ar[tau] as number) / WINDOW;
      let d = base + ((cs[m + tau] as number) - (cs[tau] as number)) - 2 * r;
      if (d < 0) d = 0;
      running += d;
      dn[tau] = running > 0 ? (d * tau) / running : 1;
    }

    // First dip below the absolute threshold, else the global minimum.
    let best = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if ((dn[tau] as number) < ABSOLUTE_THRESHOLD) {
        while (
          tau + 1 <= maxLag &&
          (dn[tau + 1] as number) < (dn[tau] as number)
        ) {
          tau++;
        }
        best = tau;
        break;
      }
    }
    if (best < 0) {
      let min = Infinity;
      for (let tau = minLag; tau <= maxLag; tau++) {
        const v = dn[tau] as number;
        if (v < min) {
          min = v;
          best = tau;
        }
      }
      if (best < 0) return false;
    }

    // Parabolic interpolation.
    const a = dn[best - 1] as number;
    const b = dn[best] as number;
    const c = dn[best + 1] as number;
    const denom = a - 2 * b + c;
    let tauRefined = best;
    let dRefined = b;
    if (denom > 1e-12) {
      const shift = (a - c) / (2 * denom);
      if (Math.abs(shift) <= 1) {
        tauRefined = best + shift;
        dRefined = b - ((c - a) * shift) / 4;
      }
    }
    out.frequency = sampleRate / tauRefined;
    out.confidence = Math.min(1, Math.max(0, 1 - dRefined));
    return true;
  }

  const detector: PitchDetector = {
    name: "pitch",
    get historyLength(): number {
      return history.length;
    },
    process(frame: Frame): EarwormEvent[] {
      const sr = frame.sampleRate;
      if (typeof sr !== "number" || !Number.isFinite(sr) || sr <= 0) return [];
      if (!guard.accept(frame)) return [];
      history.push(frame.samples);

      // Emission gate (Req 4.11): no analysis on a partly filled history.
      if (history.length < WINDOW) return [];
      if (frameLevelDb(frame.samples) <= noiseFloor) return [];
      if (!analyse(sr)) return [];

      const { frequency, confidence } = out;
      if (!Number.isFinite(frequency)) return [];
      if (confidence < confidenceThreshold) return [];
      if (frequency < MIN_HZ || frequency > MAX_HZ) return [];

      const midi = Math.min(
        127,
        Math.max(0, Math.round(69 + 12 * Math.log2(frequency / 440))),
      );
      const cents = Math.min(
        50,
        Math.max(-50, 1200 * Math.log2(frequency / midiToHz(midi))),
      );
      return [
        {
          type: "pitch",
          timestamp: frame.timestamp,
          source: "mic",
          frequency,
          midi,
          cents,
          confidence,
        },
      ];
    },
    reset(): void {
      guard.reset();
      history.clear();
    },
    flush(): EarwormEvent[] {
      return [];
    },
    configure(partial: PitchDetectorConfig): Result<void> {
      const next = resolveConfig(DEFAULTS.pitch, {
        confidenceThreshold,
        ...definedOnly(partial),
      });
      if (!next.ok) return next;
      ({ confidenceThreshold } = next.value);
      return ok(undefined);
    },
    setNoiseFloor(db: number): Result<void> {
      if (typeof db !== "number" || !Number.isFinite(db)) {
        return err("invalid-config", "Noise_Floor must be a finite number", {
          setting: "noiseFloor",
        });
      }
      noiseFloor = db;
      return ok(undefined);
    },
  };
  return ok(detector);
}
