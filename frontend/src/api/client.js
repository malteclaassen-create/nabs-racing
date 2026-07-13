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

const USER_TOKEN_KEY = "nabs_user_token";

// Token for admin routes: the PIN admin token wins; a designated Discord admin
// has no admin token, so fall back to their user token (the backend accepts it
// for admin routes when the account is a live-designated admin). EVERY admin
// call must use this — a bare getToken() breaks for Discord admins.
function adminAuthToken() {
  return getToken() || localStorage.getItem(USER_TOKEN_KEY);
}

// Where Discord should send the user back after login — always the current host
// (localhost in dev, the tunnel URL when shared). Must be registered in the
// Discord app's OAuth2 redirects.
function discordRedirectUri() {
  return `${window.location.origin}/auth/discord/callback`;
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
  if (extra) parts.push(extra);
  return parts.length ? `?${parts.join("&")}` : "";
}
// Query string for a read that may target an EXPLICIT season (e.g. the Welcome
// page always shows the active season regardless of the switcher). `null`/
// undefined falls back to the currently-selected season.
function seasonParam(n) {
  return n != null ? `?season=${n}` : seasonQ();
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

async function request(path, { method = "GET", body, auth = false, userAuth = false, form = false } = {}) {
  const headers = {};
  if (!form) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = adminAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  if (userAuth) {
    const ut = localStorage.getItem(USER_TOKEN_KEY);
    if (ut) headers["Authorization"] = `Bearer ${ut}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: form ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
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
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
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
  driverStandings: (season) => request(`/standings/drivers${seasonParam(season)}`, { auth: true }),
  // End-of-season honours (champion, awards) for the finished-season home hero.
  seasonHonours: (season) => request(`/standings/honours${seasonParam(season)}`, { auth: true }),
  // Races of an EXPLICIT season (e.g. the next-season teaser), regardless of
  // the season the site is currently viewing.
  racesFor: (n) => request(`/races?season=${n}`, { auth: true }),
  driverProfile: (id) => request(`/drivers/${id}/profile`, { auth: true }),
  driverRating: (id) => request(`/drivers/${id}/rating`, { auth: true }),
  t1Standings: (season) => request(`/standings/constructors/t1${seasonParam(season)}`, { auth: true }),
  t2Standings: (season) => request(`/standings/constructors/t2${seasonParam(season)}`, { auth: true }),
  races: (season) => request(`/races${seasonParam(season)}`, { auth: true }),
  raceResults: (id) => request(`/races/${id}/results`, { auth: true }),
  // Track history across all seasons (userAuth so a member gets their own record).
  trackHistory: (track) => request(`/tracks/history?track=${encodeURIComponent(track)}`, { userAuth: true }),
  teams: () => request(`/teams${seasonQ()}`, { auth: true }),
  seasons: () => request("/seasons", { auth: true }),
  // The next ANNOUNCED upcoming season for the "Coming up" strip (or null).
  seasonTeaser: () => request("/seasons/teaser"),
  // Live championship projection (only { active: true } while a league race is
  // running). auth:true so an admin's ?simulate demo request is recognised.
  liveChampionship: (simulate = false) =>
    request(`/live/championship${simulate ? "?simulate=1" : ""}`, { auth: true }),

  // events / RSVP (public; scoped to the viewed season, default active)
  events: () => request(`/events${seasonQ()}`, { auth: true }),
  rsvp: (raceId, driverId, status) =>
    request(`/events/${raceId}/rsvp`, { method: "POST", body: { driverId, status }, userAuth: true }),
  removeRsvp: (raceId, driverId) =>
    request(`/events/${raceId}/rsvp/${driverId}`, { method: "DELETE", userAuth: true }),

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
  // How the profile picture sits on the rating card ({x,y,z} or null = default).
  setMyCardPhoto: (pos) => request("/me/card-photo", { method: "PUT", body: { pos }, userAuth: true }),

  // driver market (identity from the Discord login). Season-scoped like
  // /events — without it, viewing another season shows that season's races
  // but the market of the ACTIVE one (the "Offer my seat" button vanished).
  market: () => request(`/market${seasonQ()}`, { userAuth: true }),
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

  // Live Timing page external links (public read + admin manage)
  liveLinks: () => request("/settings/live"),
  getLiveLinks: () => request("/admin/live-links", { auth: true }),
  setLiveLinks: (body) => request("/admin/live-links", { method: "PUT", body, auth: true }),

  // discord login. The redirect URI is derived from the current origin so login
  // works on localhost and over a tunnel without changing the backend .env.
  discordConfig: () =>
    request(`/auth/discord/config?redirect=${encodeURIComponent(discordRedirectUri())}`),
  discordCallback: (code) =>
    request("/auth/discord/callback", {
      method: "POST",
      body: { code, redirectUri: discordRedirectUri() },
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
    request("/admin/results/remote/import", { method: "POST", body: { id, season: getSelectedSeason() }, auth: true }),
  commitRace: (body) => request("/admin/races/commit", { method: "POST", body, auth: true }),
  editResults: (id, results) =>
    request(`/admin/races/${id}/results`, { method: "PUT", body: { results }, auth: true }),
  setDriverOfTheDay: (raceId, driverId, pickedBy) =>
    request(`/admin/races/${raceId}/driver-of-the-day`, { method: "PUT", body: { driverId, pickedBy }, auth: true }),
  // Live "what would change" preview for unsaved results (no DB writes).
  previewRace: (body) =>
    request("/admin/races/preview", { method: "POST", body: { ...body, season: getSelectedSeason() }, auth: true }),
  // Driver ratings with tunable weights — powers the admin ratings panel.
  ratingsPreview: (weights) =>
    request("/admin/ratings/preview", { method: "POST", body: { weights, season: getSelectedSeason() }, auth: true }),
  ratingsWeights: () => request("/admin/ratings/weights", { auth: true }),
  saveRatingsWeights: (weights) =>
    request("/admin/ratings/weights", { method: "PUT", body: { weights }, auth: true }),
  createDriver: (body) => request("/admin/drivers", { method: "POST", body, auth: true }),
  updateDriver: (id, body) => request(`/admin/drivers/${id}`, { method: "PUT", body, auth: true }),
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
  getResultsPost: (raceId) => request(`/admin/races/${raceId}/results-post`, { auth: true }),
  sendResultsPost: (raceId, content) =>
    request(`/admin/races/${raceId}/results-post`, { method: "POST", body: { content }, auth: true }),
  createEvent: (body) => request("/admin/events", { method: "POST", body, auth: true }),
  updateEvent: (id, body) => request(`/admin/events/${id}`, { method: "PUT", body, auth: true }),
  announceEvent: (id) => request(`/admin/events/${id}/announce`, { method: "POST", auth: true }),
  // force: also deletes a race that already has results (Edit-Results editor);
  // the backend writes a backup first.
  deleteEvent: (id, { force = false } = {}) =>
    request(`/admin/events/${id}${force ? "?force=1" : ""}`, { method: "DELETE", auth: true }),

  // seasons + teams (admin)
  adminSeasons: () => request("/admin/seasons", { auth: true }),
  createSeason: (body) => request("/admin/seasons", { method: "POST", body, auth: true }),
  updateSeason: (id, body) => request(`/admin/seasons/${id}`, { method: "PUT", body, auth: true }),
  deleteSeason: (id, force = false) =>
    request(`/admin/seasons/${id}${force ? "?force=1" : ""}`, { method: "DELETE", auth: true }),
  activateSeason: (id) => request(`/admin/seasons/${id}/activate`, { method: "POST", auth: true }),
  cloneTeams: (id, fromSeasonId) =>
    request(`/admin/seasons/${id}/clone-teams`, { method: "POST", body: { fromSeasonId }, auth: true }),
  cloneRoster: (id, fromSeasonId) =>
    request(`/admin/seasons/${id}/clone-roster`, { method: "POST", body: { fromSeasonId }, auth: true }),

  // health (admin): integrity check, backups, activity log
  integrity: () => request(`/admin/integrity${seasonQ()}`, { auth: true }),
  backups: () => request("/admin/backups", { auth: true }),
  createBackup: () => request("/admin/backups", { method: "POST", auth: true }),
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
  createTeam: (body) => request("/admin/teams", { method: "POST", body, auth: true }),
  updateTeam: (id, body) => request(`/admin/teams/${id}`, { method: "PUT", body, auth: true }),
  deleteTeam: (id) => request(`/admin/teams/${id}`, { method: "DELETE", auth: true }),
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
  deleteDownload: (id) => request(`/admin/downloads/${id}`, { method: "DELETE", auth: true }),

  // download folders (admin)
  createDownloadFolder: (body) => request("/admin/download-folders", { method: "POST", body, auth: true }),
  updateDownloadFolder: (id, body) => request(`/admin/download-folders/${id}`, { method: "PATCH", body, auth: true }),
  deleteDownloadFolder: (id) => request(`/admin/download-folders/${id}`, { method: "DELETE", auth: true }),

  // Track info (admin): fun facts + custom map image per circuit
  adminTrackInfo: (key) => request(`/admin/tracks/${key}/info`, { auth: true }),
  saveTrackInfo: (key, content) => request(`/admin/tracks/${key}/info`, { method: "PUT", body: { content }, auth: true }),
  uploadTrackMap: (key, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/tracks/${key}/map`, { method: "POST", body: fd, auth: true, form: true });
  },
  clearTrackMap: (key) => request(`/admin/tracks/${key}/map`, { method: "DELETE", auth: true }),

  // Race Info page content (public read + admin edit)
  raceInfo: () => request("/settings/race-info"),
  adminRaceInfo: () => request("/admin/race-info", { auth: true }),
  saveRaceInfo: (content) => request("/admin/race-info", { method: "PUT", body: { content }, auth: true }),

  // Welcome-page FAQ (public read + admin edit)
  welcomeFaq: () => request("/settings/welcome-faq"),
  adminWelcomeFaq: () => request("/admin/welcome-faq", { auth: true }),
  saveWelcomeFaq: (content) => request("/admin/welcome-faq", { method: "PUT", body: { content }, auth: true }),

  // season-scoped reads by explicit season number (used by the admin editor)
  teamsForSeason: (n) => request(`/teams?season=${n}`),
  racesForSeason: (n) => request(`/races?season=${n}`),
};
