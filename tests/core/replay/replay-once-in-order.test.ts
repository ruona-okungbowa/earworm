import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createReplaySource } from "@earworm/core";
import type { EarwormEvent, Recording } from "@earworm/core";
import { recordingEventsArb, timestampArb } from "../../helpers/events.js";
import { pbtParams } from "../../helpers/pbt.js";

// Feature: earworm-kit, Property 40: Replay emits each Event once in order
// **Validates: Requirements 14.10, 14.11, 14.15, 21.2, 21.9**

/** Recording whose timestamps are often snapped to a coarse grid so ties are common. */
const recordingArb: fc.Arbitrary<Recording> = fc
  .tuple(recordingEventsArb, fc.boolean())
  .map(([events, coarse]) => ({
    version: 1 as const,
    events: coarse
      ? events.map((e) => ({
          ...e,
          timestamp: Math.round(e.timestamp / 1e8) * 1e8 + 0,
        }))
      : events,
  }));

/** A recording plus advance times: arbitrary values and values at recorded timestamps. */
const scenarioArb = recordingArb.chain((r) => {
  const own = r.events.map((e) => e.timestamp);
  const nowArb =
    own.length > 0
      ? fc.oneof(timestampArb, fc.constantFrom(...own))
      : timestampArb;
  return fc.record({
    r: fc.constant(r),
    nows: fc.array(nowArb, { maxLength: 12 }),
  });
});

describe("Feature: earworm-kit, Property 40: Replay emits each Event once in order", () => {
  it("emits each Event with timestamp <= max now exactly once, stable and in order", () => {
    fc.assert(
      fc.property(scenarioArb, ({ r, nows }) => {
        const before = structuredClone(r);
        const eventsRef = [...r.events];
        const source = createReplaySource(r);
        const got: EarwormEvent[] = [];
        source.subscribe((e) => got.push(e));

        let maxNow = -Infinity;
        for (const now of nows) {
          const countBefore = got.length;
          const wasMax = maxNow;
          source.advance(now);
          if (now <= wasMax) {
            // A smaller (or equal) now emits nothing.
            expect(got.length).toBe(countBefore);
          }
          maxNow = Math.max(maxNow, now);

          // Everything emitted so far is exactly the Events <= maxNow.
          const expected = r.events
            .map((e, i) => ({ e, i }))
            .filter(({ e }) => e.timestamp <= maxNow)
            .sort((a, b) => a.e.timestamp - b.e.timestamp || a.i - b.i)
            .map(({ e }) => e);
          expect(got.length).toBe(expected.length);
          got.forEach((e, i) => expect(e).toBe(expected[i]));
        }

        // Non-decreasing timestamps overall; none beyond max now.
        for (let i = 1; i < got.length; i++) {
          expect(got[i]!.timestamp).toBeGreaterThanOrEqual(
            got[i - 1]!.timestamp,
          );
        }
        for (const e of got) expect(e.timestamp).toBeLessThanOrEqual(maxNow);

        // Each Event once, with its recorded source.
        expect(new Set(got).size).toBe(got.length);
        got.forEach((e) => {
          const orig = r.events.find((o) => o === e);
          expect(orig).toBeDefined();
          expect(e.source).toBe(orig!.source);
        });

        // The Recording is not mutated.
        expect(r.events.length).toBe(eventsRef.length);
        r.events.forEach((e, i) => expect(e).toBe(eventsRef[i]));
        expect(r).toEqual(before);
      }),
      pbtParams(),
    );
  });

  it("a later advance past all timestamps emits the whole Recording once", () => {
    fc.assert(
      fc.property(recordingArb, fc.nat({ max: 3 }), (r, repeats) => {
        const source = createReplaySource(r);
        const got: EarwormEvent[] = [];
        source.subscribe((e) => got.push(e));
        for (let i = 0; i <= repeats; i++) source.advance(Infinity);
        expect(got.length).toBe(r.events.length);
      }),
      pbtParams(),
    );
  });

  it("an unsubscribed listener gets nothing further", () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat({ max: 12 }), ({ r, nows }, cut) => {
        const source = createReplaySource(r);
        const kept: EarwormEvent[] = [];
        const dropped: EarwormEvent[] = [];
        source.subscribe((e) => kept.push(e));
        const off = source.subscribe((e) => dropped.push(e));

        let frozen: number | undefined;
        nows.forEach((now, i) => {
          if (i === cut) {
            off();
            frozen = dropped.length;
          }
          source.advance(now);
        });
        if (frozen !== undefined) expect(dropped.length).toBe(frozen);
        else expect(dropped).toEqual(kept);
      }),
      pbtParams(),
    );
  });
});
