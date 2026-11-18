import { createEmitter } from "./emitter.js";
import type { EventSource, Recording } from "./events.js";
import type { Ms } from "./types.js";

/**
 * Replays a Recording as an EventSource. Events keep their recorded source.
 * `advance(now)` emits each not-yet-emitted Event with timestamp <= now exactly
 * once, in ascending timestamp order (stable for ties). Time never runs
 * backwards: an earlier `now` emits nothing. The Recording is not mutated.
 */
export function createReplaySource(
  r: Recording,
): EventSource & { advance(nowMs: Ms): void } {
  const emitter = createEmitter();
  const sorted = [...r.events].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  );
  let next = 0;

  return {
    subscribe: (listener) => emitter.subscribe(listener),
    advance(nowMs: Ms): void {
      while (next < sorted.length) {
        const e = sorted[next];
        if (e === undefined || !(e.timestamp <= nowMs)) break;
        next += 1;
        try {
          emitter.emit(e);
        } catch {
          // never throws
        }
      }
    },
  };
}
