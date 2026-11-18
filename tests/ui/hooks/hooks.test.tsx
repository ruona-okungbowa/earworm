// **Validates: Requirements 15.9, 15.10, 21.14, 21.15, 21.16**
import { act, createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitter } from "@earworm/core";
import type { EarwormEvent, Emitter, EventSource } from "@earworm/core";
import { createCalibrationStore } from "@earworm/browser";
import {
  useBands,
  useCalibrationState,
  useEnvelopeLevel,
  useEvents,
  useInputLevel,
  useSpectrum,
} from "@earworm/ui";
import { render, unmount } from "../../helpers/react";

interface Counted {
  emitter: Emitter;
  readonly listeners: () => number;
}

/** An emitter whose subscribe is wrapped to count live listeners. */
function counted(): Counted {
  const inner = createEmitter();
  let live = 0;
  const emitter: Emitter = {
    emit: (e) => inner.emit(e),
    subscribe(listener) {
      live++;
      const off = inner.subscribe(listener);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        live--;
        off();
      };
    },
  };
  return { emitter, listeners: () => live };
}

const ev = {
  level: (level: number): EarwormEvent => ({
    type: "level",
    timestamp: 1,
    source: "mic",
    level,
  }),
  envelope: (level: number, source = "mic"): EarwormEvent => ({
    type: "envelope",
    timestamp: 1,
    source,
    level,
  }),
  spectrum: (values: number[], source = "mic"): EarwormEvent => ({
    type: "spectrum",
    timestamp: 1,
    source,
    sampleRate: 48000,
    fftSize: values.length * 2,
    magnitudes: new Float32Array(values),
  }),
  band: (values: Record<string, number>, source = "mic"): EarwormEvent => ({
    type: "band",
    timestamp: 1,
    source,
    unit: "normalised",
    values,
  }),
  onset: (timestamp: number): EarwormEvent => ({
    type: "onset",
    timestamp,
    source: "mic",
    strength: 1,
  }),
};

async function emit(c: Counted, e: EarwormEvent): Promise<void> {
  await act(async () => {
    c.emitter.emit(e);
  });
}

/** Renders a host that runs `hook(source)` and lets the test switch the source in place. */
async function mountHook<T>(
  hook: (source: EventSource) => T,
  initial: EventSource,
) {
  const box: { value?: T; setSource?: (s: EventSource) => void } = {};
  function Host() {
    const [source, setSource] = useState<EventSource>(initial);
    box.setSource = setSource;
    box.value = hook(source);
    return null;
  }
  await render(createElement(Host));
  return {
    value: () => box.value as T,
    switchTo: async (s: EventSource) => {
      await act(async () => {
        box.setSource!(s);
      });
    },
  };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await unmount();
  errorSpy.mockRestore();
});

describe("UI hooks", () => {
  it("useEvents collects emitted events, oldest first, up to the limit", async () => {
    const c = counted();
    const h = await mountHook((s) => useEvents(s, { limit: 2 }), c.emitter);
    expect(h.value()).toEqual([]);
    await emit(c, ev.onset(1));
    await emit(c, ev.onset(2));
    await emit(c, ev.onset(3));
    expect(h.value().map((e) => e.timestamp)).toEqual([2, 3]);
  });

  it("useInputLevel maps the latest level event to 0..1", async () => {
    const c = counted();
    const h = await mountHook(useInputLevel, c.emitter);
    expect(h.value()).toBe(0);
    await emit(c, ev.level(-30));
    expect(h.value()).toBeCloseTo(0.5);
    await emit(c, ev.level(-200));
    expect(h.value()).toBe(0);
    await emit(c, ev.level(10));
    expect(h.value()).toBe(1);
  });

  it("useCalibrationState follows the Calibration store", async () => {
    const store = createCalibrationStore();
    const h = await mountHook(
      () => useCalibrationState(store),
      createEmitter(),
    );
    expect(h.value()).toBe("uncalibrated");
    await act(async () => {
      store.set({ noiseFloorDb: -50, latencyMs: 10 });
    });
    expect(h.value()).toBe("calibrated");
  });

  it("useEnvelopeLevel, useSpectrum and useBands reflect emitted events", async () => {
    const c = counted();
    const env = await mountHook(useEnvelopeLevel, c.emitter);
    expect(env.value()).toBeNull();
    await emit(c, ev.envelope(0.7));
    expect(env.value()).toBe(0.7);

    const spec = await mountHook(useSpectrum, c.emitter);
    expect(spec.value()).toBeNull();
    await emit(c, ev.spectrum([1, 2, 3]));
    expect(Array.from(spec.value()!)).toEqual([1, 2, 3]);

    const bands = await mountHook(useBands, c.emitter);
    expect(bands.value()).toBeNull();
    await emit(c, ev.band({ low: 0.25 }));
    expect(bands.value()).toEqual({ low: 0.25 });
  });

  it("leaves zero listeners and no React warning after unmount", async () => {
    const store = createCalibrationStore();
    const c = counted();
    function All() {
      useEvents(c.emitter);
      useInputLevel(c.emitter);
      useEnvelopeLevel(c.emitter);
      useSpectrum(c.emitter);
      useBands(c.emitter);
      useCalibrationState(store);
      return null;
    }
    await render(createElement(All));
    expect(c.listeners()).toBeGreaterThan(0);
    await unmount();
    expect(c.listeners()).toBe(0);
    await emit(c, ev.envelope(0.5));
    await emit(c, ev.level(-10));
    await emit(c, ev.spectrum([1]));
    await emit(c, ev.band({ a: 1 }));
    await act(async () => {
      store.set({ noiseFloorDb: -40, latencyMs: 0 });
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("keeps the latest envelope, spectrum and band values when the source switches", async () => {
    const mic = counted();
    const tap = counted();
    // render() unmounts the previous host, so each hook is checked in turn.
    const bands = await mountHook(useBands, mic.emitter);
    await emit(mic, ev.band({ hi: 0.9 }));
    await bands.switchTo(tap.emitter);
    expect(bands.value()).toEqual({ hi: 0.9 });
    expect(mic.listeners()).toBe(0);
    expect(tap.listeners()).toBe(1);
    await emit(tap, ev.band({ hi: 0.1 }, "tap"));
    expect(bands.value()).toEqual({ hi: 0.1 });

    const spec2 = await mountHook(useSpectrum, mic.emitter);
    await emit(mic, ev.spectrum([4, 5]));
    await spec2.switchTo(tap.emitter);
    expect(Array.from(spec2.value()!)).toEqual([4, 5]);
    await emit(tap, ev.spectrum([6], "tap"));
    expect(Array.from(spec2.value()!)).toEqual([6]);

    const env2 = await mountHook(useEnvelopeLevel, mic.emitter);
    await emit(mic, ev.envelope(0.4));
    await env2.switchTo(tap.emitter);
    expect(env2.value()).toBe(0.4);
    await emit(tap, ev.envelope(0.2, "tap"));
    expect(env2.value()).toBe(0.2);

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
