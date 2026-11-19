# Requirements Document

## Introduction

Do As I Do is a short psychological-horror game in `apps/do-as-i-do`, built on the Earworm Kit (see the `earworm-kit` spec). The Player sits alone at a table in a dark room. A Presence beneath the table knocks. The Player knocks on a real surface (Microphone mode) or uses the space bar or screen taps (Tap mode). A Session is five Sittings played in order. Each Sitting changes the rule of the knocking and reveals one Answer. Together the five Answers tell the Presence's story: the 1848 Hydesville rappings and the "spiritual telegraph".

The five Sittings:

1. "It copies you": the Player knocks a rhythm and the Presence knocks the same rhythm back. Nothing is judged.
2. "It leads": the Presence knocks a pattern and the Player copies it. A Match_Score at or above the Pass_Threshold earns the Answer. Three Attempts, then a Refusal.
3. "One of those wasn't yours": the Player knocks, the Presence plays the rhythm back with one extra knock inserted, shows the text "One of those wasn't yours.", and the Player must knock the version with the extra knock. Three Attempts, then a Refusal.
4. "It answers": for 45,000 ms the Presence answers every accepted Player knock with one knock 400 to 1,200 ms later.
5. "Don't answer": the Presence asks the Player not to answer, plays 5 patterns, then leaves 20,000 ms of silence. Any accepted knock in the silence gives the "broke" Ending. No knock gives the "held" Ending.

The App imports `@earworm/core`, `@earworm/browser` and `@earworm/ui` by package name. The Story_Script, the Knock_Patterns, the Sitting_Config values and the Pass_Threshold are app-specific data and stay in the App. The App does not change the Kit. Every time value is in milliseconds on the Audio_Clock. Every App state machine takes the current time as a parameter. Every random choice takes an injected Random_Source, so each criterion can be tested with the Replay_Source, a fake clock and a seeded Random_Source.

Assumptions made without asking, for review:

- The Session has 5 Sittings, played in order 1 to 5 with no choice. The Dread_Level equals the number of Sittings completed.
- Sitting 5 reveals exactly one Answer, and that Answer is the Ending text (broke or held). The Story_Script stores two Ending texts for Sitting 5 and no separate Answer.
- The Sitting_Config values in the Glossary table are starting values and live in the Story_Script data.
- A Refusal is possible only in Sittings 2 and 3. Sittings 1, 4 and 5 cannot be refused. After a Refusal the Player returns to the start screen of the same Sitting and begins it again (a new Round).
- In Sitting 3 the Player's first knock is never judged. Only the copy of the Presence's reply is judged.
- A Player reply of fewer than 2 knocks in Sittings 1 and 3, or a Sitting 3 reply with no interval of at least 2 × Min_Gap, does not consume an Attempt. The Presence asks again and a new Listening_Window opens.
- Onsets during the Presence's pattern playback in Sitting 5 are ignored. Only Accepted_Onsets in the 20,000 ms silence decide the Ending.
- In Sitting 5 the first Accepted_Onset in the silence ends the Sitting at once with the "broke" Ending. The "held" Ending starts when the 20,000 ms have passed.
- The "broke" Ending text is placeholder-friendly: it works whatever sound ended the silence, for example "Something in the room answered.", and it never states or implies that the Player knocked (no knock, tap or rap words; Requirement 16 criterion 11). The "held" Ending text is free.
- The jump-scare toggle is on by default, is kept across a restart, and is not stored across page loads.
- The Pass_Threshold is 0.8. A Round allows 3 Attempts. The game has no saved progress.

Note on `Ungated_Playback`: the `earworm-kit` spec defines this term (the Synth plays a sound without notifying the Gate). The Glossary reuses that definition and adds an App-level obligation: Ungated_Playback sounds, such as ambient sound, pass through no Gate_Window, so the App itself must keep them from producing Onset_Events (Requirement 2).

Decided: Requirement 16 criterion 3 fixes the App dependencies (React, react-dom and the three Kit packages with the version "\*"). Build and test tooling comes from the workspace root and is not listed in the App `package.json`.

## Glossary

