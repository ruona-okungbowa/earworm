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
import { planPlayback } from "./playback.js";
import type {
  Effect,
  InputMode,
  SittingInput,
  StepResult,
} from "./types.js";

// Sitting 1 machine. The reply is copied back as is: no judge, no match, no Attempts, no Refusal.
export type CopyState =
  | { phase: "listening"; window: ListeningWindow; againCount: number }
  | { phase: "reopening"; reopenAtMs: Ms; againCount: number }
  | { phase: "copying"; endMs: Ms; play: Effect }
  | { phase: "paused"; againCount: number }
  | { phase: "awaiting-audio"; endMs: Ms; play: Effect }
  | { phase: "finished" };

const MAY_REPLY: Effect = { kind: "cue", cue: "may-reply" };

function wakeOf(s: CopyState): Ms | null {
  switch (s.phase) {
    case "listening":
      return windowDeadline(s.window);
    case "reopening":
      return s.reopenAtMs;
    case "copying":
      return s.endMs;
    default:
      return null;
  }
}

function result(
  state: CopyState,
  effects: readonly Effect[],
  done?: StepResult<CopyState>["done"],
): StepResult<CopyState> {
  return done
    ? { state, effects, done, wakeAtMs: null }
    : { state, effects, wakeAtMs: wakeOf(state) };
}

function listen(
  startMs: Ms,
  cfg: SittingConfig,
  againCount: number,
): StepResult<CopyState> {
  return result(
    { phase: "listening", window: openWindow(startMs, cfg.maxReplyHits), againCount },
    [MAY_REPLY],
  );
}

export function startCopy(
  cfg: SittingConfig,
  _mode: InputMode,
  nowMs: Ms,
): StepResult<CopyState> {
  return listen(nowMs, cfg, 0);
}

function close(
  closed: Closed,
  againCount: number,
  cfg: SittingConfig,
  pre: readonly Effect[],
): StepResult<CopyState> {
  if (closed.hits.length < cfg.minReplyHits) {
    return result(
      {
        phase: "reopening",
        reopenAtMs: closed.endMs + REOPEN_DELAY_MS,
        againCount: againCount + 1,
      },
      [...pre, { kind: "line", key: "again", index: againCount }],
    );
  }
  const plan = planPlayback(closed.hits, closed.endMs + cfg.copyDelayMs);
  const play: Effect = {
    kind: "play",
    id: `copy-${closed.endMs}`,
    hits: plan.hits,
    role: "copy",
    variant: "normal",
  };
  return result({ phase: "copying", endMs: plan.endMs, play }, [...pre, play]);
}

export function stepCopy(
  s: CopyState,
  input: SittingInput,
  nowMs: Ms,
  cfg: SittingConfig,
  mode: InputMode,
): StepResult<CopyState> {
  switch (s.phase) {
    case "listening": {
      if (input.kind === "tick") {
        const { closed } = windowTick(s.window, nowMs);
        return closed ? close(closed, s.againCount, cfg, []) : result(s, []);
      }
      if (input.kind === "onset") {
        const r = windowOnset(s.window, mode, input.event, cfg.onsetDebounceMs);
        const pulse: Effect[] =
          r.window.hits.length > s.window.hits.length
            ? [{ kind: "pulse", atMs: input.event.timestamp }]
            : [];
        return r.closed
          ? close(r.closed, s.againCount, cfg, pulse)
          : result({ ...s, window: r.window }, pulse);
      }
      if (input.kind === "input-mode") {
        // Hits from the old mode are discarded; the new mode applies from now.
        return listen(nowMs, cfg, s.againCount);
      }
      if (input.kind === "kit-error") {
        return result({ phase: "paused", againCount: s.againCount }, [
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
        const opened = listen(at, cfg, s.againCount);
        const again = stepCopy(opened.state, input, nowMs, cfg, mode);
        return result(again.state, [...opened.effects, ...again.effects], again.done);
      }
      if (input.kind === "kit-error") {
        return result({ phase: "paused", againCount: s.againCount }, [
          { kind: "kit-error", error: input.error },
        ]);
      }
      return result(s, []);
    }
    case "copying": {
      if (input.kind === "tick" && nowMs >= s.endMs) {
        return result({ phase: "finished" }, [], { kind: "completed" });
      }
      if (input.kind === "audio-failed") {
        return result(
          { phase: "awaiting-audio", endMs: s.endMs, play: s.play },
          [{ kind: "cancel-plays" }, { kind: "audio-unavailable" }],
        );
      }
      return result(s, []); // Onsets are ignored until playback ends (Requirement 7.5).
    }
    case "awaiting-audio":
      return input.kind === "audio-retry"
        ? result({ phase: "copying", endMs: s.endMs, play: s.play }, [s.play])
        : result(s, []);
    case "paused":
      return input.kind === "resume"
        ? listen(nowMs, cfg, s.againCount)
        : result(s, []);
    case "finished":
      return result(s, []);
  }
}
