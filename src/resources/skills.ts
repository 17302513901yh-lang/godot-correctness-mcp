import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { packagePath } from "../package-paths.js";

const skillsDir = packagePath("skills");

export interface SkillEntry {
  name: string;
  title: string;
  description: string;
}

/** Curated Godot 4.x GDScript skill snippets, exposed as MCP resources. */
export const SKILLS: SkillEntry[] = [
  {
    name: "data-driven-resources",
    title: "Data-driven resources and registry loading",
    description:
      "Keep custom Resource types data-only, load them via a validated registry, " +
      "and pair with the validate_registries tool to catch dangling paths.",
  },
  {
    name: "signal-hygiene",
    title: "Signal hygiene",
    description: "Typed connect API, disconnect/one-shot discipline, and awaiting signals.",
  },
  {
    name: "typed-gdscript",
    title: "Typed GDScript patterns",
    description: "Type every declaration, cache nodes with @onready, prefer $ over string paths.",
  },
  {
    name: "resource-preload",
    title: "preload vs load",
    description: "When to use compile-time preload versus runtime load for scenes and resources.",
  },
];

export function skillUri(name: string): string {
  return `skill://${name}`;
}

export function readSkill(name: string): string {
  return readFileSync(join(skillsDir, `${name}.md`), "utf-8");
}

/** Register each skill as a static MCP resource (list + read for free). */
export function registerSkillResources(server: McpServer): void {
  for (const s of SKILLS) {
    server.registerResource(
      s.name,
      skillUri(s.name),
      { title: s.title, description: s.description, mimeType: "text/markdown" },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: readSkill(s.name) }],
      }),
    );
  }
}
