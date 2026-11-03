import type { Node } from "web-tree-sitter";
import { parseGDScript } from "../gdscript/parser.js";
import {
  isRuleEnabled,
  ruleOptions,
  severityOverride,
  type ResolvedConfig,
} from "./config.js";
import { DEFAULT_RULES } from "./rules/index.js";
import type { Finding } from "./types.js";

/**
 * Lint one GDScript source string. `file` is used only for the reported path.
 * Severity precedence: config override > per-finding severity > rule default.
 */
export async function lintSource(
  file: string,
  source: string,
  config: ResolvedConfig,
): Promise<Finding[]> {
  const tree = await parseGDScript(source);
  let findings: Finding[];
  try {
    findings = runRules(file, tree.rootNode, source, config);
  } finally {
    // Trees live on the WASM heap and are not garbage collected; free them
    // explicitly or a long-lived server grows without bound.
    tree.delete();
  }
  findings.sort((a, b) => a.line - b.line || a.col - b.col || a.ruleId.localeCompare(b.ruleId));
  return findings;
}

function runRules(file: string, root: Node, source: string, config: ResolvedConfig): Finding[] {
  const findings: Finding[] = [];
  for (const rule of DEFAULT_RULES) {
    if (!isRuleEnabled(config, rule.id)) continue;
    const raws = rule.check({ root, source, options: ruleOptions(config, rule.id) });
    for (const raw of raws) {
      const severity = severityOverride(config, rule.id) ?? raw.severity ?? rule.defaultSeverity;
      const pos = raw.node.startPosition;
      findings.push({
        file,
        line: pos.row + 1,
        col: pos.column + 1,
        ruleId: rule.id,
        severity,
        message: raw.message,
        suggestion: raw.suggestion,
      });
    }
  }
  return findings;
}
