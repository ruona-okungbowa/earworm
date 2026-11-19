// **Validates: Requirements 15.11**
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { createEmitter } from "@earworm/core";
import type { EventSource } from "@earworm/core";
import { createCalibrationStore } from "@earworm/browser";
import type { Calibrator, CapturePipeline, TapSource } from "@earworm/browser";
import { MicCheck } from "@earworm/ui";
import { render, unmount } from "../../helpers/react";

interface Fakes {
  capture: CapturePipeline;
  tap: TapSource;
  calibrator: Calibrator;
  counts: { enable: number; calibrate: number; tap: number };
}

function fakes(opts: { denied: boolean }): Fakes {
  const counts = { enable: 0, calibrate: 0, tap: 0 };
  const capture = {
    ...createEmitter(),
    state: "idle",
    async start() {
      counts.enable++;
      if (opts.denied) throw { code: "permission-denied", message: "denied" };
    },
    async stop() {},
  } as unknown as CapturePipeline;
  const tap = {
    ...createEmitter(),
    start() {
      counts.tap++;
    },
    stop() {},
    subscribeErrors: () => () => {},
  } as unknown as TapSource;
  const calibrator = {
    async calibrate() {
      counts.calibrate++;
      return { noiseFloorDbfs: -50, latencyMs: 20 };
    },
  } as unknown as Calibrator;
  return { capture, tap, calibrator, counts };
}

let restore: (() => void) | null = null;

/** Makes the browser report microphone permission as denied, so the tap control shows without racing the permission query. */
function denyPermission(): void {
  const original = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (async () => ({
    state: "denied",
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof navigator.permissions.query;
  restore = () => {
    navigator.permissions.query = original;
  };
}

async function mount(f: Fakes): Promise<HTMLElement> {
  return render(
    createElement(MicCheck, {
      capture: f.capture,
      tap: f.tap,
      calibrator: f.calibrator,
      store: createCalibrationStore(),
      onSourceChange: (_s: EventSource) => {},
    }),
  );
}

function controls(host: HTMLElement): HTMLElement[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(
      "button, a[href], input, select, textarea, [tabindex]",
    ),
  );
}

/** Accessible name from aria-label, aria-labelledby, then text content. */
function accessibleName(el: HTMLElement): string {
  const label = el.getAttribute("aria-label")?.trim();
  if (label) return label;
  const ids = el.getAttribute("aria-labelledby");
  if (ids) {
    const text = ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }
  return (el.textContent ?? "").trim();
}

const byTestId = (host: HTMLElement, id: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (el === null) throw new Error(`missing ${id}`);
  return el;
};

/** Presses Tab from the top of the page until focus has visited every control. */
async function tabOrder(count: number): Promise<Element[]> {
  (document.activeElement as HTMLElement | null)?.blur();
  const visited: Element[] = [];
  for (let i = 0; i < count; i++) {
    await userEvent.tab();
    visited.push(document.activeElement as Element);
  }
  return visited;
}

afterEach(async () => {
  await unmount();
  restore?.();
  restore = null;
});

describe("MicCheck keyboard and accessibility", () => {
  it("gives every control an accessible name", async () => {
    const f = fakes({ denied: false });
    const host = await mount(f);
    const all = controls(host);
    expect(all.length).toBeGreaterThan(0);
    for (const el of all) expect(accessibleName(el)).not.toBe("");

    // The tap control appears once permission is denied.
    await unmount();
    denyPermission();
    const host2 = await mount(fakes({ denied: true }));
    await expect
      .poll(() => host2.querySelector('[data-testid="mic-tap-mode"]'))
      .not.toBeNull();
    for (const el of controls(host2)) expect(accessibleName(el)).not.toBe("");
  });

  it("reaches the enable and calibrate buttons with Tab", async () => {
    const host = await mount(fakes({ denied: false }));
    const order = await tabOrder(2);
    expect(order).toEqual([
      byTestId(host, "mic-enable"),
      byTestId(host, "mic-calibrate"),
    ]);
  });

  it("reaches the enable and tap-mode buttons with Tab when permission is denied", async () => {
    denyPermission();
    const host = await mount(fakes({ denied: true }));
    await expect
      .poll(() => host.querySelector('[data-testid="mic-tap-mode"]'))
      .not.toBeNull();
    const order = await tabOrder(2);
    expect(order).toEqual([
      byTestId(host, "mic-enable"),
      byTestId(host, "mic-tap-mode"),
    ]);
  });

  for (const [name, key] of [
    ["Enter", "{Enter}"],
    ["Space", " "],
  ] as const) {
    it(`activates enable and calibrate with ${name}`, async () => {
      const f = fakes({ denied: false });
      const host = await mount(f);
      await tabOrder(1);
      expect(document.activeElement).toBe(byTestId(host, "mic-enable"));
      await userEvent.keyboard(key);
      await expect.poll(() => f.counts.enable).toBe(1);

      await userEvent.tab();
      expect(document.activeElement).toBe(byTestId(host, "mic-calibrate"));
      await userEvent.keyboard(key);
      await expect.poll(() => f.counts.calibrate).toBe(1);
    });

    it(`activates tap mode with ${name}`, async () => {
      denyPermission();
      const f = fakes({ denied: true });
      const host = await mount(f);
      await expect
        .poll(() => host.querySelector('[data-testid="mic-tap-mode"]'))
        .not.toBeNull();
      byTestId(host, "mic-tap-mode").focus();
      expect(document.activeElement).toBe(byTestId(host, "mic-tap-mode"));
      await userEvent.keyboard(key);
      await expect.poll(() => f.counts.tap).toBe(1);
    });
  }
});
