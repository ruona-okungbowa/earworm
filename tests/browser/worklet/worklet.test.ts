import { getWorkletUrl } from "@earworm/browser";
import type { Frame } from "@earworm/core";
import { describe, expect, it } from "vitest";

const SAMPLE_RATE = 48_000;
const LENGTH = 4096;

/** Render a DC level through the Worklet and collect the Frames it posts. */
async function render(processorOptions?: { frameSize?: unknown }): Promise<Frame[]> {
  const ctx = new OfflineAudioContext(1, LENGTH, SAMPLE_RATE);
  await ctx.audioWorklet.addModule(await getWorkletUrl());
  const node = new AudioWorkletNode(
    ctx,
    "earworm-framer",
    processorOptions === undefined ? {} : { processorOptions },
  );
  const frames: Frame[] = [];
  node.port.onmessage = (e: MessageEvent<Frame>) => {
    frames.push(e.data);
  };
  const src = ctx.createConstantSource();
  src.offset.value = 0.5;
  src.connect(node);
  node.connect(ctx.destination);
  src.start(0);
  await ctx.startRendering();
  // Messages arrive asynchronously after rendering.
  await new Promise((r) => setTimeout(r, 100));
  return frames;
}

function expectContiguous(frames: Frame[], frameSize: number): void {
  expect(frames.length).toBeGreaterThan(0);
  const intervalMs = (frameSize / SAMPLE_RATE) * 1000;
  frames.forEach((f, i) => {
    expect(f.samples).toBeInstanceOf(Float32Array);
    expect(f.samples.length).toBe(frameSize);
    expect(f.sampleRate).toBe(SAMPLE_RATE);
    expect(f.timestamp).toBeCloseTo(i * intervalMs, 9);
    expect(f.samples.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });
}

describe("Worklet", () => {
  it("resolves the Worklet URL through ?worker&url", async () => {
    const url = await getWorkletUrl();
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });

  it("posts 128-sample Frames by default with Timestamp currentFrame / sampleRate × 1000", async () => {
    const frames = await render();
    expectContiguous(frames, 128);
    expect(frames.length).toBe(LENGTH / 128);
  });

  it("supports a frameSize of 512 from processorOptions", async () => {
    const frames = await render({ frameSize: 512 });
    expectContiguous(frames, 512);
    expect(frames.length).toBe(LENGTH / 512);
  });

  it("falls back to 128 when processorOptions has no frameSize", async () => {
    expectContiguous(await render({}), 128);
  });
});