- **App**: The Do As I Do web app in `apps/do-as-i-do` (Vite + React).
- **Kit**: The Earworm packages `@earworm/core`, `@earworm/browser` and `@earworm/ui`, as defined in the `earworm-kit` spec.
- **Presence**: The unseen entity beneath the table. It exists only as sound, text and visual effects.
- **Player**: The person using the App.
- **Session**: One play-through from the title screen to the Ending or until the page is closed.
- **Sitting**: One of the 5 fixed stages of a Session, played in order 1 to 5. Each Sitting has a Sitting_Type and reveals one Answer.
- **Sitting_Type**: One of `copy` (Sitting 1), `lead` (Sitting 2), `spot` (Sitting 3), `answer` (Sitting 4) or `hold` (Sitting 5).
- **Sitting_Start_Screen**: The screen that shows the Sitting title and a begin-sitting control, before a Sitting or after a Refusal.
- **Answer**: The Story_Script text a Sitting reveals. Sittings 1 to 4 each have one Answer text. The Answer of Sitting 5 is the Ending text.
- **Ending**: The Story_Script text of Sitting 5, either "broke" or "held". The App reveals exactly one Ending per Session as the Answer of Sitting 5.
- **Story_Script**: The App data that holds the Sittings, the Answers, the Ending texts, the Presence lines, the Refusal lines, the Knock_Patterns, the Sudden_Sounds and the Sitting_Config.
- **Sitting_Config**: The numeric App settings in the Story_Script, listed in the table below.
- **Knock_Pattern**: An App-defined Pattern (Kit term) of 3 to 8 hits, with a total duration from 1,500 ms to 6,000 ms, stored in the Story_Script.
- **Round**: One run of Sitting 2 or Sitting 3 with up to 3 Attempts to copy the target Pattern.
- **Target_Pattern**: The Pattern the Player must copy in a Round. In Sitting 2 it is the Knock_Pattern of the Sitting. In Sitting 3 it is the Presence's reply including the extra knock.
- **Attempt**: One copy reply of the Player to the Target_Pattern in a Round, from the opening of a Listening_Window to its end.
- **Listening_Window**: The period in which the App collects the Player's Accepted_Onsets. It starts when the Gate_Window of the Presence's playback ends and ends 2,000 ms after the last Accepted_Onset, or 12,000 ms after the start if no Accepted_Onset arrives. In Sittings 1 and 3 it also ends at the Timestamp of the Accepted_Onset that is the Max_Reply_Hits-th one.
- **Accepted_Onset**: An Onset_Event whose source matches the Input_Mode (mic in Microphone mode, tap in Tap mode), that is not dropped by the Gate, that lies inside the counting period of the current step, and whose Timestamp is at least Onset_Debounce after the Timestamp of the previous Accepted_Onset of the same step.
- **Reply_Pattern**: The Pattern built from the Timestamps of the Accepted_Onsets of one Listening_Window, in ascending order.
- **Extra_Knock**: The one knock inserted into the Presence's reply in Sitting 3.
- **Random_Source**: An injected function that returns a number from 0 (inclusive) to 1 (exclusive). Tests supply a seeded one.
- **Pass_Threshold**: The minimum Match_Score for a successful Attempt. The value is in the Sitting_Config.
- **Input_Mode**: Either Microphone mode (Capture_Pipeline Events) or Tap mode (Tap_Source Events).
- **Dread_Level**: An integer from 0 to 5 equal to the number of Sittings completed in the Session. It drives the visual and audio intensity.
- **Answer log**: The list of revealed Answers of the Session, readable by the Player.
- **Caption**: On-screen text that describes a sound the Presence makes.
- **Content_Warning_Screen**: The title screen that shows the content warning, the start control and the Jump_Scare_Toggle.
- **Jump_Scare_Toggle**: A control on the Content_Warning_Screen with the values on and off, on by default.
- **Sudden_Sound**: A Synth sound listed in the Story_Script with a loud on-gain and a quiet off-gain.
- **Peak_Gain**: The highest Synth gain value scheduled for a sound within the first 100 ms of the sound's start.
- **Ambient_Sound**: The continuous Synth background sound of the scene, played with Ungated_Playback.
- **Manual_Device_Check**: A release check done by a person on a real device with a real microphone. No automated test replaces it.
- **Ungated_Playback**: As defined in the `earworm-kit` spec: playback that the caller requests so that the Synth does not notify the Gate. Because no Gate_Window covers it, the App must ensure it produces no Onset_Events (Requirement 2).
- **Kit_Error, Match_Score, Onset_Event, Onset_Detector, Frame, Synth, Voice, Gate, Gate_Window, Gate_Mode, Tap_Source, Calibrator, Calibration, MicCheck, canUseMic, Audio_Clock, Pattern, Matcher, Capture_Pipeline, Noise_Floor, Latency, Replay_Source, Recording, Timestamp**: As defined in the `earworm-kit` spec.

Sitting_Config values (stored in the Story_Script):

| Setting               | Value     | Valid range                  |
| --------------------- | --------- | ---------------------------- |
| Pass_Threshold        | 0.8       | 0 to 1                       |
| Attempts per Round    | 3         | 1 to 10                      |
| Onset_Debounce        | 100 ms    | 0 to 1,000 ms                |
| Min_Reply_Hits        | 2         | 2                            |
| Max_Reply_Hits        | 7         | 2 to 7                       |
| Copy_Delay            | 1,500 ms  | 500 to 5,000 ms              |
| Min_Gap               | 150 ms    | 100 to 1,000 ms              |
| Answering_Period      | 45,000 ms | 10,000 to 300,000 ms         |
| Answer_Delay_Min      | 400 ms    | 100 to Answer_Delay_Max      |
| Answer_Delay_Max      | 1,200 ms  | Answer_Delay_Min to 5,000 ms |
| Max_Pending_Answers   | 4         | 1 to 16                      |
| Hold_Pattern_Count    | 5         | 5                            |
| Pattern_Gap           | 1,500 ms  | 500 to 5,000 ms              |
| Silence_Duration      | 20,000 ms | 5,000 to 60,000 ms           |
| Quiet_Peak_Gain_Limit | 0.4       | 0 to 1                       |

## Requirements

### Requirement 1: Start and input setup

**User Story:** As a player, I want to start the game and set up my input, so that my knocks are heard correctly.

#### Acceptance Criteria

1. WHEN the App loads, THE App SHALL show the Content_Warning_Screen with a start control, SHALL create no AudioContext, SHALL produce no audio output, and SHALL make zero microphone permission requests.
2. WHEN the Player activates the start control, THE App SHALL create or resume the AudioContext and show the MicCheck within 500 ms.
3. IF `canUseMic` returns false, THEN THE App SHALL set the Input_Mode to Tap mode, SHALL make zero microphone permission requests, and SHALL show a message indicating that the microphone is unavailable and that the Player can knock with the space bar or by tapping the screen.
4. IF the microphone permission state is "denied", THEN THE App SHALL set the Input_Mode to Tap mode and show a message that the Player can knock with the space bar or by tapping the screen.
5. IF the AudioContext cannot be created or resumed, THEN THE App SHALL remain on the Content_Warning_Screen, SHALL show an error message indicating that audio could not start, and SHALL keep the start control enabled so the Player can retry.
6. WHEN the Player activates the tap-mode control of the MicCheck, THE App SHALL set the Input_Mode to Tap mode.
7. THE App SHALL enable the begin control if and only if (the Input_Mode is Tap mode) OR (the microphone permission state is "granted" AND (the Calibration state is "calibrated" OR the Player chose to skip calibration)).
8. WHERE the Player chose to skip calibration, THE App SHALL use the Kit default Noise_Floor of -60 dBFS for every Onset_Detector.
9. WHEN the Player activates the enabled begin control, THE App SHALL show the Sitting_Start_Screen of Sitting 1 with the Dread_Level at 0.
10. IF the Player activates the begin control while it is disabled, THEN THE App SHALL ignore the activation and keep the current screen.
11. WHILE the Player is on any screen after the MicCheck, THE App SHALL show the current Input_Mode (Microphone mode or Tap mode) as visible text.

### Requirement 2: Scene, atmosphere and ambient sound

**User Story:** As a player, I want a dark room with a table and a growing sense of dread, so that the game feels like a séance, and I want the background sound never to be mistaken for my knocks.

#### Acceptance Criteria

