import type { Ms } from "@earworm/core";
import type { SittingConfig } from "../../story/types.js";
import { acceptOnset, type Counting } from "../accept.js";
import { KNOCK_DURATION_MS } from "../constants.js";
import type {
  Effect,
  InputMode,
  RandomSource,
  SittingInput,
  StepResult,
} from "../types.js";

export interface AnsweringState {
  readonly phase: "intro" | "answering" | "draining" | "halted" | "finished";
  readonly t0Ms: Ms | null;
  readonly counting: Counting;
  readonly pending: readonly { atMs: Ms; endMs: Ms }[]; // scheduled answer knocks
}

// Closed counting range: nothing is accepted until intro-finished opens the period.
const CLOSED: Counting = { fromMs: 0, toMs: 0, lastAcceptedMs: null };

export function startAnswering(): StepResult<AnsweringState> {
  return {
    state: { phase: "intro", t0Ms: null, counting: CLOSED, pending: [] },
    effects: [],
    wakeAtMs: null,
  };
}

function doneAt(s: AnsweringState, cfg: SittingConfig): Ms | null {
  if (s.t0Ms === null) return null;
  const ends = s.pending.map((p) => p.endMs);
  return Math.max(s.t0Ms + cfg.answeringPeriodMs, ...ends);
}

export function stepAnswering(
  s: AnsweringState,
  input: SittingInput,
  nowMs: Ms,
  cfg: SittingConfig,
  mode: InputMode,
  random: RandomSource,
): StepResult<AnsweringState> {
  const out = (
    state: AnsweringState,
    effects: readonly Effect[] = [],
  ): StepResult<AnsweringState> => ({
    state,
    effects,
    wakeAtMs: state.phase === "answering" || state.phase === "draining" ? doneAt(state, cfg) : null,
  });

  if (s.phase === "halted" || s.phase === "finished") return out(s);

  if (input.kind === "kit-error") {
    return {
      state: { ...s, phase: "halted", counting: CLOSED, pending: [] },
      effects: [{ kind: "cancel-plays" }],
      done: { kind: "halted", error: input.error },
      wakeAtMs: null,
    };
  }

  if (s.phase === "intro") {
    if (input.kind !== "intro-finished") return out(s);
    return out({
      phase: "answering",
      t0Ms: nowMs,
      counting: {
        fromMs: nowMs,
        toMs: nowMs + cfg.answeringPeriodMs,
        lastAcceptedMs: null,
      },
      pending: [],
    });
  }

  if (input.kind === "onset") {
    const t = input.event.timestamp;
    const live = s.pending.filter((p) => p.endMs > t);
    const room = live.length < cfg.maxPendingAnswers;
    const r = room
      ? acceptOnset(s.counting, mode, input.event, cfg.onsetDebounceMs)
      : { accepted: false, counting: s.counting };
    if (!r.accepted) return out({ ...s, pending: live });
    const u = Math.max(0, random()); // one draw per accepted onset
    const span = cfg.answerDelayMaxMs - cfg.answerDelayMinMs + 1;
    const d = Math.min(
      cfg.answerDelayMaxMs,
      cfg.answerDelayMinMs + Math.floor(u * span),
    );
    const atMs = t + d;
    return out(
      {
        ...s,
        counting: r.counting,
        pending: [...live, { atMs, endMs: atMs + KNOCK_DURATION_MS }],
      },
      [
        {
          kind: "play",
          id: `answer-${atMs}`,
          hits: [atMs],
          role: "answer",
          variant: "normal",
        },
        { kind: "pulse", atMs: t },
      ],
    );
  }

  if (input.kind === "tick") {
    const end = doneAt(s, cfg)!;
    if (nowMs >= end) {
      return {
        state: { ...s, phase: "finished" },
        effects: [],
        done: { kind: "completed" },
        wakeAtMs: null,
      };
    }
    const phase = nowMs >= s.t0Ms! + cfg.answeringPeriodMs ? "draining" : s.phase;
    return out({ ...s, phase });
  }

  return out(s);
}
