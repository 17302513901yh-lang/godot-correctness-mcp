import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGodotFile, sectionsOfKind } from "../src/godot/text-format.js";
import { runCli } from "../src/cli.js";
import { projectReport } from "../src/scenes/report.js";
import {
  validateProjectConfig,
  validateRegistries,
  validateScenes,
} from "../src/scenes/validate.js";

function fixtureRoot(rel: string): string {
  return fileURLToPath(new URL(`./fixtures/${rel}`, import.meta.url));
}
function read(rel: string): string {
  return readFileSync(fixtureRoot(rel), "utf-8");
}

const ROOT = fixtureRoot("scene-project");
const CLEAN = fixtureRoot("clean-project");

describe("parseGodotFile", () => {
  it("parses a scene header, ext_resource, and nodes", () => {
    const f = parseGodotFile(read("scene-project/Main.tscn"));
    expect(f.header?.kind).toBe("gd_scene");
    const ext = sectionsOfKind(f, "ext_resource");
    expect(ext).toHaveLength(1);
    expect(ext[0].attributes["path"]?.string).toBe("res://player.gd");
    expect(ext[0].attributes["id"]?.string).toBe("1_abc");
    expect(sectionsOfKind(f, "node")).toHaveLength(2);
  });

  it("parses project.godot with no header and a multi-line input dict", () => {
    const f = parseGodotFile(read("scene-project/project.godot"));
    expect(f.header).toBeNull();
    const app = f.sections.find((s) => s.kind === "application");
    expect(app?.properties["run/main_scene"]?.string).toBe("res://Main.tscn");
    const input = f.sections.find((s) => s.kind === "input");
    expect(input?.properties["jump"]?.raw.trimStart().startsWith("{")).toBe(true);
  });

  it("reports the start line of a multi-line value", () => {
    const f = parseGodotFile('[resource]\nitems = {\n"a": 1,\n"b": 2\n}\nafter = 3\n');
    expect(f.sections[0].properties["items"]?.line).toBe(2);
    expect(f.sections[0].properties["after"]?.line).toBe(6);
  });
});

describe("validateScenes duplicate ids", () => {
  it("names unquoted duplicate ids in the message", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "gdc-dup-"));
    try {
      writeFileSync(
        join(dir, "Dup.tscn"),
        '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://a.gd" id=1]\n' +
          '[ext_resource type="Script" path="res://b.gd" id=1]\n\n[node name="R" type="Node"]\n',
      );
      writeFileSync(join(dir, "a.gd"), "");
      writeFileSync(join(dir, "b.gd"), "");
      const dup = validateScenes(dir).find((f) => f.ruleId === "scene-duplicate-resource-id");
      expect(dup?.message).toBe('Duplicate ext_resource id "1".');
      expect(dup?.line).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("validateScenes", () => {
  const findings = validateScenes(ROOT);

  it("flags the broken scene's missing ext_resource and undeclared ExtResource ref", () => {
    const ids = findings.map((f) => f.ruleId);
    expect(ids).toContain("scene-ext-resource-missing");
    expect(ids).toContain("scene-missing-ext-resource-id");
  });

  it("fires only in Broken.tscn, never in the valid Main.tscn", () => {
    expect(findings.every((f) => f.file === "Broken.tscn")).toBe(true);
    expect(findings).toHaveLength(4);
  });

  it("flags undeclared ExtResource refs in node instance= attributes", () => {
    const f = findings.find((x) => x.message.includes("7_inst"));
    expect(f?.ruleId).toBe("scene-missing-ext-resource-id");
    expect(f?.line).toBe(11);
  });

  it("flags undeclared ExtResource refs nested in multi-line values at their own line", () => {
    const f = findings.find((x) => x.message.includes("8_nested"));
    expect(f?.ruleId).toBe("scene-missing-ext-resource-id");
    expect(f?.line).toBe(15);
  });
});

describe("validateProjectConfig", () => {
  const findings = validateProjectConfig(ROOT);

  it("flags the missing autoload and the malformed input action only", () => {
    const ids = findings.map((f) => f.ruleId).sort();
    expect(ids).toEqual(["project-autoload-missing", "project-input-malformed"]);
    expect(findings.some((f) => f.message.includes("Missing"))).toBe(true);
  });

  it("does not flag the valid main scene or the existing autoload", () => {
    expect(findings.some((f) => f.ruleId === "project-main-scene-missing")).toBe(false);
    expect(findings.some((f) => f.message.includes("Good"))).toBe(false);
  });
});

describe("validateRegistries (headline)", () => {
  const result = validateRegistries(ROOT);

  it("flags the dangling scene_path and the missing script target only", () => {
    const ids = result.findings.map((f) => f.ruleId).sort();
    expect(ids).toEqual(["registry-dangling-path", "registry-script-missing"]);
    expect(result.findings.find((f) => f.ruleId === "registry-dangling-path")?.file).toBe(
      "registries/dangling.tres",
    );
  });

  it("records class_name for resolvable scripts and null for broken ones", () => {
    expect(result.entries).toHaveLength(3);
    expect(result.entries.find((e) => e.file === "registries/clean.tres")?.scriptClass).toBe("Item");
    expect(result.entries.find((e) => e.file === "registries/broken_script.tres")?.scriptClass).toBeNull();
  });

  it("does not flag the clean registry entry", () => {
    expect(result.findings.some((f) => f.file === "registries/clean.tres")).toBe(false);
  });
});

describe("project_report", () => {
  it("aggregates all static checks with correct counts", async () => {
    const r = await projectReport(ROOT);
    expect(r.registryEntries).toHaveLength(3);
    // scenes: 4 errors; project: 1 error + 1 warning; registries: 2 errors; lint: 0.
    expect(r.errorCount).toBe(7);
    expect(r.warningCount).toBe(1);
    expect(r.totalFindings).toBe(8);
  });
});

describe("CLI subcommands exit codes", () => {
  const noop = (): void => {};
  it("returns 1 for a project with scene/registry/project errors", async () => {
    expect(await runCli(["validate-scenes", ROOT], noop, noop)).toBe(1);
    expect(await runCli(["validate-registries", ROOT], noop, noop)).toBe(1);
    expect(await runCli(["validate-project", ROOT], noop, noop)).toBe(1);
    expect(await runCli(["report", ROOT], noop, noop)).toBe(1);
  });
  it("returns 0 for a clean project with no scenes", async () => {
    expect(await runCli(["validate-scenes", CLEAN], noop, noop)).toBe(0);
  });
});
