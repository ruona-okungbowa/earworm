import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseRecording, serialiseRecording } from "@earworm/core";
import type { Recording } from "@earworm/core";
import { recordingEventsArb } from "../../helpers/events.js";
import { pbtParams } from "../../helpers/pbt.js";

// Feature: earworm-kit, Property 38: Recording round trip
// **Validates: Requirements 14.2, 14.3, 14.7, 14.8, 21.4, 21.5, 21.7, 21.8**

const recordingArb: fc.Arbitrary<Recording> = recordingEventsArb.map(
  (events) => ({ version: 1 as const, events }),
);

describe("Feature: earworm-kit, Property 38: Recording round trip", () => {
  it("parse(serialise(r)) is ok and equals r", () => {
    fc.assert(
      fc.property(recordingArb, (r) => {
        const parsed = parseRecording(serialiseRecording(r));
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value).toEqual(r);
        r.events.forEach((e, i) => {
          const back = parsed.value.events[i];
          if (e.type === "spectrum" && back?.type === "spectrum") {
            expect(back.magnitudes).toBeInstanceOf(Float32Array);
            expect(Array.from(back.magnitudes)).toEqual(
              Array.from(e.magnitudes),
            );
          }
          if (e.type.startsWith("x-")) {
            expect(back?.type).toBe(e.type);
            expect(back).toEqual(e);
          }
        });
      }),
      pbtParams(),
    );
  });

  it("serialise(parse(serialise(r))) equals serialise(r)", () => {
    fc.assert(
      fc.property(recordingArb, (r) => {
        const text = serialiseRecording(r);
        const parsed = parseRecording(text);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(serialiseRecording(parsed.value)).toBe(text);
      }),
      pbtParams(),
    );
  });

  it("holds Events only, with plain JSON arrays and objects", () => {
    fc.assert(
      fc.property(recordingArb, (r) => {
        const json: unknown = JSON.parse(serialiseRecording(r));
        expect(Object.keys(json as object).sort()).toEqual([
          "events",
          "version",
        ]);
        const events = (json as { events: Record<string, unknown>[] }).events;
        expect(events).toHaveLength(r.events.length);
        events.forEach((e, i) => {
          const src = r.events[i];
          if (src?.type === "spectrum") {
            expect(Array.isArray(e["magnitudes"])).toBe(true);
            expect(e["magnitudes"]).toHaveLength(src.magnitudes.length);
          }
          if (src?.type === "band") {
            const values = e["values"];
            expect(Array.isArray(values)).toBe(false);
            expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
            expect(Object.keys(values as object).sort()).toEqual(
              Object.keys(src.values).sort(),
            );
          }
        });
      }),
      pbtParams(),
    );
  });
});
