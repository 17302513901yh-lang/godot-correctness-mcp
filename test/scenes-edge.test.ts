import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { parseGodotFile, type GodotValue } from "../src/godot/text-format.js";
import { DEFAULT_PATH_PROPERTY_PATTERNS } from "../src/lint/config.js";
import { lintProject } from "../src/lint/project.js";
import { looksLikeResourcePath, resolveResPath } from "../src/scenes/paths.js";
import { validateProjectConfig, validateRegistries, validateScenes } from "../src/scenes/validate.js";

const tmp = mkdtempSync(join(tmpdir(), "gdc-edge-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Create a throwaway project from a { relPath: contents } map. */
function project(name: string, files: Record<string, string>): string {
  const root = join(tmp, name);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  mkdirSync(root, { recursive: true });
  return root;
}

const noop = (): void => {};

describe("resource reference parsing", () => {
  const prop = (value: string): GodotValue =>
    parseGodotFile(`[gd_scene format=3]\n[node name="R" type="Node"]\nv = ${value}\n`).sections[0]!.properties["v"]!;

  it("reads quoted, unquoted and padded ids", () => {
    expect(prop('ExtResource("1_abc")')).toMatchObject({ kind: "extResource", ref: "1_abc" });
    expect(prop('ExtResource( "1_abc" )')).toMatchObject({ kind: "extResource", ref: "1_abc" });
    expect(prop("ExtResource(3)")).toMatchObject({ kind: "extResource", ref: "3" });
    expect(prop('SubResource("Shape_x")')).toMatchObject({ kind: "subResource", ref: "Shape_x" });
  });

  it("stays fast on long malformed values", () => {
    const start = performance.now();
    for (const kind of ["ExtResource", "SubResource"]) {
      expect(prop(`${kind}(${" ".repeat(50_000)}x`).kind).toBe("other");
    }
    const root = project("long-malformed", {
      "project.godot": "[application]\n",
      "a.tscn":
        `[gd_scene format=3]\n[node name="R" type="Node"]\nfoo = ExtResource(${" ".repeat(50_000)}x\n` +
        `bar = [SubResource(${" ".repeat(50_000)}x]\n`,
      "s.gd": `${"\n".repeat(200_000)}class_name Foo\n`,
    });
    validateScenes(root);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe("parseGodotFile robustness", () => {
  const scene =
    '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://a.gd" id="1"]\n\n' +
    '[node name="R" type="Node"]\nscript = ExtResource("1")\nmeta = {\n"k": 1\n}\n';

  it("CRLF input parses identically to LF", () => {
    expect(parseGodotFile(scene.replace(/\n/g, "\r\n"))).toEqual(parseGodotFile(scene));
  });

  it("tolerates a UTF-8 BOM before the header", () => {
    const f = parseGodotFile(`﻿${scene}`);
    expect(f.sections.some((s) => s.kind === "ext_resource")).toBe(true);
  });

  it("returns an empty file for empty input", () => {
    expect(parseGodotFile("")).toEqual({ header: null, sections: [] });
  });

  it.each([
    ["unterminated string", '[resource]\nname = "abc\nnext = 1\n'],
    ["unclosed multi-line dict", "[resource]\ndata = {\n\"a\": [1, 2\n"],
    ["truncated header", '[gd_resource type="Resource" format=3\n[resource]\n'],
  ])("does not throw on %s", (_label, src) => {
    expect(() => parseGodotFile(src)).not.toThrow();
  });

  it("keeps escaped quotes inside strings and headers without attributes", () => {
    const f = parseGodotFile('[resource]\ntext = "say \\"hi\\""\n');
    expect(f.sections[0]?.kind).toBe("resource");
    expect(f.sections[0]?.attributes).toEqual({});
    expect(f.sections[0]?.properties["text"]?.kind).toBe("string");
  });
});

describe("resolveResPath / looksLikeResourcePath", () => {
  const root = join(tmp, "root");
  const str = (s: string): GodotValue => ({ raw: `"${s}"`, line: 1, kind: "string", string: s });

  it.each([
    ["res://a.tscn", join(root, "a.tscn")],
    ["uid://abc123", null],
    ["user://save.dat", null],
    ["", null],
    ["sub/b.tres", join(root, "sub/b.tres")],
  ])("resolveResPath(%j)", (p, want) => {
    expect(resolveResPath(root, p)).toBe(want);
  });

  it.each([
    ["res://x", "anything", true],
    ["levels/one.TSCN", "anything", true],
    ["foo.PNG", "anything", false],
    ["icon", "icon_texture", false],
    ["art/icon.png", "icon_texture", true],
    ["hello world", "title", false],
  ])("looksLikeResourcePath(%j, %j) = %s", (s, prop, want) => {
    expect(looksLikeResourcePath(str(s), prop, DEFAULT_PATH_PROPERTY_PATTERNS)).toBe(want);
  });
});

describe("validateProjectConfig branches", () => {
  it("flags a missing main scene", () => {
    const root = project("missing-main", {
      "project.godot": '[application]\nrun/main_scene="res://nope.tscn"\n',
    });
    expect(validateProjectConfig(root).map((f) => f.ruleId)).toEqual(["project-main-scene-missing"]);
  });

  it("strips the * singleton marker from autoload paths", () => {
    const root = project("autoload-star", {
      "project.godot": '[autoload]\nG="*res://g.gd"\n',
      "g.gd": "extends Node\n",
    });
    expect(validateProjectConfig(root)).toEqual([]);
  });

  it("reports project-missing when there is no project.godot", () => {
    const root = project("no-project", { "a.txt": "" });
    expect(validateProjectConfig(root).map((f) => f.ruleId)).toEqual(["project-missing"]);
  });
});

describe("config handling", () => {
  it("honors custom include/exclude and registryDirs", async () => {
    const root = project("custom-cfg", {
      "godot-correctness.config.json": JSON.stringify({
        include: ["game/**/*.gd"],
        exclude: ["game/vendor/**"],
        registryDirs: ["data"],
      }),
      "game/a.gd": "var x = 1\n",
      "game/vendor/b.gd": "var x = 1\n",
      "other/c.gd": "var x = 1\n",
      "data/item.tres": '[gd_resource type="Resource" format=3]\n\n[resource]\nicon_path = "res://missing.png"\n',
    });
    const lint = await lintProject(root);
    expect(lint.fileCount).toBe(1);
    expect(lint.findings.every((f) => f.file === "game/a.gd")).toBe(true);
    expect(validateRegistries(root).findings.map((f) => f.ruleId)).toEqual(["registry-dangling-path"]);
  });

  it("reports missing, res:// and out-of-root registryDirs entries", () => {
    const item = '[gd_resource type="Resource" format=3]\n\n[resource]\nicon_path = "res://missing.png"\n';
    const root = project("reg-dirs", {
      "godot-correctness.config.json": JSON.stringify({ registryDirs: ["res://data", "dta", "../outside"] }),
      "data/item.tres": item,
    });
    project("outside", { "evil.tres": item });
    const findings = validateRegistries(root).findings;
    expect(findings.map((f) => `${f.file}:${f.ruleId}`)).toEqual([
      "data/item.tres:registry-dangling-path",
      "godot-correctness.config.json:registry-dir-missing",
      "godot-correctness.config.json:registry-dir-missing",
    ]);
    expect(findings[2]!.message).toContain("outside the project root");
  });

  it("treats res:// paths that escape the project root as missing without probing them", () => {
    const root = project("escape", {
      "project.godot": '[application]\nrun/main_scene="res://../escape-target.tscn"\n',
      "Main.tscn":
        '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://../escape-target.gd" id="1"]\n\n' +
        '[node name="Root" type="Node"]\nscript = ExtResource("1")\n',
    });
    // The targets exist on disk, but outside the root, so they count as missing.
    project("", { "escape-target.tscn": "[gd_scene format=3]\n", "escape-target.gd": "extends Node\n" });
    expect(validateProjectConfig(root).map((f) => f.ruleId)).toContain("project-main-scene-missing");
    expect(validateScenes(root).map((f) => f.ruleId)).toContain("scene-ext-resource-missing");
  });

  it("rejects unknown rule ids and misspelled rule-config keys", async () => {
    for (const [name, rules, needle] of [
      ["typo-id", { "untyped-decl": { enabled: false } }, 'Unknown rule id "untyped-decl"'],
      ["typo-key", { "float-grid-equality": { enable: false } }, "enable"],
    ] as const) {
      const root = project(name, { "godot-correctness.config.json": JSON.stringify({ rules }) });
      let err = "";
      expect(await runCli(["lint", root], noop, (s) => (err += s))).toBe(2);
      expect(err).toContain(needle);
    }
    // Scene/project rule ids and unused-suppression are valid keys.
    const ok = project("known-ids", {
      "godot-correctness.config.json": JSON.stringify({
        rules: { "scene-node-path-missing": { enabled: false }, "unused-suppression": { severity: "warning" } },
      }),
    });
    expect(await runCli(["lint", ok], noop, noop)).toBe(0);
  });

  it("CLI exits 2 with the config file named on malformed JSON", async () => {
    const root = project("bad-json", { "godot-correctness.config.json": "{ nope" });
    let err = "";
    expect(await runCli(["lint", root], noop, (s) => (err += s))).toBe(2);
    expect(err).toContain("godot-correctness.config.json");
  });

  it("CLI exits 2 with the offending key on a schema violation", async () => {
    const root = project("bad-schema", {
      "godot-correctness.config.json": JSON.stringify({ rules: { x: { severity: "fatal" } } }),
    });
    let err = "";
    expect(await runCli(["lint", root], noop, (s) => (err += s))).toBe(2);
    expect(err).toContain("rules.x.severity");
  });

  it("CLI rejects unknown config keys", async () => {
    const root = project("typo", { "godot-correctness.config.json": JSON.stringify({ exlude: [] }) });
    let err = "";
    expect(await runCli(["lint", root], noop, (s) => (err += s))).toBe(2);
    expect(err).toContain("exlude");
  });
});

describe("CLI argument errors", () => {
  it("exits 2 without a project path", async () => {
    expect(await runCli(["lint"], noop, noop)).toBe(2);
  });

  it("exits 2 for a nonexistent directory", async () => {
    expect(await runCli(["lint", join(tmp, "nope")], noop, noop)).toBe(2);
  });

  it("exits 2 for an unknown format", async () => {
    expect(await runCli(["lint", tmp, "--format", "xml"], noop, noop)).toBe(2);
  });
});

describe("project-input-action-undefined", () => {
  const PROJECT =
    "[input]\n\njump={\n\"deadzone\": 0.5,\n\"events\": []\n}\nmove_left={\n\"deadzone\": 0.5,\n\"events\": []\n}\n";

  it("flags undefined action literals and ignores defined, built-in, commented, and dynamic ones", () => {
    const root = project("input-actions", {
      "project.godot": PROJECT,
      "player.gd":
        "extends Node\n\nfunc _process(_delta: float) -> void:\n" +
        '\tif Input.is_action_pressed("jump"):\n' + // defined
        "\t\tpass\n" +
        '\tif Input.is_action_just_pressed(&"jmup"):\n' + // typo -> flagged (StringName literal)
        "\t\tpass\n" +
        '\tif Input.is_action_pressed("ui_accept"):\n' + // built-in
        "\t\tpass\n" +
        '\t# Input.is_action_pressed("commented_out")\n' +
        '\tvar x := Input.get_axis("move_left", "move_rigth")\n' + // second arg is a typo
        "\tvar name := \"dyn\"\n" +
        "\tif Input.is_action_pressed(name):\n" + // dynamic -> ignored
        "\t\tpass\n" +
        '\tif InputMap.has_action("maybe"):\n' + // existence check -> ignored
        "\t\tpass\n",
    });
    const hits = validateProjectConfig(root)
      .filter((f) => f.ruleId === "project-input-action-undefined")
      .map((f) => `${f.file}:${f.line}:${f.col} ${f.message}`);
    expect(hits).toEqual([
      'player.gd:6:34 Input action "jmup" is not defined in project.godot [input].',
      'player.gd:11:39 Input action "move_rigth" is not defined in project.godot [input].',
    ]);
  });

  it("respects exclude globs", () => {
    const root = project("input-actions-excluded", {
      "project.godot": PROJECT,
      "godot-correctness.config.json": JSON.stringify({ exclude: ["addons/**"] }),
      "addons/x/plugin.gd": 'func f() -> void:\n\tInput.is_action_pressed("plugin_only")\n',
    });
    expect(validateProjectConfig(root)).toEqual([]);
  });
});
