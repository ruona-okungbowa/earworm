// **Validates: Requirements 15.2, 15.3, 15.5, 15.6, 15.7, 15.8, 15.13, 15.14**
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitter } from "@earworm/core";
import type { EarwormEvent, Emitter } from "@earworm/core";
import { createCalibrationStore } from "@earworm/browser";
import type { Calibration, Calibrator, CapturePipeline, TapSource } from "@earworm/browser";
import { MicCheck } from "@earworm/ui";
import { render, unmount } from "../../helpers/react";

const TEST_IDS = [
  "mic-explanation",
  "mic-permission",
  "mic-enable",
  "mic-level",
  "mic-calibration-state",
  "mic-calibrate",
  "mic-tap-mode",
  "mic-error",
] as const;

const STORED: Calibration = { noiseFloorDb: -50, latencyMs: 40 };

interface Fakes {
  capture: CapturePipeline;
  captureEmitter: Emitter;
  start: ReturnType<typeof vi.fn>;
  tap: TapSource;
  tapStart: ReturnType<typeof vi.fn>;
  calibrator: Calibrator;
  calibrate: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof createCalibrationStore>;
  onSourceChange: ReturnType<typeof vi.fn>;
}

function makeFakes(): Fakes {
  const captureEmitter = createEmitter();
  const start = vi.fn(async () => {});
  const capture = {
    subscribe: (l: (e: EarwormEvent) => void) => captureEmitter.subscribe(l),
    start,
    stop: async () => {},
    state: "idle",
  } as unknown as CapturePipeline;

  const tapEmitter = createEmitter();
  const tapStart = vi.fn();
  const tap = {
    subscribe: (l: (e: EarwormEvent) => void) => tapEmitter.subscribe(l),
    start: tapStart,
    stop: () => {},
    subscribeErrors: () => () => {},
  } as unknown as TapSource;

  const calibrate = vi.fn(async (): Promise<Calibration> => STORED);
  const calibrator = {
    measureNoiseFloor: async () => STORED.noiseFloorDb,
    measureLatency: async () => STORED.latencyMs,
    calibrate,
    load: async () => STORED,
  } as unknown as Calibrator;

  const store = createCalibrationStore();
  return {
    capture,
    captureEmitter,
    start,
    tap,
    tapStart,
    calibrator,
    calibrate,
    store,
    onSourceChange: vi.fn(),
  };
}

function ui(f: Fakes) {
  return createElement(MicCheck, {
    capture: f.capture,
    tap: f.tap,
    calibrator: f.calibrator,
    store: f.store,
    onSourceChange: f.onSourceChange,
  });
}

function byId(host: HTMLElement, id: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function need(host: HTMLElement, id: string): HTMLElement {
  const el = byId(host, id);
  if (el === null) throw new Error(`missing data-testid ${id}`);
  return el;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
}

function fakePermissionStatus(state: PermissionState): PermissionStatus {
  const target = new EventTarget();
  return Object.assign(target, { state, name: "microphone", onchange: null }) as unknown as PermissionStatus;
}

function stubPermission(state: PermissionState): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(navigator.permissions, "query")
    .mockImplementation(async () => fakePermissionStatus(state));
}

