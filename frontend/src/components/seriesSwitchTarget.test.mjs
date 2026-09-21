import { test } from "node:test";
import assert from "node:assert/strict";
import { seriesSwitchTarget } from "./seriesSwitchTarget.mjs";

test("a section carries over to the new series", () => {
  for (const section of ["drivers", "constructors", "teams", "records", "transfers", "races", "results", "calendar", "attendance", "live"]) {
    assert.equal(seriesSwitchTarget(`/s/friday-f1/${section}`, "gt-sunday"), `/s/gt-sunday/${section}`);
  }
});

test("the series home stays the series home", () => {
  assert.equal(seriesSwitchTarget("/s/friday-f1", "gt-sunday"), "/s/gt-sunday");
  assert.equal(seriesSwitchTarget("/s/friday-f1/", "gt-sunday"), "/s/gt-sunday");
});

test("a deep page falls back to its list, or home when it has none", () => {
  assert.equal(seriesSwitchTarget("/s/friday-f1/drivers/42", "gt-sunday"), "/s/gt-sunday/drivers");
  assert.equal(seriesSwitchTarget("/s/friday-f1/teams/redbull", "gt-sunday"), "/s/gt-sunday/teams");
  // /s/<slug>/recap is not a page, so the recap of a race that only exists in
  // the old series lands on the home of the new one instead of a 404.
  assert.equal(seriesSwitchTarget("/s/friday-f1/recap/42", "gt-sunday"), "/s/gt-sunday");
});

test("pages without a series in the address stay exactly where they are", () => {
  for (const page of ["/admin", "/profile", "/profile/style", "/downloads", "/tools", "/cards", "/reports", "/feedback", "/"]) {
    assert.equal(seriesSwitchTarget(page, "gt-sunday"), null);
  }
});
