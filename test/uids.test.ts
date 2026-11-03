import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateProjectConfig, validateScenes } from "../src/scenes/validate.js";
import { buildUidIndex, normalizeResPath } from "../src/scenes/uids.js";

const tmp = mkdtempSync(join(tmpdir(), "gdc-uid-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function project(name: string, files: Record<string, string>): string {
  const root = join(tmp, name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

/** A project with one script (+ .uid), one texture (+ .import), and one scene with a header uid. */
const BASE = {
  "player.gd": "extends Node2D\n",
  "player.gd.uid": "uid://bplayer\n",
  "art/icon.png": "",
  "art/icon.png.import": '[remap]\n\nimporter="texture"\ntype="CompressedTexture2D"\nuid="uid://bicon"\n',
  "Enemy.tscn": '[gd_scene format=3 uid="uid://benemy"]\n\n[node name="Enemy" type="Node2D"]\n',
};

const scene = (ext: string): string =>
  `[gd_scene format=3]\n\n${ext}\n\n[node name="Root" type="Node2D"]\n`;

const ids = (root: string): string[] => validateScenes(root).map((f) => `${f.ruleId}:${f.severity}`);

describe("buildUidIndex", () => {
  it("indexes .uid sidecars, .import remaps, and scene headers", () => {
    const root = project("index", BASE);
    expect(Object.fromEntries(buildUidIndex(root, () => false))).toEqual({
      "uid://bplayer": "res://player.gd",
      "uid://bicon": "res://art/icon.png",
      "uid://benemy": "res://Enemy.tscn",
    });
  });

  it("normalizes res:// paths", () => {
    expect(normalizeResPath("res://a/./b//../c.gd")).toBe("res://a/c.gd");
  });
});

describe("ext_resource uid validation", () => {
  it("accepts a consistent uid + path", () => {
    const root = project("ok", {
      ...BASE,
      "Main.tscn": scene('[ext_resource type="Script" uid="uid://bplayer" path="res://player.gd" id="1"]'),
    });
    expect(ids(root)).toEqual([]);
  });

  it("warns (not errors) on a stale path when the uid still resolves", () => {
    const root = project("stale", {
      ...BASE,
      "Main.tscn": scene('[ext_resource type="Script" uid="uid://bplayer" path="res://old/player.gd" id="1"]'),
    });
    expect(ids(root)).toEqual(["scene-ext-resource-path-stale:warning"]);
  });

  it("warns when uid and path name different existing files", () => {
    const root = project("mismatch", {
      ...BASE,
      "Main.tscn": scene('[ext_resource type="PackedScene" uid="uid://benemy" path="res://player.gd" id="1"]'),
    });
    expect(ids(root)).toEqual(["scene-ext-resource-uid-mismatch:warning"]);
  });

  it("errors when neither path nor uid resolves", () => {
    const root = project("both-gone", {
      ...BASE,
      "Main.tscn": scene('[ext_resource type="Script" uid="uid://bnope" path="res://nope.gd" id="1"]'),
    });
    expect(ids(root)).toEqual(["scene-ext-resource-missing:error"]);
  });

  it("checks uid-only references", () => {
    const ok = project("uid-only-ok", {
      ...BASE,
      "Main.tscn": scene('[ext_resource type="Texture2D" uid="uid://bicon" id="1"]'),
    });
    expect(ids(ok)).toEqual([]);
    const unknown = project("uid-only-unknown", {
      ...BASE,
      "Main.tscn": scene('[ext_resource type="Texture2D" uid="uid://bmissing" id="1"]'),
    });
    expect(ids(unknown)).toEqual(["scene-ext-resource-uid-unknown:warning"]);
  });

  it("resolves uid:// main scenes and autoloads in project.godot", () => {
    const ok = project("project-uid", {
      ...BASE,
      "project.godot": '[application]\nrun/main_scene="uid://benemy"\n\n[autoload]\nP="*uid://bplayer"\n',
    });
    expect(validateProjectConfig(ok)).toEqual([]);
    const bad = project("project-uid-bad", {
      ...BASE,
      "project.godot": '[application]\nrun/main_scene="uid://bgone"\n',
    });
    expect(validateProjectConfig(bad).map((f) => `${f.ruleId}:${f.severity}`)).toEqual([
      "project-main-scene-missing:warning",
    ]);
  });
});
