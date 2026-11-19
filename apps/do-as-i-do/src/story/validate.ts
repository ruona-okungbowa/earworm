// Pure Story_Script validation. No clock, never throws, collects every issue (Req 16.6-16.13).
import {
  CONFIG_SPEC,
  type Rule,
  type SittingConfig,
  type StoryIssue,
  type StoryScript,
  type ValidationResult,
} from "./types";

const TYPES = ["copy", "lead", "spot", "answer", "hold"] as const;
const FORBIDDEN = /\b(knock|knocked|tap|tapped|rap|rapped)\b/i;
const AMBIENT_MAX = 0.15;
const DISTINCT_MS = 5;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

export function validateStoryScript(input: unknown): ValidationResult {
  const issues: StoryIssue[] = [];
  try {
    run(input, issues);
  } catch (e) {
    issues.push({
      rule: "empty-script",
      message: `Story_Script could not be read (empty-script): ${String(e)}`,
    });
  }
  if (issues.length === 0) return { ok: true, value: input as StoryScript };
  // Stable sort: script-wide issues first, then by Sitting number.
  const sorted = issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => (a.issue.sitting ?? 0) - (b.issue.sitting ?? 0) || a.i - b.i)
    .map((x) => x.issue);
  return { ok: false, issues: sorted };
}

