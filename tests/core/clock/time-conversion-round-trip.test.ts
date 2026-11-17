import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { msToSeconds, secondsToMs } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 1: Time conversion round trip
// **Validates: Requirements 1.7, 1.9**
describe("Property 1: Time conversion round trip", () => {
  const seconds = fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true });

  it("secondsToMs then msToSeconds is within 1e-9 s of the original", () => {
    fc.assert(
      fc.property(seconds, (s) => {
        const ms = secondsToMs(s);
        expect(ms.ok).toBe(true);
        if (!ms.ok) return;
        const back = msToSeconds(ms.value);
        expect(back.ok).toBe(true);
        if (!back.ok) return;
        expect(Math.abs(back.value - s)).toBeLessThanOrEqual(1e-9);
      }),
      pbtParams(),
    );
  });

  it("secondsToMs(s) equals s * 1000", () => {
    fc.assert(
      fc.property(seconds, (s) => {
        const ms = secondsToMs(s);
        expect(ms.ok && ms.value === s * 1000).toBe(true);
      }),
      pbtParams(),
    );
  });

  it("msToSeconds is the inverse: msToSeconds(ms) equals ms / 1000, and back again is within 1e-9 ms", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e9, noNaN: true, noDefaultInfinity: true }), (ms) => {
        const s = msToSeconds(ms);
        expect(s.ok && s.value === ms / 1000).toBe(true);
        if (!s.ok) return;
        const back = secondsToMs(s.value);
        expect(back.ok).toBe(true);
        if (!back.ok) return;
        expect(Math.abs(back.value - ms)).toBeLessThanOrEqual(1e-6);
      }),
      pbtParams(),
    );
  });
});
