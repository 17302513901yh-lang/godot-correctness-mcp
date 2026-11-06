import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The package root. This module sits one level below it in both layouts
 * (src/package-paths.ts under tsx/vitest, dist/package-paths.js when built),
 * so committed artifacts resolve the same way either way. Every lookup of
 * data/ or skills/ goes through here instead of counting `..` per file.
 */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Absolute path to a file or directory inside the package (e.g. "data", "skills/x.md"). */
export function packagePath(...parts: string[]): string {
  return join(PACKAGE_ROOT, ...parts);
}

/** Path to the committed gzipped symbol DB for a version label ("4.4"/"4.5"). */
export function symbolDbPath(label: string): string {
  return packagePath("data", `godot-${label}.symbols.json.gz`);
}

/** Path to the committed GDScript tree-sitter grammar. */
export const GRAMMAR_WASM_PATH = packagePath("data", "tree-sitter-gdscript.wasm");