1. WHILE a Session is in progress, THE App SHALL render a dark room scene with a table and no visible Presence.
2. WHEN the Dread_Level changes, THE App SHALL apply the scene lighting settings and start the Ambient_Sound ramp to the settings defined for the new Dread_Level within 1,000 ms of the change.
3. WHEN the Presence knocks, THE App SHALL show a visual pulse at the table within 50 ms of the knock Timestamp, once per knock.
4. WHEN an Accepted_Onset arrives during a Listening_Window, THE App SHALL show one visual pulse at the table within 100 ms of the arrival of that Accepted_Onset.
5. WHERE the Player's system setting prefers reduced motion, THE App SHALL replace flicker and shake effects with static changes of brightness, and SHALL show no visual change that repeats faster than 3 times per second.
6. THE App SHALL produce all sounds with the Synth and SHALL ship no audio files.
7. THE App SHALL play the Ambient_Sound with Ungated_Playback.
8. THE Ambient_Sound SHALL change gain only through ramps of at least 1,000 ms and SHALL keep a gain of at most 0.15, at every Dread_Level, on every Dread_Level change, and on stop at the Ending.
9. THE Manual_Device_Check SHALL confirm, on a real device with a real microphone and for every Dread_Level from 0 to 5, that the Onset_Detector emits one Onset_Event within 12 ms of each real knock while the Ambient_Sound plays, with no extra Onset_Event and no Onset_Event from the Ambient_Sound alone. This check is manual and no automated test covers it.
10. WHEN the Presence plays a knock that is not an Ungated_Playback sound, THE App SHALL have the Synth notify the Gate, and THE App SHALL set the Gate_Mode to ignore-synth for the whole Session, so that mic Onset_Events inside the Gate_Window of a Presence knock are dropped.
11. IF the Synth fails to start or the audio context is unavailable, THEN THE App SHALL keep rendering the scene and visual pulses and SHALL show a message indicating that sound is unavailable.

### Requirement 3: Content warning and jump-scare toggle

**User Story:** As a player, I want to be warned about the content and to turn off sudden loud sounds, so that I can play comfortably.

#### Acceptance Criteria

1. WHEN the Content_Warning_Screen is displayed, THE App SHALL show a warning, before any Session can start, that the game contains flickering light, disturbing themes and sudden sounds.
2. THE App SHALL show the Jump_Scare_Toggle on the Content_Warning_Screen, on the same screen as the content warning, with the value on as its initial value on every page load.
3. THE App SHALL make the Jump_Scare_Toggle reachable with the Tab key, operable with Enter or Space, and give it an accessible name and a state (on or off) available to assistive technology.
4. THE App SHALL define each Sudden_Sound in the Story_Script with an on-gain from 0 to 1 and an off-gain from 0 to the Quiet_Peak_Gain_Limit.
5. WHERE the Jump_Scare_Toggle is on, THE App SHALL play each Sudden_Sound with its on-gain.
6. WHERE the Jump_Scare_Toggle is off, THE App SHALL play each Sudden_Sound with its off-gain.
7. WHERE the Jump_Scare_Toggle is off, THE App SHALL give every sound the Peak_Gain of at most the Quiet_Peak_Gain_Limit (default 0.4) in the Sitting_Config.
8. THE App SHALL give every sound that is not a Sudden_Sound a Peak_Gain of at most the Quiet_Peak_Gain_Limit, whatever the Jump_Scare_Toggle value and the Dread_Level.
9. WHEN the Player activates the restart control, THE App SHALL keep the Jump_Scare_Toggle at the value it had before the restart.
10. WHEN the Player changes the Jump_Scare_Toggle, THE App SHALL apply the new value to every sound that starts after the change.

### Requirement 4: Sitting progression

**User Story:** As a player, I want the Sittings to follow one after another, so that the story unfolds in a fixed order.

#### Acceptance Criteria

1. THE App SHALL play the Sittings in the order 1, 2, 3, 4, 5, and SHALL offer the Player no choice of Sitting.
2. THE App SHALL set the Dread_Level to the number of Sittings completed in the Session, from 0 to 5.
3. WHEN the Player activates the begin-sitting control of a Sitting_Start_Screen, THE App SHALL start that Sitting within 500 ms.
4. WHEN a Sitting is completed and the Answer is fully revealed or skipped and fewer than 5 Sittings are completed, THE App SHALL show the Sitting_Start_Screen of the next Sitting.
5. THE App SHALL show the Sitting_Start_Screen with the Sitting number, the Sitting title ("It copies you", "It leads", "One of those wasn't yours", "It answers" or "Don't answer") and the begin-sitting control.
6. WHILE a Sitting is in progress, THE App SHALL show the Sitting number and title as text.
7. THE App SHALL give the begin-sitting control an accessible name that includes the Sitting title, SHALL make the control reachable with the Tab key, and SHALL make the control activatable with the Enter key or the Space key.
8. IF the Player activates the begin-sitting control while a Sitting is in progress, THEN THE App SHALL ignore the activation and leave the Sitting unchanged.

### Requirement 5: Presence knock playback

**User Story:** As a player, I want to hear and see every knock the Presence makes, so that I can follow the rhythm.

#### Acceptance Criteria

1. WHEN the App plays a Presence Pattern, THE App SHALL play it through the Synth Voice knock at Audio_Clock Timestamps that preserve each interval of the Pattern to within 5 ms.
2. WHILE the Presence is playing a Pattern, THE App SHALL use the Kit Gate with the Gate_Mode ignore-synth, so that the App does not hear its own knocks as Player input.
3. WHEN the playback of a Presence Pattern ends, THE App SHALL open the next Listening_Window or counting period of the Sitting within 50 ms of the last knock's Audio_Clock Timestamp plus the knock duration, and SHALL show a visual cue that the Player may reply.
4. WHILE a Presence Pattern is playing, THE App SHALL show a Caption for each knock within 50 ms of that knock's Audio_Clock Timestamp.
5. IF a Presence Pattern cannot be played because the audio context is unavailable or suspended, THEN THE App SHALL keep the Sitting step not started, leave the Attempts used unchanged, and show a message indicating that audio could not start, with a control to retry.
6. WHEN the Player activates the replay control in a Round, THE App SHALL play the Target_Pattern again through the Presence playback of criterion 1, and keep the number of Attempts used unchanged.
7. IF the Player activates the replay control while a Presence Pattern is already playing, THEN THE App SHALL ignore the activation and leave the current playback and the Attempts used unchanged.
8. WHERE the Dread_Level is 3 or higher, THE App SHALL play the replay of the Target_Pattern with the same Timestamps (within 5 ms) and a different knock gain, with the Peak_Gain still at most the Quiet_Peak_Gain_Limit.
9. WHILE a Presence Pattern is playing, THE Gate SHALL drop every mic Onset_Event whose Timestamp lies inside a Gate_Window of a Presence knock, so that the Replay_Source, replaying mic Onset_Events at the knock Timestamps, yields zero Accepted_Onsets.

