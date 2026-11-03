import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Godot minor versions this server carries symbol data for. Deliberately
 * narrow: the server targets 4.4 and 4.5 and nothing older. See README non-goals.
 */
export const PINNED_GODOT_VERSIONS = ["4.4", "4.5"] as const;

export type GodotVersion = (typeof PINNED_GODOT_VERSIONS)[number];

/**
 * The three correctness pillars. A pillar is "available" only when the offline
 * artifacts it depends on are actually present in the package. Later phases add
 * those artifacts, which flips the flags without any code change here.
 */
export interface PillarAvailability {
  /** GDScript anti-pattern linting (tree-sitter grammar WASM). */
  gdscriptLint: boolean;
  /** Cross-version API symbol lookup/diff (committed symbol databases). */
  apiSymbols: boolean;
  /** Static .tscn/.tres/project.godot analysis incl. registry validation. */
  sceneResourceAnalysis: boolean;
}

// dist/capabilities.js and src/capabilities.ts both sit one level below the
// package root, so data/ resolves the same whether running compiled or via tsx.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

/** Report which pillars are currently usable based on committed artifacts. */
export function pillarAvailability(): PillarAvailability {
  const apiSymbols = PINNED_GODOT_VERSIONS.every((v) =>
    existsSync(join(dataDir, `godot-${v}.symbols.json.gz`)),
  );
  const gdscriptLint = existsSync(join(dataDir, "tree-sitter-gdscript.wasm"));
  return {
    gdscriptLint,
    apiSymbols,
    // Static scene/resource/registry analysis is pure TypeScript with
    // no external artifact; it is always available once shipped.
    sceneResourceAnalysis: true,
  };
}
