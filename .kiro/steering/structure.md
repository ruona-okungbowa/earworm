# Structure

## Rules

- `@earworm/core` never imports `@earworm/browser`, `@earworm/ui` or React.
- `@earworm/browser` never imports `@earworm/ui` or React.
- Apps and tests import `@earworm/*` by package name.
- App-specific data stays in its app, never in `packages/`. This covers the Morse table, story text and song format.

## Layout

```
earworm/
  packages/core/     events, clock, detectors (onset, pitch, level),
                     match, quantise, segment, classifier,
                     recording, replay source
  packages/browser/  capture, worklet, tap, synth, gate,
                     calibration, canUseMic
  packages/ui/       MicCheck and hooks
  tests/core/
  tests/browser/
  tests/ui/
  tests/helpers/
  tests/e2e/
```
