// Feature: earworm-kit, Property 42: canUseMic truth table
// **Validates: Requirements 15.1**
import { canUseMic, type CanUseMicEnv } from "@earworm/browser";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { pbtParams } from "../../helpers/pbt";

function buildEnv(
  getUserMedia: boolean,
  audioContext: boolean,
  audioWorklet: boolean,
  secure: boolean,
): CanUseMicEnv {
  return {
    navigator: {
      mediaDevices: getUserMedia ? { getUserMedia: () => Promise.resolve({}) } : {},
    },
    AudioContext: audioContext ? function AudioContext() {} : undefined,
    AudioWorklet: audioWorklet ? function AudioWorklet() {} : undefined,
    isSecureContext: secure,
  };
}

describe("Property 42: canUseMic truth table", () => {
  it("is true iff getUserMedia, AudioContext, AudioWorklet and secure context are all present", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), (g, a, w, s) => {
        expect(canUseMic(buildEnv(g, a, w, s))).toBe(g && a && w && s);
      }),
      pbtParams(),
    );
  });

  it("is false when navigator or mediaDevices is missing, and never throws", () => {
    const base = buildEnv(true, true, true, true);
    const navs: unknown[] = [undefined, null, {}, { mediaDevices: null }, { mediaDevices: undefined }, 42];
    for (const navigator of navs) {
      expect(canUseMic({ ...base, navigator })).toBe(false);
    }
    expect(canUseMic({})).toBe(false);
  });

  it("never throws for arbitrary environments, even with throwing getters", () => {
    fc.assert(
      fc.property(
        fc.record({
          navigator: fc.anything(),
          AudioContext: fc.anything(),
          AudioWorklet: fc.anything(),
          isSecureContext: fc.anything(),
        }),
        (env) => {
          expect(typeof canUseMic(env)).toBe("boolean");
        },
      ),
      pbtParams(),
    );
    const hostile = {
      get navigator(): unknown {
        throw new Error("boom");
      },
    } as CanUseMicEnv;
    expect(canUseMic(hostile)).toBe(false);
  });
});
