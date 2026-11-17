import { err, ok } from "./types.js";
import type { Ms, Result } from "./types.js";
import type { Frame } from "./events.js";

/** Default frame size: one Web Audio render quantum. */
export const DEFAULT_FRAME_SIZE = 128;
/** Frame sizes the kit supports. */
export const SUPPORTED_FRAME_SIZES: readonly number[] = [128, 512];

function validParams(sampleRate: number, frameSize: number): boolean {
  return (
    Number.isFinite(sampleRate) &&
    sampleRate > 0 &&
    SUPPORTED_FRAME_SIZES.includes(frameSize)
  );
}

/** Timestamp of Frame `index`: `startMs + (index × frameSize) / sampleRate × 1000`. */
function frameTimestamp(startMs: Ms, index: number, frameSize: number, sampleRate: number): Ms {
  return startMs + ((index * frameSize) / sampleRate) * 1000;
}

/**
 * The Framing_Function. Splits `samples` into consecutive full Frames of `frameSize`
 * samples. A trailing partial Frame is dropped. Invalid parameters (non-finite or
 * non-positive sample rate, unsupported frame size, non-finite start) give no Frames.
 */
export function frames(
  samples: Float32Array,
  startMs: Ms,
  sampleRate: number,
  frameSize: number = DEFAULT_FRAME_SIZE,
): Frame[] {
  if (!validParams(sampleRate, frameSize) || !Number.isFinite(startMs)) return [];
  const count = Math.floor(samples.length / frameSize);
  const out: Frame[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      samples: samples.slice(i * frameSize, (i + 1) * frameSize),
      timestamp: frameTimestamp(startMs, i, frameSize, sampleRate),
      sampleRate,
    });
  }
  return out;
}

export interface Framer {
  /**
   * Add a quantum whose first sample is at `currentFrame` (the context's sample index).
   * Returns the Frames completed by this quantum. A gap or overlap in `currentFrame`
   * discards the partial Frame and starts a new run at `currentFrame`.
   */
  push(quantum: Float32Array, currentFrame: number): Frame[];
  reset(): void;
}

/** Incremental form of `frames` for the Worklet. Same arithmetic as `frames`. */
export function createFramer(
  frameSize: number = DEFAULT_FRAME_SIZE,
  sampleRate: number,
): Result<Framer> {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return err("invalid-sample-rate", "sampleRate must be a positive finite number");
  }
  if (!SUPPORTED_FRAME_SIZES.includes(frameSize)) {
    return err("invalid-config", "frameSize must be 128 or 512", { setting: "frameSize" });
  }

  let buffer = new Float32Array(frameSize);
  let filled = 0;
  let runStartFrame = 0; // currentFrame of the first sample of the run
  let emitted = 0; // Frames emitted in this run
  let nextFrame: number | undefined; // expected currentFrame of the next quantum

  const framer: Framer = {
    push(quantum, currentFrame) {
      if (!Number.isFinite(currentFrame)) return [];
      if (nextFrame === undefined || currentFrame !== nextFrame) {
        filled = 0;
        emitted = 0;
        runStartFrame = currentFrame;
      }
      nextFrame = currentFrame + quantum.length;

      const startMs = (runStartFrame / sampleRate) * 1000;
      const out: Frame[] = [];
      let pos = 0;
      while (pos < quantum.length) {
        const take = Math.min(frameSize - filled, quantum.length - pos);
        buffer.set(quantum.subarray(pos, pos + take), filled);
        filled += take;
        pos += take;
        if (filled === frameSize) {
          out.push({
            samples: buffer,
            timestamp: frameTimestamp(startMs, emitted, frameSize, sampleRate),
            sampleRate,
          });
          emitted++;
          buffer = new Float32Array(frameSize);
          filled = 0;
        }
      }
      return out;
    },
    reset() {
      buffer = new Float32Array(frameSize);
      filled = 0;
      emitted = 0;
      nextFrame = undefined;
    },
  };
  return ok(framer);
}

/** Frame_Interval in ms: `frameSize / sampleRate × 1000`. */
export function frameIntervalMs(frameSize: number, sampleRate: number): Result<number> {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return err("invalid-sample-rate", "sampleRate must be a positive finite number");
  }
  if (!Number.isFinite(frameSize) || frameSize <= 0) {
    return err("invalid-config", "frameSize must be a positive finite number", {
      setting: "frameSize",
    });
  }
  return ok((frameSize / sampleRate) * 1000);
}
