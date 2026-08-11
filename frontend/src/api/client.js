// Tiny fetch wrapper for the NABS API. In dev, Vite proxies /api -> :4000.
const BASE = import.meta.env.VITE_API_BASE || "";

const TOKEN_KEY = "nabs_admin_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
  // Auth changed: let listeners (e.g. the season list, which shows private
  // seasons only to admins) refetch so admin-only data appears/disappears
  // without a manual page reload.
  if (typeof window !== "undefined") window.dispatchEvent(new Event("nabs-auth"));
}

// Absolute URL for an API path, honouring VITE_API_BASE. Needed for direct
// browser navigations (e.g. file downloads) where a bare "/api/..." path would
// otherwise resolve against the frontend origin — fine when the frontend and API
// share an origin (the default: Vite proxy / reverse proxy), but wrong if the API
// is hosted on a separate origin.
export function withApiBase(path) {
  return `${BASE}${path}`;
}

// An attachment's bytes, fetched with the caller's own session and handed back
// as a blob: URL. The endpoint is behind the thread's read check and needs an
// Authorization header, which an <img> cannot send — so the picture is loaded
// here and rendered from memory. Nothing that is copied out of the page is a
// working link to somebody else's private thread.
//
// `admin` picks the stewards' route: their PIN token carries no Discord id, so
// the member endpoint would turn them away.
// The signed-in member's own Discord id, for "is this message mine". Reads the
// same stored profile the nav chip does; null when signed out or PIN-only.
export function myDiscordId() {
  try {
    return JSON.parse(localStorage.getItem("nabs_user") || "null")?.discordId || null;
  } catch {
    return null;
  }
}

