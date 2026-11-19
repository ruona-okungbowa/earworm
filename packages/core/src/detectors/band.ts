import { bands, BAND_PRESET } from "../bands.js";
import { DEFAULTS, resolveConfig } from "../config.js";
import { createFrameGuard, createRateGate } from "../detector-utils.js";
import type { Band, Detector, EarwormEvent, Frame } from "../events.js";
import { SUPPORTED_FFT_SIZES, WINDOW_NAMES } from "../fft.js";
import type { WindowName } from "../fft.js";
import { createSampleHistory } from "../sample-history.js";
import { isAnalysisSampleRate, spectrum } from "../spectrum.js";
import { err, ok } from "../types.js";
import type { Result } from "../types.js";

export interface BandDetectorConfig {
  /** Sample rate in Hz, 8000 to 192000. Default 48000. */
  sampleRate?: number | undefined;
  /** FFT_Size, a power of two from 256 to 8192. Default 2048. */
  fftSize?: number | undefined;
  /** Window_Function. Default "hann". */
  window?: WindowName | undefined;
  /** Bands to report. Default `BAND_PRESET`. */
  bands?: readonly Band[] | undefined;
  /** Unit of the values. Default "dbfs". */
  unit?: "dbfs" | "normalised" | undefined;
  /** Maximum Band_Events per second, 1 to 100. Default 30. */
  maxRate?: number | undefined;
}

export interface BandDetector extends Detector {
  /** Number of samples held in the Sample_History, at most the FFT_Size. */
  readonly historyLength: number;
}

/**
 * Emits one Band_Event per valid Frame, limited to `maxRate` Events per
 * second. Values come from the Spectrum of the last `fftSize` samples,
 * zero-padded until that many have arrived, passed with the configured window
 * to `bands`. The Event Timestamp is the Frame Timestamp.
 *
 * Validation order: size, sample rate, window, unit, band list, maximum rate.
 */
export function createBandDetector(
  config?: BandDetectorConfig,
): Result<BandDetector> {
  const given = config ?? {};
  const fftSize = given.fftSize ?? 2048;
  const sampleRate = given.sampleRate ?? 48_000;
  const window = given.window ?? "hann";
  const unit = given.unit ?? "dbfs";
  const bandList = given.bands ?? BAND_PRESET;

  if (typeof fftSize !== "number" || !SUPPORTED_FFT_SIZES.includes(fftSize)) {
    return err(
      "invalid-fft-size",
      "FFT size must be a power of two from 256 to 8192",
    );
  }
  if (!isAnalysisSampleRate(sampleRate)) {
    return err(
      "invalid-sample-rate",
      "Sample rate must be a finite number from 8000 to 192000 Hz",
    );
  }
  if (!WINDOW_NAMES.includes(window as WindowName)) {
    return err(
      "invalid-window",
      "Window must be hann, hamming, blackman or rectangular",
    );
  }
  // Let `bands` validate the unit and the Band list on a silent spectrum.
  const probe = bands(
    new Float32Array(fftSize / 2),
    sampleRate,
    fftSize,
    window,
    bandList,
    unit,
  );
  if (!probe.ok) return probe;
  const rate = resolveConfig(DEFAULTS.band, { maxRate: given.maxRate });
  if (!rate.ok) return rate;

  const guard = createFrameGuard();
  const history = createSampleHistory(fftSize);
  const snap = new Float32Array(fftSize);
  const gate = createRateGate(rate.value.maxRate);
  const list: readonly Band[] = bandList.map((b) => ({ ...b }));

  const detector: BandDetector = {
    name: "band",
    get historyLength(): number {
      return history.length;
    },
    process(frame: Frame): EarwormEvent[] {
      if (!guard.accept(frame)) return [];
      history.push(frame.samples);
      if (!gate.allow(frame.timestamp)) return [];
      history.snapshot(snap);
      const mags = spectrum(snap, sampleRate, fftSize, window);
      if (!mags.ok) return [];
      const values = bands(mags.value, sampleRate, fftSize, window, list, unit);
      if (!values.ok) return [];
      return [
        {
          type: "band",
          timestamp: frame.timestamp,
          source: "mic",
          unit,
          values: values.value,
        },
      ];
    },
    reset(): void {
      guard.reset();
      gate.reset();
      history.clear();
    },
    flush(): EarwormEvent[] {
      return [];
    },
  };
  return ok(detector);
}
