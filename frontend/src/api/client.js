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

const USER_TOKEN_KEY = "nabs_user_token";

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
    throw err;
  }
  return data;
}

export const api = {
  // public (season-scoped reads honour the selected season)
  driverStandings: () => request(`/standings/drivers${seasonQ()}`),
  driverProfile: (id) => request(`/drivers/${id}/profile`),
  t1Standings: () => request(`/standings/constructors/t1${seasonQ()}`),
  t2Standings: () => request(`/standings/constructors/t2${seasonQ()}`),
  races: () => request(`/races${seasonQ()}`),
  raceResults: (id) => request(`/races/${id}/results`),
  teams: () => request(`/teams${seasonQ()}`),
  seasons: () => request("/seasons"),

  // events / RSVP (public)
  events: () => request("/events"),
  rsvp: (raceId, driverId, status) =>
    request(`/events/${raceId}/rsvp`, { method: "POST", body: { driverId, status }, userAuth: true }),
  removeRsvp: (raceId, driverId) =>
    request(`/events/${raceId}/rsvp/${driverId}`, { method: "DELETE", userAuth: true }),

  // logged-in driver self-service
  me: () => request("/me", { userAuth: true }),
  setMyCountry: (country) => request("/me/country", { method: "PUT", body: { country }, userAuth: true }),

  // discord login
  discordConfig: () => request("/auth/discord/config"),
  discordCallback: (code) => request("/auth/discord/callback", { method: "POST", body: { code } }),

  // admin
  login: (pin) => request("/admin/login", { method: "POST", body: { pin } }),
  importRace: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request("/admin/races/import", { method: "POST", body: fd, auth: true, form: true });
  },
  remoteResults: (type = "RACE") => request(`/admin/results/remote?type=${type}`, { auth: true }),
  importRemoteResult: (id) =>
    request("/admin/results/remote/import", { method: "POST", body: { id }, auth: true }),
  commitRace: (body) => request("/admin/races/commit", { method: "POST", body, auth: true }),
  editResults: (id, results) =>
    request(`/admin/races/${id}/results`, { method: "PUT", body: { results }, auth: true }),
  // Live "what would change" preview for unsaved results (no DB writes).
  previewRace: (body) =>
    request("/admin/races/preview", { method: "POST", body: { ...body, season: getSelectedSeason() }, auth: true }),
  createDriver: (body) => request("/admin/drivers", { method: "POST", body, auth: true }),
  updateDriver: (id, body) => request(`/admin/drivers/${id}`, { method: "PUT", body, auth: true }),
  changePin: (newPin) =>
    request("/admin/settings/pin", { method: "PUT", body: { newPin }, auth: true }),

  // discord + events (admin)
  getWebhook: () => request("/admin/discord/webhook", { auth: true }),
  setWebhook: (url) => request("/admin/discord/webhook", { method: "PUT", body: { url }, auth: true }),
  testWebhook: () => request("/admin/discord/test", { method: "POST", auth: true }),
  createEvent: (body) => request("/admin/events", { method: "POST", body, auth: true }),
  announceEvent: (id) => request(`/admin/events/${id}/announce`, { method: "POST", auth: true }),
  deleteEvent: (id) => request(`/admin/events/${id}`, { method: "DELETE", auth: true }),

  // seasons + teams (admin)
  adminSeasons: () => request("/admin/seasons", { auth: true }),
  createSeason: (body) => request("/admin/seasons", { method: "POST", body, auth: true }),
  updateSeason: (id, body) => request(`/admin/seasons/${id}`, { method: "PUT", body, auth: true }),
  activateSeason: (id) => request(`/admin/seasons/${id}/activate`, { method: "POST", auth: true }),
  cloneTeams: (id, fromSeasonId) =>
    request(`/admin/seasons/${id}/clone-teams`, { method: "POST", body: { fromSeasonId }, auth: true }),
  createTeam: (body) => request("/admin/teams", { method: "POST", body, auth: true }),
  updateTeam: (id, body) => request(`/admin/teams/${id}`, { method: "PUT", body, auth: true }),
  deleteTeam: (id) => request(`/admin/teams/${id}`, { method: "DELETE", auth: true }),
  uploadTeamLogo: (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/admin/teams/${id}/logo`, { method: "POST", body: fd, auth: true, form: true });
  },

  // season-scoped reads by explicit season number (used by the admin editor)
  teamsForSeason: (n) => request(`/teams?season=${n}`),
  racesForSeason: (n) => request(`/races?season=${n}`),
};
