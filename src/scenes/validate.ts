import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import picomatch from "picomatch";
import {
  parseGodotFile,
  resourceRefPattern,
  sectionsOfKind,
  type GodotFile,
  type GodotSection,
} from "../godot/text-format.js";
import { applyRuleConfig, CONFIG_FILENAME, loadConfig, type ResolvedConfig } from "../lint/config.js";
import type { Finding, Severity } from "../lint/types.js";
import { projectFiles, readSource } from "../project/files.js";
import { walkProject } from "../project/walk.js";
import { checkInputActionUsage } from "./input-actions.js";
import { existsInProject, isInsideRoot, looksLikeResourcePath, resolveResPath } from "./paths.js";
import { checkConnections, checkNodeParents, checkSubResourceRefs } from "./scene-graph.js";
import { buildUidIndex, normalizeResPath, type UidIndex } from "./uids.js";

function finding(
  file: string,
  line: number,
  ruleId: string,
  severity: Severity,
  message: string,
  suggestion: string,
): Finding {
  return { file, line, col: 1, ruleId, severity, message, suggestion };
}

/** Map of ext_resource id -> its declaration, plus duplicate detection. */
function extResourceIndex(file: GodotFile): {
  byId: Map<string, GodotSection>;
  duplicates: { id: string; section: GodotSection }[];
} {
  const byId = new Map<string, GodotSection>();
  const duplicates: { id: string; section: GodotSection }[] = [];
  for (const s of sectionsOfKind(file, "ext_resource")) {
    const id = s.attributes["id"]?.string ?? s.attributes["id"]?.raw;
    if (!id) continue;
    if (byId.has(id)) duplicates.push({ id, section: s });
    else byId.set(id, s);
  }
  return { byId, duplicates };
}

const EXT_REF_RE = resourceRefPattern("ExtResource");

/**
 * Collect all ExtResource("id") references in a section: header attributes
 * (e.g. `instance=ExtResource(...)` on nodes) and property values, including
 * references nested inside arrays, dictionaries, and constructors.
 */
function extRefs(section: GodotSection): { key: string; ref: string; line: number }[] {
  const refs: { key: string; ref: string; line: number }[] = [];
  const values = [...Object.entries(section.attributes), ...Object.entries(section.properties)];
  for (const [key, v] of values) {
    if (!v.raw.includes("ExtResource")) continue;
    for (const m of v.raw.matchAll(EXT_REF_RE)) {
      const ref = m[1] ?? m[2];
      if (!ref) continue;
      const offset = v.raw.slice(0, m.index).split("\n").length - 1;
      refs.push({ key, ref, line: v.line + offset });
    }
  }
  return refs;
}

/**
 * Build the uid index on first use. It deliberately ignores `exclude`, since
 * references into excluded folders (e.g. addons/) are still valid targets.
 */
function lazyUidIndex(root: string): () => UidIndex {
  let index: UidIndex | undefined;
  return () => (index ??= buildUidIndex(root, () => false));
}

/**
 * How Godot 4.4+ resolves a reference that may carry a `path` and/or a `uid`:
 * by uid first, falling back to the path.
 *
 * - `ok`: loads `loads` (path and uid, if both given, agree)
 * - `path-stale`: the path is missing but the uid resolves, so `loads` is the uid's file
 * - `uid-mismatch`: both exist but name different files; Godot loads the uid's file
 * - `uid-unknown`: uid-only reference whose uid matches nothing in the project
 * - `missing`: resolves to no existing file
 * - `unresolvable`: no path or uid we can check statically (e.g. `user://`)
 */
export interface RefResolution {
  status: "ok" | "path-stale" | "uid-mismatch" | "uid-unknown" | "missing" | "unresolvable";
  /** Absolute path Godot would load, when it resolves to an existing file. */
  loads: string | null;
  /** res:// target of the uid, when the uid is known. */
  uidTarget?: string;
}

