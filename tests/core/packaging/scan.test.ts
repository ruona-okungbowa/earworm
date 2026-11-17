import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

export interface ScanPattern {
  readonly name: string;
  readonly regex: RegExp;
}

const p = (regex: RegExp): ScanPattern => ({ name: regex.source, regex });

/** Banned everywhere under `packages/`. */
export const PRIVACY_PATTERNS: readonly ScanPattern[] = [
  /\bMediaRecorder\b/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsendBeacon\b/,
  /\blocalStorage\b/,
  /\bindexedDB\b/,
].map(p);

/** Banned under `packages/core/` only. Bare "window" stays allowed. */
export const CORE_PURITY_PATTERNS: readonly ScanPattern[] = [
  /\bDate\.now\b/,
  /\bperformance\.now\b/,
  /\.currentTime\b/,
  /\bwindow\./,
  /\bdocument\./,
  /globalThis\.window/,
  /globalThis\.document/,
].map(p);

/** App-specific markers, banned everywhere under `packages/`. Case-insensitive. */
export const APP_MARKER_PATTERNS: readonly ScanPattern[] = [
  /morse/i,
  /seance/i,
  /séance/i,
  /ditdah/i,
  /loophole/i,
].map(p);

const root = resolve(import.meta.dirname, "../../..");
const packagesDir = join(root, "packages");
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIPPED_DIR = /(?:^|[\\/])(?:node_modules|dist|coverage)(?:[\\/]|$)/;

const sourceFiles = (): string[] =>
  readdirSync(packagesDir, { recursive: true, encoding: "utf8" })
    .filter((f) => SOURCE_FILE.test(f) && !SKIPPED_DIR.test(f))
    .map((f) => join(packagesDir, f));

const scan = (
  files: readonly string[],
  patterns: readonly ScanPattern[],
): string[] => {
  const hits: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const { name, regex } of patterns) {
        if (regex.test(line)) {
          const path = relative(root, file).replaceAll("\\", "/");
          hits.push(`${path}:${i + 1} matches ${name}: ${line.trim()}`);
        }
      }
    });
  }
  return hits;
};

const matchesAny = (patterns: readonly ScanPattern[], text: string): boolean =>
  patterns.some(({ regex }) => regex.test(text));

describe("scan patterns", () => {
  const banned = [...PRIVACY_PATTERNS, ...CORE_PURITY_PATTERNS];

  it.each(["window.addEventListener('x', f)", "fetch(url)"])(
    "flags %s",
    (text) => {
      expect(matchesAny(banned, text)).toBe(true);
    },
  );

  it.each([
    "windowFunction",
    "hannWindow",
    "const window = hann(n)",
    "pitchWindow",
    "prefetchHint",
    "fetchedCount",
  ])("allows %s", (text) => {
    expect(matchesAny(banned, text)).toBe(false);
  });

  it("flags the other banned names", () => {
    for (const text of [
      "new MediaRecorder(s)",
      "new XMLHttpRequest()",
      "new WebSocket(u)",
      "navigator.sendBeacon(u)",
      "localStorage.getItem(k)",
      "indexedDB.open(n)",
      "Date.now()",
      "performance.now()",
      "ctx.currentTime",
      "document.body",
      "globalThis.window",
      "globalThis.document",
    ]) {
      expect(matchesAny(banned, text), text).toBe(true);
    }
    for (const text of ["Morse", "séance", "Seance", "ditdah", "Loophole"]) {
      expect(matchesAny(APP_MARKER_PATTERNS, text), text).toBe(true);
    }
  });
});

describe("packages source scan", () => {
  const files = sourceFiles();

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("has no privacy-sensitive APIs under packages/", () => {
    expect(scan(files, PRIVACY_PATTERNS)).toEqual([]);
  });

  it("has no clock reads or browser globals under packages/core/", () => {
    const core = files.filter((f) => f.startsWith(join(packagesDir, "core")));
    expect(scan(core, CORE_PURITY_PATTERNS)).toEqual([]);
  });

  it("has no app-specific markers under packages/", () => {
    expect(scan(files, APP_MARKER_PATTERNS)).toEqual([]);
  });
});
