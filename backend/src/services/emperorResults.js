// Fetch finished race results straight from the Assetto Corsa Server Manager
// (Emperor Servers). The manager stores every session as a downloadable JSON in
// the exact same format the admin uploads manually — and these reflect any
// penalties applied afterwards. So we can list them and feed the chosen one
// through the existing AC parser, skipping the manual file export/upload.
//
// The league runs more than one server, so every server in LIVE_SERVERS is
// listed and each row says which one it came from. A result is referred to
// as "<serverKey>:<sessionId>" (e.g. "nabs2:2026_6_12_18_58_RACE"); a bare
// session id still means the first server, as it always did.
//
//   listing:  GET <origin>/results?page=N   (paginated HTML; each row carries
//                                             the id, date, session type, track)
//   download: GET <origin>/results/download/<id>.json
import { LIVE_SERVERS, DEFAULT_SERVER_KEY } from "../lib/liveServers.js";

const MAX_PAGES = Number(process.env.EMPEROR_RESULTS_MAX_PAGES || 40);
const CACHE_MS = 5 * 60 * 1000;
const SESSION_ID_RE = /^[A-Za-z0-9_]+$/;
export const RESULT_REF_RE = /^(?:[a-z0-9]+:)?[A-Za-z0-9_]+$/;

// Where each server's manager answers. EMPEROR_RESULTS_BASE keeps overriding
// the first server's address, as before the second server existed.
function serverOrigins() {
  return LIVE_SERVERS.map((s, i) => ({
    key: s.key,
    name: s.name,
    origin: ((i === 0 && process.env.EMPEROR_RESULTS_BASE) || s.origin).replace(/\/$/, ""),
  }));
}

const cache = new Map(); // serverKey -> { ts, rows }

async function fetchWithTimeout(url, { json = false, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: json ? "application/json" : "text/html" } });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    return json ? res.json() : res.text();
  } finally {
    clearTimeout(t);
  }
}

// "2026_6_12_18_58_RACE" -> { sessionId, type, ts, date(ISO) }
function parseId(id) {
  const parts = id.split("_");
  const type = parts[parts.length - 1];
  const [y, mo, d, h, mi] = parts.slice(0, 5).map(Number);
  const ts = [y, mo, d, h, mi].every((n) => Number.isFinite(n)) ? Date.UTC(y, mo - 1, d, h, mi) : null;
  return { sessionId: id, type, ts, date: ts != null ? new Date(ts).toISOString() : null };
}

const stripTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Parse the result rows out of one listing page.
function parseRows(html, server) {
  const rows = [];
  const rowRe = /<tr class="row-link"[^>]*data-href="\/results\/([A-Za-z0-9_]+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const id = m[1];
    const cells = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1]));
    const track = cells[2] || "";
    rows.push({
      id: `${server.key}:${id}`,
      server: server.key,
      serverName: server.name,
      ...parseId(id),
      dateStr: cells[0] || "",
      track, // full "Track - Pack - Community"
      trackShort: track.split(" - ")[0] || track, // just the circuit
    });
  }
  return rows;
}

// Highest page number referenced by the pagination links (clamped).
function lastPage(html) {
  const nums = [...html.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1]));
  const max = nums.length ? Math.max(...nums) : 1;
  return Math.min(Math.max(max, 1), MAX_PAGES);
}

// Scrape every listing page of one server (cached) and return its rows.
async function getServerRows(server) {
  const hit = cache.get(server.key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.rows;

  // NOTE: on this server the page param is offset by one — the bare /results
  // page (no ?page) is the NEWEST set, and ?page=1 is already the *second*
  // page. So fetch the bare page first, then ?page=1..lastPage; otherwise the
  // ~25 most recent sessions (newest races) are silently skipped.
  const first = await fetchWithTimeout(`${server.origin}/results`);
  const pages = lastPage(first);
  const rest = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetchWithTimeout(`${server.origin}/results?page=${i + 1}`).catch(() => "")
    )
  );

  const byId = new Map();
  for (const html of [first, ...rest]) {
    for (const r of parseRows(html, server)) if (!byId.has(r.id)) byId.set(r.id, r);
  }
  const rows = [...byId.values()];
  cache.set(server.key, { ts: Date.now(), rows });
  return rows;
}

// All servers' rows, newest first. One server being down does not hide the
// others' races; only when none answers is that an error.
async function getAllRows() {
  const servers = serverOrigins();
  const settled = await Promise.allSettled(servers.map(getServerRows));
  const rows = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!rows.length) {
    const failed = settled.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
  }
  return rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// List results (default: RACE sessions only — all of them, newest first).
export async function listRemoteResults({ type = "RACE", limit = 250 } = {}) {
  const all = await getAllRows();
  const list = type ? all.filter((r) => r.type === type) : all;
  return list.slice(0, limit);
}

// "<serverKey>:<sessionId>" or a bare session id (first server).
function splitRef(ref) {
  const s = String(ref || "");
  const i = s.indexOf(":");
  const key = i > 0 ? s.slice(0, i) : DEFAULT_SERVER_KEY;
  const sessionId = i > 0 ? s.slice(i + 1) : s;
  const server = serverOrigins().find((x) => x.key === key);
  if (!server || !SESSION_ID_RE.test(sessionId)) throw new Error("Invalid result id");
  return { server, sessionId };
}

// Download one result's raw AC JSON.
export async function fetchRemoteResult(ref) {
  const { server, sessionId } = splitRef(ref);
  return fetchWithTimeout(`${server.origin}/results/download/${sessionId}.json`, { json: true });
}

