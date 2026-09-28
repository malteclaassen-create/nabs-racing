import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeChangelog } from "./changelogMerge.mjs";

const STATIC = [
  { date: "2026-09-28", commits: 698, title: "Designs", items: [{ tag: "new", text: "a" }] },
  { date: "2026-09-27", commits: 697, title: "Briefing", items: [{ tag: "new", text: "b" }] },
];
const item = [{ tag: "fixed", text: "x" }];

test("without the feed it is the file", () => {
  const m = mergeChangelog(STATIC, null);
  assert.equal(m.entries.length, 2);
  assert.equal(m.commits, 698);
  assert.equal(m.latest, "2026-09-28");
});

test("newer pull requests go on top, older ones are left to the file", () => {
  const m = mergeChangelog(STATIC, {
    commits: 701,
    entries: [
      { id: "pr-177", date: "2026-09-29", commits: 701, title: "", items: item },
      { id: "pr-175", date: "2026-09-28", commits: 698, title: "", items: item },
    ],
  });
  assert.deepEqual(m.entries.map((e) => e.id || e.date), ["pr-177", "2026-09-28", "2026-09-27"]);
  assert.equal(m.commits, 701);
  assert.equal(m.latest, "2026-09-29");
});

test("without a number, the date decides", () => {
  const m = mergeChangelog(STATIC, {
    commits: null,
    entries: [
      { id: "pr-a", date: "2026-09-30", commits: null, items: item },
      { id: "pr-b", date: "2026-09-28", commits: null, items: item },
    ],
  });
  assert.deepEqual(m.entries.map((e) => e.id || e.date), ["pr-a", "2026-09-28", "2026-09-27"]);
  assert.equal(m.commits, 698);
});

test("an entry without lines is dropped", () => {
  const m = mergeChangelog(STATIC, { commits: 700, entries: [{ id: "pr-x", date: "2026-09-29", commits: 700, items: [] }] });
  assert.equal(m.entries.length, 2);
});
