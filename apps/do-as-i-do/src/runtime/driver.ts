import type { Ms } from "@earworm/core";
import {
  canUseMic as kitCanUseMic,
  createAudioEngine,
  createCalibrationStore,
  createCapturePipeline,
  createGate,
  createSynth,
  createTapSource,
  type AudioEngine,
  type CalibrationStore,
  type CapturePipeline,
  type Gate,
  type Synth,
  type TapSource,
} from "@earworm/browser";
import {
  AMBIENT_STOP_RAMP_MS,
  TICK_MS,
  clear,
  dreadOf,
  due,
  enqueue,
  stepSession,
  type Effect,
  type InputMode,
  type LateSittings,
  type PlayQueue,
  type RandomSource,
  type SessionInput,
  type SessionState,
  type SittingInput,
} from "../logic/index.js";
import type { StoryScript } from "../story/types.js";
import { createAmbientRig, type AmbientRig } from "./ambient-rig.js";
import { createAudioDirector, type AudioDirector } from "./audio-director.js";
import { createInput, type Input } from "./input.js";

/** What one Session builds on the start control. Exposed so MicCheck can use the same capture and tap. */
export interface Kit {
  readonly engine: AudioEngine;
  readonly gate: Gate;
  readonly synth: Synth;
  readonly capture: CapturePipeline;
  readonly tap: TapSource;
  readonly store: CalibrationStore;
}

export interface DriverOptions {
  /** null only for a story-invalid Session. */
  story: StoryScript | null;
  initial: SessionState;
  random: RandomSource;
  late?: LateSittings | null;
  /** Called for every effect the UI renders: line, text, cue, pulse, kit-error, audio-unavailable. */
  onEffect?: (effect: Effect) => void;
  /** Text equivalent of a sound (Requirement 15.4). */
  onCaption?: (text: string, atMs: Ms) => void;
  // Seams for tests. Defaults are the real browser objects.
  createEngine?: () => AudioEngine;
  canUseMic?: () => boolean;
  keyTarget?: EventTarget;
  pointerTarget?: EventTarget;
  log?: (message: string, error: unknown) => void;
}

export interface Driver {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  /** The current Session's Kit, or null before start and after restart. */
  readonly kit: Kit | null;
  /** The start control: creates and resumes the AudioContext, then builds the Session's Kit. */
  start(): Promise<void>;
  /** Applies a UI input now. `restart` tears the Session's audio down first. */
  send(input: SessionInput): void;
  /** Switches Input_Mode, through the active input when there is one. */
  setInputMode(mode: InputMode): void;
  /** Delivers queued source inputs, then the tick for `nowMs`, then starts due knocks. */
  tick(nowMs: Ms): void;
  dispose(): void;
}

