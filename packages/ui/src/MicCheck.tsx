import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { EventSource } from "@earworm/core";
import { canUseMic } from "@earworm/browser";
import type {
  Calibrator,
  CalibrationStore,
  CapturePipeline,
  TapSource,
} from "@earworm/browser";
import { useCalibrationState, useInputLevel } from "./hooks.js";
import type { CalibrationState } from "./hooks.js";

export type MicPermissionState = "prompt" | "granted" | "denied";

export interface MicCheckProps {
  capture: CapturePipeline;
  tap: TapSource;
  calibrator: Calibrator;
  store: CalibrationStore;
  /** Called with the Tap_Source after `tap.start()` when tap mode is chosen. */
  onSourceChange: (source: EventSource) => void;
}

function errorCode(e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = (e as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown-error";
}

/** Reads the microphone permission without prompting, when the API exists. */
function usePermissionQuery(enabled: boolean, set: (s: MicPermissionState) => void): void {
  useEffect(() => {
    if (!enabled) return;
    const permissions = (globalThis as { navigator?: Navigator }).navigator?.permissions;
    if (typeof permissions?.query !== "function") return;
    let cancelled = false;
    let status: PermissionStatus | null = null;
    const apply = (): void => {
      if (cancelled || status === null) return;
      set(status.state);
    };
    permissions
      .query({ name: "microphone" as PermissionName })
      .then((s) => {
        if (cancelled) return;
        status = s;
        apply();
        s.addEventListener("change", apply);
      })
      .catch(() => {
        // Unsupported name: stay on "prompt".
      });
    return () => {
      cancelled = true;
      status?.removeEventListener("change", apply);
    };
  }, [enabled, set]);
}

export function MicCheck(props: MicCheckProps): ReactElement {
  const { capture, tap, calibrator, store, onSourceChange } = props;
  const micAvailable = canUseMic();
  const [permission, setPermission] = useState<MicPermissionState>("prompt");
  const [phase, setPhase] = useState<"idle" | "calibrating" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [tapActive, setTapActive] = useState(false);
  const storeState = useCalibrationState(store);
  const level = useInputLevel(capture);

  usePermissionQuery(micAvailable, setPermission);

  const calibrationState: CalibrationState =
    phase === "calibrating" ? "calibrating" : phase === "failed" ? "failed" : storeState;

  const enableTap = (): void => {
    try {
      tap.start();
    } catch (e) {
      setError(errorCode(e));
      return;
    }
    setTapActive(true);
    onSourceChange(tap);
  };

  const tapButton = (
    <button type="button" data-testid="mic-tap-mode" onClick={enableTap} disabled={tapActive}>
      {tapActive ? "Tap mode on" : "Use tap mode"}
    </button>
  );

  const errorBox =
    error === null ? null : (
      <p role="alert" data-testid="mic-error">
        {error}
      </p>
    );

  if (!micAvailable) {
    return (
      <div>
        <p data-testid="mic-explanation">
          This browser cannot use the microphone here. Tap mode lets you send input with a
          button or the space bar instead.
        </p>
        {tapButton}
        {errorBox}
      </div>
    );
  }

  const enable = async (): Promise<void> => {
    setError(null);
    try {
      await capture.start();
      setPermission("granted");
    } catch (e) {
      const code = errorCode(e);
      if (code === "permission-denied") setPermission("denied");
      setError(code);
    }
  };

  const calibrate = async (): Promise<void> => {
    setError(null);
    setPhase("calibrating");
    try {
      await calibrator.calibrate();
      setPhase("idle");
    } catch (e) {
      setError(errorCode(e));
      setPhase("failed");
    }
  };

  const denied = permission === "denied";

  return (
    <div>
      <p data-testid="mic-explanation">
        Earworm listens for knocks, claps, hums and taps. It needs your microphone to hear
        them. Audio stays in your browser. Nothing is requested until you press the button.
      </p>
      <p>
        Microphone permission: <span data-testid="mic-permission">{permission}</span>
      </p>
      <button type="button" data-testid="mic-enable" onClick={() => void enable()}>
        Enable microphone
      </button>
      <div
        data-testid="mic-level"
        role="meter"
        aria-label="Input level"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={level}
        data-level={level}
      >
        <div style={{ width: `${level * 100}%`, height: 8, background: "currentColor" }} />
      </div>
      <p>
        Calibration: <span data-testid="mic-calibration-state">{calibrationState}</span>
      </p>
      <button
        type="button"
        data-testid="mic-calibrate"
        onClick={() => void calibrate()}
        disabled={denied || phase === "calibrating"}
      >
        Calibrate
      </button>
      {denied ? tapButton : null}
      {errorBox}
    </div>
  );
}
