// Feature: earworm-kit, Property 2: Non-finite conversion input is rejected
// **Validates: Requirements 1.8**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { msToSeconds, secondsToMs } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt.js";

const nonFinite = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
);

function expectRejected(result: ReturnType<typeof secondsToMs>): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("invalid-number");
  expect("value" in result).toBe(false);
}

describe("Property 2: Non-finite conversion input is rejected", () => {
  it("rejects NaN, Infinity and -Infinity in both directions", () => {
    for (const x of [Number.NaN, Infinity, -Infinity]) {
      expectRejected(secondsToMs(x));
      expectRejected(msToSeconds(x));
    }
  });

  it("rejects any generated non-finite input in both directions", () => {
    fc.assert(
      fc.property(nonFinite, (x) => {
        expectRejected(secondsToMs(x));
        expectRejected(msToSeconds(x));
      }),
      pbtParams(),
    );
  });

  it("rejects a non-finite value in any mix of seconds and milliseconds inputs", () => {
    fc.assert(
      fc.property(
        nonFinite,
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        fc.boolean(),
        (bad, good, badFirst) => {
          // Each call gets one non-finite argument; the finite value only varies the surrounding sequence.
          const order = badFirst ? [bad, good] : [good, bad];
          for (const x of order) {
            if (!Number.isFinite(x)) {
              expectRejected(secondsToMs(x));
              expectRejected(msToSeconds(x));
            }
          }
        },
      ),
      pbtParams(),
    );
  });
});