export async function reportFileUrl(file, admin = false) {
  const path = admin
    ? `/admin/reports/${file.reportId}/files/${file.id}`
    : `/reports/${file.reportId}/files/${file.id}`;
  const token = admin ? adminAuthToken() : localStorage.getItem(USER_TOKEN_KEY);
  const res = await fetch(`${BASE}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Could not load that file");
  return URL.createObjectURL(await res.blob());
}

const USER_TOKEN_KEY = "nabs_user_token";

// Token for admin routes: the PIN admin token wins; a designated Discord admin
// has no admin token, so fall back to their user token (the backend accepts it
// for admin routes when the account is a live-designated admin). EVERY admin
// call must use this — a bare getToken() breaks for Discord admins.
function adminAuthToken() {
  return getToken() || localStorage.getItem(USER_TOKEN_KEY);
}

// The same rights, but WITH a face on them.
//
// adminAuthToken above prefers the PIN token, which carries no identity: it
// says "an admin" and nothing else. That is right for editing a result, and
// wrong for writing in a report thread, where the drivers are reading a
// message and want to know which steward wrote it. When the person at the
// keyboard is signed in with Discord AND is a designated admin, their own
// token opens the same doors and comes with their name.
//
// Falls back to the PIN token, so a PIN-only admin can still write; they just
// appear as the office, because that is all anybody knows about them.
function adminIdentityToken() {
  try {
    const user = JSON.parse(localStorage.getItem("nabs_user") || "null");
    const ut = localStorage.getItem(USER_TOKEN_KEY);
    if (user?.isAdmin && ut) return ut;
  } catch {
    /* fall through to the PIN token */
  }
  return adminAuthToken();
}

// Where Discord should send the user back after login — always the current host
// (localhost in dev, the tunnel URL when shared). Must be registered in the
// Discord app's OAuth2 redirects.
function discordRedirectUri() {
  return `${window.location.origin}/auth/discord/callback`;
}

// OAuth `state`: the thing that ties the login Discord sends back to the login
// this browser actually started. Without it, anyone can hand a victim a link
// that finishes an authorization the ATTACKER began, and the victim's browser
// silently ends up holding a session for the attacker's Discord account — every
// RSVP and profile edit after that lands on the wrong person. The Steam link
// already does this (backend/src/routes/steamAuth.js); Discord never did.
//
// Kept in sessionStorage rather than signed by the server on purpose: the check
// that matters is "did THIS browser start this flow", and a server-signed token
// answers a different question, since an attacker can ask the server for one
// just as easily. sessionStorage is per-tab and same-origin, which is exactly
// the boundary an attacker cannot reach across. Discord returns the value
// verbatim, so the callback page can compare and refuse.
const DISCORD_STATE_KEY = "nabs_discord_state";
export function newDiscordLoginState() {
  const nonce =
    (window.crypto?.randomUUID?.() || String(Math.random()).slice(2) + Date.now().toString(36)).replace(/-/g, "");
  try {
    sessionStorage.setItem(DISCORD_STATE_KEY, nonce);
  } catch {
    /* private mode with no storage — the backend still gets a state, the
       callback just cannot verify it and will say so rather than guess */
  }
  return nonce;
}
export function takeDiscordLoginState() {
  try {
    const v = sessionStorage.getItem(DISCORD_STATE_KEY);
    sessionStorage.removeItem(DISCORD_STATE_KEY);
    return v;
  } catch {
    return null;
  }
}

// Where to land after a Discord login, when it was started somewhere with an
// obvious "and then?" — the attendance page's sign-in banner sets it, so a
// member who came to answer for Friday's race comes back to that question
// rather than to their profile. Everything else leaves it unset and keeps the
// old destination.
//
// Only an in-site path is ever stored: anything starting "//" or carrying a
// scheme is refused, so this can never become a redirect off the site.
const DISCORD_RETURN_KEY = "nabs_discord_return";
export function setDiscordReturnTo(path) {
  const p = String(path || "");
  if (!p.startsWith("/") || p.startsWith("//")) return;
  try {
    sessionStorage.setItem(DISCORD_RETURN_KEY, p);
  } catch {
    /* private mode with no storage — the login still works, it just lands on
       the profile like it always did */
  }
}
export function takeDiscordReturnTo() {
  try {
    const v = sessionStorage.getItem(DISCORD_RETURN_KEY);
    sessionStorage.removeItem(DISCORD_RETURN_KEY);
    return v && v.startsWith("/") && !v.startsWith("//") ? v : null;
  } catch {
    return null;
  }
}

// The series the site is currently viewing (a URL slug), or null for the
// active (primary) series. Set by the SeriesProvider; appended to every
// season-scoped read so all data is transitively series-scoped. Mirrors
// setSelectedSeason below, one level higher.
let SELECTED_SERIES = null;
export function setSelectedSeries(slug) {
  SELECTED_SERIES = slug || null;
}
export function getSelectedSeries() {
  return SELECTED_SERIES;
}
function seriesQ() {
  return SELECTED_SERIES ? `?series=${encodeURIComponent(SELECTED_SERIES)}` : "";
}

// The season the public site is currently viewing (a round number), or null for
// the active season. Set by the SeasonProvider; appended to season-scoped reads.
let SELECTED_SEASON = null;
export function setSelectedSeason(n) {
  SELECTED_SEASON = n === undefined ? null : n;
}
export function getSelectedSeason() {
  return SELECTED_SEASON;
}
function seasonQ(extra = "") {
  const parts = [];
  if (SELECTED_SEASON != null) parts.push(`season=${SELECTED_SEASON}`);
  if (SELECTED_SERIES) parts.push(`series=${encodeURIComponent(SELECTED_SERIES)}`);
  if (extra) parts.push(extra);
  return parts.length ? `?${parts.join("&")}` : "";
}
// Query string for a read that may target an EXPLICIT season (e.g. the Welcome
// page always shows the active season regardless of the switcher). `null`/
// undefined falls back to the currently-selected season. The series always
// rides along — an explicit season number means "this season OF THIS SERIES".
function seasonParam(n) {
  if (n == null) return seasonQ();
  const parts = [`season=${n}`];
  if (SELECTED_SERIES) parts.push(`series=${encodeURIComponent(SELECTED_SERIES)}`);
  return `?${parts.join("&")}`;
}
// "&upTo=7" or "?upTo=7", depending on whether seasonParam already opened the
// query string. The standings posters freeze a table after a round, and every
// one of those reads has to get the number the same way.
function upToQ(season, upTo) {
  if (!upTo) return "";
  return `${seasonParam(season) ? "&" : "?"}upTo=${upTo}`;
}

// For POST bodies that target the admin's currently-edited season: the series
// rides along so the backend's active-season fallback stays inside the series.
function seriesBody() {
  return SELECTED_SERIES ? { series: SELECTED_SERIES } : {};
}

// Drop a dead Discord session (expired 30-day token, or a token the backend
// rejected outright). Clearing the stored profile flips the whole UI to
// logged-out via the "nabs-auth" event — without this, the nav keeps showing
// the member as signed in while every action fails. NOT triggered by 401s a
// valid-but-unlinked session can hit ("Sign in with Discord…"), only when the
// token itself is done.
function dropDeadUserSession(data) {
  const ut = localStorage.getItem(USER_TOKEN_KEY);
  if (!ut) return;
  const invalidByServer = data && data.error === "Invalid or expired session";
  if (!invalidByServer && !userTokenExpired(ut)) return;
  localStorage.removeItem(USER_TOKEN_KEY);
  localStorage.removeItem("nabs_user");
  if (typeof window !== "undefined") window.dispatchEvent(new Event("nabs-auth"));
}

// The JWT's expiry rides in its (unsigned, world-readable) payload.
function userTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

// Plain-language stand-in when the server sends no message of its own. The old
// text was the bare "Request failed (500)", which meant nothing to a driver
// looking at the standings.
function humanHttpError(status) {
  if (status === 404) return "We couldn't find that.";
  if (status === 403) return "You don't have access to that.";
  if (status === 413) return "That file is too big.";
  if (status === 429) return "Too many requests just now. Give it a moment and try again.";
  if (status >= 500) return "The league server is having a moment. Try again shortly.";
  return "That didn't work. Try again.";
}

async function request(path, { method = "GET", body, auth = false, userAuth = false, identityAuth = false, form = false } = {}) {
  const headers = {};
  if (!form) headers["Content-Type"] = "application/json";
  if (auth || identityAuth) {
    const token = identityAuth ? adminIdentityToken() : adminAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  if (userAuth) {
    const ut = localStorage.getItem(USER_TOKEN_KEY);
    if (ut) headers["Authorization"] = `Bearer ${ut}`;
  }
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: form ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch itself rejects when the connection never happens (offline, DNS,
    // server down). Its own wording is "Failed to fetch", which was shown to
    // the visitor verbatim.
    const offline = new Error("No connection to the league server. Check your internet and try again.");
    offline.status = 0;
    throw offline;
  }
  const text = await res.text();
  // A proxy or gateway that answers with an HTML error page would otherwise
  // blow up here, and the raw parser message ("Unexpected token '<' …") ended
  // up on screen as if it were our error text.
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    // An expired/invalid admin token: drop it and let the admin UI bounce back
    // to the login screen instead of pretending we're still signed in. Discord
    // admins have no PIN token — their admin calls ride on the user token, so
    // a dead one is cleared the same way as on member routes below.
    if (res.status === 401 && auth) {
      if (getToken()) setToken(null);
      else dropDeadUserSession(data);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("nabs-admin-unauthorized"));
      }
    }
    // A member call rejected because the Discord session itself is dead
    // (30-day token ran out, or the backend no longer accepts it): log the
    // UI out instead of showing a signed-in nav over failing features.
    if (res.status === 401 && userAuth) {
      dropDeadUserSession(data);
    }
    const err = new Error((data && data.error) || humanHttpError(res.status));
    err.status = res.status;
    err.data = data; // e.g. { needsConfirm: true } on overwrite guards
    throw err;
  }
  return data;
}

export const api = {
  // public (season-scoped reads honour the selected season)
  // Season-scoped reads default to the selected season; pass an explicit season
  // number to target a specific one (the Welcome page pins the active season).
  // auth:true attaches the admin token when present (harmless for the public:
  // these routes never require it), so a signed-in admin can preview a PRIVATE
  // season on the real site. Without the token the backend hides that data.
  // `upTo` is a round number: the table as it stood AFTER that round, for the
  // standings posters. Omitted = the season as it stands now.
  driverStandings: (season, upTo = null) =>
    request(`/standings/drivers${seasonParam(season)}${upToQ(season, upTo)}`, { auth: true }),
  // End-of-season honours (champion, awards) for the finished-season home hero.
  seasonHonours: (season) => request(`/standings/honours${seasonParam(season)}`, { auth: true }),
  // Every rated driver of the season incl. card look — the standings "Cards" view.
  seasonRatings: (season) => request(`/standings/ratings${seasonParam(season)}`, { auth: true }),
  // All-time records of the viewed series (Hall of Fame page). Series-scoped.
  seriesRecords: () => request(`/standings/records${seriesQ()}`, { auth: true }),
  // Races of an EXPLICIT season (e.g. the next-season teaser), regardless of
  // the season the site is currently viewing (within the current series).
  racesFor: (n) => request(`/races${seasonParam(n)}`, { auth: true }),
  driverProfile: (id) => request(`/drivers/${id}/profile`, { auth: true }),
  driverRating: (id) => request(`/drivers/${id}/rating`, { auth: true }),
  // Own round-by-round rating history + component breakdown (My Rating tab).
  myRatingHistory: () => request("/me/rating/history", { userAuth: true }),
  // Per-race career curve — heavier, so it loads only on demand.
  myRatingCareer: () => request("/me/rating/career", { userAuth: true }),
  // `upTo` freezes the table after that round, for the constructors poster.
  t1Standings: (season, upTo = null) =>
    request(`/standings/constructors/t1${seasonParam(season)}${upToQ(season, upTo)}`, { auth: true }),
  t2Standings: (season, upTo = null) =>
    request(`/standings/constructors/t2${seasonParam(season)}${upToQ(season, upTo)}`, { auth: true }),
  races: (season) => request(`/races${seasonParam(season)}`, { auth: true }),
  raceResults: (id) => request(`/races/${id}/results`, { auth: true }),
  // Admin-stored track flag countries ({ trackKey: "gb", ... }), loaded once at
  // app boot and layered over the static circuit table (circuits.js flagFor).
  trackCountries: () => request(`/tracks/countries`),
  // Track history across the series' seasons (userAuth so a member gets their own record).
  trackHistory: (track) =>
    request(
      `/tracks/history?track=${encodeURIComponent(track)}${SELECTED_SERIES ? `&series=${encodeURIComponent(SELECTED_SERIES)}` : ""}`,
      { userAuth: true }
    ),
  teams: () => request(`/teams${seasonQ()}`, { auth: true }),
  seasons: () => request(`/seasons${seriesQ()}`, { auth: true }),
  // All visible racing series, switcher order (admins also get private ones).
  series: () => request("/series", { auth: true }),
  // Global search across drivers/teams/races/seasons/series — NOT scoped to the
  // current series/season (built without seriesQ/seasonQ on purpose). auth:true
  // so a signed-in admin also gets private-season/series hits.
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`, { auth: true }),
  // Admin "All time" search: every matching row across ALL seasons of the
  // currently edited series (one row per season), for jumping into edits.
  adminSearch: (q) =>
    request(
      `/search/admin?q=${encodeURIComponent(q)}${SELECTED_SERIES ? `&series=${encodeURIComponent(SELECTED_SERIES)}` : ""}`,
      { auth: true }
    ),
  // The next ANNOUNCED upcoming season for the "Coming up" strip (or null).
  seasonTeaser: () => request(`/seasons/teaser${seriesQ()}`),
  leagueStats: () => request("/settings/league-stats"),
  // Every season this team has raced and where it finished, for the team page's
  // career table and its constructor seals.
  teamHistory: (id) => request(`/teams/${id}/history`, { auth: true }),
  // Tiny "is anything happening" poll for the nav bar's live dot. Deliberately
  // not the timing board, which is the whole grid.
  liveStatus: () => request(`/live/status${seriesQ()}`),
  // Live championship projection (only { active: true } while a league race is
  // running). auth:true so an admin's ?simulate demo request is recognised.
  liveChampionship: (simulate = false) =>
    request(`/live/championship${seriesQ()}${simulate ? (seriesQ() ? "&" : "?") + "simulate=1" : ""}`, { auth: true }),

  // events / RSVP (public; scoped to the viewed season, default active)
  // Attendance is about UPCOMING races, so these deliberately ignore the
  // season switcher (series only): next season's sign-ups must show while the
  // current season is still the one being viewed.
  // Races the attendance page asks about. Hidden ones are gone for everybody,
  // admin included — only the admin's own Attendance tab passes includeHidden,
  // which is the one place they can be brought back.
  events: (includeHidden = false) => {
    const q = seriesQ();
    const extra = includeHidden ? `${q ? "&" : "?"}includeHidden=1` : "";
    return request(`/events${q}${extra}`, { auth: true });
  },
  attendanceOpen: () => request(`/events/open${seriesQ()}`, { auth: true }),
  rsvp: (raceId, driverId, status) =>
    request(`/events/${raceId}/rsvp`, { method: "POST", body: { driverId, status }, userAuth: true }),
  removeRsvp: (raceId, driverId) =>
    request(`/events/${raceId}/rsvp/${driverId}`, { method: "DELETE", userAuth: true }),
  // "I want to race": a logged-in account with no driver profile raises a hand
  // for a race; the admin sees it in Members → Needs attention.
  myRaceRequest: () => request("/me/race-request", { userAuth: true }),
  requestRace: (raceId) => request("/me/race-request", { method: "POST", body: { raceId }, userAuth: true }),

  // "Sign in through Steam": start returns the URL to send the browser to;
  // Steam then comes back to /auth/steam/callback in this app, and THAT page
  // hands the answer to verify with the member's own session attached. The
  // detour through our own page is deliberate (see backend/routes/steamAuth.js):
  // it is what proves the browser finishing the flow is the signed-in member.
  steamLinkStart: () =>
    request("/auth/steam/start", {
      method: "POST",
      body: { returnTo: `${window.location.origin}/auth/steam/callback` },
      userAuth: true,
    }),
  steamLinkVerify: (query) =>
    request("/auth/steam/verify", { method: "POST", body: { query }, userAuth: true }),
  steamUnlink: () => request("/auth/steam", { method: "DELETE", userAuth: true }),

  // notifications (the nav-bar bell; member-only)
  notifications: () => request("/notifications", { userAuth: true }),
  notificationsCount: () => request("/notifications/count", { userAuth: true }),
  markNotificationsSeen: () => request("/notifications/seen", { method: "POST", userAuth: true }),
  adminNotificationSettings: () => request("/admin/notification-settings", { auth: true }),
  saveNotificationSettings: (settings) =>
    request("/admin/notification-settings", { method: "PUT", body: { settings }, auth: true }),
  adminAttendancePing: (raceId) =>
    request(`/admin/races/${raceId}/attendance-ping`, { method: "POST", auth: true }),

  // feedback (the floating Feedback button). Open to everyone — userAuth only
  // attaches the session when there is one, so a signed-in member's report
  // carries their name and a visitor's doesn't need an account at all.
  sendFeedback: (body) => request("/feedback", { method: "POST", body, userAuth: true }),
  adminFeedback: () => request("/admin/feedback", { auth: true }),
  updateFeedback: (id, body) => request(`/admin/feedback/${id}`, { method: "PATCH", body, auth: true }),
  deleteFeedback: (id) => request(`/admin/feedback/${id}`, { method: "DELETE", auth: true }),
  // The conversation on a report: the admin answers (the sender's bell rings),
  // the sender writes back (the admins' bells ring). Member side needs a login,
  // so it rides on the user token.
  replyToFeedback: (id, body, status) =>
    request(`/admin/feedback/${id}/reply`, { method: "POST", body: { body, status }, auth: true }),
  myFeedback: () => request("/feedback/mine", { userAuth: true }),
  sendFeedbackReply: (id, body) =>
    request(`/feedback/${id}/reply`, { method: "POST", body: { body }, userAuth: true }),

  // logged-in driver self-service
  me: () => request("/me", { userAuth: true }),
  setMyCountry: (country) => request("/me/country", { method: "PUT", body: { country }, userAuth: true }),
  updateMyProfile: (body) => request("/me/profile", { method: "PUT", body, userAuth: true }),
  uploadMyPhoto: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request("/me/photo", { method: "POST", body: fd, userAuth: true, form: true });
  },
  clearMyPhoto: () => request("/me/photo", { method: "DELETE", userAuth: true }),
  // Which headline stat tiles the public profile shows (null = all six).
  setMyTiles: (tiles) => request("/me/tiles", { method: "PUT", body: { tiles }, userAuth: true }),
  // How the picture sits on the rating card ({x,y,z,s} or null = default).
  // driverId targets one of the person's own season rows (default: current).
  setMyCardPhoto: (pos, driverId) =>
    request("/me/card-photo", { method: "PUT", body: { pos, driverId }, userAuth: true }),
  // A separate card-only picture (falls back to the profile photo when unset).
  uploadMyCardPhoto: (file, driverId) => {
    const fd = new FormData();
    fd.append("file", file);
    if (driverId) fd.append("driverId", driverId);
    return request("/me/card-photo-image", { method: "POST", body: fd, userAuth: true, form: true });
  },
  clearMyCardPhoto: (driverId) =>
    request(`/me/card-photo-image${driverId ? `?driverId=${encodeURIComponent(driverId)}` : ""}`, {
      method: "DELETE",
      userAuth: true,
    }),
  // Unlockable rating-card editions: the catalogue + unlock state for a row, the
  // person's season chips, and picking an edition (driverId = which season row).
  myCardEditions: (driverId) =>
    request(`/me/card-editions${driverId ? `?driverId=${encodeURIComponent(driverId)}` : ""}`, { userAuth: true }),
  myCardSeasons: () => request("/me/card-seasons", { userAuth: true }),
  setMyCardStyle: (driverId, style) =>
    request("/me/card-style", { method: "PUT", body: { driverId, style }, userAuth: true }),
  // Card animation switch: "off" = a still card, null = the edition's baseline motion.
  setMyCardAnim: (driverId, anim) =>
    request("/me/card-anim", { method: "PUT", body: { driverId, anim }, userAuth: true }),

  // the private Cockpit (member-only, always about the logged-in driver)
  cockpitOverview: () => request("/me/cockpit/overview", { userAuth: true }),
  cockpitSeason: () => request("/me/cockpit/season", { userAuth: true }),
  cockpitTracks: () => request("/me/cockpit/tracks", { userAuth: true }),
  cockpitCareer: () => request("/me/cockpit/career", { userAuth: true }),
  cockpitDuels: () => request("/me/cockpit/duels", { userAuth: true }),
  cockpitAchievements: () => request("/me/cockpit/achievements", { userAuth: true }),
  cockpitRaces: () => request("/me/cockpit/races", { userAuth: true }),
  cockpitInsights: () => request("/me/cockpit/insights", { userAuth: true }),
  cockpitRaceAnalysis: (raceId) => request(`/me/cockpit/race/${raceId}`, { userAuth: true }),
  saveCockpitGoals: (goals) => request("/me/cockpit/goals", { method: "PUT", body: { goals }, userAuth: true }),
  saveCockpitPins: (keys) => request("/me/cockpit/pins", { method: "PUT", body: { keys }, userAuth: true }),

  // driver market (identity from the Discord login). Season-scoped like
  // /events — without it, viewing another season shows that season's races
  // but the market of the ACTIVE one (the "Offer my seat" button vanished).
  market: () => request(`/market${seriesQ()}`, { userAuth: true }),
  offerSeat: (raceId) => request("/market/offer", { method: "POST", body: { raceId }, userAuth: true }),
  withdrawOffer: (offerId) => request(`/market/offer/${offerId}`, { method: "DELETE", userAuth: true }),
  expressInterest: (offerId) =>
    request(`/market/offer/${offerId}/interest`, { method: "POST", userAuth: true }),
  withdrawInterest: (offerId) =>
    request(`/market/offer/${offerId}/interest`, { method: "DELETE", userAuth: true }),
  pickReplacement: (offerId, driverId) =>
    request(`/market/offer/${offerId}/pick`, { method: "POST", body: { driverId }, userAuth: true }),
  // admin override of the market
  adminAssignSeat: (offerId, driverId) =>
    request(`/admin/market/${offerId}/assign`, { method: "POST", body: { driverId }, auth: true }),
  adminDeleteOffer: (offerId) => request(`/admin/market/${offerId}`, { method: "DELETE", auth: true }),
  // full takeover record of the selected season, completed races included
  adminMarketHistory: () => request(`/admin/market/history${seasonQ()}`, { auth: true }),
  // self-hosted traffic counter: fire-and-forget page-view beacon + admin stats.
  // sendBeacon survives tab closes and never blocks navigation; fetch keepalive
  // is the fallback. Both are best-effort — analytics must never throw.
  hit: (path) => {
    try {
      const url = `${BASE}/api/hit`;
      const body = JSON.stringify({ path });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      } else {
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    } catch {
      /* never let analytics break the page */
    }
  },
  adminTraffic: () => request("/admin/traffic", { auth: true }),

  // social links (public read + admin manage)
  socialLinks: () => request("/settings/social"),
  getSocial: () => request("/admin/social", { auth: true }),
  setSocial: (body) => request("/admin/social", { method: "PUT", body, auth: true }),

  // Social wall on the home page: the league's latest posts. YouTube arrives on
  // its own (channel feed), the rest is added by an admin.
  socialFeed: () => request("/settings/social-feed"),
  getSocialFeed: () => request("/admin/social-feed", { auth: true }),
  setSocialFeed: (config) => request("/admin/social-feed", { method: "PUT", body: { config }, auth: true }),
  addSocialPostsBulk: (text) => request("/admin/social-feed/posts/bulk", { method: "POST", body: { text }, auth: true }),
  updateSocialPost: (id, post) => request(`/admin/social-feed/posts/${id}`, { method: "PUT", body: { post }, auth: true }),
  deleteSocialPost: (id) => request(`/admin/social-feed/posts/${id}`, { method: "DELETE", auth: true }),
  refreshSocialPost: (id) => request(`/admin/social-feed/posts/${id}/refresh`, { method: "POST", auth: true }),
  uploadSocialCover: (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/social-feed/posts/${id}/cover`, { method: "POST", body: fd, auth: true, form: true });
  },
  clearSocialCover: (id) => request(`/admin/social-feed/posts/${id}/cover`, { method: "DELETE", auth: true }),

  // Live Timing page external links (public read + admin manage)
  liveLinks: () => request("/settings/live"),
  getLiveLinks: () => request("/admin/live-links", { auth: true }),
  setLiveLinks: (body) => request("/admin/live-links", { method: "PUT", body, auth: true }),
  // Which race server each series' live page follows.
  getLiveServers: () => request("/admin/live-servers", { auth: true }),
  setLiveServers: (map) => request("/admin/live-servers", { method: "PUT", body: { map }, auth: true }),

  // discord login. The redirect URI is derived from the current origin so login
  // works on localhost and over a tunnel without changing the backend .env.
  discordConfig: () =>
    request(
      `/auth/discord/config?redirect=${encodeURIComponent(discordRedirectUri())}` +
        `&state=${encodeURIComponent(newDiscordLoginState())}`
    ),
  // The viewed series rides along so the login's season handover lands the
  // member on THAT series' roster (fallback: the primary series).
  discordCallback: (code) =>
    request("/auth/discord/callback", {
      method: "POST",
      body: { code, redirectUri: discordRedirectUri(), ...seriesBody() },
    }),

  // admin
  login: (pin) => request("/admin/login", { method: "POST", body: { pin } }),
  importRace: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    // Driver matching happens against the season the admin is editing.
    return request(`/admin/races/import${seasonQ()}`, { method: "POST", body: fd, auth: true, form: true });
  },
  remoteResults: (type = "RACE") => request(`/admin/results/remote?type=${type}`, { auth: true }),
  importRemoteResult: (id) =>
    request("/admin/results/remote/import", { method: "POST", body: { id, season: getSelectedSeason(), ...seriesBody() }, auth: true }),
  commitRace: (body) => request("/admin/races/commit", { method: "POST", body: { ...seriesBody(), ...body }, auth: true }),
  // Attach a qualifying JSON to an existing race (auto-matched, no review step).
  importQuali: (raceId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/races/${raceId}/quali`, { method: "POST", body: fd, auth: true, form: true });
  },
  deleteQuali: (raceId) => request(`/admin/races/${raceId}/quali`, { method: "DELETE", auth: true }),
  // Same attach, but the QUALIFY JSON comes straight from the race server.
  importRemoteQuali: (raceId, remoteId) =>
    request(`/admin/races/${raceId}/quali`, { method: "POST", body: { remoteId }, auth: true }),
  editResults: (id, results) =>
    request(`/admin/races/${id}/results`, { method: "PUT", body: { results }, auth: true }),
  setDriverOfTheDay: (raceId, driverId, pickedBy) =>
    request(`/admin/races/${raceId}/driver-of-the-day`, { method: "PUT", body: { driverId, pickedBy }, auth: true }),
  // Manually recorded honours of a round (pole, fastest lap + optional time) —
  // built for archive rounds that have no imported data to derive them from.
  setRaceHonours: (raceId, body) =>
    request(`/admin/races/${raceId}/honours`, { method: "PUT", body, auth: true }),
  // Live "what would change" preview for unsaved results (no DB writes).
  previewRace: (body) =>
    request("/admin/races/preview", { method: "POST", body: { ...body, season: getSelectedSeason(), ...seriesBody() }, auth: true }),
  // Driver ratings with tunable weights — powers the admin ratings panel.
  ratingsPreview: (weights) =>
    request("/admin/ratings/preview", { method: "POST", body: { weights, season: getSelectedSeason(), ...seriesBody() }, auth: true }),
  ratingsWeights: () => request("/admin/ratings/weights", { auth: true }),
  saveRatingsWeights: (weights) =>
    request("/admin/ratings/weights", { method: "PUT", body: { weights }, auth: true }),
  createDriver: (body) => request("/admin/drivers", { method: "POST", body: { ...seriesBody(), ...body }, auth: true }),
  // The series' all-time driver database (one entry per person) + adding one
  // of those people into a team of the currently edited season.
  adminDriverDb: () => request(`/admin/driver-db${seriesQ()}`, { auth: true }),
  addDriverFromDb: (sourceDriverId, teamId) =>
    request("/admin/drivers/from-db", { method: "POST", body: { sourceDriverId, teamId }, auth: true }),
  updateDriver: (id, body) => request(`/admin/drivers/${id}`, { method: "PUT", body, auth: true }),
  // Remove one driver row from its season. Without force the backend answers
  // 409 needsConfirm listing what would be deleted with it (attendance answers,
  // market entries); the UI confirms, then retries with force.
  deleteDriver: (id, force = false) =>
    request(`/admin/drivers/${id}${force ? "?force=1" : ""}`, { method: "DELETE", auth: true }),
  // Bulk removal: same two-step dance, but one confirm for the whole batch.
  // Without force the backend answers 409 with a per-driver report (who is
  // blocked by results, whose attendance answers would go); with force it
  // deletes every deletable row and skips the blocked ones.
  bulkDeleteDrivers: (ids, force = false) =>
    request("/admin/drivers/bulk-delete", { method: "POST", body: { ids, force }, auth: true }),
  changePin: (newPin) =>
    request("/admin/settings/pin", { method: "PUT", body: { newPin }, auth: true }),
  adminSecurity: () => request("/admin/security", { auth: true }),

  // discord + events (admin)
  getWebhook: () => request("/admin/discord/webhook", { auth: true }),
  setWebhook: (url) => request("/admin/discord/webhook", { method: "PUT", body: { url }, auth: true }),
  testWebhook: () => request("/admin/discord/test", { method: "POST", auth: true }),
  // results-channel webhook + the generated Discord results post (admin)
  getResultsWebhook: () => request("/admin/discord/results-webhook", { auth: true }),
  setResultsWebhook: (url) => request("/admin/discord/results-webhook", { method: "PUT", body: { url }, auth: true }),
  // The drivers' Discord role, pinged at the top of a results post.
  getResultsRole: () => request("/admin/discord/results-role", { auth: true }),
  setResultsRole: (roleId) => request("/admin/discord/results-role", { method: "PUT", body: { roleId }, auth: true }),
  // The origin rides along so the short version's link points at the site the
  // admin is on. In production it matches what the server would have worked out
  // anyway; in development it is the difference between a link to the site and
  // a link to the API port.
  getResultsPost: (raceId) =>
    request(`/admin/races/${raceId}/results-post?origin=${encodeURIComponent(window.location.origin)}`, {
      auth: true,
    }),
  // `image` (optional) is the round's poster as a Blob. With one, the whole
  // thing goes as multipart so Discord gets a real attachment; without one this
  // is the plain JSON post it always was.
  sendResultsPost: (raceId, content, image = null) => {
    const path = `/admin/races/${raceId}/results-post`;
    if (!image) return request(path, { method: "POST", body: { content }, auth: true });
    const fd = new FormData();
    fd.append("content", content);
    fd.append("image", image, `${raceId}-result.png`);
    return request(path, { method: "POST", body: fd, auth: true, form: true });
  },
  // The championship table as a post: same channel, same two lengths. `upTo` is
  // the round it is frozen after, the same number the sheets are drawn from.
  // `of` picks the championship: "drivers" (with its group and reserve rule) or
  // "constructors" (with how many teams of each tier are on the sheet).
  getStandingsPost: (upTo = null, opts = {}) => {
    const q = [`origin=${encodeURIComponent(window.location.origin)}`];
    if (upTo) q.push(`upTo=${upTo}`);
    if (opts.of === "constructors") {
      q.push("of=constructors", `t1Rows=${opts.t1Rows || 5}`, `t2Rows=${opts.t2Rows || 8}`);
    } else {
      q.push(`tier=${encodeURIComponent(opts.tier || "all")}`);
      if (opts.withoutStarts) q.push("withoutStarts=1");
    }
    return request(`/admin/standings-post?${q.join("&")}`, { auth: true });
  },
  // `images` is the table's sheets as Blobs, in order. A long table is several
  // pictures on one message, so this always goes as multipart.
  sendStandingsPost: (content, images = []) => {
    const fd = new FormData();
    fd.append("content", content);
    images.forEach((b, i) => fd.append("images", b, `standings-${i + 1}.png`));
    return request("/admin/standings-post", { method: "POST", body: fd, auth: true, form: true });
  },
  createEvent: (body) => request("/admin/events", { method: "POST", body: { ...seriesBody(), ...body }, auth: true }),
  updateEvent: (id, body) => request(`/admin/events/${id}`, { method: "PUT", body, auth: true }),
  announceEvent: (id) => request(`/admin/events/${id}/announce`, { method: "POST", auth: true }),
  // force: also deletes a race that already has results (Edit-Results editor);
  // the backend writes a backup first.
  deleteEvent: (id, { force = false } = {}) =>
    request(`/admin/events/${id}${force ? "?force=1" : ""}`, { method: "DELETE", auth: true }),
  // Wipe only a round's stored results — the race stays on the calendar.
  clearRaceResults: (id) => request(`/admin/races/${id}/results`, { method: "DELETE", auth: true }),

  // series (admin) — the level above seasons. The slug is set at creation and
  // never changes (URL identity); renames only touch the name.
  adminSeries: () => request("/admin/series", { auth: true }),
  createSeries: (body) => request("/admin/series", { method: "POST", body, auth: true }),
  updateSeries: (id, body) => request(`/admin/series/${id}`, { method: "PUT", body, auth: true }),
  activateSeries: (id) => request(`/admin/series/${id}/activate`, { method: "POST", auth: true }),
  deleteSeries: (id, force = false) =>
    request(`/admin/series/${id}${force ? "?force=1" : ""}`, { method: "DELETE", auth: true }),
  // Series dark-mode logo mark (light mode always uses the shared default).
  uploadSeriesLogo: (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/series/${id}/logo`, { method: "POST", body: fd, auth: true, form: true });
  },
  clearSeriesLogo: (id) => request(`/admin/series/${id}/logo`, { method: "DELETE", auth: true }),

  // seasons + teams (admin) — scoped to the series being edited
  adminSeasons: () => request(`/admin/seasons${seriesQ()}`, { auth: true }),
  createSeason: (body) => request("/admin/seasons", { method: "POST", body: { ...seriesBody(), ...body }, auth: true }),
  updateSeason: (id, body) => request(`/admin/seasons/${id}`, { method: "PUT", body, auth: true }),
  deleteSeason: (id, force = false) =>
    request(`/admin/seasons/${id}${force ? "?force=1" : ""}`, { method: "DELETE", auth: true }),
  activateSeason: (id) => request(`/admin/seasons/${id}/activate`, { method: "POST", auth: true }),
  cloneTeams: (id, fromSeasonId) =>
    request(`/admin/seasons/${id}/clone-teams`, { method: "POST", body: { fromSeasonId }, auth: true }),
  cloneRoster: (id, fromSeasonId) =>
    request(`/admin/seasons/${id}/clone-roster`, { method: "POST", body: { fromSeasonId }, auth: true }),
  // Home/Welcome main-card photo, per season.
  uploadSeasonHero: (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/seasons/${id}/hero`, { method: "POST", body: fd, auth: true, form: true });
  },
  clearSeasonHero: (id) => request(`/admin/seasons/${id}/hero`, { method: "DELETE", auth: true }),
  // Car image for the "coming soon" hero panel, per season.
  uploadSeasonCar: (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/seasons/${id}/car`, { method: "POST", body: fd, auth: true, form: true });
  },
  clearSeasonCar: (id) => request(`/admin/seasons/${id}/car`, { method: "DELETE", auth: true }),

  // Race photo gallery (admin). The public side reads the photos straight off
  // the round detail, so there is no public call here.
  racePhotos: (raceId) => request(`/admin/races/${raceId}/photos`, { auth: true }),
  // `silent` skips the "photos are up" bell — for filling in old galleries,
  // which is housekeeping rather than news.
  uploadRacePhotos: (raceId, files, silent = false) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    return request(`/admin/races/${raceId}/photos${silent ? "?silent=1" : ""}`, {
      method: "POST",
      body: fd,
      auth: true,
      form: true,
    });
  },
  // Swap the file behind one photo, keeping its id, caption and position.
  replaceRacePhoto: (raceId, photoId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/races/${raceId}/photos/${encodeURIComponent(photoId)}/replace`, {
      method: "POST",
      body: fd,
      auth: true,
      form: true,
    });
  },
  // The whole gallery in one call: order, captions and deletions. Anything left
  // out of the list is removed, file and all.
  saveRacePhotos: (raceId, photos) =>
    request(`/admin/races/${raceId}/photos`, {
      method: "PUT",
      body: { photos: photos.map((p) => ({ id: p.id, caption: p.caption || "" })) },
      auth: true,
    }),

  // health (admin): integrity check, backups, activity log
  integrity: () => request(`/admin/integrity${seasonQ()}`, { auth: true }),
  // Live memory breakdown (total vs JS data vs buffers) for Health.
  memory: () => request("/admin/memory", { auth: true }),
  // Full heap snapshot as a blob download. Same fetch-with-auth-header dance
  // as the backup zip: a plain <a href> couldn't send the admin token.
  downloadHeapSnapshot: async () => {
    const res = await fetch(`${BASE}/api/admin/memory/heap-snapshot`, {
      headers: { Authorization: `Bearer ${adminAuthToken()}` },
    });
    if (!res.ok) throw new Error(`Snapshot failed (${res.status})`);
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1];
    return { blob: await res.blob(), name: name || "heap.heapsnapshot" };
  },
  // Disk usage per area (race photos, downloads, backups, DB …) for Health.
  storage: () => request("/admin/storage", { auth: true }),
  backups: () => request("/admin/backups", { auth: true }),
  createBackup: () => request("/admin/backups", { method: "POST", auth: true }),
  deleteBackup: (file) => request(`/admin/backups/${encodeURIComponent(file)}`, { method: "DELETE", auth: true }),
  // Keep the newest `keep` snapshots, delete the rest.
  pruneBackups: (keep) => request("/admin/backups/prune", { method: "POST", body: { keep }, auth: true }),
  // Full backup (DB + uploads) as a zip blob. Fetched with the auth header and
  // saved by the caller — a plain <a href> couldn't send the admin token.
  downloadBackupZip: async () => {
    const res = await fetch(`${BASE}/api/admin/backups/download`, {
      headers: { Authorization: `Bearer ${adminAuthToken()}` },
    });
    if (!res.ok) throw new Error(`Backup download failed (${res.status})`);
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1];
    return { blob: await res.blob(), name: name || "nabs-full-backup.zip" };
  },
  activity: () => request("/admin/activity", { auth: true }),
  createTeam: (body) => request("/admin/teams", { method: "POST", body: { ...seriesBody(), ...body }, auth: true }),
  // Teams of every OTHER season in this series, for the "bring one over" search
  // next to Add team. `seasonId` is the season being edited.
  teamLibrary: (seasonId, q = "") =>
    request(`/admin/teams/library?seasonId=${encodeURIComponent(seasonId || "")}&q=${encodeURIComponent(q)}`, { auth: true }),
  importTeam: (fromTeamId, seasonId) =>
    request("/admin/teams/import", { method: "POST", body: { ...seriesBody(), fromTeamId, seasonId }, auth: true }),
  updateTeam: (id, body) => request(`/admin/teams/${id}`, { method: "PUT", body, auth: true }),
  // `force` confirms the one thing the server won't remove behind your back:
  // the team's driver-market seat offers.
  deleteTeam: (id, force = false) =>
    request(`/admin/teams/${id}${force ? "?force=1" : ""}`, { method: "DELETE", auth: true }),
  uploadTeamLogo: (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/teams/${id}/logo`, { method: "POST", body: fd, auth: true, form: true });
  },

  // downloads — member-only catalogue (self-hosted AC files)
  downloads: () => request("/downloads", { userAuth: true }),
  // Exchange the session for a short-lived download URL, then let the browser
  // fetch the file directly (so big files stream with resume support).
  downloadTicket: (id) => request(`/downloads/${id}/ticket`, { method: "POST", userAuth: true }),

  // members (admin) — Discord login accounts: link/unlink to drivers, ban/unban
  adminMembers: () => request("/admin/members", { auth: true }),
  banMember: (discordId, banned, reason) =>
    request(`/admin/members/${discordId}/ban`, { method: "POST", body: { banned, reason }, auth: true }),
  linkMember: (discordId, driverId) =>
    request(`/admin/members/${discordId}/link`, { method: "POST", body: { driverId }, auth: true }),
  unlinkMember: (discordId) => request(`/admin/members/${discordId}/unlink`, { method: "POST", auth: true }),
  setMemberAdmin: (discordId, isAdmin) =>
    request(`/admin/members/${discordId}/admin`, { method: "POST", body: { isAdmin }, auth: true }),
  // Reads every incident report, and nothing else.
  setMemberSteward: (discordId, isSteward) =>
    request(`/admin/members/${discordId}/steward`, { method: "POST", body: { isSteward }, auth: true }),
  createDriverFromMember: (discordId, body) =>
    request(`/admin/members/${discordId}/create-driver`, { method: "POST", body, auth: true }),

  // cross-season person links (admin) — group a person's per-season driver rows
  adminPersons: () => request("/admin/persons", { auth: true }),
  linkPersons: (driverIds) => request("/admin/persons/link", { method: "POST", body: { driverIds }, auth: true }),
  autoLinkPersons: () => request("/admin/persons/link-auto", { method: "POST", auth: true }),
  unlinkPerson: (driverId) => request("/admin/persons/unlink", { method: "POST", body: { driverId }, auth: true }),

  // downloads (admin)
  adminDownloads: () => request("/admin/downloads", { auth: true }),
  // Streams a (potentially huge) file into backend/downloads/. Uses XHR rather
  // than fetch so the UI can show real upload progress. onProgress(percent 0-100).
  uploadDownloadFile: (file, onProgress) =>
    new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/api/admin/downloads/upload`);
      const token = adminAuthToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { /* non-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        const err = new Error((data && data.error) || `Upload failed (${xhr.status})`);
        err.status = xhr.status;
        reject(err);
      };
      xhr.onerror = () => reject(new Error("Upload failed (network error)"));
      xhr.send(fd);
    }),
  createDownload: (body) => request("/admin/downloads", { method: "POST", body, auth: true }),
  updateDownload: (id, body) => request(`/admin/downloads/${id}`, { method: "PATCH", body, auth: true }),
  // `alsoFile` also removes the uploaded file from the server's disk.
  deleteDownload: (id, alsoFile = false) =>
    request(`/admin/downloads/${id}${alsoFile ? "?file=1" : ""}`, { method: "DELETE", auth: true }),
  // Files on disk no catalogue entry points at any more (the clean-up view).
  downloadOrphans: () => request("/admin/downloads/orphans", { auth: true }),
  deleteDownloadOrphan: (fileName) =>
    request(`/admin/downloads/orphans/${encodeURIComponent(fileName)}`, { method: "DELETE", auth: true }),

  // download folders (admin)
  createDownloadFolder: (body) => request("/admin/download-folders", { method: "POST", body, auth: true }),
  updateDownloadFolder: (id, body) => request(`/admin/download-folders/${id}`, { method: "PATCH", body, auth: true }),
  deleteDownloadFolder: (id) => request(`/admin/download-folders/${id}`, { method: "DELETE", auth: true }),

  // Track info (admin): fun facts + custom map image per circuit
  adminTrackInfo: (key) => request(`/admin/tracks/${key}/info`, { auth: true }),
  saveTrackCountry: (key, country) => request(`/admin/tracks/${key}/country`, { method: "PUT", body: { country }, auth: true }),
  saveTrackInfo: (key, content) => request(`/admin/tracks/${key}/info`, { method: "PUT", body: { content }, auth: true }),
  uploadTrackMap: (key, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/tracks/${key}/map`, { method: "POST", body: fd, auth: true, form: true });
  },
  clearTrackMap: (key) => request(`/admin/tracks/${key}/map`, { method: "DELETE", auth: true }),

  // Incident reports. The member's own side: file one, read the threads you are
  // party to, write in them. Everything is scoped to the login server-side.
  //
  // userAuth, NOT auth. `auth` sends the PIN admin token when there is one, and
  // that token carries no Discord id — so an admin who happened to be signed in
  // to the admin area in the same browser could not file a report, and their
  // own thread list came back empty. These four are the MEMBER's endpoints and
  // must always travel as the member.
  createReport: (body) => request("/reports", { method: "POST", body, userAuth: true }),
  myReports: () => request("/reports", { userAuth: true }),
  report: (id) => request(`/reports/${id}`, { userAuth: true }),
  // Text, files, or both. Always multipart: one shape for the endpoint means
  // one code path on the server, and a message with a clip on it is the normal
  // case here rather than the exception.
  replyToReport: (id, body, files = []) => {
    const fd = new FormData();
    fd.append("body", body || "");
    for (const f of files) fd.append("files", f, f.name);
    return request(`/reports/${id}/messages`, { method: "POST", body: fd, userAuth: true, form: true });
  },
  withdrawReport: (id) => request(`/reports/${id}`, { method: "DELETE", userAuth: true }),
  // The contacts AC recorded for you in one round, to pin a report to.
  myRaceContacts: (raceId) => request(`/reports/contacts?raceId=${encodeURIComponent(raceId)}`, { userAuth: true }),
  // The office's side.
  adminReports: () => request("/admin/reports", { auth: true }),
  adminReport: (id) => request(`/admin/reports/${id}`, { auth: true }),
  decideReport: (id, body) => request(`/admin/reports/${id}`, { method: "PUT", body, auth: true }),
  // The stewards' own reply. NOT the member endpoint: a PIN admin has no
  // Discord login behind them, and that route works out who you are from your
  // account.
  adminReplyToReport: (id, body, files = []) => {
    const fd = new FormData();
    fd.append("body", body || "");
    for (const f of files) fd.append("files", f, f.name);
    // identityToken, so the drivers see WHICH steward wrote to them.
    return request(`/admin/reports/${id}/messages`, { method: "POST", body: fd, identityAuth: true, form: true });
  },
  // Saying who it was, on a report YOU filed that names nobody yet. The member
  // endpoint on purpose: an accusation belongs to the person making it.
  setReportAccused: (id, accusedDriverId) =>
    request(`/reports/${id}/accused`, { method: "PUT", body: { accusedDriverId }, userAuth: true }),
  // By roster driver where possible; the raw Discord id stays for somebody who
  // is not on any roster.
  addReportViewer: (id, body) => request(`/admin/reports/${id}/viewers`, { method: "POST", body, auth: true }),
  removeReportViewer: (id, discordId) =>
    request(`/admin/reports/${id}/viewers/${discordId}`, { method: "DELETE", auth: true }),
  deleteReport: (id) => request(`/admin/reports/${id}`, { method: "DELETE", auth: true }),
  // What the stewards decided for one round, for the results editor to check
  // itself against.
  raceReportPenalties: (raceId) => request(`/admin/races/${raceId}/report-penalties`, { auth: true }),
  // The in-game app's key. Saving one switches in-game reporting on.
  // How long a decided report keeps its pictures.
  reportRetention: () => request("/admin/reports-retention", { auth: true }),
  setReportRetention: (days) =>
    request("/admin/reports-retention", { method: "PUT", body: { days }, auth: true }),
  reportIngest: () => request("/admin/reports-ingest", { auth: true }),
  setReportIngest: (enabled) =>
    request("/admin/reports-ingest", { method: "PUT", body: { enabled }, auth: true }),

  // Cars and wide wordmarks for the shareable result graphic, per team.
  teamArt: () => request("/admin/team-art", { auth: true }),
  uploadTeamArt: (teamId, kind, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/team-art/${teamId}/${kind}`, { method: "POST", body: fd, auth: true, form: true });
  },
  clearTeamArt: (teamId, kind) =>
    request(`/admin/team-art/${teamId}/${kind}`, { method: "DELETE", auth: true }).then((r) => r.art),
  // How those cars are cropped in the podium tiles — { zoom, x, y }, one set for
  // all three — plus the framings saved under a name. The PUT patches, so
  // sending only the numbers leaves the presets alone and vice versa.
  posterFraming: () => request("/admin/poster-framing", { auth: true }),
  setPosterFraming: (patch) => request("/admin/poster-framing", { method: "PUT", body: patch, auth: true }),

  // Who answered what for the races that have already run (season-scoped).
  attendanceHistory: () => request(`/admin/attendance-history${seasonQ()}`, { auth: true }),
  // The other side of it, for ONE upcoming race: who is still silent.
  attendanceMissing: (raceId) =>
    request(`/admin/attendance-missing?raceId=${encodeURIComponent(raceId)}`, { auth: true }),

  // Per-race sign-up switch (auto / forced open / forced closed).
  attendanceGates: () => request("/admin/attendance-gates", { auth: true }),
  setAttendanceGate: (raceId, state) =>
    request(`/admin/races/${raceId}/attendance`, { method: "PUT", body: { state }, auth: true }),
  // Whether the race is on the attendance page at all — a separate switch from
  // the gate above, so hiding a race doesn't forget its open/closed setting.
  setAttendanceVisible: (raceId, hidden) =>
    request(`/admin/races/${raceId}/attendance-visibility`, { method: "PUT", body: { hidden }, auth: true }),

  // Race Info page content (public read + admin edit)
  raceInfo: () => request("/settings/race-info"),
  adminRaceInfo: () => request("/admin/race-info", { auth: true }),
  saveRaceInfo: (content) => request("/admin/race-info", { method: "PUT", body: { content }, auth: true }),

  // Welcome-page FAQ (public read + admin edit)
  welcomeFaq: () => request("/settings/welcome-faq"),
  adminWelcomeFaq: () => request("/admin/welcome-faq", { auth: true }),
  saveWelcomeFaq: (content) => request("/admin/welcome-faq", { method: "PUT", body: { content }, auth: true }),

  // season-scoped reads by explicit season number (used by the admin editor)
  teamsForSeason: (n) => request(`/teams${seasonParam(n)}`),
  racesForSeason: (n) => request(`/races${seasonParam(n)}`),
};
