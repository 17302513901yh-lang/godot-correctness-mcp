import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import type { Finding } from "../src/lint/types.js";
import { toSarif } from "../src/sarif.js";

const fixture = (rel: string): string => fileURLToPath(new URL(`./fixtures/${rel}`, import.meta.url));

describe("toSarif", () => {
  const findings: Finding[] = [
    { file: "scripts/a.gd", line: 3, col: 5, ruleId: "untyped-declaration", severity: "warning", message: "M.", suggestion: "S." },
    { file: "Main.tscn", line: 1, col: 1, ruleId: "scene-ext-resource-missing", severity: "error", message: "E.", suggestion: "" },
    { file: "scripts/a.gd", line: 9, col: 1, ruleId: "untyped-declaration", severity: "info", message: "I.", suggestion: "" },
  ];
  const root = join("/repo", "game");
  const log = toSarif(findings, { projectRoot: root, version: "9.9.9", cwd: "/repo" }) as any;

  it("emits a SARIF 2.1.0 log with one run", () => {
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toContain("sarif-2.1.0");
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.name).toBe("gdcorrect");
    expect(log.runs[0].tool.driver.version).toBe("9.9.9");
  });

  it("lists each rule once with a description, and results point at their rule index", () => {
    const rules = log.runs[0].tool.driver.rules;
    expect(rules.map((r: any) => r.id)).toEqual(["scene-ext-resource-missing", "untyped-declaration"]);
    expect(rules[1].shortDescription.text).toMatch(/type hint/);
    for (const r of log.runs[0].results) {
      expect(rules[r.ruleIndex].id).toBe(r.ruleId);
    }
  });

  it("maps severities to SARIF levels and re-bases paths onto cwd", () => {
    const [a, b, c] = log.runs[0].results;
    expect([a.level, b.level, c.level]).toEqual(["warning", "error", "note"]);
    expect(a.locations[0].physicalLocation.artifactLocation.uri).toBe("game/scripts/a.gd");
    expect(a.locations[0].physicalLocation.region).toEqual({ startLine: 3, startColumn: 5 });
    expect(a.message.text).toBe("M. S.");
  });
});

describe("gdcorrect --format sarif", () => {
  it("prints SARIF and keeps the exit-code contract", async () => {
    let out = "";
    const code = await runCli(["lint", fixture("lint-project"), "--format", "sarif"], (s) => (out += s), () => {});
    expect(code).toBe(1);
    const log = JSON.parse(out);
    expect(log.version).toBe("2.1.0");
    expect(log.runs[0].results.some((r: any) => r.level === "error")).toBe(true);
  });
});
