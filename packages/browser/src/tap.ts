import { createEmitter } from "@earworm/core";
import type { EventSource, KitError, Ms, Unsubscribe } from "@earworm/core";
import { tapStep } from "./tap-model.js";
import type { TapInput, TapState } from "./tap-model.js";

export interface TapSourceOptions {
  /** Audio-context time in milliseconds. May throw when the clock is gone. */
  now: () => Ms;
  /** Receives `keydown`, `keyup` and `blur`, usually `window`. */
  keyTarget: EventTarget;
  /** Receives pointer events, the element the user taps. */
  pointerTarget: EventTarget;
}

export interface TapSource extends EventSource {
  start(): void;
  stop(): void;
  subscribeErrors(listener: (e: KitError) => void): Unsubscribe;
}

function isTextInput(el: unknown): boolean {
  if (el === null || typeof el !== "object") return false;
  const e = el as { tagName?: unknown; isContentEditable?: unknown };
  if (e.isContentEditable === true) return true;
  if (typeof e.tagName !== "string") return false;
  const tag = e.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function focusInTextInput(event: Event): boolean {
  if (isTextInput(event.target)) return true;
  const doc = (globalThis as { document?: Document }).document;
  return isTextInput(doc?.activeElement);
}

export function createTapSource(opts: TapSourceOptions): TapSource {
  const { keyTarget, pointerTarget } = opts;
  const emitter = createEmitter();
  const errorListeners = new Set<(e: KitError) => void>();
  let state: TapState = { held: null, stopped: false };
  let attached: Array<() => void> = [];

  const readNow = (): Ms | null => {
    try {
      const t = opts.now();
      return typeof t === "number" && Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  };

  const apply = (input: TapInput, event?: Event): void => {
    const result = tapStep(state, input);
    state = result.state;
    for (const e of result.events) {
      try {
        emitter.emit(e);
      } catch {
        // a listener failure never stops the source
      }
    }
    if (result.error) {
      for (const l of [...errorListeners]) {
        try {
          l(result.error);
        } catch {
          // ignore
        }
      }
    }
    if (result.handled && event) event.preventDefault();
  };

  const listen = (
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
  ): void => {
    target.addEventListener(type, handler);
    attached.push(() => target.removeEventListener(type, handler));
  };

  const isSpace = (e: Event): boolean =>
    (e as KeyboardEvent).code === "Space";

  return {
    subscribe: (listener) => emitter.subscribe(listener),

    subscribeErrors(listener) {
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
      };
    },

    start() {
      if (state.stopped || attached.length > 0) return;
      listen(keyTarget, "keydown", (e) => {
        if (!isSpace(e)) return;
        apply(
          {
            kind: "key-down",
            repeat: (e as KeyboardEvent).repeat === true,
            inTextInput: focusInTextInput(e),
            now: readNow(),
          },
          e,
        );
      });
      listen(keyTarget, "keyup", (e) => {
        if (!isSpace(e)) return;
        apply({ kind: "key-up", now: readNow() }, e);
      });
      listen(keyTarget, "blur", () => {
        apply({ kind: "blur", now: readNow() });
      });
      listen(pointerTarget, "pointerdown", (e) => {
        apply({ kind: "pointer-down", onTarget: true, now: readNow() }, e);
      });
      const up = (e: Event): void => {
        apply({ kind: "pointer-up", now: readNow() }, e);
      };
      listen(pointerTarget, "pointerup", up);
      listen(pointerTarget, "pointercancel", up);
      const doc = (globalThis as { document?: Document }).document;
      if (doc) {
        listen(doc, "visibilitychange", () => {
          if (doc.visibilityState === "hidden") {
            apply({ kind: "blur", now: readNow() });
          }
        });
      }
    },

    stop() {
      apply({ kind: "stop", now: readNow() });
      const removers = attached;
      attached = [];
      for (const remove of removers) remove();
    },
  };
}
