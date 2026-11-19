import { DEFAULTS, resolveConfig } from "../config.js";
import {
  createFrameGuard,
  createRateGate,
  definedOnly,
} from "../detector-utils.js";
import type { Detector, EarwormEvent, Frame } from "../events.js";
import { SUPPORTED_FFT_SIZES, WINDOW_NAMES } from "../fft.js";
import type { WindowName } from "../fft.js";
import { createSampleHistory } from "../sample-history.js";
import type { SampleHistory } from "../sample-history.js";
import { isAnalysisSampleRate, spectrum } from "../spectrum.js";
import { err, ok } from "../types.js";
import type { Ms, Result } from "../types.js";

export interface SpectrumDetectorConfig {
  /** Sample rate in Hz, 8000 to 192000. Default 48000. */
  sampleRate?: number | undefined;
  /** FFT_Size, a power of two from 256 to 8192. Default 2048. */
  fftSize?: number | undefined;
  /** Window_Function. Default "hann". */
  window?: WindowName | undefined;
  /** Maximum Spectrum_Events per second, 1 to 100. Default 30. */
  maxRate?: number | undefined;
}

export interface SpectrumDetector extends Detector {
  /** Number of samples held in the Sample_History, at most the FFT_Size. */
  readonly historyLength: number;
  /**
   * Applies the given settings. On error nothing changes. Changing the
   * FFT_Size starts a new, empty Sample_History.
   */
  configure(partial: SpectrumDetectorConfig): Result<void>;
}

const KNOWN_KEYS = ["sampleRate", "fftSize", "window", "maxRate"];
const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_FFT_SIZE = 2048;
const DEFAULT_WINDOW: WindowName = "hann";

interface Settings {
  sampleRate: number;
  fftSize: number;
  window: WindowName;
  maxRate: number;
}

/**
 * Validates in the order size, sample rate, window, maximum rate (Req 19.2 to
 * 19.4, 19.14). `given` holds only the settings the caller supplied.
 */
function validate(
  current: Settings,
  given: Record<string, unknown>,
): Result<Settings> {
  for (const key of Object.keys(given)) {
    if (!KNOWN_KEYS.includes(key)) {
      return err("invalid-config", `Unknown setting "${key}"`, {
        setting: key,
      });
    }
  }
  const fftSize = Object.hasOwn(given, "fftSize")
    ? given["fftSize"]
    : current.fftSize;
  if (typeof fftSize !== "number" || !SUPPORTED_FFT_SIZES.includes(fftSize)) {
    return err(
      "invalid-fft-size",
      "FFT size must be a power of two from 256 to 8192",
    );
  }
  const sampleRate = Object.hasOwn(given, "sampleRate")
    ? given["sampleRate"]
    : current.sampleRate;
  if (!isAnalysisSampleRate(sampleRate)) {
    return err(
      "invalid-sample-rate",
      "Sample rate must be a finite number from 8000 to 192000 Hz",
    );
  }
  const window = Object.hasOwn(given, "window")
    ? given["window"]
    : current.window;
  if (!WINDOW_NAMES.includes(window as WindowName)) {
    return err(
      "invalid-window",
      "Window must be hann, hamming, blackman or rectangular",
    );
  }
  const rate = resolveConfig(DEFAULTS.spectrum, {
    maxRate: Object.hasOwn(given, "maxRate")
      ? (given["maxRate"] as number)
      : current.maxRate,
  });
  if (!rate.ok) return rate;
  return ok({
    sampleRate,
    fftSize,
    window: window as WindowName,
    maxRate: rate.value.maxRate,
  });
}

/**
 * Emits a Spectrum_Event (dBFS magnitudes, `fftSize / 2` bins) per valid
 * Frame, limited to `maxRate` Events per second. The spectrum is taken from
 * the last `fftSize` samples, zero-padded until that many have arrived. The
 * Event Timestamp is the Frame Timestamp. The Event carries the configured
 * sample rate.
 */
export function createSpectrumDetector(
  config?: SpectrumDetectorConfig,
): Result<SpectrumDetector> {
  const resolved = validate(
    {
      sampleRate: DEFAULT_SAMPLE_RATE,
      fftSize: DEFAULT_FFT_SIZE,
      window: DEFAULT_WINDOW,
      maxRate: DEFAULTS.spectrum.maxRate.default,
    },
    definedOnly(config),
  );
  if (!resolved.ok) return resolved;

  const guard = createFrameGuard();
  let settings = resolved.value;
  let history: SampleHistory = createSampleHistory(settings.fftSize);
  let snap = new Float32Array(settings.fftSize);
  let gate = createRateGate(settings.maxRate);
  let lastEmitted: Ms | null = null;

  const detector: SpectrumDetector = {
    name: "spectrum",
    get historyLength(): number {
      return history.length;
    },
    process(frame: Frame): EarwormEvent[] {
      if (!guard.accept(frame)) return [];
      history.push(frame.samples);
      if (!gate.allow(frame.timestamp)) return [];
      history.snapshot(snap);
      const mags = spectrum(
        snap,
        settings.sampleRate,
        settings.fftSize,
        settings.window,
      );
      if (!mags.ok) return [];
      lastEmitted = frame.timestamp;
      return [
        {
          type: "spectrum",
          timestamp: frame.timestamp,
          source: "mic",
          sampleRate: settings.sampleRate,
          fftSize: settings.fftSize,
          magnitudes: mags.value,
        },
      ];
    },
    reset(): void {
      guard.reset();
      gate.reset();
      history.clear();
      lastEmitted = null;
    },
    flush(): EarwormEvent[] {
      return [];
    },
    configure(partial: SpectrumDetectorConfig): Result<void> {
      const next = validate(settings, definedOnly(partial));
      if (!next.ok) return next;
      if (next.value.fftSize !== settings.fftSize) {
        history = createSampleHistory(next.value.fftSize);
        snap = new Float32Array(next.value.fftSize);
      }
      settings = next.value;
      gate = createRateGate(settings.maxRate);
      // Seed the new gate so the last emitted Event still counts.
      if (lastEmitted !== null) gate.allow(lastEmitted);
      return ok(undefined);
    },
  };
  return ok(detector);
}
