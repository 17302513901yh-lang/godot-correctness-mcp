import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { toPosix } from "./walk.js";

/**
 * Normalise user-supplied file paths (absolute, or relative to the current
 * directory) to root-relative POSIX paths. Paths outside the root are dropped.
 */
export function toProjectPaths(root: string, paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const rel = toPosix(relative(resolve(root), resolve(p)));
    if (rel && !rel.startsWith("../") && rel !== ".." && !isAbsolute(rel)) out.push(rel);
  }
  return out;
}

/**
 * Root-relative POSIX paths of files changed since `ref` in the git work tree
 * containing `root`: committed and uncommitted changes plus untracked files.
 * Only paths under `root` are returned.
 */
export function changedSince(root: string, ref: string): string[] {
  if (ref.startsWith("-")) throw new Error(`Invalid git ref: ${ref}`);
  const git = (...args: string[]): string[] => {
    try {
      return execFileSync("git", ["-C", root, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
        .split(/\r?\n/)
        .filter(Boolean);
    } catch (err) {
      const stderr = (err as { stderr?: Buffer | string }).stderr?.toString().trim();
      throw new Error(`git ${args[0]} failed${stderr ? `: ${stderr}` : ""}`);
    }
  };
  // --relative: paths relative to (and limited to) root when it is a subdirectory.
  const changed = git("diff", "--name-only", "--relative", "--diff-filter=d", ref, "--");
  const untracked = git("ls-files", "--others", "--exclude-standard");
  // git always prints forward-slash paths.
  return [...new Set([...changed, ...untracked])];
}