export function resolveReference(
  root: string,
  path: string | undefined,
  uid: string | undefined,
  uids: () => UidIndex,
): RefResolution {
  const abs = path ? resolveResPath(root, path) : null;
  const pathOk = existsInProject(root, abs);
  if (!uid) {
    if (!abs) return { status: "unresolvable", loads: null };
    return pathOk ? { status: "ok", loads: abs } : { status: "missing", loads: null };
  }

  const target = uids().get(uid);
  const targetAbs = target ? resolveResPath(root, target) : null;
  const targetOk = existsInProject(root, targetAbs);

  if (path && abs) {
    if (!pathOk) {
      return targetOk
        ? { status: "path-stale", loads: targetAbs, uidTarget: target }
        : { status: "missing", loads: null, uidTarget: target };
    }
    if (target && targetOk && normalizeResPath(target) !== normalizeResPath(path)) {
      return { status: "uid-mismatch", loads: targetAbs, uidTarget: target };
    }
    return { status: "ok", loads: abs, uidTarget: target };
  }
  if (!target) return { status: "uid-unknown", loads: null };
  return targetOk ? { status: "ok", loads: targetAbs, uidTarget: target } : { status: "missing", loads: null, uidTarget: target };
}

/** A `res://` path or a `uid://` string, as used by run/main_scene and autoloads. */
function resolvePathOrUid(root: string, p: string, uids: () => UidIndex): RefResolution {
  return p.startsWith("uid://") ? resolveReference(root, undefined, p, uids) : resolveReference(root, p, undefined, uids);
}

/**
 * Check one ext_resource declaration. Godot 4.4+ loads by `uid` first and
 * falls back to `path`, so a stale path with a valid uid still loads (warning),
 * a uid that points somewhere other than `path` loads the uid's file (warning),
 * and only references that resolve nowhere are errors.
 */
function checkExtResource(
  root: string,
  rel: string,
  s: GodotSection,
  uids: () => UidIndex,
): Finding | null {
  const path = s.attributes["path"]?.string;
  const uidAttr = s.attributes["uid"]?.string;
  const uid = uidAttr?.startsWith("uid://") ? uidAttr : undefined;
  const r = resolveReference(root, path, uid, uids);
  const target = r.uidTarget;

  switch (r.status) {
    case "path-stale":
      return finding(rel, s.line, "scene-ext-resource-path-stale", "warning",
        `ext_resource path ${path} does not exist; Godot will load ${uid} from ${target} instead.`,
        `Update the path to ${target} (re-saving the scene in the editor does this).`);
    case "uid-mismatch":
      return finding(rel, s.line, "scene-ext-resource-uid-mismatch", "warning",
        `ext_resource uid ${uid} belongs to ${target}, but path is ${path}; Godot loads by uid, so ${target} is used.`,
        "Fix whichever side is wrong; usually the file was moved or duplicated outside the editor.");
    case "uid-unknown":
      return finding(rel, s.line, "scene-ext-resource-uid-unknown", "warning",
        `ext_resource ${uid} has no path and matches no .uid/.import/scene uid in the project.`,
        "Restore the referenced file (and its .uid/.import sidecar) or re-save the scene in the editor.");
    case "missing":
      return finding(rel, s.line, "scene-ext-resource-missing", "error",
        path
          ? `ext_resource path does not exist: ${path}` + (uid && target ? ` (and ${uid} points at missing ${target})` : "")
          : `ext_resource ${uid} points at ${target}, which does not exist.`,
        path ? "Fix the path or restore the missing file." : "Restore the missing file.");
    default:
      return null;
  }
}

/**
 * validate_scenes: ext_resource paths resolve, ExtResource/SubResource refs are
 * declared, no duplicate ids, node parents exist, and [connection] targets
 * have the named method.
 */
