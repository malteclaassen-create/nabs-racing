// Fetch finished race results straight from the Assetto Corsa Server Manager
// (Emperor Servers). The manager stores every session as a downloadable JSON in
// the exact same format the admin uploads manually — and these reflect any
// penalties applied afterwards. So we can list them and feed the chosen one
// through the existing AC parser, skipping the manual file export/upload.
//
//   listing:  GET <base>/results?page=N   (paginated HTML; each row carries the
//                                           id, date, session type and track)
//   download: GET <base>/results/download/<id>.json
const BASE = (process.env.EMPEROR_RESULTS_BASE || "https://nabs1.emperorservers.com").replace(/\/$/, "");
const MAX_PAGES = Number(process.env.EMPEROR_RESULTS_MAX_PAGES || 40);
const CACHE_MS = 5 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_]+$/;

let cache = { ts: 0, rows: null };

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

// "2026_6_12_18_58_RACE" -> { id, type, ts, date(ISO) }
function parseId(id) {
  const parts = id.split("_");
  const type = parts[parts.length - 1];
  const [y, mo, d, h, mi] = parts.slice(0, 5).map(Number);
  const ts = [y, mo, d, h, mi].every((n) => Number.isFinite(n)) ? Date.UTC(y, mo - 1, d, h, mi) : null;
  return { id, type, ts, date: ts != null ? new Date(ts).toISOString() : null };
}

const stripTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Parse the result rows out of one listing page.
function parseRows(html) {
  const rows = [];
  const rowRe = /<tr class="row-link"[^>]*data-href="\/results\/([A-Za-z0-9_]+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const id = m[1];
    const cells = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1]));
    const track = cells[2] || "";
    rows.push({
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

// Scrape every listing page (cached) and return all result rows, newest first.
async function getAllRows() {
  if (cache.rows && Date.now() - cache.ts < CACHE_MS) return cache.rows;

  const first = await fetchWithTimeout(`${BASE}/results?page=1`);
  const pages = lastPage(first);
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      fetchWithTimeout(`${BASE}/results?page=${i + 2}`).catch(() => "")
    )
  );

  const byId = new Map();
  for (const html of [first, ...rest]) {
    for (const r of parseRows(html)) if (!byId.has(r.id)) byId.set(r.id, r);
  }
  const rows = [...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  cache = { ts: Date.now(), rows };
  return rows;
}

// List results (default: RACE sessions only — all of them, newest first).
export async function listRemoteResults({ type = "RACE", limit = 250 } = {}) {
  const all = await getAllRows();
  const list = type ? all.filter((r) => r.type === type) : all;
  return list.slice(0, limit);
}

// Download one result's raw AC JSON.
export async function fetchRemoteResult(id) {
  if (!ID_RE.test(id)) throw new Error("Invalid result id");
  return fetchWithTimeout(`${BASE}/results/download/${id}.json`, { json: true });
}

export const EMPEROR_BASE = BASE;
