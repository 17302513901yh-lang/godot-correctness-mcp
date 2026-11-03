import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const tmp = mkdtempSync(join(tmpdir(), "gdc-baseline-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const noop = (): void => {};
const ERROR_GD =
  "extends CharacterBody2D\n\nconst SPEED := 300.0\n\n" +
  "func _physics_process(delta: float) -> void:\n\tvelocity = Vector2.RIGHT * SPEED * delta\n\tmove_and_slide()\n";

function setup(name: string): { root: string; baseline: string } {
  const root = join(tmp, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "player.gd"), ERROR_GD);
  return { root, baseline: join(tmp, `${name}.baseline.json`) };
}

async function json(argv: string[]): Promise<{ code: number; out: any }> {
  let out = "";
  const code = await runCli(argv, (s) => (out += s), noop);
  return { code, out: out ? JSON.parse(out) : null };
}

describe("baseline", () => {
  it("--write-baseline records findings and exits 0", async () => {
    const { root, baseline } = setup("write");
    expect((await json(["lint", root])).code).toBe(1);
    expect(await runCli(["lint", root, "--write-baseline", baseline], noop, noop)).toBe(0);
    const b = JSON.parse(readFileSync(baseline, "utf-8"));
    expect(b.version).toBe(1);
    expect(b.entries.some((e: any) => e.ruleId === "delta-misuse" && e.file === "player.gd")).toBe(true);
  });

  it("--baseline passes an unchanged project, even after lines shift", async () => {
    const { root, baseline } = setup("shift");
    await runCli(["lint", root, `--write-baseline=${baseline}`], noop, noop);
    let r = await json(["lint", root, "--baseline", baseline]);
    expect(r.code).toBe(0);
    expect(r.out.findings).toEqual([]);
    expect(r.out.baselined).toBeGreaterThan(0);

    writeFileSync(join(root, "player.gd"), `# a new header comment\n\n${ERROR_GD}`);
    r = await json(["lint", root, "--baseline", baseline]);
    expect(r.code).toBe(0);
  });

  it("fails on a newly introduced error and reports only the new finding", async () => {
    const { root, baseline } = setup("new");
    await runCli(["lint", root, "--write-baseline", baseline], noop, noop);
    writeFileSync(
      join(root, "enemy.gd"),
      ERROR_GD.replace("CharacterBody2D", "CharacterBody3D").replace("Vector2", "Vector3"),
    );
    const r = await json(["lint", root, "--baseline", baseline]);
    expect(r.code).toBe(1);
    expect(r.out.findings.every((f: any) => f.file === "enemy.gd")).toBe(true);
  });

  it("counts fixed findings as stale entries", async () => {
    const { root, baseline } = setup("stale");
    await runCli(["lint", root, "--write-baseline", baseline], noop, noop);
    writeFileSync(join(root, "player.gd"), "extends Node\n");
    const r = await json(["lint", root, "--baseline", baseline]);
    expect(r.code).toBe(0);
    expect(r.out.staleBaselineEntries).toBeGreaterThan(0);
  });

  it("rejects a missing or invalid baseline and conflicting flags with exit 2", async () => {
    const { root, baseline } = setup("bad");
    expect(await runCli(["lint", root, "--baseline", join(tmp, "nope.json")], noop, noop)).toBe(2);
    writeFileSync(baseline, "{}");
    expect(await runCli(["lint", root, "--baseline", baseline], noop, noop)).toBe(2);
    expect(await runCli(["lint", root, "--baseline", baseline, "--write-baseline", baseline], noop, noop)).toBe(2);
  });
});
