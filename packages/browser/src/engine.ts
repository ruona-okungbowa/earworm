import type { Ms } from "@earworm/core";

/** One shared audio context and its clock, in milliseconds. */
export interface AudioEngine {
  readonly context: BaseAudioContext;
  /** `context.currentTime × 1000`. */
  now(): Ms;
}

/**
 * Wrap a `BaseAudioContext`. When none is passed, an `AudioContext` is created
 * lazily on first access to `context`. Nothing browser-specific is touched at
 * import time.
 */
export function createAudioEngine(ctx?: BaseAudioContext): AudioEngine {
  let context = ctx;
  const get = (): BaseAudioContext => (context ??= new AudioContext());
  return {
    get context(): BaseAudioContext {
      return get();
    },
    now(): Ms {
      return get().currentTime * 1000;
    },
  };
}
