import { err, ok } from "./types.js";
import type { Result } from "./types.js";

/** Default and inclusive allowed range of one numeric setting. */
export interface SettingSpec {
  readonly default: number;
  readonly min: number;
  readonly max: number;
}

/** A named group of settings, such as the settings of one Detector. */
export type ConfigSpec = Readonly<Record<string, SettingSpec>>;

/** Values of a ConfigSpec after defaults are applied. */
export type Resolved<S extends ConfigSpec> = { [K in keyof S]: number };

/** Caller input: every setting is optional. `undefined` counts as omitted. */
export type PartialConfig<S extends ConfigSpec> = {
  [K in keyof S]?: number | undefined;
};

function setting(def: number, min: number, max: number): SettingSpec {
  return { default: def, min, max };
}

/** Maximum Event rate per second: Req 5.2, 17.3, 19.14, 20.12. Default 30 per second. */
const rate = setting(30, 1, 100);

/**
 * The Default_Table plus the ranges of Requirements 5, 17, 18, 19 and 20.
 * Units are milliseconds, dB, dBFS, cents or Events per second, as in the name.
 */
export const DEFAULTS = {
  /** Noise_Floor in dBFS where no Calibration is available (Req 6.12). */
  noiseFloorDb: -60,
  /** Onset_Detector. `threshold` is dB above the Noise_Floor. */
  onset: {
    threshold: setting(10, 3, 40),
    attackWindow: setting(30, 5, 100),
    refractory: setting(100, 0, 1000),
  },
  pitch: {
    confidenceThreshold: setting(0.8, 0, 1),
  },
  /** Calibrator and Gate. */
  calibration: {
    quietPeriod: setting(2000, 500, 10000),
    maxQuietLevel: setting(-30, -100, 0),
  },
  gate: {
    tail: setting(150, 0, 5000),
  },
  segmenter: {
    maxGap: setting(25, 5, 500),
    minDuration: setting(30, 10, 2000),
    steadiness: setting(50, 5, 200),
    pitchSplit: setting(100, 10, 1200),
  },
  /** Level_Detector (Req 5.2). */
  level: {
    maxRate: rate,
  },
  /** Envelope_Detector (Req 17.2, 17.3). */
  envelope: {
    attack: setting(10, 0, 10000),
    release: setting(300, 0, 10000),
    maxRate: rate,
  },
  /** Sound_Detector (Req 18.1, 18.2, 18.3, 18.4). Ordering of thresholds is not checked here. */
  sound: {
    startThreshold: setting(12, 3, 60),
    endThreshold: setting(6, 1, 59),
    minHold: setting(30, 0, 200),
    hangover: setting(100, 0, 2000),
  },
  /** Spectrum_Detector rate (Req 19.14). FFT size, window and sample rate have their own codes. */
  spectrum: {
    maxRate: rate,
  },
  /** Band_Detector rate (Req 20.12). */
  band: {
    maxRate: rate,
  },
} as const satisfies Record<string, number | ConfigSpec>;

/**
 * Applies defaults to omitted settings and validates the rest.
 * Returns `invalid-config` with `setting` naming the first setting that is
 * non-finite, out of range, or not part of `spec` (Req 16.16, 16.17).
 * Never throws and never modifies its inputs.
 */
export function resolveConfig<S extends ConfigSpec>(
  spec: S,
  partial?: PartialConfig<S>,
): Result<Resolved<S>> {
  const input: Record<string, unknown> = partial ?? {};

  for (const name of Object.keys(input)) {
    if (input[name] !== undefined && !Object.hasOwn(spec, name)) {
      return err("invalid-config", `Unknown setting "${name}"`, {
        setting: name,
      });
    }
  }

  const out: Record<string, number> = {};
  for (const name of Object.keys(spec)) {
    const s = spec[name] as SettingSpec;
    const given = Object.hasOwn(input, name) ? input[name] : undefined;
    if (given === undefined) {
      out[name] = s.default;
      continue;
    }
    if (typeof given !== "number" || !Number.isFinite(given)) {
      return err(
        "invalid-config",
        `Setting "${name}" must be a finite number`,
        { setting: name },
      );
    }
    if (given < s.min || given > s.max) {
      return err(
        "invalid-config",
        `Setting "${name}" must be from ${s.min} to ${s.max}`,
        {
          setting: name,
        },
      );
    }
    out[name] = given;
  }
  return ok(out as Resolved<S>);
}
