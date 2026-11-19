import type { EventSourceName, KitError, Ms } from "@earworm/core";

export type RandomSource = () => number; // [0, 1)
export type InputMode = "mic" | "tap";

export interface OnsetLike {
  readonly timestamp: Ms;
  readonly source: EventSourceName;
}

export type LineKey =
  | "again"
  | "slower"
  | "silence"
  | "too-many"
  | "too-few"
  | "timing"
  | "refusal"
  | "intro"
  | "retry-audio";

export type Effect =
  | {
      kind: "play";
      id: string;
      hits: readonly Ms[];
      role: "presence" | "replay" | "copy" | "answer" | "hold";
      variant: "normal" | "dread3";
    }
  | { kind: "cancel-plays" }
  | { kind: "line"; key: LineKey; index: number }
  | { kind: "text"; text: string }
  | { kind: "cue"; cue: "may-reply" | "stay-silent" | "again" }
  | { kind: "pulse"; atMs: Ms }
  | { kind: "sound"; sound: "success" | "refusal" }
  | { kind: "kit-error"; error: KitError }
  | { kind: "audio-unavailable" };

export type SittingInput =
  | { kind: "tick" }
  | { kind: "onset"; event: OnsetLike }
  | { kind: "replay-requested" }
  | { kind: "input-mode"; mode: InputMode }
  | { kind: "kit-error"; error: KitError }
  | { kind: "resume" }
  | { kind: "audio-failed" }
  | { kind: "audio-retry" }
  | { kind: "intro-finished" };

export type SittingResult =
  | { kind: "completed"; ending?: "broke" | "held" }
  | { kind: "refused" }
  | { kind: "halted"; error: KitError };

export interface StepResult<S> {
  readonly state: S;
  readonly effects: readonly Effect[];
  readonly done?: SittingResult;
  readonly wakeAtMs: Ms | null; // next deadline the Driver must tick at, or null
}
