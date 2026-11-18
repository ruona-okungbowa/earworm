import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareEvents,
  describeMismatch,
  FIXTURE_DIR,
  firstTimeDifference,
  isPending,
  loadManifest,
} from "../../helpers/fixtures";
import type { FixtureEntry } from "../../helpers/fixtures";

// Requirements 16.10, 16.12.

const temps: string[] = [];

function tempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "earworm-fixtures-"));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ONE_FIXTURE = JSON.stringify({
  fixtures: [
    { name: "a", file: "a.wav", kind: "onset", expected: { onsets: [] } },
  ],
});

describe("fixture manifest", () => {
  it("fails with a no-fixtures-found error when the directory has no WAV file", () => {
    const dir = tempDir({ "manifest.json": ONE_FIXTURE });
    expect(() => loadManifest(dir)).toThrow(/no fixtures found/);
  });

  it("fails with a no-fixtures-found error when the directory does not exist", () => {
    expect(() =>
      loadManifest(join(tmpdir(), "earworm-missing-dir-xyz")),
    ).toThrow(/no fixtures found/);
  });

  it("fails with a no-fixtures-found error when the manifest lists no fixture", () => {
    const dir = tempDir({
      "a.wav": "x",
      "manifest.json": JSON.stringify({ fixtures: [] }),
    });
    expect(() => loadManifest(dir)).toThrow(/no fixtures found/);
  });

  it("fails with a no-fixtures-found error when manifest.json is missing", () => {
    const dir = tempDir({ "a.wav": "x" });
    expect(() => loadManifest(dir)).toThrow(/no fixtures found/);
  });

  it("keeps a manifest whose every fixture is pending, and flags pending entries", () => {
    const dir = tempDir({
      "a.wav": "x",
      "manifest.json": JSON.stringify({
        fixtures: [
          {
            name: "a",
            file: "a.wav",
            kind: "onset",
            expected: {},
            pending: "re-record",
          },
        ],
      }),
    });
    const manifest = loadManifest(dir);
    expect(manifest.fixtures).toHaveLength(1);
    expect(manifest.fixtures[0]?.pending).toBe("re-record");
    expect(isPending(manifest.fixtures[0] as FixtureEntry)).toBe(true);
    const { pending: _pending, ...withoutPending } = manifest
      .fixtures[0] as FixtureEntry;
    expect(isPending(withoutPending)).toBe(false);
  });

  it("marks quiet-room and door as pending re-record in the recorded manifest", () => {
    const pending = loadManifest()
      .fixtures.filter(isPending)
      .map((f) => f.name)
      .sort();
    expect(pending).toEqual(["door", "quiet-room"]);
  });

  it("loads the recorded fixtures, each with its WAV file present", () => {
    const manifest = loadManifest();
    expect(manifest.fixtures.length).toBeGreaterThan(0);
    const wavs = new Set(
      readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".wav")),
    );
    for (const f of manifest.fixtures) {
      expect(f.name, "fixture name").toBeTruthy();
      expect(wavs.has(f.file), `${f.name}: ${f.file} exists`).toBe(true);
    }
    const names = manifest.fixtures.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("fixture comparison", () => {
  it("accepts times within tolerance and reports the first differing Event otherwise", () => {
    expect(firstTimeDifference("onset", [100, 500], [105, 490], 12)).toBeNull();
    expect(firstTimeDifference("onset", [100, 500], [100], 12)).toMatch(
      /unmatched.*500/,
    );
    expect(firstTimeDifference("onset", [100], [100, 300], 12)).toMatch(
      /extra.*300/,
    );
    expect(firstTimeDifference("onset", [100], [120], 12)).toMatch(
      /unmatched.*100/,
    );
  });

  it("names the fixture in the failure text", () => {
    const mismatch = compareEvents(
      {
        name: "knock-x",
        file: "k.wav",
        kind: "onset",
        expected: { onsets: [{ t: 10 }] },
      },
      [],
    );
    expect(mismatch).not.toBeNull();
    expect(describeMismatch(mismatch!)).toMatch(
      /^Fixture "knock-x": onset unmatched/,
    );
  });
});
