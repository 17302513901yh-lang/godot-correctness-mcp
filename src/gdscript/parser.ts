import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Tree } from "web-tree-sitter";

// dist/gdscript/parser.js and src/gdscript/parser.ts both sit two levels below
// the package root, so the committed grammar resolves the same either way.
const wasmPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "tree-sitter-gdscript.wasm",
);

/** Whether the committed GDScript grammar WASM is present. */
export function isGrammarAvailable(): boolean {
  return existsSync(wasmPath);
}

let initPromise: Promise<void> | null = null;
let langPromise: Promise<Language> | null = null;
let parserPromise: Promise<Parser> | null = null;

async function getLanguage(): Promise<Language> {
  // Parser.init() loads web-tree-sitter's own runtime wasm (auto-located from
  // node_modules on Node); the grammar is loaded from the committed bytes.
  // A rejected promise is not cached, so a transient failure can be retried.
  if (!initPromise) {
    initPromise = Parser.init().catch((err: unknown) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
  if (!langPromise) {
    langPromise = Promise.resolve()
      .then(() => Language.load(new Uint8Array(readFileSync(wasmPath))))
      .catch((err: unknown) => {
        langPromise = null;
        throw err;
      });
  }
  return langPromise;
}

/** Get a shared, initialized GDScript parser (reused across files, sequential). */
export async function getParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = getLanguage()
      .then((lang) => {
        const parser = new Parser();
        parser.setLanguage(lang);
        return parser;
      })
      .catch((err: unknown) => {
        parserPromise = null;
        throw err;
      });
  }
  return parserPromise;
}

/** Parse GDScript source into a concrete syntax tree. */
export async function parseGDScript(source: string): Promise<Tree> {
  const parser = await getParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error("Failed to parse GDScript source.");
  return tree;
}
