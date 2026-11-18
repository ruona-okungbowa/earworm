import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { match, intervalsToPattern } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 26: Match penalises missing and extra hits
// **Validates: Requirements 10.5, 10.10**

const targetArb = fc
  .array(fc.integer({ min: 1, max: 2000 }), { minLength: 1, maxLength: 12 })
  .map((intervals) => intervalsToPattern(intervals));

const sortNum = (a: number[]): number[] => [...a].sort((x, y) => x - y);

describe("Property 26: Match penalises missing and extra hits", () => {
  it("insertions only: score < 1, extra = inserted count, missed = 0", () => {
    fc.assert(
      fc.property(
        targetArb,
        fc.array(fc.integer({ min: -1000, max: 30000 }), { minLength: 1, maxLength: 6 }),
        (target, inserted) => {
          const reply = sortNum([...target, ...inserted]);
          const r = match(target, reply);
          expect(r.score).toBeLessThan(1);
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.extra).toBe(inserted.length);
          expect(r.missed).toBe(0);
        },
      ),
      pbtParams(),
    );
  });

  it("deletions only: score < 1, missed = deleted count, extra = 0", () => {
    const caseArb = targetArb
      .filter((t) => t.length >= 3)
      .chain((target) =>
        fc
          .uniqueArray(fc.integer({ min: 0, max: target.length - 1 }), {
            minLength: 1,
            maxLength: target.length - 2,
          })
          .map((deleted) => ({ target, deleted })),
      );
    fc.assert(
      fc.property(caseArb, ({ target, deleted }) => {
        const del = new Set(deleted);
        const reply = target.filter((_, i) => !del.has(i));
        const r = match(target, reply);
        expect(r.score).toBeLessThan(1);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.missed).toBe(deleted.length);
        expect(r.extra).toBe(0);
      }),
      pbtParams(),
    );
  });
});
