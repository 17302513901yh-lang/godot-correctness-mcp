import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/index.js";

export interface ToolListing {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** Connect an in-memory MCP client to a fresh server instance. */
export async function connectClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** The registered tools in the shape stored in mcp-tools.json. */
export async function listRegisteredTools(): Promise<ToolListing[]> {
  const client = await connectClient();
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema }));
  } finally {
    await client.close();
  }
}
