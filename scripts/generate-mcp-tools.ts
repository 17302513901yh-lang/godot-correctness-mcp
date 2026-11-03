/**
 * Regenerate mcp-tools.json from the tools the server actually registers.
 * Usage: npm run generate:tools   (test/tools.test.ts fails when it is stale)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listRegisteredTools } from "../test/helpers/tool-list.js";

const out = fileURLToPath(new URL("../mcp-tools.json", import.meta.url));
const tools = await listRegisteredTools();
writeFileSync(out, `${JSON.stringify(tools, null, 2)}\n`);
console.log(`Wrote ${tools.length} tools to mcp-tools.json`);
