import {
  createLevelDetector,
  createOnsetDetector,
  createPitchDetector,
  flushDetectors,
  shiftEvent,
} from "@earworm/core";
import type { Detector, EarwormEvent, Frame } from "@earworm/core";

/** The part of a Calibration the processor reads. */
export interface FrameProcessorCalibration {
  get(): { noiseFloorDb: number; latencyMs: number } | null;
}

export interface FrameProcessorOptions {
  /** Detectors to run, in order. Default: Onset, Pitch and Level. */
  detectors?: readonly Detector[];
  calibration?: FrameProcessorCalibration;
  emit: (e: EarwormEvent) => void;
}

export interface FrameProcessor {
  process(frame: Frame): void;
  /** Flushes every Detector and emits the resulting Events. */
  close(): void;
}

function createDefaultDetectors(noiseFloorDb: number | null): Detector[] {
  const onset = createOnsetDetector();
  const pitch = createPitchDetector();
  const level = createLevelDetector();
  if (!onset.ok || !pitch.ok || !level.ok) {
    throw new Error("Default detector configuration is invalid");
  }
  if (noiseFloorDb !== null) {
    onset.value.setNoiseFloor(noiseFloorDb);
    pitch.value.setNoiseFloor(noiseFloorDb);
  }
  return [onset.value, pitch.value, level.value];
}

export function createFrameProcessor(opts: FrameProcessorOptions): FrameProcessor {
  const { calibration, emit } = opts;
  const detectors: readonly Detector[] =
    opts.detectors ?? createDefaultDetectors(calibration?.get()?.noiseFloorDb ?? null);

  const deliver = (events: readonly EarwormEvent[]): void => {
    const latency = calibration?.get()?.latencyMs ?? null;
    for (const raw of events) {
      const tagged: EarwormEvent = { ...raw, source: "mic" };
      emit(latency === null ? tagged : shiftEvent(tagged, -latency));
    }
  };

  return {
    process(frame: Frame): void {
      for (const d of detectors) deliver(d.process(frame));
    },
    close(): void {
      deliver(flushDetectors(detectors));
    },
  };
}
