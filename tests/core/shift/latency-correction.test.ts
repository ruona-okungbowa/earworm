import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { shiftEvent } from "@earworm/core";
import type { EarwormEvent } from "@earworm/core";
import { customEventArb, eventArb, finiteIn } from "../../helpers/events";
import { pbtParams } from "../../helpers/pbt";

const latencyArb = finiteIn(0, 2000);
const TOLERANCE = 1e-6;

type Timed = { startTime?: number; endTime?: number };

// Feature: earworm-kit, Property 19: Latency correction
// **Validates: Requirements 6.4, 21.3**
describe("Property 19: Latency correction", () => {
  it("shifting by -latency lowers timestamp, startTime and endTime by the latency and leaves other fields unchanged", () => {
    fc.assert(
      fc.property(eventArb, latencyArb, (e, latency) => {
        const shifted = shiftEvent(e, -latency);
        const before = e as EarwormEvent & Timed;
        const after = shifted as EarwormEvent & Timed;

        expect(after.timestamp).toBe(e.timestamp - latency);
        if ("startTime" in e) expect(after.startTime).toBe(before.startTime! - latency);
        if ("endTime" in e) expect(after.endTime).toBe(before.endTime! - latency);

        // Every other field, including duration, data, source and type, is identical.
        const { timestamp: _t1, startTime: _s1, endTime: _e1, ...restBefore } = before;
        const { timestamp: _t2, startTime: _s2, endTime: _e2, ...restAfter } = after;
        expect(restAfter).toEqual(restBefore);
        expect(Object.keys(after).sort()).toEqual(Object.keys(e).sort());
        expect(after.type).toBe(e.type);
        expect(after.source).toBe(e.source);
      }),
      pbtParams(),
    );
  });

  it("does not mutate the input event", () => {
    fc.assert(
      fc.property(eventArb, latencyArb, (e, latency) => {
        const snapshot = structuredClone(e);
        const shifted = shiftEvent(e, -latency);
        expect(e).toEqual(snapshot);
        expect(shifted).not.toBe(e);
      }),
      pbtParams(),
    );
  });

  it("keeps type, source and data of Custom_Events", () => {
    fc.assert(
      fc.property(customEventArb, latencyArb, (e, latency) => {
        const shifted = shiftEvent(e, -latency);
        expect(shifted.type).toBe(e.type);
        expect(shifted.source).toBe(e.source);
        expect(shifted.data).toEqual(e.data);
        expect(shifted.timestamp).toBe(e.timestamp - latency);
      }),
      pbtParams(),
    );
  });

  it("shifting by -latency then +latency restores the original within float tolerance", () => {
    fc.assert(
      fc.property(eventArb, latencyArb, (e, latency) => {
        const back = shiftEvent(shiftEvent(e, -latency), latency);
        const before = e as EarwormEvent & Timed;
        const after = back as EarwormEvent & Timed;

        expect(Math.abs(after.timestamp - e.timestamp)).toBeLessThanOrEqual(TOLERANCE);
        if ("startTime" in e) {
          expect(Math.abs(after.startTime! - before.startTime!)).toBeLessThanOrEqual(TOLERANCE);
        }
        if ("endTime" in e) {
          expect(Math.abs(after.endTime! - before.endTime!)).toBeLessThanOrEqual(TOLERANCE);
        }
        expect(after.type).toBe(e.type);
        expect(after.source).toBe(e.source);
      }),
      pbtParams(),
    );
  });
});
