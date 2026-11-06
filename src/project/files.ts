import { readFileSync } from "node:fs";
import picomatch from "picomatch";
import type { ResolvedConfig } from "../lint/config.js";
import { walkProject, type WalkedFile } from "./walk.js";

/**
 * Per-run file index shared by every check that reads project files.
 *
 * Keyed by the resolved config object: one `gdcorrect` command or one
 * `project_report` call loads the config once and passes it to every check, so
 * they all share one walk per extension and one read per file. A new MCP call
 * loads a fresh config and therefore sees fresh files.
 */
interface RunIndex {
  walks: Map<string, WalkedFile[]>;
  sources: Map<string, string>;
}

const runs = new WeakMap<ResolvedConfig, Map<string, RunIndex>>();

function runIndex(root: string, cfg: ResolvedConfig): RunIndex {
  let perRoot = runs.get(cfg);
  if (!perRoot) runs.set(cfg, (perRoot = new Map()));
  let idx = perRoot.get(root);
  if (!idx) perRoot.set(root, (idx = { walks: new Map(), sources: new Map() }));
  return idx;
}

/** Files with `ext` under the root, with `exclude` applied (and pruning excluded dirs). */
export function projectFiles(root: string, cfg: ResolvedConfig, ext: string): WalkedFile[] {
  const idx = runIndex(root, cfg);
  let files = idx.walks.get(ext);
  if (!files) {
    files = walkProject(root, { exts: [ext], exclude: picomatch(cfg.exclude, { dot: true }) });
    idx.walks.set(ext, files);
  }
  return files;
}

/**
 * The GDScript files every `.gd` check looks at: `include` and `exclude`
 * applied. Lint, node-path and input-action checks all use this, so narrowing
 * `include` scopes all of them consistently.
 */
export function scriptFiles(root: string, cfg: ResolvedConfig): WalkedFile[] {
  const isIncluded = picomatch(cfg.include, { dot: true });
  return projectFiles(root, cfg, ".gd").filter(({ rel }) => isIncluded(rel));
}

/** File contents, read at most once per run. */
export function readSource(root: string, cfg: ResolvedConfig, full: string): string {
  const idx = runIndex(root, cfg);
  let src = idx.sources.get(full);
  if (src === undefined) {
    src = readFileSync(full, "utf-8");
    idx.sources.set(full, src);
  }
  return src;
}
