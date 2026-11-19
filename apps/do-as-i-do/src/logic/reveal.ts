import { REVEAL_CPS } from "./constants.js";

export function revealedChars(
  elapsedMs: number,
  length: number,
  cps: number = REVEAL_CPS,
): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.min(length, Math.floor((elapsedMs * cps) / 1000));
}
