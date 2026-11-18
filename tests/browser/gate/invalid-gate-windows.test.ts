import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createGate } from "@earworm/browser";
import type { EarwormEvent } from "@earworm/core";
import { finiteIn } from "../../helpers/events";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 22: Invalid Gate windows are rejected
// **Validates: Requirements 8.2**

const nonFinite = fc.constantFrom(NaN, Infinity, -Infinity);

/** A (start, end) pair that is invalid: a non-finite value, or end before start. */
const invalidWindowArb: fc.Arbitrary<[number, number]> = fc.oneof(
  fc.tuple(nonFinite, finiteIn(-1e6, 1e6)),
  fc.tuple(finiteIn(-1e6, 1e6), nonFinite),
  fc.tuple(nonFinite, nonFinite),
  fc
    .tuple(finiteIn(-1e6, 1e6), fc.double({ min: 1e-3, max: 1e6, noNaN: true }))
    .map(([start, gap]): [number, number] => [start, start - gap]),
);

const validWindowArb = fc
  .tuple(finiteIn(0, 1e5), finiteIn(0, 1e4))
  .map(([start, len]): [number, number] => [start, start + len]);

function micEvent(timestamp: number): EarwormEvent {
  return { type: "onset", timestamp, source: "mic", strength: 1 } as EarwormEvent;
}

describe("Property 22: Invalid Gate windows are rejected", () => {
  it("returns invalid-gate-window and leaves existing windows unchanged", () => {
    fc.assert(
      fc.property(
        fc.array(validWindowArb, { maxLength: 5 }),
        invalidWindowArb,
        fc.array(finiteIn(-1e3, 2e5), { minLength: 1, maxLength: 20 }),
        (valid, [start, end], probes) => {
          const created = createGate({ tailMs: 0 });
          if (!created.ok) throw new Error("gate creation failed");
          const gate = created.value;
          for (const [s, e] of valid) {
            expect(gate.addWindow(s, e).ok).toBe(true);
          }
          const before = probes.map((t) => gate.shouldPass(micEvent(t)));

          const result = gate.addWindow(start, end);
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.code).toBe("invalid-gate-window");

          const after = probes.map((t) => gate.shouldPass(micEvent(t)));
          expect(after).toEqual(before);
        },
      ),
      pbtParams(),
    );
  });

  it("rejects a bad window on an empty Gate without gating anything", () => {
    const created = createGate();
    if (!created.ok) throw new Error("gate creation failed");
    const gate = created.value;
    expect(gate.addWindow(10, 5).ok).toBe(false);
    expect(gate.shouldPass(micEvent(7))).toBe(true);
  });
});
