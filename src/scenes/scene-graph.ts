import { readFileSync, statSync } from "node:fs";
import { resourceRefPattern, sectionsOfKind, type GodotFile, type GodotSection } from "../godot/text-format.js";
import type { Finding } from "../lint/types.js";
import { availableVersions, loadSymbolDb } from "../symbols/db.js";
import type { SymbolDb } from "../symbols/schema.js";
import { resolveResPath } from "./paths.js";

function finding(file: string, line: number, ruleId: string, message: string, suggestion: string): Finding {
  return { file, line, col: 1, ruleId, severity: "error", message, suggestion };
}

const SUB_REF_RE = resourceRefPattern("SubResource");

/** Every SubResource("id") reference must match a [sub_resource id=...] in the same file. */
export function checkSubResourceRefs(rel: string, file: GodotFile): Finding[] {
  const declared = new Set<string>();
  for (const s of sectionsOfKind(file, "sub_resource")) {
    const id = s.attributes["id"]?.string ?? s.attributes["id"]?.raw;
    if (id) declared.add(id);
  }
  const out: Finding[] = [];
  for (const section of file.sections) {
    for (const v of [...Object.values(section.attributes), ...Object.values(section.properties)]) {
      if (!v.raw.includes("SubResource")) continue;
      for (const m of v.raw.matchAll(SUB_REF_RE)) {
        const ref = m[1] ?? m[2];
        if (!ref || declared.has(ref)) continue;
        const offset = v.raw.slice(0, m.index).split("\n").length - 1;
        out.push(
          finding(rel, v.line + offset, "scene-missing-sub-resource-id",
            `SubResource("${ref}") is not declared in this file.`,
            "Add the [sub_resource] declaration or fix the id."),
        );
      }
    }
  }
  return out;
}

export interface SceneNode {
  path: string;
  section: GodotSection;
  instanced: boolean;
}

/** Map node path ("." for the root, "A", "A/B") to its section. */
export function nodeTree(file: GodotFile): Map<string, SceneNode> {
  const nodes = new Map<string, SceneNode>();
  for (const s of sectionsOfKind(file, "node")) {
    const name = s.attributes["name"]?.string;
    const parent = s.attributes["parent"]?.string;
    if (name === undefined) continue;
    const path = parent === undefined ? "." : parent === "." ? name : `${parent}/${name}`;
    nodes.set(path, { path, section: s, instanced: s.attributes["instance"] !== undefined });
  }
  return nodes;
}

/**
 * Whether `path` may legitimately live inside an instanced sub-scene (editable
 * children), which this file does not declare: true if any ancestor is an
 * instanced node. In an inherited scene the root itself is instanced, so every
 * base-scene node is undeclared and any parent path may be legitimate.
 */
function underInstance(path: string, nodes: Map<string, SceneNode>): boolean {
  if (nodes.get(".")?.instanced) return true;
  const parts = path.split("/");
  for (let i = parts.length - 1; i >= 1; i--) {
    if (nodes.get(parts.slice(0, i).join("/"))?.instanced) return true;
  }
  return false;
}

/** Every [node parent="..."] must name a node declared earlier in the scene. */
export function checkNodeParents(rel: string, file: GodotFile): Finding[] {
  const nodes = nodeTree(file);
  const out: Finding[] = [];
  for (const s of sectionsOfKind(file, "node")) {
    const parent = s.attributes["parent"]?.string;
    if (parent === undefined || parent === "." || nodes.has(parent)) continue;
    if (underInstance(parent, nodes)) continue;
    out.push(
      finding(rel, s.line, "scene-node-parent-missing",
        `Node "${s.attributes["name"]?.string ?? "?"}" has parent "${parent}", which is not declared in this scene.`,
        "Fix the parent path or restore the missing node."),
    );
  }
  return out;
}

let cachedDb: SymbolDb | null | undefined;
function newestDb(): SymbolDb | null {
  if (cachedDb === undefined) {
    const v = availableVersions().at(-1);
    cachedDb = v ? loadSymbolDb(v) : null;
  }
  return cachedDb;
}

const builtinCache = new WeakMap<SymbolDb, Map<string, Set<string> | null>>();

