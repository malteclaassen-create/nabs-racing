import { test } from "node:test";
import assert from "node:assert/strict";
import { anyDirty, confirmLeave, dirtyLabels, registerDirty } from "./unsavedGuard.js";

test("only what is dirty right now is listed, and unregistering forgets it", () => {
  let dirty = false;
  const off = registerDirty(() => (dirty ? "Race Info" : null));
  const offClean = registerDirty(() => null);
  assert.equal(anyDirty(), false);
  dirty = true;
  assert.deepEqual(dirtyLabels(), ["Race Info"]);
  off();
  offClean();
  assert.equal(anyDirty(), false);
});

test("leaving asks only when something is unsaved, and follows the answer", async () => {
  let asked = 0;
  const yes = async () => (asked++, true);
  const no = async () => (asked++, false);
  assert.equal(await confirmLeave(no), true);
  assert.equal(asked, 0);
  const off = registerDirty(() => "Edit results");
  assert.equal(await confirmLeave(no), false);
  assert.equal(await confirmLeave(yes), true);
  assert.equal(asked, 2);
  off();
});

test("a check that throws counts as clean rather than blocking every exit", () => {
  const off = registerDirty(() => {
    throw new Error("unmounted");
  });
  assert.equal(anyDirty(), false);
  off();
});
