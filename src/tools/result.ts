import { existsSync, statSync } from "node:fs";

/** The text-content result every tool in this server returns. */
export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** Successful result: `data` serialized as pretty JSON. */
export function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Failed result: `{ error }` JSON with `isError: true` so clients don't read it as success. */
export function fail(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Run a (sync or async) handler body; return its value via `ok`, or any throw via `fail`. */
export async function guard(fn: () => unknown): Promise<ToolResult> {
  try {
    const value = await fn();
    return isToolResult(value) ? value : ok(value);
  } catch (err) {
    return fail(messageOf(err));
  }
}

function isToolResult(v: unknown): v is ToolResult {
  return typeof v === "object" && v !== null && Array.isArray((v as ToolResult).content);
}

/** Throw a clear error unless `path` is an existing directory. */
export function requireDir(path: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`Project root does not exist or is not a directory: ${path}`);
  }
}
