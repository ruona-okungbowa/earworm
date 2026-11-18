import * as fc from "fast-check";
import { describe, it } from "vitest";
import { tapStep } from "@earworm/browser";
import type { TapInput, TapState } from "@earworm/browser";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 60: A release separates space-bar Onsets
// **Validates: Requirements 9.3, 9.12**

const nowArb = fc.oneof(
  { weight: 5, arbitrary: fc.double({ min: 0, max: 1e7, noNaN: true }) },
  { weight: 1, arbitrary: fc.constant(null) },
);

const spaceInputArb: fc.Arbitrary<TapInput> = fc.oneof(
  nowArb.map((now): TapInput => ({ kind: "key-down", repeat: false, inTextInput: false, now })),
  nowArb.map((now): TapInput => ({ kind: "key-down", repeat: true, inTextInput: false, now })),
  nowArb.map((now): TapInput => ({ kind: "key-up", now })),
);

const startArb: fc.Arbitrary<TapState> = fc.constantFrom<TapState["held"]>(null, "key", "pointer").map(
  (held) => ({ held, stopped: false }),
);

describe("Property 60: a release separates space-bar Onsets", () => {
  it("has a key-up input and a Release_Event between consecutive space-bar Onsets", () => {
    fc.assert(
      fc.property(startArb, fc.array(spaceInputArb, { maxLength: 60 }), (start, inputs) => {
        let state = start;
        let seenOnset = false;
        let sawKeyUp = false;
        let sawRelease = false;
        for (const input of inputs) {
          const result = tapStep(state, input);
          if (input.kind === "key-up") sawKeyUp = true;
          for (const event of result.events) {
            if (event.type === "release") sawRelease = true;
            if (event.type === "onset") {
              if (seenOnset && !(sawKeyUp && sawRelease)) return false;
              seenOnset = true;
              sawKeyUp = false;
              sawRelease = false;
            }
          }
          state = result.state;
        }
        return true;
      }),
      pbtParams(),
    );
  });
});
