# Requirements Document

## Introduction

Earworm is a kit that turns messy human input (knocks, claps, hums, whistles, taps) into timestamped, testable interaction events. The kit is the "skeleton" for three apps in unrelated worlds (Do As I Do, Ditdah, Loophole). The apps are out of scope for this spec. This spec covers the kit only, in three packages: `@earworm/core` (pure logic), `@earworm/browser` (Web Audio, mic, tap) and `@earworm/ui` (React components and hooks).

The kit works in seven stages: capture, detect, calibrate, play, gate, tap mode, and timing analysis (match, quantise, segment, classify). Capture posts Frames of samples from the Worklet to the main thread, where the Core Detectors turn them into Events. Besides onsets, pitch and level, the Detectors report a loudness envelope, sound start and end, the spectrum and frequency bands. In the timing analysis stage, "segment" turns Pitch_Events, Sound_Start_Event and Sound_End_Event pairs (stamped when the sound is confirmed, with the true start and end carried in startTime and endTime), or tap presses into Marks, and "classify" assigns the durations of Marks (or of gaps) to classes of a Ratio_Set, relative to the player's own speed. The apps, not the kit, decide what a class means. All times are milliseconds on the Audio_Clock.

The kit stores no audio. Recordings hold Events only, and audio files exist only as test fixtures that are never shipped.

## Glossary

- **Kit**: The combined set of packages `@earworm/core`, `@earworm/browser` and `@earworm/ui`.
- **Core**: The `@earworm/core` package. Pure logic. Runs in Node, in the AudioWorklet (framing code only) and on the main thread (Detectors and analysis functions).
- **Browser_Package**: The `@earworm/browser` package. Web Audio, microphone, worklet, tap, synth, gate and calibration.
- **UI_Package**: The `@earworm/ui` package. React 19 components and hooks.
- **Audio_Clock**: The `AudioContext.currentTime` timeline, expressed in milliseconds. The only time base used by the Kit. In the Worklet it is derived from `currentFrame`.
- **Timestamp**: A number of milliseconds on the Audio_Clock.
- **Kit_Error**: An object with a code string (for example permission-denied, invalid-grid) and a message.
- **Event**: A timestamped record emitted by a Detector or by the Tap_Source. Each Event has a type, a Timestamp, a source and type-specific fields.
- **Source_Field**: The `source` field of an Event. A string; the Kit defines mic, tap and replay. The Capture_Pipeline sets mic, the Tap_Source sets tap, and an Event recorded or created with the source replay keeps it. Every Event keeps the source it was created with, including when a Replay_Source emits it.
- **Custom_Event**: An Event emitted by a Detector whose type begins with x-, with a Timestamp, a source string and a data object.
- **skeleton-v1**: The git tag that marks the first release of the Kit's public API.
- **Onset_Event**: An Event stating that a sharp sound started (knock, clap, tap). Fields: Timestamp, source, strength.
- **Pitch_Event**: An Event stating that a steady note is sounding. Fields: Timestamp, source, frequency in Hz, nearest MIDI note number, cents offset, confidence.
- **Level_Event**: An Event reporting input loudness. Fields: Timestamp, source, level in dBFS.
- **Release_Event**: An Event stating that a held tap ended. Fields: Timestamp, source.
- **Envelope_Event**: An Event reporting the smoothed loudness contour. Fields: Timestamp, source, level in dBFS.
- **Sound_Start_Event**: An Event stating that a bounded sound span began. Fields: Timestamp (the Timestamp of the Frame at which Min_Hold elapsed), source, startTime (the Timestamp of the first Frame above the start threshold), level in dBFS of the Frame at the Timestamp.
- **Sound_End_Event**: An Event stating that a bounded sound span ended. Fields: Timestamp (the Timestamp of the Frame at which Hangover elapsed), source, endTime (the Timestamp of the first Frame below the end threshold), duration in milliseconds (endTime minus the startTime of the matching Sound_Start_Event).
- **Spectrum_Event**: An Event carrying the magnitude spectrum of a Frame. Fields: Timestamp, source, sample rate in Hz, FFT_Size, and magnitudes in dBFS as a Float32Array of length FFT_Size ÷ 2.
- **Band_Event**: An Event carrying the energy of each configured Band. Fields: Timestamp, source, unit (dbfs or normalised), and a value for each Band keyed by Band name.
- **Band**: A named frequency range `{name, lowHz, highHz}` with 0 ≤ lowHz < highHz ≤ Nyquist. Bands may overlap.
- **Nyquist**: Half of the sample rate, in Hz.
- **Band_Preset**: A kit-generic list of Bands supplied as plain data.
- **FFT_Size**: The number of samples of a Spectrum analysis, a power of two from 256 to 8192 inclusive. The bin spacing is sample rate ÷ FFT_Size Hz.
- **Window_Function**: The weighting applied to a Frame before the FFT: hann (default), hamming, blackman or rectangular.
- **Min_Hold**: The time in milliseconds that the level must stay above the start threshold before the Sound_Detector reports a sound.
- **Hangover**: The time in milliseconds that the level must stay below the end threshold before the Sound_Detector ends a sound.
- **Event_Source**: Any producer of Events: the Capture_Pipeline, the Tap_Source or the Replay_Source.
- **Capture_Pipeline**: The Browser_Package component that opens the microphone, runs the Worklet, and runs the Core Detectors on the main thread on the Frames the Worklet posts.
- **Worklet**: The AudioWorklet that splits incoming samples into Frames and posts each Frame's samples and Timestamp to the Capture_Pipeline.
- **Sample_History**: The most recent FFT_Size samples (for the Spectrum_Detector and the Band_Detector) or the most recent 2048 samples of the pitch window (for the Pitch_Detector) that a Detector keeps across consecutive Frames. It is cleared by `reset()`, and it is zero-padded after the received samples only until enough samples have arrived.
- **Frame**: One block of audio samples together with the Timestamp of its first sample and its sample rate in Hz (sampleRate). The Worklet posts the samples of each Frame.
- **Framing_Function**: The single Core function that splits samples into Frames. Used by the Worklet and by the tests.
- **Detector_Interface**: The Core interface of a Detector: a name, a `process(frame)` method that returns zero or more Events, a `reset()` method, and an optional `flush()` method that returns the Events needed to close any open state.
- **Onset_Detector**: The Core Detector that turns Frames into Onset_Events.
- **Pitch_Detector**: The Core Detector that turns Frames into Pitch_Events.
- **Level_Detector**: The Core Detector that turns Frames into Level_Events.
- **Envelope_Detector**: The Core Detector that turns Frames into Envelope_Events.
- **Sound_Detector**: The Core Detector that turns Frames into Sound_Start_Event and Sound_End_Event pairs.
- **Spectrum_Detector**: The Core Detector that turns Frames into Spectrum_Events.
- **Band_Detector**: The Core Detector that turns Frames into Band_Events, using the Spectrum of its Sample_History and passing its Window_Function to `bands`.
- **Detector**: The Onset_Detector, the Pitch_Detector, the Level_Detector, the Envelope_Detector, the Sound_Detector, the Spectrum_Detector or the Band_Detector, each implementing the Detector_Interface.
- **Calibrator**: The Browser_Package component that measures Noise_Floor and Latency.
- **Calibration**: The result of the Calibrator: Noise_Floor and Latency values.
- **Noise_Floor**: The ambient input level in dBFS measured while the room is quiet. WHERE no Calibration is available, the Noise_Floor is the default of -60 dBFS.
- **Latency**: The delay in milliseconds between a sound being scheduled on the Synth and the same sound arriving at the Capture_Pipeline, measured as the median over the matched clicks of the latency calibration.
- **Default_Table**: The default and allowed range of each configured value:

| Setting                    | Default                 | Allowed range     |
| -------------------------- | ----------------------- | ----------------- |
| Onset threshold            | 10 dB above Noise_Floor | 3 to 40 dB        |
| Onset attack window        | 30 ms                   | 5 to 100 ms       |
| Refractory period          | 100 ms                  | 0 to 1,000 ms     |
| Pitch confidence threshold | 0.8                     | 0 to 1            |
| Noise-floor quiet period   | 2,000 ms                | 500 to 10,000 ms  |
| Maximum quiet level        | −30 dBFS                | −100 to 0 dBFS    |
| Gate tail                  | 150 ms                  | 0 to 5,000 ms     |
| Segmenter maximum gap      | 25 ms                   | 5 to 500 ms       |
| Segmenter minimum duration | 30 ms                   | 10 to 2,000 ms    |
| Steadiness tolerance       | 50 cents                | 5 to 200 cents    |
| Pitch-split threshold      | 100 cents               | 10 to 1,200 cents |
| Level Event rate           | 30 per second           | 1 to 100          |

