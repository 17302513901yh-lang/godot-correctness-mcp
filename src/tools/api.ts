import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PINNED_GODOT_VERSIONS } from "../capabilities.js";
import { availableVersions, loadSymbolDb } from "../symbols/db.js";
import {
  classSummary,
  diffClass,
  diffSymbol,
  lookupSymbol,
  SYMBOL_KINDS,
} from "../symbols/lookup.js";
import { fail, guard, ok } from "./result.js";

export const VERSION = z.enum(PINNED_GODOT_VERSIONS);
const KIND = z.enum(SYMBOL_KINDS);

/** Default api_diff pair: the two newest pinned versions. */
export const DIFF_DEFAULT_FROM = PINNED_GODOT_VERSIONS[PINNED_GODOT_VERSIONS.length - 2]!;
export const DIFF_DEFAULT_TO = PINNED_GODOT_VERSIONS[PINNED_GODOT_VERSIONS.length - 1]!;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** Register the API symbol lookup / summary / diff tools. */
export function registerApiTools(server: McpServer): void {
  server.registerTool(
    "api_symbol_lookup",
    {
      description:
        "Look up a Godot API symbol (class, method, property, or signal) by name across " +
        "the pinned Godot versions. Supports 'Owner.member' queries. Returns full " +
        "signature data, or closest-match suggestions on a miss.",
      inputSchema: {
        symbol: z.string().min(1).describe("Symbol name, e.g. 'Node', 'move_and_slide', or 'Node.get_child_count'"),
        version: VERSION.optional().describe("Limit to one version; omit to search all available versions"),
        kind: KIND.optional().describe("Restrict results to one symbol kind"),
      },
      annotations: READ_ONLY,
    },
    async ({ symbol, version, kind }) => {
      const versions = version ? [version] : availableVersions();
      if (versions.length === 0) return fail("No symbol databases are available.");
      return guard(() => {
        const results = Object.fromEntries(
          versions.map((v) => [v, lookupSymbol(loadSymbolDb(v), symbol, kind ? { kind } : {})]),
        );
        return { symbol, versions, results };
      });
    },
  );

  server.registerTool(
    "api_class_summary",
    {
      description:
        "Full member listing for one Godot class in one version: inheritance chain, " +
        "methods, properties, signals, enums, and constants.",
      inputSchema: {
        class: z.string().min(1).describe("Class name, e.g. 'CharacterBody2D'"),
        version: VERSION.describe("Which Godot version to summarize"),
      },
      annotations: READ_ONLY,
    },
    async ({ class: className, version }) =>
      guard(() => {
        const db = loadSymbolDb(version);
        const summary = classSummary(db, className);
        if (!summary) {
          const suggestions = lookupSymbol(db, className, { kind: "class" }).suggestions ?? [];
          return fail(
            `Class '${className}' not found in Godot ${version}.` +
              (suggestions.length ? ` Did you mean: ${[...new Set(suggestions.map((s) => s.name))].join(", ")}?` : ""),
          );
        }
        return { version, ...summary };
      }),
  );

  server.registerTool(
    "api_diff",
    {
      description:
        `Diff a Godot class or symbol between two versions (default ${DIFF_DEFAULT_FROM} -> ` +
        `${DIFF_DEFAULT_TO}): what was added, removed, or had its signature changed, with ` +
        "old and new signatures side by side.",
      inputSchema: {
        symbol: z.string().min(1).describe("Class name (e.g. 'TileMap') or symbol (e.g. 'move_and_slide')"),
        from: VERSION.optional().describe(`Base version (default ${DIFF_DEFAULT_FROM})`),
        to: VERSION.optional().describe(`Target version (default ${DIFF_DEFAULT_TO})`),
      },
      annotations: READ_ONLY,
    },
    async ({ symbol, from = DIFF_DEFAULT_FROM, to = DIFF_DEFAULT_TO }) => {
      if (from === to) return fail("'from' and 'to' must be different versions.");
      return guard(() => {
        const fromDb = loadSymbolDb(from);
        const toDb = loadSymbolDb(to);
        // A dotted query is always a member; otherwise try a class diff first.
        if (!symbol.includes(".")) {
          const cd = diffClass(fromDb, toDb, symbol);
          if (cd.presence.inFrom || cd.presence.inTo) return ok({ type: "class", diff: cd });
        }
        return { type: "symbol", diff: diffSymbol(fromDb, toDb, symbol) };
      });
    },
  );
}
