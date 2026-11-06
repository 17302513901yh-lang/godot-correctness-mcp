import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isGrammarAvailable } from "../src/gdscript/parser.js";
import { loadConfig, resolveConfig } from "../src/lint/config.js";
import { runCli } from "../src/cli.js";
import { lintSource } from "../src/lint/engine.js";
import { lintProject } from "../src/lint/project.js";

function fixturePath(rel: string): string {
  return fileURLToPath(new URL(`./fixtures/${rel}`, import.meta.url));
}
function gd(rel: string): string {
  return readFileSync(fixturePath(rel), "utf-8");
}

const RULE_FILES: Record<string, string> = {
  "get-node-in-process": "gd/get-node-in-process.gd",
  "missing-onready": "gd/missing-onready.gd",
  "untyped-declaration": "gd/untyped-declaration.gd",
  "await-misuse": "gd/await-misuse.gd",
  "stringly-nodepath": "gd/stringly-nodepath.gd",
  "connect-without-disconnect": "gd/connect-without-disconnect.gd",
  "delta-misuse": "gd/delta-misuse.gd",
  "float-grid-equality": "gd/float-grid-equality.gd",
};

describe("grammar", () => {
  it("has the committed GDScript WASM available", () => {
    expect(isGrammarAvailable()).toBe(true);
  });
});

describe("each rule fires on its fixture", () => {
  const config = resolveConfig();
  for (const [ruleId, file] of Object.entries(RULE_FILES)) {
    it(`${ruleId} fires on ${file}`, async () => {
      const findings = await lintSource(file, gd(file), config);
      expect(findings.some((f) => f.ruleId === ruleId)).toBe(true);
    });
  }
});

describe("clean file", () => {
  it("produces zero findings on well-written GDScript", async () => {
    const findings = await lintSource("clean.gd", gd("gd/clean.gd"), resolveConfig());
    expect(findings).toEqual([]);
  });
});

describe("delta-misuse emits both severities", () => {
  it("error for velocity*delta into move_and_slide, info for delta-less _process motion", async () => {
    const findings = await lintSource("delta.gd", gd("gd/delta-misuse.gd"), resolveConfig());
    const delta = findings.filter((f) => f.ruleId === "delta-misuse");
    expect(delta.some((f) => f.severity === "error")).toBe(true);
    expect(delta.some((f) => f.severity === "info")).toBe(true);
  });
});

describe("config disable + severity override", () => {
  const src = gd("../fixtures/lint-project/scripts/player.gd");
  const projectDir = fixturePath("lint-project");

  it("with defaults: untyped is a warning and float-grid-equality fires", async () => {
    const findings = await lintSource("player.gd", src, resolveConfig());
    expect(findings.find((f) => f.ruleId === "untyped-declaration")?.severity).toBe("warning");
    expect(findings.some((f) => f.ruleId === "float-grid-equality")).toBe(true);
  });

  it("with project config: untyped downgraded to info and float-grid-equality disabled", async () => {
    const findings = await lintSource("player.gd", src, loadConfig(projectDir));
    expect(findings.find((f) => f.ruleId === "untyped-declaration")?.severity).toBe("info");
    expect(findings.some((f) => f.ruleId === "float-grid-equality")).toBe(false);
  });
});

describe("lintProject", () => {
  it("aggregates findings, honors config, and excludes .godot", async () => {
    const res = await lintProject(fixturePath("lint-project"));
    expect(res.errorCount).toBeGreaterThan(0); // delta-misuse error
    expect(res.findings.some((f) => f.file.includes(".godot"))).toBe(false);
    expect(res.findings.some((f) => f.ruleId === "float-grid-equality")).toBe(false);
  });
});

describe("CLI exit codes (programmatic entry)", () => {
  const noop = (): void => {};

  it("returns 1 when a project has error-severity findings", async () => {
    expect(await runCli(["lint", fixturePath("lint-project")], noop, noop)).toBe(1);
  });

  it("returns 0 on a clean project", async () => {
    expect(await runCli(["lint", fixturePath("clean-project")], noop, noop)).toBe(0);
  });

  it("emits valid JSON by default", async () => {
    let out = "";
    const code = await runCli(["lint", fixturePath("clean-project")], (s) => (out += s), noop);
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { findings: unknown[]; fileCount: number };
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.fileCount).toBeGreaterThan(0);
  });

  it("returns 2 on usage error", async () => {
    expect(await runCli(["bogus"], noop, noop)).toBe(2);
  });
});
