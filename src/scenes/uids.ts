import { readFileSync } from "node:fs";
import { walkProject } from "../project/walk.js";

/**
 * Static uid:// -> res:// index for a project, built from what Godot 4.4+
 * commits alongside the files themselves (no editor cache needed):
 * - `<file>.uid` sidecars (scripts, shaders): content is the uid
 * - `<asset>.import` files: `uid="uid://..."` under [remap]
 * - `.tscn` / `.tres` headers: `[gd_scene ... uid="uid://..."]`
 */
export type UidIndex = Map<string, string>;

const IMPORT_UID_RE = /^uid="(uid:\/\/[^"]+)"/m;
const HEADER_UID_RE = /^\[gd_(?:scene|resource)\b[^\]]*\buid="(uid:\/\/[^"]+)"/;

export function buildUidIndex(root: string, exclude: (rel: string) => boolean): UidIndex {
  const index: UidIndex = new Map();
  const files = walkProject(root, { exts: [".uid", ".import", ".tscn", ".tres"], exclude });
  for (const { full, rel } of files) {
    let uid: string | undefined;
    let target = rel;
    try {
      if (rel.endsWith(".uid")) {
        uid = readFileSync(full, "utf-8").trim();
        target = rel.slice(0, -".uid".length);
      } else if (rel.endsWith(".import")) {
        uid = IMPORT_UID_RE.exec(readFileSync(full, "utf-8"))?.[1];
        target = rel.slice(0, -".import".length);
      } else {
        const head = readFileSync(full, "utf-8").slice(0, 512).replace(/^\uFEFF/, "");
        uid = HEADER_UID_RE.exec(head)?.[1];
      }
    } catch {
      continue;
    }
    if (uid?.startsWith("uid://")) index.set(uid, `res://${target}`);
  }
  return index;
}

/** Normalize a res:// path for comparison (collapse "./", duplicate slashes). */
export function normalizeResPath(p: string): string {
  if (!p.startsWith("res://")) return p;
  const parts: string[] = [];
  for (const seg of p.slice("res://".length).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `res://${parts.join("/")}`;
}
