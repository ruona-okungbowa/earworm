import type { Ms, OnsetEvent, ReleaseEvent } from "@earworm/core";
import type { TapInput } from "@earworm/browser";

/** Reference state for the press model. */
export interface TapRefState {
  held: null | "key" | "pointer";
  stopped: boolean;
}

export interface TapRefStep {
  state: TapRefState;
  events: Array<OnsetEvent | ReleaseEvent>;
  clockError: boolean;
}

export const TAP_REF_INITIAL: TapRefState = { held: null, stopped: false };

const pressAt = (t: Ms): OnsetEvent => ({
  type: "onset",
  timestamp: t,
  source: "tap",
  strength: 1,
});

const releaseAt = (t: Ms): ReleaseEvent => ({
  type: "release",
  timestamp: t,
  source: "tap",
});

/** Independent statement of the press model, written as a decision per input. */
export function tapReference(state: TapRefState, input: TapInput): TapRefStep {
  const none = (s: TapRefState = state, clockError = false): TapRefStep => ({
    state: s,
    events: [],
    clockError,
  });

  // After stop nothing is emitted, with or without a clock.
  if (state.stopped) return none();

  // Without a clock the input is dropped, except that stop still ends the source.
  if (input.now === null) {
    return none(
      input.kind === "stop" ? { held: null, stopped: true } : state,
      true,
    );
  }
  const t = input.now;

  const press = (by: "key" | "pointer"): TapRefStep => ({
    state: { held: by, stopped: false },
    events: [pressAt(t)],
    clockError: false,
  });
  const lift = (): TapRefStep => ({
    state: { held: null, stopped: false },
    events: [releaseAt(t)],
    clockError: false,
  });

  switch (input.kind) {
    case "key-down":
      if (input.inTextInput || input.repeat || state.held !== null) {
        return none();
      }
      return press("key");
    case "pointer-down":
      if (!input.onTarget || state.held !== null) return none();
      return press("pointer");
    case "key-up":
      return state.held === "key" ? lift() : none();
    case "pointer-up":
      return state.held === "pointer" ? lift() : none();
    case "blur":
      return state.held !== null ? lift() : none();
    case "stop": {
      const stopped: TapRefState = { held: null, stopped: true };
      return state.held !== null
        ? { state: stopped, events: [releaseAt(t)], clockError: false }
        : none(stopped);
    }
  }
}
