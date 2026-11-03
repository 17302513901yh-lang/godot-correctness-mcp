import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateNodePaths } from "../src/scenes/node-paths.js";

const tmp = mkdtempSync(join(tmpdir(), "gdc-nodepaths-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function scan(name: string, files: Record<string, string>): Promise<string[]> {
  const root = join(tmp, name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return (await validateNodePaths(root)).map((f) => `${f.file}:${f.line} ${f.message.split(" does")[0]}`);
}

const MAIN =
  '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://player.gd" id="1"]\n' +
  '[ext_resource type="PackedScene" path="res://Gun.tscn" id="2"]\n\n' +
  '[node name="Player" type="CharacterBody2D"]\nscript = ExtResource("1")\n\n' +
  '[node name="Sprite" type="Sprite2D" parent="."]\n\n' +
  '[node name="HUD" type="CanvasLayer" parent="."]\n\n' +
  '[node name="Label" type="Label" parent="HUD"]\n\n' +
  '[node name="Gun" parent="." instance=ExtResource("2")]\n';

const PLAYER =
  "extends CharacterBody2D\n\n" +
  "@onready var sprite: Sprite2D = $Sprite\n" + // ok
  "@onready var label: Label = $HUD/Label\n" + // ok
  '@onready var title: Label = $"HUD/Title"\n' + // missing -> line 5
  "@onready var muzzle: Node2D = $Gun/Muzzle\n" + // inside an instance -> unknown, skipped
  "@onready var uniq: Node = %Unique\n" + // unique name -> skipped
  "\nfunc _ready() -> void:\n" +
  '\tget_node("Sprit").show()\n' + // typo -> line 10
  '\tget_node("/root/Game")\n' + // absolute -> skipped
  '\tget_node_or_null("HUD/Label")\n'; // ok

describe("scene-node-path-missing", () => {
  it("flags literal paths missing under the script's node, and skips unknowable ones", async () => {
    expect(await scan("basic", { "Main.tscn": MAIN, "Gun.tscn": "[gd_scene format=3]\n", "player.gd": PLAYER })).toEqual([
      'player.gd:5 Node path "HUD/Title"',
      'player.gd:10 Node path "Sprit"',
    ]);
  });

  it("only flags paths missing in every scene that uses the script", async () => {
    const other = MAIN.replace('[node name="Label" type="Label" parent="HUD"]', '[node name="Title" type="Label" parent="HUD"]');
    const res = await scan("two-scenes", {
      "Main.tscn": MAIN,
      "Alt.tscn": other,
      "Gun.tscn": "[gd_scene format=3]\n",
      "player.gd": PLAYER,
    });
    expect(res).toEqual(['player.gd:10 Node path "Sprit"']);
  });

  it("skips scripts on instanced/inherited roots and scripts not attached anywhere", async () => {
    const inherited =
      '[gd_scene format=3]\n\n[ext_resource type="PackedScene" path="res://Main.tscn" id="1"]\n' +
      '[ext_resource type="Script" path="res://player.gd" id="2"]\n\n' +
      '[node name="Player" instance=ExtResource("1")]\nscript = ExtResource("2")\n';
    expect(
      await scan("inherited", { "Main.tscn": MAIN.replace(/script = ExtResource\("1"\)\n/, ""), "Inherited.tscn": inherited, "Gun.tscn": "[gd_scene format=3]\n", "player.gd": PLAYER }),
    ).toEqual([]);
    expect(await scan("unattached", { "lonely.gd": 'extends Node\n\nfunc f() -> void:\n\t$Nope.show()\n' })).toEqual([]);
  });

  it("honors gdcorrect-ignore for runtime-added nodes", async () => {
    const src = 'extends CharacterBody2D\n\nfunc f() -> void:\n\t$Spawned.show()  # gdcorrect-ignore[scene-node-path-missing]\n';
    expect(await scan("suppressed", { "Main.tscn": MAIN, "Gun.tscn": "[gd_scene format=3]\n", "player.gd": src })).toEqual([]);
  });
});
