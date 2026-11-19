import type { Ms } from "@earworm/core";
import { acceptOnset } from "./accept.js";
import { LISTEN_IDLE_MS, LISTEN_QUIET_MS } from "./constants.js";
import type { InputMode, OnsetLike } from "./types.js";

export interface ListeningWindow {
  readonly startMs: Ms;
  readonly maxHits: number | null; // 7 for the listen steps of Sittings 1 and 3; null elsewhere
  readonly hits: readonly Ms[]; // accepted Timestamps, ascending
}

export interface Closed {
  readonly endMs: Ms;
  readonly hits: readonly Ms[];
  readonly reason: "quiet" | "idle" | "max-hits";
}

export function openWindow(
  startMs: Ms,
  maxHits: number | null,
): ListeningWindow {
  return { startMs, maxHits, hits: [] };
}

/** Last hit + 2000, or start + 12000 when there is no hit. */
export function windowDeadline(w: ListeningWindow): Ms {
  const last = w.hits[w.hits.length - 1];
  return last === undefined
    ? w.startMs + LISTEN_IDLE_MS
    : last + LISTEN_QUIET_MS;
}

function closeAtDeadline(w: ListeningWindow): Closed {
  return {
    endMs: windowDeadline(w),
    hits: w.hits,
    reason: w.hits.length === 0 ? "idle" : "quiet",
  };
}

export function windowOnset(
  w: ListeningWindow,
  mode: InputMode,
  e: OnsetLike,
  debounceMs: number,
): { window: ListeningWindow; closed: Closed | null } {
  // An onset at or after the deadline closes the window first and is not counted.
  if (e.timestamp >= windowDeadline(w)) {
    return { window: w, closed: closeAtDeadline(w) };
  }
  const last = w.hits[w.hits.length - 1];
  const r = acceptOnset(
    { fromMs: w.startMs, toMs: null, lastAcceptedMs: last ?? null },
    mode,
    e,
    debounceMs,
  );
  if (!r.accepted) return { window: w, closed: null };
  const next: ListeningWindow = { ...w, hits: [...w.hits, e.timestamp] };
  if (next.maxHits !== null && next.hits.length >= next.maxHits) {
    return {
      window: next,
      closed: { endMs: e.timestamp, hits: next.hits, reason: "max-hits" },
    };
  }
  return { window: next, closed: null };
}

export function windowTick(
  w: ListeningWindow,
  nowMs: Ms,
): { closed: Closed | null } {
  return { closed: nowMs >= windowDeadline(w) ? closeAtDeadline(w) : null };
}
