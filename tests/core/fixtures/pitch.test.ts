import { describe, expect, it } from "vitest";
import {
  describeMismatch,
  fixtureTest,
  loadManifest,
  runFixture,
} from "../../helpers/fixtures";

// Requirements 4.8, 16.11.

const pitched = loadManifest().fixtures.filter((f) =>
  /^(hum|whistle)/.test(f.name),
);

describe("recorded pitch fixtures", () => {
  it("lists at least one hum and one whistle fixture", () => {
    expect(pitched.some((f) => f.name.startsWith("hum"))).toBe(true);
    expect(pitched.some((f) => f.name.startsWith("whistle"))).toBe(true);
  });

  for (const entry of pitched) {
    fixtureTest(
      entry,
      `${entry.name} matches its expected Pitch_Events`,
      () => {
        expect(
          entry.expected.pitches?.length,
          `${entry.name} lists pitches`,
        ).toBeGreaterThan(0);
        const report = runFixture(entry);
        expect(
          report.mismatch ? describeMismatch(report.mismatch) : null,
        ).toBeNull();
      },
    );
  }
});
