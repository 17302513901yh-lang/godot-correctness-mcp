import type { Node } from "web-tree-sitter";

/**
 * Depth-first (pre-order) walk over all named nodes, inclusive of the start
 * node. Walking a whole tree (from its root) reuses the per-tree index, so the
 * rules that scan the full file share one traversal.
 */
export function* walk(node: Node): Generator<Node> {
  if (node.parent === null) {
    yield* indexFor(node).all;
    return;
  }
  yield* walkSubtree(node);
}

function* walkSubtree(node: Node): Generator<Node> {
  yield node;
  for (const child of node.namedChildren) {
    if (child) yield* walkSubtree(child);
  }
}

/** Same order as walk(), without generator overhead, for building indexes. */
function collect(node: Node, out: Node[]): void {
  out.push(node);
  for (const child of node.namedChildren) if (child) collect(child, out);
}

/** Per-tree index of named nodes by type, built once in a single walk. */
interface TreeIndex {
  rootId: number;
  /** Every named node, pre-order. */
  all: Node[];
  byType: Map<string, Node[]>;
}

const typeIndex = new WeakMap<object, TreeIndex>();

function indexFor(root: Node): TreeIndex {
  const hit = typeIndex.get(root.tree);
  if (hit && hit.rootId === root.id) return hit;
  const byType = new Map<string, Node[]>();
  const all: Node[] = [];
  collect(root, all);
  for (const n of all) {
    const list = byType.get(n.type);
    if (list) list.push(n);
    else byType.set(n.type, [n]);
  }
  const index = { rootId: root.id, all, byType };
  typeIndex.set(root.tree, index);
  return index;
}

/** Source text covered by a node. */
export function text(node: Node, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

/**
 * All named nodes of a grammar type in `root`'s subtree, in document order.
 * On a tree's root node (what every lint rule passes) the result comes from a
 * per-tree index, so N rules share one traversal instead of walking N times.
 */
export function findAll(root: Node, type: string): Node[] {
  if (root.parent === null) return [...(indexFor(root).byType.get(type) ?? [])];
  const out: Node[] = [];
  for (const n of walk(root)) if (n.type === type) out.push(n);
  return out;
}

/** Text of a named field child, or null. */
export function fieldText(node: Node, field: string, source: string): string | null {
  const child = node.childForFieldName(field);
  return child ? text(child, source) : null;
}

/** The operator token of a binary/assignment node (read from source between operands). */
export function operatorOf(node: Node, source: string): string | null {
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left || !right) return null;
  return source.slice(left.endIndex, right.startIndex).trim();
}

/** Walk up to the nearest enclosing function_definition, or null. */
export function enclosingFunction(node: Node): Node | null {
  let cur: Node | null = node.parent;
  while (cur) {
    if (cur.type === "function_definition") return cur;
    cur = cur.parent;
  }
  return null;
}

/** Name of the enclosing function_definition, or null if not inside one. */
export function enclosingFunctionName(node: Node, source: string): string | null {
  const fn = enclosingFunction(node);
  return fn ? fieldText(fn, "name", source) : null;
}

/**
 * The identifier being invoked by a call. Handles both free calls
 * `foo(...)` (a `call` node) and method calls `a.b.foo(...)` (an
 * `attribute_call` node). Returns the method/function name or null.
 */
export function calleeName(node: Node, source: string): string | null {
  if (node.type === "call") {
    const fn = node.namedChild(0);
    return fn && fn.type === "identifier" ? text(fn, source) : null;
  }
  if (node.type === "attribute_call") {
    const id = node.namedChild(0);
    return id && id.type === "identifier" ? text(id, source) : null;
  }
  return null;
}

/** True if the subtree contains an identifier with the given name. */
export function containsIdentifier(node: Node, name: string, source: string): boolean {
  for (const n of walk(node)) {
    if (n.type === "identifier" && text(n, source) === name) return true;
  }
  return false;
}

/** True if the function body calls a function/method with the given name. */
export function functionCalls(fn: Node, name: string, source: string): boolean {
  for (const n of walk(fn)) {
    if ((n.type === "call" || n.type === "attribute_call") && calleeName(n, source) === name) {
      return true;
    }
  }
  return false;
}
