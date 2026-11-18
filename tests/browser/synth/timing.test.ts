import { createAudioEngine, createGate, createSynth } from "@earworm/browser";
import type { AudioEngine, Gate, Synth, VoiceBuilder } from "@earworm/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

const SAMPLE_RATE = 44_100;
const TOTAL_SEC = 2;

interface Harness {
  ctx: OfflineAudioContext;
  engine: AudioEngine;
  synth: Synth;
  gate: Gate;
  addWindow: ReturnType<typeof vi.fn>;
  cancelWindow: ReturnType<typeof vi.fn>;
  events: string[];
}

function harness(): Harness {
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE * TOTAL_SEC, SAMPLE_RATE);
  const engine = createAudioEngine(ctx);
  const real = createGate();
  if (!real.ok) throw new Error("gate");
  const events: string[] = [];
  const addWindow = vi.fn((s: number, e: number) => {
    events.push("addWindow");
    return real.value.addWindow(s, e);
  });
  const cancelWindow = vi.fn((id: number) => {
    events.push("cancelWindow");
    real.value.cancelWindow(id);
  });
  const gate: Gate = { ...real.value, addWindow, cancelWindow };
  const synth = createSynth(engine, { gate });
  // A constant DC voice makes start and stop times visible sample by sample.
  const dc: VoiceBuilder = (c, p, output) => {
    const src = c.createConstantSource();
    src.offset.value = p.gain;
    src.connect(output);
    return {
      durationMs: p.durationMs,
      sources: [src],
      start() {
        events.push("start");
        src.start(p.startSec);
        src.stop(p.startSec + p.durationMs / 1000);
      },
    };
  };
  synth.registerVoice("dc", dc);
  return { ctx, engine, synth, gate, addWindow, cancelWindow, events };
}

/** Run `action` when the offline clock reaches `atSec`, then render. */
async function renderWith(
  h: Harness,
  atSec: number | null,
  action?: () => void | Promise<void>,
): Promise<Float32Array> {
  if (atSec !== null && action) {
    void h.ctx.suspend(atSec).then(async () => {
      await action();
      await h.ctx.resume();
    });
  }
  const buf = await h.ctx.startRendering();
  return buf.getChannelData(0);
}

const msToIndex = (ms: number): number => Math.round((ms / 1000) * SAMPLE_RATE);
const firstAbove = (d: Float32Array, t: number): number =>
  d.findIndex((v) => Math.abs(v) > t);
const peak = (d: Float32Array): number =>
  d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Synth timing (OfflineAudioContext)", () => {
  it("starts within 1 ms of the scheduled time", async () => {
    const h = harness();
    const r = await h.synth.schedule("dc", 300, { durationMs: 100, ungated: true });
    expect(r.startMs).toBe(300);
    const data = await renderWith(h, null);
    const startMs = (firstAbove(data, 0.01) / SAMPLE_RATE) * 1000;
    expect(Math.abs(startMs - 300)).toBeLessThan(1);
  });

  it("stops a tone at start plus duration within 1 ms", async () => {
    const h = harness();
    const startSpy = vi.spyOn(OscillatorNode.prototype, "start");
    const stopSpy = vi.spyOn(OscillatorNode.prototype, "stop");
    const r = await h.synth.schedule("tone", 250, {
      frequency: 440,
      durationMs: 100,
      ungated: true,
    });
    expect(r.endMs).toBe(350);
    const startSec = startSpy.mock.calls[0]?.[0] as number;
    const stopSec = stopSpy.mock.calls[0]?.[0] as number;
    expect(Math.abs(startSec * 1000 - 250)).toBeLessThan(1);
    expect(Math.abs(stopSec * 1000 - 350)).toBeLessThan(1);

    const data = await renderWith(h, null);
    expect(peak(data.subarray(msToIndex(251), msToIndex(350)))).toBeGreaterThan(0.5);
    expect(peak(data.subarray(0, msToIndex(249)))).toBe(0);
    expect(peak(data.subarray(msToIndex(351)))).toBeLessThan(1e-4);
  });

  it("a late schedule starts immediately and returns the actual start", async () => {
    const h = harness();
    let now = 0;
    let result: { startMs: number; endMs: number } | undefined;
    const data = await renderWith(h, 0.2, async () => {
      now = h.engine.now();
      result = await h.synth.schedule("dc", 50, {
        durationMs: 100,
        ungated: true,
      });
    });
    expect(now).toBeGreaterThan(150);
    expect(result?.startMs).toBe(now);
    expect(result?.endMs).toBe(now + 100);
    const startMs = (firstAbove(data, 0.01) / SAMPLE_RATE) * 1000;
    expect(Math.abs(startMs - now)).toBeLessThan(1);
  });

  it("gain scales the peak level", async () => {
    const full = harness();
    await full.synth.schedule("tone", 0, { durationMs: 200, gain: 1, ungated: true });
    const fullPeak = peak(await renderWith(full, null));

    const half = harness();
    await half.synth.schedule("tone", 0, { durationMs: 200, gain: 0.5, ungated: true });
    const halfPeak = peak(await renderWith(half, null));

    const silent = harness();
    await silent.synth.schedule("tone", 0, { durationMs: 200, gain: 0, ungated: true });
    const silentPeak = peak(await renderWith(silent, null));

    expect(fullPeak).toBeGreaterThan(0.9);
    expect(halfPeak / fullPeak).toBeCloseTo(0.5, 2);
    expect(silentPeak).toBe(0);
  });

  it("stop() silences all output within 50 ms", async () => {
    const h = harness();
    await h.synth.schedule("tone", 0, { durationMs: 1500, ungated: true });
    await h.synth.schedule("dc", 0, { durationMs: 1500, ungated: true });
    const data = await renderWith(h, 0.3, () => {
      h.synth.stop();
    });
    // Sound plays before the stop, and is silent 50 ms after it.
    expect(peak(data.subarray(msToIndex(100), msToIndex(290)))).toBeGreaterThan(0.5);
    expect(peak(data.subarray(msToIndex(300 + 51)))).toBe(0);
  });

  it("notifies the Gate before the sound starts", async () => {
    const h = harness();
    const r = await h.synth.schedule("dc", 400, { durationMs: 100 });
    expect(h.events).toEqual(["addWindow", "start"]);
    expect(h.addWindow).toHaveBeenCalledTimes(1);
    expect(h.addWindow).toHaveBeenCalledWith(r.startMs, r.endMs);
  });

  it("cancels windows of sounds that have not started on stop()", async () => {
    const h = harness();
    await h.synth.schedule("dc", 800, { durationMs: 100 });
    expect(h.cancelWindow).not.toHaveBeenCalled();
    h.synth.stop();
    expect(h.cancelWindow).toHaveBeenCalledTimes(1);
    expect(h.cancelWindow).toHaveBeenCalledWith(1);
  });

  it("keeps the window of a sound that already started when stop() is called", async () => {
    const h = harness();
    await h.synth.schedule("dc", 0, { durationMs: 1000 });
    await renderWith(h, 0.2, () => {
      h.synth.stop();
    });
    expect(h.cancelWindow).not.toHaveBeenCalled();
  });

  it("does not notify the Gate when ungated", async () => {
    const h = harness();
    await h.synth.schedule("dc", 100, { durationMs: 100, ungated: true });
    await h.synth.schedule("tone", 100, { ungated: true });
    expect(h.addWindow).not.toHaveBeenCalled();
    h.synth.stop();
    expect(h.cancelWindow).not.toHaveBeenCalled();
  });
});
