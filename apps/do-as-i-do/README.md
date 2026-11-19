# Do As I Do

Séance horror app. The user knocks on their desk and the Presence answers.

## Manual device check (Requirements 2.9, 17.17)

No automated test runs this check. Do it before each release, on a real device with a real microphone.

Design note: the Ambient_Sound keeps gain at 0.15 or less, changes gain only through ramps of at least 1,000 ms, and has no transients. This helps it stay below the Onset_Detector, but only this check confirms it.

For each Dread_Level from 0 to 5:

1. Reach that Dread_Level and let the Ambient_Sound play.
2. Stay silent for 10 s. Confirm no Onset_Event appears from the Ambient_Sound alone.
3. Knock on the desk at least 10 times, spaced at least 500 ms apart. Confirm exactly one Onset_Event within 12 ms of each real knock, and no extra Onset_Event.

| Dread_Level | Silent: no Onset_Event | Each knock: one Onset_Event within 12 ms | No extra Onset_Event |
| --- | --- | --- | --- |
| 0 | [ ] | [ ] | [ ] |
| 1 | [ ] | [ ] | [ ] |
| 2 | [ ] | [ ] | [ ] |
| 3 | [ ] | [ ] | [ ] |
| 4 | [ ] | [ ] | [ ] |
| 5 | [ ] | [ ] | [ ] |

### Record

| Device | Browser | Date | Result (pass / fail) | Notes |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
