import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import type { GodotValue } from "../godot/text-format.js";

/** Whether `abs` is the project root or lies under it (after normalisation). */
export function isInsideRoot(projectRoot: string, abs: string): boolean {
  const r = relative(resolve(projectRoot), resolve(abs));
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}

/**
 * Whether a resolved project path exists. Paths that escape the project root
 * (`res://../x`) are never probed and count as missing, since Godot cannot
 * load them either.
 */
export function existsInProject(projectRoot: string, abs: string | null): abs is string {
  return abs !== null && isInsideRoot(projectRoot, abs) && existsSync(abs);
}

/**
 * Resolve a Godot path to an absolute filesystem path against the project root.
 * `res://x` maps to `<root>/x`. `uid://` and other schemes return null (not
 * resolvable without the editor's uid cache). A bare relative path resolves
 * against the project root.
 */
export function resolveResPath(projectRoot: string, p: string): string | null {
  if (p.startsWith("res://")) return join(projectRoot, p.slice("res://".length));
  if (p.includes("://")) return null; // uid://, http://, user:// - not statically resolvable
  if (p === "") return null;
  return join(projectRoot, p);
}

const RESOURCE_EXT = /\.(tscn|tres|gd|res|scn)$/i;

/**
 * Whether a value should be treated as a resource path worth validating:
 * a non-empty string that is res://-prefixed, ends in a resource extension, or
 * whose property name matches one of the configured path-property patterns.
 */
export function looksLikeResourcePath(
  value: GodotValue,
  propName: string,
  pathPropertyPatterns: string[],
): boolean {
  if (value.kind !== "string" || !value.string) return false;
  const s = value.string;
  if (s.startsWith("res://")) return true;
  if (RESOURCE_EXT.test(s)) return true;
  if (pathPropertyPatterns.length > 0 && picomatch(pathPropertyPatterns)(propName)) {
    // Only if the value plausibly is a path (not an arbitrary string).
    return s.includes("/") || RESOURCE_EXT.test(s) || s.startsWith("res://");
  }
  return false;
}
