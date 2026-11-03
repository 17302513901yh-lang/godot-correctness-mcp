import type {
  BuiltinClassDef,
  ClassDef,
  EnumDef,
  Method,
  Property,
  Signal,
  SymbolArg,
  SymbolDb,
  UtilityFunction,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Signature formatting
// ---------------------------------------------------------------------------

function fmtArgs(args: SymbolArg[]): string {
  return args
    .map((a) => `${a.type} ${a.name}${a.default !== undefined ? ` = ${a.default}` : ""}`)
    .join(", ");
}

export function formatMethod(m: Method, owner?: string): string {
  const flags = [m.isStatic && "static", m.isConst && "const", m.isVirtual && "virtual"]
    .filter(Boolean)
    .join(" ");
  const prefix = flags ? `${flags} ` : "";
  const vararg = m.isVararg ? (m.args.length ? ", ..." : "...") : "";
  const q = owner ? `${owner}.` : "";
  return `${prefix}${q}${m.name}(${fmtArgs(m.args)}${vararg}) -> ${m.ret ?? "void"}`;
}

export function formatSignal(s: Signal, owner?: string): string {
  return `signal ${owner ? `${owner}.` : ""}${s.name}(${fmtArgs(s.args)})`;
}

export function formatProperty(p: Property, owner?: string): string {
  const acc = [p.getter && `get=${p.getter}`, p.setter && `set=${p.setter}`]
    .filter(Boolean)
    .join(" ");
  return `${p.type} ${owner ? `${owner}.` : ""}${p.name}${acc ? ` [${acc}]` : ""}`;
}

export function formatUtility(u: UtilityFunction): string {
  const vararg = u.isVararg ? (u.args.length ? ", ..." : "...") : "";
  return `${u.name}(${fmtArgs(u.args)}${vararg}) -> ${u.ret ?? "void"}  # ${u.category}`;
}

function formatEnum(e: EnumDef, owner?: string): string {
  const kind = e.isBitfield ? "bitfield" : "enum";
  const vals = e.values.map((v) => `${v.name} = ${v.value}`).join(", ");
  return `${kind} ${owner ? `${owner}.` : ""}${e.name} { ${vals} }`;
}

// ---------------------------------------------------------------------------
// Symbol index + lookup
// ---------------------------------------------------------------------------

export const SYMBOL_KINDS = [
  "class",
  "method",
  "property",
  "signal",
  "enum",
  "constant",
  "builtin_class",
  "builtin_method",
  "utility_function",
  "singleton",
  "global_enum",
] as const;

export type SymbolKind = (typeof SYMBOL_KINDS)[number];

export interface SymbolMatch {
  kind: SymbolKind;
  name: string;
  /** Owning class/builtin, or null for top-level symbols. */
  owner: string | null;
  signature: string;
}

interface IndexEntry extends SymbolMatch {
  detail: unknown;
}

const indexCache = new WeakMap<SymbolDb, IndexEntry[]>();

function buildIndex(db: SymbolDb): IndexEntry[] {
  const cached = indexCache.get(db);
  if (cached) return cached;
  const entries: IndexEntry[] = [];

  for (const [name, c] of Object.entries(db.classes)) {
    entries.push({
      kind: "class",
      name,
      owner: null,
      signature: `class ${name}${c.inherits ? ` extends ${c.inherits}` : ""}`,
      detail: { inherits: c.inherits, apiType: c.apiType },
    });
    for (const m of c.methods)
      entries.push({ kind: "method", name: m.name, owner: name, signature: formatMethod(m, name), detail: m });
    for (const p of c.properties)
      entries.push({ kind: "property", name: p.name, owner: name, signature: formatProperty(p, name), detail: p });
    for (const s of c.signals)
      entries.push({ kind: "signal", name: s.name, owner: name, signature: formatSignal(s, name), detail: s });
    for (const e of c.enums)
      entries.push({ kind: "enum", name: e.name, owner: name, signature: formatEnum(e, name), detail: e });
    for (const k of c.constants)
      entries.push({ kind: "constant", name: k.name, owner: name, signature: `const ${name}.${k.name} = ${k.value}`, detail: k });
  }

  for (const [name, b] of Object.entries(db.builtinClasses)) {
    entries.push({ kind: "builtin_class", name, owner: null, signature: `builtin ${name}`, detail: { members: b.members } });
    for (const m of b.methods)
      entries.push({ kind: "builtin_method", name: m.name, owner: name, signature: formatMethod(m, name), detail: m });
  }

  for (const u of db.utilityFunctions)
    entries.push({ kind: "utility_function", name: u.name, owner: null, signature: formatUtility(u), detail: u });

  for (const s of db.singletons)
    entries.push({ kind: "singleton", name: s.name, owner: null, signature: `singleton ${s.name}: ${s.type}`, detail: s });

  for (const e of db.globalEnums)
    entries.push({ kind: "global_enum", name: e.name, owner: null, signature: formatEnum(e), detail: e });

  indexCache.set(db, entries);
  return entries;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export interface LookupResult {
  query: string;
  matches: SymbolMatch[];
  suggestions?: { name: string; kind: SymbolKind; owner: string | null; distance: number }[];
}

function toMatch(e: IndexEntry): SymbolMatch & { detail: unknown } {
  return { kind: e.kind, name: e.name, owner: e.owner, signature: e.signature, detail: e.detail };
}

/**
 * Look up a symbol by name. Supports "Owner.member" qualified queries. Falls
 * back to closest-match suggestions when nothing matches exactly.
 */
export function lookupSymbol(
  db: SymbolDb,
  query: string,
  opts: { kind?: SymbolKind } = {},
): LookupResult {
  const index = buildIndex(db);
  const dot = query.indexOf(".");

  let candidates: IndexEntry[];
  if (dot > 0) {
    const owner = query.slice(0, dot);
    const member = query.slice(dot + 1);
    candidates = index.filter(
      (e) => e.owner !== null && e.owner === owner && e.name === member,
    );
    if (candidates.length === 0) {
      const ownerLc = owner.toLowerCase();
      const memberLc = member.toLowerCase();
      candidates = index.filter(
        (e) => e.owner?.toLowerCase() === ownerLc && e.name.toLowerCase() === memberLc,
      );
    }
  } else {
    candidates = index.filter((e) => e.name === query);
    if (candidates.length === 0) {
      const lc = query.toLowerCase();
      candidates = index.filter((e) => e.name.toLowerCase() === lc);
    }
  }

  if (opts.kind) candidates = candidates.filter((e) => e.kind === opts.kind);

  if (candidates.length > 0) {
    return { query, matches: candidates.map(toMatch) };
  }

  // Fuzzy fallback on the last path segment.
  const needle = (dot > 0 ? query.slice(dot + 1) : query).toLowerCase();
  const scored = index
    .map((e) => ({ e, d: levenshtein(needle, e.name.toLowerCase()) }))
    .filter(({ d, e }) => d <= Math.max(2, Math.floor(e.name.length / 3)))
    .sort((x, y) => x.d - y.d);

  const seen = new Set<string>();
  const suggestions: NonNullable<LookupResult["suggestions"]> = [];
  for (const { e, d } of scored) {
    const key = `${e.owner ?? ""}.${e.name}.${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ name: e.name, kind: e.kind, owner: e.owner, distance: d });
    if (suggestions.length >= 8) break;
  }
  return { query, matches: [], suggestions };
}

// ---------------------------------------------------------------------------
// Class summary
// ---------------------------------------------------------------------------

function findClass(db: SymbolDb, name: string): { name: string; def: ClassDef } | undefined {
  if (db.classes[name]) return { name, def: db.classes[name] };
  const lc = name.toLowerCase();
  const key = Object.keys(db.classes).find((k) => k.toLowerCase() === lc);
  return key ? { name: key, def: db.classes[key] } : undefined;
}

export interface ClassSummary {
  name: string;
  inherits: string | null;
  apiType: string;
  isRefcounted: boolean;
  isInstantiable: boolean;
  inheritanceChain: string[];
  methods: string[];
  properties: string[];
  signals: string[];
  enums: string[];
  constants: string[];
}

export function classSummary(db: SymbolDb, className: string): ClassSummary | undefined {
  const found = findClass(db, className);
  if (!found) return undefined;
  const { name, def } = found;

  const chain: string[] = [];
  let parent = def.inherits;
  const guard = new Set<string>();
  while (parent && !guard.has(parent)) {
    guard.add(parent);
    chain.push(parent);
    parent = db.classes[parent]?.inherits ?? null;
  }

  return {
    name,
    inherits: def.inherits,
    apiType: def.apiType,
    isRefcounted: def.isRefcounted ?? false,
    isInstantiable: def.isInstantiable ?? false,
    inheritanceChain: chain,
    methods: def.methods.map((m) => formatMethod(m)),
    properties: def.properties.map((p) => formatProperty(p)),
    signals: def.signals.map((s) => formatSignal(s)),
    enums: def.enums.map((e) => formatEnum(e)),
    constants: def.constants.map((k) => `${k.name} = ${k.value}`),
  };
}

// ---------------------------------------------------------------------------
// Cross-version diff
// ---------------------------------------------------------------------------

export interface MemberDiff {
  added: string[];
  removed: string[];
  changed: { name: string; old: string; new: string }[];
}

function diffMembers<T>(
  aList: T[],
  bList: T[],
  keyOf: (t: T) => string,
  sigOf: (t: T) => string,
): MemberDiff {
  const a = new Map(aList.map((t) => [keyOf(t), t]));
  const b = new Map(bList.map((t) => [keyOf(t), t]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: { name: string; old: string; new: string }[] = [];
  for (const [k, tb] of b) if (!a.has(k)) added.push(sigOf(tb));
  for (const [k, ta] of a) {
    const tb = b.get(k);
    if (!tb) {
      removed.push(sigOf(ta));
      continue;
    }
    const oldSig = sigOf(ta);
    const newSig = sigOf(tb);
    if (oldSig !== newSig) changed.push({ name: k, old: oldSig, new: newSig });
  }
  return { added, removed, changed };
}

function isEmptyDiff(d: MemberDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

export interface ClassDiff {
  class: string;
  presence: { fromLabel: string; toLabel: string; inFrom: boolean; inTo: boolean };
  methods: MemberDiff;
  properties: MemberDiff;
  signals: MemberDiff;
  enums: MemberDiff;
  constants: MemberDiff;
  identical: boolean;
}

export function diffClass(
  from: SymbolDb,
  to: SymbolDb,
  className: string,
): ClassDiff {
  const a = findClass(from, className);
  const b = findClass(to, className);
  const name = a?.name ?? b?.name ?? className;
  const ad = a?.def;
  const bd = b?.def;

  const methods = diffMembers(ad?.methods ?? [], bd?.methods ?? [], (m) => m.name, (m) => formatMethod(m));
  const properties = diffMembers(ad?.properties ?? [], bd?.properties ?? [], (p) => p.name, (p) => formatProperty(p));
  const signals = diffMembers(ad?.signals ?? [], bd?.signals ?? [], (s) => s.name, (s) => formatSignal(s));
  const enums = diffMembers(ad?.enums ?? [], bd?.enums ?? [], (e) => e.name, (e) => formatEnum(e));
  const constants = diffMembers(
    ad?.constants ?? [],
    bd?.constants ?? [],
    (k) => k.name,
    (k) => `${k.name} = ${k.value}`,
  );

  return {
    class: name,
    presence: {
      fromLabel: from.meta.versionLabel,
      toLabel: to.meta.versionLabel,
      inFrom: Boolean(ad),
      inTo: Boolean(bd),
    },
    methods,
    properties,
    signals,
    enums,
    constants,
    identical:
      Boolean(ad) &&
      Boolean(bd) &&
      [methods, properties, signals, enums, constants].every(isEmptyDiff),
  };
}

export interface SymbolDiffEntry {
  owner: string | null;
  kind: SymbolKind;
  name: string;
  fromSignature: string | null;
  toSignature: string | null;
  status: "added" | "removed" | "changed" | "unchanged";
}

export interface SymbolDiff {
  query: string;
  fromLabel: string;
  toLabel: string;
  entries: SymbolDiffEntry[];
}

function status(from: string | null, to: string | null): SymbolDiffEntry["status"] {
  if (from === null) return "added";
  if (to === null) return "removed";
  return from === to ? "unchanged" : "changed";
}

/**
 * Diff a bare or qualified symbol name across versions. For a class name, use
 * diffClass instead; this handles members (methods/properties/signals) found in
 * either version, matched by owner+name.
 */
export function diffSymbol(from: SymbolDb, to: SymbolDb, query: string): SymbolDiff {
  const fromMatches = lookupSymbol(from, query).matches;
  const toMatches = lookupSymbol(to, query).matches;
  const byKey = new Map<string, { owner: string | null; kind: SymbolKind; name: string; from?: string; to?: string }>();

  const key = (m: SymbolMatch): string => `${m.owner ?? ""}::${m.kind}::${m.name}`;
  for (const m of fromMatches) byKey.set(key(m), { owner: m.owner, kind: m.kind, name: m.name, from: m.signature });
  for (const m of toMatches) {
    const e = byKey.get(key(m)) ?? { owner: m.owner, kind: m.kind, name: m.name };
    e.to = m.signature;
    byKey.set(key(m), e);
  }

  const entries: SymbolDiffEntry[] = [...byKey.values()].map((e) => ({
    owner: e.owner,
    kind: e.kind,
    name: e.name,
    fromSignature: e.from ?? null,
    toSignature: e.to ?? null,
    status: status(e.from ?? null, e.to ?? null),
  }));

  return { query, fromLabel: from.meta.versionLabel, toLabel: to.meta.versionLabel, entries };
}
