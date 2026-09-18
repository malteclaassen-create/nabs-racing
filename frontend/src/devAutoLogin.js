// ---------------------------------------------------------------------------
// "Open the site on this laptop and already be somebody" — development only.
//
// Discord cannot redirect a login to localhost, so trying anything behind a
// sign-in means going to /dev/login and picking a driver, every time the
// session is cleared. This does that pick for you, before the first render, so
// a bookmarked page like /profile?tab=tokens simply opens with the member's
// view of it.
//
// It only happens when VITE_DEV_AUTOLOGIN names somebody. That variable lives
// in frontend/.env.local, which is per-machine and git-ignored, so the repo
// carries the mechanism and nobody inherits the behaviour by accident.
//
// It cannot reach a built site twice over: import.meta.env.DEV is replaced with
// a literal false by `npm run build`, so everything below is dead code the
// bundler drops — and the API it calls (backend/src/routes/devLogin.js) refuses
// anything that looks like a deployment and anything not from this machine.
//
// Three ways to steer it, all in the address bar:
//
//   ?as=goat      be that driver instead, right now (switches accounts)
//   ?nologin      leave this page signed out, once
//   ?login        sign in again after a sign-out (see below)
//
// Signing out anywhere on the site (the Settings drawer, /dev/login) parks a
// flag that switches this off — otherwise the next page load would drag you
// straight back in, and "sign out" has to mean what it says. `?login`, `?as=`
// or picking somebody on /dev/login clears the flag again.
// ---------------------------------------------------------------------------
const TOKEN_KEY = "nabs_user_token";
const USER_KEY = "nabs_user";
export const DEV_LOGOUT_KEY = "nabs_dev_stay_out";

// Called by the site's sign-out so this does not undo it on the next load.
export function rememberDevSignOut() {
  if (!import.meta.env.DEV) return;
  try {
    localStorage.setItem(DEV_LOGOUT_KEY, "1");
  } catch {
    /* no storage, no memory of it: the auto-login wins, which is the old behaviour */
  }
}

export function forgetDevSignOut() {
  try {
    localStorage.removeItem(DEV_LOGOUT_KEY);
  } catch {
    /* nothing to forget */
  }
}

// Match by driver id first (that is what the API wants), then by name, so
// VITE_DEV_AUTOLOGIN=Takoda works as well as VITE_DEV_AUTOLOGIN=takoda.
async function resolveDriverId(who) {
  const want = String(who || "").trim().toLowerCase();
  if (!want) return null;
  const res = await fetch("/api/dev/drivers");
  if (!res.ok) throw new Error("the dev hatch is closed");
  const { drivers } = await res.json();
  const hit =
    drivers.find((d) => d.id.toLowerCase() === want) ||
    drivers.find((d) => d.name.toLowerCase() === want) ||
    drivers.find((d) => d.name.toLowerCase().includes(want));
  if (!hit) throw new Error(`no driver called "${who}" on the active roster`);
  return hit.id;
}

// Take the steering parameters out of the address once they have been read, so
// a refresh (or a link someone copies out of the bar) does not repeat them.
function stripParams(url) {
  for (const p of ["as", "nologin", "login"]) url.searchParams.delete(p);
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

// Sign in before the app renders, when all of that applies. Returns true when a
// session was created, so the caller knows the first paint is a member's.
export async function maybeDevAutoLogin() {
  if (!import.meta.env.DEV) return false;

  const url = new URL(window.location.href);
  const asParam = url.searchParams.get("as");
  const noLogin = url.searchParams.has("nologin");
  const loginParam = url.searchParams.has("login");
  const configured = import.meta.env.VITE_DEV_AUTOLOGIN;
  const who = asParam || configured;
  if (asParam || noLogin || loginParam) stripParams(url);

  if (!who || noLogin) return false;
  // ?as= is a deliberate switch of account, so it overrides both an existing
  // session and an earlier sign-out.
  if (asParam || loginParam) forgetDevSignOut();
  else {
    if (localStorage.getItem(DEV_LOGOUT_KEY)) return false;
    if (localStorage.getItem(TOKEN_KEY)) return false; // already somebody
  }

  try {
    const driverId = await resolveDriverId(who);
    const res = await fetch("/api/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverId }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "could not sign in");
    const { token, user } = await res.json();
    // Exactly what the Discord callback stores, so everything downstream reads
    // this as the real thing.
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    console.info(`[dev] signed in automatically as ${user.driverName || user.discordName}. ?nologin to skip it, ?as=<driver> for somebody else.`);
    return true;
  } catch (e) {
    // Never fatal: the site is perfectly usable signed out, and a loud line in
    // the console beats a blank page.
    console.warn(`[dev] auto-login skipped: ${e.message}`);
    return false;
  }
}
