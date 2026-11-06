import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/lint/config.js";
import { lintSource } from "../src/lint/engine.js";

const config = resolveConfig();
const gd = (rel: string): string =>
  readFileSync(new URL(`./fixtures/gd/${rel}`, import.meta.url), "utf-8");

/** Findings rendered as "ruleId@line:col:severity" for exact comparisons. */
async function lint(source: string, file = "x.gd"): Promise<string[]> {
  const findings = await lintSource(file, source, config);
  return findings.map((f) => `${f.ruleId}@${f.line}:${f.col}:${f.severity}`);
}

describe("exact findings per rule fixture", () => {
  const expected: Record<string, string[]> = {
    "await-misuse.gd": ["await-misuse@4:2:warning"],
    "connect-without-disconnect.gd": ["connect-without-disconnect@4:10:info"],
    "delta-misuse.gd": ["delta-misuse@6:2:error", "delta-misuse@10:2:info"],
    "float-grid-equality.gd": ["float-grid-equality@4:5:info", "float-grid-equality@6:5:info"],
    "get-node-in-process.gd": [
      "get-node-in-process@4:11:warning",
      "get-node-in-process@8:2:warning",
      "stringly-nodepath@8:19:info",
    ],
    "missing-onready.gd": [
      "missing-onready@3:1:warning",
      "untyped-declaration@3:1:warning",
      "untyped-declaration@4:1:warning",
    ],
    "stringly-nodepath.gd": ["stringly-nodepath@4:20:info", "stringly-nodepath@5:20:info"],
    "untyped-declaration.gd": ["untyped-declaration@3:1:warning"],
    "clean.gd": [],
  };
  for (const [file, want] of Object.entries(expected)) {
    it(file, async () => {
      expect(await lint(gd(file), file)).toEqual(want);
    });
  }
});

/** Near-miss code that looks like each anti-pattern but is correct. */
describe("near-miss negatives", () => {
  const cases: [rule: string, source: string][] = [
    ["get-node-in-process", "extends Node\n\nfunc _ready() -> void:\n\tvar s: Sprite2D = $Sprite2D\n\ts.visible = true\n"],
    ["missing-onready", "extends Node\n\n@onready var label: Label = $Label\n"],
    ["missing-onready", "extends Node\n\n@onready\nvar label: Label = $Label\n"],
    ["missing-onready", 'extends Node\n\n@onready\n@warning_ignore("unused_private_class_variable")\nvar _l: Label = $Label\n'],
    ["await-misuse", "extends Node\n\nfunc f() -> void:\n\tawait get_tree().create_timer(1.0).timeout\n"],
    [
      "connect-without-disconnect",
      "extends Node\n\nfunc _ready() -> void:\n\tpressed.connect(_on_pressed)\n\n" +
        "func _exit_tree() -> void:\n\tpressed.disconnect(_on_pressed)\n\n" +
        "func _on_pressed() -> void:\n\tpass\n",
    ],
    [
      "delta-misuse",
      "extends CharacterBody2D\n\nconst SPEED := 300.0\n\n" +
        "func _physics_process(_delta: float) -> void:\n\tvelocity = Vector2.RIGHT * SPEED\n\tmove_and_slide()\n",
    ],
    [
      // Godot's stock "CharacterBody2D: Basic Movement" template.
      "delta-misuse",
      "extends CharacterBody2D\n\nconst SPEED = 300.0\nconst JUMP_VELOCITY = -400.0\n\n" +
        "func _physics_process(delta: float) -> void:\n\tif not is_on_floor():\n\t\tvelocity += get_gravity() * delta\n" +
        "\tif Input.is_action_just_pressed(\"ui_accept\") and is_on_floor():\n\t\tvelocity.y = JUMP_VELOCITY\n" +
        "\tvar direction := Input.get_axis(\"ui_left\", \"ui_right\")\n\tif direction:\n\t\tvelocity.x = direction * SPEED\n" +
        "\telse:\n\t\tvelocity.x = move_toward(velocity.x, 0, SPEED)\n\tmove_and_slide()\n",
    ],
    [
      // Stock CharacterBody3D template gravity line.
      "delta-misuse",
      "extends CharacterBody3D\n\nfunc _physics_process(delta: float) -> void:\n" +
        "\tif not is_on_floor():\n\t\tvelocity += get_gravity() * delta\n\tmove_and_slide()\n",
    ],
    [
      "delta-misuse",
      "extends CharacterBody2D\n\nconst G := 980.0\nconst FRICTION := 600.0\n\n" +
        "func _physics_process(delta: float) -> void:\n\tvelocity.y += G * delta\n\tvelocity -= velocity * 0.1 * delta\n" +
        "\tvelocity.x = move_toward(velocity.x, 0, FRICTION * delta)\n" +
        "\tvelocity = velocity.lerp(Vector2.ZERO, 5.0 * delta)\n\tmove_and_slide()\n",
    ],
    [
      "float-grid-equality",
      "extends Node\n\nfunc f(x: float, n: int) -> bool:\n\tif is_equal_approx(x, 0.5):\n\t\treturn true\n\treturn n == 5\n",
    ],
    ["untyped-declaration", "extends Node\n\nvar a: int = 1\nvar b := 2\n"],
    ["stringly-nodepath", "extends Node\n\nfunc f() -> void:\n\tvar s: Node = $Player/Sprite\n\ts.show()\n"],
  ];
  for (const [rule, source] of cases) {
    it(`${rule} stays quiet`, async () => {
      const hits = (await lint(source)).filter((f) => f.startsWith(`${rule}@`));
      expect(hits).toEqual([]);
    });
  }
});

