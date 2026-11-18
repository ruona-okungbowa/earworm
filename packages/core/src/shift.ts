import type { Detector, EarwormEvent } from "./events.js";

/**
 * Returns a copy of `e` with `deltaMs` added to `timestamp` and to
 * `startTime` or `endTime` where present. All other fields (including
 * `duration` and `data`) are carried over unchanged. Does not mutate `e`.
 */
export function shiftEvent<E extends EarwormEvent>(e: E, deltaMs: number): E {
  const out: E = { ...e, timestamp: e.timestamp + deltaMs };
  if ("startTime" in e) {
    (out as { startTime: number }).startTime = e.startTime + deltaMs;
  }
  if ("endTime" in e) {
    (out as { endTime: number }).endTime = e.endTime + deltaMs;
  }
  return out;
}

/** Collects the `flush()` output of each Detector that has one, in order. */
export function flushDetectors(detectors: readonly Detector[]): EarwormEvent[] {
  const out: EarwormEvent[] = [];
  for (const d of detectors) {
    if (d.flush) out.push(...d.flush());
  }
  return out;
}
