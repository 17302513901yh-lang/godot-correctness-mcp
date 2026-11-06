import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/lint/config.js";
import { lintSource } from "../src/lint/engine.js";
import { lintProject } from "../src/lint/project.js";

const RULE = "removed-api-usage";

async function hits(source: string, options: Record<string, unknown> = { targetVersion: "4.5" }): Promise<string[]> {
  const cfg = resolveConfig({ rules: { [RULE]: { options } } });
  return (await lintSource("x.gd", source, cfg))
    .filter((f) => f.ruleId === RULE)
    .map((f) => `${f.line}:${f.col} ${f.message}`);
}

describe("removed-api-usage (4.4 -> 4.5)", () => {
  it("is off unless targetVersion is set", async () => {
    const src = "extends Node\n\nfunc f() -> void:\n\tget_rpc_config()\n";
    const cfg = resolveConfig();
    expect((await lintSource("x.gd", src, cfg)).some((f) => f.ruleId === RULE)).toBe(false);
  });

  it("flags removed methods via bare calls, self, ClassName, typed vars, and typed params", async () => {
    const src =
      "extends Node\n\nvar rpc: JSONRPC = JSONRPC.new()\n\n" +
      "func f(n: Node) -> void:\n" +
      "\tget_rpc_config()\n" +
      "\tself.get_rpc_config()\n" +
      '\trpc.set_scope("a", null)\n' +
      "\tn.get_rpc_config()\n";
    expect(await hits(src)).toEqual([
      "6:2 Node.get_rpc_config (method) was removed in Godot 4.5 (present in 4.4).",
      "7:7 Node.get_rpc_config (method) was removed in Godot 4.5 (present in 4.4).",
      "8:6 JSONRPC.set_scope (method) was removed in Godot 4.5 (present in 4.4).",
      "9:4 Node.get_rpc_config (method) was removed in Godot 4.5 (present in 4.4).",
    ]);
  });

  it("stays quiet on unknown receivers, own methods, unchanged API, and additive optional params", async () => {
    const src =
      "extends Node2D\n\n" +
      "func get_rpc_config() -> Dictionary:\n\treturn {}\n\n" + // shadows the removed engine method
      "func f(other, font: Font) -> void:\n" +
      "\tget_rpc_config()\n" +
      "\tother.get_rpc_config()\n" + // untyped receiver
      "\tqueue_free()\n" +
      '\tdraw_char(font, Vector2.ZERO, "a", 16, Color.WHITE)\n'; // gained an optional param in 4.5
    expect(await hits(src)).toEqual([]);
  });

  it("flags overrides of virtuals whose parameter count changed", async () => {
    const src =
      "extends TextServerExtension\n\n" +
      "func _font_draw_glyph(a, b, c, d, e, f) -> void:\n\tpass\n";
    expect(await hits(src)).toEqual([
      "3:6 _font_draw_glyph() overrides TextServerExtension._font_draw_glyph, which takes 7 parameter(s) in Godot 4.5; this override declares 6.",
    ]);
  });

  it("does not flag virtuals that moved to a parent class", async () => {
    // 4.5 moved these OpenXR virtuals up to OpenXRExtensionWrapper; overrides still work.
    const src = "extends OpenXRExtensionWrapperExtension\n\nfunc _on_process() -> void:\n\tpass\n";
    expect(await hits(src)).toEqual([]);
  });

  it("flags overrides of virtuals missing in the target (downgrade 4.5 -> 4.4)", async () => {
    const src = "extends AStar2D\n\nfunc _filter_neighbor(from_id: int, neighbor_id: int) -> bool:\n\treturn false\n";
    expect(await hits(src, { targetVersion: "4.4", fromVersion: "4.5" })).toEqual([
      "3:6 _filter_neighbor() overrides AStar2D._filter_neighbor, a virtual removed in Godot 4.4; the engine will no longer call it.",
    ]);
  });

  it("rejects an invalid targetVersion with a clear error", async () => {
    await expect(hits("extends Node\n", { targetVersion: "3.6" })).rejects.toThrow(/targetVersion must be one of/);
  });
});

describe("removed-api-usage target inferred from project.godot", () => {
  const tmp = mkdtempSync(join(tmpdir(), "gdc-removed-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const SRC = "extends Node\n\nfunc f() -> void:\n\tget_rpc_config()\n";

  function project(name: string, features: string | null, config?: object): string {
    const root = join(tmp, name);
    mkdirSync(root, { recursive: true });
    const app = features === null ? "" : `config/features=PackedStringArray(${features})\n`;
    writeFileSync(join(root, "project.godot"), `config_version=5\n\n[application]\n\nconfig/name="X"\n${app}`);
    writeFileSync(join(root, "a.gd"), SRC);
    if (config) writeFileSync(join(root, "godot-correctness.config.json"), JSON.stringify(config));
    return root;
  }
  const ruleHits = async (root: string) => {
    const r = await lintProject(root);
    return { version: r.godotVersion, hits: r.findings.filter((f) => f.ruleId === RULE).map((f) => f.line) };
  };

  it("uses the declared project version with no config", async () => {
    expect(await ruleHits(project("v45", '"4.5", "Forward Plus"'))).toEqual({ version: "4.5", hits: [4] });
  });

  it("uses the newest pinned version for a newer project", async () => {
    expect(await ruleHits(project("v46", '"4.6", "Mobile"'))).toEqual({ version: "4.6", hits: [4] });
  });

  it("is off for projects with no version feature or an older version", async () => {
    expect(await ruleHits(project("none", null))).toEqual({ version: null, hits: [] });
    expect(await ruleHits(project("v44", '"4.4"'))).toEqual({ version: "4.4", hits: [] });
  });

  it("an explicit targetVersion or enabled:false wins over the inferred one", async () => {
    const off = project("off", '"4.5"', { rules: { [RULE]: { enabled: false } } });
    expect((await ruleHits(off)).hits).toEqual([]);
    const explicit = project("explicit", '"4.4"', { rules: { [RULE]: { options: { targetVersion: "4.5" } } } });
    expect((await ruleHits(explicit)).hits).toEqual([4]);
  });

  it("rejects a fromVersion that is not another pinned version", async () => {
    await expect(hits(SRC, { targetVersion: "4.5", fromVersion: "4.5" })).rejects.toThrow(/fromVersion/);
    await expect(hits(SRC, { targetVersion: "4.5", fromVersion: "3.6" })).rejects.toThrow(/fromVersion/);
  });
});
