import { segment } from "@earworm/core";
import type { PitchEvent } from "@earworm/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pbtParams } from "../../helpers/pbt.js";
import { referencePitchSegments } from "../../helpers/segment-model.js";

// Feature: earworm-kit, Property 32: Pitch segmentation matches the reference
// **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.10**

const pitchEvent = (timestamp: number, frequency: number): PitchEvent => ({
  type: "pitch",
  timestamp,
  source: "mic",
  frequency,
  midi: 69,
  cents: 0,
  confidence: 1,
});

const eventsArb = fc
  .array(
    fc.record({
      delta: fc.oneof(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 200 }),
      ),
      // Mostly near one pitch so steady runs occur; sometimes a wide jump.
      frequency: fc.oneof(
        fc.double({ min: 400, max: 460, noNaN: true }),
        fc.double({ min: 80, max: 2000, noNaN: true }),
      ),
    }),
    { maxLength: 40 },
  )
  .map((items) => {
    let t = 0;
    return items.map((it) => {
      t += it.delta;
      return pitchEvent(t, it.frequency);
    });
  });

const cfgArb = fc.record({
  frameInterval: fc.integer({ min: 1, max: 30 }),
  maxGap: fc.integer({ min: 5, max: 100 }),
  minDuration: fc.integer({ min: 10, max: 150 }),
  steadiness: fc.double({ min: 5, max: 200, noNaN: true }),
  pitchSplit: fc.boolean(),
  pitchSplitThreshold: fc.double({ min: 10, max: 600, noNaN: true }),
});

describe("pitch segmentation matches the reference", () => {
  it("equals the naive reference and keeps Mark invariants", () => {
    fc.assert(
      fc.property(eventsArb, cfgArb, (events, cfg) => {
        const result = segment({ kind: "pitch", events }, cfg);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const marks = result.value;
        expect(marks).toEqual(referencePitchSegments(events, cfg));

        const timestamps = new Set(events.map((e) => e.timestamp));
        for (let i = 0; i < marks.length; i++) {
          const m = marks[i]!;
          expect(timestamps.has(m.start)).toBe(true);
          expect(m.duration).toBeGreaterThan(0);
          expect(m.duration).toBeGreaterThanOrEqual(cfg.minDuration);
          const next = marks[i + 1];
          if (next) {
            expect(next.start).toBeGreaterThanOrEqual(m.start);
            expect(next.start).toBeGreaterThanOrEqual(
              m.start + m.duration - cfg.frameInterval,
            );
          }
        }
      }),
      pbtParams(),
    );
  });

  it("gives no Marks for an empty list", () => {
    const result = segment(
      { kind: "pitch", events: [] },
      { frameInterval: 10 },
    );
    expect(result).toEqual({ ok: true, value: [] });
  });
});
