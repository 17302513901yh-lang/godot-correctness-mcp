import type { Finding } from "./types.js";

/** Pseudo-rule id reported for suppression comments that silenced nothing. */
export const UNUSED_SUPPRESSION_RULE = "unused-suppression";

interface Directive {
  /** 1-based line the comment is on. */
  line: number;
  /** 1-based column of the `#`. */
  col: number;
  /** Line the directive applies to (null for file-wide directives). */
  target: number | null;
  /** Rule ids, or null for "all rules". */
  rules: Set<string> | null;
  used: boolean;
}

// `# gdcorrect-ignore`, `# gdcorrect-ignore[rule-a, rule-b]`,
// `# gdcorrect-ignore-file`, `# gdcorrect-ignore-file[rule-a]`
const DIRECTIVE_RE = /#\s*gdcorrect-ignore(-file)?(?:\[([^\]]*)\])?/;

function parseDirectives(source: string): Directive[] {
  const out: Directive[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const m = DIRECTIVE_RE.exec(text);
    if (!m) continue;
    const ids = m[2]
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const rules = ids && ids.length > 0 ? new Set(ids) : null;
    const line = i + 1;
    const commentOnly = text.slice(0, m.index).trim() === "";
    const target = m[1] ? null : commentOnly ? line + 1 : line;
    out.push({ line, col: m.index + 1, target, rules, used: false });
  }
  return out;
}

function covers(d: Directive, f: Finding): boolean {
  if (d.target !== null && d.target !== f.line) return false;
  return d.rules === null || d.rules.has(f.ruleId);
}

/**
 * Drop findings silenced by `# gdcorrect-ignore[...]` comments. A directive on
 * a code line applies to that line; on a comment-only line it applies to the
 * next line; `gdcorrect-ignore-file` applies to the whole file. Directives that
 * silenced nothing are returned as `unused-suppression` info findings when
 * `reportUnused` is true. A directive whose named rules are all out of scope
 * for this pass (`outOfScope`, e.g. scene checks or rules disabled in config)
 * is never reported as unused, since this pass could not have used it.
 */
export function applySuppressions(
  file: string,
  source: string,
  findings: Finding[],
  reportUnused: boolean,
  outOfScope: (ruleId: string) => boolean = () => false,
): Finding[] {
  if (!source.includes("gdcorrect-ignore")) return findings;
  const directives = parseDirectives(source);
  if (directives.length === 0) return findings;

  const kept = findings.filter((f) => {
    const hits = directives.filter((d) => covers(d, f));
    for (const d of hits) d.used = true;
    return hits.length === 0;
  });

  if (reportUnused) {
    for (const d of directives) {
      if (d.used) continue;
      if (d.rules && [...d.rules].every(outOfScope)) continue;
      const which = d.rules ? [...d.rules].join(", ") : "all rules";
      kept.push({
        file,
        line: d.line,
        col: d.col,
        ruleId: UNUSED_SUPPRESSION_RULE,
        severity: "info",
        message: `Suppression comment for ${which} did not match any finding.`,
        suggestion: "Remove the stale gdcorrect-ignore comment.",
      });
    }
  }
  return kept;
}
