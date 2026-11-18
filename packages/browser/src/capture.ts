import { createEmitter } from "@earworm/core";
import type { Detector, EventSource, Frame, KitError } from "@earworm/core";
import type { AudioEngine } from "./engine.js";
import { createFrameProcessor } from "./frame-processor.js";
import type { FrameProcessor } from "./frame-processor.js";
import type { Gate } from "./gate.js";
import { getWorkletUrl } from "./worklet-url-loader.js";

export type CaptureState = "stopped" | "starting" | "running" | "stopping";

/**
 * The part of a Calibration store the pipeline reads. The full `CalibrationStore`
 * (task 24.4) satisfies this structurally.
 */
export interface CaptureCalibration {
  get(): { noiseFloorDb: number; latencyMs: number } | null;
}

export interface CapturePipelineOptions {
  gate?: Gate;
  calibration?: CaptureCalibration;
  /** Worklet frame size in samples. Default 128 (Assumption 25: the Pitch perf test passes at 128). */
  frameSize?: 128 | 512;
}

export interface CapturePipeline extends EventSource {
  /** Rejects with a `KitError` (`permission-denied`, `no-device`, `audio-context-resume`). */
  start(opts?: { detectors?: Detector[] }): Promise<void>;
  stop(): Promise<void>;
  readonly state: CaptureState;
}

/** Must match `WORKLET_NAME` in worklet.ts. That file registers a processor on import, so it is not imported here. */
const WORKLET_NAME = "earworm-framer";
const DEFAULT_FRAME_SIZE = 128;

function kitError(code: KitError["code"], message: string): KitError {
  return { code, message };
}

function errorName(e: unknown): string {
  return typeof e === "object" && e !== null && "name" in e
    ? String((e as { name: unknown }).name)
    : "";
}

function mapStreamError(e: unknown): unknown {
  switch (errorName(e)) {
    case "NotAllowedError":
      return kitError("permission-denied", "Microphone permission was denied");
    case "NotFoundError":
    case "OverconstrainedError":
      return kitError("no-device", "No usable microphone was found");
    default:
      return e;
  }
}

export function createCapturePipeline(
  engine: AudioEngine,
  opts: CapturePipelineOptions = {},
): CapturePipeline {
  const frameSize = opts.frameSize ?? DEFAULT_FRAME_SIZE;
  const emitter = createEmitter();

  let state: CaptureState = "stopped";
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;

  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;
  let detectors: Detector[] | undefined;
  let processor: FrameProcessor | null = null;

  const handleFrame = (frame: Frame): void => {
    processor?.process(frame);
  };

  /** Release every resource. Safe to call at any point and more than once. */
  const release = (): void => {
    if (node !== null) {
      node.port.onmessage = null;
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
      try {
        node.port.close();
      } catch {
        // already closed
      }
      node = null;
    }
    if (source !== null) {
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
      source = null;
    }
    if (stream !== null) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  };

  const doStart = async (): Promise<void> => {
    try {
      const ctx = engine.context as AudioContext;
      if (typeof ctx.createMediaStreamSource !== "function") {
        throw kitError(
          "invalid-config",
          "The engine context cannot capture a media stream",
        );
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      } catch (e) {
        throw mapStreamError(e);
      }

      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          throw kitError(
            "audio-context-resume",
            "The audio context could not be resumed",
          );
        }
      }

      await ctx.audioWorklet.addModule(await getWorkletUrl());

      const gate = opts.gate;
      processor = createFrameProcessor({
        ...(detectors !== undefined ? { detectors } : {}),
        ...(opts.calibration !== undefined
          ? { calibration: opts.calibration }
          : {}),
        emit: (e) => {
          if (gate === undefined || gate.shouldPass(e)) emitter.emit(e);
        },
      });

      const worklet = new AudioWorkletNode(ctx, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        processorOptions: { frameSize },
      });
      node = worklet;
      worklet.port.onmessage = (m: MessageEvent<unknown>): void => {
        if (state !== "running") return;
        const data = m.data as Partial<Frame> | null;
        if (data?.samples instanceof Float32Array) handleFrame(data as Frame);
      };
      source = ctx.createMediaStreamSource(stream);
      source.connect(worklet);
      state = "running";
    } catch (e) {
      release();
      processor = null;
      state = "stopped";
      throw e;
    }
  };

  const doStop = async (): Promise<void> => {
    // A stop during `starting` waits for the start to settle, then tears down.
    if (startPromise !== null) {
      try {
        await startPromise;
      } catch {
        // the failed start already released everything
      }
    }
    state = "stopping";
    const closing = processor;
    processor = null;
    release();
    closing?.close();
    state = "stopped";
  };

  return {
    subscribe: emitter.subscribe,
    get state(): CaptureState {
      return state;
    },
    start(startOpts?: { detectors?: Detector[] }): Promise<void> {
      if (
        startPromise !== null &&
        (state === "starting" || state === "running")
      ) {
        return startPromise;
      }
      if (state === "stopping" && stopPromise !== null) {
        const afterStop = stopPromise.then(() => this.start(startOpts));
        return afterStop;
      }
      detectors = startOpts?.detectors;
      state = "starting";
      const p = doStart().finally(() => {
        if (startPromise === p && state === "stopped") startPromise = null;
      });
      startPromise = p;
      return p;
    },
    stop(): Promise<void> {
      if (stopPromise !== null) return stopPromise;
      if (state === "stopped") return Promise.resolve();
      const p = doStop().finally(() => {
        stopPromise = null;
        startPromise = null;
      });
      stopPromise = p;
      return p;
    },
  };
}
