import { afterEach, describe, expect, it } from "vitest";
import { createTapSource } from "@earworm/browser";
import type { EarwormEvent, KitError } from "@earworm/core";

// Example tests for the Tap_Source DOM listeners.
// **Validates: Requirements 9.6, 9.7, 9.8, 9.12**

/** A fake DOM target that records which listeners are attached. */
class FakeTarget extends EventTarget {
  readonly active = new Set<string>();
  override addEventListener(
    type: string,
    cb: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.active.add(type);
    super.addEventListener(type, cb, options);
  }
  override removeEventListener(
    type: string,
    cb: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    this.active.delete(type);
    super.removeEventListener(type, cb, options);
  }
}

const key = (type: "keydown" | "keyup", init: KeyboardEventInit = {}) =>
  new KeyboardEvent(type, { code: "Space", cancelable: true, ...init });
const pointer = (type: "pointerdown" | "pointerup" | "pointercancel") =>
  new PointerEvent(type, { cancelable: true });

function setup(now: () => number = () => 100) {
  const keyTarget = new FakeTarget();
  const pointerTarget = new FakeTarget();
  let calls = 0;
  const source = createTapSource({
    now: () => {
      calls += 1;
      return now();
    },
    keyTarget,
    pointerTarget,
  });
  const events: EarwormEvent[] = [];
  const errors: KitError[] = [];
  source.subscribe((e) => events.push(e));
  source.subscribeErrors((e) => errors.push(e));
  source.start();
  return { source, keyTarget, pointerTarget, events, errors, calls: () => calls };
}

const stripped = (events: EarwormEvent[]) =>
  events.map((e) => ({ type: e.type, timestamp: e.timestamp, source: e.source }));

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

describe("Tap_Source DOM mapping", () => {
  it("maps Space keydown and keyup to onset and release", () => {
    let t = 10;
    const s = setup(() => t);
    const down = key("keydown");
    s.keyTarget.dispatchEvent(down);
    t = 50;
    const up = key("keyup");
    s.keyTarget.dispatchEvent(up);
    expect(stripped(s.events)).toEqual([
      { type: "onset", timestamp: 10, source: "tap" },
      { type: "release", timestamp: 50, source: "tap" },
    ]);
    expect(s.events[0]).toMatchObject({ strength: 1 });
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(s.errors).toEqual([]);
  });

  it("calls now() once per handled event", () => {
    const s = setup();
    s.keyTarget.dispatchEvent(key("keydown"));
    expect(s.calls()).toBe(1);
    s.keyTarget.dispatchEvent(key("keyup"));
    expect(s.calls()).toBe(2);
  });

  it("ignores keys other than Space", () => {
    const s = setup();
    const e = key("keydown", { code: "KeyA" });
    s.keyTarget.dispatchEvent(e);
    s.keyTarget.dispatchEvent(key("keyup", { code: "KeyA" }));
    expect(s.events).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
    expect(s.calls()).toBe(0);
  });

  it("consumes auto-repeat while held without emitting", () => {
    const s = setup();
    s.keyTarget.dispatchEvent(key("keydown"));
    const rep = key("keydown", { repeat: true });
    s.keyTarget.dispatchEvent(rep);
    expect(s.events).toHaveLength(1);
    expect(rep.defaultPrevented).toBe(true);
  });

  it("does not prevent a keyup or repeat that was not handled", () => {
    const s = setup();
    const up = key("keyup");
    s.keyTarget.dispatchEvent(up);
    const rep = key("keydown", { repeat: true });
    s.keyTarget.dispatchEvent(rep);
    expect(s.events).toEqual([]);
    expect(up.defaultPrevented).toBe(false);
    expect(rep.defaultPrevented).toBe(false);
  });

  it("maps pointerdown, pointerup and pointercancel", () => {
    let t = 5;
    const s = setup(() => t);
    const down = pointer("pointerdown");
    s.pointerTarget.dispatchEvent(down);
    t = 25;
    const up = pointer("pointerup");
    s.pointerTarget.dispatchEvent(up);
    t = 30;
    s.pointerTarget.dispatchEvent(pointer("pointerdown"));
    t = 40;
    s.pointerTarget.dispatchEvent(pointer("pointercancel"));
    expect(stripped(s.events)).toEqual([
      { type: "onset", timestamp: 5, source: "tap" },
      { type: "release", timestamp: 25, source: "tap" },
      { type: "onset", timestamp: 30, source: "tap" },
      { type: "release", timestamp: 40, source: "tap" },
    ]);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
  });

  it("does not prevent a pointerdown while the space bar is held", () => {
    const s = setup();
    s.keyTarget.dispatchEvent(key("keydown"));
    const down = pointer("pointerdown");
    s.pointerTarget.dispatchEvent(down);
    expect(s.events).toHaveLength(1);
    expect(down.defaultPrevented).toBe(false);
  });

  it("releases a held press on blur without preventing the event", () => {
    let t = 1;
    const s = setup(() => t);
    s.keyTarget.dispatchEvent(key("keydown"));
    t = 9;
    const blur = new Event("blur", { cancelable: true });
    s.keyTarget.dispatchEvent(blur);
    expect(stripped(s.events).at(-1)).toEqual({
      type: "release",
      timestamp: 9,
      source: "tap",
    });
    expect(blur.defaultPrevented).toBe(false);
  });

  it("releases a held press when the page becomes hidden", () => {
    let t = 1;
    const s = setup(() => t);
    const original = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    cleanup.push(() => {
      Reflect.deleteProperty(document, "visibilityState");
      if (original) Object.defineProperty(Document.prototype, "visibilityState", original);
    });
    s.keyTarget.dispatchEvent(key("keydown"));
    t = 7;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(stripped(s.events).at(-1)).toEqual({
      type: "release",
      timestamp: 7,
      source: "tap",
    });
    s.source.stop();
  });
});

