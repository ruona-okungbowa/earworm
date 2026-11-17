import type { Frame } from "./events.js";
import type { Ms } from "./types.js";

const FLOOR_DB = -120;

/** `max(-120, 20·log10(rms))`. Exactly -120 for an all-zero (or empty) Frame. */
export function frameLevelDb(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return FLOOR_DB;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i] as number;
    sum += s * s;
  }
  if (sum === 0) return FLOOR_DB;
  const db = 20 * Math.log10(Math.sqrt(sum / n));
  return Number.isNaN(db) ? FLOOR_DB : Math.max(FLOOR_DB, db);
}

export interface FrameGuard {
  /**
   * Returns true and records the Timestamp when the Frame is valid. Returns
   * false and leaves state unchanged for an empty Frame, a non-finite sample
   * or Timestamp, or a Timestamp earlier than the previous valid Frame.
   */
  accept(frame: Frame): boolean;
  reset(): void;
}

export function createFrameGuard(): FrameGuard {
  let last: Ms | null = null;
  return {
    accept(frame: Frame): boolean {
      const { samples, timestamp } = frame;
      if (samples.length === 0) return false;
      if (!Number.isFinite(timestamp)) return false;
      if (last !== null && timestamp < last) return false;
      for (let i = 0; i < samples.length; i++) {
        if (!Number.isFinite(samples[i])) return false;
      }
      last = timestamp;
      return true;
    },
    reset(): void {
      last = null;
    },
  };
}

export interface RateGate {
  /** True when an event may be emitted at `timestamp`; records it if so. */
  allow(timestamp: Ms): boolean;
  reset(): void;
}

export function createRateGate(maxPerSecond: number): RateGate {
  const interval = 1000 / maxPerSecond;
  let lastEmitted: Ms | null = null;
  return {
    allow(timestamp: Ms): boolean {
      if (lastEmitted !== null && timestamp - lastEmitted < interval) {
        return false;
      }
      lastEmitted = timestamp;
      return true;
    },
    reset(): void {
      lastEmitted = null;
    },
  };
}
