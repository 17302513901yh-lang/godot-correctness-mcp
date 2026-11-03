import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Whether the module at `moduleUrl` is the process entry point.
 *
 * Node resolves the main module to its real path for `import.meta.url`, but
 * `process.argv[1]` keeps the path as invoked. npm installs `bin` entries as
 * symlinks on Linux/macOS, so both sides must be compared by real path.
 */
export function isMainModule(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (argv1 === undefined) return false;
  let resolved = argv1;
  try {
    resolved = realpathSync(argv1);
  } catch {
    // Fall back to the path as given (e.g. it was deleted after launch).
  }
  return moduleUrl === pathToFileURL(resolved).href;
}
