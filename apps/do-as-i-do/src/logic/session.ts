import type { KitError, Ms } from "@earworm/core";
import type {
  StoryIssue,
  StoryScript,
  ValidationResult,
} from "../story/types.js";
import { revealedChars } from "./reveal.js";
import { REVEAL_CPS } from "./constants.js";
import {
  canBegin,
  effectiveMode,
  type CalibrationState,
  type Permission,
} from "./setup.js";
import {
  startSitting,
  stepSitting,
  type LateSittings,
  type SittingNumber,
  type SittingState,
} from "./sittings.js";
import type {
  Effect,
  InputMode,
  RandomSource,
  SittingInput,
  StepResult,
} from "./types.js";

export type Screen =
  | "content-warning"
  | "mic-check"
  | "sitting-start"
  | "sitting"
  | "refusal"
  | "reveal"
  | "final"
  | "story-invalid";

export interface SetupState {
  readonly permission: Permission;
  readonly calibration: CalibrationState;
  readonly skipCalibration: boolean;
  readonly audioError: boolean; // AudioContext could not start (Requirement 1.5)
}

export type SetupChange =
  | { kind: "permission"; permission: Permission }
  | { kind: "calibration"; calibration: CalibrationState }
  | { kind: "skip-calibration"; skip: boolean }
  | { kind: "mode"; mode: InputMode };

export interface RevealState {
  readonly sitting: SittingNumber;
  readonly text: string;
  readonly startedMs: Ms;
  readonly skipped: boolean;
  readonly ending: "broke" | "held" | null;
}

export interface SessionState {
  readonly screen: Screen;
  readonly inputMode: InputMode;
  readonly jumpScare: boolean; // survives restart
  readonly completed: number; // 0..5
  readonly answerLog: readonly string[];
  readonly current: SittingNumber; // the Sitting being started or played
  readonly sitting: SittingState | null;
  readonly refusals: Readonly<Record<2 | 3, number>>;
  readonly reveal: RevealState | null;
  readonly ending: "broke" | "held" | null;
  readonly setup: SetupState;
  readonly issues: readonly StoryIssue[]; // non-empty only on story-invalid
  readonly kitError: KitError | null; // halted Sitting 4 or 5, shown on sitting-start
}

export type SessionInput =
  | { kind: "start-pressed" }
  | { kind: "audio-ready" }
  | { kind: "setup"; change: SetupChange }
  | { kind: "begin-pressed" }
  | { kind: "begin-sitting-pressed" }
  | { kind: "toggle-jump-scare"; on: boolean }
  | { kind: "skip-reveal" }
  | { kind: "restart" }
  | SittingInput; // "audio-failed" before the first Sitting is a setup error

export interface SessionDeps {
  readonly story: StoryScript | null; // null only for a story-invalid Session
  readonly random: RandomSource;
  readonly late: LateSittings | null;
}

export type SessionStep = StepResult<SessionState> & { dread: number };

const NO_ISSUES: readonly StoryIssue[] = [];

const FRESH_SETUP: SetupState = {
  permission: "prompt",
  calibration: "uncalibrated",
  skipCalibration: false,
  audioError: false,
};

const START: SessionState = {
  screen: "content-warning",
  inputMode: "mic",
  jumpScare: true, // on by default on every page load (Requirement 3.2)
  completed: 0,
  answerLog: [],
  current: 1,
  sitting: null,
  refusals: { 2: 0, 3: 0 },
  reveal: null,
  ending: null,
  setup: FRESH_SETUP,
  issues: NO_ISSUES,
  kitError: null,
};

/** An invalid Story_Script gives the story-invalid screen and no Round can start. */
export function initialSession(
  story: StoryScript | ValidationResult,
): SessionState {
  if ("ok" in story && !story.ok) {
    return { ...START, screen: "story-invalid", issues: story.issues };
  }
  return START;
}

/** Dread_Level = completed Sittings, plus one from the moment an Answer starts showing. */
export function dreadOf(s: SessionState): number {
  return Math.min(5, s.completed + (s.reveal ? 1 : 0));
}

function revealLength(r: RevealState): number {
  return r.text.length;
}

function revealDoneAt(r: RevealState): Ms {
  return r.startedMs + (revealLength(r) * 1000) / REVEAL_CPS;
}

function wakeOf(s: SessionState, sittingWake: Ms | null): Ms | null {
  if (s.reveal && !s.reveal.skipped) return revealDoneAt(s.reveal);
  return sittingWake;
}

function out(
  state: SessionState,
  effects: readonly Effect[],
  sittingWake: Ms | null = null,
): SessionStep {
  return {
    state,
    effects,
    wakeAtMs: wakeOf(state, sittingWake),
    dread: dreadOf(state),
  };
}

/** Appends the Answer, counts the Sitting once, and moves on. */
function finishReveal(s: SessionState, deps: SessionDeps): SessionState {
  const r = s.reveal;
  if (!r) return s;
  const completed = s.completed + 1;
  const base = {
    ...s,
    reveal: null,
    completed,
    answerLog: [...s.answerLog, r.text],
    ending: r.ending ?? s.ending,
  };
  const next = (r.sitting + 1) as SittingNumber;
  // With late: null the Session ends after Sitting 3 (task 13.3 replaces this).
  const last = r.sitting === 5 || (r.sitting === 3 && deps.late === null);
  return last
    ? { ...base, screen: "final" }
    : { ...base, screen: "sitting-start", current: next };
}

