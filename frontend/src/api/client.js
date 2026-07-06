// Tiny fetch wrapper for the NABS API. In dev, Vite proxies /api -> :4000.
const BASE = import.meta.env.VITE_API_BASE || "";

const TOKEN_KEY = "nabs_admin_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
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

async function request(path, { method = "GET", body, auth = false, userAuth = false, form = false } = {}) {
  const headers = {};
  if (!form) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
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
    // to the login screen instead of pretending we're still signed in.
    if (res.status === 401 && auth) {
      setToken(null);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("nabs-admin-unauthorized"));
      }
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
  driverStandings: (season) => request(`/standings/drivers${seasonParam(season)}`),
  // Races of an EXPLICIT season (e.g. the next-season teaser), regardless of
  // the season the site is currently viewing.
  racesFor: (n) => request(`/races?season=${n}`),
  driverProfile: (id) => request(`/drivers/${id}/profile`),
  driverRating: (id) => request(`/drivers/${id}/rating`),
  t1Standings: (season) => request(`/standings/constructors/t1${seasonParam(season)}`),
  t2Standings: (season) => request(`/standings/constructors/t2${seasonParam(season)}`),
  races: (season) => request(`/races${seasonParam(season)}`),
  raceResults: (id) => request(`/races/${id}/results`),
  teams: () => request(`/teams${seasonQ()}`),
  seasons: () => request("/seasons"),

  // events / RSVP (public; scoped to the viewed season, default active)
  events: () => request(`/events${seasonQ()}`),
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

  // driver market (identity from the Discord login)
  market: () => request("/market", { userAuth: true }),
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

  // social links (public read + admin manage)
  socialLinks: () => request("/settings/social"),
  getSocial: () => request("/admin/social", { auth: true }),
  setSocial: (body) => request("/admin/social", { method: "PUT", body, auth: true }),

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
  // Live "what would change" preview for unsaved results (no DB writes).
  previewRace: (body) =>
    request("/admin/races/preview", { method: "POST", body: { ...body, season: getSelectedSeason() }, auth: true }),
  // Driver ratings with tunable weights — powers the admin ratings panel.
  ratingsPreview: (weights) =>
    request("/admin/ratings/preview", { method: "POST", body: { weights, season: getSelectedSeason() }, auth: true }),
  createDriver: (body) => request("/admin/drivers", { method: "POST", body, auth: true }),
  updateDriver: (id, body) => request(`/admin/drivers/${id}`, { method: "PUT", body, auth: true }),
  changePin: (newPin) =>
    request("/admin/settings/pin", { method: "PUT", body: { newPin }, auth: true }),
  adminSecurity: () => request("/admin/security", { auth: true }),

  // discord + events (admin)
  getWebhook: () => request("/admin/discord/webhook", { auth: true }),
  setWebhook: (url) => request("/admin/discord/webhook", { method: "PUT", body: { url }, auth: true }),
  testWebhook: () => request("/admin/discord/test", { method: "POST", auth: true }),
  createEvent: (body) => request("/admin/events", { method: "POST", body, auth: true }),
  updateEvent: (id, body) => request(`/admin/events/${id}`, { method: "PUT", body, auth: true }),
  announceEvent: (id) => request(`/admin/events/${id}/announce`, { method: "POST", auth: true }),
  deleteEvent: (id) => request(`/admin/events/${id}`, { method: "DELETE", auth: true }),

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
  createDriverFromMember: (discordId, body) =>
    request(`/admin/members/${discordId}/create-driver`, { method: "POST", body, auth: true }),

  // downloads (admin)
  adminDownloads: () => request("/admin/downloads", { auth: true }),
  createDownload: (body) => request("/admin/downloads", { method: "POST", body, auth: true }),
  updateDownload: (id, body) => request(`/admin/downloads/${id}`, { method: "PATCH", body, auth: true }),
  deleteDownload: (id) => request(`/admin/downloads/${id}`, { method: "DELETE", auth: true }),

  // download folders (admin)
  createDownloadFolder: (body) => request("/admin/download-folders", { method: "POST", body, auth: true }),
  updateDownloadFolder: (id, body) => request(`/admin/download-folders/${id}`, { method: "PATCH", body, auth: true }),
  deleteDownloadFolder: (id) => request(`/admin/download-folders/${id}`, { method: "DELETE", auth: true }),

  // Race Info page content (public read + admin edit)
  raceInfo: () => request("/settings/race-info"),
  adminRaceInfo: () => request("/admin/race-info", { auth: true }),
  saveRaceInfo: (content) => request("/admin/race-info", { method: "PUT", body: { content }, auth: true }),

  // season-scoped reads by explicit season number (used by the admin editor)
  teamsForSeason: (n) => request(`/teams?season=${n}`),
  racesForSeason: (n) => request(`/races?season=${n}`),
};
