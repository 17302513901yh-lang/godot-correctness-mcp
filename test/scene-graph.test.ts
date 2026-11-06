import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateScenes } from "../src/scenes/validate.js";

const tmp = mkdtempSync(join(tmpdir(), "gdc-graph-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function scan(name: string, files: Record<string, string>): string[] {
  const root = join(tmp, name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return validateScenes(root).map((f) => `${f.ruleId}@${f.line}`);
}

describe("scene-missing-sub-resource-id", () => {
  it("flags undeclared SubResource refs, including nested ones, and accepts declared ids", () => {
    const tscn =
      '[gd_scene format=3]\n\n[sub_resource type="RectangleShape2D" id="Shape_ok"]\n\n' +
      '[node name="Root" type="Node2D"]\n\n' +
      '[node name="Col" type="CollisionShape2D" parent="."]\nshape = SubResource("Shape_ok")\n\n' +
      '[node name="Col2" type="CollisionShape2D" parent="."]\nshape = SubResource("Shape_gone")\n' +
      "meta = [\nSubResource(\"Also_gone\")\n]\n";
    expect(scan("sub", { "Main.tscn": tscn })).toEqual([
      "scene-missing-sub-resource-id@11",
      "scene-missing-sub-resource-id@13",
    ]);
  });
});

describe("scene-node-parent-missing", () => {
  it("flags parents that are not declared, but not paths under instanced sub-scenes", () => {
    const tscn =
      '[gd_scene format=3]\n\n[ext_resource type="PackedScene" path="res://Enemy.tscn" id="1"]\n\n' +
      '[node name="Root" type="Node2D"]\n\n' +
      '[node name="A" type="Node2D" parent="."]\n\n' +
      '[node name="B" type="Node2D" parent="A"]\n\n' + // ok: A exists
      '[node name="Orphan" type="Node2D" parent="A/Missing"]\n\n' + // flagged
      '[node name="Enemy" parent="." instance=ExtResource("1")]\n\n' +
      '[node name="Extra" type="Node2D" parent="Enemy/Body"]\n'; // ok: inside an instance
    expect(scan("parents", { "Main.tscn": tscn, "Enemy.tscn": "[gd_scene format=3]\n" })).toEqual([
      "scene-node-parent-missing@11",
    ]);
  });

  it("accepts children under base-scene nodes in an inherited scene", () => {
    const tscn =
      '[gd_scene format=3]\n\n[ext_resource type="PackedScene" path="res://Base.tscn" id="1_b"]\n\n' +
      '[node name="Derived" instance=ExtResource("1_b")]\n\n' +
      '[node name="Extra" type="Node2D" parent="Sprite"]\n\n' +
      '[node name="Deeper" type="Node2D" parent="Body/Arm"]\n';
    expect(scan("inherited", { "Derived.tscn": tscn, "Base.tscn": "[gd_scene format=3]\n" })).toEqual([]);
  });
});

describe("scene-connection-method-missing", () => {
  const scene = (method: string): string =>
    '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://ui.gd" id="1"]\n\n' +
    '[node name="UI" type="Control"]\nscript = ExtResource("1")\n\n' +
    '[node name="Button" type="Button" parent="."]\n\n' +
    `[connection signal="pressed" from="Button" to="." method="${method}"]\n`;
  const script = "extends Control\n\nfunc _on_button_pressed() -> void:\n\tpass\n";

  it("accepts a method defined in the target script", () => {
    expect(scan("conn-ok", { "Main.tscn": scene("_on_button_pressed"), "ui.gd": script })).toEqual([]);
  });

  it("accepts an engine method inherited from the built-in base class", () => {
    expect(scan("conn-engine", { "Main.tscn": scene("hide"), "ui.gd": script })).toEqual([]);
  });

  it("flags a method that exists nowhere", () => {
    expect(scan("conn-bad", { "Main.tscn": scene("_on_buton_pressed"), "ui.gd": script })).toEqual([
      "scene-connection-method-missing@10",
    ]);
  });

  it("accepts methods declared with same-line annotations", () => {
    for (const decl of [
      '@rpc("any_peer") func _on_button_pressed() -> void:',
      '@warning_ignore("unused_parameter") @rpc func _on_button_pressed() -> void:',
      "@rpc static func _on_button_pressed() -> void:",
    ]) {
      const ui = `extends Control # base\n\n${decl}\n\tpass\n`;
      expect(scan(`conn-annot-${decl.length}`, { "Main.tscn": scene("_on_button_pressed"), "ui.gd": ui })).toEqual([]);
    }
  });

  it("re-reads a script after it changes", () => {
    const files = { "Main.tscn": scene("_on_later"), "ui.gd": script };
    expect(scan("conn-change", files)).toEqual(["scene-connection-method-missing@10"]);
    expect(
      scan("conn-change", { ...files, "ui.gd": script + "\nfunc _on_later() -> void:\n\tpass\n" }),
    ).toEqual([]);
  });

  it("skips scripts whose base class is user-defined (inheritance chain unknown)", () => {
    expect(
      scan("conn-user", { "Main.tscn": scene("_on_buton_pressed"), "ui.gd": "extends BaseUI\n" }),
    ).toEqual([]);
  });
});