describe("Tap_Source text-input focus", () => {
  it("does not prevent or emit for Space while an <input> has focus", () => {
    const s = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    cleanup.push(() => input.remove());
    input.focus();
    expect(document.activeElement).toBe(input);

    const down = key("keydown");
    s.keyTarget.dispatchEvent(down);
    s.keyTarget.dispatchEvent(key("keyup"));
    expect(s.events).toEqual([]);
    expect(down.defaultPrevented).toBe(false);
  });

  it("does the same when the event target is the <input> itself", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    cleanup.push(() => input.remove());
    const events: EarwormEvent[] = [];
    const source = createTapSource({
      now: () => 1,
      keyTarget: input,
      pointerTarget: new FakeTarget(),
    });
    source.subscribe((e) => events.push(e));
    source.start();
    const down = key("keydown");
    input.dispatchEvent(down);
    expect(events).toEqual([]);
    expect(down.defaultPrevented).toBe(false);
    source.stop();
  });

  it.each(["textarea", "select"])("treats a focused <%s> as a text input", (tag) => {
    const s = setup();
    const el = document.createElement(tag);
    document.body.appendChild(el);
    cleanup.push(() => el.remove());
    el.focus();
    const down = key("keydown");
    s.keyTarget.dispatchEvent(down);
    expect(s.events).toEqual([]);
    expect(down.defaultPrevented).toBe(false);
  });
});

describe("Tap_Source clock failure", () => {
  const failures: Array<[string, () => number]> = [
    ["returns null", () => null as unknown as number],
    [
      "throws",
      () => {
        throw new Error("context closed");
      },
    ],
  ];

  it.each(failures)("drops the input and reports clock-unavailable when now() %s", (_n, now) => {
    const s = setup(now);
    const down = key("keydown");
    s.keyTarget.dispatchEvent(down);
    s.pointerTarget.dispatchEvent(pointer("pointerdown"));
    expect(s.events).toEqual([]);
    expect(s.errors).toHaveLength(2);
    expect(s.errors.every((e) => e.code === "clock-unavailable")).toBe(true);
    expect(down.defaultPrevented).toBe(false);
  });

  it("recovers when the clock returns", () => {
    let ok = false;
    const s = setup(() => {
      if (!ok) throw new Error("gone");
      return 3;
    });
    s.keyTarget.dispatchEvent(key("keydown"));
    ok = true;
    s.keyTarget.dispatchEvent(key("keydown"));
    expect(stripped(s.events)).toEqual([{ type: "onset", timestamp: 3, source: "tap" }]);
    expect(s.errors).toHaveLength(1);
  });

  it("stops the source even when the clock is unavailable", () => {
    const s = setup(() => {
      throw new Error("gone");
    });
    s.source.stop();
    expect(s.keyTarget.active.size).toBe(0);
    expect(s.pointerTarget.active.size).toBe(0);
  });
});

describe("Tap_Source stop", () => {
  it("releases a held press and leaves no listener", () => {
    const s = setup();
    s.keyTarget.dispatchEvent(key("keydown"));
    expect(s.keyTarget.active.size).toBeGreaterThan(0);
    expect(s.pointerTarget.active.size).toBeGreaterThan(0);
    s.source.stop();
    expect(s.events.map((e) => e.type)).toEqual(["onset", "release"]);
    expect(s.keyTarget.active.size).toBe(0);
    expect(s.pointerTarget.active.size).toBe(0);

    const before = s.events.length;
    const calls = s.calls();
    const down = key("keydown");
    s.keyTarget.dispatchEvent(down);
    s.pointerTarget.dispatchEvent(pointer("pointerdown"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(s.events).toHaveLength(before);
    expect(s.calls()).toBe(calls);
    expect(down.defaultPrevented).toBe(false);
  });

  it("removes the document visibilitychange listener", () => {
    const added: string[] = [];
    const removed: string[] = [];
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = ((t: string, ...r: unknown[]) => {
      added.push(t);
      return (add as (...a: unknown[]) => void)(t, ...r);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((t: string, ...r: unknown[]) => {
      removed.push(t);
      return (remove as (...a: unknown[]) => void)(t, ...r);
    }) as typeof document.removeEventListener;
    cleanup.push(() => {
      document.addEventListener = add;
      document.removeEventListener = remove;
    });
    const s = setup();
    s.source.stop();
    expect(added).toContain("visibilitychange");
    expect(removed).toContain("visibilitychange");
  });
});
