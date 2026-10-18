// A film upload (routes/admin.js, POST /series/:id/promo-video) streams into a
// temporary ".promo-upload-…" file next to the films and is renamed into place
// once it is complete. An upload that dies on the way (the tab closed, the line
// dropped, the volume full) can leave that half file behind, tens of megabytes
// each, on a volume with a hard cap. Any such file older than an hour is no
// upload in progress any more.
import { readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";

export const PROMO_TMP_PREFIX = ".promo-upload-";
export const PROMO_TMP_MAX_AGE_MS = 60 * 60 * 1000;

// Deletes the stale ones in `dir`; returns how many went.
export function sweepStalePromoUploads(dir, now = Date.now()) {
  let removed = 0;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0; // no series folder yet
  }
  for (const name of names) {
    if (!name.startsWith(PROMO_TMP_PREFIX)) continue;
    const p = join(dir, name);
    try {
      if (now - statSync(p).mtimeMs > PROMO_TMP_MAX_AGE_MS) {
        unlinkSync(p);
        removed += 1;
      }
    } catch {
      /* gone already, or busy: the next sweep tries again */
    }
  }
  return removed;
}
