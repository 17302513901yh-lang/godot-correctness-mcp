import type { Node } from "web-tree-sitter";

export type Severity = "error" | "warning" | "info";

/** A resolved finding, ready for JSON output. Line/col are 1-based. */
export interface Finding {
  file: string;
  line: number;
  col: number;
  ruleId: string;
  severity: Severity;
  message: string;
  suggestion: string;
}

/** What a rule emits: a node to anchor at, a message, and a fix suggestion. */
export interface RawFinding {
  node: Node;
  message: string;
  suggestion: string;
  /**
   * Intrinsic severity for this specific finding, used for rules that emit more
   * than one severity (e.g. delta-misuse: error for the main pattern, info for
   * the softer sub-pattern). Takes precedence over the rule default, but a
   * config severity override still wins.
   */
  severity?: Severity;
}

export interface RuleContext {
  root: Node;
  source: string;
  /** Per-rule options merged from config. */
  options: Record<string, unknown>;
  /** Godot version declared in the project's project.godot, if any. */
  projectGodotVersion?: string | null;
}

export interface Rule {
  id: string;
  description: string;
  defaultSeverity: Severity;
  check(ctx: RuleContext): RawFinding[];
}
