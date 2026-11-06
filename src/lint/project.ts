import { readSource, scriptFiles } from "../project/files.js";
import { loadConfig, type ResolvedConfig } from "./config.js";
import { lintSource } from "./engine.js";
import type { Finding } from "./types.js";

export interface ProjectLintResult {
  root: string;
  /** Godot version declared in project.godot (also the default removed-api-usage target), or null. */
  godotVersion: string | null;
  fileCount: number;
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

/** Walk a project root, lint every included .gd file, and aggregate findings. */
export async function lintProject(
  root: string,
  config?: ResolvedConfig,
  opts: {
    /**
     * Restrict linting to these root-relative POSIX paths (intersected with
     * include/exclude). Undefined lints every included file.
     */
    only?: Iterable<string>;
  } = {},
): Promise<ProjectLintResult> {
  const cfg = config ?? loadConfig(root);
  const only = opts.only ? new Set(opts.only) : null;
  const files = scriptFiles(root, cfg).filter(({ rel }) => !only || only.has(rel));

  const findings: Finding[] = [];
  for (const { full, rel } of files) {
    const source = readSource(root, cfg, full);
    findings.push(...(await lintSource(rel, source, cfg)));
  }

  findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col,
  );

  return {
    root,
    godotVersion: cfg.projectGodotVersion,
    fileCount: files.length,
    findings,
    errorCount: findings.filter((f) => f.severity === "error").length,
    warningCount: findings.filter((f) => f.severity === "warning").length,
    infoCount: findings.filter((f) => f.severity === "info").length,
  };
}
