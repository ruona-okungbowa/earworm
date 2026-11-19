import { DEFAULTS, err, ok } from "@earworm/core";
import type { EarwormEvent, EventSource, Ms, Result } from "@earworm/core";

export type GateMode = "ignore-synth" | "off";

export interface Gate {
  addWindow(startMs: Ms, endMs: Ms): Result<{ id: number }>;
  cancelWindow(id: number): void;
  setMode(mode: GateMode): void;
  shouldPass(e: EarwormEvent): boolean;
  wrap(source: EventSource): EventSource;
}

export interface GateOptions {
  /** Extra time after a sound ends, 0 to 5000 ms. Default 150. */
  tailMs?: number;
  /** AudioContext output latency in ms, added only when there is no Calibration. */
  outputLatencyMs?: number;
  hasCalibration?: () => boolean;
}

const { tail } = DEFAULTS.gate;

interface GateWindow {
  start: Ms;
  end: Ms;
}

export function createGate(opts: GateOptions = {}): Result<Gate> {
  const tailMs = opts.tailMs ?? tail.default;
  if (!Number.isFinite(tailMs) || tailMs < tail.min || tailMs > tail.max) {
    return err(
      "invalid-gate-window",
      `tailMs must be a finite number from ${tail.min} to ${tail.max}`,
      { setting: "tailMs" },
    );
  }
  const outputLatencyMs = opts.outputLatencyMs ?? 0;
  if (!Number.isFinite(outputLatencyMs) || outputLatencyMs < 0) {
    return err(
      "invalid-gate-window",
      "outputLatencyMs must be a finite number of at least 0",
      { setting: "outputLatencyMs" },
    );
  }
  const hasCalibration = opts.hasCalibration ?? (() => false);

  const windows = new Map<number, GateWindow>();
  let nextId = 1;
  let mode: GateMode = "ignore-synth";

  const shouldPass = (e: EarwormEvent): boolean => {
    if (mode === "off") return true;
    if (e.source !== "mic") return true;
    for (const w of windows.values()) {
      if (e.timestamp >= w.start && e.timestamp <= w.end) return false;
    }
    return true;
  };

  const gate: Gate = {
    addWindow(startMs, endMs) {
      if (
        typeof startMs !== "number" ||
        typeof endMs !== "number" ||
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs < startMs
      ) {
        return err(
          "invalid-gate-window",
          "start and end must be finite numbers with end >= start",
        );
      }
      const extra = hasCalibration() ? 0 : outputLatencyMs;
      const id = nextId++;
      windows.set(id, { start: startMs, end: endMs + tailMs + extra });
      return ok({ id });
    },
    cancelWindow(id) {
      windows.delete(id);
    },
    setMode(m) {
      mode = m;
    },
    shouldPass,
    wrap(source) {
      return {
        subscribe(listener) {
          return source.subscribe((e) => {
            if (shouldPass(e)) listener(e);
          });
        },
      };
    },
  };
  return ok(gate);
}
