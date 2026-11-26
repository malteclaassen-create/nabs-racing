import test from "node:test";
import assert from "node:assert/strict";
import { newsSections, parseInline, parseNewsText, safeHref, safeImageSrc } from "./newsText.mjs";

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

test("newsSections lists the ## headings to jump to, from two up", () => {
  const blocks = parseNewsText("intro\n\n## Tier 1 **Interviews**\n\ntext\n\n### Porsche\n\n## Div 2 Interviews\n\nmore");
  assert.deepEqual(newsSections(blocks), [
    { index: 1, title: "Tier 1 Interviews" },
    { index: 4, title: "Div 2 Interviews" },
  ]);
  assert.deepEqual(newsSections(parseNewsText("## Only one\n\ntext")), []);
  assert.deepEqual(newsSections(parseNewsText("just text")), []);
});

test("the writer's own [jump: …] buttons take the headings' place", () => {
  const blocks = parseNewsText("intro\n\n## Preview\n\n[jump: Tier 1 interviews]\n**PORSCHE**\n\n## Standings\n\n[Jump:Div 2 ]\n\ntext\n\n[jump: Nothing after]");
  assert.deepEqual(blocks.map((b) => b.type), ["p", "h2", "jump", "p", "h2", "jump", "p", "jump"]);
  assert.deepEqual(newsSections(blocks), [
    { index: 3, title: "Tier 1 interviews" },
    { index: 6, title: "Div 2" },
  ]);
  assert.equal(parseNewsText("see [jump: x] here")[0].type, "p");
});

test("[jump buttons] marks where the row goes", () => {
  const blocks = parseNewsText("intro\n\n[Jump buttons]\n\n[jump: A]\n[jump buttons]\ntext");
  assert.deepEqual(blocks.map((b) => b.type), ["p", "menu", "jump", "menu", "p"]);
  assert.deepEqual(newsSections(blocks), [{ index: 4, title: "A" }]);
});
