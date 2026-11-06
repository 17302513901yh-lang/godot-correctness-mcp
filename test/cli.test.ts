import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const tmp = mkdtempSync(join(tmpdir(), "gdc-cli-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const LINT_PROJECT = resolve("test/fixtures/lint-project");
const CLEAN_PROJECT = resolve("test/fixtures/clean-project");
const VERSION = JSON.parse(readFileSync("package.json", "utf-8")).version as string;

function project(name: string, files: Record<string, string>): string {
  const root = join(tmp, name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await runCli(argv, (s) => (out += s + "\n"), (s) => (err += s + "\n"));
  return { code, out, err };
}

/** A project whose only findings are warnings (untyped declarations). */
const warningsOnly = (): string => project(`warn-${Math.random().toString(36).slice(2)}`, { "a.gd": "var a = 1\nvar b = 2\n" });

describe("argument errors", () => {
  it.each([
    [["lint", LINT_PROJECT, "--formt", "pretty"], "Unknown option: --formt"],
    [["lint", LINT_PROJECT, "--write-baselin", "out.json"], "Unknown option: --write-baselin"],
    [["lint", LINT_PROJECT, "--write-baseline"], "--write-baseline needs a value"],
    [["lint", LINT_PROJECT, "--baseline"], "--baseline needs a value"],
    [["lint", LINT_PROJECT, "--baseline="], "--baseline needs a value"],
    [["lint", LINT_PROJECT, "--format", "--baseline", "b.json"], "--format needs a value"],
    [["lint", LINT_PROJECT, "extra"], "Unexpected argument: extra"],
    [["lnt", LINT_PROJECT], "unknown command: lnt"],
  ])("%j exits 2 with a clear message", async (argv, message) => {
    const r = await cli(...argv);
    expect(r.code).toBe(2);
    expect(r.err).toContain(message);
    expect(r.out).toBe("");
  });

  it("does not write a baseline when the path is missing", async () => {
    const root = warningsOnly();
    expect((await cli("lint", root, "--write-baseline")).code).toBe(2);
  });

  it("rejects an unknown --fail-on level", async () => {
    const r = await cli("lint", LINT_PROJECT, "--fail-on", "warn");
    expect(r.code).toBe(2);
    expect(r.err).toContain("Unknown --fail-on level: warn");
  });
});

describe("--help and --version", () => {
  it.each([["--help"], ["-h"], ["help"], ["lint", "--help"]])("%j prints help to stdout and exits 0", async (...argv) => {
    const r = await cli(...argv);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage: gdcorrect <command> <projectPath>");
    expect(r.out).toContain("validate-registries");
    expect(r.out).toContain("--fail-on");
    expect(r.out).toContain("Exit codes:");
  });

  it.each([["--version"], ["-v"]])("%s prints the package version", async (flag) => {
    const r = await cli(flag);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(VERSION);
  });

  it("bare invocation prints usage to stderr and exits 2", async () => {
    const r = await cli();
    expect(r.code).toBe(2);
    expect(r.err).toContain("gdcorrect --help");
  });
});

describe("--fail-on", () => {
  it("defaults to error: warnings-only projects exit 0, error projects exit 1", async () => {
    expect((await cli("lint", warningsOnly())).code).toBe(0);
    expect((await cli("lint", LINT_PROJECT)).code).toBe(1);
  });

  it.each([
    ["warning", 1],
    ["info", 1],
    ["error", 0],
    ["none", 0],
  ] as const)("--fail-on %s on a warnings-only project exits %i", async (level, code) => {
    expect((await cli("lint", warningsOnly(), "--fail-on", level)).code).toBe(code);
    expect((await cli("lint", warningsOnly(), `--fail-on=${level}`)).code).toBe(code);
  });

  it("--fail-on none never fails on findings", async () => {
    expect((await cli("lint", LINT_PROJECT, "--fail-on", "none")).code).toBe(0);
  });
});

describe("pretty output", () => {
  it("groups by file, sorts by position, and ends with a summary", async () => {
    const root = project("pretty", {
      "b.gd": "var z = 1\n",
      "a.gd": "extends Node\nvar y = 2\nvar x = 1\n",
    });
    const r = await cli("lint", root, "--format", "pretty");
    expect(r.code).toBe(0);
    const lines = r.out.trimEnd().split("\n");
    expect(lines[0]).toBe("a.gd");
    expect(lines[1]).toMatch(/^ {2}2:1 {2}WARNING untyped-declaration$/);
    expect(lines[3]).toMatch(/^ {2}3:1 {2}WARNING untyped-declaration$/);
    expect(lines).toContain("b.gd");
    expect(lines.at(-1)).toBe("3 finding(s): 0 error(s), 3 warning(s), 0 info.");
  });

  it("-f pretty and --format=pretty match --format pretty", async () => {
    const a = await cli("lint", LINT_PROJECT, "--format", "pretty");
    expect((await cli("lint", LINT_PROJECT, "-f", "pretty")).out).toBe(a.out);
    expect((await cli("lint", LINT_PROJECT, "--format=pretty")).out).toBe(a.out);
  });

  it("prints an empty summary for a clean project", async () => {
    const r = await cli("lint", CLEAN_PROJECT, "--format", "pretty");
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("0 finding(s): 0 error(s), 0 warning(s), 0 info.");
  });
});

describe("baselines with other commands and formats", () => {
  const errorScript = "extends CharacterBody2D\n\nfunc _physics_process(delta: float) -> void:\n\tvelocity = Vector2.RIGHT * 10.0 * delta\n\tmove_and_slide()\n";

  it("conflicting --baseline and --write-baseline exit 2 even with a valid baseline", async () => {
    const root = warningsOnly();
    const b = join(root, "b.json");
    expect((await cli("lint", root, "--write-baseline", b)).code).toBe(0);
    const r = await cli("lint", root, "--baseline", b, "--write-baseline", join(root, "c.json"));
    expect(r.code).toBe(2);
    expect(r.err).toContain("not both");
  });

  it("report --baseline: the exit code reflects only new errors", async () => {
    const root = project("report-baseline", { "project.godot": "[application]\n", "p.gd": errorScript });
    const b = join(root, "b.json");
    expect((await cli("report", root)).code).toBe(1);
    expect((await cli("report", root, "--write-baseline", b)).code).toBe(0);
    const r = await cli("report", root, "--baseline", b);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ findings: [], count: 0, baselined: 1, staleBaselineEntries: 0 });
  });

  it("validate-scenes --baseline only reports new findings", async () => {
    const tscn = (id: string) => `[gd_scene format=3]\n\n[node name="R" type="Node"]\nv = ExtResource("${id}")\n`;
    const root = project("scenes-baseline", { "a.tscn": tscn("gone") });
    const b = join(root, "b.json");
    await cli("validate-scenes", root, "--write-baseline", b);
    writeFileSync(join(root, "b.tscn"), tscn("also_gone"));
    const r = await cli("validate-scenes", root, "--baseline", b);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).findings.map((f: { file: string }) => f.file)).toEqual(["b.tscn"]);
  });

  it("--baseline with --format sarif emits only new results", async () => {
    const root = project("sarif-baseline", { "a.gd": "var a = 1\n" });
    const b = join(root, "b.json");
    await cli("lint", root, "--write-baseline", b);
    writeFileSync(join(root, "c.gd"), "var c = 1\n");
    const r = await cli("lint", root, "--baseline", b, "--format", "sarif");
    const results = JSON.parse(r.out).runs[0].results;
    expect(results).toHaveLength(1);
    expect(results[0].locations[0].physicalLocation.artifactLocation.uri).toMatch(/c\.gd$/);
  });

  it("counts identical findings: a third copy of a twice-baselined line is one new finding", async () => {
    const root = project("dup-baseline", { "a.gd": "var a = 1\nvar a = 1\n" });
    const b = join(root, "b.json");
    await cli("lint", root, "--write-baseline", b);
    writeFileSync(join(root, "a.gd"), "var a = 1\nvar a = 1\nvar a = 1\n");
    const r = await cli("lint", root, "--baseline", b);
    expect(JSON.parse(r.out)).toMatchObject({ count: 1, baselined: 2 });
  });

  it("a baseline written from CRLF source still matches after converting to LF", async () => {
    const root = project("crlf-baseline", { "a.gd": "extends Node\r\nvar a = 1\r\n" });
    const b = join(root, "b.json");
    await cli("lint", root, "--write-baseline", b);
    writeFileSync(join(root, "a.gd"), "extends Node\nvar a = 1\n");
    expect(JSON.parse((await cli("lint", root, "--baseline", b)).out)).toMatchObject({ count: 0, baselined: 1 });
  });

  it("uses singular and plural wording for stale entries", async () => {
    const root = project("stale-grammar", { "a.gd": "var a = 1\nvar b = 2\n" });
    const b = join(root, "b.json");
    await cli("lint", root, "--write-baseline", b);
    writeFileSync(join(root, "a.gd"), "var a = 1\n");
    expect((await cli("lint", root, "--baseline", b)).err).toContain("1 baseline entry is stale");
    writeFileSync(join(root, "a.gd"), "extends Node\n");
    expect((await cli("lint", root, "--baseline", b)).err).toContain("2 baseline entries are stale");
  });
});

