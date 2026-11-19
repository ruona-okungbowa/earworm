import { useEffect, useRef, useState } from "react";
import type { Ms, KitError } from "@earworm/core";
import { MicCheck, type MicCheckProps } from "@earworm/ui";
import type { StoryIssue } from "../story/types";
import { revealedChars } from "../logic/reveal";
import type { InputMode } from "../logic/types";
import { Panel } from "./theme";

/** Captions stay on screen at least this long (Req 15.4). */
export const CAPTION_HOLD_MS = 3000;

export interface Caption {
  readonly id: number; // unique and increasing; a new id is a new caption
  readonly text: string;
}

// A native button with aria-pressed: operable with Enter and Space (Req 3.2, 3.3).
export function JumpScareToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid="jump-scare-toggle"
      onClick={() => onChange(!on)}
    >
      Jump scares: {on ? "on" : "off"}
    </button>
  );
}

export function ContentWarningScreen(p: {
  jumpScare: boolean;
  /** The AudioContext could not start (Req 1.5). Start stays enabled for a retry. */
  audioError: boolean;
  onToggleJumpScare: (on: boolean) => void;
  onStart: () => void;
}) {
  return (
    <Panel title="Do As I Do" testId="content-warning">
      <p>
        Warning: this game uses flickering light, disturbing themes and sudden
        loud sounds. You will knock on a desk, and something will knock back.
      </p>
      <p className="dai-muted">
        Turn jump scares off to cap the volume of sudden sounds. Nothing is
        recorded or saved.
      </p>
      <JumpScareToggle on={p.jumpScare} onChange={p.onToggleJumpScare} />
      {p.audioError && (
        <p role="alert" data-testid="audio-error">
          The sound system could not start. Press start to try again.
        </p>
      )}
      <button type="button" data-testid="start" onClick={p.onStart}>
        Start
      </button>
    </Panel>
  );
}

export function MicCheckScreen(p: {
  mic: MicCheckProps;
  canBegin: boolean;
  onBegin: () => void;
}) {
  return (
    <Panel title="Check your microphone" testId="mic-check">
      <MicCheck {...p.mic} />
      <button
        type="button"
        data-testid="begin"
        disabled={!p.canBegin}
        onClick={p.onBegin}
      >
        Begin
      </button>
    </Panel>
  );
}

export function SittingStartScreen(p: {
  number: number;
  title: string;
  kitError: KitError | null;
  onBegin: () => void;
  /** Kit_Error panel: switch the Session to Tap (Req 6.9). */
  onSwitchToTap?: () => void;
}) {
  return (
    <Panel title={`Sitting ${p.number}`} testId="sitting-start">
      <p>{p.title}</p>
      {p.kitError && (
        <div role="alert" data-testid="kit-error">
          <p>Input problem: {p.kitError.code}. Retry, or switch to tapping.</p>
          {p.onSwitchToTap && (
            <button
              type="button"
              data-testid="switch-to-tap"
              onClick={p.onSwitchToTap}
            >
              Switch to Tap
            </button>
          )}
        </div>
      )}
      <button type="button" data-testid="begin-sitting" onClick={p.onBegin}>
        {p.kitError ? "Retry" : "Begin"} Sitting {p.number}: {p.title}
      </button>
    </Panel>
  );
}

const CUE_TEXT = {
  "may-reply": "Knock back now.",
  "stay-silent": "Stay silent.",
  again: "Again.",
} as const;

/** Keeps each caption for CAPTION_HOLD_MS after it first appears. */
function useHeldCaptions(captions: readonly Caption[]): readonly Caption[] {
  const [held, setHeld] = useState<readonly Caption[]>([]);
  const seen = useRef(new Set<number>());
  useEffect(() => {
    const fresh = captions.filter((c) => !seen.current.has(c.id));
    if (fresh.length === 0) return;
    fresh.forEach((c) => seen.current.add(c.id));
    setHeld((h) => [...h, ...fresh]);
    for (const c of fresh) {
      // Not cleared on unmount of this effect: the removal must still happen when captions change.
      setTimeout(
        () => setHeld((h) => h.filter((x) => x.id !== c.id)),
        CAPTION_HOLD_MS,
      );
    }
  }, [captions]);
  return held;
}

