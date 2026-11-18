import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSoundDetector } from "@earworm/core";
import type { EarwormEvent, Frame } from "@earworm/core";
import { frameSequence } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";
import { createSoundModel } from "../../../helpers/sound-model";
import type { ModelEvent } from "../../../helpers/sound-model";

// Feature: earworm-kit, Property 47: Sound Detector matches the state machine model
// **Validates: Requirements 18.1, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10, 18.12**

const START = 12;
const END = 6;
/**
 * Level offsets above the Noise_Floor, each at least 1 dB from a threshold so Float32
 * rounding cannot flip a comparison: below end, between end and start, above start.
 */
const OFFSETS = [-10, 2, 4, 9, 15, 30] as const;

type Op = "none" | "flush" | "reset";

const scenarioArb = fc
  .record({
    minHold: fc.integer({ min: 0, max: 60 }),
    hangover: fc.integer({ min: 0, max: 120 }),
    noiseFloor: fc.integer({ min: -70, max: -40 }),
  })
  .chain((cfg) =>
    fc.record({
      cfg: fc.constant(cfg),
      frames: frameSequence({
        frameSize: 512,
        minLength: 1,
        maxLength: 80,
        inject: ["empty", "non-finite-sample", "stale-timestamp"],
      }),
      // Runs of one level class so sounds actually open, hold and close.
      levels: fc.array(
        fc.tuple(fc.constantFrom(...OFFSETS), fc.integer({ min: 1, max: 15 })),
        { minLength: 1, maxLength: 12 },
      ),
      ops: fc.array(
        fc.constantFrom<Op>(
          "none",
          "none",
          "none",
          "none",
          "none",
          "none",
          "flush",
          "reset",
        ),
        { maxLength: 80 },
      ),
    }),
  );

/** Rescales the samples of a Frame so its level is `db` dBFS. */
function withLevel(frame: Frame, db: number): Frame {
  let sum = 0;
  for (const s of frame.samples) sum += s * s;
  const rms = Math.sqrt(sum / frame.samples.length);
  const gain = rms > 0 ? Math.pow(10, db / 20) / rms : 0;
  return { ...frame, samples: frame.samples.map((s) => s * gain) };
}

function plain(events: EarwormEvent[]): ModelEvent[] {
  return events.map((e) => {
    if (e.type === "sound-start") {
      return {
        type: "sound-start",
        timestamp: e.timestamp,
        startTime: e.startTime,
        level: e.level,
      };
    }
    if (e.type === "sound-end") {
      return {
        type: "sound-end",
        timestamp: e.timestamp,
        endTime: e.endTime,
        duration: e.duration,
      };
    }
    throw new Error(`unexpected event type ${e.type}`);
  });
}

describe("Property 47: Sound Detector matches the state machine model", () => {
  it("emits the same Events as the reference model for any Frame, flush and reset sequence", () => {
    fc.assert(
      fc.property(scenarioArb, ({ cfg, frames, levels, ops }) => {
        const created = createSoundDetector({
          startThreshold: START,
          endThreshold: END,
          minHold: cfg.minHold,
          hangover: cfg.hangover,
        });
        if (!created.ok) throw new Error("detector construction failed");
        const detector = created.value;
        expect(detector.setNoiseFloor(cfg.noiseFloor).ok).toBe(true);
        const model = createSoundModel({
          startThreshold: START,
          endThreshold: END,
          minHold: cfg.minHold,
          hangover: cfg.hangover,
          noiseFloor: cfg.noiseFloor,
        });

        const classes = levels.flatMap(([offset, n]) =>
          Array.from({ length: n }, () => offset),
        );
        const actual: ModelEvent[] = [];
        const expected: ModelEvent[] = [];
        const segments: ModelEvent[][] = [];
        let segmentStart = 0;

        frames.forEach((tagged, i) => {
          const offset = classes[i % classes.length]!;
          const frame = tagged.valid
            ? withLevel(tagged.frame, cfg.noiseFloor + offset)
            : tagged.frame;
          actual.push(...plain(detector.process(frame)));
          expected.push(...model.process(frame));
          expect(actual).toEqual(expected);

          const op = ops[i] ?? "none";
          if (op === "flush") {
            actual.push(...plain(detector.flush?.() ?? []));
            expected.push(...model.flush());
          } else if (op === "reset") {
            expect(detector.reset?.()).toBeUndefined();
            model.reset();
            segments.push(actual.slice(segmentStart));
            segmentStart = actual.length;
          }
          expect(actual).toEqual(expected);
        });
        actual.push(...plain(detector.flush?.() ?? []));
        expected.push(...model.flush());
        expect(actual).toEqual(expected);
        segments.push(actual.slice(segmentStart));

        // 18.8, 18.9: within each span between resets, strict alternation from a
        // start, durations at least Min_Hold. reset() may drop an open sound (18.12).
        for (const segment of segments) {
          let open = false;
          for (const e of segment) {
            if (e.type === "sound-start") {
              expect(open).toBe(false);
              open = true;
            } else {
              expect(open).toBe(true);
              open = false;
              expect(Number.isFinite(e.duration)).toBe(true);
              expect(e.duration).toBeGreaterThanOrEqual(cfg.minHold);
            }
          }
        }
        // The final flush closes any sound opened after the last reset.
        const last = segments[segments.length - 1]!;
        if (last.length > 0)
          expect(last[last.length - 1]!.type).toBe("sound-end");
      }),
      pbtParams(),
    );
  });

  it("emits nothing from reset() and nothing from flush() with no open sound", () => {
    const created = createSoundDetector();
    if (!created.ok) throw new Error("detector construction failed");
    const detector = created.value;
    expect(detector.flush?.()).toEqual([]);
    const loud = new Float32Array(128).fill(0.5);
    detector.process({ samples: loud, timestamp: 0, sampleRate: 48000 });
    detector.process({ samples: loud, timestamp: 40, sampleRate: 48000 });
    detector.reset?.();
    expect(detector.flush?.()).toEqual([]);
  });
});
