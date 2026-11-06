import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { PINNED_GODOT_VERSIONS } from "../capabilities.js";
import { symbolDbPath } from "../package-paths.js";
import { parseSymbolDb, type SymbolDb } from "./schema.js";

const cache = new Map<string, SymbolDb>();

/** Path to the committed gzipped symbol DB for a version label ("4.4"/"4.5"). */
export function dbPath(label: string): string {
  return symbolDbPath(label);
}

/** Whether a symbol DB artifact is present for the given version label. */
export function isVersionAvailable(label: string): boolean {
  return existsSync(dbPath(label));
}

/** Pinned versions that actually have a committed artifact. */
export function availableVersions(): string[] {
  return PINNED_GODOT_VERSIONS.filter(isVersionAvailable);
}

/** Decompress, parse, and validate a DB from an explicit file path. */
export function loadSymbolDbFromFile(path: string): SymbolDb {
  const raw = JSON.parse(gunzipSync(readFileSync(path)).toString("utf-8")) as unknown;
  return parseSymbolDb(raw);
}

/** Load (and cache) the committed symbol DB for a version label. */
export function loadSymbolDb(label: string): SymbolDb {
  const cached = cache.get(label);
  if (cached) return cached;
  const path = dbPath(label);
  if (!existsSync(path)) {
    throw new Error(
      `No symbol database for Godot ${label}. Expected ${path}. ` +
        `Available: ${availableVersions().join(", ") || "none"}.`,
    );
  }
  const db = loadSymbolDbFromFile(path);
  cache.set(label, db);
  return db;
}
