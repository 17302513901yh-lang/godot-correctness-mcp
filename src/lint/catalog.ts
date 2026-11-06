import { DEFAULT_RULES } from "./rules/index.js";
import { UNUSED_SUPPRESSION_RULE } from "./suppressions.js";
import type { Severity } from "./types.js";

/** A rule id any checker can report, with its default severity and a one-line description. */
export interface RuleInfo {
  id: string;
  /** Which pass reports it: GDScript lint rules or the scene/project/registry checks. */
  pillar: "lint" | "scenes";
  defaultSeverity: Severity;
  description: string;
}

/** Rule ids reported by the scene, project and registry checks (not GDScript lint rules). */
export const SCENE_RULES: readonly RuleInfo[] = [
  ["scene-missing-ext-resource-id", "error", "ExtResource(\"id\") reference with no matching [ext_resource]."],
  ["scene-duplicate-resource-id", "error", "Two [ext_resource] sections share an id."],
  ["scene-ext-resource-missing", "error", "[ext_resource] path (or its uid target) does not exist."],
  ["scene-ext-resource-path-stale", "warning", "[ext_resource] path is missing but its uid resolves elsewhere."],
  ["scene-ext-resource-uid-mismatch", "warning", "[ext_resource] uid belongs to a different file than its path."],
  ["scene-ext-resource-uid-unknown", "warning", "uid-only [ext_resource] matches no uid in the project."],
  ["scene-missing-sub-resource-id", "error", "SubResource(\"id\") reference with no matching [sub_resource]."],
  ["scene-node-parent-missing", "error", "[node] parent path is not declared in the scene."],
  ["scene-connection-method-missing", "error", "[connection] targets a method that does not exist on the target script."],
  ["scene-node-path-missing", "warning", "$Path / get_node(\"...\") literal does not exist in a scene using the script."],
  ["project-missing", "error", "No project.godot at the project root."],
  ["project-main-scene-missing", "error", "run/main_scene does not resolve to an existing scene."],
  ["project-autoload-missing", "error", "[autoload] entry points at a missing file."],
  ["project-input-malformed", "warning", "[input] action is not a well-formed dictionary."],
  ["project-input-action-undefined", "warning", "Input action name used in a script is not defined in [input]."],
  ["registry-parse-error", "error", "Registry .tres is not a valid Godot text resource."],
  ["registry-script-missing", "error", "Registry resource script does not resolve to an existing .gd."],
  ["registry-dangling-path", "error", "Registry property that looks like a resource path points at a missing file."],
  ["registry-dir-missing", "error", "registryDirs entry does not exist or lies outside the project root."],
].map(([id, defaultSeverity, description]) => ({
  id: id as string,
  pillar: "scenes" as const,
  defaultSeverity: defaultSeverity as Severity,
  description: description as string,
}));

/** Every rule id gdcorrect can report, lint rules first, in stable order. */
export const ALL_RULES: readonly RuleInfo[] = [
  ...DEFAULT_RULES.map((r) => ({
    id: r.id,
    pillar: "lint" as const,
    defaultSeverity: r.defaultSeverity,
    description: r.description,
  })),
  {
    id: UNUSED_SUPPRESSION_RULE,
    pillar: "lint",
    defaultSeverity: "info",
    description: "A gdcorrect-ignore comment that silenced nothing.",
  },
  ...SCENE_RULES,
];

export const RULE_INFO: ReadonlyMap<string, RuleInfo> = new Map(ALL_RULES.map((r) => [r.id, r]));

/** Ids reported by the scene/project/registry checks rather than the lint pass. */
export const SCENE_RULE_IDS: ReadonlySet<string> = new Set(SCENE_RULES.map((r) => r.id));