describe("MicCheck", () => {
  let getUserMedia: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getUserMedia = vi
      .spyOn(navigator.mediaDevices, "getUserMedia")
      .mockRejectedValue(new Error("test must not open the microphone"));
  });

  afterEach(async () => {
    await unmount();
    vi.restoreAllMocks();
  });

  describe("when canUseMic is false", () => {
    let descriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    });

    afterEach(() => {
      if (descriptor === undefined) delete (navigator as unknown as Record<string, unknown>)["mediaDevices"];
      else Object.defineProperty(navigator, "mediaDevices", descriptor);
    });

    it("makes no microphone API call and offers only tap mode (15.2)", async () => {
      const query = vi.spyOn(navigator.permissions, "query");
      const f = makeFakes();
      const host = await render(ui(f));

      expect(byId(host, "mic-explanation")).not.toBeNull();
      expect(byId(host, "mic-enable")).toBeNull();
      expect(byId(host, "mic-calibrate")).toBeNull();
      expect(query).not.toHaveBeenCalled();
      expect(f.start).not.toHaveBeenCalled();
      expect(getUserMedia).not.toHaveBeenCalled();

      await click(need(host, "mic-tap-mode"));
      expect(f.tapStart).toHaveBeenCalledTimes(1);
      expect(f.onSourceChange).toHaveBeenCalledWith(f.tap);
      expect(f.start).not.toHaveBeenCalled();
    });
  });

  describe("permission state (15.3, 15.5)", () => {
    it.each(["prompt", "granted", "denied"] as const)("shows %s", async (state) => {
      stubPermission(state);
      const host = await render(ui(makeFakes()));
      expect(need(host, "mic-permission").textContent).toBe(state);
    });

    it("shows prompt when the Permissions API cannot answer", async () => {
      vi.spyOn(navigator.permissions, "query").mockRejectedValue(new TypeError("unsupported"));
      const host = await render(ui(makeFakes()));
      expect(need(host, "mic-permission").textContent).toBe("prompt");
    });

    it("requests nothing before a click, then only on the click", async () => {
      stubPermission("prompt");
      const f = makeFakes();
      const host = await render(ui(f));

      expect(f.start).not.toHaveBeenCalled();
      expect(getUserMedia).not.toHaveBeenCalled();

      await click(need(host, "mic-enable"));
      expect(f.start).toHaveBeenCalledTimes(1);
      expect(need(host, "mic-permission").textContent).toBe("granted");
    });

    it("moves to denied when capture.start rejects with permission-denied", async () => {
      stubPermission("prompt");
      const f = makeFakes();
      f.start.mockRejectedValue({ code: "permission-denied", message: "no" });
      const host = await render(ui(f));

      await click(need(host, "mic-enable"));
      expect(need(host, "mic-permission").textContent).toBe("denied");
      expect(need(host, "mic-error").textContent).toBe("permission-denied");
    });
  });

  describe("calibrate (15.6, 15.7)", () => {
    it("succeeds and leaves no error", async () => {
      stubPermission("granted");
      const f = makeFakes();
      f.calibrate.mockImplementation(async () => {
        f.store.set(STORED);
        return STORED;
      });
      const host = await render(ui(f));
      expect(need(host, "mic-calibration-state").textContent).toBe("uncalibrated");

      await click(need(host, "mic-calibrate"));
      expect(f.calibrate).toHaveBeenCalledTimes(1);
      expect(need(host, "mic-calibration-state").textContent).toBe("calibrated");
      expect(byId(host, "mic-error")).toBeNull();
    });

    it("shows the error code, state failed, and leaves the stored Calibration unchanged", async () => {
      stubPermission("granted");
      const f = makeFakes();
      f.store.set(STORED);
      f.calibrate.mockRejectedValue({ code: "room-too-loud", message: "loud" });
      const host = await render(ui(f));

      await click(need(host, "mic-calibrate"));
      expect(need(host, "mic-error").textContent).toBe("room-too-loud");
      expect(need(host, "mic-calibration-state").textContent).toBe("failed");
      expect(f.store.get()).toEqual(STORED);
    });

    it("keeps an unset store unset after a failure", async () => {
      stubPermission("granted");
      const f = makeFakes();
      f.calibrate.mockRejectedValue({ code: "no-clicks-detected", message: "none" });
      const host = await render(ui(f));

      await click(need(host, "mic-calibrate"));
      expect(need(host, "mic-calibration-state").textContent).toBe("failed");
      expect(f.store.get()).toBeNull();
    });
  });

  describe("denied permission (15.8, 15.13)", () => {
    it("disables calibrate and shows tap mode", async () => {
      stubPermission("denied");
      const f = makeFakes();
      const host = await render(ui(f));

      expect((need(host, "mic-calibrate") as HTMLButtonElement).disabled).toBe(true);
      expect(byId(host, "mic-tap-mode")).not.toBeNull();

      await click(need(host, "mic-calibrate"));
      expect(f.calibrate).not.toHaveBeenCalled();
    });

    it("hides tap mode while permission is not denied", async () => {
      stubPermission("granted");
      const host = await render(ui(makeFakes()));
      expect(byId(host, "mic-tap-mode")).toBeNull();
      expect((need(host, "mic-calibrate") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("tap mode (15.14)", () => {
    it("switches the source to the Tap_Source within 100 ms", async () => {
      stubPermission("denied");
      const f = makeFakes();
      const host = await render(ui(f));
      const button = need(host, "mic-tap-mode");

      const t0 = performance.now();
      await click(button);
      const elapsed = performance.now() - t0;

      expect(f.tapStart).toHaveBeenCalledTimes(1);
      expect(f.onSourceChange).toHaveBeenCalledTimes(1);
      expect(f.onSourceChange).toHaveBeenCalledWith(f.tap);
      expect(f.tapStart.mock.invocationCallOrder[0]!).toBeLessThan(
        f.onSourceChange.mock.invocationCallOrder[0]!,
      );
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe("test ids", () => {
    it("renders every data-testid in the denied state after a failed enable", async () => {
      stubPermission("prompt");
      const f = makeFakes();
      f.start.mockRejectedValue({ code: "permission-denied", message: "no" });
      const host = await render(ui(f));
      await click(need(host, "mic-enable"));

      for (const id of TEST_IDS) expect(byId(host, id), id).not.toBeNull();
    });

    it("reports the input level on mic-level", async () => {
      stubPermission("granted");
      const f = makeFakes();
      const host = await render(ui(f));
      await act(async () => {
        f.captureEmitter.emit({ type: "level", timestamp: 1, source: "mic", level: -30 });
      });
      expect(need(host, "mic-level").getAttribute("data-level")).toBe("0.5");
    });
  });
});
