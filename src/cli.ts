#!/usr/bin/env node
import { isMainModule } from "./entry.js";
import { lintProject } from "./lint/project.js";
import type { Finding } from "./lint/types.js";
import { projectReport } from "./scenes/report.js";
import { validateProjectConfig, validateRegistries, validateScenes } from "./scenes/validate.js";

type Format = "json" | "pretty";

interface CommandResult {
  root: string;
  findings: Finding[];
  /** Full JSON payload for --format json (already includes findings). */
  payload: unknown;
}

const COMMANDS = new Set([
  "lint",
  "validate-scenes",
  "validate-project",
  "validate-registries",
  "report",
]);

async function runCommand(command: string, root: string): Promise<CommandResult> {
  switch (command) {
    case "lint": {
      const r = await lintProject(root);
      return { root, findings: r.findings, payload: r };
    }
    case "validate-scenes": {
      const findings = validateScenes(root);
      return { root, findings, payload: { root, findings, count: findings.length } };
    }
    case "validate-project": {
      const findings = validateProjectConfig(root);
      return { root, findings, payload: { root, findings, count: findings.length } };
    }
    case "validate-registries": {
      const r = validateRegistries(root);
      return { root, findings: r.findings, payload: { root, ...r } };
    }
    case "report": {
      const r = await projectReport(root);
      return {
        root,
        findings: [...r.scenes, ...r.project, ...r.registries, ...r.lint],
        payload: r,
      };
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function countErrors(findings: Finding[]): number {
  return findings.filter((f) => f.severity === "error").length;
}

export function renderPretty(res: CommandResult): string {
  const lines: string[] = [];
  let lastFile = "";
  const sorted = [...res.findings].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col,
  );
  for (const f of sorted) {
    if (f.file !== lastFile) {
      lines.push(`\n${f.file}`);
      lastFile = f.file;
    }
    lines.push(`  ${f.line}:${f.col}  ${f.severity.toUpperCase().padEnd(7)} ${f.ruleId}`);
    lines.push(`         ${f.message}`);
  }
  const e = countErrors(res.findings);
  const w = res.findings.filter((f) => f.severity === "warning").length;
  const i = res.findings.filter((f) => f.severity === "info").length;
  lines.push(`\n${res.findings.length} finding(s): ${e} error(s), ${w} warning(s), ${i} info.`);
  return lines.join("\n").trimStart();
}

function parseArgs(argv: string[]): { command?: string; root?: string; format: string } {
  let format = "json";
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format" || a === "-f") format = argv[++i] ?? "";
    else if (a.startsWith("--format=")) format = a.slice("--format=".length);
    else positional.push(a);
  }
  return { command: positional[0], root: positional[1], format };
}

/** Exit code: 0 clean, 1 on any error-severity finding, 2 on tool failure. */
export async function runCli(
  argv: string[],
  log: (s: string) => void = console.log,
  errOut: (s: string) => void = console.error,
): Promise<number> {
  const { command, root, format } = parseArgs(argv);
  if (!command || !COMMANDS.has(command) || !root) {
    errOut(`Usage: gdcorrect <${[...COMMANDS].join("|")}> <projectPath> [--format json|pretty]`);
    return 2;
  }
  if (format !== "json" && format !== "pretty") {
    errOut(`Unknown format: ${format}. Use 'json' or 'pretty'.`);
    return 2;
  }
  try {
    const res = await runCommand(command, root);
    log(format === "pretty" ? renderPretty(res) : JSON.stringify(res.payload, null, 2));
    return countErrors(res.findings) > 0 ? 1 : 0;
  } catch (err) {
    errOut(`gdcorrect: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

if (isMainModule(import.meta.url)) {
  runCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => process.exit(2));
}
