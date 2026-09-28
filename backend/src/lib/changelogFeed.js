// ---------------------------------------------------------------------------
// The newer half of the changelog (/changelog), read from GitHub.
//
// The history up to the day the page went up is written out by hand in
// frontend/src/data/changelog.js. Everything after that comes from here, so
// nobody has to remember to edit a file on every update:
//
//   - The site's number is the commit count of main, read off GitHub.
//   - An entry is a merged pull request whose description has a "## Changelog"
//     section (see .github/pull_request_template.md). A PR without one is left
//     out, which is the point: a fix nobody needs to read about stays quiet.
//
// The repo is public, so none of this needs a key. GitHub allows 60 requests an
// hour without one; the answer is cached for an hour and a cold start costs two
// requests plus one per new entry, so it stays well under. GITHUB_TOKEN, if set,
// is sent along and lifts the limit. Any failure keeps the last good answer (or
// an empty one), and the page falls back to the file.
// ---------------------------------------------------------------------------

const REPO = process.env.CHANGELOG_REPO || "malteclaassen-create/nabs-racing";
const BRANCH = "main";
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 20;
const MAX_ITEMS = 10;
const MAX_TEXT = 300;
const MAX_TITLE = 80;

const TAGS = { new: "new", better: "better", improved: "better", fixed: "fixed", fix: "fixed" };

// The "## Changelog" section of a PR description, as { title, items }, or null
// when there is none or it is empty. Format:
//
//   ## Changelog
//   Title: Designs and changelog      (optional)
//   - New: You can now pick a design in the settings.
//   - Fixed: The series no longer resets on reload.
//   - A line without a tag counts as "Better".
//
// HTML comments (the template's hints) are ignored.
export function parseChangelogSection(body) {
  if (!body) return null;
  const text = String(body).replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^#{2,3}\s*changelog\s*$/i.test(l.trim()));
  if (start < 0) return null;
  let title = "";
  const items = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) break; // the next section
    if (!line) continue;
    const t = line.match(/^title\s*:\s*(.+)$/i);
    if (t) {
      title = clean(t[1]).slice(0, MAX_TITLE);
      continue;
    }
    const b = line.match(/^[-*]\s+(.+)$/);
    if (!b) continue;
    let rest = b[1];
    // The template's empty "- New:" lines, left as they were.
    if (/^(new|better|improved|fixed|fix)\s*:?\s*$/i.test(rest)) continue;
    let tag = "better";
    const m = rest.match(/^(new|better|improved|fixed|fix)\s*:\s*(.+)$/i);
    if (m) {
      tag = TAGS[m[1].toLowerCase()];
      rest = m[2];
    }
    const out = clean(rest).slice(0, MAX_TEXT);
    if (out) items.push({ tag, text: out });
    if (items.length >= MAX_ITEMS) break;
  }
  return items.length ? { title, items } : null;
}

// Markdown a driver should not see as symbols: bold, code ticks, links.
function clean(s) {
  return String(s)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// GitHub pages a list and says where the last page is in the Link header. With
// one item per page, the last page number IS the number of items.
export function lastPageFromLink(link) {
  const m = String(link || "").match(/[?&]page=(\d+)>;\s*rel="last"/);
  return m ? Number(m[1]) : null;
}

async function gh(path) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "nabs-racing-site" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res;
}

// How many commits a ref has (main, or the commit a PR was merged as).
async function commitCount(ref) {
  const res = await gh(`/commits?sha=${encodeURIComponent(ref)}&per_page=1`);
  const last = lastPageFromLink(res.headers.get("link"));
  if (last) return last;
  const list = await res.json();
  return Array.isArray(list) ? list.length : null;
}

// A merged commit never changes, so its count is kept for good.
const countBySha = new Map();

async function countFor(sha) {
  if (!sha) return null;
  if (countBySha.has(sha)) return countBySha.get(sha);
  const n = await commitCount(sha);
  if (n) countBySha.set(sha, n);
  return n;
}

async function load() {
  const commits = await commitCount(BRANCH);
  const res = await gh(`/pulls?state=closed&base=${BRANCH}&sort=updated&direction=desc&per_page=50`);
  const pulls = await res.json();
  const merged = (Array.isArray(pulls) ? pulls : [])
    .filter((p) => p?.merged_at)
    .sort((a, b) => String(b.merged_at).localeCompare(String(a.merged_at)));
  const entries = [];
  for (const p of merged) {
    const section = parseChangelogSection(p.body);
    if (!section) continue;
    let n = null;
    try {
      n = await countFor(p.merge_commit_sha);
    } catch {
      /* the entry still shows, just without its number */
    }
    entries.push({
      id: `pr-${p.number}`,
      date: String(p.merged_at).slice(0, 10),
      commits: n,
      title: section.title,
      items: section.items,
    });
    if (entries.length >= MAX_ENTRIES) break;
  }
  return { commits, entries };
}

let cache = null; // { at, data }
let pending = null;

export async function getChangelogFeed({ now = Date.now() } = {}) {
  if (cache && now - cache.at < TTL_MS) return cache.data;
  if (!pending) {
    pending = load()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .catch(() => {
        // Keep what we had, and try again at the next hour rather than on
        // every request while GitHub is down or the limit is spent.
        const data = cache?.data || { commits: null, entries: [] };
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