### Requirement 6: Capturing the reply

**User Story:** As a player, I want my knocks or taps captured accurately, so that I am judged on my rhythm and not on my equipment.

#### Acceptance Criteria

1. WHILE the Input_Mode is Microphone mode and a counting period or Listening_Window is open, THE App SHALL collect the Timestamps, in milliseconds on the Audio_Clock, of every Accepted_Onset with source mic from the Capture_Pipeline.
2. WHILE the Input_Mode is Tap mode and a counting period or Listening_Window is open, THE App SHALL collect the Timestamps, in milliseconds on the Audio_Clock, of every Accepted_Onset with source tap from the Tap_Source.
3. WHILE the Input_Mode is Microphone mode, THE App SHALL ignore Onset_Events with source tap.
4. WHILE the Input_Mode is Tap mode, THE App SHALL ignore Onset_Events with source mic.
5. WHEN a Listening_Window of Sitting 2 or Sitting 3 (copy step) ends and at least one Accepted_Onset was collected, THE App SHALL build the Reply_Pattern and submit it to the Matcher with the Target_Pattern as target exactly once.
6. WHILE no counting period and no Listening_Window is open, THE App SHALL discard every Onset_Event received and add none of them to any Reply_Pattern.
7. IF a Listening_Window of Sitting 2 or Sitting 3 (copy step) ends with no Accepted_Onset collected, THEN THE App SHALL NOT submit a Reply_Pattern to the Matcher, SHALL count the Attempt as unsuccessful, and SHALL show the Presence line for silence from the Story_Script.
8. IF the Capture_Pipeline or the Tap_Source returns a Kit_Error during Sitting 1, 2 or 3, THEN THE App SHALL pause the Sitting, close any open Listening_Window, discard the Timestamps collected for the current step, show the Kit_Error code and a control to switch to Tap mode or retry, and SHALL NOT count an Attempt.
9. IF the Capture_Pipeline or the Tap_Source returns a Kit_Error during Sitting 4 or Sitting 5, THEN THE App SHALL stop the Sitting, discard every pending Presence answer and every collected Timestamp, show the Kit_Error code and a control to switch to Tap mode or retry.
10. WHEN the Player retries after a Kit_Error in Sitting 4 or Sitting 5, THE App SHALL restart that Sitting from its Sitting_Start_Screen with a new Answering_Period or Silence_Duration.
11. WHEN the Player switches the Input_Mode during a Sitting, THE App SHALL discard the Timestamps collected for the current Listening_Window, keep the number of Attempts used unchanged, and collect Onset_Events only from the new Input_Mode's source from that moment on.
12. WHEN an Onset_Event arrives less than Onset_Debounce after the previous Accepted_Onset of the same step, THE App SHALL discard that Onset_Event.

### Requirement 7: Sitting 1, "It copies you"

**User Story:** As a player, I want the Presence to copy my knocks, so that I learn it is listening.

#### Acceptance Criteria

1. WHEN Sitting 1 starts, THE App SHALL open a Listening_Window within 500 ms and show a visual cue that the Player may knock.
2. WHEN the Listening_Window of Sitting 1 ends with at least Min_Reply_Hits Accepted_Onsets, THE App SHALL build the Reply_Pattern from them.
3. WHEN the Reply_Pattern is built in Sitting 1, THE App SHALL play it back as a Presence Pattern whose first knock has the Timestamp (end of the Listening_Window plus Copy_Delay), and whose intervals each equal the corresponding Reply_Pattern interval to within 5 ms.
4. THE App SHALL play in Sitting 1 as many Presence knocks as the Reply_Pattern has hits.
5. WHEN the Listening_Window of Sitting 1 reaches the Max_Reply_Hits-th Accepted_Onset, THE App SHALL end the Listening_Window at the Timestamp of that Accepted_Onset and ignore every later Onset_Event until the Presence playback ends.
6. IF the Listening_Window of Sitting 1 ends with fewer than Min_Reply_Hits Accepted_Onsets, THEN THE App SHALL play no copy, show the Presence line for "again" from the Story_Script, discard the collected Timestamps, and open a new Listening_Window within 500 ms.
7. THE App SHALL send the Sitting 1 Reply_Pattern to no Matcher and show no success or failure judgement.
8. WHEN the Presence playback of Sitting 1 ends, THE App SHALL start revealing the Answer of Sitting 1 within 500 ms.
9. THE App SHALL give Sitting 1 no Refusal and no Attempt limit.

### Requirement 8: Sitting 2, "It leads"

**User Story:** As a player, I want to copy a rhythm the Presence leads, so that I earn what it tells me.

#### Acceptance Criteria

1. WHEN Sitting 2 starts, THE App SHALL begin a Round, set the Attempts used to 0, and play the Knock_Pattern of Sitting 2 as the Target_Pattern through the Presence playback of Requirement 5.
2. WHEN the Presence playback ends, THE App SHALL open a Listening_Window of the first Attempt through Requirement 5 criterion 3.
3. WHEN an Attempt is marked successful, THE App SHALL end the Round and start revealing the Answer of Sitting 2 through Requirement 12.
4. WHEN an Attempt is marked unsuccessful and fewer than the Attempts per Round have been used, THE App SHALL show one Presence line chosen by the judgement of Requirement 10 criterion 5, replay the Target_Pattern, and open the Listening_Window of the next Attempt after the replay.
5. WHEN the Attempts per Round (default 3) have been used and the last Attempt is unsuccessful, THE App SHALL end the Round with a Refusal (Requirement 13).

### Requirement 9: Sitting 3, "One of those wasn't yours"

**User Story:** As a player, I want to notice the knock that is not mine, so that I earn what the Presence tells me.

#### Acceptance Criteria

