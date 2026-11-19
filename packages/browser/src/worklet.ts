import { createFramer, DEFAULT_FRAME_SIZE } from "@earworm/core/framing";
import type { Framer } from "@earworm/core/framing";

// AudioWorkletGlobalScope names. Declared here because the DOM lib has no worklet scope
// and this file must not touch any DOM API.
declare const currentFrame: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: {
    postMessage(message: unknown, transfer?: Transferable[]): void;
  };
  constructor(options?: unknown);
}
declare function registerProcessor(
  name: string,
  ctor: new (options?: { processorOptions?: unknown }) => AudioWorkletProcessor,
): void;

/** Name passed to `new AudioWorkletNode(ctx, WORKLET_NAME, ...)`. */
export const WORKLET_NAME = "earworm-framer";

function readFrameSize(
  options: { processorOptions?: unknown } | undefined,
): number {
  const po = options?.processorOptions;
  if (typeof po === "object" && po !== null && "frameSize" in po) {
    const fs = (po as { frameSize: unknown }).frameSize;
    if (typeof fs === "number") return fs;
  }
  return DEFAULT_FRAME_SIZE;
}

class FramerProcessor extends AudioWorkletProcessor {
  private readonly framer: Framer | undefined;

  constructor(options?: { processorOptions?: unknown }) {
    super(options);
    const r = createFramer(readFrameSize(options), sampleRate);
    this.framer = r.ok ? r.value : undefined;
    if (!r.ok) this.port.postMessage({ error: r.error });
  }

  process(inputs: Float32Array[][]): boolean {
    const quantum = inputs[0]?.[0];
    if (this.framer === undefined || quantum === undefined) return true;
    for (const frame of this.framer.push(quantum, currentFrame)) {
      this.port.postMessage(frame, [frame.samples.buffer]);
    }
    return true;
  }
}

registerProcessor(WORKLET_NAME, FramerProcessor);
