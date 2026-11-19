// Story_Script types. App-specific data, so they stay in the App (Requirement 16.1).
// The story layer may import only types from @earworm/core; none are needed here.

export type SittingType = "copy" | "lead" | "spot" | "answer" | "hold";

export interface KnockPatternData {
  readonly intervals: readonly number[]; // ms between hits; hits = intervals.length + 1
}

export interface SittingData {
  readonly number: 1 | 2 | 3 | 4 | 5;
  readonly type: SittingType;
  readonly title: string;
  readonly intro: string; // Presence line shown when the Sitting begins
  readonly answer?: string; // Sittings 1 to 4
  readonly endings?: { readonly broke: string; readonly held: string }; // Sitting 5
  readonly patterns?: readonly KnockPatternData[]; // Sitting 2: 1, Sitting 5: 5
}

export interface SittingConfig {
  readonly passThreshold: number;
  readonly attemptsPerRound: number;
  readonly onsetDebounceMs: number;
  readonly minReplyHits: 2;
  readonly maxReplyHits: number;
  readonly copyDelayMs: number;
  readonly minGapMs: number;
  readonly answeringPeriodMs: number;
  readonly answerDelayMinMs: number;
  readonly answerDelayMaxMs: number;
  readonly maxPendingAnswers: number;
  readonly holdPatternCount: 5;
  readonly patternGapMs: number;
  readonly silenceDurationMs: number;
  readonly quietPeakGainLimit: number;
}

export interface SuddenSoundData {
  readonly id: string;
  readonly voice: string; // a Synth Voice name
  readonly frequency?: number;
  readonly durationMs?: number;
  readonly onGain: number; // 0..1
  readonly offGain: number; // 0..quietPeakGainLimit
  readonly caption: string; // text equivalent
  readonly trigger: {
    readonly sitting: number;
    readonly at: "sitting-start" | "answer-reveal" | "refusal";
  };
}

/** One entry per Dread_Level; the array index is the level (0..5). */
export interface DreadSettings {
  readonly ambientGain: number; // 0..0.15
  readonly brightness: number; // 0..1
  readonly flicker: number; // 0..1, ignored when reduced motion is set
}

export interface StoryScript {
  readonly config: SittingConfig;
  readonly sittings: readonly SittingData[];
  readonly lines: {
    readonly again: readonly string[];
    readonly slower: readonly string[];
    readonly silence: readonly string[];
    readonly tooMany: readonly string[];
    readonly tooFew: readonly string[];
    readonly timing: readonly string[];
    readonly refusal: {
      readonly 2: readonly string[];
      readonly 3: readonly string[];
    };
    readonly wasntYours: string; // "One of those wasn't yours."
  };
  readonly sounds: {
    readonly knockGain: number;
    readonly knockReplayGainDread3: number;
    readonly successGain: number;
    readonly refusalGain: number;
    readonly sudden: readonly SuddenSoundData[];
  };
  readonly dread: readonly DreadSettings[]; // exactly 6
  readonly ambient: { readonly rampMs: number }; // >= 1000
}

export type Rule =
  | "empty-script"
  | "duplicate-sitting"
  | "wrong-sitting-count"
  | "wrong-sitting-type"
  | "missing-answer"
  | "extra-answer"
  | "missing-ending"
  | "extra-ending"
  | "broke-forbidden-word"
  | "missing-pattern"
  | "extra-pattern"
  | "pattern-limit"
  | "duplicate-pattern"
  | "gain-limit"
  | "config-missing"
  | "config-range"
  | "dread-table";

export interface StoryIssue {
  readonly rule: Rule;
  readonly sitting?: number; // 1..5 when the issue belongs to a Sitting
  readonly sudden?: string; // Sudden_Sound id
  readonly setting?: string; // Sitting_Config name
  readonly message: string; // always names the sitting / sound / setting and the rule
}

export type ValidationResult =
  | { ok: true; value: StoryScript }
  | { ok: false; issues: readonly StoryIssue[] };

/**
 * Valid range of one Sitting_Config value (requirements Glossary table).
 * `min`/`max` may name another setting, for the answer delay pair.
 */
export interface ConfigRange {
  readonly min: number | keyof SittingConfig;
  readonly max: number | keyof SittingConfig;
}

export const CONFIG_SPEC: { readonly [K in keyof SittingConfig]: ConfigRange } =
  {
    passThreshold: { min: 0, max: 1 },
    attemptsPerRound: { min: 1, max: 10 },
    onsetDebounceMs: { min: 0, max: 1_000 },
    minReplyHits: { min: 2, max: 2 },
    maxReplyHits: { min: 2, max: 7 },
    copyDelayMs: { min: 500, max: 5_000 },
    minGapMs: { min: 100, max: 1_000 },
    answeringPeriodMs: { min: 10_000, max: 300_000 },
    answerDelayMinMs: { min: 100, max: "answerDelayMaxMs" },
    answerDelayMaxMs: { min: "answerDelayMinMs", max: 5_000 },
    maxPendingAnswers: { min: 1, max: 16 },
    holdPatternCount: { min: 5, max: 5 },
    patternGapMs: { min: 500, max: 5_000 },
    silenceDurationMs: { min: 5_000, max: 60_000 },
    quietPeakGainLimit: { min: 0, max: 1 },
  };
