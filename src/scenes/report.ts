import { loadConfig, type ResolvedConfig } from "../lint/config.js";
import { lintProject } from "../lint/project.js";
import type { Finding } from "../lint/types.js";
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

/** Aggregate every static check (scenes, project config, registries, lint). */
export async function projectReport(
  root: string,
  config?: ResolvedConfig,
): Promise<ProjectReport> {
  const cfg = config ?? loadConfig(root);
  const scenes = validateScenes(root, cfg);
  const project = validateProjectConfig(root, cfg);
  const reg = validateRegistries(root, cfg);
  const lint = (await lintProject(root, cfg)).findings;

  const all = [...scenes, ...project, ...reg.findings, ...lint];
  return {
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
}
