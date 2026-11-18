import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

/** Requirements 2.12: the Worklet ships as its own self-contained chunk under Vite. */
const fixtureRoot = fileURLToPath(
  new URL("../../helpers/vite-app/", import.meta.url),
);

describe("Vite build of the Worklet", () => {
  let outDir = "";
  let buildError: unknown;
  let assets: string[] = [];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "earworm-vite-"));
    try {
      await build({
        root: fixtureRoot,
        configFile: false,
        logLevel: "silent",
        build: { outDir, emptyOutDir: true },
      });
    } catch (e) {
      buildError = e;
    }
    assets = await readdir(join(outDir, "assets")).catch(() => []);
  }, 120_000);

  afterAll(async () => {
    if (outDir !== "") await rm(outDir, { recursive: true, force: true });
  });

  it("builds with zero errors", () => {
    expect(buildError).toBeUndefined();
  });

  it("emits a hashed Worklet .js asset with framing code and no core imports", async () => {
    const candidates: { name: string; code: string }[] = [];
    for (const name of assets.filter((a) => a.endsWith(".js"))) {
      const code = await readFile(join(outDir, "assets", name), "utf8");
      if (code.includes("registerProcessor")) candidates.push({ name, code });
    }
    expect(candidates).toHaveLength(1);
    const { name, code } = candidates[0]!;
    expect(name).toMatch(/-[\w-]{8,}\.js$/);
    expect(code).toContain("earworm-framer");
    // createFramer from @earworm/core/framing is inlined (its error text survives minifying).
    expect(code).toContain("frameSize must be 128 or 512");
    expect(code).not.toContain("@earworm/core");
    expect(code).not.toMatch(/(^|[;{}\n])\s*import\s*[\w{*"'`]/);
    expect(code).not.toMatch(/\bimport\s*\(/);
  });
});
