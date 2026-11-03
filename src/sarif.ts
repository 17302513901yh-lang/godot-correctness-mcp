import { join, relative } from "node:path";
import { RULES_BY_ID } from "./lint/rules/index.js";
import { UNUSED_SUPPRESSION_RULE } from "./lint/suppressions.js";
import type { Finding, Severity } from "./lint/types.js";
import { toPosix } from "./project/walk.js";

const LEVEL: Record<Severity, "error" | "warning" | "note"> = {
  error: "error",
  warning: "warning",
  info: "note",
};

function ruleDescription(id: string): string {
  if (id === UNUSED_SUPPRESSION_RULE) return "A gdcorrect-ignore comment that silenced nothing.";
  return RULES_BY_ID.get(id)?.description ?? id;
}

/**
 * Render findings as a SARIF 2.1.0 log (for GitHub code scanning and other
 * SARIF consumers). Finding paths are project-relative; `projectRoot` and
 * `cwd` re-base them onto the directory the tool ran from, which is what
 * code-scanning upload expects (usually the repository root).
 */
export function toSarif(
  findings: Finding[],
  opts: { projectRoot: string; version: string; cwd?: string },
): object {
  const cwd = opts.cwd ?? process.cwd();
  const ruleIds = [...new Set(findings.map((f) => f.ruleId))].sort();
  const ruleIndex = new Map(ruleIds.map((id, i) => [id, i]));
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "gdcorrect",
            version: opts.version,
            informationUri: "https://github.com/TMHSDigital/godot-correctness-mcp",
            rules: ruleIds.map((id) => ({
              id,
              shortDescription: { text: ruleDescription(id) },
            })),
          },
        },
        results: findings.map((f) => ({
          ruleId: f.ruleId,
          ruleIndex: ruleIndex.get(f.ruleId),
          level: LEVEL[f.severity],
          message: { text: f.suggestion ? `${f.message} ${f.suggestion}` : f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: toPosix(relative(cwd, join(opts.projectRoot, f.file))),
                  uriBaseId: "%SRCROOT%",
                },
                region: { startLine: f.line, startColumn: f.col },
              },
            },
          ],
        })),
      },
    ],
  };
}