1. WHEN Sitting 3 starts, THE App SHALL open a Listening_Window within 500 ms for the Player's first knock (listen step) and show a visual cue that the Player may knock.
2. WHEN the Listening_Window of the listen step ends with at least Min_Reply_Hits Accepted_Onsets, THE App SHALL build the Player_Pattern from them.
3. WHEN the Listening_Window of the listen step reaches the Max_Reply_Hits-th Accepted_Onset, THE App SHALL end the Listening_Window at the Timestamp of that Accepted_Onset, so that the Player_Pattern has between 2 and 7 hits.
4. IF the Listening_Window of the listen step ends with fewer than Min_Reply_Hits Accepted_Onsets, THEN THE App SHALL play no reply, show the Presence line for "again" from the Story_Script, discard the collected Timestamps, open a new Listening_Window within 500 ms, and leave the Attempts used at 0.
5. THE App SHALL take every random choice of Sitting 3 from the injected Random_Source, and SHALL read no other random function.
6. WHEN a Player_Pattern with n hits is built, THE App SHALL list as eligible every interval between two neighbouring hits whose length is at least 2 × Min_Gap (default 300 ms).
7. IF no interval of the Player_Pattern is eligible, THEN THE App SHALL play no reply, show the Presence line for "slower" from the Story_Script, discard the collected Timestamps, open a new Listening_Window within 500 ms, and leave the Attempts used at 0.
8. WHEN at least one interval is eligible, THE App SHALL choose one eligible interval with the index floor(r1 × the count of eligible intervals) and set the Extra_Knock offset, in milliseconds after the first hit of that interval, to Min_Gap + floor(r2 × (the interval length − 2 × Min_Gap + 1)), where r1 and r2 are the first and second values drawn from the Random_Source for the Round.
9. THE App SHALL place the Extra_Knock strictly between the first hit and the last hit of the Player_Pattern, at least Min_Gap after the previous hit and at least Min_Gap before the next hit.
10. THE App SHALL draw r1 and r2 exactly once per Round, and SHALL keep the Extra_Knock position unchanged for every replay and every Attempt of the Round.
11. WHEN the Extra_Knock position is set, THE App SHALL build the Target_Pattern as the Player_Pattern with the Extra_Knock added, so that the Target_Pattern has n + 1 hits and the Target_Pattern is the judge target of the Round.
12. WHEN the Target_Pattern is built, THE App SHALL play it as a Presence Pattern whose first knock has the Timestamp (end of the Listening_Window plus Copy_Delay), with the intervals preserved to within 5 ms.
13. WHEN the Presence playback of the Target_Pattern ends, THE App SHALL show the text "One of those wasn't yours." and open the Listening_Window of the first Attempt, both within 50 ms of the last knock's Audio_Clock Timestamp plus the knock duration.
14. WHEN an Attempt is marked successful, THE App SHALL end the Round and start revealing the Answer of Sitting 3 through Requirement 12.
15. WHEN an Attempt is marked unsuccessful and fewer than the Attempts per Round have been used, THE App SHALL show one Presence line chosen by the judgement of Requirement 10 criterion 5, replay the Target_Pattern with the Extra_Knock, and open the Listening_Window of the next Attempt after the replay.
16. WHEN the Attempts per Round (default 3) have been used and the last Attempt is unsuccessful, THE App SHALL end the Round with a Refusal (Requirement 13).
17. WHEN a new Round of Sitting 3 starts after a Refusal, THE App SHALL discard the earlier Player_Pattern, Target_Pattern and Extra_Knock, and begin with a new listen step and new Random_Source draws.

### Requirement 10: Judging the copy

**User Story:** As a player, I want to be judged on rhythm and not on speed or start time, so that a calm and a hurried player get a fair result.

#### Acceptance Criteria

1. WHEN the Matcher returns a Match_Score greater than or equal to the Pass_Threshold, THE App SHALL mark the Attempt successful.
2. WHEN the Matcher returns a Match_Score less than the Pass_Threshold, THE App SHALL mark the Attempt unsuccessful.
3. THE App SHALL take the Pass_Threshold from the Story_Script data, and the value SHALL be a number from 0 to 1 inclusive.
4. IF the Story_Script data has a missing Pass_Threshold, or one that is not a number from 0 to 1 inclusive, THEN THE App SHALL refuse to start the Round, show an error indicating the Story_Script is invalid, and keep the Round state unchanged.
5. WHEN an Attempt is marked unsuccessful, THE App SHALL select the Presence line from the Story_Script by the Matcher result (Reply_Pattern has more hits than the Target_Pattern, fewer hits than the Target_Pattern, or equal hit count with timing off).
6. WHEN the Reply_Pattern equals the Target_Pattern with all hit times shifted by any offset from 0 ms to 60,000 ms, or with all inter-hit intervals multiplied by one factor from 0.5 to 2.0 inclusive, THE App SHALL mark the Attempt successful.
7. IF the Reply_Pattern has fewer than 2 hits and the Target_Pattern has 2 or more hits, THEN THE App SHALL mark the Attempt unsuccessful, regardless of the Match_Score.
8. IF a Sitting 3 Reply_Pattern has a hit count different from the hit count of the Target_Pattern, THEN THE App SHALL mark the Attempt unsuccessful, regardless of the Match_Score.
9. THE App SHALL return the same judgement for the same Target_Pattern, the same Reply_Pattern and the same Pass_Threshold, without reading the current time.

### Requirement 11: Sittings 4 and 5

**User Story:** As a player, I want the last two Sittings to turn the rules around, so that the story ends with a choice.

#### Acceptance Criteria

