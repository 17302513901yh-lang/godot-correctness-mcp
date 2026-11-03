import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { parseGodotFile, type GodotValue } from "../src/godot/text-format.js";
import { DEFAULT_PATH_PROPERTY_PATTERNS } from "../src/lint/config.js";
import { lintProject } from "../src/lint/project.js";
import { looksLikeResourcePath, resolveResPath } from "../src/scenes/paths.js";
import { validateProjectConfig, validateRegistries } from "../src/scenes/validate.js";

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
