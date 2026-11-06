#!/usr/bin/env node
import { applyBaseline, createBaseline, readBaseline, writeBaseline } from "./baseline.js";
import { isMainModule } from "./entry.js";
import { effectiveRules } from "./lint/catalog.js";
import { loadConfig, type ResolvedConfig } from "./lint/config.js";
import { lintProject } from "./lint/project.js";
import type { Finding } from "./lint/types.js";
import { requireDir } from "./project/walk.js";
import { toSarif } from "./sarif.js";
import { projectReport, reportFindings, validateSceneFiles } from "./scenes/report.js";
import { validateProjectConfig, validateRegistries } from "./scenes/validate.js";
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
      const findings = await validateSceneFiles(root);
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
      return { root, findings: reportFindings(r), payload: r };
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

const FAIL_ON = ["error", "warning", "info", "none"] as const;
type FailOn = (typeof FAIL_ON)[number];

function isFailOn(s: string): s is FailOn {
  return (FAIL_ON as readonly string[]).includes(s);
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { error: 3, warning: 2, info: 1 };

/** Whether any finding is at or above the --fail-on threshold. */
function fails(findings: Finding[], failOn: FailOn): boolean {
  if (failOn === "none") return false;
  const min = SEVERITY_RANK[failOn];
  return findings.some((f) => SEVERITY_RANK[f.severity] >= min);
}

interface CliArgs {
  command?: string;
  root?: string;
  format: string;
  baseline?: string;
  writeBaseline?: string;
  failOn: string;
  help: boolean;
  version: boolean;
}

class UsageError extends Error {}

/** Options that take a value, as `--flag value` or `--flag=value`. */
const VALUE_FLAGS: Record<string, "format" | "baseline" | "writeBaseline" | "failOn"> = {
  "--format": "format",
  "-f": "format",
  "--baseline": "baseline",
  "--write-baseline": "writeBaseline",
  "--fail-on": "failOn",
};

/** Parse argv strictly: unknown options, missing values and extra arguments are usage errors. */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { format: "json", failOn: "error", help: false, version: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
    if (a === "--version" || a === "-v") {
      args.version = true;
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(0, eq) : a;
      const key = VALUE_FLAGS[name];
      if (!key) throw new UsageError(`Unknown option: ${name}`);
      let value: string | undefined;
      if (eq > 0) value = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("-")) value = argv[++i];
      if (!value) throw new UsageError(`Option ${name} needs a value.`);
      args[key] = value;
      continue;
    }
    positional.push(a);
  }
  if (positional[0] === "help") args.help = true;
  else if (positional.length > 2) throw new UsageError(`Unexpected argument: ${positional[2]}`);
  args.command = positional[0];
  args.root = positional[1];
  return args;
}

const USAGE =
  `Usage: gdcorrect <${[...COMMANDS].join("|")}> <projectPath> [options]\n` +
  "       gdcorrect rules [projectPath]\n" +
  "Run 'gdcorrect --help' for commands, options and exit codes.";

const HELP = `gdcorrect: offline static correctness checks for Godot 4.x projects

Usage: gdcorrect <command> <projectPath> [options]

Commands:
  lint                  Lint GDScript files with the configured rules
  validate-scenes       Check .tscn files: resources, uids, node parents,
                        [connection] methods, and $Path/get_node literals
  validate-project      Check project.godot: main scene, autoloads, input map,
                        and input action names used in scripts
  validate-registries   Deep-validate .tres registries listed in registryDirs
  report                Run every check above and aggregate the results
  rules [projectPath]   List every rule id and its default severity, or the
                        effective settings from a project's config

Options:
  -f, --format <${FORMATS.join("|")}>   Output format (default: json)
      --baseline <file>             Report only findings not in this baseline
      --write-baseline <file>       Record current findings as the baseline, exit 0
      --fail-on <${FAIL_ON.join("|")}>
                                    Lowest severity that fails the run (default: error)
  -h, --help                        Show this help
  -v, --version                     Print the version

Exit codes:
  0  no findings at or above --fail-on
  1  findings at or above --fail-on
  2  usage, config, or tool error

Config: godot-correctness.config.json in the project root.
Docs:   https://github.com/TMHSDigital/godot-correctness-mcp`;

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

/** `gdcorrect rules [projectPath]`: the rule catalogue, optionally with a project's effective config. */
function listRules(
  root: string | undefined,
  format: string,
  log: (s: string) => void,
  errOut: (s: string) => void,
): number {
  if (format !== "json" && format !== "pretty") {
    errOut("gdcorrect rules: use --format json or pretty.");
    return 2;
  }
  try {
    let cfg: ResolvedConfig | undefined;
    if (root) {
      requireDir(root);
      cfg = loadConfig(root);
    }
    const rules = effectiveRules(cfg);
    if (format === "json") {
      log(JSON.stringify({ root: root ?? null, godotVersion: cfg?.projectGodotVersion ?? null, rules }, null, 2));
      return 0;
    }
    const width = Math.max(...rules.map((r) => r.id.length));
    for (const r of rules) {
      const state = r.enabled ? r.severity.padEnd(7) : "off    ";
      log(`${r.id.padEnd(width)}  ${state}  ${r.description}`);
    }
    return 0;
  } catch (err) {
    errOut(`gdcorrect: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

/**
 * Exit code: 0 when no finding is at or above --fail-on (default: error), 1
 * when one is, 2 on usage, config, or tool failure.
 */
export async function runCli(
  argv: string[],
  log: (s: string) => void = console.log,
  errOut: (s: string) => void = console.error,
): Promise<number> {
  let parsed: CliArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    errOut(`gdcorrect: ${err.message}\n${USAGE}`);
    return 2;
  }
  const { command, root, format, baseline, writeBaseline: writeTo, failOn } = parsed;
  if (parsed.help) {
    log(HELP);
    return 0;
  }
  if (parsed.version) {
    log(readVersion());
    return 0;
  }
  if (command === "rules") return listRules(root, format, log, errOut);
  if (!command || !COMMANDS.has(command) || !root) {
    errOut(command && !COMMANDS.has(command) ? `gdcorrect: unknown command: ${command}\n${USAGE}` : USAGE);
    return 2;
  }
  if (!isFormat(format)) {
    errOut(`Unknown format: ${format}. Use one of: ${FORMATS.join(", ")}.`);
    return 2;
  }
  if (!isFailOn(failOn)) {
    errOut(`Unknown --fail-on level: ${failOn}. Use one of: ${FAIL_ON.join(", ")}.`);
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
    return fails(res.findings, failOn) ? 1 : 0;
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
