import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import picomatch from "picomatch";
import { afterAll, describe, expect, it } from "vitest";
import { lintProject } from "../src/lint/project.js";
import { walkProject } from "../src/project/walk.js";
import { validateScenes } from "../src/scenes/validate.js";

const root = mkdtempSync(join(tmpdir(), "gdc-walk-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function put(rel: string, body = ""): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

const SCENE = '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://gone.gd" id="1"]\n';
put("main.gd", "var typed: int = 1\n");
put("main.tscn", "[gd_scene format=3]\n");
put("addons/plugin/p.gd", "var x = 1\n");
put("addons/plugin/p.tscn", SCENE);
put(".godot/imported/cache.gd", "var x = 1\n");
put(".godot/imported/cache.tscn", SCENE);
put("sub/.git/hook.gd", "var x = 1\n");
put("godot-correctness.config.json", JSON.stringify({ exclude: ["addons/**"] }));

describe("walkProject", () => {
  it("prunes excluded directories and always skips .git/.godot", () => {
    const exclude = picomatch(["addons/**"], { dot: true });
    const rels = walkProject(root, { exts: [".gd", ".tscn"], exclude }).map((f) => f.rel).sort();
    expect(rels).toEqual(["main.gd", "main.tscn"]);
  });

  it("filters by extension with forward-slash relative paths", () => {
    const rels = walkProject(root, { exts: [".gd"] }).map((f) => f.rel).sort();
    expect(rels).toEqual(["addons/plugin/p.gd", "main.gd"]);
  });
});

describe("lint and scene validation share the same scope", () => {
  it("lint_project skips .godot even when the config overrides exclude", async () => {
    const res = await lintProject(root);
    expect(res.fileCount).toBe(1);
    expect(res.findings.every((f) => f.file === "main.gd")).toBe(true);
  });

  it("validate_scenes skips the same directories", () => {
    expect(validateScenes(root)).toEqual([]);
  });
});
