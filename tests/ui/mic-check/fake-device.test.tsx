// **Validates: Requirements 15.3, 15.4, 2.1**
// Needs the `ui` project's Chromium flags --use-fake-device-for-media-stream and
// --use-fake-ui-for-media-stream: a fake microphone and an auto-accepted prompt.
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import {
  createAudioEngine,
  createCalibrationStore,
  createCalibrator,
  createCapturePipeline,
  createGate,
  createSynth,
  createTapSource,
} from "@earworm/browser";
import type { AudioEngine, CapturePipeline } from "@earworm/browser";
import { MicCheck } from "@earworm/ui";
import { render, unmount } from "../../helpers/react";

const WINDOW_MS = 2000;
const MAX_STALENESS_MS = 100;

let activeCapture: CapturePipeline | null = null;
let activeEngine: AudioEngine | null = null;

afterEach(async () => {
  await unmount();
  await activeCapture?.stop();
  activeCapture = null;
  const ctx = activeEngine?.context;
  activeEngine = null;
  if (ctx instanceof AudioContext && ctx.state !== "closed") await ctx.close();
});

function byId(host: HTMLElement, id: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (el === null) throw new Error(`missing ${id}`);
  return el;
}

describe("MicCheck with a fake media device", () => {
  it(
    "starts a real Capture_Pipeline, reads granted, and updates mic-level at least 10 times per second",
    { timeout: 30_000 },
    async () => {
      const engine = createAudioEngine();
      activeEngine = engine;
      const gate = createGate();
      if (!gate.ok) throw new Error("gate failed");
      const store = createCalibrationStore();
      const capture = createCapturePipeline(engine, {
        gate: gate.value,
        calibration: store,
      });
      activeCapture = capture;
      const synth = createSynth(engine, { gate: gate.value });
      const calibrator = createCalibrator({
        engine,
        synth,
        source: capture,
        store,
        detectors: [],
      });
      const tap = createTapSource({
        now: () => engine.now(),
        keyTarget: document,
        pointerTarget: document,
      });

      const host = await render(
        createElement(MicCheck, {
          capture,
          tap,
          calibrator,
          store,
          onSourceChange: () => {},
        }),
      );

      // A real Playwright click gives user activation, so the autoplay policy lets
      // the AudioContext resume. A synthetic element.click() would not.
      await userEvent.click(byId(host, "mic-enable"));
      await expect
        .poll(() => byId(host, "mic-permission").textContent, {
          timeout: 10_000,
        })
        .toBe("granted");
      expect(capture.state).toBe("running");
      expect(host.querySelector('[data-testid="mic-error"]')).toBeNull();

      // The meter's attribute only changes when the level changes, and the fake
      // device's beep is silent (level 0) most of the time. So instead of counting
      // DOM mutations, sample the meter and check it always shows a level no older
      // than 100 ms, which is what "at least 10 updates per second" guarantees.
      const received: { at: number; level: number }[] = [];
      const off = capture.subscribe((e) => {
        if (e.type !== "level" || !Number.isFinite(e.level)) return;
        const clamped = Math.min(0, Math.max(-60, e.level));
        received.push({ at: performance.now(), level: (clamped + 60) / 60 });
      });
      const meter = byId(host, "mic-level");
      const stale: number[] = [];
      let samples = 0;
      const start = performance.now();
      while (performance.now() - start < WINDOW_MS) {
        await new Promise((r) => setTimeout(r, 20));
        const now = performance.now();
        if (now - start < MAX_STALENESS_MS) continue; // let the first events arrive
        samples++;
        const shown = Number(meter.getAttribute("data-level"));
        const fresh = received.filter((r) => now - r.at <= MAX_STALENESS_MS);
        if (!fresh.some((r) => Math.abs(r.level - shown) < 1e-9))
          stale.push(shown);
      }
      off();

      const perSecond = (n: number): number => n / (WINDOW_MS / 1000);
      expect(perSecond(received.length)).toBeGreaterThanOrEqual(10);
      expect(samples).toBeGreaterThan(0);
      expect(stale).toEqual([]);
    },
  );
});
