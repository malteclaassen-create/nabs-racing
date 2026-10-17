import test from "node:test";
import assert from "node:assert/strict";
import { readAppMark, appIsBehind } from "./androidApp.mjs";

test("the app's mark is read and taken out of the address", () => {
  assert.deepEqual(readAppMark("?app=android&appv=3"), { version: 3, rest: "" });
  assert.deepEqual(readAppMark("?tab=widgets&app=android&appv=12"), { version: 12, rest: "?tab=widgets" });
});

test("a visit that is not from the app is left alone", () => {
  assert.deepEqual(readAppMark(""), { version: null, rest: null });
  assert.deepEqual(readAppMark("?appv=3"), { version: null, rest: null });
  assert.deepEqual(readAppMark("?app=ios&appv=3"), { version: null, rest: null });
});

test("a mark without a usable version still comes out of the address", () => {
  assert.deepEqual(readAppMark("?app=android"), { version: null, rest: "" });
  assert.deepEqual(readAppMark("?app=android&appv=x&x=1"), { version: null, rest: "?x=1" });
});

test("only a newer release counts", () => {
  assert.equal(appIsBehind(1, { versionCode: 2 }), true);
  assert.equal(appIsBehind(2, { versionCode: 2 }), false);
  assert.equal(appIsBehind(3, { versionCode: 2 }), false);
  assert.equal(appIsBehind(null, { versionCode: 2 }), false);
  assert.equal(appIsBehind(1, null), false);
});
