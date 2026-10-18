import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, utimesSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { sweepStalePromoUploads, PROMO_TMP_PREFIX, PROMO_TMP_MAX_AGE_MS } from "./promoUploads.js";

describe("sweepStalePromoUploads", () => {
  it("removes half uploads older than an hour and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "promo-"));
    const now = Date.now();
    const old = join(dir, `${PROMO_TMP_PREFIX}1-a`);
    const fresh = join(dir, `${PROMO_TMP_PREFIX}2-b`);
    const film = join(dir, "abc-promo.mp4");
    for (const f of [old, fresh, film]) writeFileSync(f, "x");
    const past = (now - PROMO_TMP_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(old, past, past);
    utimesSync(film, past, past);
    expect(sweepStalePromoUploads(dir, now)).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true); // an upload still in progress
    expect(existsSync(film)).toBe(true); // a real film, however old
  });

  it("is quiet about a folder that does not exist yet", () => {
    expect(sweepStalePromoUploads(join(tmpdir(), "no-such-promo-dir-xyz"))).toBe(0);
  });
});