/** Method names on a built-in class and its ancestors, or null if it is not a built-in class. */
function builtinMethods(db: SymbolDb, className: string): Set<string> | null {
  let perDb = builtinCache.get(db);
  if (!perDb) builtinCache.set(db, (perDb = new Map()));
  if (!perDb.has(className)) perDb.set(className, computeBuiltinMethods(db, className));
  return perDb.get(className)!;
}

function computeBuiltinMethods(db: SymbolDb, className: string): Set<string> | null {
  if (!Object.hasOwn(db.classes, className)) return null;
  const names = new Set<string>();
  let cur: string | null = className;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const def: SymbolDb["classes"][string] | undefined = db.classes[cur];
    if (!def) break;
    for (const m of def.methods) names.add(m.name);
    cur = def.inherits;
  }
  return names;
}

interface ScriptInfo {
  /** Built-in or user class named by a bare `extends X`, or null. */
  ext: string | null;
  /** Names of functions declared in the script. */
  funcs: Set<string>;
}

const EXTENDS_LINE = /^[ \t]*extends[ \t]+([A-Za-z_]\w*)[ \t]*(?:#.*)?$/;
// Leading annotations are allowed on the same line: `@rpc("any_peer") func f():`.
const FUNC_LINE = /^[ \t]*(?:@\w+(?:\([^)\n]*\))?[ \t]*)*(?:static[ \t]+)?func[ \t]+([A-Za-z_]\w*)[ \t]*\(/;

/** Scan a script line by line (no whole-file multiline regexes). */
export function scanScript(src: string): ScriptInfo {
  let ext: string | null = null;
  const funcs = new Set<string>();
  for (const line of src.split(/\r?\n/)) {
    const f = FUNC_LINE.exec(line);
    if (f) funcs.add(f[1]!);
    else if (ext === null) ext = EXTENDS_LINE.exec(line)?.[1] ?? null;
  }
  return { ext, funcs };
}

const scriptCache = new Map<string, { mtimeMs: number; size: number; info: ScriptInfo }>();

/** Cached per path and invalidated on change, so each script is read once per run. */
function scriptInfo(abs: string): ScriptInfo | null {
  let st;
  try {
    st = statSync(abs);
  } catch {
    return null;
  }
  const hit = scriptCache.get(abs);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.info;
  const info = scanScript(readFileSync(abs, "utf-8"));
  scriptCache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, info });
  return info;
}

/**
 * Every [connection ... to="X" method="m"] must target a method that exists.
 * Deliberately conservative: only checked when the target node has an external
 * script that directly `extends` a built-in class, so the full method set is
 * known (the script's own funcs plus the engine class chain).
 */
export function checkConnections(rel: string, file: GodotFile, root: string): Finding[] {
  const connections = sectionsOfKind(file, "connection");
  if (connections.length === 0) return [];
  const db = newestDb();
  if (!db) return [];
  const nodes = nodeTree(file);
  const extPaths = new Map<string, string>();
  for (const s of sectionsOfKind(file, "ext_resource")) {
    const id = s.attributes["id"]?.string ?? s.attributes["id"]?.raw;
    const path = s.attributes["path"]?.string;
    if (id && path) extPaths.set(id, path);
  }

  const out: Finding[] = [];
  for (const c of connections) {
    const to = c.attributes["to"]?.string;
    const method = c.attributes["method"]?.string;
    if (to === undefined || !method) continue;
    const script = nodes.get(to)?.section.properties["script"];
    if (script?.kind !== "extResource" || !script.ref) continue;
    const resPath = extPaths.get(script.ref);
    const abs = resPath ? resolveResPath(root, resPath) : null;
    const info = abs ? scriptInfo(abs) : null;
    if (!info) continue; // missing scripts are reported elsewhere

    const ext = info.ext;
    if (!ext) continue; // path-based or missing extends: chain unknown
    const engine = builtinMethods(db, ext);
    if (!engine) continue; // extends a user class: chain unknown
    if (info.funcs.has(method) || engine.has(method)) continue;
    out.push(
      finding(rel, c.line, "scene-connection-method-missing",
        `Connection "${c.attributes["signal"]?.string ?? "?"}" targets ${method}() on "${to}", ` +
          `but ${resPath} (extends ${ext}) has no such method.`,
        "Rename the connection's method, or add the method to the target script."),
    );
  }
  return out;
}