- **Synth**: The Browser_Package component that produces knocks, clicks, tones, drum sounds, bass and bell with the Web Audio API and no audio files.
- **Voice**: A named sound of the Synth, either built in (knock, click, tone, kick, snare, hat, bass, bell) or registered by an app.
- **Ungated_Playback**: Playback that the caller requests so that the Synth does not notify the Gate.
- **Gate**: The Browser_Package component that suppresses mic Events while the Synth is sounding.
- **Gate_Window**: A time interval during which the Gate suppresses mic Events. It runs from the Synth sound start to the Synth sound end plus a tail.
- **Gate_Mode**: The Gate setting, either ignore-synth (default) or off.
- **Tap_Source**: The Browser_Package Event_Source driven by the space bar or screen taps. It emits Onset_Events on press and Release_Events on release.
- **Pattern**: An ordered list of Timestamps of Onset_Events, or an ordered list of intervals derived from them.
- **Matcher**: The Core function `match()` that scores how closely a reply Pattern copies a target Pattern.
- **Match_Score**: A number from 0 to 1 returned by the Matcher. 1 means a perfect copy. The Matcher returns it together with the missed-hit count, the extra-hit count, the largest interval error with its hit index, and the tempo ratio.
- **Quantiser**: The Core function `quantise()` that snaps Timestamps to a beat grid.
- **Beat_Grid**: A start Timestamp, a tempo in beats per minute and a subdivision count per beat.
- **Frame_Interval**: A Segmenter configuration value, required for Pitch_Event input: the time in milliseconds between consecutive Pitch_Events from the Detector, which a Pitch_Event does not carry. It equals the Frame duration (frame size ÷ sample rate × 1000 ms).
- **Segmenter**: The Core function `segment()` that turns Pitch_Events, Sound_Start_Event and Sound_End_Event pairs, or tap press and Release_Event pairs, into timed Marks.
- **Mark**: A timed segment with a start Timestamp and a duration in milliseconds. A Mark has no class.
- **Ratio_Set**: A strictly increasing list of positive numbers starting at 1, such as [1, 3] or [1, 3, 7]. Each entry is the nominal length of a class in units.
- **Deviation**: For one classified duration, the duration divided by (unit × the Ratio_Set entry of its class).
- **Duration_Classifier**: The Core component that assigns each duration to a class of a Ratio_Set relative to the player's own estimated unit. For Morse, the apps use the ratios 1, 3 and 7 for dots, dashes and gaps.
- **Recording**: A serialisable list of Events with a format version. A Recording holds Events only and never holds audio.
- **Replay_Source**: The Core Event_Source that emits the Events of a Recording at their original Timestamps, each with the source it was recorded with. A replayed Event with source mic remains subject to the Gate.
- **Recorded_Fixture**: A WAV file in `fixtures/recorded` with its expected Events listed in `fixtures/recorded/manifest.json`. Fixtures are test-only and never shipped.
- **MicCheck**: The UI_Package React component that shows microphone permission, input level and calibration state.
- **canUseMic**: The Browser_Package function that reports whether microphone capture is available.
- **Dependency_Rules**: The package boundary rules enforced by dependency-cruiser.

## Requirements

### Requirement 1: Event model and clock

**User Story:** As an app developer, I want every input to become a typed, timestamped Event on one clock, so that apps and tests handle all input the same way.

#### Acceptance Criteria

1. THE Core SHALL define the Event types Onset_Event, Pitch_Event, Level_Event, Release_Event, Envelope_Event, Sound_Start_Event, Sound_End_Event, Spectrum_Event and Band_Event, each carrying a Timestamp that is a finite number of milliseconds on the Audio_Clock and a source string, where the Kit defines the sources mic, tap and replay.
2. THE Core SHALL define an Event_Source interface that delivers Events to each subscriber in non-decreasing Timestamp order, with Events that share a Timestamp delivered in the order the Event_Source received them, and with no Event held back to restore that order.
3. WHEN a subscriber unsubscribes from an Event_Source, THE Event_Source SHALL deliver no further Events to that subscriber, including Events that were emitted but not yet delivered at the time of unsubscription.
4. WHEN a subscriber unsubscribes from an Event_Source, THE Event_Source SHALL continue delivering Events to all other subscribers without interruption.
5. WHEN a subscriber unsubscribes more than once, THE Event_Source SHALL treat each repeat call as a no-op and SHALL NOT throw an error.
6. THE Core SHALL provide pure functions that take the current time as a parameter and SHALL NOT read `Date.now`, `performance.now` or `AudioContext.currentTime`.
7. WHEN given a number of seconds as used by `AudioContext.currentTime`, THE Core SHALL return the equivalent Timestamp in milliseconds, and WHEN given a Timestamp, THE Core SHALL return the equivalent number of seconds.
8. IF a conversion function receives a value that is not a finite number (NaN, Infinity or -Infinity), THEN THE Core SHALL return an invalid-number Kit_Error and no value.
9. FOR ALL finite numbers of seconds in the range 0 to 1e6 seconds inclusive (about 11 days of audio), converting to a Timestamp and back to seconds SHALL produce a value within 1e-9 seconds of the original (round-trip property).
10. THE Core SHALL define a Detector_Interface with a name, a `process(frame)` method that returns zero or more Events, and a `reset()` method and an optional `flush()` method that returns zero or more Events, and the Onset_Detector, the Pitch_Detector, the Level_Detector, the Envelope_Detector, the Sound_Detector, the Spectrum_Detector and the Band_Detector SHALL implement it.
11. THE Core SHALL allow a Detector to emit Custom_Events with a type beginning x-, a Timestamp, a source and a data object, and every Kit function that receives Events SHALL keep the type, source and data of Custom_Events unchanged, while the Latency shift of Requirement 6 criterion 4 and the Gate of Requirement 8 apply to Custom_Events like any other Event.
12. WHEN a Detector returns an Event while processing a Frame, THE Detector SHALL set the Event Timestamp to the Timestamp of that Frame, and SHALL carry any earlier true time in a separate field, so that the Capture_Pipeline delivers the Events of all Detectors in non-decreasing Timestamp order as they are returned and holds back no Event.

### Requirement 2: Microphone capture

**User Story:** As an app developer, I want raw microphone input with no browser processing, so that detectors see the true sound.

#### Acceptance Criteria

1. WHEN the Capture_Pipeline starts, THE Capture_Pipeline SHALL request a microphone stream with `echoCancellation`, `noiseSuppression` and `autoGainControl` set to false.
2. WHEN the microphone stream is open, THE Worklet SHALL post the samples of each Frame, each with its Timestamp in milliseconds on the Audio_Clock, to the Capture_Pipeline.
3. WHILE the microphone stream is open, THE Worklet SHALL post at least one Frame in every 12 ms interval of the Audio_Clock.
4. IF the user denies microphone permission, THEN THE Capture_Pipeline SHALL reject with a permission-denied Kit_Error, emit no Events, hold no open microphone tracks, and remain in a stopped state from which it can be started again.
5. IF no microphone device is available, THEN THE Capture_Pipeline SHALL reject with a no-device Kit_Error, emit no Events, hold no open microphone tracks, and remain in a stopped state from which it can be started again.
6. WHEN the Capture_Pipeline stops, THE Capture_Pipeline SHALL stop all microphone tracks and close the Worklet, and THE Worklet SHALL post no further Frames after the stop completes.
7. WHEN the Capture_Pipeline starts and the AudioContext state is suspended, THE Capture_Pipeline SHALL resume the AudioContext before the first Frame is posted.
8. THE Worklet SHALL import only Core framing code and SHALL NOT use DOM APIs.
9. IF the AudioContext fails to resume, THEN THE Capture_Pipeline SHALL reject with an audio-context-resume Kit_Error, stop all microphone tracks, close the Worklet, and emit no Events.
10. THE Worklet SHALL post each Frame's samples and Timestamp to the Capture_Pipeline, and THE Capture_Pipeline SHALL run the Core Detectors on the main thread. Timestamps come from the audio clock (currentFrame), so main-thread delay changes when an Event arrives but never its Timestamp.
11. WHEN start is called on a running or starting Capture_Pipeline, THE Capture_Pipeline SHALL open no second stream and resolve when the first start completes.
12. WHEN an app that uses the Capture_Pipeline is built with Vite, THE build SHALL include the Worklet module and complete with zero errors.
13. THE Capture_Pipeline SHALL set the source of every Event it emits to mic.
14. WHEN an app supplies a list of Detectors when it starts the Capture_Pipeline, THE Capture_Pipeline SHALL run exactly those Detectors on every Frame, and SHALL default to the Onset_Detector, the Pitch_Detector and the Level_Detector.

### Requirement 3: Onset detection

**User Story:** As an app developer, I want sharp sounds like knocks and claps reported with exact timestamps, so that I can score rhythm.

#### Acceptance Criteria

1. WHEN the input energy rises above the Noise_Floor by more than the configured onset threshold in dB (default and range in the Default_Table) within the configured attack window in milliseconds (default and range in the Default_Table), THE Onset_Detector SHALL emit exactly one Onset_Event whose Timestamp is the Frame time, in milliseconds on the Audio_Clock, at which the rise first exceeds the onset threshold.
2. WHEN an Onset_Event has been emitted, THE Onset_Detector SHALL suppress further Onset_Events for the configured refractory period in milliseconds (default 100 ms, range 0 to 1,000 ms), measured from the Timestamp of the emitted Onset_Event.
3. WHILE the input energy is at or below the Noise_Floor plus the onset threshold (default and range in the Default_Table), THE Onset_Detector SHALL emit no Onset_Events.
4. THE Onset_Detector SHALL set the strength of each Onset_Event to a number from 0 to 1 inclusive, where a rise equal to the onset threshold maps to a value greater than 0, and the value does not decrease as the energy rise increases.
5. WHEN a Detector receives the same Frame sequence twice from a fresh state, THE Detector SHALL emit identical Events, including identical Timestamps and strengths, both times.
6. FOR ALL Frame sequences, THE Onset_Detector SHALL emit Onset_Events whose Timestamps are at least the refractory period (default 100 ms, range 0 to 1,000 ms) apart.
7. THE Onset_Detector SHALL meet the expected Events listed in `fixtures/recorded/manifest.json` for every Recorded_Fixture of knocks and claps, with each emitted Onset_Event matching an expected Event and no expected Event left unmatched or extra Event emitted, where "matching" means within 12 ms of an expected Event.
8. IF a Frame contains a non-finite energy value or its time is earlier than the previous Frame's time, THEN THE Onset_Detector SHALL emit no Onset_Event for that Frame and SHALL keep its state unchanged.
9. FOR ALL generated click trains of 1 to 12 clicks, 120 to 1,000 ms apart, at −30 to −6 dBFS over low noise, THE Onset_Detector SHALL emit exactly one Onset_Event per click, each within 12 ms of the true click time.
10. THE Onset_Detector SHALL emit no Onset_Event for the quiet-room and fan fixtures, and at most one for the door fixture.
11. WHILE no Onset_Event has been emitted since construction or since the last `reset()`, THE Onset_Detector SHALL apply no refractory suppression of criterion 2.
12. THE Onset_Detector SHALL emit no Onset_Event until it has accepted Frames spanning at least the configured attack window (the Frame Timestamp minus the Timestamp of the first accepted Frame since construction or the last `reset()` is at least the attack window), so a Frame that is the first one seen never produces an Onset_Event.
13. WHEN an Onset_Event has been emitted, THE Onset_Detector SHALL be disarmed until a Frame level is at or below the Noise_Floor plus the onset threshold, or at least the onset threshold in dB below the highest Frame level since that Onset_Event, whichever happens first, so that a room louder than the Noise_Floor plus the onset threshold still re-arms.

