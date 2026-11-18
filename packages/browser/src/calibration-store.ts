import { err, ok } from "@earworm/core";
import type { Result, Unsubscribe } from "@earworm/core";

/** A whole Calibration. The store never holds a partial one. */
export interface Calibration {
  /** Noise_Floor in dBFS, -120 to 0. */
  noiseFloorDb: number;
  /** Latency in ms, 0 to 500. */
  latencyMs: number;
}

export interface CalibrationStore {
  /** `null` means unset, and Detectors use -60 dBFS. */
  get(): Calibration | null;
  /** Replaces the whole Calibration in one write. */
  set(c: Calibration): void;
  subscribe(listener: (c: Calibration | null) => void): Unsubscribe;
  /** The current value, for snapshot readers. Same as `get()`. */
  readonly state: Calibration | null;
}

export const MIN_NOISE_FLOOR_DB = -120;
export const MAX_NOISE_FLOOR_DB = 0;
export const MIN_CALIBRATION_LATENCY_MS = 0;
export const MAX_CALIBRATION_LATENCY_MS = 500;

/** Serialise a Calibration to JSON text. Persistence is the app's job. */
export function serialiseCalibration(c: Calibration): string {
  return JSON.stringify({ noiseFloorDb: c.noiseFloorDb, latencyMs: c.latencyMs });
}

function bad(message: string): Result<Calibration> {
  return err("invalid-calibration", message);
}

function inRange(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
}

/**
 * Parse text produced by `serialiseCalibration`. Returns `invalid-calibration`
 * for malformed JSON, a missing or non-numeric field, or a value out of range.
 */
export function parseCalibration(text: string): Result<Calibration> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad("Calibration text is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return bad("Calibration must be an object");
  }
  const o = raw as Record<string, unknown>;
  if (!inRange(o["noiseFloorDb"], MIN_NOISE_FLOOR_DB, MAX_NOISE_FLOOR_DB)) {
    return bad(
      `noiseFloorDb must be a number from ${MIN_NOISE_FLOOR_DB} to ${MAX_NOISE_FLOOR_DB} dBFS`,
    );
  }
  if (!inRange(o["latencyMs"], MIN_CALIBRATION_LATENCY_MS, MAX_CALIBRATION_LATENCY_MS)) {
    return bad(
      `latencyMs must be a number from ${MIN_CALIBRATION_LATENCY_MS} to ${MAX_CALIBRATION_LATENCY_MS} ms`,
    );
  }
  return ok({ noiseFloorDb: o["noiseFloorDb"], latencyMs: o["latencyMs"] });
}

/** In-memory store, initially unset. */
export function createCalibrationStore(): CalibrationStore {
  let current: Calibration | null = null;
  let listeners: { fn: (c: Calibration | null) => void; active: boolean }[] = [];

  return {
    get: () => current,
    get state() {
      return current;
    },
    set(c) {
      current = { noiseFloorDb: c.noiseFloorDb, latencyMs: c.latencyMs };
      const snapshot = current;
      for (const l of [...listeners]) {
        if (!l.active) continue;
        try {
          l.fn(snapshot);
        } catch {
          // A throwing listener must not block the others.
        }
      }
    },
    subscribe(fn) {
      const entry = { fn, active: true };
      listeners = [...listeners, entry];
      return () => {
        entry.active = false;
        listeners = listeners.filter((l) => l !== entry);
      };
    },
  };
}
