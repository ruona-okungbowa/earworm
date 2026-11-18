// Feature: earworm-kit, Property 34: Sound and tap pairs become Marks
// **Validates: Requirements 12.11, 18.20, 18.21, 18.22, 18.23, 18.24**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { segment } from "@earworm/core";
import type {
  Mark,
  OnsetEvent,
  ReleaseEvent,
  SoundEndEvent,
  SoundStartEvent,
} from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

function soundStart(t: number): SoundStartEvent {
  return {
    type: "sound-start",
    timestamp: t,
    source: "mic",
    startTime: t,
    level: -20,
  };
}
function soundEnd(t: number, duration: number): SoundEndEvent {
  return {
    type: "sound-end",
    timestamp: t,
    source: "mic",
    endTime: t,
    duration,
  };
}
function press(t: number): OnsetEvent {
  return { type: "onset", timestamp: t, source: "tap", strength: 1 };
}
function release(t: number): ReleaseEvent {
  return { type: "release", timestamp: t, source: "tap" };
}

interface PairSpec {
  gap: number;
  duration: number;
  orphanEnd: boolean;
  orphanStart: boolean;
}

const pairSpec = fc.record({
  gap: fc.integer({ min: 1, max: 200 }),
  duration: fc.integer({ min: 1, max: 150 }),
  orphanEnd: fc.boolean(),
  orphanStart: fc.boolean(),
});
const pairs = fc.array(pairSpec, { minLength: 0, maxLength: 15 });
const scenario = fc.record({
  t0: fc.integer({ min: 0, max: 10_000 }),
  pairs,
  trailingStart: fc.boolean(),
  minDuration: fc.integer({ min: 10, max: 100 }), // valid range is 10..2000
});

type Kind = "sound" | "tap";

function build(
  kind: Kind,
  t0: number,
  specs: PairSpec[],
  trailingStart: boolean,
) {
  const events: Array<
    SoundStartEvent | SoundEndEvent | OnsetEvent | ReleaseEvent
  > = [];
  const expected: Mark[] = [];
  let t = t0;
  const start = (x: number) =>
    events.push(kind === "sound" ? soundStart(x) : press(x));
  const end = (x: number, d: number) =>
    events.push(kind === "sound" ? soundEnd(x, d) : release(x));
  for (const s of specs) {
    if (s.orphanEnd) {
      end(t, 7); // no open start: dropped
      t += s.gap;
    }
    if (s.orphanStart) {
      start(t);
      if (kind === "sound") {
        // The next start replaces this unmatched one.
        t += s.gap;
      } else {
        // A repeated press while one is open is ignored; the first press starts the Mark.
        start(t + s.gap);
        end(t + s.gap + s.duration, s.duration);
        expected.push({ start: t, duration: s.gap + s.duration });
        t += s.gap + s.duration + s.gap;
        continue;
      }
    }
    start(t);
    end(t + s.duration, s.duration);
    expected.push({ start: t, duration: s.duration });
    t += s.duration + s.gap;
  }
  if (trailingStart) start(t);
  return { events, expected };
}

describe("Property 34: Sound and tap pairs become Marks", () => {
  for (const kind of ["sound", "tap"] as const) {
    it(`${kind}: one Mark per complete pair, short pairs dropped, orphans ignored, ascending without overlap`, () => {
      fc.assert(
        fc.property(
          scenario,
          ({ t0, pairs: specs, trailingStart, minDuration }) => {
            const { events, expected } = build(kind, t0, specs, trailingStart);
            const want = expected.filter((m) => m.duration >= minDuration);
            const result = segment(
              { kind, events } as Parameters<typeof segment>[0],
              { minDuration },
            );
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value).toEqual(want);
            for (let i = 0; i < result.value.length; i++) {
              const m = result.value[i] as Mark;
              expect(m.duration).toBeGreaterThan(0);
              const next = result.value[i + 1];
              if (next)
                expect(m.start + m.duration).toBeLessThanOrEqual(next.start);
            }
          },
        ),
        pbtParams(),
      );
    });

    it(`${kind}: a pair exactly at minDuration is kept, one below is dropped`, () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10_000 }),
          fc.integer({ min: 10, max: 200 }),
          (t0, min) => {
            const mk = (d: number) =>
              build(
                kind,
                t0,
                [{ gap: 1, duration: d, orphanEnd: false, orphanStart: false }],
                false,
              ).events;
            const at = segment(
              { kind, events: mk(min) } as Parameters<typeof segment>[0],
              { minDuration: min },
            );
            const below = segment(
              { kind, events: mk(min - 1) } as Parameters<typeof segment>[0],
              { minDuration: min },
            );
            expect(at.ok && at.value).toEqual([{ start: t0, duration: min }]);
            expect(below.ok && below.value).toEqual([]);
          },
        ),
        pbtParams(),
      );
    });

    it(`${kind}: out-of-order events give invalid-ordering and no Marks`, () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10_000 }),
          fc.integer({ min: 1, max: 200 }),
          fc.integer({ min: 1, max: 200 }),
          (t0, d, gap) => {
            const { events } = build(
              kind,
              t0,
              [{ gap, duration: d, orphanEnd: false, orphanStart: false }],
              false,
            );
            const reversed = [...events].reverse();
            const result = segment({ kind, events: reversed } as Parameters<
              typeof segment
            >[0]);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe("invalid-ordering");
          },
        ),
        pbtParams(),
      );
    });
  }

  it("sound: endTime before startTime gives invalid-ordering", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10_000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (t0, later, before) => {
          const end: SoundEndEvent = {
            type: "sound-end",
            timestamp: t0 + later,
            source: "mic",
            endTime: t0 - before,
            duration: later + before,
          };
          const result = segment({
            kind: "sound",
            events: [soundStart(t0), end],
          });
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.code).toBe("invalid-ordering");
        },
      ),
      pbtParams(),
    );
  });
});
