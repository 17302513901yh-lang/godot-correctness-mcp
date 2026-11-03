import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findProjectRoot, loadConfig } from "../lint/config.js";
import { lintSource } from "../lint/engine.js";
import { lintProject } from "../lint/project.js";
import { requireDir } from "../project/walk.js";
import { guard } from "./result.js";

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
        "from godot-correctness.config.json. Returns aggregated findings and severity counts.",
      inputSchema: {
        path: z.string().min(1).describe("Path to the Godot project root"),
      },
      annotations: READ_ONLY,
    },
    async ({ path }) =>
      guard(() => {
        requireDir(path);
        return lintProject(path);
      }),
  );
}
