import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSymbolDb } from "../src/symbols/db.js";
import {
  SYMBOL_KINDS,
  classSummary,
  diffClass,
  diffSymbol,
  formatMethod,
  formatProperty,
  formatSignal,
  formatUtility,
  lookupSymbol,
} from "../src/symbols/lookup.js";
import {
  parseSymbolDb,
  type Method,
  type Property,
  type SymbolArg,
  type SymbolDb,
} from "../src/symbols/schema.js";

function loadFixture(name: string): SymbolDb {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return parseSymbolDb(JSON.parse(readFileSync(path, "utf-8")) as unknown);
}

const db44 = loadFixture("fixture-4.4.json");
const db45 = loadFixture("fixture-4.5.json");

describe("lookupSymbol (fixtures)", () => {
  it("finds a method by bare name with its owner and signature", () => {
    const r = lookupSymbol(db44, "move_and_slide");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ kind: "method", owner: "CharacterBody2D", name: "move_and_slide" });
    expect(r.matches[0]?.signature).toContain("-> bool");
  });

  it("resolves a qualified Owner.member query", () => {
    const r = lookupSymbol(db44, "CharacterBody2D.velocity");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ kind: "property", owner: "CharacterBody2D", name: "velocity" });
    expect(r.matches[0]?.signature).toContain("Vector2");
  });

  it("finds a class by name", () => {
    const r = lookupSymbol(db44, "Node");
    expect(r.matches.some((m) => m.kind === "class" && m.name === "Node")).toBe(true);
  });

  it("returns closest-match suggestions on a miss", () => {
    const r = lookupSymbol(db44, "move_and_slid");
    expect(r.matches).toHaveLength(0);
    expect(r.suggestions?.map((s) => s.name)).toContain("move_and_slide");
  });

  it("respects a kind filter", () => {
    const r = lookupSymbol(db44, "Node", { kind: "class" });
    expect(r.matches.every((m) => m.kind === "class")).toBe(true);
  });
});

describe("classSummary (fixtures)", () => {
  it("lists members and the full inheritance chain", () => {
    const s = classSummary(db44, "CharacterBody2D");
    expect(s).toBeDefined();
    expect(s?.inheritanceChain).toEqual(["Node", "Object"]);
    expect(s?.methods.some((m) => m.includes("move_and_slide"))).toBe(true);
    expect(s?.properties.some((p) => p.includes("velocity"))).toBe(true);
  });

  it("is case-insensitive and returns undefined for unknown classes", () => {
    expect(classSummary(db44, "characterbody2d")?.name).toBe("CharacterBody2D");
    expect(classSummary(db44, "NoSuchClass")).toBeUndefined();
  });
});

describe("diffClass (fixtures 4.4 -> 4.5)", () => {
  const d = diffClass(db44, db45, "CharacterBody2D");

  it("detects added, removed, and signature-changed methods", () => {
    expect(d.methods.added.some((s) => s.includes("get_platform_velocity"))).toBe(true);
    expect(d.methods.removed.some((s) => s.includes("deprecated_helper"))).toBe(true);
    const changed = d.methods.changed.find((c) => c.name === "move_and_slide");
    expect(changed).toBeDefined();
    expect(changed?.old).not.toBe(changed?.new);
    expect(changed?.new).toContain("stop_on_slope");
  });

  it("reports the class as present in both and not identical", () => {
    expect(d.presence.inFrom).toBe(true);
    expect(d.presence.inTo).toBe(true);
    expect(d.identical).toBe(false);
  });

  it("flags a class added in the newer version", () => {
    const added = diffClass(db44, db45, "SkeletonModifier3D");
    expect(added.presence.inFrom).toBe(false);
    expect(added.presence.inTo).toBe(true);
    expect(added.methods.added.length).toBeGreaterThan(0);
  });

  it("only fires on genuine changes (does not flag stable members)", () => {
    // is_on_floor is identical across versions; must not appear in any bucket.
    const all = [...d.methods.added, ...d.methods.removed, ...d.methods.changed.map((c) => c.name)];
    expect(all.some((s) => s.includes("is_on_floor"))).toBe(false);
  });
});

describe("diffSymbol (fixtures)", () => {
  it("reports a changed method with both signatures side by side", () => {
    const d = diffSymbol(db44, db45, "move_and_slide");
    const entry = d.entries.find((e) => e.owner === "CharacterBody2D");
    expect(entry?.status).toBe("changed");
    expect(entry?.fromSignature).toBeTruthy();
    expect(entry?.toSignature).toBeTruthy();
    expect(entry?.fromSignature).not.toBe(entry?.toSignature);
  });

  it("reports a removed member", () => {
    const d = diffSymbol(db44, db45, "deprecated_helper");
    const entry = d.entries.find((e) => e.name === "deprecated_helper");
    expect(entry?.status).toBe("removed");
    expect(entry?.toSignature).toBeNull();
  });
});

