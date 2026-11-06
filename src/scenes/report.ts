import { loadConfig, type ResolvedConfig } from "../lint/config.js";
import { lintProject } from "../lint/project.js";
import type { Finding } from "../lint/types.js";
import { validateNodePaths } from "./node-paths.js";
import {
  validateProjectConfig,
  validateRegistries,
  validateScenes,
  type RegistryEntry,
} from "./validate.js";

export interface ProjectReport {
  root: string;
  scenes: Finding[];
  project: Finding[];
  registries: Finding[];
  lint: Finding[];
  registryEntries: RegistryEntry[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  totalFindings: number;
}

/**
 * Every check behind validate_scenes / `gdcorrect validate-scenes`: .tscn
 * structure plus node-path literals in attached scripts. The CLI, the MCP tool
 * and the report all call this, so a new scene check is wired in one place.
 */
export async function validateSceneFiles(root: string, config?: ResolvedConfig): Promise<Finding[]> {
  const cfg = config ?? loadConfig(root);
  return [...validateScenes(root, cfg), ...(await validateNodePaths(root, cfg))];
}

/** Every finding in a report, across all categories. */
export function reportFindings(r: ProjectReport): Finding[] {
  return [...r.scenes, ...r.project, ...r.registries, ...r.lint];
}

/** Aggregate every static check (scenes, project config, registries, lint). */
export async function projectReport(
  root: string,
  config?: ResolvedConfig,
): Promise<ProjectReport> {
  const cfg = config ?? loadConfig(root);
  const scenes = await validateSceneFiles(root, cfg);
  const project = validateProjectConfig(root, cfg);
  const reg = validateRegistries(root, cfg);
  const lint = (await lintProject(root, cfg)).findings;

  const all = [...scenes, ...project, ...reg.findings, ...lint];
  const report: ProjectReport = {
    root,
    scenes,
    project,
    registries: reg.findings,
    lint,
    registryEntries: reg.entries,
    errorCount: all.filter((f) => f.severity === "error").length,
    warningCount: all.filter((f) => f.severity === "warning").length,
    infoCount: all.filter((f) => f.severity === "info").length,
    totalFindings: all.length,
  };
  return report;
}