### Requirement 4: Pitch detection

**User Story:** As an app developer, I want hums and whistles reported as notes, so that I can read sustained tones.

#### Acceptance Criteria

1. WHILE a steady periodic tone with a fundamental frequency from 80 Hz to 2000 Hz inclusive is present in the Frames and its confidence is at or above the configured confidence threshold (default 0.8, range 0 to 1), THE Pitch_Detector SHALL emit one Pitch_Event per Frame containing the estimated frequency in Hz and the Frame Timestamp in milliseconds on the Audio_Clock.
2. THE Pitch_Detector SHALL include in each Pitch_Event the MIDI note number nearest to the estimated frequency (integer from 0 to 127, using A4 = 440 Hz = MIDI note 69) and the offset from that note in cents (from -50 to +50 inclusive).
3. THE Pitch_Detector SHALL include in each Pitch_Event a confidence value from 0 to 1 inclusive.
4. IF the confidence of the estimate for a Frame is below the configured confidence threshold (default 0.8, range 0 to 1), THEN THE Pitch_Detector SHALL emit no Pitch_Event for that Frame and SHALL continue processing the next Frame.
5. WHEN a synthetic sine tone with a frequency from 80 Hz to 2000 Hz inclusive, at a level above the Noise_Floor, is supplied, THE Pitch_Detector SHALL emit Pitch_Events such that every Pitch_Event is within 10 cents of the true frequency.
6. WHILE the input is silent (all samples equal to 0) or its level is below the Noise_Floor, THE Pitch_Detector SHALL emit no Pitch_Events.
7. THE Pitch_Detector SHALL emit no Pitch_Event with a frequency outside 80 to 2000 Hz. The longest lag searched is min(floor(sampleRate / 80), 1023) samples, so at sample rates above about 82 kHz the lowest detectable pitch rises above 80 Hz.
8. THE Pitch_Detector SHALL meet the expected Events listed in `fixtures/recorded/manifest.json` for every Recorded_Fixture of hums and whistles.
9. WHEN a harmonic tone (a fundamental from 80 to 1,000 Hz with at least 4 harmonics) is supplied, THE Pitch_Detector SHALL report the fundamental within 20 cents and SHALL never report a frequency an octave above or below it.
10. WHEN white noise above the Noise_Floor is supplied, THE Pitch_Detector SHALL emit no Pitch_Events.
11. WHEN a Frame is received, THE Pitch_Detector SHALL estimate the pitch from the Sample_History of the most recent 2048 samples (the pitch window) across consecutive Frames, padding with zeros after the received samples only until 2048 samples have arrived, as in Requirement 19 criterion 19. THE Pitch_Detector SHALL emit no Pitch_Event until its Sample_History holds 2048 samples since construction or the last reset().
12. WHEN `reset()` is called on the Pitch_Detector, THE Pitch_Detector SHALL clear its Sample_History, and WHEN `flush()` is called on the Pitch_Detector, THE Pitch_Detector SHALL return no Events and SHALL leave its Sample_History unchanged.
13. IF a Frame is empty, contains any sample that is NaN or infinite, or has a Timestamp earlier than the previous Frame's Timestamp, THEN THE Pitch_Detector SHALL emit no Pitch_Event for that Frame and SHALL keep its state, including its Sample_History, unchanged.
14. THE Pitch_Detector SHALL hold at most 2048 samples (the pitch window size of criterion 11) in its Sample_History at all times, discarding the oldest samples as soon as each Frame is added.

### Requirement 5: Level detection

**User Story:** As an app developer, I want a loudness reading, so that I can drive meters and thresholds.

#### Acceptance Criteria

