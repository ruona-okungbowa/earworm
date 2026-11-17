import { err, ok } from "./types.js";
import type { Ms, Result } from "./types.js";

/** Convert seconds to milliseconds. NaN, infinities and overflow give `invalid-number`. */
export function secondsToMs(s: number): Result<Ms> {
  if (!Number.isFinite(s)) {
    return err("invalid-number", "seconds must be a finite number");
  }
  const ms = s * 1000;
  if (!Number.isFinite(ms)) {
    return err("invalid-number", "seconds is too large to convert to milliseconds");
  }
  return ok(ms);
}

/** Convert milliseconds to seconds. NaN and infinities give `invalid-number`. */
export function msToSeconds(ms: number): Result<number> {
  if (!Number.isFinite(ms)) {
    return err("invalid-number", "milliseconds must be a finite number");
  }
  return ok(ms / 1000);
}