describe("delta-misuse true positives", () => {
  const body = (line: string) =>
    `extends CharacterBody2D\n\nconst SPEED := 300.0\n\nfunc _physics_process(delta: float) -> void:\n\tvar dir := Vector2.RIGHT\n\t${line}\n\tmove_and_slide()\n`;
  for (const line of ["velocity = dir * SPEED * delta", "self.velocity = dir * delta", "velocity = delta * dir * SPEED"]) {
    it(`flags ${line}`, async () => {
      expect((await lint(body(line))).filter((f) => f.startsWith("delta-misuse@"))).toEqual([
        "delta-misuse@7:2:error",
      ]);
    });
  }

  it("is quiet without move_and_slide()", async () => {
    const src = "extends Node2D\n\nfunc _physics_process(delta: float) -> void:\n\tvar velocity := Vector2.RIGHT * 10.0 * delta\n";
    expect((await lint(src)).filter((f) => f.startsWith("delta-misuse@"))).toEqual([]);
  });
});

describe("missing-onready own-line annotations", () => {
  it("still flags a declaration whose preceding annotation is not @onready", async () => {
    const src = 'extends Node\n\n@export_group("UI")\nvar label: Label = $Label\n';
    expect((await lint(src)).filter((f) => f.startsWith("missing-onready@"))).toEqual([
      "missing-onready@4:1:warning",
    ]);
  });

  it("does not borrow an @onready from an earlier, separate declaration", async () => {
    const src = "extends Node\n\n@onready\nvar a: Label = $A\nvar b: Label = $B\n";
    expect((await lint(src)).filter((f) => f.startsWith("missing-onready@"))).toEqual([
      "missing-onready@5:1:warning",
    ]);
  });
});

describe("robust input", () => {
  it("empty file yields no findings", async () => {
    expect(await lint("")).toEqual([]);
  });

  it("CRLF line endings give the same positions as LF", async () => {
    const lf = gd("delta-misuse.gd");
    expect(await lint(lf.replace(/\r?\n/g, "\r\n"))).toEqual(await lint(lf.replace(/\r\n/g, "\n")));
  });

  it("syntax errors do not throw", async () => {
    await expect(lint("extends Node\nfunc f(:\n\t\t  var = = \n)))\n")).resolves.toBeInstanceOf(Array);
  });
});
