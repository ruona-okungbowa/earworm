import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type DepField = (typeof DEP_FIELDS)[number];
type Manifest = Partial<Record<DepField, Record<string, string>>>;

function readManifest(dir: string): Manifest {
  const text = readFileSync(join(root, "packages", dir, "package.json"), "utf8");
  return JSON.parse(text) as Manifest;
}

/** Names of `@earworm/*` packages listed in one field of a manifest. */
function earwormIn(manifest: Manifest, field: DepField): string[] {
  return Object.keys(manifest[field] ?? {}).filter((name) => name.startsWith("@earworm/"));
}

describe("package.json manifests", () => {
  it("Req 16.2: @earworm/ui lists react in peerDependencies and not in dependencies", () => {
    const ui = readManifest("ui");
    expect(Object.keys(ui.peerDependencies ?? {})).toContain("react");
    expect(Object.keys(ui.dependencies ?? {})).not.toContain("react");
  });

  it("Req 15.12: @earworm/core lists no @earworm/* package in any dependency field", () => {
    const core = readManifest("core");
    for (const field of DEP_FIELDS) {
      expect(earwormIn(core, field), field).toEqual([]);
    }
  });

  it("Req 16.1: @earworm/browser depends only on @earworm/core among @earworm/* packages", () => {
    const browser = readManifest("browser");
    expect(earwormIn(browser, "dependencies")).toEqual(["@earworm/core"]);
    for (const field of DEP_FIELDS) {
      if (field === "dependencies") continue;
      expect(earwormIn(browser, field).filter((n) => n !== "@earworm/core"), field).toEqual([]);
    }
  });
});
