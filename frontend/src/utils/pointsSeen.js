// ---------------------------------------------------------------------------
// "You have scored since you last looked."
//
// A result goes in on Sunday evening and a driver's championship total quietly
// moves while nobody is watching. The number on their profile is then simply a
// different number than it was — nothing in the page says what changed, or
// that anything changed at all.
//
// This remembers the total THIS BROWSER was last shown for a standings row, so
// the next visit can open with a +25 instead of leaving the driver to work out
// the difference from memory. components/PointsGain.jsx plays it.
//
// Per browser rather than per account, deliberately: no column, no migration,
// no extra request on a page that already makes several, and it works for
// someone who never signs in on their laptop. The price is that a driver who
// opens the site on their phone and then their PC gets the flourish twice,
// which for a flourish is the right way round — twice beats never.
//
// The key is the STANDINGS ROW id, and a person holds one of those per season
// (and per league), so a gain in Season 5 can never surface on the Season 4
// page.
//
// One honest detail: what this measures is the move in the CHAMPIONSHIP TOTAL
// since the last visit, which is not always the points scored in the last
// race — a season with a drop rule can score a driver 18 points and lift their
// total by 4, and two races can pass between visits. "+4" is then the true
// answer to "what has changed for me", which is the question being asked.
// ---------------------------------------------------------------------------

const KEY = "nabs_points_seen_v1";

// One entry per driver row per season: a handful for somebody who only looks at
// their own page, a few dozen for somebody who reads every profile on the site.
// Past the cap the least recently seen go first.
export const MAX_ENTRIES = 120;

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {}; // private mode, or somebody edited it by hand
  }
}

function remember(all, id, points) {
  all[id] = { p: points, t: Date.now() };
  const ids = Object.keys(all);
  if (ids.length > MAX_ENTRIES) {
    ids
      .sort((a, b) => (all[a]?.t || 0) - (all[b]?.t || 0))
      .slice(0, ids.length - MAX_ENTRIES)
      .forEach((k) => delete all[k]);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage refused. The gain shows once more on the next visit, which is a
    // far better outcome than a page that throws.
  }
}

// What was decided for a row in THIS page session, so every copy of the number
// agrees. The profile scoreboard renders twice — a desktop column and a phone
// box, one of them hidden by CSS — and both have to reach the same verdict, or
// the answer would depend on the width of the window.
const decided = new Map();

// { from, gain, played }. `gain` is 0 when there is nothing to announce, and
// `from` is the total the driver last saw.
export function decideGain(id, points) {
  if (decided.has(id)) return decided.get(id);
  const all = readAll();
  const seen = typeof all[id]?.p === "number" ? all[id].p : null;
  // Only a rise is worth a flourish. A total that has FALLEN (a late penalty,
  // an admin correction, a round dropped by the drop rule) resets the memory
  // quietly: "−5" on your own profile is not a celebration, it is a question
  // for the Discord.
  const gain = seen != null && points > seen ? points - seen : 0;
  const out = { from: gain ? seen : null, gain, played: false };
  decided.set(id, out);
  // Recorded on FIRST SIGHT, not when the animation ends: whatever happens next
  // — the driver scrolls past, closes the tab, has motion switched off — this
  // number has now been put in front of them.
  remember(all, id, points);
  return out;
}

// Called when the sequence has finished, so leaving the page and coming back in
// the same visit doesn't replay it.
export function markGainPlayed(id) {
  const entry = decided.get(id);
  if (entry) entry.played = true;
}

// Forgets what this page session decided (not what the browser remembers).
export function resetGainSession() {
  decided.clear();
}