describe("--files and --changed-since", () => {
  const files = (out: string): string[] => [...new Set(JSON.parse(out).findings.map((f: { file: string }) => f.file))] as string[];

  it("--files lints only the named files (relative or absolute, comma-separated or repeated)", async () => {
    const root = project("files-flag", { "a.gd": "var a = 1\n", "b.gd": "var b = 1\n", "c/d.gd": "var d = 1\n" });
    expect(files((await cli("lint", root, "--files", join(root, "a.gd"))).out)).toEqual(["a.gd"]);
    expect(files((await cli("lint", root, "--files", `${join(root, "a.gd")},${join(root, "c/d.gd")}`)).out)).toEqual(["a.gd", "c/d.gd"]);
    expect(
      files((await cli("lint", root, "--files", join(root, "b.gd"), "--files", join(root, "c/d.gd"))).out),
    ).toEqual(["b.gd", "c/d.gd"]);
  });

  it("still applies include/exclude to --files", async () => {
    const root = project("files-exclude", {
      "godot-correctness.config.json": JSON.stringify({ exclude: ["vendor/**"] }),
      "vendor/v.gd": "var v = 1\n",
      "a.gd": "var a = 1\n",
    });
    expect(files((await cli("lint", root, "--files", join(root, "vendor/v.gd"))).out)).toEqual([]);
  });

  it("is rejected for non-lint commands and with --write-baseline", async () => {
    const root = project("files-reject", { "a.gd": "var a = 1\n" });
    expect((await cli("report", root, "--files", "a.gd")).code).toBe(2);
    expect((await cli("lint", root, "--files", "a.gd", "--write-baseline", join(root, "b.json"))).code).toBe(2);
  });

  it("--changed-since lints committed, uncommitted and untracked changes since a ref", async () => {
    const { execFileSync } = await import("node:child_process");
    const root = project("changed", { "old.gd": "var o = 1\n", "kept.gd": "var k = 1\n" });
    const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
    try {
      git("init", "-q");
    } catch {
      return; // git unavailable
    }
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
    writeFileSync(join(root, "committed.gd"), "var c = 1\n");
    git("add", "committed.gd");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "next");
    writeFileSync(join(root, "old.gd"), "var o = 2\n"); // uncommitted change
    writeFileSync(join(root, "new.gd"), "var n = 1\n"); // untracked
    const r = await cli("lint", root, "--changed-since", "HEAD~1");
    expect(r.code).toBe(0);
    expect(files(r.out).sort()).toEqual(["committed.gd", "new.gd", "old.gd"]);
    expect((await cli("lint", root, "--changed-since", "--bad")).code).toBe(2);
    expect((await cli("lint", root, "--changed-since", "no-such-ref")).code).toBe(2);
  });
});
