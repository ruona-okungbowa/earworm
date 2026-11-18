import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudioEngine, createGate, createSynth } from "@earworm/browser";
import type { Gate, VoiceBuilder } from "@earworm/browser";

// Example tests for the built-in Voices and registerVoice.
// **Validates: Requirements 7.1, 7.11**

const SAMPLE_RATE = 44_100;
const RENDER_SEC = 1.5;
const START_MS = 10;

const VOICES = [
  "knock",
  "click",
  "tone",
  "kick",
  "snare",
  "hat",
  "bass",
  "bell",
] as const;

function setup() {
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE * RENDER_SEC, SAMPLE_RATE);
  const engine = createAudioEngine(ctx);
  const made = createGate();
  if (!made.ok) throw new Error("gate failed");
  const windows: Array<[number, number]> = [];
  const gate: Gate = {
    ...made.value,
    addWindow(startMs, endMs) {
      windows.push([startMs, endMs]);
      return made.value.addWindow(startMs, endMs);
    },
  };
  const synth = createSynth(engine, { gate });
  return { ctx, synth, windows };
}

function peak(buf: AudioBuffer): number {
  let max = 0;
  for (const v of buf.getChannelData(0)) max = Math.max(max, Math.abs(v));
  return max;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("built-in Voices", () => {
  for (const name of VOICES) {
    it(`${name} renders non-silent audio without fetching`, async () => {
      const fetchSpy = vi.fn(() => {
        throw new Error("fetch must not be called");
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { ctx, synth } = setup();
      const { startMs, endMs } = await synth.schedule(name, START_MS, {
        ungated: true,
      });
      expect(startMs).toBe(START_MS);
      expect(endMs).toBeGreaterThan(startMs);

      const rendered = await ctx.startRendering();
      expect(peak(rendered)).toBeGreaterThan(0.001);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }
});

describe("registerVoice", () => {
  it("schedules a registered Voice like a built-in one", async () => {
    const { ctx, synth, windows } = setup();
    const seen: Array<{ frequency: number; gain: number; startSec: number }> =
      [];
    const builder: VoiceBuilder = (c, p, output) => {
      seen.push({
        frequency: p.frequency,
        gain: p.gain,
        startSec: p.startSec,
      });
      const osc = c.createOscillator();
      osc.frequency.value = p.frequency;
      const g = c.createGain();
      g.gain.value = p.gain;
      osc.connect(g).connect(output);
      return {
        durationMs: 100,
        sources: [osc],
        start() {
          osc.start(p.startSec);
          osc.stop(p.startSec + 0.1);
        },
      };
    };
    synth.registerVoice("custom", builder);

    const result = await synth.schedule("custom", START_MS, {
      frequency: 330,
      gain: 0.5,
    });
    expect(result).toEqual({ startMs: START_MS, endMs: START_MS + 100 });
    expect(seen).toEqual([
      { frequency: 330, gain: 0.5, startSec: START_MS / 1000 },
    ]);
    // Gated like a built-in: one Gate window covers the sound.
    expect(windows).toEqual([[START_MS, START_MS + 100]]);

    const rendered = await ctx.startRendering();
    const p = peak(rendered);
    expect(p).toBeGreaterThan(0.1);
    expect(p).toBeLessThanOrEqual(0.5 + 1e-6);
    // Silent before the start and after the end.
    const data = rendered.getChannelData(0);
    const before = Math.floor((START_MS / 1000) * SAMPLE_RATE) - 1;
    for (let i = 0; i < before; i++) expect(data[i]).toBe(0);
    const after = Math.ceil(((START_MS + 100) / 1000) * SAMPLE_RATE) + 2;
    for (let i = after; i < data.length; i++) expect(data[i]).toBe(0);
  });

  it("can override a built-in name", async () => {
    const { synth } = setup();
    let called = false;
    synth.registerVoice("knock", (c, p, _output) => {
      called = true;
      const osc = c.createOscillator();
      return {
        durationMs: 5,
        sources: [osc],
        start() {
          osc.start(p.startSec);
          osc.stop(p.startSec + 0.005);
        },
      };
    });
    const r = await synth.schedule("knock", START_MS, { ungated: true });
    expect(called).toBe(true);
    expect(r.endMs - r.startMs).toBe(5);
  });
});
