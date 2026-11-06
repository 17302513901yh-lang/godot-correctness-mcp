import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { Finding, Severity } from "./types.js";

export const CONFIG_FILENAME = "godot-correctness.config.json";

const severitySchema = z.enum(["error", "warning", "info"]);

const ruleConfigSchema = z.object({
  enabled: z.boolean().optional(),
  severity: severitySchema.optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});
export type RuleConfig = z.infer<typeof ruleConfigSchema>;

export const configSchema = z
  .object({
    /** Optional JSON schema pointer for editors; ignored. */
    $schema: z.string().optional(),
    /** Free-form comment; ignored. */
    $comment: z.string().optional(),
    /** Globs (relative to project root) of files to lint. */
    include: z.array(z.string()).optional(),
    /** Globs to exclude. */
    exclude: z.array(z.string()).optional(),
    /** Per-rule enable/disable, severity override, and options. */
    rules: z.record(z.string(), ruleConfigSchema).optional(),
    /** Directories of data-driven .tres registries to deep-validate. */
    registryDirs: z.array(z.string()).optional(),
    /** Property-name globs to treat as resource paths. */
    pathPropertyPatterns: z.array(z.string()).optional(),
  })
  // Reject unknown keys so a typo like "exlude" fails loudly instead of being ignored.
  .strict();
export type GodotCorrectnessConfig = z.infer<typeof configSchema>;

export const DEFAULT_INCLUDE = ["**/*.gd"];
export const DEFAULT_EXCLUDE = ["**/.godot/**"];
export const DEFAULT_PATH_PROPERTY_PATTERNS = ["*_path", "*_scene", "*_texture", "*_resource"];

/** A fully-resolved config with defaults applied. */
export interface ResolvedConfig {
  include: string[];
  exclude: string[];
  rules: Record<string, RuleConfig>;
  registryDirs: string[];
  pathPropertyPatterns: string[];
}

export function resolveConfig(raw: GodotCorrectnessConfig = {}): ResolvedConfig {
  return {
    include: raw.include ?? DEFAULT_INCLUDE,
    exclude: raw.exclude ?? DEFAULT_EXCLUDE,
    rules: raw.rules ?? {},
    registryDirs: raw.registryDirs ?? [],
    pathPropertyPatterns: raw.pathPropertyPatterns ?? DEFAULT_PATH_PROPERTY_PATTERNS,
  };
}

/** Load and validate the config from a project root, or defaults when absent. */
export function loadConfig(projectRoot: string): ResolvedConfig {
  const path = join(projectRoot, CONFIG_FILENAME);
  if (!existsSync(path)) return resolveConfig();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`Invalid ${CONFIG_FILENAME} at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid ${CONFIG_FILENAME} at ${path}: ${issues}`);
  }
  return resolveConfig(parsed.data);
}

/**
 * Find the project root for a file: the nearest ancestor directory (starting at
 * `startDir`) containing a config file or project.godot. Null when none exists.
 */
export function findProjectRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILENAME)) || existsSync(join(dir, "project.godot"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Whether a rule is enabled (default: enabled unless explicitly disabled). */
export function isRuleEnabled(config: ResolvedConfig, ruleId: string): boolean {
  return config.rules[ruleId]?.enabled !== false;
}

/** Config severity override for a rule, if any. */
export function severityOverride(config: ResolvedConfig, ruleId: string): Severity | undefined {
  return config.rules[ruleId]?.severity;
}

/**
 * Apply `rules.<id>.enabled` and `rules.<id>.severity` to findings from any
 * checker. The lint pass applies these itself; the scene, project and registry
 * checks run their findings through here.
 */
export function applyRuleConfig(findings: Finding[], config: ResolvedConfig): Finding[] {
  const out: Finding[] = [];
  for (const f of findings) {
    if (!isRuleEnabled(config, f.ruleId)) continue;
    const severity = severityOverride(config, f.ruleId);
    out.push(severity ? { ...f, severity } : f);
  }
  return out;
}

/** Per-rule options from config. */
export function ruleOptions(config: ResolvedConfig, ruleId: string): Record<string, unknown> {
  return config.rules[ruleId]?.options ?? {};
}