1. WHEN the Presence's introduction line of Sitting 4 has finished showing, THE App SHALL set the Sitting 4 start Timestamp T0 to the Audio_Clock time of that moment and open the Answering_Period from T0 (inclusive) to T0 + Answering_Period (exclusive), where the Answering_Period is 45,000 ms.
2. WHILE the Answering_Period of Sitting 4 is open, THE App SHALL treat an Onset_Event as an Accepted_Onset only if its Timestamp is at least Onset_Debounce after the previous Accepted_Onset and fewer than Max_Pending_Answers Presence answers are pending.
3. WHEN an Accepted_Onset arrives in Sitting 4 at Timestamp t, THE App SHALL draw one value r from the injected Random_Source, compute the delay D as Answer_Delay_Min + floor(r × (Answer_Delay_Max − Answer_Delay_Min + 1)), and schedule exactly one Presence knock at t + D, so that D is an integer from 400 to 1,200 ms.
4. WHEN a Presence answer knock is scheduled in Sitting 4, THE App SHALL count it as pending from the Accepted_Onset until the knock ends.
5. WHILE a Presence answer knock of Sitting 4 plays, THE Gate SHALL drop every mic Onset_Event inside its Gate_Window, so that no Presence answer knock leads to an Accepted_Onset, a further answer or a feedback loop.
6. WHEN the Replay_Source replays mic Onset_Events at the Timestamps of every Presence answer knock of Sitting 4, THE App SHALL schedule zero further answers.
7. WHEN the Audio_Clock reaches T0 + Answering_Period, THE App SHALL stop treating Onset_Events as Accepted_Onsets and schedule no further Presence answer.
8. WHEN the Audio_Clock has reached T0 + Answering_Period and no Presence answer is pending, THE App SHALL start revealing the Answer of Sitting 4 within 500 ms of the later of T0 + Answering_Period and the end of the last answer knock.
9. IF no Accepted_Onset arrives during the Answering_Period of Sitting 4, THEN THE App SHALL still reveal the Answer of Sitting 4 at T0 + Answering_Period within 500 ms.
10. WHEN the Presence's introduction line of Sitting 5 ("Don't answer") has finished showing, THE App SHALL play Hold_Pattern_Count (5) distinct Knock_Patterns from the Story_Script in the listed order, as Presence Patterns, each separated from the previous by Pattern_Gap (default 1,500 ms) measured from the previous Pattern's last knock end to the next Pattern's first knock.
11. WHILE the Presence plays a Pattern in Sitting 5, THE App SHALL ignore every Onset_Event, and the Gate SHALL drop every mic Onset_Event inside the Gate_Window of a Presence knock.
12. WHEN the last knock of the 5th Pattern of Sitting 5 ends, THE App SHALL set Silence_Start to the Audio_Clock Timestamp of that last knock plus its knock duration, and open the silence period from Silence_Start (inclusive) to Silence_Start + Silence_Duration (exclusive), where Silence_Duration is 20,000 ms.
13. WHILE the silence period of Sitting 5 is open, THE App SHALL treat an Onset_Event as an Accepted_Onset if its source matches the Input_Mode (mic in Microphone mode or tap in Tap mode) and the Gate has not dropped the Onset_Event.
14. WHEN the first Accepted_Onset arrives in the silence period of Sitting 5, THE App SHALL select the "broke" Ending and start revealing it as the Answer of Sitting 5 within 500 ms of that Accepted_Onset.
15. WHEN the Audio_Clock reaches Silence_Start + Silence_Duration and no Accepted_Onset has arrived, THE App SHALL select the "held" Ending and start revealing it as the Answer of Sitting 5 within 500 ms.
16. THE App SHALL give Sittings 1, 4 and 5 no Refusal and no Attempt limit.
17. WHEN the App reveals the "broke" Ending, THE App SHALL show the "broke" Ending text from the Story_Script, which satisfies Requirement 16 criterion 11 (no word that states or implies that the Player knocked).

### Requirement 12: Answers

**User Story:** As a player, I want each Sitting to reveal a true answer, so that the story is revealed step by step.

#### Acceptance Criteria

1. WHEN a Sitting is completed, THE App SHALL start showing the Answer of that Sitting within the time limit of the Sitting (Requirement 7 criterion 8, Requirement 8 criterion 3, Requirement 9 criterion 14, Requirement 11 criteria 8, 9, 14 and 15), and SHALL mark the Sitting as completed at the same time.
2. WHEN a Sitting is marked as completed, THE App SHALL increase the Dread_Level by 1, and SHALL increase it only once per Sitting.
3. THE App SHALL show each Answer as text, revealed one character at a time at a rate of 20 to 40 characters per second, so that a 100-character Answer finishes revealing in 2.5 to 5 seconds.
4. WHEN the Player activates the skip control while an Answer is being revealed, THE App SHALL show the full Answer within 100 ms.
5. WHEN an Answer has finished revealing or has been skipped, THE App SHALL add the full Answer text to the Answer log, and SHALL keep it in the log, readable by the Player, until the Session ends.
6. THE App SHALL give each of the 5 Sittings exactly one Answer, and the 5 Answers together SHALL tell the story of the Presence (the 1848 Hydesville rappings and the "spiritual telegraph": who it was, how it came to be there and what it wants), in an order fixed in the Story_Script.
7. THE App SHALL treat the Ending text revealed in Sitting 5 as the Answer of Sitting 5, and SHALL add exactly one Ending text (broke or held) to the Answer log in a Session.
8. IF an Attempt in Sitting 2 or Sitting 3 is not successful, THEN THE App SHALL NOT show an Answer, SHALL NOT mark the Sitting as completed, and SHALL NOT change the Dread_Level or the Answer log.

### Requirement 13: Refusal

**User Story:** As a player, I want failure to be unsettling but not final, so that I can retry without losing the Session.

#### Acceptance Criteria

1. IF the last Attempt of a Round in Sitting 2 or Sitting 3 is unsuccessful, THEN THE App SHALL end the Round, display exactly one Presence Refusal line selected from the Story_Script, and not display the Answer at any point during the Refusal.
2. WHEN a Round ends with a Refusal, THE App SHALL show the Sitting_Start_Screen of the same Sitting within 3,000 ms of the Presence Refusal line first being displayed, with the begin-sitting control enabled.
3. WHEN a Round ends with a Refusal, THE App SHALL keep the Dread_Level at the exact value it had when the Round started.
4. WHEN a Round ends with a Refusal, THE App SHALL keep all previously completed Sittings, their Answers and the Answer log unchanged.
5. WHEN a Round ends with a Refusal, THE App SHALL play one Synth refusal sound whose waveform, pitch or both differ from the Synth success sound, and SHALL play the success sound zero times in that Round.
6. WHEN the Player activates the begin-sitting control after a Refusal, THE App SHALL start a new Round of the same Sitting with 3 remaining Attempts, no Attempt results carried over, and the Presence playback of the Target_Pattern in Sitting 2 or a new listen step in Sitting 3.
7. WHILE a Round of Sitting 2 is in progress after a Refusal, THE App SHALL make the replay control available.
8. IF the Synth cannot play the refusal sound, THEN THE App SHALL still end the Round, display the Presence Refusal line and show the Sitting_Start_Screen.

