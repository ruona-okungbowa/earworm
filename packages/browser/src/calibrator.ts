import type {
  Detector,
  EarwormEvent,
  EventSource,
  KitError,
  KitErrorCode,
  Ms,
} from "@earworm/core";
import { medianLatency, noiseFloorFromLevels } from "./calibration-math.js";
import { parseCalibration } from "./calibration-store.js";
import type { Calibration, CalibrationStore } from "./calibration-store.js";
import type { AudioEngine } from "./engine.js";
import type { Synth } from "./synth.js";

export const DEFAULT_QUIET_PERIOD_MS = 2000;
export const MIN_QUIET_PERIOD_MS = 500;
export const MAX_QUIET_PERIOD_MS = 10000;
export const DEFAULT_MAX_QUIET_LEVEL_DB = -30;
export const MIN_MAX_QUIET_LEVEL_DB = -100;
export const MAX_MAX_QUIET_LEVEL_DB = 0;
export const DEFAULT_CALIBRATION_TIMEOUT_MS = 3000;
export const MIN_CALIBRATION_TIMEOUT_MS = 2000;
export const MAX_CALIBRATION_TIMEOUT_MS = 10000;
/** Number of clicks played for latency calibration. */
export const CLICK_COUNT = 4;
/** Spacing between scheduled clicks. */
export const CLICK_SPACING_MS = 500;
/** Lead time between the call and the first click. */
export const CLICK_LEAD_MS = 100;
/** Widest distance at which a detected click still matches a scheduled one. */
export const DEFAULT_MAX_MATCH_MS = CLICK_SPACING_MS / 2;

export interface MeasureNoiseFloorOptions {
  /** Quiet period in ms, 500 to 10,000. Default 2,000. */
  quietPeriodMs?: Ms;
  /** Highest acceptable level in dBFS, -100 to 0. Default -30. */
  maxQuietLevel?: number;
}

export interface MeasureLatencyOptions {
  /** Timeout in ms from the first scheduled click, 2,000 to 10,000. Default 3,000. */
  timeoutMs?: Ms;
  /** Voice used for the clicks. Default "click". */
  voice?: string;
  /** Widest match distance in ms. Default 250. */
  maxMatchMs?: Ms;
}

export interface CalibrateOptions
  extends MeasureNoiseFloorOptions,
    MeasureLatencyOptions {}

export interface Calibrator {
  /** Returns the Noise_Floor in dBFS. Never writes the store. */
  measureNoiseFloor(opts?: MeasureNoiseFloorOptions): Promise<number>;
  /** Returns the Latency in ms. Never writes the store. */
  measureLatency(opts?: MeasureLatencyOptions): Promise<number>;
  /** Measures both and writes the store once, only when both succeed. */
  calibrate(opts?: CalibrateOptions): Promise<Calibration>;
  /** Parses serialised text and, on success, writes the store once. */
  load(text: string): Promise<Calibration>;
}

export interface CalibratorOptions {
  engine: AudioEngine;
  synth: Synth;
  source: EventSource;
  store: CalibrationStore;
  detectors: readonly Detector[];
  /** Waits `ms` on the audio clock. Defaults to a wait on the engine context. */
  wait?: (ms: Ms) => Promise<void>;
}

function fail(
  code: KitErrorCode,
  message: string,
  field?: string,
): Promise<never> {
  const error: KitError = { code, message };
  if (field !== undefined) error.field = field;
  return Promise.reject(error);
}

function checkRange(
  name: string,
  value: number | undefined,
  lo: number,
  hi: number,
): KitError | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < lo || value > hi) {
    return {
      code: "invalid-config",
      message: `${name} must be a number from ${lo} to ${hi}`,
      setting: name,
    };
  }
  return null;
}

/** Wait on the AudioContext clock with a silent source. No real timer. */
function audioClockWait(engine: AudioEngine): (ms: Ms) => Promise<void> {
  return (ms) =>
    new Promise<void>((resolve) => {
      const ctx = engine.context;
      const node = ctx.createConstantSource();
      node.addEventListener("ended", () => {
        node.disconnect();
        resolve();
      });
      const startSec = ctx.currentTime;
      node.start(startSec);
      node.stop(startSec + Math.max(0, ms) / 1000);
    });
}

