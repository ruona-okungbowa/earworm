import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as browser from "@earworm/browser";
import * as core from "@earworm/core";
import * as framing from "@earworm/core/framing";
import * as ui from "@earworm/ui";

const root = resolve(import.meta.dirname, "../../..");
const TAG = "skeleton-v1";
const BASELINE_PATH = "tests/helpers/api-baseline.json";

type Baseline = Record<string, string[]>;

const runtime: Record<string, object> = {
  "@earworm/core": core,
  "@earworm/core/framing": framing,
  "@earworm/browser": browser,
  "@earworm/ui": ui,
};

function tagExists(): boolean {
  try {
    execFileSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${TAG}`], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** The baseline as committed at the tag once it exists, else the working-tree file. */
function loadBaseline(): { source: string; baseline: Baseline } {
  if (tagExists()) {
    const text = execFileSync("git", ["show", `${TAG}:${BASELINE_PATH}`], {
      cwd: root,
      encoding: "utf8",
    });
    return { source: TAG, baseline: JSON.parse(text) as Baseline };
  }
  const text = readFileSync(resolve(root, BASELINE_PATH), "utf8");
  return { source: BASELINE_PATH, baseline: JSON.parse(text) as Baseline };
}

const { source, baseline } = loadBaseline();

describe(`Req 16.15: API surface against ${source}`, () => {
  it("still provides every baseline entry point", () => {
    const missing = Object.keys(baseline).filter((pkg) => !(pkg in runtime));
    expect(missing).toEqual([]);
  });

  for (const [pkg, mod] of Object.entries(runtime)) {
    it(`${pkg} still exports every baseline name`, () => {
      // Type-only exports are invisible here; only runtime values are checked.
      const exported = new Set(Object.keys(mod));
      const missing = (baseline[pkg] ?? [])
        .filter((name) => !name.startsWith("experimental_"))
        .filter((name) => !exported.has(name));
      expect(missing).toEqual([]);
    });
  }
});
