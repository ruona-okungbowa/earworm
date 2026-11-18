import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { tapStep } from "@earworm/browser";
import type { TapInput, TapState } from "@earworm/browser";
import type { Ms } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";
import { TAP_REF_INITIAL, tapReference } from "../../helpers/tap-reference";

const clock = fc.option(
  fc.double({ min: 0, max: 1e7, noNaN: true }).map((n) => n as Ms),
  { freq: 6, nil: null },
);

const tapInput: fc.Arbitrary<TapInput> = fc.oneof(
  fc.record({
    kind: fc.constant("key-down" as const),
    repeat: fc.boolean(),
    inTextInput: fc.boolean(),
    now: clock,
  }),
  fc.record({ kind: fc.constant("key-up" as const), now: clock }),
  fc.record({
    kind: fc.constant("pointer-down" as const),
    onTarget: fc.boolean(),
    now: clock,
  }),
  fc.record({ kind: fc.constant("pointer-up" as const), now: clock }),
  fc.record({ kind: fc.constant("blur" as const), now: clock }),
  fc.record({ kind: fc.constant("stop" as const), now: clock }),
);

describe("tap press model", () => {
  // Feature: earworm-kit, Property 24: Tap Source follows the press model
  // **Validates: Requirements 9.1, 9.2, 9.3, 9.6, 9.7, 9.9, 9.10, 9.11**
  it("matches the reference model over any input sequence", () => {
    fc.assert(
      fc.property(fc.array(tapInput, { maxLength: 60 }), (inputs) => {
        let actual: TapState = { held: null, stopped: false };
        let model = TAP_REF_INITIAL;
        for (const input of inputs) {
          const got = tapStep(actual, input);
          const want = tapReference(model, input);
          expect(got.events).toEqual(want.events);
          expect(got.state).toEqual(want.state);
          expect(got.error?.code).toBe(
            want.clockError ? "clock-unavailable" : undefined,
          );
          actual = got.state;
          model = want.state;
        }
      }),
      pbtParams(),
    );
  });

  it("emits Onset then Release for a space-bar press", () => {
    const down = tapStep(
      { held: null, stopped: false },
      { kind: "key-down", repeat: false, inTextInput: false, now: 10 as Ms },
    );
    expect(down.events).toEqual([
      { type: "onset", timestamp: 10, source: "tap", strength: 1 },
    ]);
    const up = tapStep(down.state, { kind: "key-up", now: 20 as Ms });
    expect(up.events).toEqual([{ type: "release", timestamp: 20, source: "tap" }]);
  });
});
