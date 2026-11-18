import type { KitError, Ms, OnsetEvent, ReleaseEvent } from "@earworm/core";

export type TapState = { held: null | "key" | "pointer"; stopped: boolean };

export type TapInput =
  | { kind: "key-down"; repeat: boolean; inTextInput: boolean; now: Ms | null }
  | { kind: "key-up"; now: Ms | null }
  | { kind: "pointer-down"; onTarget: boolean; now: Ms | null }
  | { kind: "pointer-up"; now: Ms | null }
  | { kind: "blur"; now: Ms | null }
  | { kind: "stop"; now: Ms | null };

export interface TapStepResult {
  state: TapState;
  events: Array<OnsetEvent | ReleaseEvent>;
  /** `clock-unavailable` when the input carried no time. */
  error?: KitError;
  /** True when the DOM handler should call `preventDefault`. */
  handled: boolean;
}

const onset = (timestamp: Ms): OnsetEvent => ({
  type: "onset",
  timestamp,
  source: "tap",
  strength: 1,
});

const release = (timestamp: Ms): ReleaseEvent => ({
  type: "release",
  timestamp,
  source: "tap",
});

/**
 * Pure state step of the Tap_Source. It uses no DOM type and reads no clock.
 *
 * `key-down` and `key-up` stand for the space bar only; the caller filters
 * other keys. Only a key-up clears a hold made by the space bar, and only a
 * pointer-up clears a hold made by a pointer, so at least one release lies
 * between any two space-bar Onsets.
 */
export function tapStep(state: TapState, input: TapInput): TapStepResult {
  if (state.stopped) return { state, events: [], handled: false };

  if (input.now === null) {
    const error: KitError = {
      code: "clock-unavailable",
      message: "The audio clock is unavailable; the tap input was dropped.",
    };
    // A stop must still end the source. The hold is lost with it.
    const next: TapState =
      input.kind === "stop" ? { held: null, stopped: true } : state;
    return { state: next, events: [], error, handled: false };
  }
  const now = input.now;

  switch (input.kind) {
    case "key-down": {
      if (input.inTextInput) return { state, events: [], handled: false };
      if (state.held === null && !input.repeat) {
        return {
          state: { ...state, held: "key" },
          events: [onset(now)],
          handled: true,
        };
      }
      // Auto-repeat of the held space bar is consumed, not emitted.
      return { state, events: [], handled: state.held === "key" };
    }
    case "pointer-down": {
      if (!input.onTarget || state.held !== null) {
        return { state, events: [], handled: false };
      }
      return {
        state: { ...state, held: "pointer" },
        events: [onset(now)],
        handled: true,
      };
    }
    case "key-up": {
      if (state.held !== "key") return { state, events: [], handled: false };
      return {
        state: { ...state, held: null },
        events: [release(now)],
        handled: true,
      };
    }
    case "pointer-up": {
      if (state.held !== "pointer") {
        return { state, events: [], handled: false };
      }
      return {
        state: { ...state, held: null },
        events: [release(now)],
        handled: true,
      };
    }
    case "blur": {
      if (state.held === null) return { state, events: [], handled: false };
      return {
        state: { ...state, held: null },
        events: [release(now)],
        handled: false,
      };
    }
    case "stop": {
      return {
        state: { held: null, stopped: true },
        events: state.held === null ? [] : [release(now)],
        handled: false,
      };
    }
  }
}
