import { getWorkletUrl } from "@earworm/browser";
import type { Frame } from "@earworm/core";
import { describe, expect, it } from "vitest";

// Uses OfflineAudioContext: a real AudioContext in headless Chromium is held by the
// autoplay policy, so rendering would never start. suspend() lets the test close the
// node at an exact sample position mid-render.

const SAMPLE_RATE = 48_000;
const WORKLET_NAME = "earworm-framer";
const MAX_GAP_MS = 12;
const LENGTH = 24_576; // 512 ms; a multiple of both frame sizes.

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

interface Rig {
  ctx: OfflineAudioContext;
  osc: OscillatorNode;
  node: AudioWorkletNode;
  frames: Frame[];
}

/** An OscillatorNode into the Worklet loaded from getWorkletUrl(). */
async function build(frameSize: number): Promise<Rig> {
  const ctx = new OfflineAudioContext(1, LENGTH, SAMPLE_RATE);
  await ctx.audioWorklet.addModule(await getWorkletUrl());
  const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
    processorOptions: { frameSize },
  });
  const frames: Frame[] = [];
  node.port.onmessage = (e: MessageEvent<Frame>) => {
    frames.push(e.data);
  };
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  osc.connect(node);
  node.connect(ctx.destination);
  osc.start(0);
  return { ctx, osc, node, frames };
}

describe.each([128, 512])(
  "Worklet integration at frameSize %i",
  (frameSize) => {
    const intervalMs = (frameSize / SAMPLE_RATE) * 1000;

    it("posts Frames spaced frameSize / sampleRate × 1000 ms apart, at least one per 12 ms", async () => {
      const { ctx, frames } = await build(frameSize);
      await ctx.startRendering();
      await sleep(100); // Port messages arrive after rendering resolves.

      expect(frames.length).toBe(LENGTH / frameSize);
      expect(frames.length).toBeGreaterThanOrEqual(
        Math.floor(((LENGTH / SAMPLE_RATE) * 1000) / MAX_GAP_MS),
      );
      expect(frames[0]!.timestamp).toBeCloseTo(0, 9);
      for (const f of frames) {
        expect(f.samples).toBeInstanceOf(Float32Array);
        expect(f.samples.length).toBe(frameSize);
        expect(f.sampleRate).toBe(SAMPLE_RATE);
      }
      for (let i = 1; i < frames.length; i++) {
        const gap = frames[i]!.timestamp - frames[i - 1]!.timestamp;
        expect(gap).toBeCloseTo(intervalMs, 9);
        expect(gap).toBeLessThanOrEqual(MAX_GAP_MS);
      }
      // The oscillator's signal reaches the posted samples.
      expect(frames.some((f) => f.samples.some((v) => Math.abs(v) > 0.5))).toBe(
        true,
      );
    });

    it("posts no Frames after the node is closed", async () => {
      const { ctx, osc, node, frames } = await build(frameSize);
      const closeSec = 0.256; // 12_288 samples, a multiple of both frame sizes.
      const closeMs = closeSec * 1000;
      void ctx.suspend(closeSec).then(async () => {
        osc.disconnect();
        node.disconnect();
        node.port.close();
        await ctx.resume();
      });
      await ctx.startRendering();
      await sleep(100);
      const settled = frames.length;
      await sleep(200);

      expect(frames.length).toBe(settled);
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.length).toBeLessThanOrEqual(
        Math.round(closeMs / intervalMs),
      );
      expect(frames.every((f) => f.timestamp < closeMs)).toBe(true);
    });
  },
);