function run(input: unknown, issues: StoryIssue[]): void {
  const add = (
    rule: Rule,
    message: string,
    extra: Partial<StoryIssue> = {},
  ): void => {
    issues.push({ rule, message, ...extra });
  };

  if (!isRec(input)) {
    add("empty-script", "Story_Script is empty (empty-script): not an object");
    return;
  }

  const limit = checkConfig(input['config'], add);

  // Sittings
  const sittings = Array.isArray(input['sittings']) ? input['sittings'] : [];
  if (sittings.length === 0) {
    add("empty-script", "Story_Script is empty (empty-script): it has no Sittings");
  } else {
    if (sittings.length !== 5) {
      add(
        "wrong-sitting-count",
        `Story_Script has ${sittings.length} Sittings, expected 5 (wrong-sitting-count)`,
      );
    }
    const seen = new Set<unknown>();
    const patterns: { sitting: number; intervals: number[] }[] = [];
    const holdCount = isRec(input['config']) && isNum(input['config']['holdPatternCount'])
      ? input['config']['holdPatternCount']
      : 5;
    sittings.forEach((s, idx) => {
      if (!isRec(s)) {
        add("wrong-sitting-count", `Sitting at position ${idx + 1} is not an object (wrong-sitting-count)`, { sitting: idx + 1 });
        return;
      }
      const n = s['number'];
      if (!isNum(n) || !Number.isInteger(n) || n < 1 || n > 5) {
        add("wrong-sitting-count", `Sitting at position ${idx + 1} has number ${String(n)}, expected 1 to 5 (wrong-sitting-count)`, { sitting: idx + 1 });
        return;
      }
      const at = { sitting: n };
      if (seen.has(n)) {
        add("duplicate-sitting", `Sitting ${n} is duplicated (duplicate-sitting)`, at);
      }
      seen.add(n);
      if (n !== idx + 1) {
        add("wrong-sitting-count", `Sitting ${n} is at position ${idx + 1}, Sittings must be in order 1 to 5 (wrong-sitting-count)`, at);
      }
      if (s['type'] !== TYPES[n - 1]) {
        add("wrong-sitting-type", `Sitting ${n} has type ${String(s['type'])}, expected ${TYPES[n - 1]} (wrong-sitting-type)`, at);
      }

      // Answers and Endings
      if (n <= 4) {
        if (Array.isArray(s['answer'])) {
          add("extra-answer", `Sitting ${n} has more than one Answer (extra-answer)`, at);
        } else if (!isText(s['answer'])) {
          add("missing-answer", `Sitting ${n} has no Answer (missing-answer)`, at);
        }
        if (s['endings'] !== undefined) {
          add("extra-ending", `Sitting ${n} must not have Endings (extra-ending)`, at);
        }
      } else {
        if (s['answer'] !== undefined) {
          add("extra-answer", `Sitting 5 must have no Answer, only Endings (extra-answer)`, at);
        }
        const e = s['endings'];
        if (!isRec(e)) {
          add("missing-ending", `Sitting 5 has no Endings, expected "broke" and "held" (missing-ending)`, at);
        } else {
          for (const key of ["broke", "held"]) {
            if (!isText(e[key])) {
              add("missing-ending", `Sitting 5 is missing the "${key}" Ending (missing-ending)`, at);
            }
          }
          for (const key of Object.keys(e)) {
            if (key !== "broke" && key !== "held") {
              add("extra-ending", `Sitting 5 has an unexpected Ending "${key}" (extra-ending)`, at);
            }
          }
          if (typeof e['broke'] === "string" && FORBIDDEN.test(e['broke'])) {
            add("broke-forbidden-word", `Sitting 5 "broke" Ending contains a forbidden word (broke-forbidden-word): ${FORBIDDEN.exec(e['broke'])?.[0]}`, at);
          }
        }
      }

      // Knock_Patterns
      const expected = n === 2 ? 1 : n === 5 ? holdCount : 0;
      const ps = s['patterns'] === undefined ? [] : s['patterns'];
      if (!Array.isArray(ps)) {
        add("missing-pattern", `Sitting ${n} patterns is not a list (missing-pattern)`, at);
        return;
      }
      if (ps.length < expected) {
        add("missing-pattern", `Sitting ${n} has ${ps.length} Knock_Patterns, expected ${expected} (missing-pattern)`, at);
      } else if (ps.length > expected) {
        add("extra-pattern", `Sitting ${n} has ${ps.length} Knock_Patterns, expected ${expected} (extra-pattern)`, at);
      }
      ps.forEach((p, pi) => {
        const iv = isRec(p) ? p['intervals'] : undefined;
        if (!Array.isArray(iv) || !iv.every((x) => isNum(x) && x > 0)) {
          add("pattern-limit", `Sitting ${n} Knock_Pattern ${pi + 1} needs a list of positive intervals (pattern-limit)`, at);
          return;
        }
        const hits = iv.length + 1;
        const total = (iv as number[]).reduce((a, b) => a + b, 0);
        if (hits < 3 || hits > 8) {
          add("pattern-limit", `Sitting ${n} Knock_Pattern ${pi + 1} has ${hits} hits, expected 3 to 8 (pattern-limit)`, at);
        }
        if (total < 1500 || total > 6000) {
          add("pattern-limit", `Sitting ${n} Knock_Pattern ${pi + 1} lasts ${total} ms, expected 1500 to 6000 ms (pattern-limit)`, at);
        }
        const prev = patterns.find(
          (q) =>
            q.intervals.length === iv.length &&
            q.intervals.every((x, i) => Math.abs(x - (iv as number[])[i]!) <= DISTINCT_MS),
        );
        if (prev) {
          add("duplicate-pattern", `Sitting ${n} Knock_Pattern ${pi + 1} is not distinct from a Knock_Pattern of Sitting ${prev.sitting} (duplicate-pattern)`, at);
        }
        patterns.push({ sitting: n, intervals: iv as number[] });
      });
    });
  }

  // Sounds
  const sounds = input['sounds'];
  if (!isRec(sounds)) {
    add("gain-limit", "Story_Script has no sounds section (gain-limit)", { setting: "sounds" });
  } else {
    for (const k of ["knockGain", "knockReplayGainDread3", "successGain", "refusalGain"]) {
      const g = sounds[k];
      if (!isNum(g) || g < 0 || (limit !== undefined && g > limit)) {
        add("gain-limit", `Sound setting ${k} is ${String(g)}, expected 0 to quietPeakGainLimit${limit === undefined ? "" : ` (${limit})`} (gain-limit)`, { setting: k });
      }
    }
    const sudden = Array.isArray(sounds['sudden']) ? sounds['sudden'] : [];
    sudden.forEach((d, i) => {
      if (!isRec(d)) {
        add("gain-limit", `Sudden_Sound ${i + 1} is not an object (gain-limit)`, { sudden: String(i + 1) });
        return;
      }
      const id = typeof d['id'] === "string" ? d['id'] : String(i + 1);
      const sitting = isRec(d['trigger']) && isNum(d['trigger']['sitting']) ? d['trigger']['sitting'] : undefined;
      const at = sitting === undefined ? { sudden: id } : { sudden: id, sitting };
      if (!isNum(d['onGain']) || d['onGain'] < 0 || d['onGain'] > 1) {
        add("gain-limit", `Sudden_Sound ${id} on-gain is ${String(d['onGain'])}, expected 0 to 1 (gain-limit)`, at);
      }
      if (!isNum(d['offGain']) || d['offGain'] < 0 || (limit !== undefined && d['offGain'] > limit)) {
        add("gain-limit", `Sudden_Sound ${id} off-gain is ${String(d['offGain'])}, expected 0 to quietPeakGainLimit${limit === undefined ? "" : ` (${limit})`} (gain-limit)`, at);
      }
    });
  }

  // Dread table and ambient
  const dread = input['dread'];
  if (!Array.isArray(dread) || dread.length !== 6) {
    add("dread-table", `Dread table has ${Array.isArray(dread) ? dread.length : "no"} entries, expected exactly 6 (dread-table)`, { setting: "dread" });
  } else {
    dread.forEach((d, i) => {
      const g = isRec(d) ? d['ambientGain'] : undefined;
      if (!isNum(g) || g < 0 || g > AMBIENT_MAX) {
        add("gain-limit", `Dread level ${i} ambientGain is ${String(g)}, expected 0 to ${AMBIENT_MAX} (gain-limit)`, { setting: `dread[${i}].ambientGain` });
      }
      for (const k of ["brightness", "flicker"]) {
        const v = isRec(d) ? d[k] : undefined;
        if (!isNum(v) || v < 0 || v > 1) {
          add("dread-table", `Dread level ${i} ${k} is ${String(v)}, expected 0 to 1 (dread-table)`, { setting: `dread[${i}].${k}` });
        }
      }
    });
  }
  const ramp = isRec(input['ambient']) ? input['ambient']['rampMs'] : undefined;
  if (!isNum(ramp) || ramp < 1000) {
    add("config-range", `ambient.rampMs is ${String(ramp)}, expected at least 1000 (config-range)`, { setting: "ambient.rampMs" });
  }
}

/** Checks Sitting_Config; returns quietPeakGainLimit when usable. */
function checkConfig(
  config: unknown,
  add: (rule: Rule, message: string, extra?: Partial<StoryIssue>) => void,
): number | undefined {
  if (!isRec(config)) {
    add("config-missing", "Sitting_Config is missing (config-missing)", { setting: "config" });
    return undefined;
  }
  const value = (name: string): number | undefined =>
    isNum(config[name]) ? config[name] : undefined;
  for (const name of Object.keys(CONFIG_SPEC) as (keyof SittingConfig)[]) {
    const v = value(name);
    if (v === undefined) {
      add("config-missing", `Setting ${name} is missing or not a number (config-missing)`, { setting: name });
      continue;
    }
    const { min, max } = CONFIG_SPEC[name];
    const lo = typeof min === "number" ? min : value(min);
    const hi = typeof max === "number" ? max : value(max);
    if ((lo !== undefined && v < lo) || (hi !== undefined && v > hi)) {
      add("config-range", `Setting ${name} is ${v}, expected ${String(min)} to ${String(max)} (config-range)`, { setting: name });
    }
  }
  return value("quietPeakGainLimit");
}
