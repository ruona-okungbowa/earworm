import type { Ms } from "@earworm/core";
import type { SittingConfig } from "../story/types.js";
import { REOPEN_DELAY_MS } from "./constants.js";
import {
  openWindow,
  windowDeadline,
  windowOnset,
  windowTick,
  type Closed,
  type ListeningWindow,
} from "./listening.js";
import { startRound, stepRound, type RoundState } from "./round.js";
import { buildSpotTarget } from "./spot-builder.js";
import type {
  Effect,
  InputMode,
  RandomSource,
  SittingInput,
  StepResult,
} from "./types.js";

// Sitting 3 machine: a listen step (capped at Max_Reply_Hits, G2), then a Round.
// A new Round after a Refusal starts from a fresh startSpot (Requirement 9.17).
interface Carry {
  readonly dread: number;
  readonly wasntYours: string; // Story_Script lines.wasntYours
  readonly lineCount: number; // index for the next "again" / "slower" line
}

export type SpotState =
  | ({ phase: "listen"; window: ListeningWindow } & Carry)
  | ({ phase: "reopening"; reopenAtMs: Ms } & Carry)
  | { phase: "round"; round: RoundState }
  | ({ phase: "paused" } & Carry)
  // Reserved: audio failures during the Round are held by the Round itself.
  | ({ phase: "awaiting-audio" } & Carry);

const MAY_REPLY: Effect = { kind: "cue", cue: "may-reply" };

function wakeOf(s: SpotState): Ms | null {
  switch (s.phase) {
    case "listen":
      return windowDeadline(s.window);
    case "reopening":
      return s.reopenAtMs;
    default:
      return null;
  }
}

function result(
  state: SpotState,
  effects: readonly Effect[],
): StepResult<SpotState> {
  return { state, effects, wakeAtMs: wakeOf(state) };
}

function carryOf(s: Exclude<SpotState, { phase: "round" }>): Carry {
  return { dread: s.dread, wasntYours: s.wasntYours, lineCount: s.lineCount };
}

function listen(
  carry: Carry,
  startMs: Ms,
  cfg: SittingConfig,
): StepResult<SpotState> {
  return result(
    {
      phase: "listen",
      window: openWindow(startMs, cfg.maxReplyHits),
      ...carry,
    },
    [MAY_REPLY],
  );
}

export function startSpot(
  cfg: SittingConfig,
  _mode: InputMode,
  nowMs: Ms,
  dread: number,
  wasntYours: string,
): StepResult<SpotState> {
  return listen({ dread, wasntYours, lineCount: 0 }, nowMs, cfg);
}

function close(
  carry: Carry,
  closed: Closed,
  cfg: SittingConfig,
  random: RandomSource,
  pre: readonly Effect[],
): StepResult<SpotState> {
  const reopen = (key: "again" | "slower") =>
    result(
      {
        phase: "reopening",
        reopenAtMs: closed.endMs + REOPEN_DELAY_MS,
        ...carry,
        lineCount: carry.lineCount + 1,
      },
      [...pre, { kind: "line", key, index: carry.lineCount }],
    );
  if (closed.hits.length < cfg.minReplyHits) return reopen("again");
  const built = buildSpotTarget(closed.hits, cfg.minGapMs, random);
  if (built.kind !== "built") return reopen("slower");
  const r = startRound(
    {
      sitting: 3,
      target: built.target,
      playAtMs: closed.endMs + cfg.copyDelayMs,
      dread: carry.dread,
      textAtEnd: carry.wasntYours,
    },
    cfg,
  );
  return {
    state: { phase: "round", round: r.state },
    effects: [...pre, ...r.effects],
    wakeAtMs: r.wakeAtMs,
  };
}

export function stepSpot(
  s: SpotState,
  input: SittingInput,
  nowMs: Ms,
  cfg: SittingConfig,
  mode: InputMode,
  random: RandomSource,
): StepResult<SpotState> {
  switch (s.phase) {
    case "round": {
      const r = stepRound(s.round, input, nowMs, cfg, mode);
      const base = {
        state: { phase: "round", round: r.state } as SpotState,
        effects: r.effects,
        wakeAtMs: r.wakeAtMs,
      };
      return r.done ? { ...base, done: r.done } : base;
    }
    case "listen": {
      const carry = carryOf(s);
      if (input.kind === "tick") {
        const { closed } = windowTick(s.window, nowMs);
        return closed
          ? close(carry, closed, cfg, random, [])
          : result(s, []);
      }
      if (input.kind === "onset") {
        const r = windowOnset(s.window, mode, input.event, cfg.onsetDebounceMs);
        const pulse: Effect[] =
          r.window.hits.length > s.window.hits.length
            ? [{ kind: "pulse", atMs: input.event.timestamp }]
            : [];
        return r.closed
          ? close(carry, r.closed, cfg, random, pulse)
          : result({ ...s, window: r.window }, pulse);
      }
      if (input.kind === "input-mode") return listen(carry, nowMs, cfg);
      if (input.kind === "kit-error") {
        return result({ phase: "paused", ...carry }, [
          { kind: "kit-error", error: input.error },
        ]);
      }
      return result(s, []);
    }
    case "reopening": {
      const at = s.reopenAtMs;
      const due =
        input.kind === "tick"
          ? nowMs >= at
          : input.kind === "onset" && input.event.timestamp >= at;
      if (due) {
        // Open at the deadline, not at the tick time, so tick rate changes nothing.
        const opened = listen(carryOf(s), at, cfg);
        const next = stepSpot(opened.state, input, nowMs, cfg, mode, random);
        return {
          ...next,
          effects: [...opened.effects, ...next.effects],
        };
      }
      if (input.kind === "kit-error") {
        return result({ phase: "paused", ...carryOf(s) }, [
          { kind: "kit-error", error: input.error },
        ]);
      }
      return result(s, []);
    }
    case "paused":
      return input.kind === "resume"
        ? listen(carryOf(s), nowMs, cfg)
        : result(s, []);
    case "awaiting-audio":
      return result(s, []);
  }
}
