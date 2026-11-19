import type { Ms } from "@earworm/core";
import { LOOKAHEAD_MS } from "./constants.js";

export { LOOKAHEAD_MS };

export interface QueuedPlay {
  readonly id: string;
  readonly atMs: Ms;
  readonly role: string;
  readonly variant: "normal" | "dread3";
}
export interface PlayQueue {
  readonly items: readonly QueuedPlay[];
}

/** Adds plays, sorted by atMs; equal times keep insertion order (Array.sort is stable). */
export function enqueue(q: PlayQueue, plays: readonly QueuedPlay[]): PlayQueue {
  return { items: [...q.items, ...plays].sort((a, b) => a.atMs - b.atMs) };
}

/** Splits off plays whose `atMs - LOOKAHEAD_MS <= nowMs`. */
export function due(
  q: PlayQueue,
  nowMs: Ms,
): { q: PlayQueue; due: readonly QueuedPlay[] } {
  const ready = q.items.filter((p) => p.atMs - LOOKAHEAD_MS <= nowMs);
  const rest = q.items.filter((p) => p.atMs - LOOKAHEAD_MS > nowMs);
  return { q: { items: rest }, due: ready };
}

export function clear(): PlayQueue {
  return { items: [] };
}
