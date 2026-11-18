// Feature: earworm-kit, Property 25: Match score range, identity, shift and scale invariance
// **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.10**
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { match } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

/** Non-decreasing integer-ms pattern, 0 to 12 hits. */
const patternArb = fc
  .tuple(
    fc.integer({ min: -100_000, max: 100_000 }),
    fc.array(fc.integer({ min: 0, max: 2000 }), { maxLength: 11 }),
  )
  .map(([start, gaps]) => {
    const out = [start];
    for (const g of gaps) out.push((out[out.length - 1] as number) + g);
    return out;
  })
  .chain((p) => fc.constantFrom(p, p.slice(1)));

const offsetArb = fc.integer({ min: -1_000_000, max: 1_000_000 });
const factorArb = fc.double({ min: 0.05, max: 20, noNaN: true });

describe("Property 25: match score range, identity, shift and scale invariance", () => {
  it("score is finite in [0, 1] and result fields are well formed", () => {
    fc.assert(
      fc.property(patternArb, patternArb, (target, reply) => {
        const r = match(target, reply);
        expect(Number.isFinite(r.score)).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
        expect(r.missed).toBe(Math.max(0, target.length - reply.length));
        expect(r.extra).toBe(Math.max(0, reply.length - target.length));
        if (target.length === 0) {
          expect(r.largestError).toBeNull();
        } else {
          expect(r.largestError).not.toBeNull();
          expect(Number.isFinite(r.largestError!.ms)).toBe(true);
          expect(r.largestError!.ms).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(r.largestError!.index)).toBe(true);
          expect(r.largestError!.index).toBeGreaterThanOrEqual(0);
          expect(r.largestError!.index).toBeLessThan(target.length);
        }
      }),
      pbtParams(),
    );
  });

  it("identical patterns score 1", () => {
    fc.assert(
      fc.property(patternArb, (p) => {
        expect(match(p, [...p]).score).toBe(1);
      }),
      pbtParams(),
    );
  });

  it("shifting the reply by any offset leaves the result unchanged", () => {
    fc.assert(
      fc.property(patternArb, patternArb, offsetArb, (target, reply, offset) => {
        const base = match(target, reply);
        const shifted = match(
          target,
          reply.map((t) => t + offset),
        );
        expect(shifted.score).toBe(base.score);
        expect(shifted.missed).toBe(base.missed);
        expect(shifted.extra).toBe(base.extra);
        expect(shifted.tempoRatio).toBe(base.tempoRatio);
      }),
      pbtParams(),
    );
  });

  it("scaling the reply intervals by a positive factor keeps the score within 1e-9", () => {
    fc.assert(
      fc.property(patternArb, patternArb, factorArb, (target, reply, factor) => {
        const r0 = reply[0] ?? 0;
        const scaled = reply.map((t) => r0 + (t - r0) * factor);
        const base = match(target, reply);
        const res = match(target, scaled);
        expect(Math.abs(res.score - base.score)).toBeLessThanOrEqual(1e-9);
        expect(res.missed).toBe(base.missed);
        expect(res.extra).toBe(base.extra);
      }),
      pbtParams(),
    );
  });

  it("a scaled copy of the target scores 1 and reports the tempo ratio", () => {
    fc.assert(
      fc.property(
        patternArb.filter((p) => p.length >= 2 && (p[p.length - 1] as number) > (p[0] as number)),
        factorArb,
        offsetArb,
        (target, factor, offset) => {
          const t0 = target[0] as number;
          const reply = target.map((t) => t0 + offset + (t - t0) * factor);
          const r = match(target, reply);
          expect(r.score).toBeGreaterThanOrEqual(1 - 1e-9);
          expect(r.largestError!.ms).toBeLessThan(1e-3);
          expect(Math.abs((r.tempoRatio as number) - factor)).toBeLessThanOrEqual(1e-9 * factor);
        },
      ),
      pbtParams(),
    );
  });

  it("identical patterns report zero error at index 0 and tempo ratio 1", () => {
    const r = match([0, 100, 250, 400], [0, 100, 250, 400]);
    expect(r.largestError).toEqual({ ms: 0, index: 0 });
    expect(r.tempoRatio).toBe(1);
    expect(r.missed).toBe(0);
    expect(r.extra).toBe(0);
  });
});
