import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { isMainModule } from "../src/entry.js";

const dir = mkdtempSync(join(tmpdir(), "gdc-entry-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function trySymlink(target: string, link: string): boolean {
  try {
    symlinkSync(target, link, "file");
    return true;
  } catch {
    return false; // e.g. Windows without symlink privilege
  }
}

describe("isMainModule", () => {
  const real = join(dir, "real.js");
  writeFileSync(real, "");
  const url = pathToFileURL(real).href;

  it("matches the module's own path", () => {
    expect(isMainModule(url, real)).toBe(true);
  });

  it("is false with no argv[1] or a different file", () => {
    expect(isMainModule(url, undefined)).toBe(false);
    expect(isMainModule(url, join(dir, "other.js"))).toBe(false);
  });

  it("matches when invoked through a symlink (npm bin shims)", (ctx) => {
    const link = join(dir, "link.js");
    if (!trySymlink(real, link)) ctx.skip();
    expect(isMainModule(url, link)).toBe(true);
  });
});

describe("built CLI via symlink", () => {
  const cli = resolve("dist/cli.js");

  it("runs the command when launched through a symlink", (ctx) => {
    if (!existsSync(cli)) ctx.skip();
    const link = join(dir, "gdcorrect.js");
    if (!trySymlink(cli, link)) ctx.skip();
    const r = spawnSync(process.execPath, [link, "validate-project", resolve("test/fixtures/clean-project")], {
      encoding: "utf-8",
    });
    expect(r.stdout).toContain('"findings"');
  });
});
