import type { EventSource, KitError, Unsubscribe } from "@earworm/core";
import type { CapturePipeline, Gate, TapSource } from "@earworm/browser";
import type { InputMode, SittingInput } from "../logic/index.js";

export interface InputOptions {
  gate: Gate;
  capture: CapturePipeline;
  tap: TapSource;
  /** Receives `onset`, `input-mode` and `kit-error` inputs. */
  onInput: (input: SittingInput) => void;
}

export interface Input {
  readonly mode: InputMode;
  /** Switches the active source. Emits `input-mode` only when the mode changes. */
  setMode(mode: InputMode): void;
  stop(): void;
}

const toKitError = (e: unknown): KitError => {
  if (typeof e === "object" && e !== null && "code" in e && "message" in e) {
    return e as KitError;
  }
  return { code: "invalid-config", message: e instanceof Error ? e.message : String(e) };
};

export function createInput(opts: InputOptions, initial: InputMode): Input {
  const { gate, capture, tap, onInput } = opts;
  // Once per Session (Requirement 2.10).
  gate.setMode("ignore-synth");
  const sources: Record<InputMode, EventSource> = {
    mic: gate.wrap(capture),
    tap: gate.wrap(tap),
  };
  const unsubscribeErrors = tap.subscribeErrors((error) =>
    onInput({ kind: "kit-error", error }),
  );
  let mode = initial;
  let unsubscribe: Unsubscribe | null = null;
  let stopped = false;

  const activate = (m: InputMode): void => {
    unsubscribe?.();
    unsubscribe = sources[m].subscribe((event) => {
      if (event.type === "onset") onInput({ kind: "onset", event });
    });
    if (m === "mic") {
      tap.stop();
      capture.start().catch((e: unknown) => {
        if (!stopped) onInput({ kind: "kit-error", error: toKitError(e) });
      });
    } else {
      void capture.stop();
      tap.start();
    }
  };
  activate(mode);

  return {
    get mode() {
      return mode;
    },
    setMode(m) {
      if (stopped || m === mode) return;
      mode = m;
      activate(m);
      onInput({ kind: "input-mode", mode: m });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribe?.();
      unsubscribeErrors();
      tap.stop();
      void capture.stop();
    },
  };
}
