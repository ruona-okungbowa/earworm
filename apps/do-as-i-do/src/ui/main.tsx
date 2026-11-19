import { useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { createCalibrator } from "@earworm/browser";
import {
  canBegin,
  dreadOf,
  initialSession,
  type Effect,
  type LineKey,
  type SessionState,
} from "../logic/index";
import {
  createDriver,
  lateSittings,
  systemRandom,
  type Driver,
} from "../runtime/index";
import { loadStoryScript } from "../story/story-script";
import type { StoryScript } from "../story/types";
import { Scene } from "./Scene";
import {
  AnswerLog,
  ContentWarningScreen,
  FinalScreen,
  MicCheckScreen,
  RefusalScreen,
  RevealPanel,
  SittingScreen,
  SittingStartScreen,
  StoryInvalidScreen,
  type Caption,
} from "./screens";
import { useSessionStore } from "./session-store";

/** What the Driver's effects leave for the screens to show. Replaced, never mutated, so snapshots are stable. */
interface View {
  readonly line: string;
  readonly cue: "may-reply" | "stay-silent" | "again" | null;
  readonly captions: readonly Caption[];
  readonly audioUnavailable: boolean;
  readonly pulses: number;
}

const EMPTY_VIEW: View = {
  line: "",
  cue: null,
  captions: [],
  audioUnavailable: false,
  pulses: 0,
};

function lineText(
  story: StoryScript,
  key: LineKey,
  index: number,
  sitting: number,
): string {
  const pick = (a: readonly string[]): string =>
    a.length === 0 ? "" : (a[index % a.length] ?? "");
  const l = story.lines;
  switch (key) {
    case "again":
      return pick(l.again);
    case "slower":
      return pick(l.slower);
    case "silence":
      return pick(l.silence);
    case "too-many":
      return pick(l.tooMany);
    case "too-few":
      return pick(l.tooFew);
    case "timing":
      return pick(l.timing);
    case "refusal":
      return pick(l.refusal[sitting === 2 ? 2 : 3]);
    case "intro":
      return story.sittings.find((s) => s.number === sitting)?.intro ?? "";
    case "retry-audio":
      return "";
  }
}

function startApp(root: HTMLElement): void {
  const loaded = loadStoryScript();
  if (!loaded.ok) {
    // Invalid Story_Script: show the issues and start no Session (Requirement 16.15).
    createRoot(root).render(<StoryInvalidScreen issues={loaded.issues} />);
    return;
  }
  const story = loaded.value;
  const initial = initialSession(loaded);

  let view = EMPTY_VIEW;
  let captionId = 0;
  const viewListeners = new Set<() => void>();
  const setView = (v: View): void => {
    view = v;
    for (const l of [...viewListeners]) l();
  };

  const driver: Driver = createDriver({
    story,
    initial,
    random: systemRandom,
    late: lateSittings,
    onEffect: (e: Effect) => {
      const sitting = driver.getState().current;
      switch (e.kind) {
        case "line":
          return setView({
            ...view,
            line: lineText(story, e.key, e.index, sitting),
          });
        case "text":
          return setView({ ...view, line: e.text });
        case "cue":
          return setView({ ...view, cue: e.cue });
        case "pulse":
          return setView({ ...view, pulses: view.pulses + 1 });
        case "audio-unavailable":
          return setView({ ...view, audioUnavailable: true });
        default:
          return; // kit-error is read from Session state
      }
    },
    onCaption: (text) =>
      setView({
        ...view,
        captions: [...view.captions, { id: ++captionId, text }],
      }),
  });

  const viewStore = {
    subscribe: (l: () => void) => (
      viewListeners.add(l),
      () => void viewListeners.delete(l)
    ),
    getSnapshot: () => view,
  };
  const sessionStore = {
    subscribe: driver.subscribe,
    getSnapshot: driver.getState,
  };

  createRoot(root).render(
    <App
      story={story}
      driver={driver}
      sessionStore={sessionStore}
      viewStore={viewStore}
      resetView={() => setView(EMPTY_VIEW)}
    />,
  );
}

function App(p: {
  story: StoryScript;
  driver: Driver;
  sessionStore: {
    subscribe(l: () => void): () => void;
    getSnapshot(): SessionState;
  };
  viewStore: { subscribe(l: () => void): () => void; getSnapshot(): View };
  resetView: () => void;
}) {
  const { story, driver } = p;
  const s = useSessionStore(p.sessionStore);
  const view = useSessionStore(p.viewStore);
  const kit = driver.kit;
  // One Calibrator per Session Kit; the driver builds none.
  const calibrator = useMemo(
    () =>
      kit &&
      createCalibrator({
        engine: kit.engine,
        synth: kit.synth,
        source: kit.capture,
        store: kit.store,
        detectors: [],
      }),
    [kit],
  );
  // MicCheck writes only the Calibration store; mirror it into the Session's setup state for canBegin.
  // Calibrating needs a running microphone, so a stored Calibration also means permission was granted.
  useEffect(() => {
    if (!kit) return;
    return kit.store.subscribe((c) => {
      if (c === null) return;
      driver.send({
        kind: "setup",
        change: { kind: "permission", permission: "granted" },
      });
      driver.send({
        kind: "setup",
        change: { kind: "calibration", calibration: "calibrated" },
      });
    });
  }, [kit, driver]);
  const data = story.sittings.find((x) => x.number === s.current);
  const title = data?.title ?? "";
  const dread = story.dread[dreadOf(s)] ?? story.dread[0]!;

  let screen;
  switch (s.screen) {
    case "content-warning":
      screen = (
        <ContentWarningScreen
          jumpScare={s.jumpScare}
          audioError={s.setup.audioError}
          onToggleJumpScare={(on) =>
            driver.send({ kind: "toggle-jump-scare", on })
          }
          onStart={() => {
            p.resetView();
            void driver.start();
          }}
        />
      );
      break;
    case "mic-check":
      screen =
        kit && calibrator ? (
          <MicCheckScreen
            mic={{
              capture: kit.capture,
              tap: kit.tap,
              calibrator,
              store: kit.store,
              // Tap mode chosen in MicCheck.
              onSourceChange: () => driver.setInputMode("tap"),
            }}
            canBegin={canBegin({
              mode: s.inputMode,
              permission: s.setup.permission,
              calibration: s.setup.calibration,
              skipCalibration: s.setup.skipCalibration,
            })}
            onBegin={() => driver.send({ kind: "begin-pressed" })}
          />
        ) : null;
      break;
    case "sitting-start":
      screen = (
        <SittingStartScreen
          number={s.current}
          title={title}
          kitError={s.kitError}
          onBegin={() => driver.send({ kind: "begin-sitting-pressed" })}
          onSwitchToTap={() => driver.setInputMode("tap")}
        />
      );
      break;
    case "sitting":
      screen = (
        <SittingScreen
          number={s.current}
          title={title}
          inputMode={s.inputMode}
          cue={view.cue}
          captions={view.captions}
          presenceLine={view.line}
          audioUnavailable={view.audioUnavailable}
          replayEnabled={view.cue === "may-reply"}
          onReplay={() => driver.send({ kind: "replay-requested" })}
          onRetryAudio={() => driver.send({ kind: "audio-retry" })}
          intro={
            s.current >= 4 && data
              ? {
                  text: data.intro,
                  onFinished: () => driver.send({ kind: "intro-finished" }),
                }
              : undefined
          }
        />
      );
      break;
    case "refusal":
      screen = <RefusalScreen line={view.line} />;
      break;
    case "reveal":
      screen = s.reveal && (
        <RevealPanel
          text={s.reveal.text}
          startedMs={s.reveal.startedMs}
          now={() => kit?.engine.now() ?? 0}
          onSkip={() => driver.send({ kind: "skip-reveal" })}
        />
      );
      break;
    case "final":
      screen = (
        <FinalScreen
          ending={s.answerLog[s.answerLog.length - 1] ?? ""}
          onRestart={() => driver.send({ kind: "restart" })}
        />
      );
      break;
    case "story-invalid":
      screen = <StoryInvalidScreen issues={s.issues} />;
      break;
  }

  return (
    <>
      <Scene dread={dread} pulses={view.pulses} />
      {screen}
      {s.screen !== "story-invalid" && <AnswerLog entries={s.answerLog} />}
    </>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) startApp(rootEl);
