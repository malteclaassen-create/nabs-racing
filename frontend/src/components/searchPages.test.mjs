import test from "node:test";
import assert from "node:assert/strict";
import { matchPages } from "./searchPages.mjs";

const seriesPath = (p) => `/s/friday-f1${p}`;
const member = { seriesPath, isMember: true };
const labels = (term, opts = member) => matchPages(term, opts).map((p) => p.label);

test("a few letters are enough, and the best match leads", () => {
  assert.equal(labels("tele")[0], "Lap comparison");
  assert.ok(labels("tele").includes("My telemetry"));
  assert.equal(labels("stand")[0], "Driver standings");
  assert.equal(labels("anmeld")[0], "Attendance");
});

test("league pages carry the series in their address, the rest do not", () => {
  const [standings] = matchPages("standings", member);
  assert.equal(standings.link, "/s/friday-f1/drivers");
  const [tools] = matchPages("lap comparison", member);
  assert.equal(tools.link, "/tools");
});

test("nothing personal is offered to somebody who is not signed in", () => {
  const out = matchPages("profile", { seriesPath });
  assert.deepEqual(out, []);
  assert.ok(labels("career").includes("My career"));
  assert.deepEqual(matchPages("career", { seriesPath }), []);
});

test("the admin page is for admins, the points page for an open trial", () => {
  assert.deepEqual(matchPages("admin", member), []);
  assert.equal(matchPages("admin", { ...member, isAdmin: true })[0].label, "Admin");
  assert.deepEqual(matchPages("nabs points", member), []);
  assert.equal(matchPages("nabs points", { ...member, pointsOn: true })[0].label, "NABS Points");
});

test("an exact word beats a word that merely starts the same way", () => {
  const out = labels("rules");
  assert.equal(out[0], "Race info");
});

test("nonsense matches nothing, and an empty box asks nothing", () => {
  assert.deepEqual(matchPages("qqqzzz", member), []);
  assert.deepEqual(matchPages("", member), []);
  assert.deepEqual(matchPages("   ", member), []);
});
