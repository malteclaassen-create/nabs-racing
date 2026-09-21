// ---------------------------------------------------------------------------
// Where "your profile" goes: the choice itself, without React.
//
// The identity chip in the nav bar — your picture and your name, in the burger
// menu on a phone — is the one control on the site that means "me". It used to
// lead to the PUBLIC driver page, and the private area was a button on that
// page. So the way to your own settings, your rating and your card was two
// clicks through a page written for visitors.
//
// It leads to My Profile now, and the public page is a button up there instead
// — the same pair of doors, the other way round. Whoever prefers the old order
// can have it back in Settings, which is what this file is: the vocabulary and
// the address, kept free of React so it can be tested on its own.
// hooks/useProfileHome.js stores the choice and hands it to the components.
// ---------------------------------------------------------------------------

// The two destinations, as they are spelled in storage and in the URL-free
// parts of the app.
export const PROFILE_HOME_PERSONAL = "personal";
export const PROFILE_HOME_PUBLIC = "public";

// Anything that is not the public page is the personal area: an absent value
// (nobody has chosen yet), a stale one from an older build, a typo in
// localStorage a curious member put there by hand.
export function normalizeProfileHome(value) {
  return value === PROFILE_HOME_PUBLIC ? PROFILE_HOME_PUBLIC : PROFILE_HOME_PERSONAL;
}

// The address the identity chip points at.
//
// `driverId` is the signed-in person's roster row. A Discord login that is not
// matched to one yet HAS no public page, so it always lands in the personal
// area — which is exactly where such a login is told what happens next.
export function profileHomePath(mode, driverId) {
  return normalizeProfileHome(mode) === PROFILE_HOME_PUBLIC && driverId
    ? `/drivers/${driverId}`
    : "/profile";
}

// Does the chip land on the public page? The public page asks, because that is
// the one case where it has to offer a way on to the personal area: the button
// that used to do it is gone from there, and without this the chip would be a
// door with nothing behind it.
export function landsOnPublicPage(mode, driverId) {
  return profileHomePath(mode, driverId) !== "/profile";
}
