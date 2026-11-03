import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Convert an OS path to forward slashes (globs and reported paths are POSIX). */
export function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Directories never worth descending into: VCS data and Godot's import cache. */
const ALWAYS_SKIPPED_DIRS = new Set([".git", ".godot"]);

export interface WalkOptions {
  /** File extensions to keep (e.g. [".gd"]). Omit to keep every file. */
  exts?: string[];
  /**
   * Predicate on root-relative POSIX paths. Matching directories are pruned
   * (not descended into); matching files are dropped.
   */
  exclude?: (rel: string) => boolean;
}

export interface WalkedFile {
  /** Absolute (or root-joined) path on disk. */
  full: string;
  /** Path relative to `root`, with forward slashes. */
  rel: string;
}

/**
 * Recursively list files under `dir` (default: `root`), pruning excluded
 * directories instead of filtering after a full walk. Symlinked directories are
 * not followed (Dirent.isDirectory() is false for symlinks).
 */
export function walkProject(root: string, opts: WalkOptions = {}, dir: string = root): WalkedFile[] {
  const out: WalkedFile[] = [];
  if (!existsSync(dir)) return out;
  const { exts, exclude } = opts;
  const visit = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      const rel = toPosix(relative(root, full));
      if (entry.isDirectory()) {
        if (ALWAYS_SKIPPED_DIRS.has(entry.name)) continue;
        // Test both "dir" and "dir/" so globs like "addons/**" prune the folder.
        if (exclude && (exclude(rel) || exclude(`${rel}/`))) continue;
        visit(full);
      } else if (entry.isFile()) {
        if (exts && !exts.some((e) => entry.name.endsWith(e))) continue;
        if (exclude?.(rel)) continue;
        out.push({ full, rel });
      }
    }
  };
  visit(dir);
  return out;
}

/** Throw a clear error unless `path` is an existing directory. */
export function requireDir(path: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`Project root does not exist or is not a directory: ${path}`);
  }
}
