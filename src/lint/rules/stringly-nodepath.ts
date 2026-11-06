import { calleeName, walk } from "../../gdscript/ast.js";
import type { Rule } from "../types.js";

const PATH_FNS = new Set([
  "get_node",
  "get_node_or_null",
  "has_node",
  "find_child",
  "get_node_and_resource",
  "NodePath",
]);

/** Flags string-literal node paths (rename-fragile). */
export const stringlyNodepath: Rule = {
  id: "stringly-nodepath",
  description: "String-literal node path passed to a node lookup or NodePath().",
  defaultSeverity: "info",
  check(ctx) {
    const out = [];
    for (const n of walk(ctx.root)) {
      if (n.type !== "call" && n.type !== "attribute_call") continue;
      const callee = calleeName(n, ctx.source);
      if (!callee || !PATH_FNS.has(callee)) continue;
      const first = n.childForFieldName("arguments")?.namedChild(0);
      if (first && first.type === "string") {
        out.push({
          node: first,
          message: "String node path is rename-fragile; a renamed node breaks it silently at runtime.",
          suggestion: "Prefer the $NodePath shorthand or an @export var of type NodePath.",
        });
      }
    }
    return out;
  },
};
