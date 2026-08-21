// ---------------------------------------------------------------------------
// What has actually been happening at the telemetry ingest.
//
// Written after an evening of guessing. The recording half is deliberately
// silent from end to end — the in-game script draws nothing, a refused post is
// answered with a status code the script logs to its own debug console and
// forgets, and the site wrote nothing down at all. So "no laps on the page"
// had the same appearance whether the race server never handed the script out,
// the key had been re-minted underneath it, or the cars were posting fine and
// simply nobody had set a clean lap yet. Three very different problems, one
// empty page, and no way to tell them apart without a person on a voice call
// reading a server config aloud.
//
// This is the cheapest thing that ends that: a counter per outcome and the
// last few events, in memory, read by one admin card. It is not a log file and
// not an audit trail — a process restart empties it, which is fine, because
// the question it answers ("is anything arriving RIGHT NOW") is about the last
// few minutes, and the disk answers the longer one.
//
// WHY THE SCRIPT DOWNLOAD IS COUNTED TOO, and it is the more useful of the two
// numbers: the driver's game fetches /app.lua when they join a server that
// carries the snippet. So a download proves the whole chain up to the car —
// server config, restart, CSP, key. No downloads and no laps means the problem
// is on the server. Downloads but no laps means the problem is in the car.
// That single split is most of what this file exists for.
//
// Nothing identifying is kept. No Steam ids, no addresses, no key — a driver
// name and a track, which the card next to this already shows anyway.
// ---------------------------------------------------------------------------

// The outcomes worth telling apart, each with the line the card prints for it.
// Everything the ingest and the script route can do ends up as exactly one of
// these, so a new branch there without an entry here is a visible gap rather
// than a silent one.
export const OUTCOMES = {
  "script-served": "Script handed to a car",
  "script-refused": "Script refused — wrong key, or recording is off",
  "lap-kept": "Lap stored",
  "lap-slower": "Lap arrived, not stored (slower than the three kept)",
  "lap-refused": "Lap refused",
  // The recorder speaking from inside a car: proof of life on its first tick,
  // and the fate of every finished lap it chose not to send. These two are
  // what split "no clean lap yet" from "the recorder is broken" — the one
  // split the counters above cannot make.
  "car-alive": "Recorder started in a car",
  "car-skipped": "Lap finished in the car, not sent",
  ping: "Connection test",
  "bad-key": "Post refused — wrong key",
  off: "Post refused — recording is switched off",
  flooded: "Post refused — too many at once",
};

// How many events are kept. Small on purpose: this is read by a human looking
// for a pattern in the last few minutes, and forty lines is already more than
// anybody scrolls. The counters carry the totals, so nothing is lost by
// forgetting the middle.
const KEEP_EVENTS = 40;

const startedAt = new Date().toISOString();
let events = [];
const counts = new Map();
const lastAt = new Map();

// Record one thing that happened. Never throws and never blocks: a diagnostic
// that can break the feature it reports on is worse than no diagnostic.
//
// `detail` is the reason for a refusal ("Bad steamId"), `name`/`track`/
// `lapTimeMs` describe a lap when there is one to describe.
export function recordTelemetryEvent(outcome, extra = {}) {
  try {
    if (!OUTCOMES[outcome]) return;
    const at = new Date().toISOString();
    counts.set(outcome, (counts.get(outcome) || 0) + 1);
    lastAt.set(outcome, at);
    events.push({
      at,
      outcome,
      detail: extra.detail ? String(extra.detail).slice(0, 120) : null,
      name: extra.name ? String(extra.name).slice(0, 64) : null,
      track: extra.track ? String(extra.track).slice(0, 80) : null,
      lapTimeMs: Number.isFinite(Number(extra.lapTimeMs)) ? Number(extra.lapTimeMs) : null,
    });
    if (events.length > KEEP_EVENTS) events = events.slice(-KEEP_EVENTS);
  } catch {
    /* a diagnostic must never be the reason a lap is lost */
  }
}

// Everything the admin card needs, newest event first.
//
// `since` is the process start, and the card says so: "nothing since 14:02"
// means nothing since the site last restarted, which on a host that redeploys
// is a different sentence from "nothing ever".
export function readTelemetryActivity() {
  const out = {};
  for (const key of Object.keys(OUTCOMES)) {
    out[key] = { count: counts.get(key) || 0, lastAt: lastAt.get(key) || null };
  }
  return {
    since: startedAt,
    outcomes: out,
    // Laps that ARRIVED, however they ended up — the number that answers "is
    // the car posting". A lap that was too slow to keep is still a lap that
    // arrived, and reading it as a failure sent us hunting once already.
    lapsArrived: (counts.get("lap-kept") || 0) + (counts.get("lap-slower") || 0),
    scriptsServed: counts.get("script-served") || 0,
    events: [...events].reverse(),
  };
}

// Test seam. Nothing in the app calls this — the counters are meant to live as
// long as the process does.
export function resetTelemetryActivity() {
  events = [];
  counts.clear();
  lastAt.clear();
}
