import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/lint/config.js";
import { lintSource } from "../src/lint/engine.js";

async function lint(source: string, raw = {}): Promise<string[]> {
  const findings = await lintSource("x.gd", source, resolveConfig(raw));
  return findings.map((f) => `${f.ruleId}@${f.line}:${f.severity}`);
}

describe("inline suppressions", () => {
  it("baseline: the untyped var is reported", async () => {
    expect(await lint("var a = 1\n")).toEqual(["untyped-declaration@1:warning"]);
  });

  it("same-line directive with a rule id", async () => {
    expect(await lint("var a = 1  # gdcorrect-ignore[untyped-declaration]\n")).toEqual([]);
  });

  it("comment-only line applies to the next line only", async () => {
    const src = "# gdcorrect-ignore[untyped-declaration]\nvar a = 1\nvar b = 2\n";
    expect(await lint(src)).toEqual(["untyped-declaration@3:warning"]);
  });

  it("bare directive silences every rule on its line", async () => {
    expect(await lint("var a = 1  # gdcorrect-ignore\n")).toEqual([]);
  });

  it("a directive for a different rule does not silence the finding and is reported unused", async () => {
    expect(await lint("var a = 1  # gdcorrect-ignore[await-misuse]\n")).toEqual([
      "untyped-declaration@1:warning",
      "unused-suppression@1:info",
    ]);
  });

  it("file-wide directive, with several ids", async () => {
    const src = "# gdcorrect-ignore-file[untyped-declaration, missing-onready]\nextends Node\nvar a = $A\n";
    expect(await lint(src)).toEqual([]);
  });

  it("unused-suppression can be disabled or re-severitied in config", async () => {
    const src = "var a: int = 1  # gdcorrect-ignore\n";
    expect(await lint(src)).toEqual(["unused-suppression@1:info"]);
    expect(await lint(src, { rules: { "unused-suppression": { enabled: false } } })).toEqual([]);
    expect(await lint(src, { rules: { "unused-suppression": { severity: "warning" } } })).toEqual([
      "unused-suppression@1:warning",
    ]);
  });
});
