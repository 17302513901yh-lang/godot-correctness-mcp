#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PINNED_GODOT_VERSIONS } from "./capabilities.js";
import { isMainModule } from "./entry.js";
import { registerSkillResources } from "./resources/skills.js";
import { getServerInfo, readVersion, SERVER_NAME } from "./server-info.js";
import { registerApiTools } from "./tools/api.js";
import { registerLintTools } from "./tools/lint.js";
import { ok } from "./tools/result.js";
import { registerSceneTools } from "./tools/scenes.js";

/** Build the MCP server with all tools registered. Exported for offline tests. */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: readVersion() });

  server.registerTool(
    "server_info",
    {
      description:
        `Report this server's version, the pinned Godot versions it targets ` +
        `(${PINNED_GODOT_VERSIONS.join(", ")}), and which correctness pillars (GDScript lint, ` +
        "API symbols, scene/resource analysis) are currently available. Takes no arguments.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ok(getServerInfo()),
  );

  registerApiTools(server);
  registerLintTools(server);
  registerSceneTools(server);
  registerSkillResources(server);

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run the stdio server only when executed directly, not when imported by tests.
if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
