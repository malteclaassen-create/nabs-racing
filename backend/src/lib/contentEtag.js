// ---------------------------------------------------------------------------
// ETags from what a file CONTAINS, for the site's unhashed static files
// (flags, logos, fonts, hero pictures - everything frontend/public copies into
// dist/ as it is).
//
// express.static's own ETag is the file's size and modification time. Every
// build copies public/ afresh, so every file gets a new time on every deploy -
// and the site deploys several times a day. A returning visitor's browser then
// asks "is my copy still good?" and hears "no" for files that have not changed
// in months, and downloads them all again: fonts, the hero picture, every flag
// and logo on the page. Railway bills each of those bytes. Hashed from the
// content, the tag only changes when the file does, so the answer is a 304
// with no body.
//
// Hashed once per file and kept: dist/ never changes while the process runs
// (a deploy is a restart), and the size + mtime check still catches the one
// case where it does - a rebuild under a running dev server.
// ---------------------------------------------------------------------------
import { createHash } from "crypto";
import { readFileSync } from "fs";

const tags = new Map(); // path -> { size, mtimeMs, etag }

export function contentEtag(filePath, stat) {
  const hit = tags.get(filePath);
  if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.etag;
  let etag;
  try {
    const hash = createHash("sha1").update(readFileSync(filePath)).digest("base64url").slice(0, 22);
    // Weak, like express.static's own: the body may still go out compressed.
    etag = `W/"${stat.size.toString(16)}-${hash}"`;
  } catch {
    return null; // unreadable for once: let express.static use its own tag
  }
  tags.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, etag });
  return etag;
}
