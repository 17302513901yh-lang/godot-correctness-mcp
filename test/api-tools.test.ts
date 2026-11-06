import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/index.js";

let client: Client;

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
});

function parse(result: unknown): any {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]!.text);
}

describe("API tools (offline, in-memory, real artifacts)", () => {
  it("registers the API, lint, and scene tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "api_class_summary",
      "api_diff",
      "api_symbol_lookup",
      "lint_file",
      "lint_project",
      "list_rules",
      "project_report",
      "server_info",
      "validate_project_config",
      "validate_registries",
      "validate_scenes",
    ]);
  });

  it("api_symbol_lookup finds move_and_slide in both versions", async () => {
    const out = parse(await client.callTool({ name: "api_symbol_lookup", arguments: { symbol: "move_and_slide" } }));
    expect(out.versions).toEqual(["4.4", "4.5"]);
    expect(out.results["4.4"].matches.length).toBeGreaterThan(0);
    expect(out.results["4.5"].matches.length).toBeGreaterThan(0);
  });

  it("api_symbol_lookup returns suggestions on a typo", async () => {
    const out = parse(await client.callTool({ name: "api_symbol_lookup", arguments: { symbol: "move_and_slid", version: "4.5" } }));
    expect(out.results["4.5"].matches).toHaveLength(0);
    expect(out.results["4.5"].suggestions.map((s: { name: string }) => s.name)).toContain("move_and_slide");
  });

  it("api_class_summary lists a real class", async () => {
    const out = parse(await client.callTool({ name: "api_class_summary", arguments: { class: "Node", version: "4.4" } }));
    expect(out.name).toBe("Node");
    expect(out.methods.length).toBeGreaterThan(0);
  });

  it("api_diff returns a class diff for a class name", async () => {
    const out = parse(await client.callTool({ name: "api_diff", arguments: { symbol: "Node" } }));
    expect(out.type).toBe("class");
    expect(out.diff.presence.inFrom).toBe(true);
    expect(out.diff.presence.inTo).toBe(true);
  });

  it("api_diff rejects equal from/to", async () => {
    const out = parse(await client.callTool({ name: "api_diff", arguments: { symbol: "Node", from: "4.4", to: "4.4" } }));
    expect(out.error).toBeTruthy();
  });
});
