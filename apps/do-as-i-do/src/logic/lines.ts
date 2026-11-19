import type { Reason } from "./judge.js";
import type { LineKey } from "./types.js";

/** Index-based choice, never random. Empty list returns "". */
export function pickLine(lines: readonly string[], index: number): string {
  if (lines.length === 0) return "";
  return lines[((index % lines.length) + lines.length) % lines.length] ?? "";
}

/** Presence line category for a failed judgement; null on success. */
export function reasonToLineKey(reason: Reason): LineKey | null {
  switch (reason) {
    case "ok":
      return null;
    case "too-short":
      return "too-few";
    default:
      return reason;
  }
}