### Requirement 14: Ending and restart

**User Story:** As a player, I want a conclusion and the option to play again, so that the game feels complete.

#### Acceptance Criteria

1. WHEN the Answer of Sitting 5 (the Ending) has been fully revealed or skipped, THE App SHALL show the final scene with the restart control, and SHALL NOT show the restart control before the Ending is fully revealed or skipped.
2. WHEN the final scene is shown, THE App SHALL stop all Ambient_Sound within 3,000 ms, and no Ambient_Sound SHALL be audible 3,000 ms after the final scene is shown.
3. WHEN the final scene is shown, THE App SHALL show a restart control that is reachable by keyboard and has an accessible name.
4. WHEN the Player activates the restart control, THE App SHALL reset the Session so that 0 Sittings are completed, the Dread_Level is 0, the Answer log contains 0 entries and the next Sitting is Sitting 1, and SHALL return to the Content_Warning_Screen.
5. WHEN the Player activates the restart control, THE App SHALL keep the stored Calibration unchanged, so that its values after the restart are identical to its values before the restart.
6. IF the Player reloads the page at any point, THEN THE App SHALL start with a new Session (0 Sittings completed, Dread_Level 0, empty Answer log) and SHALL NOT restore any Session progress from a previous page load.
7. THE App SHALL store no Session progress between page loads.

### Requirement 15: Accessibility and play without sound

**User Story:** As a player with a quiet room, no microphone or a hearing or motor impairment, I want to complete the game another way, so that I am not locked out.

#### Acceptance Criteria

1. WHERE the Player chooses Tap mode (space bar or screen taps) instead of the microphone, THE App SHALL allow the Player to complete a Session from the Content_Warning_Screen to the Ending without microphone permission and without any microphone input.
2. THE App SHALL make every interactive control reachable and operable with the keyboard alone, using Tab, Shift+Tab, Enter and Space, with no keyboard trap.
3. WHILE a control has keyboard focus, THE App SHALL display a visible focus indicator on that control with a contrast ratio of at least 3:1 against adjacent colours, in every Dread_Level.
4. WHEN a Presence sound that carries meaning plays (a knock, the success sound, the Refusal sound or a Sudden_Sound), THE App SHALL display a text equivalent that names the sound within 200 ms of the sound starting, and keep it visible for at least 3 seconds.
5. IF the audio output is muted or unavailable, THEN THE App SHALL still display the text equivalent for each Presence sound that carries meaning, and the Session SHALL remain completable.
6. THE App SHALL keep the contrast ratio of all text against its background at or above 4.5:1 in every Dread_Level.
7. WHERE the Player's system setting prefers reduced motion, THE App SHALL apply Requirement 2 criterion 5.
8. WHEN the Presence asks the Player not to answer in Sitting 5, THE App SHALL show the request as text.
9. WHILE the silence period of Sitting 5 is open, THE App SHALL show a text that tells the Player to stay silent, without a visible countdown number.

### Requirement 16: Story data, Sitting_Config and package boundaries

**User Story:** As a maintainer, I want the story, patterns and Sitting settings kept in one validated place in the app and the app kept within the Kit rules, so that the tests and the game read the same values and the Kit stays reusable.

#### Acceptance Criteria

1. THE App SHALL keep the Story_Script, the Knock_Patterns, the Sitting_Config and the Pass_Threshold in `apps/do-as-i-do` and SHALL NOT place any of them in `packages/`.
2. THE App SHALL import the Kit only by the package names `@earworm/core`, `@earworm/browser` and `@earworm/ui`, and SHALL NOT import the Kit by relative path into `packages/`.
3. THE App SHALL list React and react-dom as dependencies, and `@earworm/core`, `@earworm/browser` and `@earworm/ui` with the version "\*", in its `package.json`, and SHALL list no other dependency, because build and test tooling (Vite, `@vitejs/plugin-react`, TypeScript, Vitest, fast-check, dependency-cruiser) comes from the workspace root `package.json` and is not listed in the App `package.json`.
4. WHEN `npm run lint:deps` runs, THE App SHALL produce zero dependency-cruiser violations and exit with code 0.
5. WHEN `npm run typecheck` runs, THE App SHALL produce zero TypeScript errors in strict mode and exit with code 0.
6. THE App SHALL contain the Story_Script as a validated data structure with exactly 5 Sittings numbered 1 to 5 in order, each with a defined Sitting_Type (`copy`, `lead`, `spot`, `answer`, `hold` for Sittings 1 to 5).
7. THE Story_Script SHALL give each of Sittings 1 to 4 exactly one Answer, and SHALL give Sitting 5 exactly two Ending texts, one with the key "broke" and one with the key "held", and no other Answer.
8. THE Story_Script SHALL give Sitting 2 exactly one Knock_Pattern, Sitting 5 exactly Hold_Pattern_Count Knock_Patterns, and Sittings 1, 3 and 4 no Knock_Pattern.
9. THE Story_Script SHALL give every Knock_Pattern 3 to 8 hits and a total duration from 1,500 ms to 6,000 ms, and SHALL keep all of its Knock_Patterns distinct, where two Knock_Patterns are distinct if their knock counts differ or any interval differs by more than 5 ms.
10. THE Story_Script SHALL give every Sudden_Sound an on-gain from 0 to 1 and an off-gain from 0 to the Quiet_Peak_Gain_Limit, and SHALL give every other sound a gain of at most the Quiet_Peak_Gain_Limit, and every Ambient_Sound setting a gain of at most 0.15.
11. THE Story_Script SHALL give the "broke" Ending text no occurrence of the words knock, knocked, tap, tapped, rap or rapped (case-insensitive, whole words), so that the text does not state or imply that the Player knocked, and the text makes sense when the sound that ended the silence was not a knock.
12. IF a Story_Script entry violates criteria 6 to 11, THEN THE App's test suite SHALL fail, and the failure message SHALL name the Sitting number (or the Sudden_Sound) and state which rule it breaks (wrong Sitting count, missing or wrong Sitting_Type, missing Answer, more than one Answer, missing or extra Ending, "broke" Ending text with a forbidden word, missing Knock_Pattern, extra Knock_Pattern, Knock_Pattern limit exceeded, duplicate Knock_Pattern, or gain limit exceeded).
13. IF the Story_Script contains zero Sittings or two Sittings with the same number, THEN THE App's test suite SHALL fail with a message stating that the Story_Script is empty or naming the duplicated number.
14. THE App SHALL read every Sitting_Config value from the Story_Script data.
15. IF a Sitting_Config value is missing or outside its valid range in the Glossary table, THEN THE App SHALL refuse to start the Session, show an error indicating the Story_Script is invalid, and name the setting.
16. THE App SHALL take the time of every Sitting state transition as a parameter.

