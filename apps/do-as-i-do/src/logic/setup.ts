import type { InputMode } from "./types.js";

export type Permission = "prompt" | "granted" | "denied" | "unavailable";
// Same union as @earworm/ui; declared here so logic never imports the UI package.
export type CalibrationState =
  | "uncalibrated"
  | "calibrating"
  | "calibrated"
  | "failed";

export function canBegin(a: {
  mode: InputMode;
  permission: Permission;
  calibration: CalibrationState;
  skipCalibration: boolean;
}): boolean {
  return (
    a.mode === "tap" ||
    (a.permission === "granted" &&
      (a.calibration === "calibrated" || a.skipCalibration))
  );
}

/** Tap mode is forced when the microphone is unavailable or denied (Req 1.3, 1.4). */
export function effectiveMode(mode: InputMode, permission: Permission): InputMode {
  return permission === "unavailable" || permission === "denied" ? "tap" : mode;
}
