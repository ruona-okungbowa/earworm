// Feature: earworm-kit, Property 61: Largest-error index refers to a target hit
// **Validates: Requirements 10.11, 10.12, 10.13, 10.14**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { match } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt.js";

const time = fc.integer({ min: 0, max: 100_000 });

const validPattern = fc
  .array(time, { minLength: 2, maxLength: 12 })
  .map((a) => [...a].sort((x, y) => x - y));
const emptyPattern = fc.constant<number[]>([]);
const singleHit = time.map((t) => [t]);
const zeroDuration = fc
  .tuple(time, fc.integer({ min: 2, max: 8 }))
  .map(([t, n]) => new Array<number>(n).fill(t));
const invalidPattern = fc
  .tuple(validPattern, fc.nat(), fc.constantFrom(Number.NaN, Infinity, -Infinity, -1))
  .map(([p, i, bad]) => {
    const q = [...p];
    q[i % q.length] = bad;
    return q;
  });
const decreasing = fc
  .array(time, { minLength: 2, maxLength: 8 })
  .filter((a) => a.some((v, i) => i > 0 && v < (a[i - 1] as number)));

const anyPattern: fc.Arbitrary<number[]> = fc.oneof(
  { arbitrary: validPattern, weight: 5 },
  emptyPattern,
  singleHit,
  zeroDuration,
  invalidPattern,
  decreasing,
);

function isValid(p: readonly number[]): boolean {
  return p.every((t, i) => Number.isFinite(t) && (i === 0 || t >= (p[i - 1] as number)));
}

describe("Property 61: Largest-error index refers to a target hit", () => {
  it("is null only for an empty target, otherwise a finite non-negative ms and a target hit index", () => {
    fc.assert(
      fc.property(anyPattern, anyPattern, (target, reply) => {
        const before = [JSON.stringify(target), JSON.stringify(reply)];
        const { largestError } = match(target, reply);
        expect([JSON.stringify(target), JSON.stringify(reply)]).toEqual(before);
        if (target.length === 0) {
          expect(largestError).toBeNull();
          return;
        }
        expect(largestError).not.toBeNull();
        const { ms, index } = largestError!;
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThanOrEqual(target.length - 1);
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBeGreaterThanOrEqual(0);
      }),
      pbtParams(),
    );
  });

  it("is { ms: 0, index: 0 } when the target has hits and either Pattern has fewer than 2", () => {
    fc.assert(
      fc.property(
        fc.oneof(emptyPattern, singleHit, anyPattern),
        fc.oneof(emptyPattern, singleHit, anyPattern),
        (a, b) => {
          fc.pre(a.length >= 1);
          fc.pre(a.length < 2 || b.length < 2);
          expect(match(a, b).largestError).toEqual({ ms: 0, index: 0 });
          fc.pre(b.length >= 1);
          expect(match(b, a).largestError).toEqual({ ms: 0, index: 0 });
        },
      ),
      pbtParams(),
    );
  });

  it("is { ms: 0, index: 0 } when the reply equals a non-empty target", () => {
    fc.assert(
      fc.property(anyPattern, (target) => {
        fc.pre(target.length >= 1);
        expect(match(target, [...target]).largestError).toEqual({ ms: 0, index: 0 });
      }),
      pbtParams(),
    );
  });

  it("is { ms: 0, index: 0 } for invalid or zero-duration Patterns when the target has hits", () => {
    fc.assert(
      fc.property(anyPattern, anyPattern, (target, reply) => {
        fc.pre(target.length >= 1);
        const dur = (p: number[]) => (p.length ? (p[p.length - 1] as number) - (p[0] as number) : 0);
        const degenerate =
          !isValid(target) || !isValid(reply) || dur(target) === 0 || dur(reply) === 0;
        fc.pre(degenerate);
        expect(match(target, reply).largestError).toEqual({ ms: 0, index: 0 });
      }),
      pbtParams(),
    );
  });

  it("names a target hit for unequal-length valid Patterns", () => {
    fc.assert(
      fc.property(validPattern, validPattern, (target, reply) => {
        fc.pre(target.length !== reply.length);
        const { largestError } = match(target, reply);
        expect(largestError).not.toBeNull();
        expect(largestError!.index).toBeGreaterThanOrEqual(0);
        expect(largestError!.index).toBeLessThan(target.length);
      }),
      pbtParams(),
    );
  });

  it("returns null for an empty target", () => {
    expect(match([], [0, 100]).largestError).toBeNull();
    expect(match([], []).largestError).toBeNull();
  });
});
