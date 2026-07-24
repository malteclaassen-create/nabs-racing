import { join, resolve, basename, sep } from "node:path";

// Ids that end up inside a FILENAME (team logos, driver avatars, season and
// series artwork). Team and driver ids are admin-supplied strings, so without
// a check an id like "../../frontend/dist/assets/index" would let an upload
// land anywhere on the host. Every id currently in the database (125 teams,
// 429 drivers) already fits this pattern, so the rule breaks nothing.
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function isSafeId(id) {
  return SAFE_ID.test(String(id ?? ""));
}

// Builds a path for an upload and refuses anything that would escape `dir`.
// Belt AND braces: basename() strips any directory part, and the resolved
// path is checked against the target folder afterwards, so this holds even if
// a caller forgets to validate the id first. Returns null when unsafe.
export function safeUploadPath(dir, filename) {
  const clean = basename(String(filename ?? ""));
  if (!clean || clean === "." || clean === "..") return null;
  const root = resolve(dir);
  const target = resolve(join(dir, clean));
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}
