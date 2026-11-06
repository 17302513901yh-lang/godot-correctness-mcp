import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findProjectRoot, loadConfig } from "../lint/config.js";
import { lintSource } from "../lint/engine.js";
import { lintProject } from "../lint/project.js";
import { requireDir } from "../project/walk.js";
import { baselineFindings } from "../baseline.js";
import { effectiveRules } from "../lint/catalog.js";
import { guard } from "./result.js";
import { BASELINE_ARG } from "./scenes.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** Register the GDScript lint tools (lint_file, lint_project). */
export function registerLintTools(server: McpServer): void {
  server.registerTool(
    "lint_file",
    {
      description:
        "Lint a single GDScript (.gd) file against the default ruleset. 'path' is required; " +
        "pass 'source' to lint unsaved text instead of reading the file. Config is loaded " +
        "from the nearest ancestor directory containing godot-correctness.config.json or " +
        "project.godot (the project root), the same config lint_project uses. Returns a " +
        "findings array.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Path to the .gd file (used for the reported location and config lookup)"),
        source: z.string().optional().describe("Inline GDScript source; if omitted, the file at 'path' is read"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path, source }) =>
      guard(async () => {
        const abs = resolve(path);
        const code = source ?? readFileSync(abs, "utf-8");
        const root = findProjectRoot(dirname(abs));
        const config = loadConfig(root ?? dirname(abs));
        // Report project-relative POSIX paths, matching lint_project.
        const file = root ? relative(root, abs).split(sep).join("/") : path;
        const findings = await lintSource(file, code, config);
        return { file, root, findings, count: findings.length };
      }),
  );

  server.registerTool(
    "lint_project",
    {
      description:
        "Lint every GDScript file under a project root, honoring include/exclude globs " +
        "from godot-correctness.config.json. Returns aggregated findings and severity counts, " +
        "and the Godot version project.godot declares. Pass 'baseline' to see only new findings.",
      inputSchema: {
        path: z.string().min(1).describe("Path to the Godot project root"),
        baseline: BASELINE_ARG,
      },
      annotations: READ_ONLY,
    },
    async ({ path, baseline }) =>
      guard(async () => {
        requireDir(path);
        const r = await lintProject(path);
        if (!baseline) return r;
        const b = baselineFindings(path, baseline, r.findings);
        const count = (s: string): number => b.findings.filter((f) => f.severity === s).length;
        return {
          ...r,
          ...b,
          errorCount: count("error"),
          warningCount: count("warning"),
          infoCount: count("info"),
        };
      }),
  );

  server.registerTool(
    "list_rules",
    {
      description:
        "List every rule gdcorrect can report (GDScript lint rules and the scene, project, and " +
        "registry checks) with its description and default severity. Pass 'path' (a project " +
        "root) to also get the effective enabled/severity/options from that project's " +
        "godot-correctness.config.json and the Godot version project.godot declares.",
      inputSchema: {
        path: z.string().min(1).optional().describe("Optional Godot project root to resolve its config"),
      },
      annotations: READ_ONLY,
    },
    async ({ path }) =>
      guard(() => {
        if (!path) return { root: null, godotVersion: null, rules: effectiveRules() };
        requireDir(path);
        const cfg = loadConfig(path);
        return { root: path, godotVersion: cfg.projectGodotVersion, rules: effectiveRules(cfg) };
      }),
  );
}