export function createCalibrator(options: CalibratorOptions): Calibrator {
  const { engine, synth, source, store, detectors } = options;
  const wait = options.wait ?? audioClockWait(engine);

  // Detectors follow the store: every `store.set`, and nothing else.
  store.subscribe((c) => {
    if (c === null) return;
    for (const d of detectors) {
      d.setNoiseFloor?.(c.noiseFloorDb);
    }
  });

  function collect(
    pick: (e: EarwormEvent) => void,
  ): () => void {
    return source.subscribe(pick);
  }

  async function measureNoiseFloor(
    opts: MeasureNoiseFloorOptions = {},
  ): Promise<number> {
    const bad =
      checkRange(
        "quietPeriodMs",
        opts.quietPeriodMs,
        MIN_QUIET_PERIOD_MS,
        MAX_QUIET_PERIOD_MS,
      ) ??
      checkRange(
        "maxQuietLevel",
        opts.maxQuietLevel,
        MIN_MAX_QUIET_LEVEL_DB,
        MAX_MAX_QUIET_LEVEL_DB,
      );
    if (bad !== null) return Promise.reject(bad);
    const quietMs = opts.quietPeriodMs ?? DEFAULT_QUIET_PERIOD_MS;
    const maxQuiet = opts.maxQuietLevel ?? DEFAULT_MAX_QUIET_LEVEL_DB;

    const levels: { timestamp: Ms; level: number }[] = [];
    const unsubscribe = collect((e) => {
      if (e.type === "level") {
        levels.push({ timestamp: e.timestamp, level: e.level });
      }
    });
    try {
      await wait(quietMs);
    } finally {
      unsubscribe();
    }
    const r = noiseFloorFromLevels(levels, maxQuiet);
    return r.ok ? r.value : Promise.reject(r.error);
  }

  async function measureLatency(
    opts: MeasureLatencyOptions = {},
  ): Promise<number> {
    const bad =
      checkRange(
        "timeoutMs",
        opts.timeoutMs,
        MIN_CALIBRATION_TIMEOUT_MS,
        MAX_CALIBRATION_TIMEOUT_MS,
      ) ?? checkRange("maxMatchMs", opts.maxMatchMs, 0, Number.MAX_SAFE_INTEGER);
    if (bad !== null) return Promise.reject(bad);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CALIBRATION_TIMEOUT_MS;
    const voice = opts.voice ?? "click";
    const maxMatch = opts.maxMatchMs ?? DEFAULT_MAX_MATCH_MS;

    const detected: Ms[] = [];
    const unsubscribe = collect((e) => {
      if (e.type === "onset") detected.push(e.timestamp);
    });
    try {
      const scheduled: Ms[] = [];
      const first = engine.now() + CLICK_LEAD_MS;
      for (let i = 0; i < CLICK_COUNT; i++) {
        const { startMs } = await synth.schedule(
          voice,
          first + i * CLICK_SPACING_MS,
          { ungated: true },
        );
        scheduled.push(startMs);
      }
      // The timeout runs from the first scheduled click.
      const remaining = scheduled[0]! + timeoutMs - engine.now();
      await wait(Math.max(0, remaining));
      const r = medianLatency(scheduled, detected, maxMatch);
      return r.ok ? r.value : await Promise.reject(r.error);
    } finally {
      unsubscribe();
    }
  }

  return {
    measureNoiseFloor,
    measureLatency,

    async calibrate(opts = {}) {
      const noiseFloorDb = await measureNoiseFloor(opts);
      const latencyMs = await measureLatency(opts);
      const c: Calibration = { noiseFloorDb, latencyMs };
      store.set(c);
      return c;
    },

    load(text) {
      const r = parseCalibration(text);
      if (!r.ok) return fail(r.error.code, r.error.message, r.error.field);
      store.set(r.value);
      return Promise.resolve(r.value);
    },
  };
}
