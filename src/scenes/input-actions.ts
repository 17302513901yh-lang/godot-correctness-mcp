import { readFileSync } from "node:fs";
import { applySuppressions } from "../lint/suppressions.js";
import type { Finding } from "../lint/types.js";
import { walkProject } from "../project/walk.js";

/**
 * Input/InputEvent/InputMap calls whose string-literal arguments name input
 * actions. `InputMap.has_action` is deliberately absent: it is how code checks
 * for an action that may not exist.
 */
const ACTION_CALL_RE =
  /\b(is_action_pressed|is_action_just_pressed|is_action_just_released|is_action_released|is_action|get_action_strength|get_action_raw_strength|action_press|action_release|get_axis|get_vector)\s*\(([^()]*)\)/g;
/** An argument that is exactly one string (or StringName) literal. */
const WHOLE_STRING_ARG_RE = /^\s*&?"((?:[^"\\]|\\.)*)"\s*$/;

/**
 * Split an argument list on top-level commas, keeping each argument's offset.
 * (The call regex already excludes nested parentheses; this only has to skip
 * commas inside strings and brackets.)
 */
function splitArgs(args: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let depth = 0;
  let inStr = false;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push({ text: args.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  out.push({ text: args.slice(start), offset: start });
  return out;
}

/** Index of a line's `#` comment start, ignoring `#` inside string literals. */
function commentStart(line: string): number {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === "#") return i;
  }
  return -1;
}

/** Whether a name is one of Godot's built-in `ui_*` actions. */
function isBuiltinAction(name: string): boolean {
  return name.startsWith("ui_");
}

/**
 * Flag string-literal action names used in GDScript that are not defined in
 * project.godot's [input] section (and are not built-in ui_* actions). A typo
 * here fails silently at runtime: the action simply never fires.
 */
export function checkInputActionUsage(
  root: string,
  definedActions: Set<string>,
  exclude: (rel: string) => boolean,
): Finding[] {
  const findings: Finding[] = [];
  for (const { full, rel } of walkProject(root, { exts: [".gd"], exclude })) {
    const source = readFileSync(full, "utf-8");
    const fileFindings: Finding[] = [];
    source.split(/\r?\n/).forEach((rawLine, i) => {
      if (!rawLine.includes("action") && !rawLine.includes("get_axis") && !rawLine.includes("get_vector")) return;
      const cut = commentStart(rawLine);
      const code = cut === -1 ? rawLine : rawLine.slice(0, cut);
      for (const call of code.matchAll(ACTION_CALL_RE)) {
        const argsStart = call.index! + call[0].indexOf("(") + 1;
        // Only arguments that are entirely a string literal name an action;
        // `prefix + "_jump"` or `"p%d_jump" % n` are built at runtime.
        for (const arg of splitArgs(call[2]!)) {
          const m = WHOLE_STRING_ARG_RE.exec(arg.text);
          if (!m) continue;
          const name = m[1]!;
          if (name === "" || definedActions.has(name) || isBuiltinAction(name)) continue;
          const quoteAt = arg.text.search(/&?"/);
          fileFindings.push({
            file: rel,
            line: i + 1,
            col: argsStart + arg.offset + quoteAt + 1,
            ruleId: "project-input-action-undefined",
            severity: "warning",
            message: `Input action "${name}" is not defined in project.godot [input].`,
            suggestion: "Fix the action name or add the action in Project Settings > Input Map.",
          });
        }
      }
    });
    findings.push(...applySuppressions(rel, source, fileFindings, false));
  }
  return findings;
}
