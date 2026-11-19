import { intervalsToPattern, type Ms } from "@earworm/core";
import type { StoryScript } from "../story/types.js";
import { startCopy, stepCopy, type CopyState } from "./copy.js";
import { startRound, stepRound, type RoundState } from "./round.js";
import { startSpot, stepSpot, type SpotState } from "./spot.js";
import type {
  InputMode,
  RandomSource,
  SittingInput,
  StepResult,
} from "./types.js";

export type SittingNumber = 1 | 2 | 3 | 4 | 5;

// Sittings 4 and 5 live behind this hook (task 13). Their states are opaque here.
export interface LateSittings {
  start4(
    story: StoryScript,
    mode: InputMode,
    nowMs: Ms,
    dread: number,
  ): StepResult<unknown>;
  step4(
    state: unknown,
    input: SittingInput,
    nowMs: Ms,
    story: StoryScript,
    mode: InputMode,
    random: RandomSource,
  ): StepResult<unknown>;
  start5(
    story: StoryScript,
    mode: InputMode,
    nowMs: Ms,
    dread: number,
  ): StepResult<unknown>;
  step5(
    state: unknown,
    input: SittingInput,
    nowMs: Ms,
    story: StoryScript,
    mode: InputMode,
    random: RandomSource,
  ): StepResult<unknown>;
}

export type SittingState =
  | { n: 1; s: CopyState }
  | { n: 2; s: RoundState }
  | { n: 3; s: SpotState }
  | { n: 4 | 5; s: unknown };

function tag<S>(n: SittingNumber, r: StepResult<S>): StepResult<SittingState> {
  const state = { n, s: r.state } as unknown as SittingState;
  return r.done === undefined
    ? { state, effects: r.effects, wakeAtMs: r.wakeAtMs }
    : { state, effects: r.effects, done: r.done, wakeAtMs: r.wakeAtMs };
}

/** Starts a Sitting; null when it is not available (Sittings 4 and 5 with `late: null`). */
export function startSitting(
  n: SittingNumber,
  story: StoryScript,
  mode: InputMode,
  nowMs: Ms,
  dread: number,
  late: LateSittings | null,
): StepResult<SittingState> | null {
  const cfg = story.config;
  switch (n) {
    case 1:
      return tag(1, startCopy(cfg, mode, nowMs));
    case 2: {
      const intervals = story.sittings[1]?.patterns?.[0]?.intervals ?? [];
      return tag(
        2,
        startRound(
          {
            sitting: 2,
            target: intervalsToPattern(intervals),
            playAtMs: nowMs,
            dread,
            textAtEnd: null,
          },
          cfg,
        ),
      );
    }
    case 3:
      return tag(3, startSpot(cfg, mode, nowMs, dread, story.lines.wasntYours));
    case 4:
      return late ? tag(4, late.start4(story, mode, nowMs, dread)) : null;
    case 5:
      return late ? tag(5, late.start5(story, mode, nowMs, dread)) : null;
  }
}

export function stepSitting(
  st: SittingState,
  input: SittingInput,
  nowMs: Ms,
  story: StoryScript,
  mode: InputMode,
  random: RandomSource,
  late: LateSittings | null,
): StepResult<SittingState> {
  const cfg = story.config;
  switch (st.n) {
    case 1:
      return tag(1, stepCopy(st.s, input, nowMs, cfg, mode));
    case 2:
      return tag(2, stepRound(st.s, input, nowMs, cfg, mode));
    case 3:
      return tag(3, stepSpot(st.s, input, nowMs, cfg, mode, random));
    case 4:
      return late
        ? tag(4, late.step4(st.s, input, nowMs, story, mode, random))
        : { state: st, effects: [], wakeAtMs: null };
    case 5:
      return late
        ? tag(5, late.step5(st.s, input, nowMs, story, mode, random))
        : { state: st, effects: [], wakeAtMs: null };
  }
}