export function validateScenes(root: string, config?: ResolvedConfig): Finding[] {
  const cfg = config ?? loadConfig(root);
  const findings: Finding[] = [];
  const uids = lazyUidIndex(root);

  for (const { full, rel } of projectFiles(root, cfg, ".tscn")) {
    const file = parseGodotFile(readSource(root, cfg, full));
    const { byId, duplicates } = extResourceIndex(file);

    for (const { id, section } of duplicates) {
      findings.push(
        finding(rel, section.line, "scene-duplicate-resource-id", "error",
          `Duplicate ext_resource id "${id}".`,
          "Give each ext_resource a unique id."),
      );
    }

    for (const s of sectionsOfKind(file, "ext_resource")) {
      const f = checkExtResource(root, rel, s, uids);
      if (f) findings.push(f);
    }

    for (const section of file.sections.filter((s) => s.kind !== "ext_resource")) {
      for (const { ref, line } of extRefs(section)) {
        if (!byId.has(ref)) {
          findings.push(
            finding(rel, line, "scene-missing-ext-resource-id", "error",
              `ExtResource("${ref}") is not declared in this scene.`,
              "Add the ext_resource declaration or fix the id."),
          );
        }
      }
    }

    findings.push(
      ...checkSubResourceRefs(rel, file),
      ...checkNodeParents(rel, file),
      ...checkConnections(rel, file, root),
    );
  }
  return applyRuleConfig(findings, cfg);
}

/** validate_project_config: main scene, autoloads, input map, and input action usage. */
export function validateProjectConfig(root: string, config?: ResolvedConfig): Finding[] {
  const cfg = config ?? loadConfig(root);
  const projectPath = join(root, "project.godot");
  if (!existsSync(projectPath)) {
    return applyRuleConfig([finding("project.godot", 1, "project-missing", "error",
      "No project.godot found at the project root.", "Point the tool at a Godot project root.")], cfg);
  }
  const rel = "project.godot";
  const file = parseGodotFile(readFileSync(projectPath, "utf-8"));
  const findings: Finding[] = [];

  const app = file.sections.find((s) => s.kind === "application");
  const mainScene = app?.properties["run/main_scene"];
  const uids = lazyUidIndex(root);

  if (mainScene?.kind === "string" && mainScene.string) {
    const { status } = resolvePathOrUid(root, mainScene.string, uids);
    if (status === "missing") {
      findings.push(finding(rel, mainScene.line, "project-main-scene-missing", "error",
        `Main scene does not exist: ${mainScene.string}`, "Fix run/main_scene or restore the scene."));
    } else if (status === "uid-unknown") {
      findings.push(finding(rel, mainScene.line, "project-main-scene-missing", "warning",
        `Main scene ${mainScene.string} matches no scene uid in the project.`,
        "Point run/main_scene at an existing scene (res:// path or its uid)."));
    }
  }

  const autoload = file.sections.find((s) => s.kind === "autoload");
  if (autoload) {
    for (const [name, v] of Object.entries(autoload.properties)) {
      if (v.kind !== "string" || !v.string) continue;
      const p = v.string.replace(/^\*/, ""); // leading * marks an enabled singleton
      const { status } = resolvePathOrUid(root, p, uids);
      if (status === "missing") {
        findings.push(finding(rel, v.line, "project-autoload-missing", "error",
          `Autoload "${name}" points at a missing file: ${p}`,
          "Fix the autoload path or restore the file."));
      } else if (status === "uid-unknown") {
        findings.push(finding(rel, v.line, "project-autoload-missing", "warning",
          `Autoload "${name}" uses ${p}, which matches no uid in the project.`,
          "Point the autoload at an existing file (res:// path or its uid)."));
      }
    }
  }

  const input = file.sections.find((s) => s.kind === "input");
  findings.push(
    ...checkInputActionUsage(
      root,
      new Set(Object.keys(input?.properties ?? {})),
      cfg,
    ),
  );
  if (input) {
    for (const [name, v] of Object.entries(input.properties)) {
      if (!v.raw.trimStart().startsWith("{")) {
        findings.push(finding(rel, v.line, "project-input-malformed", "warning",
          `Input action "${name}" is not a well-formed action dictionary.`,
          "Each input action should be a { \"deadzone\": ..., \"events\": [...] } dictionary."));
      }
    }
  }
  return applyRuleConfig(findings, cfg);
}