/** How long the Sitting 4 and 5 introduction stays up before the Session is told it finished. */
export const INTRO_HOLD_MS = 4000;

/** Shows the introduction as text, then sends intro-finished once (Sittings 4 and 5). */
function Intro({ text, onFinished }: { text: string; onFinished: () => void }) {
  const done = useRef(onFinished);
  done.current = onFinished;
  useEffect(() => {
    const t = setTimeout(() => done.current(), INTRO_HOLD_MS);
    return () => clearTimeout(t);
  }, []);
  return <p data-testid="intro">{text}</p>;
}

export function SittingScreen(p: {
  number: number;
  title: string;
  inputMode: InputMode;
  cue: keyof typeof CUE_TEXT | null;
  captions: readonly Caption[];
  presenceLine: string;
  /** "Sound unavailable" shown, captions kept (Req 2.11, 5.5). */
  audioUnavailable: boolean;
  replayEnabled: boolean;
  onReplay: () => void;
  onRetryAudio: () => void;
  /** Sittings 4 and 5 only: the introduction line and the intro-finished callback. */
  intro?: { text: string; onFinished: () => void } | undefined;
}) {
  const held = useHeldCaptions(p.captions);
  return (
    <Panel title={`Sitting ${p.number}: ${p.title}`} testId="sitting">
      <p data-testid="input-mode">
        {p.inputMode === "mic"
          ? "Input: microphone"
          : "Input: tap (button or space bar)"}
      </p>
      {p.intro && <Intro text={p.intro.text} onFinished={p.intro.onFinished} />}
      {p.cue && <p data-testid="cue">{CUE_TEXT[p.cue]}</p>}
      <p data-testid="presence-line" aria-live="polite">
        {p.presenceLine}
      </p>
      <div role="status" aria-live="polite" data-testid="captions">
        {held.map((c) => (
          <p key={c.id} className="dai-muted">
            {c.text}
          </p>
        ))}
      </div>
      {p.audioUnavailable && (
        <p role="alert" data-testid="sound-unavailable">
          Sound unavailable. Captions will describe what you would hear.{" "}
          <button type="button" onClick={p.onRetryAudio}>
            Retry sound
          </button>
        </p>
      )}
      <button
        type="button"
        data-testid="replay"
        disabled={!p.replayEnabled}
        onClick={p.onReplay}
      >
        Replay the knocks
      </button>
    </Panel>
  );
}

export function RevealPanel(p: {
  text: string;
  startedMs: Ms;
  /** Audio-clock time, e.g. `() => engine.now()`. */
  now: () => Ms;
  onSkip: () => void;
}) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const t = setInterval(() => redraw((n) => n + 1), 50);
    return () => clearInterval(t);
  }, []);
  const shown = p.text.slice(
    0,
    revealedChars(p.now() - p.startedMs, p.text.length),
  );
  return (
    <Panel title="The answer" testId="reveal">
      <p data-testid="reveal-text">{shown}</p>
      <button type="button" data-testid="skip" onClick={p.onSkip}>
        Skip
      </button>
    </Panel>
  );
}

export function AnswerLog({ entries }: { entries: readonly string[] }) {
  if (entries.length === 0) return null;
  return (
    <section
      aria-label="Answers so far"
      data-testid="answer-log"
      className="dai-panel"
    >
      <ol>
        {entries.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ol>
    </section>
  );
}

export function RefusalScreen({ line }: { line: string }) {
  return (
    <Panel title="Refused" testId="refusal">
      <p role="alert">{line}</p>
    </Panel>
  );
}

/** Rendered only on the `final` screen, which the Session reaches after the Ending is revealed or skipped. */
export function FinalScreen(p: { ending: string; onRestart: () => void }) {
  return (
    <Panel title="The end" testId="final">
      <p data-testid="ending">{p.ending}</p>
      <button type="button" data-testid="restart" onClick={p.onRestart}>
        Start again
      </button>
    </Panel>
  );
}

export function StoryInvalidScreen({
  issues,
}: {
  issues: readonly StoryIssue[];
}) {
  return (
    <Panel title="The story is broken" testId="story-invalid">
      <ul>
        {issues.map((i, n) => (
          <li key={n}>{i.message}</li>
        ))}
      </ul>
    </Panel>
  );
}
