// Feature: earworm-kit, Property 27: Match degenerate inputs and purity
// **Validates: Requirements 10.6, 10.7, 10.8, 10.9**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { match } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

const time = fc.double({ min: -1e6, max: 1e6, noNaN: true });

/** Non-decreasing finite pattern with the given length range. */
const validPattern = (minLength: number, maxLength: number) =>
  fc
    .tuple(
      time,
      fc.array(fc.double({ min: 0, max: 1e4, noNaN: true }), {
        minLength: Math.max(0, minLength - 1),
        maxLength: Math.max(0, maxLength - 1),
      }),
    )
    .map(([start, deltas]) => {
      const out = [start];
      for (const d of deltas) out.push((out[out.length - 1] as number) + d);
      return out;
    });

/** Pattern with 0 or 1 hits. */
const tinyPattern = fc.oneof(
  fc.constant<number[]>([]),
  time.map((t) => [t]),
);

/** Pattern of n hits that all share one time. */
const flatPattern = (minLength: number, maxLength: number) =>
  fc
    .tuple(time, fc.integer({ min: minLength, max: maxLength }))
    .map(([t, n]) => Array.from({ length: n }, () => t));

/** Pattern with at least one unordered or non-finite hit. */
const invalidPattern = fc.oneof(
  fc
    .tuple(
      fc.array(time, { minLength: 0, maxLength: 5 }),
      fc.constantFrom(NaN, Infinity, -Infinity),
      fc.array(time, { minLength: 0, maxLength: 5 }),
    )
    .map(([a, bad, b]) => [...a, bad, ...b]),
  fc
    .tuple(time, fc.double({ min: 1e-3, max: 1e4, noNaN: true }))
    .map(([t, d]) => [t, t - d]),
);

describe("match degenerate inputs and purity", () => {
  it("fewer than 2 hits scores 1 when counts are equal, else 0 (10.6)", () => {
    fc.assert(
      fc.property(
        tinyPattern,
        fc.oneof(tinyPattern, validPattern(1, 6)),
        fc.boolean(),
        (small, other, swap) => {
          const [target, reply] = swap ? [other, small] : [small, other];
          const r = match(target, reply);
          expect(r.score).toBe(target.length === reply.length ? 1 : 0);
        },
      ),
      pbtParams(),
    );
  });

  it("unordered or non-finite hits score 0 and never throw (10.7)", () => {
    fc.assert(
      fc.property(
        invalidPattern,
        fc.oneof(tinyPattern, validPattern(1, 6)),
        fc.boolean(),
        (bad, good, swap) => {
          const [target, reply] = swap ? [good, bad] : [bad, good];
          expect(() => match(target, reply)).not.toThrow();
          expect(match(target, reply).score).toBe(0);
          expect(match(bad, bad).score).toBe(0);
        },
      ),
      pbtParams(),
    );
  });

  it("zero total duration scores 1 only when both are flat with equal counts (10.8)", () => {
    fc.assert(
      fc.property(
        flatPattern(2, 6),
        flatPattern(2, 6),
        validPattern(2, 6),
        (flatA, flatB, other) => {
          expect(match(flatA, flatB).score).toBe(
            flatA.length === flatB.length ? 1 : 0,
          );
          const otherDur =
            (other[other.length - 1] as number) - (other[0] as number);
          if (otherDur > 0) {
            expect(match(flatA, other).score).toBe(0);
            expect(match(other, flatA).score).toBe(0);
          }
        },
      ),
      pbtParams(),
    );
  });

  it("is deterministic and does not mutate inputs (10.9)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          tinyPattern,
          validPattern(1, 8),
          invalidPattern,
          flatPattern(2, 5),
        ),
        fc.oneof(
          tinyPattern,
          validPattern(1, 8),
          invalidPattern,
          flatPattern(2, 5),
        ),
        (target, reply) => {
          const targetCopy = [...target];
          const replyCopy = [...reply];
          const first = match(target, reply);
          const second = match(target, reply);
          expect(second).toEqual(first);
          expect(target).toEqual(targetCopy);
          expect(reply).toEqual(replyCopy);
          Object.freeze(target);
          Object.freeze(reply);
          expect(match(target, reply)).toEqual(first);
        },
      ),
      pbtParams(),
    );
  });
});
