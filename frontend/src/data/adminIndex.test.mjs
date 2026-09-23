import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_INDEX, TAB_GROUPS, TAB_VIEWS, TAB_ALIASES, resolveTab, searchAdmin } from "./adminIndex.js";

const tabIds = new Set(TAB_GROUPS.flatMap((g) => g.tabs.map((t) => t.id)));

test("every search entry opens a tab that exists, at a view that exists", () => {
  for (const e of ADMIN_INDEX) {
    assert.ok(tabIds.has(e.tab), `${e.title}: no tab "${e.tab}"`);
    if (e.view) assert.ok(TAB_VIEWS[e.tab]?.[e.view], `${e.title}: no view "${e.view}" in "${e.tab}"`);
  }
});

test("a tab name from before the merge still lands somewhere real", () => {
  // Notifications already sent carry these (/admin?tab=social), and so does a
  // tab the browser remembered.
  for (const [old, to] of Object.entries(TAB_ALIASES)) {
    assert.ok(tabIds.has(to.tab), `${old} -> ${to.tab}`);
    if (to.view) assert.ok(TAB_VIEWS[to.tab]?.[to.view], `${old} -> ${to.tab}/${to.view}`);
    assert.deepEqual(resolveTab(old), to);
  }
  assert.deepEqual(resolveTab("social"), { tab: "live" });
  assert.deepEqual(resolveTab("pin"), { tab: "system", view: "access" });
});

test("current tab names resolve to themselves, unknown ones to nothing", () => {
  for (const id of tabIds) assert.deepEqual(resolveTab(id), { tab: id });
  assert.equal(resolveTab("nope"), null);
  assert.equal(resolveTab(null), null);
});

test("the search names the view a merged job moved to", () => {
  const hit = searchAdmin("admin pin").find((h) => h.title === "Change the admin PIN");
  assert.equal(hit.tabLabel, "System");
  assert.equal(hit.viewLabel, "Admin PIN");
});
