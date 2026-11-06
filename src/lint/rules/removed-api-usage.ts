import type { Node } from "web-tree-sitter";
import { PINNED_GODOT_VERSIONS, type GodotVersion } from "../../capabilities.js";
import { pinnedVersionFor } from "../../project/godot-version.js";
import { findAll, text, walk } from "../../gdscript/ast.js";
import { loadSymbolDb } from "../../symbols/db.js";
import type { Method, SymbolDb } from "../../symbols/schema.js";
import type { RawFinding, Rule } from "../types.js";

type MemberKind = "method" | "property" | "signal" | "constant" | "enum";
interface Member {
  kind: MemberKind;
  owner: string;
  method?: Method;
}

const memberCache = new WeakMap<SymbolDb, Map<string, Map<string, Member>>>();

/** All members visible on `cls` (own + inherited), nearest definition wins. */
function membersOf(db: SymbolDb, cls: string): Map<string, Member> {
  let perDb = memberCache.get(db);
  if (!perDb) memberCache.set(db, (perDb = new Map()));
  const hit = perDb.get(cls);
  if (hit) return hit;
  const out = new Map<string, Member>();
  const seen = new Set<string>();
  for (let cur: string | null = cls; cur && !seen.has(cur); ) {
    seen.add(cur);
    const def: SymbolDb["classes"][string] | undefined = db.classes[cur];
    if (!def) break;
    const add = (name: string, m: Member): void => {
      if (!out.has(name)) out.set(name, m);
    };
    for (const m of def.methods) add(m.name, { kind: "method", owner: cur, method: m });
    for (const p of def.properties) add(p.name, { kind: "property", owner: cur });
    for (const s of def.signals) add(s.name, { kind: "signal", owner: cur });
    for (const k of def.constants) add(k.name, { kind: "constant", owner: cur });
    for (const e of def.enums) {
      add(e.name, { kind: "enum", owner: cur });
      for (const v of e.values) add(v.name, { kind: "constant", owner: cur });
    }
    cur = def.inherits;
  }
  perDb.set(cls, out);
  return out;
}

/** [min, max] positional argument count a method accepts. */
function arity(m: Method): [number, number] {
  const min = m.args.filter((a) => a.default === undefined).length;
  return [min, m.isVararg ? Number.POSITIVE_INFINITY : m.args.length];
}

function argCount(call: Node): number {
  return call.childForFieldName("arguments")?.namedChildCount ?? call.namedChild(1)?.namedChildCount ?? 0;
}

/** Map typed variable/parameter names to their declared built-in class. */
function typedNames(root: Node, source: string, db: SymbolDb): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of walk(root)) {
    if (n.type !== "variable_statement" && !n.type.includes("parameter")) continue;
    const name = n.childForFieldName("name") ?? n.namedChildren.find((c) => c?.type === "identifier") ?? null;
    const type = n.childForFieldName("type");
    const typeId = type?.namedChild(0);
    if (!name || !typeId || typeId.type !== "identifier") continue;
    const t = text(typeId, source);
    if (db.classes[t]) out.set(text(name, source), t);
  }
  return out;
}

function previousVersion(target: GodotVersion): GodotVersion | null {
  const i = PINNED_GODOT_VERSIONS.indexOf(target);
  return i > 0 ? PINNED_GODOT_VERSIONS[i - 1]! : null;
}

/**
 * Flags uses of engine API that was removed, or whose call arity breaks,
 * between `fromVersion` and `targetVersion`. `targetVersion` defaults to the
 * newest pinned version not newer than the one project.godot declares
 * (`config/features`); set it explicitly to override:
 *
 *   "rules": { "removed-api-usage": { "options": { "targetVersion": "4.5" } } }
 *
 * With no explicit target and no declared project version, the rule is off.
 *
 * Only statically certain receivers are checked: `self`/bare calls on a script
 * that extends a built-in class, `ClassName.member`, and variables or
 * parameters with an explicit built-in type. Calls are flagged for a changed
 * signature only when the actual argument count is valid before and invalid
 * after, so new optional parameters never produce noise.
 */
