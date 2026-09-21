import test from "node:test";
import assert from "node:assert/strict";
import { profileNav, sectionKeys } from "./profileNav.mjs";

const COCKPIT = [{ key: "achievements", label: "Achievements" }];

test("sections are the panels the page swaps in place", () => {
  const { sections } = profileNav({ cockpitTabs: COCKPIT });
  assert.deepEqual(
    sections.map((s) => s.key),
    ["profile", "achievements", "rating", "tools"]
  );
  assert.ok(sections.every((s) => s.kind === "section"));
});

test("NABS Points appears only while the trial is on, and carries the balance", () => {
  const off = profileNav({ tokens: null });
  assert.ok(!off.sections.some((s) => s.key === "tokens"));

  const on = profileNav({ tokens: 340 });
  const points = on.sections.find((s) => s.key === "tokens");
  assert.equal(points.count, 340);

  // A zero balance is a balance, not an absent one.
  const zero = profileNav({ tokens: 0 });
  assert.equal(zero.sections.find((s) => s.key === "tokens").count, 0);
});

test("everything that is not a section says what it really does", () => {
  const { elsewhere } = profileNav({ isAdmin: true, reportsOpen: true });
  assert.deepEqual(
    elsewhere.map((i) => [i.key, i.kind]),
    [
      ["settings", "drawer"],
      ["feedback", "panel"],
      ["reports", "page"],
      ["admin", "page"],
    ]
  );
  // The two that leave the page carry a destination, so they can be links.
  for (const item of elsewhere.filter((i) => i.kind === "page")) assert.ok(item.to);
});

test("Admin and My reports are hidden from those who cannot use them", () => {
  const { elsewhere } = profileNav({ isAdmin: false, reportsOpen: false });
  assert.deepEqual(elsewhere.map((i) => i.key), ["settings", "feedback"]);
});

test("no two entries share a key", () => {
  const nav = profileNav({ isAdmin: true, tokens: 5, reportsOpen: true, cockpitTabs: COCKPIT });
  const keys = [...nav.sections, ...nav.elsewhere].map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("?tab= stays valid while the token balance is still loading", () => {
  // The gated nav has no tokens row yet; the URL vocabulary still knows it, so
  // a bell link to ?tab=tokens does not flash the editor on the way in.
  assert.ok(!profileNav({ tokens: null }).sections.some((s) => s.key === "tokens"));
  assert.ok(sectionKeys(COCKPIT).includes("tokens"));
  assert.deepEqual(sectionKeys(COCKPIT), ["profile", "achievements", "rating", "tokens", "tools"]);
});
