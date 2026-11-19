import { intervalsToPattern, type Ms } from "@earworm/core";
import type { StoryScript } from "../../story/types.js";
import { acceptOnset } from "../accept.js";
import type {
  Effect,
  InputMode,
  SittingInput,
  StepResult,
} from "../types.js";
import { planHold } from "./hold-plan.js";

// Sitting 5 machine. Onsets are ignored while the Patterns play; the first accepted onset in the silence breaks it.
export type HoldState =
  | { phase: "intro"; dread: number }
  | { phase: "playing"; silenceStartMs: Ms }
  | { phase: "silence"; silenceStartMs: Ms }
  | { phase: "finished" };

function out(
  state: HoldState,
  effects: readonly Effect[],
  wakeAtMs: Ms | null,
  done?: StepResult<HoldState>["done"],
): StepResult<HoldState> {
  return done
    ? { state, effects, done, wakeAtMs: null }
    : { state, effects, wakeAtMs };
}

export function startHold(dread: number): StepResult<HoldState> {
  return out({ phase: "intro", dread }, [], null);
}

export function stepHold(
  s: HoldState,
  input: SittingInput,
  nowMs: Ms,
  story: StoryScript,
  mode: InputMode,
): StepResult<HoldState> {
  const cfg = story.config;
  if (s.phase === "finished") return out(s, [], null);
  if (input.kind === "kit-error") {
    return out({ phase: "finished" }, [{ kind: "cancel-plays" }], null, {
      kind: "halted",
      error: input.error,
    });
  }
  switch (s.phase) {
    case "intro": {
      if (input.kind !== "intro-finished") return out(s, [], null);
      const patterns = (story.sittings[4]?.patterns ?? []).map((p) =>
        intervalsToPattern(p.intervals),
      );
      const plan = planHold(patterns, nowMs, cfg.patternGapMs);
      const plays: Effect[] = plan.plays.map((p, j) => ({
        kind: "play",
        id: `hold-${j}`,
        hits: p.hits,
        role: "hold",
        variant: s.dread >= 3 ? "dread3" : "normal",
      }));
      return out(
        { phase: "playing", silenceStartMs: plan.silenceStartMs },
        plays,
        plan.silenceStartMs,
      );
    }
    case "playing": {
      if (nowMs < s.silenceStartMs) return out(s, [], s.silenceStartMs); // every onset ignored
      const cue: Effect = { kind: "cue", cue: "stay-silent" };
      const next = stepHold(
        { phase: "silence", silenceStartMs: s.silenceStartMs },
        input,
        nowMs,
        story,
        mode,
      );
      return { ...next, effects: [cue, ...next.effects] };
    }
    case "silence": {
      const endMs = s.silenceStartMs + cfg.silenceDurationMs;
      if (input.kind === "onset") {
        // A late onset first closes the period.
        if (input.event.timestamp < endMs) {
          const r = acceptOnset(
            { fromMs: s.silenceStartMs, toMs: endMs, lastAcceptedMs: null },
            mode,
            input.event,
            cfg.onsetDebounceMs,
          );
          if (r.accepted) {
            return out(
              { phase: "finished" },
              [{ kind: "pulse", atMs: input.event.timestamp }],
              null,
              { kind: "completed", ending: "broke" },
            );
          }
          return out(s, [], endMs);
        }
      }
      if (nowMs >= endMs || (input.kind === "onset" && input.event.timestamp >= endMs)) {
        return out({ phase: "finished" }, [], null, {
          kind: "completed",
          ending: "held",
        });
      }
      return out(s, [], endMs);
    }
  }
}
