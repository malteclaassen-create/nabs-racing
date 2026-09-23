// ---------------------------------------------------------------------------
// The round the admin is working on, shared by the race-weekend tabs.
//
// A race night is one round worked through several tabs: import it, fix the
// classification, post the result graphic, put up the photos and the
// highlights cut. Each of those tabs had a round picker of its own that opened
// on "Choose a round…", so the same round was picked five times an evening,
// and a slip of the finger in one of them meant photos on the wrong race.
//
// Whatever round was last picked in any of them is remembered (per browser
// tab, per season) and offered by the next one. With nothing remembered each
// tab starts on the most recent race that has actually been run, which is the
// one a race night is about nine times out of ten.
//
// Pure apart from the storage, which is passed in, so node can test it.
// ---------------------------------------------------------------------------

const KEY_PREFIX = "nabs_admin_round:";

function storageOf(storage) {
  if (storage) return storage;
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    // Storage switched off (private mode in some browsers): nothing is
    // remembered, and every tab falls back to its own default.
    return null;
  }
}

// The round last picked in this season, or null.
export function recallRound(seasonKey, storage) {
  if (!seasonKey) return null;
  try {
    return storageOf(storage)?.getItem(KEY_PREFIX + seasonKey) || null;
  } catch {
    return null;
  }
}

// Remember a picked round. An empty pick ("Choose a round…") is not a choice
// of a round and leaves the memory alone.
export function rememberRound(seasonKey, raceId, storage) {
  if (!seasonKey || !raceId) return;
  try {
    storageOf(storage)?.setItem(KEY_PREFIX + seasonKey, String(raceId));
  } catch {
    /* storage full or switched off: the next tab simply falls back */
  }
}

// The most recent race whose date has passed, or null. `completedOnly` narrows
// it to races marked as run: the tabs that work on a result (edit, content,
// photos, highlights, recap) have nothing to do with a round that was never
// imported, while the import is exactly for such a round.
export function latestPastRace(races, { now = Date.now(), completedOnly = false } = {}) {
  let best = null;
  let bestAt = -Infinity;
  for (const r of races || []) {
    if (!r?.id || !r.date) continue;
    if (completedOnly && !r.isCompleted) continue;
    const at = Date.parse(r.date);
    if (!Number.isFinite(at) || at > now) continue;
    if (at > bestAt) {
      best = r;
      bestAt = at;
    }
  }
  return best;
}

// Which round a tab opens on. `ids` are the values its own picker offers; a
// remembered round from another tab is only taken when it is one of them (the
// recap preview has no training sessions, Content has no rounds without a
// result), otherwise the tab's own default applies.
export function initialRound({ ids, remembered, fallbackId }) {
  const offered = new Set(ids || []);
  if (remembered && offered.has(remembered)) return remembered;
  if (fallbackId && offered.has(fallbackId)) return fallbackId;
  return "";
}
