import type { Ms, Pattern } from "@earworm/core";
import type { SittingConfig } from "../story/types.js";
import { REFUSAL_HOLD_MS } from "./constants.js";
import { judge } from "./judge.js";
import { reasonToLineKey } from "./lines.js";
import {
  openWindow,
  windowDeadline,
  windowOnset,
  windowTick,
  type Closed,
  type ListeningWindow,
} from "./listening.js";
import { planPlayback } from "./playback.js";
import type {
  Effect,
  InputMode,
  SittingInput,
  SittingResult,
  StepResult,
} from "./types.js";

type PlayEffect = Extract<Effect, { kind: "play" }>;

export interface RoundState {
  readonly sitting: 2 | 3;
  readonly target: Pattern;
  readonly attemptsUsed: number;
  readonly phase:
    | { kind: "presenting"; endMs: Ms } // target is playing
    | { kind: "listening"; window: ListeningWindow }
    | { kind: "replaying"; endMs: Ms } // after a failed Attempt or a replay request
    | { kind: "paused" } // Kit_Error, waiting for resume
    | {
        kind: "awaiting-audio";
        pending: PlayEffect;
        from: "presenting" | "replaying";
      }
    | { kind: "refusing"; untilMs: Ms }
    | { kind: "done" };
  readonly dread: number;
  readonly textAtEnd: string | null; // "One of those wasn't yours." in Sitting 3
}

// G2: the Round's window has maxHits = null. A Max_Reply_Hits cap would make an
// 8-hit Sitting 3 target unwinnable; extra hits are judged `too-many` instead.
const ROUND_MAX_HITS = null;

function wakeOf(s: RoundState): Ms | null {
  const p = s.phase;
  switch (p.kind) {
    case "presenting":
    case "replaying":
      return p.endMs;
    case "listening":
      return windowDeadline(p.window);
    case "refusing":
      return p.untilMs;
    default:
      return null;
  }
}

function res(
  state: RoundState,
  effects: readonly Effect[],
  done?: SittingResult,
): StepResult<RoundState> {
  const wakeAtMs = wakeOf(state);
  return done === undefined
    ? { state, effects, wakeAtMs }
    : { state, effects, done, wakeAtMs };
}

function playEffect(
  s: RoundState,
  role: "presence" | "replay",
  atMs: Ms,
): { effect: PlayEffect; endMs: Ms } {
  const plan = planPlayback(s.target, atMs);
  return {
    effect: {
      kind: "play",
      id: `round${s.sitting}-${role}-${s.attemptsUsed}-${atMs}`,
      hits: plan.hits,
      role,
      variant: role === "replay" && s.dread >= 3 ? "dread3" : "normal",
    },
    endMs: plan.endMs,
  };
}

export function startRound(
  init: {
    sitting: 2 | 3;
    target: Pattern;
    playAtMs: Ms;
    dread: number;
    textAtEnd: string | null;
  },
  _cfg: SittingConfig,
): StepResult<RoundState> {
  const base: RoundState = {
    sitting: init.sitting,
    target: init.target,
    attemptsUsed: 0,
    phase: { kind: "done" },
    dread: init.dread,
    textAtEnd: init.textAtEnd,
  };
  const { effect, endMs } = playEffect(base, "presence", init.playAtMs);
  return res({ ...base, phase: { kind: "presenting", endMs } }, [effect]);
}

function listenAt(s: RoundState, startMs: Ms): RoundState {
  return {
    ...s,
    phase: { kind: "listening", window: openWindow(startMs, ROUND_MAX_HITS) },
  };
}

