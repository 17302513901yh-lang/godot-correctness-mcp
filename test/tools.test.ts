import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PINNED_GODOT_VERSIONS } from "../src/capabilities.js";
import { DIFF_DEFAULT_FROM, DIFF_DEFAULT_TO, VERSION } from "../src/tools/api.js";
import { connectClient, listRegisteredTools } from "./helpers/tool-list.js";

const fixture = (rel: string): string => fileURLToPath(new URL(`./fixtures/${rel}`, import.meta.url));

let client: Client;
const tmp = mkdtempSync(join(tmpdir(), "gdc-tools-"));

beforeAll(async () => {
  client = await connectClient();
});
afterAll(async () => {
  await client.close();
  rmSync(tmp, { recursive: true, force: true });
});

interface CallResult {
  isError?: boolean;
  body: any;
}

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  const r = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  const text = r.content[0]!.text;
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // SDK-level validation errors are plain text.
  }
  return { isError: r.isError, body };
}

describe("mcp-tools.json", () => {
  it("matches the registered tools exactly (run `npm run generate:tools` to refresh)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../mcp-tools.json", import.meta.url), "utf-8"));
    expect(await listRegisteredTools()).toEqual(committed);
  });
});

describe("version wiring", () => {
  it("derives the version enum and api_diff defaults from PINNED_GODOT_VERSIONS", () => {
    expect(VERSION.options).toEqual([...PINNED_GODOT_VERSIONS]);
    expect([DIFF_DEFAULT_FROM, DIFF_DEFAULT_TO]).toEqual(PINNED_GODOT_VERSIONS.slice(-2));
  });
});

describe("lint_file", () => {
  it("lints inline source without reading the path", async () => {
    const r = await call("lint_file", { path: join(tmp, "nope.gd"), source: "var x = 1\n" });
    expect(r.isError).toBeFalsy();
    expect(r.body.findings.some((f: any) => f.ruleId === "untyped-declaration")).toBe(true);
  });

  it("returns isError for a missing file", async () => {
    const r = await call("lint_file", { path: join(tmp, "missing.gd") });
    expect(r.isError).toBe(true);
    expect(typeof r.body.error).toBe("string");
  });

  it("applies the project root config to files in subfolders, with project-relative paths", async () => {
    const r = await call("lint_file", { path: fixture("lint-project/scripts/player.gd") });
    expect(r.isError).toBeFalsy();
    expect(r.body.file).toBe("scripts/player.gd");
    const untyped = r.body.findings.find((f: any) => f.ruleId === "untyped-declaration");
    expect(untyped?.severity).toBe("info");
    expect(r.body.findings.some((f: any) => f.ruleId === "float-grid-equality")).toBe(false);
  });

  it("reports an invalid config with its file name", async () => {
    const dir = join(tmp, "badcfg");
    mkdirSync(dir);
    writeFileSync(join(dir, "godot-correctness.config.json"), "{ not json");
    writeFileSync(join(dir, "a.gd"), "var x: int = 1\n");
    const r = await call("lint_file", { path: join(dir, "a.gd") });
    expect(r.isError).toBe(true);
    expect(r.body.error).toContain("godot-correctness.config.json");
  });
});

describe("project tools", () => {
  const missing = join(tmp, "does-not-exist");

  for (const name of ["lint_project", "validate_scenes", "validate_project_config", "validate_registries", "project_report"]) {
    it(`${name} returns isError for a nonexistent root`, async () => {
      const r = await call(name, { path: missing });
      expect(r.isError).toBe(true);
      expect(r.body.error).toContain("does not exist");
    });
  }

  it("project_report over MCP returns per-source findings for the scene fixture", async () => {
    const r = await call("project_report", { path: fixture("scene-project") });
    expect(r.isError).toBeFalsy();
    expect(r.body.scenes).toHaveLength(4);
    expect(r.body.project).toHaveLength(2);
    expect(r.body.registries).toHaveLength(2);
    expect(r.body.lint).toHaveLength(0);
  });

  it("validate_scenes includes the root like the CLI JSON", async () => {
    const r = await call("validate_scenes", { path: fixture("scene-project") });
    expect(r.body.root).toBe(fixture("scene-project"));
    expect(r.body.count).toBe(r.body.findings.length);
  });
});

describe("api tools errors", () => {
  it("api_diff with from === to is an error result", async () => {
    const v = PINNED_GODOT_VERSIONS[0];
    const r = await call("api_diff", { symbol: "Node", from: v, to: v });
    expect(r.isError).toBe(true);
  });

  it("api_class_summary for an unknown class is an error result", async () => {
    const r = await call("api_class_summary", { class: "NoSuchClassXyz", version: PINNED_GODOT_VERSIONS[0] });
    expect(r.isError).toBe(true);
  });
});

describe("CLI, MCP tools and report agree", () => {
  it("validate-scenes, validate_scenes and the report's scenes are identical", async () => {
    const { runCli } = await import("../src/cli.js");
    const { projectReport, reportFindings } = await import("../src/scenes/report.js");
    const root = fixture("scene-project");
    let out = "";
    await runCli(["validate-scenes", root], (s) => (out += s), () => {});
    const cliFindings = JSON.parse(out).findings;
    const tool = (await call("validate_scenes", { path: root })).body.findings;
    const report = await projectReport(root);
    expect(cliFindings.length).toBeGreaterThan(0);
    expect(tool).toEqual(cliFindings);
    expect(report.scenes).toEqual(cliFindings);

    out = "";
    await runCli(["report", root], (s) => (out += s), () => {});
    expect(reportFindings(JSON.parse(out))).toEqual(reportFindings(report));
  });
});
