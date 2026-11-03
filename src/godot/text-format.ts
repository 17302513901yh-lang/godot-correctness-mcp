/**
 * Tolerant parser for Godot 4.x text formats (.tscn, .tres, project.godot).
 * These are INI-like: bracketed section headers with optional attributes,
 * followed by `key = value` lines. Values may be strings, numbers, bools, or
 * constructor literals (ExtResource("id"), Vector2(...), arrays/dicts that can
 * span lines). Unknown constructs are preserved as opaque `other` values; the
 * parser never throws.
 */

export type GodotValueKind =
  | "string"
  | "number"
  | "bool"
  | "extResource"
  | "subResource"
  | "other";

export interface GodotValue {
  raw: string;
  /** 1-based line where the value starts. */
  line: number;
  kind: GodotValueKind;
  /** For kind "string": the unquoted content. */
  string?: string;
  /** For kind extResource/subResource: the referenced id. */
  ref?: string;
}

export interface GodotSection {
  /** Section kind: the first token in the header, e.g. "node", "ext_resource". */
  kind: string;
  attributes: Record<string, GodotValue>;
  properties: Record<string, GodotValue>;
  /** 1-based line of the section header. */
  line: number;
}

export interface GodotFile {
  /** The gd_scene / gd_resource header section, or null (e.g. project.godot). */
  header: GodotSection | null;
  sections: GodotSection[];
}

const HEADER_KINDS = new Set(["gd_scene", "gd_resource"]);

function classifyValue(raw: string, line: number): GodotValue {
  const t = raw.trim();
  let m: RegExpExecArray | null;
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return { raw: t, line, kind: "string", string: t.slice(1, -1) };
  }
  if ((m = /^ExtResource\(\s*"?([^")]*)"?\s*\)$/.exec(t))) {
    return { raw: t, line, kind: "extResource", ref: m[1] };
  }
  if ((m = /^SubResource\(\s*"?([^")]*)"?\s*\)$/.exec(t))) {
    return { raw: t, line, kind: "subResource", ref: m[1] };
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return { raw: t, line, kind: "number" };
  if (t === "true" || t === "false") return { raw: t, line, kind: "bool" };
  return { raw: t, line, kind: "other" };
}

/** Split `key=value key2="v 2"` attribute text, respecting quotes. */
function parseAttributes(text: string, line: number): Record<string, GodotValue> {
  const attrs: Record<string, GodotValue> = {};
  const re = /(\w[\w./-]*)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) attrs[m[1]] = classifyValue(m[2], line);
  return attrs;
}

/** Whether brackets/braces/parens/quotes in `s` are balanced (string-aware). */
function isBalanced(s: string): boolean {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
  }
  return depth <= 0 && !inStr;
}

export function parseGodotFile(source: string): GodotFile {
  const lines = source.split(/\r?\n/);
  const file: GodotFile = { header: null, sections: [] };
  let current: GodotSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (line === "" || line.startsWith(";")) continue;

    const headerMatch = /^\[(.+)\]\s*$/.exec(line);
    if (headerMatch) {
      const inner = headerMatch[1].trim();
      const sp = inner.search(/\s/);
      const kind = sp === -1 ? inner : inner.slice(0, sp);
      const attrText = sp === -1 ? "" : inner.slice(sp + 1);
      const section: GodotSection = {
        kind,
        attributes: parseAttributes(attrText, i + 1),
        properties: {},
        line: i + 1,
      };
      if (HEADER_KINDS.has(kind) && !file.header) file.header = section;
      else file.sections.push(section);
      current = section;
      continue;
    }

    const propMatch = /^([\w./-]+)\s*=\s*(.*)$/.exec(line);
    if (propMatch && current) {
      const key = propMatch[1];
      let value = propMatch[2];
      const startLine = i + 1;
      // Continue multi-line values (arrays/dicts/constructors) until balanced.
      while (!isBalanced(value) && i + 1 < lines.length) {
        i++;
        value += `\n${lines[i]}`;
      }
      current.properties[key] = classifyValue(value, startLine);
    }
    // Anything else is opaque and intentionally ignored.
  }

  return file;
}

/** Convenience: all sections of a given kind (e.g. "ext_resource", "node"). */
export function sectionsOfKind(file: GodotFile, kind: string): GodotSection[] {
  return file.sections.filter((s) => s.kind === kind);
}
