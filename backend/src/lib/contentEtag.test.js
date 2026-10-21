import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, statSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { contentEtag } from "./contentEtag.js";

const dir = mkdtempSync(join(tmpdir(), "content-etag-"));
const file = (name, body) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};

describe("contentEtag", () => {
  it("stays the same when only the file's time changes (a fresh build)", () => {
    const p = file("flag.png", "same bytes");
    const before = contentEtag(p, statSync(p));
    utimesSync(p, new Date(), new Date(Date.now() + 60_000));
    expect(contentEtag(p, statSync(p))).toBe(before);
  });

  it("changes when the content does", () => {
    const p = file("logo.png", "old logo");
    const before = contentEtag(p, statSync(p));
    writeFileSync(p, "new logo!");
    utimesSync(p, new Date(), new Date(Date.now() + 120_000));
    expect(contentEtag(p, statSync(p))).not.toBe(before);
  });

  it("is a weak tag, like express.static's", () => {
    const p = file("font.woff2", "glyphs");
    expect(contentEtag(p, statSync(p))).toMatch(/^W\/"6-[A-Za-z0-9_-]{22}"$/);
  });

  it("gives up quietly on a file it cannot read", () => {
    expect(contentEtag(join(dir, "missing.png"), { size: 1, mtimeMs: 1 })).toBe(null);
  });
});
