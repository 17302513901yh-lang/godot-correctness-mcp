import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PINNED_GODOT_VERSIONS, type GodotVersion } from "../capabilities.js";
import { parseGodotFile } from "../godot/text-format.js";

const versionKey = (v: string): number[] => v.split(".").map(Number);
const compareVersions = (a: string, b: string): number => {
  const [x, y] = [versionKey(a), versionKey(b)];
  return (x[0]! - y[0]!) || (x[1]! - y[1]!);
};

/**
 * The Godot version a project declares in project.godot
 * (`[application] config/features=PackedStringArray("4.5", "Forward Plus")`),
 * or null when there is no project.godot or no version feature.
 */
export function readProjectGodotVersion(projectRoot: string): string | null {
  const path = join(projectRoot, "project.godot");
  if (!existsSync(path)) return null;
  let raw: string | undefined;
  try {
    const file = parseGodotFile(readFileSync(path, "utf-8"));
    raw = file.sections.find((s) => s.kind === "application")?.properties["config/features"]?.raw;
  } catch {
    return null;
  }
  const versions = [...(raw ?? "").matchAll(/"(\d+\.\d+)"/g)].map((m) => m[1]!);
  return versions.sort(compareVersions).at(-1) ?? null;
}

/**
 * The pinned symbol-DB version to check a project against: the newest pinned
 * version that is not newer than the project's. Null when the project
 * declares no version or predates every pinned version.
 */
export function pinnedVersionFor(projectVersion: string | null): GodotVersion | null {
  if (!projectVersion) return null;
  const ok = PINNED_GODOT_VERSIONS.filter((v) => compareVersions(v, projectVersion) <= 0);
  return ok.at(-1) ?? null;
}
