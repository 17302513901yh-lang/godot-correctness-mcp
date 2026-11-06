import { existsSync } from "node:fs";
import { GRAMMAR_WASM_PATH, symbolDbPath } from "./package-paths.js";

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

/** Report which pillars are currently usable based on committed artifacts. */
export function pillarAvailability(): PillarAvailability {
  // The API tools work with any pinned version that has a DB, so the pillar
  // is available when at least one does (matching availableVersions()).
  const apiSymbols = PINNED_GODOT_VERSIONS.some((v) => existsSync(symbolDbPath(v)));
  const gdscriptLint = existsSync(GRAMMAR_WASM_PATH);
  return {
    gdscriptLint,
    apiSymbols,
    // Static scene/resource/registry analysis is pure TypeScript with
    // no external artifact; it is always available once shipped.
    sceneResourceAnalysis: true,
  };
}
