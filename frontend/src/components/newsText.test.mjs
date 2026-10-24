import test from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseNewsText, safeHref, safeImageSrc } from "./newsText.mjs";

test("inline bold, italic and links", () => {
  assert.deepEqual(parseInline("A **big** *win* at [Spa](/s/nabs/races)"), [
    { t: "text", v: "A " },
    { t: "b", v: "big" },
    { t: "text", v: " " },
    { t: "i", v: "win" },
    { t: "text", v: " at " },
    { t: "a", v: "Spa", href: "/s/nabs/races" },
  ]);
});

test("links that would run script or leave the site sideways are dropped, words kept", () => {
  assert.deepEqual(parseInline("[click](javascript:alert(1))"), [{ t: "text", v: "click)" }]);
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("//evil.example"), null);
  assert.equal(safeHref("https://nabsracing.com"), "https://nabsracing.com");
  assert.equal(parseInline("[x](data:text/html,hi)")[0].t, "text");
});

test("pictures only from uploads or https", () => {
  assert.equal(safeImageSrc("/api/uploads/news/a.jpg"), "/api/uploads/news/a.jpg");
  assert.equal(safeImageSrc("http://x/a.jpg"), null);
  assert.equal(safeImageSrc("/api/uploads/../x"), null);
});

test("blocks: headings, paragraphs, lists, quotes, pictures", () => {
  const blocks = parseNewsText(
    [
      "Opening line",
      "still the opening",
      "",
      "## The podium",
      "1. Munti",
      "2. Dieguiosk",
      "",
      "- fast",
      "- loud",
      "> quote one",
      "> quote two",
      "",
      "![Spa](/api/uploads/news/spa.jpg)",
      "![bad](javascript:x)",
    ].join("\n")
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["p", "h2", "ol", "ul", "quote", "img"]
  );
  assert.equal(blocks[0].lines.length, 2);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[4].lines.length, 2);
  assert.equal(blocks[5].alt, "Spa");
});
