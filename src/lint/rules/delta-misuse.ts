import type { Node } from "web-tree-sitter";
import {
  containsIdentifier,
  fieldText,
  findAll,
  functionCalls,
  operatorOf,
  text,
  walk,
} from "../../gdscript/ast.js";
import type { RawFinding, Rule } from "../types.js";

const PROCESS_FNS = new Set(["_process", "_physics_process"]);

/** Base identifier of an assignment target: `velocity` or `x` in `self.x`/`x.y`. */
function targetName(left: Node, source: string): string | null {
  if (left.type === "identifier") return text(left, source);
  if (left.type === "attribute") {
    // `self.velocity` -> last identifier; `position.x` -> base identifier.
    const first = left.namedChild(0);
    if (first && first.type === "identifier" && text(first, source) === "self") {
      const second = left.namedChild(1);
      return second && second.type === "identifier" ? text(second, source) : null;
    }
    return first && first.type === "identifier" ? text(first, source) : null;
  }
  return null;
}

/** True for `velocity` or `self.velocity` itself (not a component like `velocity.x`). */
function isWholeVelocity(left: Node, source: string): boolean {
  if (left.type === "identifier") return text(left, source) === "velocity";
  if (left.type === "attribute" && left.namedChildCount === 2) {
    const [a, b] = [left.namedChild(0), left.namedChild(1)];
    return (
      a?.type === "identifier" && text(a, source) === "self" &&
      b?.type === "identifier" && text(b, source) === "velocity"
    );
  }
  return false;
}

/**
 * RHS contains a `*` with `delta` as a direct operand (either order), outside
 * of call arguments: `move_toward(v, 0, ACCEL * delta)` and
 * `v.lerp(t, 5.0 * delta)` scale a step size, not the velocity itself.
 */
function multipliesByDelta(node: Node, source: string): boolean {
  if (node.type === "arguments") return false;
  if (node.type === "binary_operator" && operatorOf(node, source) === "*") {
    const isDelta = (n: Node | null): boolean =>
      !!n && n.type === "identifier" && text(n, source) === "delta";
    if (isDelta(node.childForFieldName("left")) || isDelta(node.childForFieldName("right"))) return true;
  }
  for (const child of node.namedChildren) {
    if (child && multipliesByDelta(child, source)) return true;
  }
  return false;
}

/**
 * error: `velocity` scaled by delta in a function that calls move_and_slide()
 * (double-scales, since move_and_slide already applies frame timing).
 * info: position/rotation mutated in _process without any delta factor.
 */
export const deltaMisuse: Rule = {
  id: "delta-misuse",
  description: "velocity = speed * delta before move_and_slide() (double-scaled); or delta-less position/rotation change in _process.",
  defaultSeverity: "error",
  check(ctx) {
    const out: RawFinding[] = [];
    for (const fn of findAll(ctx.root, "function_definition")) {
      const fname = fieldText(fn, "name", ctx.source);
      const callsMove = functionCalls(fn, "move_and_slide", ctx.source);
      for (const stmt of walk(fn)) {
        if (stmt.type !== "assignment" && stmt.type !== "augmented_assignment") continue;
        const left = stmt.childForFieldName("left");
        const right = stmt.childForFieldName("right");
        if (!left || !right) continue;
        const target = targetName(left, ctx.source);

        // Only a plain `velocity = <speed> * delta` double-scales. Integrating an
        // acceleration (`velocity += gravity * delta`, `velocity.y += ...`) or
        // damping from the current velocity is the correct, documented pattern.
        if (
          callsMove &&
          stmt.type === "assignment" &&
          isWholeVelocity(left, ctx.source) &&
          !containsIdentifier(right, "velocity", ctx.source) &&
          multipliesByDelta(right, ctx.source)
        ) {
          out.push({
            node: stmt,
            severity: "error",
            message: "velocity multiplied by delta before move_and_slide(); move_and_slide() already applies frame timing, so this double-scales movement.",
            suggestion: "Set velocity in units per second (no * delta); move_and_slide() handles delta.",
          });
          continue;
        }

        if (
          fname &&
          PROCESS_FNS.has(fname) &&
          (target === "position" || target === "rotation") &&
          !containsIdentifier(right, "delta", ctx.source)
        ) {
          out.push({
            node: stmt,
            severity: "info",
            message: `${fname}() changes ${target} without a delta factor; motion becomes frame-rate dependent.`,
            suggestion: "Scale the change by delta for frame-rate independence.",
          });
        }
      }
    }
    return out;
  },
};