export const removedApiUsage: Rule = {
  id: "removed-api-usage",
  description: "Engine API removed (or call made invalid) in the target Godot version.",
  defaultSeverity: "warning",
  check(ctx) {
    const target = ctx.options["targetVersion"] ?? pinnedVersionFor(ctx.projectGodotVersion ?? null);
    if (target === undefined || target === null) return [];
    if (typeof target !== "string" || !(PINNED_GODOT_VERSIONS as readonly string[]).includes(target)) {
      throw new Error(
        `removed-api-usage: options.targetVersion must be one of ${PINNED_GODOT_VERSIONS.join(", ")} (got ${JSON.stringify(target)}).`,
      );
    }
    const fromOpt = ctx.options["fromVersion"];
    if (fromOpt !== undefined) {
      // fromVersion may be newer than targetVersion (checking a downgrade), but
      // it must be a pinned version other than the target.
      const others = PINNED_GODOT_VERSIONS.filter((v) => v !== target);
      if (typeof fromOpt !== "string" || !(others as readonly string[]).includes(fromOpt)) {
        throw new Error(
          `removed-api-usage: options.fromVersion must be one of ${others.join(", ") || "(none)"} ` +
            `when targetVersion is ${target} (got ${JSON.stringify(fromOpt)}).`,
        );
      }
    }
    const from = typeof fromOpt === "string" ? fromOpt : previousVersion(target as GodotVersion);
    if (!from || from === target) return [];
    const oldDb = loadSymbolDb(from);
    const newDb = loadSymbolDb(target);
    const { root, source } = ctx;
    const out: RawFinding[] = [];

    const ownFuncs = new Set(
      findAll(root, "function_definition").map((f) => text(f.childForFieldName("name") ?? f, source)),
    );
    const ext = findAll(root, "extends_statement")[0]?.namedChild(0)?.namedChild(0);
    const base = ext?.type === "identifier" && oldDb.classes[text(ext, source)] ? text(ext, source) : null;
    const typed = typedNames(root, source, oldDb);

    const check = (cls: string, name: string, node: Node, call: Node | null): void => {
      const before = membersOf(oldDb, cls).get(name);
      if (!before) return; // unknown before: not ours to judge
      if (!newDb.classes[cls]) {
        out.push({ node, message: `${cls} was removed in Godot ${target} (present in ${from}).`,
          suggestion: `See api_diff for ${cls} between ${from} and ${target}.` });
        return;
      }
      const after = membersOf(newDb, cls).get(name);
      if (!after) {
        out.push({ node, message: `${cls}.${name} (${before.kind}) was removed in Godot ${target} (present in ${from}).`,
          suggestion: `Run api_diff on "${before.owner}.${name}" to find the replacement.` });
        return;
      }
      if (call && before.method && after.method) {
        const n = argCount(call);
        const [oMin, oMax] = arity(before.method);
        const [nMin, nMax] = arity(after.method);
        if (n >= oMin && n <= oMax && (n < nMin || n > nMax)) {
          out.push({ node, message: `${cls}.${name}() takes ${nMin === nMax ? nMin : `${nMin}-${nMax}`} argument(s) in Godot ${target}, but is called with ${n}.`,
            suggestion: `Run api_diff on "${after.owner}.${name}" to see the new signature.` });
        }
      }
    };

    // Overrides of engine virtuals (e.g. `func _font_draw_glyph(...)`): the
    // engine stops calling them if the virtual was removed or its arity changed.
    if (base) {
      for (const fn of findAll(root, "function_definition")) {
        if (fn.parent?.type !== "source") continue; // top-level script methods only
        const nameNode = fn.childForFieldName("name");
        if (!nameNode) continue;
        const name = text(nameNode, source);
        const before = membersOf(oldDb, base).get(name);
        if (!before?.method?.isVirtual) continue;
        const after = membersOf(newDb, base).get(name);
        const params = fn.childForFieldName("parameters")?.namedChildCount ?? 0;
        if (!after?.method) {
          out.push({ node: nameNode,
            message: `${name}() overrides ${before.owner}.${name}, a virtual removed in Godot ${target}; the engine will no longer call it.`,
            suggestion: `Run api_diff on "${before.owner}" to find the replacement virtual.` });
          continue;
        }
        const [oMin, oMax] = arity(before.method);
        const [nMin, nMax] = arity(after.method);
        if (params >= oMin && params <= oMax && (params < nMin || params > nMax)) {
          out.push({ node: nameNode,
            message: `${name}() overrides ${after.owner}.${name}, which takes ${nMin === nMax ? nMin : `${nMin}-${nMax}`} parameter(s) in Godot ${target}; this override declares ${params}.`,
            suggestion: `Run api_diff on "${after.owner}.${name}" and update the override's parameters.` });
        }
      }
    }

    for (const n of walk(root)) {
      if (n.type === "call") {
        // Bare call on the script's own base class: foo(...)
        const id = n.namedChild(0);
        if (!base || !id || id.type !== "identifier") continue;
        const name = text(id, source);
        if (!ownFuncs.has(name)) check(base, name, id, n);
      } else if (n.type === "attribute") {
        const recv = n.namedChild(0);
        const member = n.namedChild(1);
        if (!recv || !member || recv.type !== "identifier") continue;
        const r = text(recv, source);
        const cls = r === "self" ? base : typed.get(r) ?? (oldDb.classes[r] ? r : null);
        if (!cls) continue;
        if (member.type === "attribute_call") {
          const id = member.namedChild(0);
          if (id && !(r === "self" && ownFuncs.has(text(id, source)))) check(cls, text(id, source), id, member);
        } else if (member.type === "identifier") {
          check(cls, text(member, source), member, null);
        }
      }
    }
    return out;
  },
};
