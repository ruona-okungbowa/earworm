# Implementation Plan: Earworm Kit

## Overview

The kit is built in TypeScript (strict, ESM), in package order: `@earworm/core` first, then `@earworm/browser`, then `@earworm/ui`. Detectors are built in the order Level, Onset, Envelope, Sound, Pitch, Spectrum, Band. Each task is sized to take under an hour. Tests live in the root `tests/` directory (`tests/core`, `tests/browser`, `tests/ui`, `tests/helpers`) and import packages by name (`@earworm/core`, `@earworm/browser`, `@earworm/ui`), never through `../packages`.

All tooling needed by the design is already in the root `devDependencies` of `package.json`: `vitest` 5, `fast-check` 4, `dependency-cruiser` 18, `@vitest/browser-playwright`, `@vitest/coverage-v8`, `@vitejs/plugin-react`, `vite`, `typescript` 6 and `playwright`. No task adds a dependency. If a task finds that a tool is missing, it stops and asks the user before adding anything.

Property tests use the shared helper from task 1.2 (100 runs locally, 200 when CI is detected). Every property test file carries the tag comment `Feature: earworm-kit, Property N: <title>`.

Fixture-driven tests (task 18) depend on the user action in task 17 and are scheduled last, so no other task waits for the recordings.

## Tasks

- [x] 1. Fix tooling and add repository checks
  - [x] 1.1 Point Vitest at the root `tests/` directory and make `npm test` a single run
    - In `vitest.config.mts`, keep the three projects from the design's Tooling subsection: `core` (Node) includes `tests/core/**/*.test.ts` and `tests/helpers/**/*.test.ts`; `browser` (Playwright Chromium) includes `tests/browser/**/*.test.ts`; `ui` (Playwright Chromium, `@vitejs/plugin-react`) includes `tests/ui/**/*.test.{ts,tsx}`
    - Keep coverage on `packages/*/src/**`
    - Add `provide: { pbtRuns }` to each project, where `pbtRuns` is 200 when `process.env.CI` is set to a value other than `""`, `"0"` or `"false"`, and 100 otherwise. This value reaches both Node and browser projects through `inject`
    - In the root `package.json`, change the `test` script from `vitest` to `vitest run`
    - _Requirements: 16.6, 16.7, 16.8_
  - [x] 1.2 Add the fast-check run-count helper
    - Create `tests/helpers/pbt.ts` exporting `runsFor(ci: boolean): number` (100 or 200) and `pbtParams(): { numRuns: number }`, which reads `inject("pbtRuns")` and never returns fewer than 100
    - Declare `pbtRuns: number` on Vitest's `ProvidedContext` in the same file
    - Add `tests/helpers/pbt.test.ts` asserting `runsFor(false) === 100`, `runsFor(true) === 200` and `pbtParams().numRuns >= 100`
    - _Requirements: 16.7, 16.8_
  - [x] 1.3 Add boundary checks for dependency-cruiser
    - Add a `tests-use-package-names` rule to `.dependency-cruiser.js` that forbids imports from `^tests/` into `^packages/` (same shape as `apps-use-package-names`)
    - Create a self-contained violating tree under `tests/helpers/boundary-fixture/` that mirrors the `packages/` layout (`packages/core/src/bad.ts` imports the stub `packages/browser`, `packages/browser/src/bad.ts` imports `react`) with its own `tsconfig.json`
    - Write `tests/core/packaging/boundaries.test.ts`: run `npm run lint:deps` on the repo and expect exit 0; run `depcruise` with the repo rule file and the working directory at the fixture root, and expect a non-zero exit with output naming each offending file and import
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.6_
  - [x] 1.4 Add the privacy and purity scan test
    - Write `tests/core/packaging/scan.test.ts` that reads every source file under `packages/`
    - Fail if any file under `packages/` matches a privacy pattern, using word boundaries: `\bMediaRecorder\b`, `\bfetch\b`, `\bXMLHttpRequest\b`, `\bWebSocket\b`, `\bsendBeacon\b`, `\blocalStorage\b`, `\bindexedDB\b`
    - Fail if any file under `packages/core/` matches `\bDate\.now\b`, `\bperformance\.now\b` or `\.currentTime\b`, or a browser global: `\bwindow\.`, `\bdocument\.`, `globalThis\.window`, `globalThis\.document`. Bare "window" is allowed, because Core legitimately uses it for window functions (hann, Window_Function, pitch window, attack window)
    - The scan reports file and line for every match. Comments are scanned too, so prose in `packages/` must avoid the banned words
    - Put the patterns in an exported constant list and add a unit test of them in the same file or in a sibling file in `tests/core/packaging/`: `window.addEventListener` and `fetch(url)` fail; `windowFunction`, `hannWindow`, `const window = hann(n)`, `pitchWindow`, `prefetchHint` and `fetchedCount` pass
    - Fail if any file under `packages/` contains app-specific markers (a Morse table, story text, a song format), using a short word list (`morse`, `seance`, `séance`, `ditdah`, `loophole`)
    - _Requirements: 1.6, 14.14, 16.1, 16.9, 16.14_
  - [x] 1.5 Type-check the tests
    - `@types/node` is already a root devDependency, so nothing is installed
    - Create `tests/tsconfig.json` that extends `../tsconfig.json`, sets `"types": ["node"]`, includes `**/*.ts` and `**/*.tsx` under `tests/` and excludes `helpers/boundary-fixture`
    - Change the root `package.json` `typecheck` script to `npm run typecheck --workspaces --if-present && tsc -p tests/tsconfig.json --noEmit`
    - The Vitest `inject` and `ProvidedContext` augmentation in `tests/helpers/pbt.ts` must compile under it
    - Tests import packages by name, so workspace resolution must work. Check each package's `package.json` `exports` and `main`; if one points at a build output rather than `src`, stop and ask the user
    - _Requirements: 16.6_