1. WHEN a Frame is received, THE Level_Detector SHALL compute the level as 20 × log10(RMS of the Frame's samples) in dBFS, so that a full-scale sine of amplitude 1.0 reads −3.01 dBFS and a full-scale square wave reads 0 dBFS.
2. THE Level_Detector SHALL emit Level_Events at a configured maximum rate of 1 to 100 Level_Events per second (default 30 per second), and SHALL emit no more Level_Events than the configured rate in any 1000 ms window of the Audio_Clock.
3. WHEN the Level_Detector emits a Level_Event, THE Level_Detector SHALL timestamp it in milliseconds on the Audio_Clock, using the time supplied with the Frame.
4. WHEN a full-scale sine wave of amplitude 1.0 is supplied, THE Level_Detector SHALL report a level within 0.5 dB of -3.01 dBFS.
5. WHEN a Frame of all-zero samples is supplied, THE Level_Detector SHALL report a level of exactly -120 dBFS.
6. IF the computed level of a non-zero Frame is below -120 dBFS, THEN THE Level_Detector SHALL report -120 dBFS.
7. FOR ALL Frames with samples in the range -1 to 1 inclusive, THE Level_Detector SHALL report a level between -120 dBFS and 0 dBFS inclusive.
8. IF a Frame is empty (contains no samples) or contains any sample that is NaN or infinite, THEN THE Level_Detector SHALL emit no Level_Event for that Frame and SHALL retain its previous state.

### Requirement 6: Calibration

**User Story:** As a player, I want the kit to learn my room and my speakers, so that a fan is not mistaken for a knock and my timing is not scored late.

#### Acceptance Criteria

1. WHEN calibration of the Noise_Floor starts, THE Calibrator SHALL measure input levels over a configured quiet period of 500 to 10,000 ms (default 2,000 ms) and store the Noise_Floor in dBFS as the highest short-term level observed during that period.
2. WHEN the Noise_Floor is stored, THE Detectors SHALL use the stored Noise_Floor in place of the default Noise_Floor of criterion 12 as the reference for their thresholds, and every detection after that point SHALL use the stored value.
3. WHEN latency calibration starts, THE Calibrator SHALL play 4 known clicks 500 ms apart with the Synth using Ungated_Playback, detect each click at the Capture_Pipeline, match each detected click to the click scheduled nearest to it, and store the median of the matched differences (detected Timestamp minus scheduled Timestamp, in milliseconds on the Audio_Clock) as the Latency.
4. WHERE a Calibration is available, THE Capture_Pipeline SHALL subtract the Latency from the Timestamp of every Event it emits, so that an Event's Timestamp equals its uncorrected Timestamp minus the Latency.
5. IF no click is detected within the configured calibration timeout of 2,000 to 10,000 ms (default 3,000 ms, which covers the last click at 1,500 ms after the first scheduled click plus 500 ms), measured from the Timestamp of the first scheduled click, THEN THE Calibrator SHALL reject with a calibration-failed Kit_Error and keep the previous Calibration unchanged. If no previous Calibration exists, THE Calibrator SHALL leave the Calibration unset.
6. IF the input level during Noise_Floor measurement exceeds the configured maximum quiet level in dBFS (default −30 dBFS, range −100 to 0 dBFS), THEN THE Calibrator SHALL reject with a room-too-loud Kit_Error, discard the measurement, and keep the previous Calibration unchanged.
7. WHEN a calibration completes successfully, THE Calibrator SHALL return the Calibration as a serialisable object containing the Noise_Floor in dBFS and the Latency in milliseconds.
8. FOR ALL valid Calibration objects, serialising then parsing SHALL produce an equal Calibration (round-trip property).
9. IF the Calibrator is given a serialised Calibration that cannot be parsed into a valid Calibration, THEN THE Calibrator SHALL reject with an invalid-calibration Kit_Error and keep the previous Calibration unchanged.
10. IF fewer than 3 of the 4 clicks are matched when latency calibration ends, THEN THE Calibrator SHALL reject with a calibration-failed Kit_Error and keep the previous Calibration unchanged.
11. IF the median Latency is outside 0 to 500 ms inclusive, THEN THE Calibrator SHALL reject with a calibration-failed Kit_Error and keep the previous Calibration unchanged.
12. WHERE no Calibration is available, THE Detectors SHALL use a Noise_Floor of -60 dBFS as the reference for their thresholds.
13. IF a calibration fails under criterion 5, 6, 9, 10 or 11, THEN THE Calibrator SHALL keep the whole previous Calibration, Noise_Floor and Latency together, equal to the last Calibration that completed in full or was loaded successfully, and SHALL discard any Noise_Floor or Latency measured during the failed attempt, so that no partial update of either value remains.
14. IF a calibration fails under criterion 5, 6, 9, 10 or 11 and no Calibration has previously completed in full or been loaded successfully, THEN THE Calibrator SHALL leave the Calibration unset, so that the Detectors use the default Noise_Floor of criterion 12.

### Requirement 7: Synth

**User Story:** As an app developer, I want built-in sounds scheduled at exact times, so that I need no audio files.

#### Acceptance Criteria

1. THE Synth SHALL produce each of the following sounds using Web Audio nodes only, with no audio file loaded: knock, click, tone at a caller-given frequency, kick, snare, hat, bass and bell.
2. WHEN a tone is scheduled with a frequency outside 20 Hz to 20,000 Hz, or a non-finite frequency, THE Synth SHALL reject the request with an invalid-frequency Kit_Error, and SHALL NOT start any sound or notify the Gate.
3. WHEN a sound is scheduled for a Timestamp at or later than the current Audio_Clock time, THE Synth SHALL start the sound at that Timestamp on the Audio_Clock, with a start error of at most 1 ms.
4. WHEN a sound is scheduled for a Timestamp earlier than the current Audio_Clock time, THE Synth SHALL start the sound immediately and return the actual start Timestamp in milliseconds on the Audio_Clock.
5. WHEN a tone is scheduled with a duration from 1 ms to 60,000 ms, THE Synth SHALL stop the tone at the start Timestamp plus the duration, with a stop error of at most 1 ms.
6. WHEN a tone is scheduled with a duration that is not finite or is outside 1 ms to 60,000 ms, THE Synth SHALL reject the request with an invalid-duration Kit_Error, and SHALL NOT start any sound or notify the Gate.
7. WHEN the Synth is stopped, THE Synth SHALL silence all pending and sounding sounds within 50 ms, and SHALL reject sounds scheduled after the stop with a synth-stopped Kit_Error.
8. WHEN a sound is accepted for scheduling and Ungated_Playback is not requested, THE Synth SHALL notify the Gate of the sound's start Timestamp and end Timestamp, in milliseconds on the Audio_Clock, before the sound starts.
9. WHEN the Synth is stopped before a pending sound that was announced to the Gate has started, THE Synth SHALL notify the Gate that the sound was cancelled.
10. WHERE the caller requests Ungated_Playback, THE Synth SHALL play the sound without notifying the Gate.
11. THE Synth SHALL let an app register a new named Voice built from Web Audio nodes, and schedule it like a built-in Voice.
12. WHERE a gain from 0 to 1 is supplied, THE Synth SHALL scale the sound's peak level by that gain.
13. THE Synth, Capture_Pipeline and Tap_Source SHALL share one AudioContext, so that all Timestamps are on the same clock.
14. IF a gain is supplied that is not a finite number from 0 to 1 inclusive, THEN THE Synth SHALL reject the request with an invalid-gain Kit_Error, and SHALL NOT start any sound or notify the Gate.

### Requirement 8: Gate

**User Story:** As an app developer, I want the kit to ignore its own playback, so that the app never hears itself.

#### Acceptance Criteria

1. WHEN the Synth notifies the Gate of a sound with a start Timestamp and an end Timestamp where the end Timestamp is greater than or equal to the start Timestamp, THE Gate SHALL open a Gate_Window covering the closed interval from the start Timestamp to the end Timestamp plus the configured tail (default 150 ms, range 0 to 5,000 ms), in milliseconds on the Audio_Clock.
2. IF the Synth notifies the Gate of a sound whose end Timestamp is less than its start Timestamp, or whose start Timestamp, end Timestamp or configured tail is not a finite number, or whose configured tail is negative or greater than 5,000 ms, THEN THE Gate SHALL reject the notification with an invalid-gate-window Kit_Error, SHALL NOT open a Gate_Window, and SHALL keep all existing Gate_Windows unchanged.
3. WHILE the Gate_Mode is ignore-synth, WHEN the source of an Event is mic and its Timestamp lies inside a Gate_Window, including exactly at its start or end boundary, THE Gate SHALL drop that Event.
4. WHILE the Gate_Mode is ignore-synth, WHEN the source of an Event is mic and its Timestamp lies outside every Gate_Window, THE Gate SHALL pass that Event unchanged.
5. WHEN two Gate_Windows overlap or touch at a boundary, THE Gate SHALL treat the union of both as one Gate_Window.
6. THE Gate SHALL decide whether to drop or pass an Event using only the Event source, the Event Timestamp and the Gate_Windows, and SHALL NOT read the current time or depend on which Event_Source delivered the Event.
7. WHERE no Calibration is available, THE Gate SHALL extend each Gate_Window's end by the AudioContext output latency in milliseconds.
8. FOR ALL Event sequences and Gate_Window sets, THE Gate SHALL pass exactly the input Events whose source is not mic (including unknown sources) and the input Events whose source is mic and whose Timestamps lie outside every Gate_Window, in the original input order, and SHALL pass an empty sequence when the input is empty.
9. THE Gate SHALL support the modes ignore-synth (default) and off. In mode off, THE Gate SHALL pass every Event.

### Requirement 9: Tap mode

**User Story:** As a player with no microphone, a noisy room or an accessibility need, I want to use the space bar or a screen tap, so that I get the same events as with the mic.

#### Acceptance Criteria

1. WHEN the space bar is pressed and no text input element has focus, THE Tap_Source SHALL emit exactly one Onset_Event with strength 1, source tap and a Timestamp equal to the Audio_Clock time in milliseconds at the moment of the key press.
2. WHEN a pointer press occurs on the configured tap target, THE Tap_Source SHALL emit exactly one Onset_Event with strength 1, source tap and a Timestamp equal to the Audio_Clock time in milliseconds at the moment of the press.
3. WHILE the space bar is held down, THE Tap_Source SHALL emit zero Onset_Events from key auto-repeat, and SHALL emit a new Onset_Event only after the space bar has been released and pressed again.
4. THE Tap_Source SHALL implement the same Event_Source interface as the Capture_Pipeline, so that a consumer can use either source without branching on source type.
5. THE Gate SHALL drop only Events whose source is mic, including Events with source mic emitted by the Replay_Source, and SHALL pass every Event whose source is not mic, including tap, replay and unknown sources, regardless of any Gate_Window.
6. WHEN the Tap_Source stops, THE Tap_Source SHALL remove all of its keyboard and pointer listeners and SHALL emit zero Events for any input received after the stop.
7. WHILE a text input element has focus, THE Tap_Source SHALL ignore the space bar, emit zero Events, and leave the default space bar behaviour of that element unchanged.
8. IF the Audio_Clock is unavailable when a space bar press or pointer press occurs, THEN THE Tap_Source SHALL discard the input, emit zero Events, and report a clock-unavailable Kit_Error to its consumer.
9. WHEN the space bar or pointer is released after a press, THE Tap_Source SHALL emit one Release_Event with the release Timestamp.
10. IF the page loses focus or the Tap_Source stops while a press is held, THEN THE Tap_Source SHALL emit the Release_Event at that moment.
11. WHILE one press is held, THE Tap_Source SHALL ignore presses from the other input and from additional pointers.
12. FOR ALL sequences of space bar key events (presses, auto-repeat presses and releases), in any hold state, THE Tap_Source SHALL emit space bar Onset_Events such that at least one space bar release occurs between any two consecutive space bar Onset_Events.

### Requirement 10: Matching

**User Story:** As an app developer, I want to score how well a reply copies a pattern regardless of speed or start time, so that a slow or late player still gets a fair score.

#### Acceptance Criteria

1. WHEN a target Pattern and a reply Pattern are supplied, THE Matcher SHALL return a Match_Score that is a finite number from 0 to 1 inclusive.
2. WHEN the reply Pattern equals the target Pattern, THE Matcher SHALL return a Match_Score of 1.
3. WHEN the reply Pattern is the target Pattern with every hit time shifted by the same offset of any finite value in milliseconds (positive, zero or negative), THE Matcher SHALL return the same Match_Score as for the unshifted reply.
4. WHEN the reply Pattern is the target Pattern with all intervals between consecutive hits multiplied by a constant factor greater than 0, THE Matcher SHALL return the same Match_Score as for the unscaled reply, within an absolute difference of 1e-9.
5. WHEN a reply is the target with one or more hits inserted or deleted, THE Matcher SHALL return a score strictly below 1, with missed and extra equal to the deleted and inserted counts.
6. IF either Pattern has fewer than 2 hits, THEN THE Matcher SHALL return a Match_Score of 1 when both Patterns have the same number of hits and 0 otherwise.
7. IF a Pattern contains hit times that are not in non-decreasing order or are not finite numbers, THEN THE Matcher SHALL return a Match_Score of 0 and SHALL NOT throw an error.
8. IF both Patterns have 2 or more hits and all hits in either Pattern share the same time, so that the total duration is 0 ms, THEN THE Matcher SHALL return a Match_Score of 1 when both Patterns have a total duration of 0 ms and the same number of hits, and 0 otherwise.
9. THE Matcher SHALL return the same Match_Score for the same inputs on every call, without reading the current time and without modifying either input Pattern.
10. WHEN the Matcher returns a Match_Score, THE Matcher SHALL also return the number of missed hits, the number of extra hits, the largest absolute interval error in milliseconds after normalising both Patterns to the same total duration with the index of that hit, and the tempo ratio of reply to target.
11. WHEN the Matcher returns a hit index with the largest absolute interval error, THE Matcher SHALL set the hit index to an integer from 0 to the number of hits in the target Pattern minus 1, so that the index references an actual hit of the target Pattern.
12. IF the target Pattern has at least one hit and either Pattern has fewer than 2 hits (criterion 6), so that no interval error exists, THEN THE Matcher SHALL return a largest absolute interval error of 0 ms with hit index 0.
13. WHEN the reply Pattern equals the target Pattern and the target Pattern has at least one hit, THE Matcher SHALL return a largest absolute interval error of 0 ms with hit index 0.
14. IF the target Pattern has no hits, THEN THE Matcher SHALL return no largest absolute interval error and no hit index.

### Requirement 11: Quantising

**User Story:** As an app developer, I want hits snapped to a beat grid, so that a clapped beat becomes a clean rhythm.

#### Acceptance Criteria

1. WHEN a Timestamp and a valid Beat_Grid are supplied, THE Quantiser SHALL return the grid position nearest to that Timestamp, where grid position k is at time origin + k × step, k is any integer (negative, zero or positive), and the Timestamp is in milliseconds on the Audio_Clock.
2. WHEN a Timestamp lies exactly halfway between two grid positions, THE Quantiser SHALL return the earlier grid position.
3. WHEN a Timestamp and a valid Beat_Grid are supplied, THE Quantiser SHALL return both the snapped Timestamp in milliseconds and the integer grid index.
4. WHEN quantise is applied to a snapped Timestamp using the same Beat_Grid, THE Quantiser SHALL return that same Timestamp and the same grid index (idempotence).
5. FOR ALL Timestamps and valid Beat_Grids, the absolute distance between the original Timestamp and the snapped Timestamp SHALL be at most half the grid step.
6. FOR ALL lists of Timestamps in non-decreasing order and any valid Beat_Grid, THE Quantiser SHALL return grid indices in non-decreasing order.
7. IF the Beat_Grid tempo is zero, negative, NaN or infinite, THEN THE Quantiser SHALL return an invalid-grid Kit_Error and no snapped Timestamp or grid index.
8. IF the Timestamp is NaN or infinite, THEN THE Quantiser SHALL return an invalid-timestamp Kit_Error and no snapped Timestamp or grid index.

### Requirement 12: Segmenting

**User Story:** As an app developer, I want hums and taps turned into timed marks, so that a sustained tone or a held tap becomes a Mark that my app can classify.

#### Acceptance Criteria

1. WHEN a sequence of Pitch_Events ordered by ascending Timestamp is supplied, THE Segmenter SHALL group consecutive Pitch_Events whose gap is less than or equal to the configured maximum gap (default 25 ms, range 5 to 500 ms) into one Mark per continuous tone.
2. WHEN the gap between two consecutive Pitch_Events exceeds the configured maximum gap in milliseconds (default 25 ms, range 5 to 500 ms), THE Segmenter SHALL end the current Mark and start a new Mark. The gap is the later Timestamp minus the earlier Timestamp, minus the configured Frame_Interval in milliseconds, which is required for Pitch_Event input (see criterion 13).
3. WHEN a tone has a duration of less than the configured minimum duration in milliseconds (default 30 ms, range 10 to 2,000 ms), THE Segmenter SHALL discard that tone and emit no Mark for it. A tone with a duration equal to the minimum duration is kept.
4. THE Segmenter SHALL set each Mark start Timestamp to the Timestamp of the first Pitch_Event in the tone and the Mark duration to the Timestamp of the last Pitch_Event minus the Timestamp of the first Pitch_Event plus the configured Frame_Interval, in milliseconds, where the Frame_Interval is required for Pitch_Event input (see criterion 13).
5. THE Segmenter SHALL return Marks in ascending start Timestamp order, with the end of each Mark (start plus duration) less than or equal to the start of the next Mark.
6. WHERE pitch splitting is enabled, WHEN the pitch difference between two consecutive Pitch_Events in a tone exceeds the configured pitch-change threshold in cents (default 100 cents, range 10 to 1,200 cents), THE Segmenter SHALL end the current Mark and start a new Mark at the later Pitch_Event.
7. WHERE pitch splitting is disabled, THE Segmenter SHALL NOT start a new Mark because of a pitch change.
8. FOR ALL Pitch_Event sequences, including an empty sequence and a single Pitch_Event, THE Segmenter SHALL return Marks whose durations are greater than 0 ms, and SHALL return an empty list for an empty sequence.
9. IF the supplied Pitch_Events are not in ascending Timestamp order, THEN THE Segmenter SHALL return an invalid-ordering Kit_Error and no Marks.
10. THE Segmenter SHALL keep a run of Pitch_Events as a Mark only if every frequency in the run lies within the configured steadiness tolerance (default 50 cents, range 5 to 200 cents) of the run's median frequency, and SHALL discard any other run.
11. THE Segmenter SHALL accept tap press and Release_Event pairs, and Sound_Start_Event and Sound_End_Event pairs (see Requirement 18), and return one Mark per pair, so that mic and tap input produce the same Marks.
12. WHEN a muted or gated span begins during a Mark, THE Segmenter SHALL end the Mark at the last Pitch_Event before it.
13. IF Pitch_Events are supplied and the Frame_Interval is missing or is not a positive finite number, THEN THE Segmenter SHALL return an invalid-config Kit_Error and no Marks.

### Requirement 13: Duration classification

**User Story:** As an app developer, I want durations assigned to classes relative to the player's own speed, so that fast and slow players both produce correct classes, such as dots and dashes, or Morse gaps of 1, 3 and 7 units.

#### Acceptance Criteria

1. WHEN a list of 1 to 1,000 durations and a Ratio_Set are supplied, THE Duration_Classifier SHALL return, for each duration in input order, a class index into the Ratio_Set and a Deviation (duration ÷ (unit × ratio)), plus the estimated unit in milliseconds.
2. THE Duration_Classifier SHALL assign each duration to the class whose nominal duration is nearest on a logarithmic scale, and a duration exactly at the geometric midpoint to the lower class.
3. WHEN every duration is multiplied by the same factor from 0.1 to 10, THE Duration_Classifier SHALL return the same class indices and Deviations within 0.001, and the unit multiplied by that factor within 0.1%.
4. WHEN the input order is changed, THE Duration_Classifier SHALL return the same class and Deviation for each duration.
5. WHEN durations are exact multiples of a unit by Ratio_Set entries, each perturbed by up to ±20%, and at least two classes occur, including class 0, THE Duration_Classifier SHALL return the unperturbed classes, where the Duration_Classifier returns the fit with the minimum error.
   5a. WHERE no valid prior unit is supplied, THE Duration_Classifier SHALL assign the shortest duration to class 0 and choose the minimum-error fit among units that do so.
6. WHERE a prior unit is supplied, WHEN class 0 is absent from the durations or fewer than two classes can be told apart, THE Duration_Classifier SHALL classify with the prior unit.
7. IF a duration is not a positive finite number, THEN THE Duration_Classifier SHALL return an invalid-duration Kit_Error.
8. IF the Ratio_Set is empty, does not start at 1 or is not strictly increasing, THEN THE Duration_Classifier SHALL return an invalid-ratios Kit_Error.
9. WHERE a prior unit is supplied, WHEN the Duration_Classifier classifies with the prior unit under criterion 6, THE Duration_Classifier SHALL use the prior unit exactly as supplied, without adjusting the prior unit from the observed durations.
10. WHERE a prior unit is supplied, WHEN the Duration_Classifier classifies with the prior unit under criterion 6, THE Duration_Classifier SHALL return the prior unit, unchanged, as the estimated unit.

### Requirement 14: Recording and replay

**User Story:** As a developer, I want to record Events and replay them, so that detector and app behaviour is testable without a microphone.

#### Acceptance Criteria

1. THE Core SHALL define a Recording as a format version (a positive integer) and an ordered list of Events.
2. THE Core SHALL provide a serialiser that converts a Recording to JSON text and a parser that converts JSON text to a Recording.
3. WHEN JSON text of a Recording with a supported format version is supplied, THE parser SHALL return the Recording.
4. IF the JSON text is not valid JSON, THEN THE parser SHALL return a malformed-json Kit_Error and SHALL NOT return a Recording.
5. IF the JSON text is valid JSON but its format version is not supported, THEN THE parser SHALL return an unsupported-version Kit_Error that identifies the unsupported version and SHALL NOT return a Recording.
6. IF the JSON text is valid JSON with a supported format version but lacks the list of Events or contains an entry that is not a valid Event, THEN THE parser SHALL return an invalid-recording Kit_Error that names the missing or invalid field and SHALL NOT return a Recording.
7. FOR ALL valid Recordings, parsing the serialised Recording SHALL produce a Recording deeply equal to the original (round-trip property).
8. FOR ALL valid Recordings, serialising a parsed serialisation SHALL produce text identical to the first serialisation.
9. THE Replay_Source SHALL implement the Event_Source interface.
10. WHEN the Replay_Source is advanced to a supplied time in milliseconds, THE Replay_Source SHALL emit every not-yet-emitted Event with a Timestamp less than or equal to that time, in ascending Timestamp order, and SHALL emit each Event exactly once.
11. IF the Replay_Source is advanced to a time earlier than a previous advance time, THEN THE Replay_Source SHALL emit no Events and SHALL leave its set of not-yet-emitted Events unchanged.
12. THE Replay_Source SHALL take the current time as a parameter of each advance call and SHALL NOT read any clock.
13. THE Core SHALL provide one framing function that splits samples into Frames, used by both the Worklet and the tests, so that a WAV fixture read in Node produces the same Frames as live capture.
14. THE Kit SHALL store no audio. Recordings SHALL hold Events only, and audio files SHALL exist only as Recorded_Fixtures used by tests.
15. THE Replay_Source SHALL emit each Event with the source it was recorded with.

### Requirement 15: Microphone availability and MicCheck

**User Story:** As an app developer, I want a ready-made component and a feature check, so that apps handle permission, level and calibration with little code.

#### Acceptance Criteria

1. THE Browser_Package SHALL export `canUseMic`, which returns a boolean that is true only if `navigator.mediaDevices.getUserMedia`, `AudioContext` and `AudioWorklet` are all defined and the page is in a secure context, and false otherwise.
2. IF `canUseMic` returns false, THEN THE MicCheck SHALL display a tap-mode control that activates Tap_Source mode, and SHALL NOT request microphone permission.
3. WHEN MicCheck is shown, THE MicCheck SHALL display the microphone permission state as one of "prompt", "granted" or "denied", the current input level as a value from 0 to 1, and the Calibration state as one of "uncalibrated", "calibrating", "calibrated" or "failed".
4. WHILE the microphone is capturing, THE MicCheck SHALL update the displayed input level at least 10 times per second.
5. WHEN the user activates the calibrate control, THE MicCheck SHALL start Calibration through the Calibrator and, on completion, display a success indication.
6. IF the Calibrator rejects with a Kit_Error, THEN THE MicCheck SHALL display an error indication that names the code of the Kit_Error, set the Calibration state to "failed", and keep any previously stored calibration unchanged.
7. IF the microphone permission state is "denied", THEN THE MicCheck SHALL display a denied indication, disable the calibrate control, and display the tap-mode control.
8. WHEN the user activates the tap-mode control, THE MicCheck SHALL switch the active Event_Source to the Tap_Source within 100 ms.
9. THE UI_Package SHALL provide React hooks that expose the current Event stream, the input level and the Calibration state of an Event_Source.
10. WHEN a component using a hook unmounts, THE hook SHALL unsubscribe from the Event_Source so that zero listeners from that hook remain registered and no further state updates occur.
11. THE MicCheck SHALL give every control an accessible name, make every control reachable with the Tab key, and activate a focused control with the Enter key or Space key.
12. THE UI_Package SHALL declare React as a peer dependency and SHALL NOT list React as a regular dependency.
13. THE MicCheck SHALL explain why the microphone is needed and SHALL request permission only after the user activates a control.
14. THE MicCheck SHALL give each state a stable data-testid, so that end-to-end tests can find it.

### Requirement 16: Package boundaries and tooling

**User Story:** As a maintainer, I want enforced package boundaries and a reproducible test setup, so that the kit stays portable and verified.

#### Acceptance Criteria

1. THE Core SHALL contain no import or re-export of any module from Browser_Package, UI_Package, React or DOM APIs, so that Core executes in both Node and the AudioWorklet.
2. THE Browser_Package SHALL contain no import or re-export of any module from UI_Package or React.
3. WHEN `npm run lint:deps` runs, THE Dependency_Rules SHALL exit with a non-zero status and report the offending file and import for each import that violates criterion 1 or 2.
4. WHEN `npm run lint:deps` runs and no import violates criterion 1 or 2, THE Dependency_Rules SHALL exit with status 0.
5. WHEN `npm run typecheck` runs, THE Kit SHALL compile with TypeScript strict mode, ES modules only and TypeScript 6.x, and report zero type errors across all workspaces.
6. THE Kit SHALL place all test files in the root `tests/` directory and SHALL import packages by name (for example `@earworm/core`) and never by relative path into `packages/`.
7. WHEN property-based tests run locally, THE test suite SHALL execute at least 100 runs per property.
8. WHILE the CI environment is detected, THE test suite SHALL execute at least 200 runs per property.
9. THE Kit SHALL contain no app-specific data (Morse table, story text, song format) under `packages/`.
10. WHEN `npm test` runs, THE test suite SHALL read every Recorded_Fixture WAV file in `fixtures/recorded`, split its samples into Frames with the Core framing function, run the Detectors on the Frames, and compare the emitted Events to the expected Events listed for that fixture in `fixtures/recorded/manifest.json`.
11. IF the Events emitted for a Recorded_Fixture differ from its expected Events in `manifest.json`, THEN THE test suite SHALL fail, identify the fixture by name and report the first differing Event.
12. IF `fixtures/recorded` contains no Recorded_Fixture WAV file or `manifest.json` lists no fixture, THEN THE test suite SHALL fail with an error indicating that no fixtures were found.
13. Core functions SHALL return `{ ok: true, value }` or `{ ok: false, error: Kit_Error }` and SHALL NOT throw. Browser_Package functions that can fail SHALL reject their Promise with a Kit_Error.
14. WHEN `npm test` runs, THE test suite SHALL fail if any file under `packages/` references MediaRecorder, fetch, XMLHttpRequest, WebSocket, sendBeacon, localStorage or indexedDB.
15. THE test suite SHALL list every export of each package and fail if an export present at the skeleton-v1 tag is removed or renamed, excluding exports whose name begins experimental\_, and every new option added after skeleton-v1 SHALL be optional with a default, so that existing callers keep working.
16. WHERE a configured value in the Default_Table is not supplied, THE Kit SHALL use the default in the Default_Table.
17. IF any configured value is outside its allowed range in the Default_Table, THEN THE Kit SHALL keep the previous value and return an invalid-config Kit_Error naming the setting.

### Requirement 17: Loudness envelope

**User Story:** As an app developer, I want a smooth loudness contour with separate rise and fall speeds, so that I can drive animations and meters that do not flicker.

#### Acceptance Criteria

1. WHEN a Frame is received, THE Envelope_Detector SHALL compute the Frame level in dBFS as defined in Requirement 5 criteria 1, 5 and 6, and SHALL update its smoothed level by moving toward the Frame level with the configured attack time constant when the Frame level is above the smoothed level, and with the configured release time constant otherwise, where the step is 1 − exp(−Δt ÷ time constant) of the difference and Δt is the Frame Timestamp minus the previous Frame Timestamp in milliseconds.
2. THE Envelope_Detector SHALL accept an attack time constant and a release time constant, each a finite number from 0 to 10,000 ms inclusive, where 0 means the smoothed level jumps to the Frame level, and SHALL default to 10 ms for attack and 300 ms for release.
3. IF an attack or release time constant is not a finite number from 0 to 10,000 ms, or the maximum rate is not from 1 to 100 Envelope_Events per second, THEN THE Envelope_Detector constructor SHALL return an invalid-config Kit_Error and no Detector.
4. THE Envelope_Detector SHALL start from a smoothed level of -120 dBFS after construction and after `reset()`.
5. THE Envelope_Detector SHALL emit Envelope_Events at a configured maximum rate of 1 to 100 Envelope_Events per second, and SHALL emit no more Envelope_Events than the configured rate in any 1000 ms window of the Audio_Clock, while still updating the smoothed level on every valid Frame.
6. WHEN the Envelope_Detector emits an Envelope_Event, THE Envelope_Detector SHALL timestamp it with the Frame Timestamp and set its level to the smoothed level in dBFS.
7. WHILE every sample of the input is 0, THE Envelope_Detector SHALL move the smoothed level toward -120 dBFS and SHALL never report a level below -120 dBFS.
8. IF a Frame is empty, contains any sample that is NaN or infinite, or has a Timestamp earlier than the previous Frame's Timestamp, THEN THE Envelope_Detector SHALL emit no Envelope_Event for that Frame and SHALL keep its smoothed level and rate-limit state unchanged.
9. FOR ALL Frame sequences with samples from -1 to 1 inclusive, THE Envelope_Detector SHALL report a level between -120 dBFS and 0 dBFS inclusive, and SHALL report a level that never exceeds the highest Frame level seen so far in the sequence.
10. WHEN a constant-amplitude sine tone with a Frame level from -60 to -3 dBFS is supplied with Frames of 128 to 1024 samples, THE Envelope_Detector SHALL report a level within 0.5 dB of the Frame level once 6 attack time constants have elapsed, for an attack time constant from 1 to 1,000 ms.
11. WHEN a level step up of D dB and a level step down of D dB (D from 6 to 60) are applied, and the attack time constant is smaller than the release time constant, THE Envelope_Detector SHALL cover half of the step upward in less time than it covers half of the step downward.
12. WHEN a Detector receives the same Frame sequence twice from a fresh state, THE Envelope_Detector SHALL emit identical Envelope_Events, including identical Timestamps and levels, both times.

### Requirement 18: Sound start and end

**User Story:** As an app developer, I want to know when a sound begins and when it ends, so that I can measure how long a hum, a spoken word or a held noise lasts, not just when it starts.

#### Acceptance Criteria

1. THE Sound_Detector SHALL measure the level of each Frame in dBFS as defined in Requirement 5 criteria 1, 5 and 6, and SHALL compare it with the Noise_Floor plus a configured start threshold from 3 to 60 dB (default 12 dB) and with the Noise_Floor plus a configured end threshold from 1 to 59 dB (default 6 dB).
2. IF the end threshold is not lower than the start threshold, or the start threshold, end threshold, Min_Hold or Hangover is outside its range, or any of them is not a finite number, THEN THE Sound_Detector constructor SHALL return an invalid-config Kit_Error and no Detector.
3. WHEN the Frame level has stayed above the start threshold for the configured Min_Hold from 0 to 200 ms inclusive (default 30 ms), THE Sound_Detector SHALL emit one Sound_Start_Event whose Timestamp is the Timestamp of the Frame at which Min_Hold elapsed, with a startTime field equal to the Timestamp of the first Frame above the start threshold.
4. WHEN a sound has started and the Frame level has stayed below the end threshold for the configured Hangover from 0 to 2,000 ms inclusive (default 100 ms), THE Sound_Detector SHALL emit one Sound_End_Event whose Timestamp is the Timestamp of the Frame at which Hangover elapsed, with an endTime field equal to the Timestamp of the first Frame of that run below the end threshold, and a duration equal to the endTime minus the startTime of the matching Sound_Start_Event.
5. WHILE a sound is open and the Frame level lies between the end threshold and the start threshold, THE Sound_Detector SHALL keep the sound open and emit no Event.
6. WHEN the Frame level rises back above the end threshold before the Hangover has elapsed, THE Sound_Detector SHALL keep the sound open and emit no Sound_End_Event.
7. IF the Frame level falls to or below the start threshold before the Min_Hold has elapsed, THEN THE Sound_Detector SHALL report no sound for that run and emit no Event.
8. FOR ALL Frame sequences, THE Sound_Detector SHALL emit Events that alternate strictly between Sound_Start_Event and Sound_End_Event, beginning with a Sound_Start_Event, so that two starts never occur in a row, two ends never occur in a row, and no end occurs without a preceding start.
9. FOR ALL Sound_End_Events, THE Sound_Detector SHALL set the duration (endTime minus the startTime of the matching Sound_Start_Event) to a finite number of at least the configured Min_Hold in milliseconds.
10. WHEN `flush()` is called on a Sound_Detector with an open sound, THE Sound_Detector SHALL return one Sound_End_Event whose Timestamp and endTime are the Timestamp of the last valid Frame it processed, and whose duration is that endTime minus the startTime of the matching Sound_Start_Event, and SHALL then hold no open sound. WHEN `flush()` is called with no open sound, THE Sound_Detector SHALL return no Events.
11. WHEN the Capture_Pipeline stops or the Replay_Source reaches the end of a Recording, THE Capture_Pipeline or the Replay_Source consumer SHALL call `flush()` on every Detector that has one, and SHALL deliver the returned Events before the stop completes.
12. WHEN `reset()` is called on a Sound_Detector, THE Sound_Detector SHALL discard any open sound and any pending run without emitting an Event, so that a caller that needs the closing Event calls `flush()` before `reset()`.
13. THE Sound_Detector SHALL report a sound whether its level rises quickly or slowly across the start threshold; the Sound_Detector depends on the level, while the Onset_Detector depends on the rate of rise.
14. IF a Frame is empty, contains any sample that is NaN or infinite, or has a Timestamp earlier than the previous Frame's Timestamp, THEN THE Sound_Detector SHALL emit no Event for that Frame and SHALL keep its state unchanged.
15. WHEN the Noise_Floor is stored, THE Sound_Detector SHALL use the stored Noise_Floor as the reference for both thresholds, as required by Requirement 6 criterion 2.
16. WHEN a Detector receives the same Frame sequence twice from a fresh state, THE Sound_Detector SHALL emit identical Events, including identical Timestamps, startTime and endTime values, levels and durations, both times.
17. FOR ALL generated tone bursts of 100 to 2,000 ms at −40 to −6 dBFS, separated by silence of at least Hangover plus 100 ms, over noise at least 20 dB below the burst level, supplied as Frames of 128 to 512 samples at a sample rate of 44,100 or 48,000 Hz, THE Sound_Detector SHALL emit exactly one Sound_Start_Event per burst whose startTime is within 15 ms of the true start and whose Timestamp is at least Min_Hold and less than Min_Hold plus the duration of one Frame after its startTime, and exactly one Sound_End_Event per burst whose endTime is within 30 ms of the true end and whose Timestamp is at least Hangover and less than Hangover plus the duration of one Frame after its endTime.
18. THE Sound_Detector SHALL meet the expected Events listed in `fixtures/recorded/manifest.json` for every Recorded_Fixture of sustained sounds, where each emitted Sound_Start_Event matches an expected start within 15 ms by its startTime, each emitted Sound_End_Event matches an expected end within 30 ms by its endTime, and no expected Event is left unmatched and no extra Event is emitted.
19. THE Sound_Detector SHALL emit no Event for the quiet-room and fan fixtures.
20. WHEN a sequence of Sound_Start_Event and Sound_End_Event pairs ordered by ascending Timestamp is supplied, THE Segmenter SHALL return one Mark per pair, with the Mark start equal to the startTime of the Sound_Start_Event and the Mark duration equal to the duration of the Sound_End_Event (its endTime minus the startTime of the Sound_Start_Event), in milliseconds.
21. THE Segmenter SHALL discard a Sound_End_Event that has no preceding unmatched Sound_Start_Event, and SHALL return no Mark for a Sound_Start_Event that has no Sound_End_Event, so that Events dropped by the Gate leave no partial Mark.
22. WHERE the configured minimum duration is set (default 30 ms, range 10 to 2,000 ms, as in Requirement 12 criterion 3), THE Segmenter SHALL discard a Sound pair whose duration is less than the minimum duration, and SHALL keep a pair whose duration equals the minimum, as in Requirement 12 criterion 3.
23. IF the supplied Sound_Start_Event and Sound_End_Event Events are not in ascending Timestamp order, or a Sound_End_Event has an endTime earlier than the startTime of its matching Sound_Start_Event, THEN THE Segmenter SHALL return an invalid-ordering Kit_Error and no Marks.
24. FOR ALL generated sequences of valid Sound pairs, THE Segmenter SHALL return Marks whose durations are greater than 0 ms, in ascending start Timestamp order, with each Mark end less than or equal to the next Mark start.

### Requirement 19: Spectrum

**User Story:** As an app developer, I want the frequency content of each Frame, so that I can draw a spectrum or build my own analysis.

#### Acceptance Criteria

1. THE Core SHALL provide a pure function `spectrum(samples, sampleRate, size, window)` that returns `{ ok: true, value }`, where the value is a Float32Array of length size ÷ 2 holding magnitudes in dBFS, or `{ ok: false, error }`, and SHALL NOT throw.
2. IF the size is not a power of two from 256 to 8192 inclusive, THEN THE Core SHALL return an invalid-fft-size Kit_Error and no magnitudes.
3. IF the sample rate is not a finite number from 8,000 to 192,000 Hz inclusive, THEN THE Core SHALL return an invalid-sample-rate Kit_Error and no magnitudes.
4. IF the window name is not hann, hamming, blackman or rectangular, THEN THE Core SHALL return an invalid-window Kit_Error and no magnitudes, and WHERE no window is supplied THE Core SHALL use hann.
5. IF the samples are empty or contain any sample that is NaN or infinite, THEN THE Core SHALL return an invalid-samples Kit_Error and no magnitudes.
6. THE Core SHALL compute the magnitude spectrum with a Fast Fourier Transform, so that bin k, for k from 0 to size ÷ 2 − 1, has the centre frequency k × sampleRate ÷ size Hz.
7. THE Core SHALL scale bin 0 by 1 ÷ Σw and every other bin by 2 ÷ Σw, where Σw is the sum of the window values, so that a sine of amplitude 1.0 whose frequency equals a bin centre frequency reads 0 dBFS within 0.5 dB at that bin for the hann window, and SHALL report −120 dBFS for any bin whose magnitude is below −120 dBFS and +6 dBFS for any bin whose magnitude is above +6 dBFS.
8. WHEN the number of samples supplied to the pure `spectrum` function in one buffer is less than the size, THE Core SHALL append zeros after the samples to reach the size, and WHEN the number of samples supplied in one buffer is greater than the size, THE Core SHALL use the most recent size samples (the last size samples of the buffer). This criterion applies to a single supplied buffer, and the Spectrum_Detector follows criterion 19.
9. WHILE every sample of the input is 0, THE Core SHALL return a spectrum in which every bin is exactly −120 dBFS.
10. WHEN a sine of amplitude 0.1 to 1.0 whose frequency lies at a bin centre from bin 2 to bin size ÷ 2 − 2 is supplied, THE Core SHALL return a spectrum whose highest bin is within one bin of the true bin.
11. FOR ALL Frames with samples from -1 to 1 inclusive, a Frame level at or above −50 dBFS and energy that lies below 0.9 × Nyquist, the sum of the linear power of all bins, scaled as stated in criterion 7 and normalised by the window power, SHALL equal the mean square of the windowed samples within a relative difference of 1e-3 (Parseval-style energy consistency).
12. FOR ALL Frames, THE Core SHALL return magnitudes that are finite numbers from -120 dBFS to +6 dBFS inclusive.
13. THE Core SHALL return the same magnitudes for the same inputs on every call, without reading the current time and without modifying the input samples.
14. THE Spectrum_Detector SHALL accept a sample rate, an FFT_Size, a Window_Function and a maximum rate of 1 to 100 Spectrum_Events per second, and IF any of them is outside its range, THEN THE Spectrum_Detector constructor SHALL return the Kit_Error of criteria 2 to 4, or an invalid-config Kit_Error for the maximum rate, and no Detector.
15. WHEN a Frame is received and the maximum rate allows it, THE Spectrum_Detector SHALL emit one Spectrum_Event with the Frame Timestamp, the sample rate, the FFT_Size and the magnitudes of criterion 1 computed from the Sample_History of criterion 19, and SHALL emit no more Spectrum_Events than the configured rate in any 1000 ms window of the Audio_Clock.
16. IF a Frame is empty, contains any sample that is NaN or infinite, or has a Timestamp earlier than the previous Frame's Timestamp, THEN THE Spectrum_Detector SHALL emit no Spectrum_Event for that Frame and SHALL keep its state, including its Sample_History, unchanged.
17. WHEN a Detector receives the same Frame sequence twice from a fresh state, THE Spectrum_Detector SHALL emit identical Spectrum_Events, including identical magnitudes, both times.
18. WHEN one Frame of 2048 samples is processed with an FFT_Size of 2048 and the hann window, THE Core SHALL complete the `spectrum` call in a median of at most 5 ms over 200 calls, measured in a test in Node after 20 warm-up calls on the CI runner used for `npm test`.
19. THE Spectrum_Detector and the Pitch_Detector SHALL keep the most recent FFT_Size (or pitch-window) samples across consecutive Frames, and SHALL analyse that history on each Frame, padding with zeros only until enough samples have arrived.
20. WHEN `reset()` is called on the Spectrum_Detector, THE Spectrum_Detector SHALL clear its Sample_History, and WHEN `flush()` is called on the Spectrum_Detector, THE Spectrum_Detector SHALL return no Events and SHALL leave its Sample_History unchanged.
21. THE Spectrum_Detector and the Band_Detector SHALL each hold at most FFT_Size samples in their Sample_History at all times, discarding the oldest samples as soon as each Frame is added, consistent with criterion 19.
22. THE test suite SHALL apply the 5 ms median bound of criterion 18 only to `spectrum` calls under valid conditions: an FFT_Size of 2048, the hann window, a sample rate that is valid under criterion 3, and 2048 samples that are all finite numbers.

### Requirement 20: Frequency bands

**User Story:** As an app developer, I want the energy in a few frequency ranges, so that I can tell a low thump from a high hiss without handling the full spectrum.

#### Acceptance Criteria

1. THE Core SHALL provide a pure function `bands(spectrum, sampleRate, size, window, bandList, unit)`, where the window is the Window_Function that produced the supplied spectrum, that returns `{ ok: true, value }`, where the value maps each Band name to a level, or `{ ok: false, error }`, and SHALL NOT throw.
2. IF a Band has a lowHz below 0, a highHz above the Nyquist, a lowHz not below its highHz, a lowHz or highHz that is not a finite number, or an empty or non-string name, THEN THE Core SHALL return an invalid-band Kit_Error that names the Band and no levels.
3. IF the Band list is empty, contains more than 32 Bands, or contains two Bands with the same name, THEN THE Core SHALL return an invalid-band Kit_Error and no levels.
4. WHERE two Bands overlap, THE Core SHALL accept both and compute each Band independently.
5. THE Core SHALL assign bin k to a Band when lowHz ≤ k × sampleRate ÷ size < highHz, and WHERE the highHz equals the Nyquist, THE Core SHALL also assign the bin at the Nyquist frequency when it exists.
6. THE Core SHALL compute the level of each Band in dBFS as 10 × log10 of the sum of the linear power of the Band's bins, divided by the power correction of the supplied window (the mean of the squared window values), so that, for each of hann, hamming, blackman and rectangular, the Band that covers 0 Hz to the Nyquist reads mean((x·w)²) ÷ mean(w²), the mean square of the windowed samples normalised by the window power as in Requirement 19 criterion 11, within a relative difference of 1e-3 for every Frame at or above −50 dBFS whose energy lies below 0.9 × Nyquist (a full-scale sine of amplitude 1.0 at least 3 bins from 0 Hz and from the Nyquist reads -3.01 dBFS within 0.5 dB), and SHALL report -120 dBFS for a Band that contains no bin and for any level below -120 dBFS.
7. WHERE the unit is normalised, THE Core SHALL return for each Band the value (level in dBFS + 120) ÷ 120, clamped to 0 to 1, and WHERE no unit is supplied THE Core SHALL use dbfs.
8. IF the unit is neither dbfs nor normalised, THEN THE Core SHALL return an invalid-unit Kit_Error and no levels.
9. IF the spectrum length is not size ÷ 2, or the size or sample rate is invalid as in Requirement 19 criteria 2 and 3, THEN THE Core SHALL return an invalid-spectrum Kit_Error and no levels.
10. THE Core SHALL provide a Band_Preset of three Bands as plain data: low (0 to 250 Hz), mid (250 to 2,000 Hz) and high (2,000 to 8,000 Hz), and SHALL contain no Band that belongs to one app.
11. IF a Band_Preset is used with a sample rate below 16,000 Hz, THEN THE Core SHALL return an invalid-band Kit_Error that names the high Band, as in criterion 2.
12. THE Band_Detector SHALL accept a sample rate, an FFT_Size, a Window_Function, a Band list, a unit and a maximum rate of 1 to 100 Band_Events per second, and IF any of them is invalid, THEN THE Band_Detector constructor SHALL return the matching Kit_Error of Requirement 19 criteria 2 to 4 or of criteria 2, 3, 8 and 21 above, or an invalid-config Kit_Error for the maximum rate, and no Detector.
13. WHEN a Frame is received and the maximum rate allows it, THE Band_Detector SHALL emit one Band_Event with the Frame Timestamp, the unit, and one value for each Band keyed by Band name, derived from the Spectrum of the Sample_History computed as in Requirement 19 criterion 19, passing its configured Window_Function (the same one the Spectrum computation uses) to `bands`, and SHALL emit no more Band_Events than the configured rate in any 1000 ms window of the Audio_Clock.
14. IF a Frame is empty, contains any sample that is NaN or infinite, or has a Timestamp earlier than the previous Frame's Timestamp, THEN THE Band_Detector SHALL emit no Band_Event for that Frame and SHALL keep its state unchanged.
15. WHEN a Detector receives the same Frame sequence twice from a fresh state, THE Band_Detector SHALL emit identical Band_Events, including identical values, both times.
16. WHILE every sample of the input is 0, THE Band_Detector SHALL report -120 dBFS (or 0 when normalised) for every Band.
17. WHEN a sine tone of amplitude 0.1 to 1.0 with a frequency inside exactly one of several non-overlapping Bands is supplied, THE Core SHALL report the highest level for that Band, provided that the frequency lies at least 2 bins from the Band edges.
18. FOR ALL Bands and Frames, WHEN a Band B2 lies inside a Band B1 (B1 lowHz ≤ B2 lowHz and B2 highHz ≤ B1 highHz), THE Core SHALL report for B1 a linear energy that is not less than the linear energy of B2.
19. WHEN white noise of at least 65,536 samples is processed as Frames of the FFT_Size, with an FFT_Size of 1024 and the hann window, THE Core SHALL report for each Band that is at least 1/16 of the Nyquist wide an average linear energy, over all Frames, within 25% relative difference of the Band's bandwidth ÷ Nyquist times the average linear energy of the full band.
20. WHEN one Frame of 2048 samples is processed with an FFT_Size of 2048, the hann window and the three Bands of the Band_Preset, THE Band_Detector SHALL complete `process` in a median of at most 6 ms over 200 calls, measured in a test in Node after 20 warm-up calls on the CI runner used for `npm test`.
21. IF the window name is not hann, hamming, blackman or rectangular, THEN THE Core SHALL return an invalid-window Kit_Error and no levels from `bands`, and WHERE no window is supplied THE Core SHALL use hann, consistent with Requirement 19 criterion 4.
22. WHEN `reset()` is called on a Band_Detector, THE Band_Detector SHALL clear its Sample_History, and WHEN `flush()` is called, THE Band_Detector SHALL return no Events and SHALL leave its Sample_History unchanged, as in Requirement 19 criterion 20.
23. THE test suite SHALL apply the 6 ms median bound of criterion 20 only to Band_Detector `process` calls under valid conditions: a valid FFT_Size of 2048, the hann window, the three Bands of the Band_Preset at a sample rate that is valid for the Band_Preset (criterion 11), and Frames of 2048 samples that are all finite numbers.

### Requirement 21: New Events in the Gate, Recording, fixtures and UI hooks

**User Story:** As an app developer, I want the envelope, sound, spectrum and band Events to behave like every other Event, so that I handle, record, replay and display them the same way.

#### Acceptance Criteria

1. THE Gate SHALL treat Envelope_Events, Sound_Start_Events, Sound_End_Events, Spectrum_Events and Band_Events under the rules of Requirement 8 criteria 3, 4 and 8, so that the Gate drops only those with source mic whose Timestamp lies inside a Gate_Window, including those emitted by the Replay_Source, and passes all others unchanged.
2. THE Capture_Pipeline SHALL set the source of every Envelope_Event, Sound_Start_Event, Sound_End_Event, Spectrum_Event and Band_Event it emits to mic, and the Replay_Source SHALL emit each Envelope_Event, Sound_Start_Event, Sound_End_Event, Spectrum_Event and Band_Event with the source it was recorded with.
3. WHERE a Calibration is available, THE Capture_Pipeline SHALL subtract the Latency from the Timestamp of every Envelope_Event, Sound_Start_Event, Sound_End_Event, Spectrum_Event and Band_Event, as required by Requirement 6 criterion 4, and SHALL subtract the Latency from the startTime of every Sound_Start_Event and the endTime of every Sound_End_Event, and SHALL leave the duration of a Sound_End_Event unchanged.
4. THE Core serialiser SHALL write a Spectrum_Event's magnitudes as a plain array of numbers, and a Band_Event's values as a plain object of numbers keyed by Band name, so that a Recording holds no typed array and no audio.
5. WHEN the Core parser reads a Spectrum_Event, THE Core parser SHALL restore the magnitudes as a Float32Array.
6. IF a Spectrum_Event in JSON text has magnitudes whose length is not its FFT_Size ÷ 2, or contains an entry that is not a finite number, or if a Sound_Start_Event has a startTime that is not finite or is later than its Timestamp, or if a Sound_End_Event has a duration that is negative or not finite or an endTime that is not finite or is later than its Timestamp, or a Band_Event lacks a value for a Band name or has a non-finite value, THEN THE Core parser SHALL return an invalid-recording Kit_Error that names the invalid field and SHALL NOT return a Recording.
7. FOR ALL valid Recordings that contain Envelope_Events, Sound_Start_Events, Sound_End_Events, Spectrum_Events and Band_Events, parsing the serialised Recording SHALL produce Events equal to the originals, where Float32 magnitudes are equal exactly, and every other number is equal within 1e-9 (round-trip property).
8. FOR ALL valid Recordings that contain the Events of criterion 7, serialising a parsed serialisation SHALL produce text identical to the first serialisation.
9. THE Replay_Source SHALL emit the Envelope_Events, Sound_Start_Events, Sound_End_Events, Spectrum_Events and Band_Events of a Recording under Requirement 14 criteria 10 to 12, without changing their fields.
10. THE Kit SHALL keep the type, source and data of Custom_Events unchanged in each of the new Detectors' consumers, and SHALL apply the Latency shift of Requirement 6 criterion 4 and the Gate of Requirement 8 to Custom_Events like any other Event, as required by Requirement 1 criterion 11.
11. WHEN `npm test` runs, THE test suite SHALL compare, for every Recorded_Fixture, the Envelope_Events, Sound_Start_Events, Sound_End_Events and Band_Events listed in `fixtures/recorded/manifest.json` with the emitted Events, where an envelope level matches within 1.0 dB, a band level matches within 1.5 dB, and sound startTime and endTime values match within the tolerances of Requirement 18 criterion 18.
12. WHEN `npm test` runs, THE test suite SHALL compare, for every Recorded_Fixture that lists an expected Spectrum_Event, the bin of the highest magnitude with the expected bin within one bin, and SHALL NOT store the magnitudes in `manifest.json`.
13. THE Detectors Envelope_Detector, Sound_Detector, Spectrum_Detector and Band_Detector SHALL NOT be part of the default Detector list of the Capture_Pipeline, which remains the Onset_Detector, the Pitch_Detector and the Level_Detector as required by Requirement 2 criterion 14.
14. THE UI_Package SHALL provide React hooks that expose the latest Envelope_Event level, the latest Spectrum_Event magnitudes and the latest Band_Event values of an Event_Source, each as `null` until the first matching Event arrives.
15. WHEN a component using one of these hooks unmounts, THE hook SHALL unsubscribe from the Event_Source as required by Requirement 15 criterion 10.
16. WHEN the Event_Source switches to the Tap_Source, THE hooks of criterion 14 SHALL keep their latest values and receive no new values, because the Tap_Source emits none of these Events.