/** A closed window always consumes one Attempt. */
function judgeClosed(
  s: RoundState,
  closed: Closed,
  cfg: SittingConfig,
): StepResult<RoundState> {
  const j = judge(s.target, closed.hits, cfg.passThreshold);
  const attemptsUsed = s.attemptsUsed + 1;
  const used: RoundState = { ...s, attemptsUsed };
  if (j.success) {
    return res({ ...used, phase: { kind: "done" } }, [
      { kind: "sound", sound: "success" },
    ], { kind: "completed" });
  }
  if (attemptsUsed < cfg.attemptsPerRound) {
    const key = reasonToLineKey(j.reason) ?? "timing";
    const { effect, endMs } = playEffect(
      used,
      "replay",
      closed.endMs + cfg.copyDelayMs,
    );
    return res({ ...used, phase: { kind: "replaying", endMs } }, [
      { kind: "line", key, index: s.attemptsUsed },
      effect,
    ]);
  }
  return res(
    {
      ...used,
      phase: { kind: "refusing", untilMs: closed.endMs + REFUSAL_HOLD_MS },
    },
    [
      { kind: "line", key: "refusal", index: s.attemptsUsed },
      { kind: "sound", sound: "refusal" },
    ],
  );
}

export function stepRound(
  s: RoundState,
  input: SittingInput,
  nowMs: Ms,
  cfg: SittingConfig,
  mode: InputMode,
): StepResult<RoundState> {
  const p = s.phase;

  // Playback ended: open the window at its exact end, then handle the input.
  if ((p.kind === "presenting" || p.kind === "replaying") && nowMs >= p.endMs) {
    const effects: Effect[] = [{ kind: "cue", cue: "may-reply" }];
    if (p.kind === "presenting" && s.textAtEnd !== null) {
      effects.push({ kind: "text", text: s.textAtEnd });
    }
    const next = stepRound(listenAt(s, p.endMs), input, nowMs, cfg, mode);
    return { ...next, effects: [...effects, ...next.effects] };
  }

  switch (p.kind) {
    case "listening": {
      switch (input.kind) {
        case "tick": {
          const { closed } = windowTick(p.window, nowMs);
          return closed ? judgeClosed(s, closed, cfg) : res(s, []);
        }
        case "onset": {
          const r = windowOnset(
            p.window,
            mode,
            input.event,
            cfg.onsetDebounceMs,
          );
          if (r.closed) return judgeClosed(s, r.closed, cfg);
          const grew = r.window.hits.length > p.window.hits.length;
          return res(
            { ...s, phase: { kind: "listening", window: r.window } },
            grew ? [{ kind: "pulse", atMs: input.event.timestamp }] : [],
          );
        }
        case "replay-requested": {
          // Same Attempt: the window's hits are discarded, nothing is judged.
          const { effect, endMs } = playEffect(s, "replay", nowMs);
          return res({ ...s, phase: { kind: "replaying", endMs } }, [effect]);
        }
        case "input-mode":
          return res(listenAt(s, nowMs), []);
        case "kit-error":
          return res({ ...s, phase: { kind: "paused" } }, [
            { kind: "kit-error", error: input.error },
          ]);
        default:
          return res(s, []);
      }
    }
    case "paused":
      return input.kind === "resume"
        ? res(listenAt(s, nowMs), [{ kind: "cue", cue: "may-reply" }])
        : res(s, []);
    case "presenting":
    case "replaying":
      if (input.kind === "audio-failed") {
        const { effect } = playEffect(
          s,
          p.kind === "presenting" ? "presence" : "replay",
          nowMs,
        );
        return res(
          {
            ...s,
            phase: { kind: "awaiting-audio", pending: effect, from: p.kind },
          },
          [{ kind: "audio-unavailable" }],
        );
      }
      return res(s, []);
    case "awaiting-audio":
      if (input.kind === "audio-retry") {
        const { effect, endMs } = playEffect(
          s,
          p.pending.role === "presence" ? "presence" : "replay",
          nowMs,
        );
        return res({ ...s, phase: { kind: p.from, endMs } }, [effect]);
      }
      return res(s, []);
    case "refusing":
      return nowMs >= p.untilMs
        ? res({ ...s, phase: { kind: "done" } }, [], { kind: "refused" })
        : res(s, []);
    default:
      return res(s, []);
  }
}