describe("committed artifacts (real DBs)", () => {
  for (const label of ["4.4", "4.5"] as const) {
    it(`loads and validates the ${label} symbol DB`, () => {
      const db = loadSymbolDb(label);
      expect(db.meta.versionLabel).toBe(label);
      expect(Object.keys(db.classes).length).toBeGreaterThan(900);
      expect(db.classes["CharacterBody2D"]).toBeDefined();
    });
  }

  it("diffs a real class across the committed versions", () => {
    const d = diffClass(loadSymbolDb("4.4"), loadSymbolDb("4.5"), "Node");
    expect(d.presence.inFrom).toBe(true);
    expect(d.presence.inTo).toBe(true);
  });
});

describe("lookup edge cases", () => {
  it("resolves inherited members in Owner.member queries", () => {
    const r = lookupSymbol(db45, "CharacterBody2D.queue_free");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ kind: "method", owner: "Node", name: "queue_free" });
    expect(lookupSymbol(db45, "characterbody2d.get_class").matches[0]).toMatchObject({ owner: "Object" });
  });

  it("restricts fuzzy suggestions to the requested kind", () => {
    const r = lookupSymbol(db45, "CharacterBody", { kind: "class" });
    expect(r.matches).toEqual([]);
    expect(r.suggestions?.length).toBeGreaterThan(0);
    expect(r.suggestions?.every((s) => s.kind === "class")).toBe(true);
    expect(lookupSymbol(db45, "get_childs", { kind: "class" }).suggestions).toEqual([]);
  });

  it("treats Object.prototype names as unknown classes", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(classSummary(db45, name)).toBeUndefined();
    }
  });

  it("api diff returns suggestions for a typo", () => {
    const d = diffSymbol(db44, db45, "move_and_slid");
    expect(d.entries).toEqual([]);
    expect(d.suggestions?.[0]).toMatchObject({ name: "move_and_slide", kind: "method" });
  });

  it("does not throw on degenerate queries", () => {
    for (const q of ["", "Node.", ".velocity", "."]) expect(() => lookupSymbol(db45, q)).not.toThrow();
  });

  it("returns no matches (only suggestions or nothing) for degenerate queries", () => {
    for (const q of ["", "Node.", ".velocity"]) expect(lookupSymbol(db45, q).matches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #82: symbol kinds, signature formatters and diff statuses
// ---------------------------------------------------------------------------

const META = {
  godotVersion: "4.4.1",
  versionLabel: "4.4",
  versionFull: "4.4.1.stable.official",
  releaseTag: "4.4.1-stable",
  archiveName: null,
  archiveSha256: null,
  source: "test",
  schemaVersion: 1 as const,
  generatedAt: "2026-01-01T00:00:00Z",
};

function cls(overrides: Record<string, unknown> = {}) {
  return {
    inherits: null,
    apiType: "core",
    methods: [],
    properties: [],
    signals: [],
    enums: [],
    constants: [],
    ...overrides,
  };
}

function makeDb(classes: Record<string, unknown>): SymbolDb {
  return parseSymbolDb({
    meta: { ...META },
    classes,
    builtinClasses: {},
    utilityFunctions: [],
    globalEnums: [],
    singletons: [],
  });
}

const args = (...specs: [string, string][]): SymbolArg[] =>
  specs.map(([type, name]) => ({ type, name }));

describe("lookupSymbol kinds", () => {
  it("resolves a qualified property case-insensitively in both segments", () => {
    const r = lookupSymbol(db44, "characterbody2d.VELOCITY");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({
      kind: "property",
      owner: "CharacterBody2D",
      name: "velocity",
    });
  });

  it("gives builtin methods, utilities, singletons and global enums their own kinds", () => {
    expect(lookupSymbol(db44, "Vector2.length").matches[0]).toMatchObject({
      kind: "builtin_method",
      owner: "Vector2",
    });
    expect(lookupSymbol(db44, "lerp").matches[0]).toMatchObject({
      kind: "utility_function",
      owner: null,
    });
    expect(lookupSymbol(db44, "Engine").matches[0]).toMatchObject({
      kind: "singleton",
      owner: null,
    });
    expect(lookupSymbol(db44, "Side").matches[0]).toMatchObject({
      kind: "global_enum",
      owner: null,
    });
  });

  it("reports class constants", () => {
    const r = lookupSymbol(db44, "CharacterBody2D.MOTION_MODE_GROUNDED");
    expect(r.matches[0]).toMatchObject({ kind: "constant", owner: "CharacterBody2D" });
  });

  it("only ever yields kinds declared in SYMBOL_KINDS", () => {
    const queries = ["Node", "lerp", "Engine", "Side", "Vector2.length", "move_and_slide"];
    for (const q of queries) {
      for (const m of lookupSymbol(db44, q).matches) expect(SYMBOL_KINDS).toContain(m.kind);
    }
  });
});

describe("lookupSymbol kind filter", () => {
  const db = makeDb({
    Probe: cls(),
    Alpha: cls({ methods: [{ name: "Probe", ret: null, args: [] }] }),
  });

  it("returns both the class and the method for an unqualified query", () => {
    const kinds = lookupSymbol(db, "Probe").matches.map((m) => m.kind).sort();
    expect(kinds).toEqual(["class", "method"]);
  });

  it("narrows the same query down to the requested kind", () => {
    const only = lookupSymbol(db, "Probe", { kind: "method" });
    expect(only.matches).toHaveLength(1);
    expect(only.matches[0]).toMatchObject({ kind: "method", owner: "Alpha", name: "Probe" });
  });
});

describe("signature formatters", () => {
  const base: Method = { name: "do_it", ret: "bool", args: args(["int", "count"]) };

  it("prefixes static, const and virtual flags and the optional owner", () => {
    expect(formatMethod(base)).toBe("do_it(int count) -> bool");
    expect(formatMethod({ ...base, isStatic: true }, "Node")).toBe(
      "static Node.do_it(int count) -> bool",
    );
    expect(formatMethod({ ...base, isConst: true, isVirtual: true })).toBe(
      "const virtual do_it(int count) -> bool",
    );
  });

  it("falls back to void when no return type is recorded", () => {
    expect(formatMethod({ name: "reset", ret: null, args: [] })).toBe("reset() -> void");
  });

  it("renders varargs with and without fixed arguments", () => {
    expect(
      formatMethod({ name: "callv", ret: null, args: args(["String", "method"]), isVararg: true }),
    ).toBe("callv(String method, ...) -> void");
    expect(formatMethod({ name: "print", ret: null, args: [], isVararg: true })).toBe(
      "print(...) -> void",
    );
  });

  it("keeps argument defaults", () => {
    const m: Method = {
      name: "clamp",
      ret: "int",
      args: [{ type: "int", name: "value" }, { type: "int", name: "min", default: "0" }],
    };
    expect(formatMethod(m)).toBe("clamp(int value, int min = 0) -> int");
  });

  it("formats properties with and without accessors", () => {
    const plain: Property = { name: "velocity", type: "Vector2" };
    expect(formatProperty(plain)).toBe("Vector2 velocity");
    expect(formatProperty({ ...plain, getter: "get_velocity" })).toBe(
      "Vector2 velocity [get=get_velocity]",
    );
    expect(
      formatProperty({ ...plain, getter: "get_velocity", setter: "set_velocity" }, "Body"),
    ).toBe("Vector2 Body.velocity [get=get_velocity set=set_velocity]");
  });

  it("formats signals", () => {
    expect(formatSignal({ name: "died", args: [] }, "Node")).toBe("signal Node.died()");
    expect(formatSignal({ name: "moved", args: args(["Vector2", "delta"]) })).toBe(
      "signal moved(Vector2 delta)",
    );
  });

  it("formats utility functions with their category", () => {
    expect(
      formatUtility({
        name: "lerp",
        ret: "Variant",
        category: "math",
        args: args(["float", "from"], ["float", "to"], ["float", "weight"]),
        isVararg: true,
      }),
    ).toBe("lerp(float from, float to, float weight, ...) -> Variant  # math");
  });

  it("labels bitfield enums as bitfield, both in class summaries and lookups", () => {
    const db = makeDb({
      Flags: cls({
        enums: [
          {
            name: "Mode",
            isBitfield: true,
            values: [{ name: "A", value: 1 }, { name: "B", value: 2 }],
          },
        ],
      }),
    });
    expect(classSummary(db, "Flags")?.enums).toEqual(["bitfield Mode { A = 1, B = 2 }"]);
    expect(lookupSymbol(db, "Flags.Mode").matches[0]?.signature).toBe(
      "bitfield Flags.Mode { A = 1, B = 2 }",
    );
  });
});

describe("diff statuses (#82)", () => {
  it("marks a member that only exists in the newer DB as added", () => {
    const d = diffSymbol(db44, db45, "get_platform_velocity");
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ status: "added", fromSignature: null });
    expect(d.entries[0]?.toSignature).toBeTruthy();
  });

  it("marks an untouched member as unchanged", () => {
    const d = diffSymbol(db44, db45, "is_on_floor");
    expect(d.entries[0]).toMatchObject({ status: "unchanged", owner: "CharacterBody2D" });
    expect(d.entries[0]?.fromSignature).toBe(d.entries[0]?.toSignature);
  });

  it("reports identical when a class is diffed against its own DB", () => {
    const d = diffClass(db44, db44, "CharacterBody2D");
    expect(d.identical).toBe(true);
    const buckets = [d.methods, d.properties, d.signals, d.enums, d.constants];
    expect(buckets.flatMap((b) => [...b.added, ...b.removed, ...b.changed])).toEqual([]);
  });

  it("reports a class missing from both sides as not identical", () => {
    expect(diffClass(db44, db45, "NoSuchClass").identical).toBe(false);
  });
});
