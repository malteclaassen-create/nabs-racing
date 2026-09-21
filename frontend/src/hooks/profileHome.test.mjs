import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_HOME_PERSONAL,
  PROFILE_HOME_PUBLIC,
  landsOnPublicPage,
  normalizeProfileHome,
  profileHomePath,
} from "./profileHome.mjs";

test("the personal area is what an unset or unknown choice means", () => {
  assert.equal(normalizeProfileHome(null), PROFILE_HOME_PERSONAL);
  assert.equal(normalizeProfileHome(undefined), PROFILE_HOME_PERSONAL);
  assert.equal(normalizeProfileHome(""), PROFILE_HOME_PERSONAL);
  assert.equal(normalizeProfileHome("whatever an older build wrote"), PROFILE_HOME_PERSONAL);
  assert.equal(normalizeProfileHome(PROFILE_HOME_PUBLIC), PROFILE_HOME_PUBLIC);
});

test("the chip leads to My Profile unless the public page was chosen", () => {
  assert.equal(profileHomePath(PROFILE_HOME_PERSONAL, 42), "/profile");
  assert.equal(profileHomePath(PROFILE_HOME_PUBLIC, 42), "/drivers/42");
});

test("a login with no roster row has no public page to be sent to", () => {
  // Signed in with Discord, not matched to a driver yet: /drivers/null is not
  // a page, and the personal area is where that login is told what happens next.
  assert.equal(profileHomePath(PROFILE_HOME_PUBLIC, null), "/profile");
  assert.equal(profileHomePath(PROFILE_HOME_PUBLIC, undefined), "/profile");
  assert.equal(landsOnPublicPage(PROFILE_HOME_PUBLIC, null), false);
});

test("the public page knows when it is the one the chip opens", () => {
  assert.equal(landsOnPublicPage(PROFILE_HOME_PUBLIC, 7), true);
  assert.equal(landsOnPublicPage(PROFILE_HOME_PERSONAL, 7), false);
});
