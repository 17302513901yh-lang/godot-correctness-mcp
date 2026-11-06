import { readFileSync } from "node:fs";
import picomatch from "picomatch";
import type { Node } from "web-tree-sitter";
import { calleeName, text, walk } from "../gdscript/ast.js";
import { parseGDScript } from "../gdscript/parser.js";
import { parseGodotFile, sectionsOfKind } from "../godot/text-format.js";
import { applyRuleConfig, loadConfig, type ResolvedConfig } from "../lint/config.js";
import { applySuppressions } from "../lint/suppressions.js";
import type { Finding } from "../lint/types.js";
import { walkProject } from "../project/walk.js";
import { nodeTree, type SceneNode } from "./scene-graph.js";
import { normalizeResPath } from "./uids.js";

/** A literal node path used by a script: `$A/B`, `$"A/B"`, or `get_node("A/B")`. */
interface PathUse {
  path: string;
  line: number;
  col: number;
}

/** What one scene knows about the children of a node a script is attached to. */
type SceneView =
  | { kind: "unknown" } // children come from another scene (instanced/inherited)
  | { kind: "known"; scene: string; nodes: Map<string, SceneNode>; base: string };

const NODE_LOOKUPS = new Set(["get_node", "get_node_or_null"]);

function unquote(s: string): string {
  return s.length >= 2 && (s[0] === '"' || s[0] === "'") ? s.slice(1, -1) : s;
}

/** Literal relative node paths in a script (absolute, `..`, and `%Unique` paths are skipped). */
function pathUses(root: Node, source: string): PathUse[] {
  const out: PathUse[] = [];
  const add = (raw: string, n: Node): void => {
    const path = raw.replace(/^\.\//, "");
    if (!path || path.startsWith("/") || path.startsWith("..") || path.includes("%")) return;
    if (path.includes(":")) return; // property subpaths like "Sprite:modulate"
    out.push({ path, line: n.startPosition.row + 1, col: n.startPosition.column + 1 });
  };
  for (const n of walk(root)) {
    if (n.type === "get_node") {
      const t = text(n, source);
      if (t.startsWith("$")) add(unquote(t.slice(1)), n);
    } else if (n.type === "call" && NODE_LOOKUPS.has(calleeName(n, source) ?? "")) {
      const arg = n.childForFieldName("arguments")?.namedChild(0) ?? n.namedChild(1)?.namedChild(0);
      if (arg?.type === "string") add(unquote(text(arg, source)), arg);
    }
  }
  return out;
}

/** For every script, how each scene that attaches it sees that node's subtree. */
function scriptViews(root: string, exclude: (rel: string) => boolean): Map<string, SceneView[]> {
  const views = new Map<string, SceneView[]>();
  for (const { full, rel } of walkProject(root, { exts: [".tscn"], exclude })) {
    const file = parseGodotFile(readFileSync(full, "utf-8"));
    const scripts = new Map<string, string>();
    for (const s of sectionsOfKind(file, "ext_resource")) {
      const id = s.attributes["id"]?.string ?? s.attributes["id"]?.raw;
      const path = s.attributes["path"]?.string;
      if (id && path?.endsWith(".gd")) scripts.set(id, normalizeResPath(path));
    }
    const nodes = nodeTree(file);
    for (const node of nodes.values()) {
      const script = node.section.properties["script"];
      if (script?.kind !== "extResource" || !script.ref) continue;
      const resPath = scripts.get(script.ref);
      if (!resPath) continue;
      const list = views.get(resPath) ?? [];
      list.push(node.instanced ? { kind: "unknown" } : { kind: "known", scene: rel, nodes, base: node.path });
      views.set(resPath, list);
    }
  }
  return views;
}

/** Whether `rel` (relative to `base`) exists, or can't be known (crosses an instanced node). */
function resolve(view: Extract<SceneView, { kind: "known" }>, rel: string): "found" | "missing" | "unknown" {
  let cur = view.base;
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (view.nodes.get(cur)?.instanced) return "unknown"; // children defined in another scene
    cur = cur === "." ? seg : `${cur}/${seg}`;
    if (!view.nodes.has(cur)) return "missing";
  }
  return "found";
}

/**
 * scene-node-path-missing: a literal `$A/B` / `get_node("A/B")` in a script
 * that resolves in none of the scenes the script is attached to. Only reported
 * when every attaching scene is fully known (no instanced/inherited subtrees on
 * the path), so runtime-added and instanced children are never guessed at.
 */
export async function validateNodePaths(root: string, config?: ResolvedConfig): Promise<Finding[]> {
  const cfg = config ?? loadConfig(root);
  const exclude = picomatch(cfg.exclude, { dot: true });
  const views = scriptViews(root, exclude);
  if (views.size === 0) return [];

  const findings: Finding[] = [];
  for (const { full, rel } of walkProject(root, { exts: [".gd"], exclude })) {
    const sceneViews = views.get(`res://${rel}`);
    if (!sceneViews || sceneViews.some((v) => v.kind === "unknown")) continue;
    const source = readFileSync(full, "utf-8");
    if (!source.includes("$") && !source.includes("get_node")) continue;
    const tree = await parseGDScript(source);
    const fileFindings: Finding[] = [];
    try {
      for (const use of pathUses(tree.rootNode, source)) {
        const results = sceneViews.map((v) => (v.kind === "known" ? resolve(v, use.path) : "unknown"));
        if (!results.every((r) => r === "missing")) continue;
        const scenes = sceneViews.map((v) => (v.kind === "known" ? v.scene : "?")).join(", ");
        fileFindings.push({
          file: rel,
          line: use.line,
          col: use.col,
          ruleId: "scene-node-path-missing",
          severity: "warning",
          message: `Node path "${use.path}" does not exist under this script's node in ${scenes}.`,
          suggestion: "Fix the path, rename the node, or (if the node is added at runtime) suppress with # gdcorrect-ignore.",
        });
      }
    } finally {
      tree.delete();
    }
    findings.push(...applySuppressions(rel, source, fileFindings, false));
  }
  return applyRuleConfig(findings, cfg);
}
