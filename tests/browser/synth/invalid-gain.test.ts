import { describe, expect, it, vi } from "vitest";
import { createAudioEngine, createSynth } from "@earworm/browser";
import type { Gate, VoiceBuilder } from "@earworm/browser";

// Requirement 7.14: an invalid gain rejects with `invalid-gain`, creates no
// node and makes no Gate call.

const BUILT_IN_VOICES = [
  "knock",
  "click",
  "tone",
  "kick",
  "snare",
  "hat",
  "bass",
  "bell",
];
const REGISTERED = "custom";
const INVALID_GAINS: [string, number][] = [
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["negative", -0.5],
  ["above 1", 1.0001],
];

function setup() {
  const ctx = new OfflineAudioContext(1, 44_100, 44_100);
  const factories = Object.getOwnPropertyNames(
    Object.getPrototypeOf(Object.getPrototypeOf(ctx)),
  ).filter((k) => k.startsWith("create"));
  const nodeSpies = factories.map((k) =>
    vi.spyOn(ctx as unknown as Record<string, () => unknown>, k),
  );
  const gate: Gate = {
    addWindow: vi.fn(() => ({ ok: true as const, value: { id: 1 } })),
    cancelWindow: vi.fn(),
    setMode: vi.fn(),
    shouldPass: vi.fn(() => true),
    wrap: vi.fn((s) => s),
  };
  const synth = createSynth(createAudioEngine(ctx), { gate });
  const builder = vi.fn<VoiceBuilder>();
  synth.registerVoice(REGISTERED, builder);
  return { synth, gate, nodeSpies, factories, builder };
}

describe("Synth rejects an invalid gain", () => {
  it("spies on the context node factory methods", () => {
    const { factories } = setup();
    expect(factories).toContain("createGain");
    expect(factories).toContain("createOscillator");
    expect(factories).toContain("createBufferSource");
  });

  for (const voice of [...BUILT_IN_VOICES, REGISTERED]) {
    for (const [label, gain] of INVALID_GAINS) {
      it(`${voice}: gain ${label}`, async () => {
        const { synth, gate, nodeSpies, builder } = setup();
        for (const ungated of [false, true]) {
          await expect(
            synth.schedule(voice, 100, { gain, ungated }),
          ).rejects.toMatchObject({ code: "invalid-gain" });
        }
        for (const spy of nodeSpies) expect(spy).not.toHaveBeenCalled();
        expect(builder).not.toHaveBeenCalled();
        expect(gate.addWindow).not.toHaveBeenCalled();
        expect(gate.cancelWindow).not.toHaveBeenCalled();
        expect(gate.setMode).not.toHaveBeenCalled();
        expect(gate.shouldPass).not.toHaveBeenCalled();
        expect(gate.wrap).not.toHaveBeenCalled();
      });
    }
  }
});
