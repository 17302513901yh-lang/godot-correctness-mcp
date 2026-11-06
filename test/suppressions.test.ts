import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/lint/config.js";
import { lintSource } from "../src/lint/engine.js";
import { projectReport } from "../src/scenes/report.js";

async function lint(source: string, raw = {}): Promise<string[]> {
  const findings = await lintSource("x.gd", source, resolveConfig(raw));
  return findings.map((f) => `${f.ruleId}@${f.line}:${f.severity}`);
}

describe("inline suppressions", () => {
  it("baseline: the untyped var is reported", async () => {
    expect(await lint("var a = 1\n")).toEqual(["untyped-declaration@1:warning"]);
  });

  it("same-line directive with a rule id", async () => {
    expect(await lint("var a = 1  # gdcorrect-ignore[untyped-declaration]\n")).toEqual([]);
  });

  it("comment-only line applies to the next line only", async () => {
    const src = "# gdcorrect-ignore[untyped-declaration]\nvar a = 1\nvar b = 2\n";
    expect(await lint(src)).toEqual(["untyped-declaration@3:warning"]);
  });

  it("bare directive silences every rule on its line", async () => {
    expect(await lint("var a = 1  # gdcorrect-ignore\n")).toEqual([]);
  });

  it("a directive for a different rule does not silence the finding and is reported unused", async () => {
    expect(await lint("var a = 1  # gdcorrect-ignore[await-misuse]\n")).toEqual([
      "untyped-declaration@1:warning",
      "unused-suppression@1:info",
    ]);
  });

  it("file-wide directive, with several ids", async () => {
    const src = "# gdcorrect-ignore-file[untyped-declaration, missing-onready]\nextends Node\nvar a = $A\n";
    expect(await lint(src)).toEqual([]);
  });

  it("unused-suppression can be disabled or re-severitied in config", async () => {
    const src = "var a: int = 1  # gdcorrect-ignore\n";
    expect(await lint(src)).toEqual(["unused-suppression@1:info"]);
    expect(await lint(src, { rules: { "unused-suppression": { enabled: false } } })).toEqual([]);
    expect(await lint(src, { rules: { "unused-suppression": { severity: "warning" } } })).toEqual([
      "unused-suppression@1:warning",
    ]);
  });
});

describe("suppressions and rules config across scene/project checks", () => {
  const tmp = mkdtempSync(join(tmpdir(), "gdc-supp-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function project(name: string, files: Record<string, string>): string {
    const root = join(tmp, name);
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    return root;
  }

  const scene =
    '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n' +
    '[node name="Main" type="Node"]\nscript = ExtResource("1")\n';
  const script =
    "extends Node\n\n" +
    "# gdcorrect-ignore[scene-node-path-missing]\n" +
    "@onready var hud: Node = $RuntimeHUD\n\n" +
    "func _process(_d: float) -> void:\n" +
    '\tif Input.is_action_pressed("jmp"):  # gdcorrect-ignore[project-input-action-undefined]\n' +
    "\t\tpass\n";
  const files = { "project.godot": "[application]\n", "main.tscn": scene, "main.gd": script };
  const ids = async (root: string): Promise<string[]> => {
    const r = await projectReport(root);
    return [...r.lint, ...r.scenes, ...r.project].map((f) => `${f.ruleId}@${f.line}:${f.severity}`);
  };
  // The same script without the two directives.
  const plain =
    "extends Node\n\n" +
    "@onready var hud: Node = $RuntimeHUD\n\n" +
    "func _process(_d: float) -> void:\n" +
    '\tif Input.is_action_pressed("jmp"):\n' +
    "\t\tpass\n";

  it("documented non-lint suppressions work and are not reported as unused", async () => {
    expect(await ids(project("docs-example", files))).toEqual([]);
  });

  it("without the directives both findings are reported", async () => {
    const got = await ids(project("no-directives", { ...files, "main.gd": plain }));
    expect(got).toContain("scene-node-path-missing@3:warning");
    expect(got).toContain("project-input-action-undefined@6:warning");
  });

  it("rules config disables and re-severities scene and project rules", async () => {
    const cfg = {
      rules: {
        "scene-node-path-missing": { enabled: false },
        "project-input-action-undefined": { severity: "error" },
      },
    };
    const got = await ids(
      project("rules-cfg", { ...files, "main.gd": plain, "godot-correctness.config.json": JSON.stringify(cfg) }),
    );
    expect(got.filter((g) => g.startsWith("scene-node-path-missing"))).toEqual([]);
    expect(got).toContain("project-input-action-undefined@6:error");
  });

  it("a directive for a config-disabled lint rule is not reported as unused", async () => {
    const src = "var a = 1  # gdcorrect-ignore[untyped-declaration]\n";
    expect(await lint(src, { rules: { "untyped-declaration": { enabled: false } } })).toEqual([]);
  });
});