- [ ] 2. Core types, emitter and clock
  - [ ] 2.1 Define the shared types and the Result helpers
    - Create `packages/core/src/types.ts` (`Ms`, `KitError`, `KitErrorCode` union with every code from the design's Data Models, including `invalid-gain`, `Result<T>`, `ok()`, `err()`), `packages/core/src/events.ts` (all Event interfaces including `CustomEvent` with `x-${string}` type, `EarwormEvent`, `EventSourceName`, `EventSource`, `Unsubscribe`, `Frame`, `Detector`, `Band`, `Recording`)
    - Export everything from `packages/core/src/index.ts`
    - _Requirements: 1.1, 1.10, 1.11, 16.13_
  - [ ] 2.2 Implement `createEmitter`
    - Create `packages/core/src/emitter.ts`: synchronous delivery in emit order, snapshot of listeners with a per-listener `active` flag re-checked before each delivery, idempotent unsubscribe
    - Catch listener errors and pass them to `onError`; the default calls `console.error` through the narrowed `globalThis` lookup in the design; an `onError` that throws is ignored
    - Export from the core index
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 16.13_
  - [ ] 2.3 Write property test for the emitter delivery model
    - **Property 3: Event source delivery model**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
    - File `tests/core/emitter/p03-delivery.test.ts`; generate operation sequences including repeated and during-dispatch unsubscribes and throwing subscribers
  - [ ] 2.4 Implement the clock conversions
    - Create `packages/core/src/clock.ts` with `secondsToMs` and `msToSeconds` returning `Result`, `invalid-number` for NaN and infinities
    - Export from the core index
    - _Requirements: 1.7, 1.8_
  - [ ] 2.5 Write property test for time conversion round trip
    - **Property 1: Time conversion round trip**
    - **Validates: Requirements 1.7, 1.9**
    - File `tests/core/clock/p01-round-trip.test.ts`
  - [ ] 2.6 Write property test for non-finite conversion input
    - **Property 2: Non-finite conversion input is rejected**
    - **Validates: Requirements 1.8**
    - File `tests/core/clock/p02-non-finite.test.ts`

- [ ] 3. Framing, configuration and shared Detector helpers
  - [ ] 3.1 Implement the Framing_Function
    - Create `packages/core/src/framing.ts` with `frames(samples, startMs, sampleRate, frameSize)`, `createFramer(frameSize, sampleRate)` whose `push(quantum, currentFrame)` returns completed Frames with the same arithmetic, and `frameIntervalMs(frameSize, sampleRate)`
    - Frame sizes 128 (default) and 512 are supported; every Frame carries `sampleRate`
    - Add a `./framing` subpath to `exports` in `packages/core/package.json` so the Worklet can import framing code only, and export from the core index
    - _Requirements: 2.2, 14.13_
  - [ ] 3.2 Write property test for framing
    - **Property 41: Framing preserves samples and time**
    - **Validates: Requirements 14.13, 2.2**
    - File `tests/core/framing/p41-framing.test.ts`; include the `createFramer` equivalence for 128 and 512
  - [ ] 3.3 Implement defaults and config validation
    - Create `packages/core/src/config.ts` with `DEFAULTS` (Default_Table, the ranges from Requirements 5, 17, 18, 19 and 20, and the default Noise_Floor of −60 dBFS) and `resolveConfig(spec, partial)` returning `invalid-config` with `setting` for out-of-range or non-finite values
    - Export from the core index
    - _Requirements: 6.12, 16.16, 16.17_
  - [ ]\* 3.4 Write example tests for `resolveConfig`
    - File `tests/core/config/defaults.test.ts`; one omitted value and one out-of-range value per Default_Table row
    - _Requirements: 16.16, 16.17_
  - [ ] 3.5 Implement the shared Detector helpers
    - Create `packages/core/src/detector-utils.ts` with `frameLevelDb(samples)` (`max(-120, 20·log10(rms))`, exactly −120 for all zeros), a Frame guard that rejects empty Frames, non-finite samples and Timestamps earlier than the previous valid Frame, and `createRateGate(maxPerSecond)`
    - Export `frameLevelDb` from the core index
    - _Requirements: 5.1, 5.5, 5.6, 5.2_
  - [ ] 3.6 Create the signal and Frame generators
    - Create `tests/helpers/generators.ts` with a seeded PRNG, `tone`, `harmonicTone`, `whiteNoise(seed)`, `clickTrain`, `burstTrain`, the energy-check generator (1 to 8 bin-centre sines from bin 0 to `0.9 × size/2`, level at or above −50 dBFS, samples in [−1, 1]) and a fast-check `frameSequence` arbitrary with an option to inject the three kinds of invalid Frame
    - Generators take every time as a parameter and read no clock
    - _Requirements: 3.9, 18.17, 19.11, 20.6_
  - [ ]\* 3.7 Write example tests for the shared helpers
    - File `tests/core/detectors/utils.test.ts`; `frameLevelDb` on zeros, a full-scale square wave and a tiny signal; rate gate spacing at 30 per second
    - _Requirements: 5.1, 5.5, 5.6_
  - [ ] 3.8 Implement the shared Sample_History ring buffer
    - Create `packages/core/src/sample-history.ts` with `createSampleHistory(capacity)`: one preallocated `Float32Array(capacity)`, a write index and a count
    - `push(samples)` copies at most the last `capacity` samples of the Frame and overwrites the oldest entries in the same call, so the count never exceeds `capacity`, including for a Frame longer than the capacity
    - `snapshot(out)` writes the held samples oldest first into a reusable analysis buffer and zero-fills the rest; `clear()` sets the count to 0; `length` reads the count
    - Internal module used by the Pitch (capacity 2048), Spectrum and Band (capacity FFT_Size) Detectors; not exported from the core index, so the export list of Req 16.15 is unchanged. Its bound is tested through each Detector's `historyLength` (tasks 8.9, 9.7, 10.8)
    - _Requirements: 4.11, 4.14, 19.19, 19.21_

- [ ] 4. Level_Detector
  - [ ] 4.1 Implement `createLevelDetector`
    - Create `packages/core/src/detectors/level.ts`; factory returns `Result<Detector>`, default 30 Level_Events per second, range 1 to 100, `configure(partial)` leaves previous values on error, Frame guard from task 3.5
    - Export from the core index
    - _Requirements: 1.10, 1.12, 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 5.8, 16.17_
  - [ ] 4.2 Write property test for the level formula and bounds
    - **Property 16: Level formula and bounds**
    - **Validates: Requirements 5.1, 5.4, 5.5, 5.6, 5.7**
    - File `tests/core/detectors/level/p16-level.test.ts`

- [ ] 5. Onset_Detector
  - [ ] 5.1 Implement `createOnsetDetector`
    - Create `packages/core/src/detectors/onset.ts` with the armed, attack-window deque and refractory state machine from the design, `strength = min(1, (level − noiseFloor) / (threshold + 40))`, `setNoiseFloor(db)` and the Default_Table settings
    - Type `lastOnsetTs` as `Ms | null`. Construction and `reset()` set `armed = true`, `lastOnsetTs = null` and clear the deque; the refractory check is skipped while `lastOnsetTs === null`, so no suppression applies before the first Onset_Event. Use no sentinel such as `0` or `−Infinity`, so negative Frame Timestamps behave the same
    - Export from the core index
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.8, 3.11, 6.2, 6.12_
  - [ ] 5.2 Write property test for refractory spacing and strength
    - **Property 9: Onset refractory spacing and strength**
    - **Validates: Requirements 3.2, 3.4, 3.6**
    - File `tests/core/detectors/onset/p09-refractory-strength.test.ts`
  - [ ] 5.3 Write property test for no Onset at or below the threshold
    - **Property 10: No Onset at or below the threshold**
    - **Validates: Requirements 3.3**
    - File `tests/core/detectors/onset/p10-below-threshold.test.ts`
  - [ ] 5.4 Write property test for click trains
    - **Property 11: Click trains yield one Onset per click**
    - **Validates: Requirements 3.1, 3.9**
    - File `tests/core/detectors/onset/p11-click-trains.test.ts`; frame with the core `frames` function at 128 to 512 samples
  - [ ] 5.5 Write property test for no refractory suppression before the first Onset
    - **Property 57: No refractory suppression before the first Onset**
    - **Validates: Requirements 3.11**
    - File `tests/core/detectors/onset/p57-first-onset.test.ts`; compare the first Onset_Event with that of a refractory-0 Detector on the same sequence, from fresh and after `reset()`, including a pre-reset Onset within the refractory period of the first post-reset Frame, and negative Frame Timestamps

- [ ] 6. Envelope_Detector
  - [ ] 6.1 Implement `createEnvelopeDetector`
    - Create `packages/core/src/detectors/envelope.ts` with the recurrence from the design (first Frame Δt is its own duration, `τ = 0` jumps), attack 10 ms and release 300 ms defaults, range 0 to 10,000 ms, rate gate, start and reset at −120
    - Export from the core index
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9_
  - [ ] 6.2 Write property test for the envelope recurrence
    - **Property 45: Envelope matches the recurrence**
    - **Validates: Requirements 17.1, 17.2, 17.4, 17.7, 17.9**
    - File `tests/core/detectors/envelope/p45-recurrence.test.ts`
  - [ ] 6.3 Write property test for convergence and asymmetry
    - **Property 46: Envelope convergence and asymmetry**
    - **Validates: Requirements 17.10, 17.11**
    - File `tests/core/detectors/envelope/p46-convergence.test.ts`

- [ ] 7. Sound_Detector
  - [ ] 7.1 Implement `createSoundDetector`
    - Create `packages/core/src/detectors/sound.ts` with the `idle`, `pending`, `open` state machine, start threshold 12 dB (3 to 60), end threshold 6 dB (1 to 59, below the start threshold), Min_Hold 30 ms (0 to 200), Hangover 100 ms (0 to 2,000), `flush()`, `reset()` and `setNoiseFloor(db)`
    - Export from the core index
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10, 18.12, 18.13, 18.14, 18.15_
  - [ ] 7.2 Write property test for the Sound state machine
    - **Property 47: Sound Detector matches the state machine model**
    - **Validates: Requirements 18.1, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10, 18.12**
    - Reference model in `tests/helpers/sound-model.ts`; test in `tests/core/detectors/sound/p47-state-machine.test.ts`
  - [ ] 7.3 Write property test for burst location
    - **Property 48: Sound bursts are located**
    - **Validates: Requirements 18.17**
    - File `tests/core/detectors/sound/p48-bursts.test.ts`; 44.1 and 48 kHz, Frames of 128 to 512 samples

- [ ] 8. FFT and Pitch_Detector
  - [ ] 8.1 Implement the FFT and window coefficients
    - Create `packages/core/src/fft.ts` with in-place radix-2 `fft(re, im)` for sizes 256 to 8192 and `windowCoefficients(name, size)` for hann, hamming, blackman and rectangular
    - Export from the core index
    - _Requirements: 19.6_
  - [ ]\* 8.2 Write example tests comparing the FFT with a naive DFT
    - File `tests/core/fft/fft.test.ts`; random inputs at sizes 256 and 1024, and window sums
    - _Requirements: 19.6_
  - [ ] 8.3 Implement `createPitchDetector`
    - Create `packages/core/src/detectors/pitch.ts`: 2048-sample Sample_History built on `createSampleHistory(2048)` from task 3.8, zero-padded until full, with a read-only `historyLength: number` property on the Detector object (not a package export); every valid Frame is pushed before the level gate, an invalid Frame is rejected before `push`; level gate at the Noise_Floor, YIN difference function by FFT autocorrelation over lags `sampleRate/2000` to `sampleRate/80`, first dip below the absolute threshold, parabolic interpolation, `confidence = clamp(1 − d', 0, 1)`, MIDI and cents, `reset()` clears history, `flush()` returns `[]`, `setNoiseFloor(db)`
    - Export from the core index
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14, 6.2_
  - [ ] 8.4 Write property test for well-formed Pitch_Events
    - **Property 12: Pitch Events are well formed and confident**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.7**
    - File `tests/core/detectors/pitch/p12-well-formed.test.ts`
  - [ ] 8.5 Write property test for sine pitch accuracy
    - **Property 13: Sine pitch accuracy**
    - **Validates: Requirements 4.5**
    - File `tests/core/detectors/pitch/p13-sine-accuracy.test.ts`
  - [ ] 8.6 Write property test for harmonic tones
    - **Property 14: Harmonic tones report the fundamental**
    - **Validates: Requirements 4.9**
    - File `tests/core/detectors/pitch/p14-harmonics.test.ts`
  - [ ] 8.7 Write property test for silence and noise
    - **Property 15: Silence and noise produce no Pitch**
    - **Validates: Requirements 4.6, 4.10**
    - File `tests/core/detectors/pitch/p15-silence-noise.test.ts`
  - [ ] 8.8 Write the Pitch_Detector performance test
    - File `tests/core/perf/pitch.perf.test.ts`, a plain test in Node in the style of Req 19.18: a Pitch_Detector at 48 kHz with a full 2048-sample Sample_History, 128-sample Frames of a harmonic tone above the Noise_Floor, 20 warm-up `process` calls, 200 timed calls, assert a median under 1 ms per Frame
    - This check comes from the design, not from a requirement. Perf tests are the only tests that read a real clock (`performance.now`)
    - If the test fails, the fallback is a Worklet frame size of 512, which the Framing_Function (task 3.1) already supports. Then set the Capture_Pipeline default `frameSize` to 512 in task 23.3 and frame fixtures at 512 in task 18.2 (Req 14.13), and record the decision in the design's Assumption 25
    - _Requirements: 2.3, 14.13_
  - [ ] 8.9 Write property test for the Pitch_Detector history bound
    - **Property 58: Sample_History stays within its capacity**
    - **Validates: Requirements 4.14**
    - File `tests/core/detectors/pitch/p58-history-bound.test.ts`; Frames of any length (including longer than 2048) with invalid Frames and `reset()` calls interleaved; after every call `historyLength` is at most 2048 and equals `min(2048, valid samples since construction or the last reset)`

- [ ] 9. Spectrum
  - [ ] 9.1 Implement `spectrum`
    - Create `packages/core/src/spectrum.ts`: validation order size, sample rate, window, samples; zero-pad short buffers, use the last `size` samples of long ones; bin 0 scaled by `1/Σw`, other bins by `2/Σw`; dBFS floored at −120 and capped at +6; input never modified
    - Export from the core index
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 19.12, 19.13_
  - [ ] 9.2 Write property test for spectrum shape, bounds and determinism
    - **Property 49: Spectrum shape, bounds and determinism**
    - **Validates: Requirements 19.1, 19.8, 19.9, 19.12, 19.13**
    - File `tests/core/spectrum/p49-shape.test.ts`
  - [ ] 9.3 Write property test for spectrum input rejection
    - **Property 50: Spectrum rejects invalid input**
    - **Validates: Requirements 19.2, 19.3, 19.4, 19.5**
    - File `tests/core/spectrum/p50-invalid.test.ts`
  - [ ] 9.4 Write property test for spectrum scale, peak and energy
    - **Property 51: Spectrum scale, peak and energy**
    - **Validates: Requirements 19.6, 19.7, 19.10, 19.11**
    - File `tests/core/spectrum/p51-scale-energy.test.ts`; use the energy-check generator from task 3.6
  - [ ] 9.5 Implement `createSpectrumDetector`
    - Create `packages/core/src/detectors/spectrum.ts` with an FFT_Size Sample_History built on `createSampleHistory(fftSize)` from task 3.8, zero-padded until full, a read-only `historyLength` property, the rate gate, Kit_Errors from Req 19.2 to 19.4 or `invalid-config` for the rate, `reset()` clears history, `flush()` returns `[]`
    - Export from the core index
    - _Requirements: 19.14, 19.15, 19.16, 19.17, 19.19, 19.20, 19.21_
  - [ ] 9.6 Write the spectrum performance test
    - File `tests/core/perf/spectrum.perf.test.ts`: one 2048-sample Frame, FFT_Size 2048, hann, 20 warm-up calls, assert a median of at most 5 ms over 200 calls in Node
    - Time only valid calls: 2048 finite samples, FFT_Size 2048, hann and a sample rate of 48,000 Hz. Before timing, assert that one call returns `ok: true`, so a validation error cannot pass as a fast call
    - _Requirements: 19.18, 19.22_
  - [ ] 9.7 Write property test for the Spectrum_Detector history bound
    - **Property 58: Sample_History stays within its capacity**
    - **Validates: Requirements 19.21**
    - File `tests/core/detectors/spectrum/p58-history-bound.test.ts`; FFT_Size from 256 to 8192, Frames of any length (including longer than FFT_Size) with invalid Frames and `reset()` calls interleaved; after every call `historyLength` is at most FFT_Size and equals `min(FFT_Size, valid samples since construction or the last reset)`

- [ ] 10. Bands and Band_Detector
  - [ ] 10.1 Implement `bands` and `BAND_PRESET`
    - Create `packages/core/src/bands.ts` with the validation from the design (1 to 32 unique Bands, bounds, name, unit, window, spectrum length `size/2`, size and sample rate), bin assignment `lowHz ≤ k·sampleRate/size < highHz`, Parseval bin power from the dBFS magnitudes and window mean, level `10·log10(ΣP / mean(w²))` floored at −120, `normalised = (dBFS + 120) / 120`
    - `BAND_PRESET` as plain data (low, mid, high); a sample rate below 16,000 Hz gives `invalid-band` naming `high`
    - Export from the core index
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10, 20.11, 20.21_
  - [ ] 10.2 Write property test for Band validation
    - **Property 52: Band validation**
    - **Validates: Requirements 20.2, 20.3, 20.4, 20.8, 20.9, 20.11, 20.21**
    - File `tests/core/bands/p52-validation.test.ts`
  - [ ] 10.3 Write property test for Band levels
    - **Property 53: Band levels**
    - **Validates: Requirements 20.5, 20.6, 20.7, 20.16**
    - File `tests/core/bands/p53-levels.test.ts`; use the energy-check generator for the 1e-3 check
  - [ ] 10.4 Write property test for Band selectivity and nesting
    - **Property 54: Band selectivity and nesting**
    - **Validates: Requirements 20.17, 20.18**
    - File `tests/core/bands/p54-selectivity.test.ts`
  - [ ] 10.5 Write the white-noise Band test
    - **Property 55: White noise spreads evenly across Bands**
    - **Validates: Requirements 20.19**
    - File `tests/core/bands/p55-white-noise.test.ts`; at least 65,536 seeded samples in Frames of 1024, hann
  - [ ] 10.6 Implement `createBandDetector`
    - Create `packages/core/src/detectors/band.ts` with an FFT_Size Sample_History built on `createSampleHistory(fftSize)` from task 3.8, a read-only `historyLength` property, the Spectrum of that history passed with the configured window to `bands`, unit, the rate gate, constructor Kit_Errors from Req 19.2 to 19.4 and 20.2, 20.3, 20.8, 20.21, `reset()` clears history, `flush()` returns `[]`
    - Export from the core index
    - _Requirements: 19.21, 20.12, 20.13, 20.14, 20.15, 20.16, 20.22_
  - [ ] 10.7 Write the Band_Detector performance test
    - File `tests/core/perf/band.perf.test.ts`: one 2048-sample Frame, FFT_Size 2048, hann, `BAND_PRESET`, 20 warm-up `process` calls, assert a median of at most 6 ms over 200 calls in Node
    - Time only valid calls: a Band_Detector built with FFT_Size 2048, hann, `BAND_PRESET` and a sample rate of 48,000 Hz (at least 16,000 Hz, Req 20.11), fed 2048-sample Frames of finite numbers. Before timing, assert that the factory returns `ok: true` and that one `process` call returns a Band_Event, so a validation error cannot pass as a fast call
    - _Requirements: 20.20, 20.23_
  - [ ] 10.8 Write property test for the Band_Detector history bound
    - **Property 58: Sample_History stays within its capacity**
    - **Validates: Requirements 19.21**
    - File `tests/core/detectors/band/p58-history-bound.test.ts`; same generator shape as task 9.7, checking the Band_Detector's `historyLength` against FFT_Size

- [ ] 11. Cross-Detector properties
  - [ ] 11.1 Write property test for determinism and reset equivalence
    - **Property 5: Detector determinism and reset equivalence**
    - **Validates: Requirements 3.5, 17.12, 18.16, 19.17, 20.15**
    - File `tests/core/detectors/p05-determinism.test.ts`; all seven Detectors
  - [ ] 11.2 Write property test for invalid Frames
    - **Property 6: Invalid Frames are ignored**
    - **Validates: Requirements 3.8, 4.13, 5.8, 17.8, 18.14, 19.16, 20.14**
    - File `tests/core/detectors/p06-invalid-frames.test.ts`; use the invalid-Frame injection of `frameSequence`
  - [ ] 11.3 Write property test for rate limits
    - **Property 7: Rate limits hold**
    - **Validates: Requirements 5.2, 17.5, 19.15, 20.13**
    - File `tests/core/detectors/p07-rate-limits.test.ts`; Level, Envelope, Spectrum and Band
  - [ ] 11.4 Write property test for Frame Timestamps
    - **Property 8: Detector Events are stamped with the Frame Timestamp**
    - **Validates: Requirements 1.12, 5.3, 17.6, 18.3, 18.4, 18.10**
    - File `tests/core/detectors/p08-frame-timestamps.test.ts`
  - [ ] 11.5 Write property test for Sample_History semantics
    - **Property 31: Sample history semantics**
    - **Validates: Requirements 4.11, 4.12, 19.19, 19.20, 20.22**
    - File `tests/core/detectors/p31-sample-history.test.ts`; compare Spectrum and Band output with `spectrum` and `bands` of the reference history; for Pitch, compare with a fresh Detector fed the same history as one Frame where the level gate allows
  - [ ] 11.6 Write property test for configuration validation
    - **Property 44: Configuration validation**
    - **Validates: Requirements 16.16, 16.17, 17.2, 17.3, 18.2, 19.14, 20.12**
    - File `tests/core/config/p44-config-validation.test.ts`; cover `resolveConfig`, every factory and every `configure`

- [ ] 12. Checkpoint: Detectors
  - Run `npm test`, `npm run typecheck` and `npm run lint:deps`. Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Quantise and match
  - [ ] 13.1 Implement `quantise`
    - Create `packages/core/src/quantise.ts`: `step = 60000 / (bpm × subdivision)`, `index = ceil(x − 0.5)`, `invalid-grid` for a bad tempo or a non-positive or non-integer subdivision, `invalid-timestamp` for a non-finite Timestamp
    - Export from the core index
    - _Requirements: 11.1, 11.2, 11.3, 11.7, 11.8_
  - [ ] 13.2 Write property test for the nearest-position model
    - **Property 28: Quantise nearest-position model**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.5**
    - File `tests/core/quantise/p28-nearest.test.ts`
  - [ ] 13.3 Write property test for idempotence and monotonicity
    - **Property 29: Quantise idempotence and monotonicity**
    - **Validates: Requirements 11.4, 11.6**
    - File `tests/core/quantise/p29-idempotence.test.ts`
  - [ ] 13.4 Write property test for invalid quantise input
    - **Property 30: Quantise rejects invalid input**
    - **Validates: Requirements 11.7, 11.8**
    - File `tests/core/quantise/p30-invalid.test.ts`
  - [ ] 13.5 Implement `match`
    - Create `packages/core/src/match.ts`: normalisation, the equal-count score, the order-preserving dynamic-programming alignment pairing exactly `min(n, m)` hits, `missed`, `extra`, `largestError`, `tempoRatio`, and the degenerate cases of Req 10.6 to 10.8; never throws and never mutates its input
    - Type `largestError` as `{ ms: number; index: number } | null` and apply the design's rules in order: (1) the target has no hits gives `null`, the only `null` case; (2) either Pattern has fewer than 2 hits, holds a non-finite or decreasing time, or has a total duration of 0 ms gives `{ ms: 0, index: 0 }`; (3) otherwise `index` is the target index of the matched pair with the largest `e_i`, ties going to the lowest target index, so it always lies from 0 to `target.length − 1`
    - Export `match` and an interval-to-Pattern helper from the core index
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14_
  - [ ] 13.6 Write property test for score range and invariances
    - **Property 25: Match score range, identity, shift and scale invariance**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.10**
    - File `tests/core/match/p25-invariance.test.ts`
  - [ ] 13.7 Write property test for missing and extra hits
    - **Property 26: Match penalises missing and extra hits**
    - **Validates: Requirements 10.5, 10.10**
    - File `tests/core/match/p26-missing-extra.test.ts`; only insertions or only deletions per reply
  - [ ] 13.8 Write property test for degenerate inputs and purity
    - **Property 27: Match degenerate inputs and purity**
    - **Validates: Requirements 10.6, 10.7, 10.8, 10.9**
    - File `tests/core/match/p27-degenerate.test.ts`
  - [ ] 13.9 Write property test for the largest-error index
    - **Property 61: Largest-error index refers to a target hit**
    - **Validates: Requirements 10.11, 10.12, 10.13, 10.14**
    - File `tests/core/match/p61-largest-error.test.ts`; generate empty, single-hit, zero-duration, invalid and unequal-length Patterns as well as valid ones

- [ ] 14. Segment and classify
  - [ ] 14.1 Implement `segment` for Pitch_Event input
    - Create `packages/core/src/segment.ts` with the `pitch` branch: required positive finite `frameInterval` (`invalid-config` naming `frameInterval`), ascending order check (`invalid-ordering`), split on gap, on pitch change when enabled and on `gatedSpans`, discard unsteady runs, then apply the minimum duration
    - Export `segment` and its types from the core index
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.12, 12.13_
  - [ ] 14.2 Write property test for pitch segmentation
    - **Property 32: Pitch segmentation matches the reference**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.10**
    - Naive reference in `tests/helpers/segment-model.ts`; test in `tests/core/segment/p32-pitch.test.ts`
  - [ ] 14.3 Write property test for gated spans and errors
    - **Property 33: Segmentation of gated spans and ordering errors**
    - **Validates: Requirements 12.9, 12.12, 12.13**
    - File `tests/core/segment/p33-gated-errors.test.ts`
  - [ ] 14.4 Add the sound and tap branches to `segment`
    - In `packages/core/src/segment.ts`, pair `sound-start` with the next `sound-end` (Mark from `startTime` and `duration`), pair tap Onsets with the next Release, drop orphans, apply the minimum duration, and return `invalid-ordering` for out-of-order Events or an `endTime` before its `startTime`
    - _Requirements: 12.11, 18.20, 18.21, 18.22, 18.23, 18.24_
  - [ ] 14.5 Write property test for sound and tap pairs
    - **Property 34: Sound and tap pairs become Marks**
    - **Validates: Requirements 12.11, 18.20, 18.21, 18.22, 18.23, 18.24**
    - File `tests/core/segment/p34-pairs.test.ts`
  - [ ] 14.6 Implement `classify`
    - Create `packages/core/src/classify.ts`: candidate units `d_i / r_c`, log-nearest class assignment with the geometric midpoint going to the lower class, minimum summed squared log error with the deterministic tie-break, Deviations, the `priorUnit` fallback, the single-cluster median rule, `invalid-duration` and `invalid-ratios`
    - In the `priorUnit` fallback, use and return the prior unit exactly as supplied (`Object.is` equal to `opts.priorUnit`): no refit, rounding or rescaling from the observed durations, and Deviations computed with that same value. A prior that is not a positive finite number is ignored, as if none was given
    - Export from the core index
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10_
  - [ ] 14.7 Write property test for classifier invariances
    - **Property 35: Duration classifier invariances**
    - **Validates: Requirements 13.3, 13.4**
    - File `tests/core/classify/p35-invariances.test.ts`
  - [ ] 14.8 Write property test for classifier correctness
    - **Property 36: Duration classifier correctness**
    - **Validates: Requirements 13.1, 13.2, 13.5**
    - File `tests/core/classify/p36-correctness.test.ts`; the generator always places at least one duration in class 0 and one in another class
  - [ ] 14.9 Write property test for classifier input rejection
    - **Property 37: Duration classifier rejects invalid input**
    - **Validates: Requirements 13.7, 13.8**
    - File `tests/core/classify/p37-invalid.test.ts`
  - [ ] 14.10 Write property test for the prior unit fallback
    - **Property 56: Prior unit fallback**
    - **Validates: Requirements 13.6, 13.9, 13.10**
    - File `tests/core/classify/p56-prior-unit.test.ts`; assert `Object.is(result.unit, priorUnit)` and Deviations equal to `d / (priorUnit × ratio[class])`, with prior units that are not round numbers

- [ ] 15. Latency shift, Recording and replay
  - [ ] 15.1 Implement `shiftEvent` and `flushDetectors`
    - Create `packages/core/src/shift.ts`: `shiftEvent(e, deltaMs)` adds to `timestamp` and to `startTime` or `endTime` where present, leaves `duration`, `data` and all other fields unchanged; `flushDetectors(detectors)` collects `flush()` output in order
    - Export from the core index
    - _Requirements: 6.4, 18.11, 21.3_
  - [ ] 15.2 Write property test for latency correction
    - **Property 19: Latency correction**
    - **Validates: Requirements 6.4, 21.3**
    - File `tests/core/shift/p19-latency.test.ts`
  - [ ] 15.3 Create Event arbitraries
    - Create `tests/helpers/events.ts` with fast-check arbitraries for every Event type, including Custom_Events and Spectrum_Events with `Float32Array` magnitudes of `fftSize/2`, valid Sound `startTime` and `endTime`, and finite numbers with no `-0`
    - _Requirements: 14.7, 21.7_
  - [ ] 15.4 Implement `serialiseRecording` and `parseRecording`
    - Create `packages/core/src/recording.ts`: fixed key order per Event type, `Float32Array` to plain array, `-0` written as `0`; parser returns `malformed-json`, `unsupported-version` naming the version, or `invalid-recording` naming the field, validates the Spectrum, Sound and Band rules, and restores `Float32Array` magnitudes with canonical key order
    - Export from the core index
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.14, 21.4, 21.5, 21.6_
  - [ ] 15.5 Write property test for the Recording round trip
    - **Property 38: Recording round trip**
    - **Validates: Requirements 14.2, 14.3, 14.7, 14.8, 21.4, 21.5, 21.7, 21.8**
    - File `tests/core/recording/p38-round-trip.test.ts`
  - [ ] 15.6 Write property test for parser rejection
    - **Property 39: Recording parser rejects invalid input**
    - **Validates: Requirements 14.4, 14.5, 14.6, 21.6**
    - File `tests/core/recording/p39-invalid.test.ts`
  - [ ] 15.7 Implement `createReplaySource`
    - Create `packages/core/src/replay.ts` on top of `createEmitter`: stable sort once at construction, `advance(nowMs)` emits each not-yet-emitted Event with `timestamp ≤ now` once in ascending order, an earlier `now` does nothing, Events keep their recorded source
    - Export from the core index
    - _Requirements: 14.9, 14.10, 14.11, 14.12, 14.15, 21.2, 21.9_
  - [ ] 15.8 Write property test for replay
    - **Property 40: Replay emits each Event once in order**
    - **Validates: Requirements 14.10, 14.11, 14.15, 21.2, 21.9**
    - File `tests/core/replay/p40-replay.test.ts`

- [ ] 16. Checkpoint: end of `@earworm/core`
  - Run `npm test` (includes the privacy and purity scan of task 1.4 and the boundary test of task 1.3), `npm run typecheck` and `npm run lint:deps`. Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Prerequisite (user action): User records fixtures/recorded (WAV + manifest.json)
  - The user, not the coding agent, records the WAV files into `fixtures/recorded/` and writes `fixtures/recorded/manifest.json` in the shape given in the design's Data Models (knocks, claps, quiet room, fan, door, hums, whistles, sustained sounds, and entries with envelope, band and spectrum expectations). No magnitudes are stored
  - Every task in group 18 except 18.1 depends on this. Until it is done, those tests fail by design (Req 16.12)
  - _Requirements: 16.10, 16.12, 21.12_

- [ ] 18. Recorded fixture tests (depend on task 17; scheduled last so nothing else waits on them)
  - [ ] 18.1 Implement the WAV reader
    - Create `tests/helpers/wav.ts` that reads 16-bit, 24-bit and 32-bit float PCM, mixes to mono and returns `{ samples: Float32Array, sampleRate }`
    - Add `tests/helpers/wav.test.ts` using a WAV built in memory, so this sub-task does not need the recordings
    - _Requirements: 16.10_
  - [ ] 18.2 Implement the fixture runner and the no-fixture failure
    - Depends on task 17
    - Create `tests/helpers/fixtures.ts`: load `fixtures/recorded/manifest.json`, read each WAV with `wav.ts`, frame it with the core `frames` function at 128 samples (512 if task 8.8 chose the fallback), run the Detectors, call `flushDetectors`, and match Events with per-type tolerances, reporting the fixture name and the first differing Event
    - Write `tests/core/fixtures/manifest.test.ts`: fail with a "no fixtures found" error when the directory has no WAV or the manifest lists no fixture
    - _Requirements: 14.13, 16.10, 16.11, 16.12_
  - [ ] 18.3 Write the onset fixture tests
    - Depends on task 17
    - File `tests/core/fixtures/onset.test.ts`: one case per knock and clap fixture, matching within 12 ms with no unmatched or extra Event; no Onset for quiet-room and fan, at most one for door
    - _Requirements: 3.7, 3.10, 16.11_
  - [ ] 18.4 Write the pitch fixture tests
    - Depends on task 17
    - File `tests/core/fixtures/pitch.test.ts`: one case per hum and whistle fixture against its expected Pitch_Events
    - _Requirements: 4.8, 16.11_
  - [ ] 18.5 Write the sound fixture tests
    - Depends on task 17
    - File `tests/core/fixtures/sound.test.ts`: starts within 15 ms by `startTime`, ends within 30 ms by `endTime`, no unmatched or extra Event; no Event for quiet-room and fan
    - _Requirements: 18.18, 18.19, 16.11_
  - [ ] 18.6 Write the envelope, band and spectrum fixture tests
    - Depends on task 17
    - File `tests/core/fixtures/envelope-band-spectrum.test.ts`: envelope level within 1.0 dB, band level within 1.5 dB, highest spectrum bin within one bin of the expected bin
    - _Requirements: 21.11, 21.12, 16.11_

- [ ] 19. Audio engine and `canUseMic`
  - [ ] 19.1 Implement `createAudioEngine`
    - Create `packages/browser/src/engine.ts`: one shared `BaseAudioContext` (created lazily when none is passed) and `now()` returning `context.currentTime × 1000`; no browser global is touched at import time
    - Export from `packages/browser/src/index.ts`
    - _Requirements: 7.13_
  - [ ] 19.2 Implement `canUseMic`
    - Create `packages/browser/src/can-use-mic.ts` with an optional injected environment; true only when `getUserMedia`, `AudioContext`, `AudioWorklet` and a secure context are all present
    - Export from the browser index
    - _Requirements: 15.1_
  - [ ] 19.3 Write property test for the `canUseMic` truth table
    - **Property 42: canUseMic truth table**
    - **Validates: Requirements 15.1**
    - File `tests/browser/can-use-mic/p42-truth-table.test.ts`

- [ ] 20. Gate
  - [ ] 20.1 Implement `createGate`
    - Create `packages/browser/src/gate.ts`: windows stored with ids as closed intervals `[start, end + tail (+ outputLatency when hasCalibration() is false)]`, `addWindow` returning `invalid-gate-window` for bad input, `cancelWindow`, `setMode`, `shouldPass` reading only source, Timestamp, windows and mode, and `wrap(source)`
    - Export from the browser index
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 9.5, 21.1_
  - [ ] 20.2 Write property test for the Gate filtering model
    - **Property 21: Gate filtering model**
    - **Validates: Requirements 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 9.5, 21.1**
    - File `tests/browser/gate/p21-filtering.test.ts`; Events from `tests/helpers/events.ts`
  - [ ] 20.3 Write property test for invalid Gate windows
    - **Property 22: Invalid Gate windows are rejected**
    - **Validates: Requirements 8.2**
    - File `tests/browser/gate/p22-invalid-window.test.ts`
  - [ ] 20.4 Write property test for Custom_Events across the kit
    - **Property 4: Custom Events keep their type and data**
    - **Validates: Requirements 1.11, 21.10**
    - File `tests/browser/gate/p04-custom-events.test.ts`; pass Custom_Events through `shiftEvent`, the Gate, `serialiseRecording` then `parseRecording`, and the Replay_Source

- [ ] 21. Tap_Source
  - [ ] 21.1 Implement the pure `tapStep` model and `createTapSource` on top of it
    - Create `packages/browser/src/tap-model.ts` with the `TapState`, `TapInput` and `tapStep(state, input)` signatures from the design. It uses no DOM type and reads no clock. Rules: Space key-down (not repeat, not in a text input) or pointer-down on the target with `held === null` emits an Onset with strength 1 and source `tap` and sets `held`; the matching key-up or pointer-up emits Release and clears `held`; blur and stop while held emit Release; a `now` of `null` drops the input and returns `clock-unavailable`; `handled` is true only when the input was handled. Only a space-bar key-up clears `held` after a space-bar press
    - Create `packages/browser/src/tap.ts` with `createTapSource({ now, keyTarget, pointerTarget })`: the DOM listeners only translate each browser event into one `TapInput` (calling `now()` once, a throw becomes `null`; `inTextInput` true for `input`, `textarea`, `select` or content-editable focus; `visibilitychange` to hidden maps to `blur`), apply `tapStep`, emit its Events, report its error through `subscribeErrors`, and call `preventDefault` only when `handled` is true. `stop()` applies the `stop` input and removes every listener
    - Export `tapStep`, its types and `createTapSource` from the browser index; `tapStep` is part of the public API
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12_
  - [ ] 21.2 Write property test for the Tap_Source press model
    - **Property 24: Tap Source follows the press model**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.6, 9.7, 9.9, 9.10, 9.11**
    - Reference model in `tests/helpers/tap-reference.ts` (named to avoid confusion with the package's `tap-model.ts`); test in `tests/browser/tap/p24-press-model.test.ts` folding `tapStep` (imported from `@earworm/browser`) over generated `TapInput` sequences with arbitrary clock values and comparing with the reference
  - [ ] 21.3 Write example tests for the DOM listeners, text-input focus and clock failure
    - File `tests/browser/tap/tap.test.ts` with real `KeyboardEvent` and `PointerEvent` objects on fake DOM targets: each browser event maps to the expected `TapInput`, `preventDefault` is called only when `handled` is true, Space in a focused `<input>` is not default-prevented and emits nothing, a `now()` that returns `null` or throws drops the input and reports `clock-unavailable`, and after `stop()` no listener remains
    - _Requirements: 9.6, 9.7, 9.8, 9.12_
  - [ ] 21.4 Write property test for release separation of space-bar Onsets
    - **Property 60: A release separates space-bar Onsets**
    - **Validates: Requirements 9.3, 9.12**
    - File `tests/browser/tap/p60-release-separates.test.ts`; start from idle, held by the space bar or held by a pointer, fold `tapStep` over sequences of space-bar key-down, auto-repeat key-down and key-up inputs with any clock values, and check that a space-bar key-up input and a Release_Event lie between any two consecutive space-bar Onset_Events

- [ ] 22. Synth
  - [ ] 22.1 Implement Synth scheduling, validation, gating and stop
    - Create `packages/browser/src/schedule-validation.ts` with the pure `validateScheduleRequest(voice, opts): Result<ValidatedRequest>`, which uses no Web Audio API. Checks in order: frequency finite and 20 to 20,000 Hz (`invalid-frequency`), duration finite and 1 to 60,000 ms (`invalid-duration`), gain a finite number from 0 to 1 inclusive (`invalid-gain`); an omitted gain means 1
    - Create `packages/browser/src/synth.ts` with `createSynth(engine, { gate })`, `schedule(voice, atMs, opts)` calling `validateScheduleRequest` first and rejecting with its Kit_Error before any node is created or the Gate is notified, start at `max(atMs, now())`, `gate.addWindow` before `start()` unless `ungated`, `stop()` ramping gain to 0 within 50 ms and cancelling unstarted windows, `synth-stopped` afterwards
    - Export `createSynth` and `validateScheduleRequest` from the browser index; `validateScheduleRequest` is part of the public API
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.12, 7.14_
  - [ ] 22.2 Implement the built-in Voices and `registerVoice`
    - Create `packages/browser/src/voices.ts` with knock, click, tone, kick, snare, hat, bass and bell built from `OscillatorNode`, `GainNode`, `BiquadFilterNode` and a generated noise `AudioBuffer`; wire them and `registerVoice(name, builder)` into `synth.ts`
    - _Requirements: 7.1, 7.11_
  - [ ] 22.3 Write property test for Synth input validation
    - **Property 23: Synth input validation**
    - **Validates: Requirements 7.2, 7.6, 7.14**
    - File `tests/browser/synth/p23-validation.test.ts`; run `validateScheduleRequest` (imported from `@earworm/browser`) over invalid frequencies, durations and gains (NaN, infinities, below 0, above 1) and check the code follows the check order; any finite gain from 0 to 1 with a valid frequency and duration succeeds; spy Gate and context to confirm `schedule` rejects with the same Kit_Error, creates no node and adds no window
  - [ ] 22.4 Write Synth timing tests with `OfflineAudioContext`
    - File `tests/browser/synth/timing.test.ts`: start within 1 ms of the scheduled time, tone stop at start plus duration within 1 ms, a late schedule starts immediately and returns the actual start, gain scales the peak, `stop()` silences within 50 ms, the Gate is notified before start, cancelled windows on stop, no notification with `ungated`
    - _Requirements: 7.3, 7.4, 7.5, 7.7, 7.8, 7.9, 7.10, 7.12_
  - [ ] 22.5 Write Voice rendering tests
    - File `tests/browser/synth/voices.test.ts`: each built-in Voice renders non-silent audio in an `OfflineAudioContext` without any fetch, and a registered Voice schedules like a built-in one
    - _Requirements: 7.1, 7.11_
  - [ ] 22.6 Write invalid-gain examples per Voice
    - File `tests/browser/synth/invalid-gain.test.ts`: for each built-in Voice and one registered Voice in an `OfflineAudioContext`, a request with an invalid gain rejects with `invalid-gain`, creates no node and makes no Gate call
    - _Requirements: 7.14_

- [ ] 23. Worklet and Capture_Pipeline
  - [ ] 23.1 Implement the Worklet
    - Create `packages/browser/src/worklet.ts` importing only `@earworm/core/framing`; read `frameSize` from `processorOptions` (default 128, 512 supported), push each quantum into `createFramer`, post a transferred copy of each completed Frame with Timestamp `currentFrame / sampleRate × 1000`; use no DOM API
    - Add a dependency-cruiser rule that allows `packages/browser/src/worklet.ts` to import only `@earworm/core/framing`
    - Create `packages/browser/src/worklet-url.ts` containing `import workletUrl from "./worklet.ts?worker&url"; export default workletUrl;`, and `packages/browser/src/vite-env.d.ts` containing `declare module "*?worker&url" { const url: string; export default url; }`. Reference the declaration from `worklet-url.ts` with `/// <reference path="./vite-env.d.ts" />` so it is part of any program that imports it, including the tests typecheck
    - Add `getWorkletUrl(): Promise<string>` in `packages/browser/src/worklet-url-loader.ts`, which returns `(await import("./worklet-url.ts")).default`, and export it from the browser index. The import is dynamic, so importing `@earworm/browser` in Node (the API-surface test, task 28.2) never evaluates the `?worker&url` import
    - The `?worker&url` pattern comes from the Vite docs (Web Workers). It returns the URL of the Worklet bundled as its own chunk with its imports inlined, so the output has no `import` statements left, which `audioWorklet.addModule` accepts. Leave `worker.format` at its default (iife)
    - Vitest browser mode (Chromium) must resolve `?worker&url` too. If Vitest cannot resolve it in a project, stop and tell the user rather than adding a dependency
    - _Requirements: 2.2, 2.3, 2.8, 2.10, 2.12_
  - [ ] 23.2 Write the Vite build test
    - Create a minimal build fixture in `tests/helpers/vite-app/` that imports `getWorkletUrl` from `@earworm/browser` (by package name) and calls it. The Capture_Pipeline does not exist yet at this point, so the fixture does not import `createCapturePipeline`
    - Write `tests/core/packaging/vite-build.test.ts` (Node project) that runs Vite's `build()` on the fixture and asserts zero build errors and an emitted Worklet asset: a hashed `.js` file in the output assets that contains the framing code and has no `import` statements for `@earworm/core`
    - _Requirements: 2.12_
  - [ ] 23.3 Implement the Capture_Pipeline lifecycle
    - Create `packages/browser/src/capture.ts` with `createCapturePipeline(engine, opts)`: states `stopped`, `starting`, `running`, `stopping`; idempotent `start` returning the same Promise; request the stream with `echoCancellation`, `noiseSuppression` and `autoGainControl` false; resume a suspended context (`audio-context-resume`); load the Worklet with `audioWorklet.addModule(await getWorkletUrl())` inside `start()` (the dynamic import from task 23.1, so Node imports of the package never evaluate `?worker&url`); map `NotAllowedError` to `permission-denied` and `NotFoundError` or `OverconstrainedError` to `no-device`; release tracks and close the Worklet on every failure and on `stop`
    - Export from the browser index
    - Once this task exists, extend the fixture in `tests/helpers/vite-app/` to also import `createCapturePipeline` and rerun `tests/core/packaging/vite-build.test.ts`
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7, 2.9, 2.11, 7.13_
  - [ ] 23.4 Implement Frame processing in the Capture_Pipeline
    - Create `packages/browser/src/frame-processor.ts` exporting `createFrameProcessor({ detectors, calibration, emit })`: run the Detector list (default Onset, Pitch, Level), set `source: "mic"`, apply `shiftEvent(e, −latency)` when a Calibration exists, emit in return order; `close()` calls `flushDetectors` and emits the result
    - Wire it into `capture.ts` behind the Gate, and call `close()` before `stop()` resolves. Export `createFrameProcessor` from the browser index
    - _Requirements: 1.12, 2.10, 2.13, 2.14, 6.4, 18.11, 21.2, 21.3, 21.13_
  - [ ] 23.5 Write Capture_Pipeline lifecycle tests
    - File `tests/browser/capture/lifecycle.test.ts` with stubbed `navigator.mediaDevices.getUserMedia` and `AudioContext.resume`: the three constraints are false, denied and no-device reject with the right code and leave no live track and a restartable `stopped` state, resume failure gives `audio-context-resume`, a second `start` opens no second stream, `stop` stops tracks and closes the Worklet
    - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7, 2.9, 2.11_
  - [ ] 23.6 Write Frame processing tests
    - File `tests/browser/capture/frame-processor.test.ts`: default Detectors are Onset, Pitch and Level only; a supplied list runs exactly those; every Event has `source: "mic"`; Latency is subtracted from Timestamp, `startTime` and `endTime` with `duration` unchanged; `close()` delivers `flush()` Events
    - _Requirements: 2.13, 2.14, 6.4, 18.11, 21.2, 21.3, 21.13_
  - [ ] 23.7 Write the Worklet integration test
    - File `tests/browser/capture/worklet.test.ts` in Chromium: an `OscillatorNode` into an `AudioWorkletNode` loaded from the URL that `getWorkletUrl()` returns (from `worklet-url.ts`, not from `worklet.ts` directly); posted Frames have Timestamps spaced `frameSize / sampleRate × 1000` apart, at least one per 12 ms at 128 and 512 samples at 48 kHz, and no posts after the node is closed
    - _Requirements: 2.2, 2.3, 2.6, 2.10_

- [ ] 24. Calibration
  - [ ] 24.1 Implement the pure calibration maths
    - Create `packages/browser/src/calibration-math.ts` with `noiseFloorFromLevels(levelEvents, maxQuietLevel)` (highest 100 ms power-average, `room-too-loud` above the limit, `calibration-failed` with no Events) and `medianLatency(scheduled, detected, maxMatchMs)` (nearest-click matching, each click at most once, `calibration-failed` below 3 matches or outside 0 to 500 ms)
    - Export from the browser index
    - _Requirements: 6.1, 6.3, 6.6, 6.10, 6.11_
  - [ ] 24.2 Write property test for noise floor measurement
    - **Property 17: Noise floor measurement**
    - **Validates: Requirements 6.1, 6.6**
    - File `tests/browser/calibration/p17-noise-floor.test.ts`
  - [ ] 24.3 Write property test for median latency
    - **Property 18: Median latency and failure rules**
    - **Validates: Requirements 6.3, 6.10, 6.11**
    - File `tests/browser/calibration/p18-median-latency.test.ts`
  - [ ] 24.4 Implement Calibration serialisation and the store
    - Create `packages/browser/src/calibration-store.ts` with `serialiseCalibration`, `parseCalibration` (`invalid-calibration`; valid ranges −120 to 0 dBFS and 0 to 500 ms) and `createCalibrationStore()` exposing `get`, `set`, `state` and `subscribe`; no `localStorage`
    - Define the `CalibrationStore` interface from the design: `get(): Calibration | null` (`null` means unset, Detectors use −60 dBFS), `set(c)` replacing the whole `{ noiseFloorDb, latencyMs }` object in one write, and `subscribe(listener)` returning an `Unsubscribe`. The store never holds a partial Calibration
    - Export from the browser index
    - _Requirements: 6.7, 6.8, 6.9, 6.13, 6.14, 16.14_
  - [ ] 24.5 Write property test for Calibration serialisation
    - **Property 20: Calibration serialisation**
    - **Validates: Requirements 6.7, 6.8, 6.9**
    - File `tests/browser/calibration/p20-serialisation.test.ts`
  - [ ] 24.6 Implement `createCalibrator`
    - Create `packages/browser/src/calibrator.ts` with `createCalibrator({ engine, synth, source, store, detectors, wait? })`, `measureNoiseFloor`, `measureLatency` (4 ungated clicks 500 ms apart, timeout 3,000 ms in 2,000 to 10,000), `calibrate()` storing only when both succeed, `load(text)`, and `setNoiseFloor(db)` on every Detector that has it
    - `wait(ms)` defaults to a wait on the shared AudioContext clock and is injectable, and `detectors` is injectable, so tests run with fakes and no real audio or timer
    - Atomic writes: `measureNoiseFloor` and `measureLatency` return values and never write the store or call `setNoiseFloor`. `calibrate()` runs both into local variables and calls `store.set({ noiseFloorDb, latencyMs })` once, only when both succeed; on any failure it drops the local values and rejects with the Kit_Error. `load(text)` calls `parseCalibration` and on success makes one `store.set`; on failure it rejects `invalid-calibration` and writes nothing
    - `setNoiseFloor(db)` is called on the Detectors on every `store.set` and only then, so with no successful attempt the store stays `null` and the Detectors keep −60 dBFS
    - Export from the browser index
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 18.15_
  - [ ] 24.7 Write Calibrator tests with fakes
    - File `tests/browser/calibration/calibrator.test.ts` with a fake source, Synth, injected `wait` and fake Detectors that record `setNoiseFloor` calls: success stores both values and updates Detector Noise_Floors; timeout, too few clicks and a loud room reject and leave the previous Calibration unchanged (or unset); a latency failure after a successful Noise_Floor measurement leaves the previous Calibration whole; invalid serialised input keeps the previous Calibration; clicks are scheduled ungated
    - Req 6.14 end to end: a first `calibrate()` that fails leaves the store `null`, and an Onset_Detector then still uses −60 dBFS
    - _Requirements: 6.2, 6.3, 6.5, 6.6, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 18.15_
  - [ ] 24.8 Write property test for all-or-nothing Calibration updates
    - **Property 59: Calibration updates are all or nothing**
    - **Validates: Requirements 6.5, 6.6, 6.9, 6.13, 6.14**
    - File `tests/browser/calibration/p59-all-or-nothing.test.ts`; generate an initial store (unset or a valid Calibration) and sequences of `calibrate()` and `load(text)` attempts that succeed or fail at each failure point, driven by a fake Event source, a fake Synth, fake Detectors and an injected `wait`; after each attempt the store equals the last successful attempt (or the initial value), and `setNoiseFloor` is called exactly once per success and never on failure

- [ ] 25. Checkpoint: end of `@earworm/browser`
  - Run `npm test`, `npm run typecheck` and `npm run lint:deps`. Ensure all tests pass, ask the user if questions arise.

- [ ] 26. UI hooks
  - [ ] 26.1 Create the React test helper
    - Create `tests/helpers/react.ts` exporting `render(element)` and `unmount()` built on `react-dom/client` `createRoot` and `act`, setting `globalThis.IS_REACT_ACT_ENVIRONMENT = true`. No React testing library is used
    - _Requirements: 15.10_
  - [ ] 26.2 Implement `latestOfType` and the latest-value store
    - Create `packages/ui/src/latest.ts` with the pure `latestOfType(events, type)` and a small store that keeps the latest Envelope level, Spectrum magnitudes and Band values, `null` until the first match
    - Export from `packages/ui/src/index.ts`
    - _Requirements: 21.14, 21.16_
  - [ ] 26.3 Write property test for the latest-value store
    - **Property 43: Latest-value store**
    - **Validates: Requirements 21.14, 21.16**
    - File `tests/ui/hooks/p43-latest-value.test.ts`
  - [ ] 26.4 Implement the hooks
    - Create `packages/ui/src/hooks.ts` with `useEvents(source, { limit })`, `useInputLevel`, `useCalibrationState(store)`, `useEnvelopeLevel`, `useSpectrum` and `useBands`, all on `useSyncExternalStore` and unsubscribing on unmount
    - Export from the ui index
    - _Requirements: 15.9, 15.10, 21.14, 21.15, 21.16_
  - [ ] 26.5 Write hook tests
    - File `tests/ui/hooks/hooks.test.tsx` using `tests/helpers/react.ts`: each hook reflects emitted Events, zero listeners remain and no state update occurs after unmount, and switching to the Tap_Source keeps the latest envelope, spectrum and band values
    - _Requirements: 15.9, 15.10, 21.14, 21.15, 21.16_

- [ ] 27. MicCheck
  - [ ] 27.1 Implement `MicCheck`
    - Create `packages/ui/src/MicCheck.tsx` with props `{ capture, tap, calibrator, store, onSourceChange }`: tap-only control when `canUseMic()` is false, permission state from `navigator.permissions.query` when available and from the `capture.start()` result, explanation copy, a start button so permission is requested only after a user action, level `(clamp(dBFS, −60, 0) + 60) / 60`, calibrate control with error code display and "failed" state, denied state disabling calibrate, tap mode calling `onSourceChange(tap)` after `tap.start()`, native `<button>` elements with accessible names, and the `data-testid` values from the design
    - Export from the ui index
    - _Requirements: 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.11, 15.13, 15.14_
  - [ ] 27.2 Write MicCheck behaviour tests
    - File `tests/ui/mic-check/mic-check.test.tsx` with fake capture, tap, calibrator and store: no microphone API call when `canUseMic` is false; permission "prompt", "granted" and "denied"; no permission request before a click; calibrate success and failure (error code shown, state "failed", stored Calibration unchanged); denied disables calibrate and shows tap mode; tap mode switches the source within 100 ms; every `data-testid` is present
    - _Requirements: 15.2, 15.3, 15.5, 15.6, 15.7, 15.8, 15.13, 15.14_
  - [ ] 27.3 Write MicCheck keyboard and accessibility tests
    - File `tests/ui/mic-check/a11y.test.tsx`: every control has an accessible name, is reachable with Tab, and activates with Enter and with Space
    - _Requirements: 15.11_
  - [ ] 27.4 Write the fake-device MicCheck test
    - Add Chromium launch flags `--use-fake-device-for-media-stream` and `--use-fake-ui-for-media-stream` to the `ui` project in `vitest.config.mts`
    - File `tests/ui/mic-check/fake-device.test.tsx`: a real Capture_Pipeline starts, permission reads "granted", and `mic-level` updates at least 10 times per second
    - _Requirements: 15.3, 15.4, 2.1_

- [ ] 28. Packaging and API surface
  - [ ] 28.1 Write the package manifest test
    - File `tests/core/packaging/package-json.test.ts`: `@earworm/ui` lists `react` in `peerDependencies` and not in `dependencies`; `@earworm/core` lists no `@earworm/*` dependency; `@earworm/browser` depends only on `@earworm/core`
    - _Requirements: 15.12, 16.1, 16.2_
  - [ ] 28.2 Write the API-surface test with a committed baseline
    - Create `tests/helpers/api-baseline.json` listing the runtime export names of `@earworm/core`, `@earworm/core/framing`, `@earworm/browser` and `@earworm/ui`. The `@earworm/browser` list includes `tapStep` and `validateScheduleRequest`. `createSampleHistory` and the Detectors' `historyLength` are not package exports and are not listed
    - Write `tests/core/packaging/api-surface.test.ts`: import each package by name, and fail if a baseline name is missing, skipping names that start with `experimental_`. Until the `skeleton-v1` tag exists, compare with the committed baseline; once it exists (`git rev-parse -q --verify refs/tags/skeleton-v1`), compare with the baseline as committed at the tag (`git show skeleton-v1:tests/helpers/api-baseline.json`)
    - Type-only exports are not visible at runtime, so new options must stay optional with defaults by review
    - _Requirements: 16.15_

- [ ] 29. Final checkpoint: end of `@earworm/ui`
  - Run `npm test`, `npm run typecheck` and `npm run lint:deps`. Fixture tests (task 18) pass only once task 17 is done. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional nice-to-have example tests and can be skipped. Every property test and performance test is required.
- Each implementation task adds its exports to its package's `src/index.ts`, because tests import packages by name.
- Test layout differs slightly from the design's `tests/e2e/`: the Vite build test runs in the Node `core` project (`tests/core/packaging/`) and the fake-device MicCheck test runs in the `ui` project, so the three CI matrix projects (`core`, `browser`, `ui`) cover everything without a fourth project.
- Node-only tests (packaging, perf, fixtures) use `node:fs` and `node:child_process`. Tests are type-checked by `tests/tsconfig.json` (task 1.5) through `npm run typecheck`. `@types/node` is already a root devDependency, so nothing is added.
- Perf tests (8.8, 9.6, 10.7) are the only tests that read a real clock.
- `@earworm/browser` and `@earworm/ui` modules must not touch browser globals at import time, so the Node API-surface test (28.2) can import them.
- The CI workflow still passes `--passWithNoTests`; remove it once every project has tests.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.1"] },
    { "id": 2, "tasks": ["1.5", "2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4"] },
    { "id": 4, "tasks": ["2.5", "2.6", "3.1"] },
    { "id": 5, "tasks": ["3.2", "3.3"] },
    { "id": 6, "tasks": ["3.4", "3.5"] },
    { "id": 7, "tasks": ["3.6", "3.7", "3.8", "4.1"] },
    { "id": 8, "tasks": ["4.2", "5.1"] },
    { "id": 9, "tasks": ["5.2", "5.3", "5.4", "5.5", "6.1"] },
    { "id": 10, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 11, "tasks": ["7.2", "7.3", "8.1"] },
    { "id": 12, "tasks": ["8.2", "8.3"] },
    { "id": 13, "tasks": ["8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "9.1"] },
    { "id": 14, "tasks": ["9.2", "9.3", "9.4", "9.5"] },
    { "id": 15, "tasks": ["9.6", "9.7", "10.1"] },
    { "id": 16, "tasks": ["10.2", "10.3", "10.4", "10.5", "10.6"] },
    {
      "id": 17,
      "tasks": [
        "10.7",
        "10.8",
        "11.1",
        "11.2",
        "11.3",
        "11.4",
        "11.5",
        "11.6",
        "13.1"
      ]
    },
    { "id": 18, "tasks": ["13.2", "13.3", "13.4", "13.5"] },
    { "id": 19, "tasks": ["13.6", "13.7", "13.8", "13.9", "14.1"] },
    { "id": 20, "tasks": ["14.2", "14.3", "14.4"] },
    { "id": 21, "tasks": ["14.5", "14.6"] },
    { "id": 22, "tasks": ["14.7", "14.8", "14.9", "14.10", "15.1"] },
    { "id": 23, "tasks": ["15.2", "15.3", "15.4"] },
    { "id": 24, "tasks": ["15.5", "15.6", "15.7"] },
    { "id": 25, "tasks": ["15.8", "19.1"] },
    { "id": 26, "tasks": ["19.2"] },
    { "id": 27, "tasks": ["19.3", "20.1"] },
    { "id": 28, "tasks": ["20.2", "20.3", "20.4", "21.1"] },
    { "id": 29, "tasks": ["21.2", "21.3", "21.4", "22.1"] },
    { "id": 30, "tasks": ["22.2", "22.3"] },
    { "id": 31, "tasks": ["22.4", "22.5", "22.6", "23.1"] },
    { "id": 32, "tasks": ["23.2", "23.3"] },
    { "id": 33, "tasks": ["23.4", "23.5", "23.7"] },
    { "id": 34, "tasks": ["23.6", "24.1"] },
    { "id": 35, "tasks": ["24.2", "24.3", "24.4"] },
    { "id": 36, "tasks": ["24.5", "24.6"] },
    { "id": 37, "tasks": ["24.7", "24.8", "26.1", "26.2"] },
    { "id": 38, "tasks": ["26.3", "26.4"] },
    { "id": 39, "tasks": ["26.5", "27.1"] },
    { "id": 40, "tasks": ["27.2", "27.3", "27.4"] },
    { "id": 41, "tasks": ["28.1", "28.2"] },
    { "id": 42, "tasks": ["18.1"] },
    { "id": 43, "tasks": ["18.2"] },
    { "id": 44, "tasks": ["18.3", "18.4", "18.5", "18.6"] }
  ]
}
```