### Requirement 17: Verification

**User Story:** As a maintainer, I want the game tested without a microphone, so that every Sitting is reliable in CI.

#### Acceptance Criteria

1. WHEN `npm test` runs, THE test suite SHALL replay a Recording of a Player pattern of 2 to 7 hits through the Replay_Source in Sitting 1 with a fake clock, and verify that the App plays a Presence Pattern with the same intervals (within 5 ms), starting at the end of the Listening_Window plus Copy_Delay, and then reveals the Answer.
2. WHEN `npm test` runs, THE test suite SHALL replay a Recording of the Knock_Pattern of Sitting 2 through the Replay_Source, with every hit at its exact recorded time, and verify that the App marks the Attempt successful.
3. WHEN `npm test` runs, THE test suite SHALL replay a Recording of the Knock_Pattern of Sitting 2 with exactly one hit removed, and verify that the App marks the Attempt unsuccessful, leaves the Dread_Level unchanged and does not end the Round.
4. FOR ALL Player_Patterns with 2 to 7 hits that have at least one eligible interval, and FOR ALL seeded Random_Source values, THE Sitting 3 builder SHALL produce a Target_Pattern with n + 1 hits in which the Extra_Knock lies strictly between the first and last hit, at least Min_Gap from each neighbouring hit, and the Target_Pattern with the Extra_Knock removed equals the Player_Pattern, with at least 100 runs locally and at least 200 runs in CI.
5. WHEN `npm test` runs, THE test suite SHALL verify that Sitting 3 with a Player_Pattern of fewer than 2 hits, or with no eligible interval, plays no reply, shows the "again" or "slower" line and consumes no Attempt.
6. WHEN `npm test` runs, THE test suite SHALL verify that a Sitting 3 Reply_Pattern equal to the Player_Pattern (without the Extra_Knock) is marked unsuccessful, and that a Reply_Pattern equal to the Target_Pattern is marked successful.
7. FOR ALL generated Target_Patterns that satisfy the Knock_Pattern limits, a reply equal to the Target_Pattern shifted by any offset and scaled by any factor from 0.5 to 2 (inclusive) SHALL be marked successful by the App's judge, with at least 100 runs locally and at least 200 runs in CI.
8. WHEN `npm test` runs, THE test suite SHALL verify with a fake clock that a Round of Sitting 2 with 3 unsuccessful Attempts, and a Round of Sitting 3 with 3 unsuccessful Attempts, each end in a Refusal, leave the Dread_Level at its value before the Round, and return to the Sitting_Start_Screen of the same Sitting.
9. WHEN `npm test` runs, THE test suite SHALL verify with a fake clock and a seeded Random_Source that Sitting 4 schedules exactly one answer knock per Accepted_Onset, each 400 to 1,200 ms after it, accepts no Onset_Event closer than Onset_Debounce to the previous one, accepts none when Max_Pending_Answers answers are pending, accepts none at or after T0 + 45,000 ms, and reveals the Answer after 45,000 ms with zero Onset_Events.
10. WHEN `npm test` runs, THE test suite SHALL verify that replaying mic Onset_Events at every Presence knock Timestamp of Sittings 1, 3, 4 and 5 through the Replay_Source and the Gate yields zero Accepted_Onsets.
11. WHEN `npm test` runs, THE test suite SHALL verify with a fake clock that Sitting 5 ignores Onset_Events during the 5 Patterns, selects "broke" for an Accepted_Onset at Silence_Start, and for one at Silence_Start + 19,999 ms, and selects "held" for none until Silence_Start + 20,000 ms, in Microphone mode and in Tap mode.
12. WHEN `npm test` runs, THE test suite SHALL verify that completing Sittings 1 to 5 in order shows the Ending and the Dread_Level 5, and that restart resets the Session to its initial state (0 Sittings completed, Dread_Level 0, no Round in progress, empty Answer log).
13. WHEN `npm test` runs, THE test suite SHALL verify the begin-control rule of Requirement 1 criterion 7 for all combinations of Input_Mode, permission state, Calibration state and skip choice.
14. WHEN `npm test` runs with the Jump_Scare_Toggle off, THE test suite SHALL verify with a fake Synth that the Peak_Gain of every sound scheduled in a full Session is at most the Quiet_Peak_Gain_Limit.
15. WHEN `npm test` runs with the Jump_Scare_Toggle on, THE test suite SHALL verify with a fake Synth that each Sudden_Sound is scheduled with its on-gain.
16. WHEN `npm test` runs, THE test suite SHALL verify Requirement 2 criterion 8 with a fake Synth that records the scheduled gain events of the Ambient_Sound, at every Dread_Level from 0 to 5, on every Dread_Level change, and on stop at the Ending, and SHALL fail if any recorded gain change ramps over less than 1,000 ms or any recorded gain value is above 0.15.
17. THE Manual_Device_Check SHALL cover Requirement 2 criterion 9 on a real device, and no automated test run by `npm test` covers it, because the automated tests use a fake Synth and the Replay_Source and mix no Ambient_Sound with a real knock on a real microphone.
18. THE tests SHALL import the Kit by package name (`@earworm/core`, `@earworm/browser`, `@earworm/ui`), never via relative paths into `packages/`, and SHALL live in `tests/` at the repository root.
19. THE judge, the Sitting state machines, the Sitting 3 builder, the Sitting 4 scheduler and the Story_Script validator SHALL take time as a parameter and the Random_Source as an injected argument, and SHALL NOT read `Date.now`, `performance.now`, `AudioContext.currentTime` or `Math.random`.
20. IF a test run needs a microphone or an AudioContext, THEN THE test suite SHALL use the Replay_Source in its place and SHALL NOT fail because no audio device is present.
