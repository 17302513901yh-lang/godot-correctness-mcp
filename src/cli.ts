#!/usr/bin/env node
import { applyBaseline, createBaseline, readBaseline, writeBaseline } from "./baseline.js";
import { isMainModule } from "./entry.js";
import { lintProject } from "./lint/project.js";
import type { Finding } from "./lint/types.js";
import { requireDir } from "./project/walk.js";
import { toSarif } from "./sarif.js";
import { validateNodePaths } from "./scenes/node-paths.js";
import { projectReport } from "./scenes/report.js";
import { validateProjectConfig, validateRegistries, validateScenes } from "./scenes/validate.js";
import { readVersion } from "./server-info.js";

const FORMATS = ["json", "pretty", "sarif"] as const;
type Format = (typeof FORMATS)[number];

function isFormat(s: string): s is Format {
  return (FORMATS as readonly string[]).includes(s);
}

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
  requireDir(root);
  switch (command) {
    case "lint": {
      const r = await lintProject(root);
      return { root, findings: r.findings, payload: r };
    }
    case "validate-scenes": {
      const findings = [...validateScenes(root), ...(await validateNodePaths(root))];
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

interface CliArgs {
  command?: string;
  root?: string;
  format: string;
  baseline?: string;
  writeBaseline?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { format: "json" };
  const positional: string[] = [];
  // Supports both `--flag value` and `--flag=value`.
  const flags: Record<string, (v: string) => void> = {
    "--format": (v) => (args.format = v),
    "-f": (v) => (args.format = v),
    "--baseline": (v) => (args.baseline = v),
    "--write-baseline": (v) => (args.writeBaseline = v),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const eq = a.indexOf("=");
    const name = a.startsWith("-") && eq > 0 ? a.slice(0, eq) : a;
    const set = flags[name];
    if (set) set(eq > 0 && name !== a ? a.slice(eq + 1) : (argv[++i] ?? ""));
    else positional.push(a);
  }
  args.command = positional[0];
  args.root = positional[1];
  return args;
}

const USAGE =
  `Usage: gdcorrect <${[...COMMANDS].join("|")}> <projectPath> [--format ${FORMATS.join("|")}]\n` +
  "                 [--baseline <file>] [--write-baseline <file>]";

function render(res: CommandResult, format: Format): string {
  switch (format) {
    case "pretty":
      return renderPretty(res);
    case "sarif":
      return JSON.stringify(
        toSarif(res.findings, { projectRoot: res.root, version: readVersion() }),
        null,
        2,
      );
    case "json":
      return JSON.stringify(res.payload, null, 2);
  }
}

/** Exit code: 0 clean, 1 on any error-severity finding, 2 on tool failure. */
export async function runCli(
  argv: string[],
  log: (s: string) => void = console.log,
  errOut: (s: string) => void = console.error,
): Promise<number> {
  const { command, root, format, baseline, writeBaseline: writeTo } = parseArgs(argv);
  if (!command || !COMMANDS.has(command) || !root) {
    errOut(USAGE);
    return 2;
  }
  if (!isFormat(format)) {
    errOut(`Unknown format: ${format}. Use one of: ${FORMATS.join(", ")}.`);
    return 2;
  }
  if (baseline !== undefined && writeTo !== undefined) {
    errOut("gdcorrect: use either --baseline or --write-baseline, not both.");
    return 2;
  }
  try {
    let res = await runCommand(command, root);
    if (writeTo) {
      const b = createBaseline(root, res.findings);
      writeBaseline(writeTo, b);
      errOut(`gdcorrect: wrote ${res.findings.length} finding(s) to baseline ${writeTo}.`);
      return 0;
    }
    if (baseline) {
      const r = applyBaseline(root, res.findings, readBaseline(baseline));
      res = {
        root,
        findings: r.newFindings,
        payload: {
          root,
          findings: r.newFindings,
          count: r.newFindings.length,
          baselined: r.baselined,
          staleBaselineEntries: r.stale,
        },
      };
      errOut(
        `gdcorrect: ${r.baselined} finding(s) matched the baseline` +
          (r.stale ? `; ${r.stale} baseline entr${r.stale === 1 ? "y is" : "ies are"} stale (fixed) and can be removed by rewriting it.` : "."),
      );
    }
    log(render(res, format));
    return countErrors(res.findings) > 0 ? 1 : 0;
  } catch (err) {
    errOut(`gdcorrect: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

if (isMainModule(import.meta.url)) {
  // Set exitCode and let the process end on its own: calling process.exit()
  // right after web-tree-sitter has run can trip a libuv handle-closing
  // assertion on Windows and exit 127 instead of 0/1/2.
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 2;
    },
  );
}
