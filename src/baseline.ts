import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Finding } from "./lint/types.js";

const baselineSchema = z.object({
  version: z.literal(1),
  entries: z.array(
    z.object({
      ruleId: z.string(),
      file: z.string(),
      fingerprint: z.string(),
      count: z.number().int().positive(),
    }),
  ),
});

/**
 * Baseline files let an existing project adopt the CI gate: record today's
 * findings once, then fail only on findings that are not in the baseline.
 *
 * Findings are fingerprinted by rule, file, and a hash of the trimmed source
 * line they point at (not the line number), so unrelated edits that shift lines
 * do not invalidate the baseline. Identical fingerprints are counted, so a
 * second copy of the same problem on an identical line is still reported.
 */
export interface BaselineFile {
  version: 1;
  entries: { ruleId: string; file: string; fingerprint: string; count: number }[];
}

type LineReader = (file: string) => string[] | null;

function fileLineReader(root: string): LineReader {
  const cache = new Map<string, string[] | null>();
  return (file) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, readFileSync(join(root, file), "utf-8").split(/\r?\n/));
      } catch {
        cache.set(file, null);
      }
    }
    return cache.get(file)!;
  };
}

function fingerprint(f: Finding, readLines: LineReader): string {
  const text = readLines(f.file)?.[f.line - 1]?.trim().replace(/\s+/g, " ") ?? `line:${f.line}`;
  return createHash("sha256").update(`${f.ruleId}\0${f.file}\0${text}`).digest("hex").slice(0, 16);
}

function key(ruleId: string, file: string, fp: string): string {
  return `${ruleId}\0${file}\0${fp}`;
}

/** Build a baseline from the current findings. */
export function createBaseline(root: string, findings: Finding[]): BaselineFile {
  const readLines = fileLineReader(root);
  const counts = new Map<string, BaselineFile["entries"][number]>();
  for (const f of findings) {
    const fp = fingerprint(f, readLines);
    const k = key(f.ruleId, f.file, fp);
    const e = counts.get(k);
    if (e) e.count++;
    else counts.set(k, { ruleId: f.ruleId, file: f.file, fingerprint: fp, count: 1 });
  }
  const entries = [...counts.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.ruleId.localeCompare(b.ruleId) || a.fingerprint.localeCompare(b.fingerprint),
  );
  return { version: 1, entries };
}

export interface BaselineResult {
  /** Findings not covered by the baseline. */
  newFindings: Finding[];
  /** How many findings the baseline absorbed. */
  baselined: number;
  /** Baseline entries (by count) that no longer match any finding. */
  stale: number;
}

/** Split findings into new vs. baselined. */
export function applyBaseline(root: string, findings: Finding[], baseline: BaselineFile): BaselineResult {
  const readLines = fileLineReader(root);
  const remaining = new Map<string, number>();
  for (const e of baseline.entries) remaining.set(key(e.ruleId, e.file, e.fingerprint), e.count);
  const newFindings: Finding[] = [];
  let baselined = 0;
  for (const f of findings) {
    const k = key(f.ruleId, f.file, fingerprint(f, readLines));
    const left = remaining.get(k) ?? 0;
    if (left > 0) {
      remaining.set(k, left - 1);
      baselined++;
    } else {
      newFindings.push(f);
    }
  }
  const stale = [...remaining.values()].reduce((a, b) => a + b, 0);
  return { newFindings, baselined, stale };
}

export function readBaseline(path: string): BaselineFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`Cannot read baseline ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = baselineSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length ? ` at ${issue.path.join(".")}` : "";
    throw new Error(
      `Baseline ${path} is not a valid gdcorrect baseline (expected { "version": 1, "entries": [...] })${where}: ${issue?.message ?? "invalid"}.`,
    );
  }
  return parsed.data;
}

export function writeBaseline(path: string, baseline: BaselineFile): void {
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
}