function startReveal(
  s: SessionState,
  story: StoryScript,
  nowMs: Ms,
  ending: "broke" | "held" | null,
): SessionState {
  const n = s.current;
  const data = story.sittings.find((x) => x.number === n);
  const text =
    n === 5 ? (data?.endings?.[ending ?? "held"] ?? "") : (data?.answer ?? "");
  return {
    ...s,
    screen: "reveal",
    sitting: null,
    reveal: { sitting: n, text, startedMs: nowMs, skipped: false, ending },
  };
}

function applySetup(s: SessionState, c: SetupChange): SessionState {
  let setup = s.setup;
  let mode = s.inputMode;
  switch (c.kind) {
    case "permission":
      setup = { ...setup, permission: c.permission };
      break;
    case "calibration":
      setup = { ...setup, calibration: c.calibration };
      break;
    case "skip-calibration":
      setup = { ...setup, skipCalibration: c.skip };
      break;
    case "mode":
      mode = c.mode;
      break;
  }
  // Tap mode is forced when the microphone is unavailable or denied (Requirement 1.3, 1.4).
  return { ...s, setup, inputMode: effectiveMode(mode, setup.permission) };
}

export function stepSession(
  s: SessionState,
  input: SessionInput,
  nowMs: Ms,
  deps: SessionDeps,
): SessionStep {
  const story = deps.story;
  if (s.screen === "story-invalid" || story === null) return out(s, []);

  // Session-level inputs.
  switch (input.kind) {
    case "toggle-jump-scare":
      return out({ ...s, jumpScare: input.on }, []);
    case "restart":
      return out(
        {
          ...START,
          jumpScare: s.jumpScare,
          setup: { ...s.setup, audioError: false },
          inputMode: s.inputMode,
        },
        [],
      );
    case "start-pressed":
      return s.screen === "content-warning"
        ? out({ ...s, setup: { ...s.setup, audioError: false } }, [])
        : out(s, []);
    case "audio-ready":
      return s.screen === "content-warning"
        ? out({ ...s, screen: "mic-check" }, [])
        : out(s, []);
    case "setup":
      return s.screen === "content-warning" || s.screen === "mic-check"
        ? out(applySetup(s, input.change), [])
        : out(s, []);
    case "begin-pressed": {
      const ok =
        s.screen === "mic-check" &&
        canBegin({
          mode: s.inputMode,
          permission: s.setup.permission,
          calibration: s.setup.calibration,
          skipCalibration: s.setup.skipCalibration,
        });
      return ok
        ? out({ ...s, screen: "sitting-start", current: 1 }, [])
        : out(s, []);
    }
    case "begin-sitting-pressed": {
      if (s.screen !== "sitting-start") return out(s, []);
      const started = startSitting(
        s.current,
        story,
        s.inputMode,
        nowMs,
        dreadOf(s),
        deps.late,
      );
      if (!started) return out(s, []);
      return out(
        { ...s, screen: "sitting", sitting: started.state, kitError: null },
        started.effects,
        started.wakeAtMs,
      );
    }
    case "skip-reveal":
      return s.screen === "reveal"
        ? out(finishReveal(s, deps), [])
        : out(s, []);
    case "audio-failed":
      if (s.screen === "content-warning") {
        return out({ ...s, setup: { ...s.setup, audioError: true } }, []);
      }
      break;
    case "input-mode":
      s = { ...s, inputMode: effectiveMode(input.mode, s.setup.permission) };
      break;
    case "tick":
      if (s.screen === "reveal" && s.reveal) {
        const r = s.reveal;
        if (
          revealedChars(nowMs - r.startedMs, revealLength(r)) >= revealLength(r)
        ) {
          return out(finishReveal(s, deps), []);
        }
      }
      break;
    default:
      break;
  }

  // Everything else goes to the Sitting in progress.
  if (
    (s.screen !== "sitting" && s.screen !== "refusal") ||
    s.sitting === null
  ) {
    return out(s, []);
  }
  const r = stepSitting(
    s.sitting,
    input as SittingInput,
    nowMs,
    story,
    s.inputMode,
    deps.random,
    deps.late,
  );
  const base: SessionState = { ...s, sitting: r.state };
  const done = r.done;
  if (done?.kind === "completed") {
    return out(startReveal(base, story, nowMs, done.ending ?? null), r.effects);
  }
  if (done?.kind === "refused") {
    // Dread, Answer log and completed stay as they were.
    const n = s.current as 2 | 3;
    return out(
      {
        ...base,
        screen: "sitting-start",
        sitting: null,
        refusals: { ...s.refusals, [n]: s.refusals[n] + 1 },
      },
      r.effects,
    );
  }
  if (done?.kind === "halted") {
    return out(
      { ...base, screen: "sitting-start", sitting: null, kitError: done.error },
      r.effects,
    );
  }
  const refusing = r.effects.some(
    (e) => e.kind === "sound" && e.sound === "refusal",
  );
  return out(
    refusing ? { ...base, screen: "refusal" } : base,
    r.effects,
    r.wakeAtMs,
  );
}