export function createDriver(opts: DriverOptions): Driver {
  const log =
    opts.log ?? ((m: string, e: unknown): void => console.error(m, e));
  const story = opts.story;
  const deps = { story, random: opts.random, late: opts.late ?? null };
  const micAllowed = opts.canUseMic ?? kitCanUseMic;

  let state = opts.initial;
  let engine: AudioEngine | null = null; // created on start, reused after restart
  let kit: Kit | null = null;
  let director: AudioDirector | null = null;
  let rig: AmbientRig | null = null;
  let input: Input | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let queue: PlayQueue = clear();
  let inbox: SittingInput[] = [];
  let lastDread = dreadOf(state);
  const failedPlays = new Set<string>();
  const listeners = new Set<() => void>();

  const nowMs = (): Ms => {
    try {
      return engine?.now() ?? 0;
    } catch {
      return 0; // clock gone
    }
  };

  const emit = (e: Effect): void => opts.onEffect?.(e);

  const startInput = (): void => {
    if (kit === null || input !== null) return;
    // Sitting 1 onwards: the ambient bed and the active event source start here, after the mic check,
    // so the ungated ambient sound cannot disturb the noise-floor measurement.
    input = createInput(
      {
        gate: kit.gate,
        capture: kit.capture,
        tap: kit.tap,
        onInput: (i) => inbox.push(i),
      },
      state.inputMode,
    );
    rig?.start();
  };

  const run = (input_: SessionInput, now: Ms): void => {
    const r = stepSession(state, input_, now, deps);
    state = r.state;
    for (const e of r.effects) execute(e, now);
    if (r.dread !== lastDread) {
      lastDread = r.dread;
      const d = story?.dread[r.dread];
      if (d && story) rig?.onDread(d.ambientGain, story.ambient.rampMs);
    }
    if (state.screen !== "content-warning" && state.screen !== "mic-check") {
      startInput();
    }
    for (const l of [...listeners]) l();
  };

  const execute = (e: Effect, now: Ms): void => {
    switch (e.kind) {
      case "play":
        failedPlays.delete(e.id);
        queue = enqueue(
          queue,
          e.hits.map((atMs) => ({
            id: e.id,
            atMs,
            role: e.role,
            variant: e.variant,
          })),
        );
        return;
      case "cancel-plays":
        queue = clear();
        return;
      case "sound":
        // A sound that cannot play never blocks the Round (Requirement 13.8).
        void director
          ?.playSound(e.sound, now)
          .then((ok) => {
            if (!ok) log(`driver: ${e.sound} sound failed`, e);
          });
        return;
      default:
        emit(e);
    }
  };

  const startDue = (now: Ms): void => {
    const d = due(queue, now);
    queue = d.q;
    for (const p of d.due) {
      void director?.playKnock(p.atMs).then((ok) => {
        if (ok) {
          emit({ kind: "pulse", atMs: p.atMs });
          return;
        }
        // One audio-failed per play; its remaining hits are dropped (Requirement 5.5).
        if (failedPlays.has(p.id)) return;
        failedPlays.add(p.id);
        queue = { items: queue.items.filter((q) => q.id !== p.id) };
        run({ kind: "audio-failed" }, nowMs());
      });
    }
  };

  const tick = (now: Ms): void => {
    const pending = inbox;
    inbox = [];
    for (const i of pending) run(i, now); // events before the tick for the same now
    run({ kind: "tick" }, now);
    startDue(now);
  };

  const teardown = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    input?.stop();
    if (kit !== null && input === null) {
      kit.tap.stop();
      void kit.capture.stop();
    }
    rig?.stop(); // ambient ramps to silence first
    const synth = kit?.synth;
    if (synth) setTimeout(() => synth.stop(), AMBIENT_STOP_RAMP_MS);
    kit = null;
    director = null;
    rig = null;
    input = null;
    queue = clear();
    inbox = [];
    failedPlays.clear();
  };

  const build = (eng: AudioEngine): Kit => {
    const store = createCalibrationStore();
    const g = createGate({ hasCalibration: () => store.get() !== null });
    if (!g.ok) throw g.error;
    const gate = g.value;
    const synth = createSynth(eng, { gate });
    const capture = createCapturePipeline(eng, { gate, calibration: store });
    const tap = createTapSource({
      now: () => eng.now(),
      keyTarget: opts.keyTarget ?? window,
      pointerTarget: opts.pointerTarget ?? document,
    });
    return { engine: eng, gate, synth, capture, tap, store };
  };

  const driver: Driver = {
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get kit() {
      return kit;
    },
    async start() {
      if (story === null || kit !== null) return;
      if (state.screen !== "content-warning") return;
      run({ kind: "start-pressed" }, nowMs());
      try {
        // The only place an AudioContext is created or resumed (Requirement 1.1).
        engine ??= (opts.createEngine ?? createAudioEngine)();
        const ctx = engine.context as { resume?: () => Promise<void> };
        await ctx.resume?.();
        kit = build(engine);
      } catch (e) {
        log("driver: audio could not start", e);
        run({ kind: "audio-failed" }, nowMs());
        return;
      }
      const k = kit;
      director = createAudioDirector({
        synth: k.synth,
        now: () => k.engine.now(),
        getJumpScare: () => state.jumpScare,
        quietPeakGainLimit: story.config.quietPeakGainLimit,
        onCaption: (text, atMs) => opts.onCaption?.(text, atMs),
        log,
      });
      lastDread = dreadOf(state);
      rig = createAmbientRig({
        engine: k.engine,
        synth: k.synth,
        startGain: story.dread[lastDread]?.ambientGain ?? 0,
        log,
      });
      timer = setInterval(() => tick(nowMs()), TICK_MS);
      // No microphone request on this path. Without mic support the Session is Tap-only.
      if (!micAllowed()) {
        run(
          { kind: "setup", change: { kind: "permission", permission: "unavailable" } },
          nowMs(),
        );
      }
      run({ kind: "audio-ready" }, nowMs());
    },
    send(i) {
      if (i.kind === "restart") {
        teardown();
        run(i, nowMs());
        return;
      }
      run(i, nowMs());
    },
    setInputMode(mode) {
      if (input !== null) input.setMode(mode);
      else run({ kind: "setup", change: { kind: "mode", mode } }, nowMs());
    },
    tick,
    dispose() {
      teardown();
      listeners.clear();
    },
  };
  return driver;
}
