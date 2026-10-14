import { test } from "node:test";
import assert from "node:assert/strict";
import { isAppleMobile, keyBytes, sameServerKey, syncDue, SYNC_EVERY_MS } from "./pushKeys.mjs";

const KEY = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 0xab)]).toString("base64url");

test("the server key turns into the bytes PushManager wants", () => {
  const bytes = keyBytes(KEY);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);
  assert.equal(bytes[64], 0xab);
  // Unpadded base64url with the URL-safe letters.
  assert.deepEqual([...keyBytes("_-8")], [0xff, 0xef]);
});

test("a subscription is kept only while it belongs to the current key", () => {
  assert.equal(sameServerKey(keyBytes(KEY).buffer, KEY), true);
  const other = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
  assert.equal(sameServerKey(keyBytes(other).buffer, KEY), false);
  // A browser that does not say which key it used: keep it.
  assert.equal(sameServerKey(null, KEY), true);
});

test("iPhones and iPads, the Mac-looking iPad included, need the Home Screen first", () => {
  assert.equal(isAppleMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)"), true);
  assert.equal(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), true);
  assert.equal(isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), false);
  assert.equal(isAppleMobile("Mozilla/5.0 (Linux; Android 14)"), false);
});

test("a device checks in at most once a day, and at once for a new account", () => {
  const now = 1_800_000_000_000;
  assert.equal(syncDue(null, now), true);
  assert.equal(syncDue(now - 1000, now), false);
  assert.equal(syncDue(now - SYNC_EVERY_MS, now), true);
  assert.equal(syncDue(now - 1000, now, "member-2", "member-1"), true);
  assert.equal(syncDue(now - 1000, now, "member-1", "member-1"), false);
});