function readClassName(gdAbsPath: string): string | null {
  try {
    const m = /^[ \t]*class_name[ \t]+(\w+)/m.exec(readFileSync(gdAbsPath, "utf-8"));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export interface RegistryEntry {
  file: string;
  scriptClass: string | null;
}

export interface RegistryResult {
  findings: Finding[];
  entries: RegistryEntry[];
}

/** validate_registries: parse, script resolution + class_name, dangling paths. */
export function validateRegistries(root: string, config?: ResolvedConfig): RegistryResult {
  const cfg = config ?? loadConfig(root);
  const exclude = picomatch(cfg.exclude, { dot: true });
  const findings: Finding[] = [];
  const entries: RegistryEntry[] = [];
  const uids = lazyUidIndex(root);

  for (const configured of cfg.registryDirs) {
    const dirRel = configured.replace(/^res:\/\//, "");
    const dirAbs = join(root, dirRel);
    if (!isInsideRoot(root, dirAbs)) {
      findings.push(finding(CONFIG_FILENAME, 1, "registry-dir-missing", "error",
        `registryDirs entry "${configured}" is outside the project root and was not scanned.`,
        "Use a directory relative to the project root (res:// is also accepted)."));
      continue;
    }
    if (!existsSync(dirAbs) || !statSync(dirAbs).isDirectory()) {
      findings.push(finding(CONFIG_FILENAME, 1, "registry-dir-missing", "error",
        `registryDirs entry "${configured}" does not exist, so no registries were validated there.`,
        "Fix the directory name in godot-correctness.config.json."));
      continue;
    }
    for (const { full, rel } of walkProject(root, { exts: [".tres"], exclude }, dirAbs)) {
      const file = parseGodotFile(readFileSync(full, "utf-8"));

      if (!file.header || file.header.kind !== "gd_resource") {
        findings.push(finding(rel, 1, "registry-parse-error", "error",
          "File does not parse as a Godot text resource (missing gd_resource header).",
          "Ensure the .tres is a valid, uncorrupted Godot resource."));
        continue;
      }

      const { byId } = extResourceIndex(file);
      const resource = file.sections.find((s) => s.kind === "resource");
      let scriptClass: string | null = null;

      // Script resolution + class_name capture.
      const scriptRef = resource?.properties["script"];
      if (scriptRef?.kind === "extResource" && scriptRef.ref) {
        const decl = byId.get(scriptRef.ref);
        const path = decl?.attributes["path"]?.string;
        const uidAttr = decl?.attributes["uid"]?.string;
        const uid = uidAttr?.startsWith("uid://") ? uidAttr : undefined;
        // Same uid-first resolution as scenes: a stale path with a valid uid
        // still loads the uid's script.
        const r = decl ? resolveReference(root, path, uid, uids) : null;
        if (!r || !r.loads) {
          findings.push(finding(rel, scriptRef.line, "registry-script-missing", "error",
            `Registry script target does not exist: ${path ?? uid ?? scriptRef.ref}`,
            "Fix the script ext_resource path or restore the .gd."));
        } else {
          scriptClass = readClassName(r.loads);
        }
      }
      entries.push({ file: rel, scriptClass });

      // Dangling resource-path properties across every section.
      for (const section of [resource, ...sectionsOfKind(file, "sub_resource")].filter(Boolean) as GodotSection[]) {
        for (const [key, v] of Object.entries(section.properties)) {
          if (!looksLikeResourcePath(v, key, cfg.pathPropertyPatterns)) continue;
          const abs = resolveResPath(root, v.string ?? "");
          if (abs && !existsInProject(root, abs)) {
            findings.push(finding(rel, v.line, "registry-dangling-path", "error",
              `Property "${key}" points at a missing resource: ${v.string}`,
              "Fix the path or restore the referenced file. These fail only at runtime scene load."));
          }
        }
      }
    }
  }
  return { findings: applyRuleConfig(findings, cfg), entries };
}
