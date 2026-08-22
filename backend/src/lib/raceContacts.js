// ---------------------------------------------------------------------------
// Every car-to-car contact of a round, as something a person can point at.
//
// Assetto Corsa records them all and the raw result JSON is kept on disk
// (lib/resultsArchive.js), so the moment somebody wants to report an incident
// the league already knows what happened, when, to whom and how hard. What was
// missing was a way to SAY WHICH ONE: a report saying "he hit me at the
// hairpin" sends a steward hunting through a forty-minute replay.
//
// Each event in the file carries the two drivers (with their Steam GUIDs),
// the impact speed, a world position and a unix timestamp. The laps carry
// timestamps on the same scale, which is what lets a contact be placed on a
// LAP as well as a clock time.
//
// The clock time matters more than it looks: the league's in-game reporting
// app (webPenalty) writes the session's real start time into the replay file
// and shows the original wall-clock time of whatever frame is being watched.
// So "21:04:11" is not trivia, it is the number a steward scrubs to.
//
// Filtering follows the contact STAT the site already publishes
// (services/telemetryExtractor.js) — repeated hits between the same pair
// inside the merge window count once, and anything after the flag is ignored —
// with one deliberate difference: light taps are KEPT here. The stat counts
// incidents and a 6 km/h brush should not cost anybody a rating point, but
// this list exists to find the moment a report is about, and the tap that
// barely registered on the file is often exactly the shove the driver pressed
// the button over. A contact missing from this list cannot be matched,
// suggested or pinned at all, which proved worse than a longer list.
// ---------------------------------------------------------------------------
import { findArchiveFor } from "./cockpitArchive.js";
import { CONTACT_DEFAULTS } from "../services/telemetryExtractor.js";

// AC writes timestamps as unix seconds on events and laps alike.
const tsOf = (x) => {
  const n = Number(x?.Timestamp);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Where the REPLAY starts, which is what "N seconds into the race" has to be
// measured from if a steward is going to drag a timeline to it.
//
// Not the green flag. An AC race session begins with `wait_time` seconds of
// grid and formation, and the replay records all of it, so the flag is already
// some minutes into the file. Anchoring on the first thing that happens ON
// TRACK put every figure short by exactly that wait: 0:13 for an incident a
// replay holds at 5:09.
//
// The formula is the one TeTeMaTeTe's replayTools uses, and the league already
// runs that app: first lap's crossing, minus how long that lap took, minus the
// wait. Matching it means our numbers and the numbers in that app's own event
// list agree, so a steward can work from either.
//
// The old earliest-thing-in-the-file method stays as the fallback for a round
// whose file has no laps or no SessionConfig; a figure measured from the green
// flag is better than none, and it is never wrong by more than the wait.
function sessionStart(data) {
  const firstLap = (data.Laps || []).find((l) => tsOf(l));
  const wait = Number(data.SessionConfig?.wait_time);
  if (firstLap && Number.isFinite(wait)) {
    return Math.round(tsOf(firstLap) - (Number(firstLap.LapTime) || 0) / 1000 - wait);
  }

  const stamps = [];
  for (const e of data.Events || []) {
    const t = tsOf(e);
    if (t) stamps.push(t);
  }
  for (const l of data.Laps || []) {
    const t = tsOf(l);
    if (t) stamps.push(t - Math.round((Number(l.LapTime) || 0) / 1000));
  }
  return stamps.length ? Math.min(...stamps) : null;
}

// Which lap a driver was on at that moment: how many they had finished, plus
// one. Their own laps, because a backmarker is not on the leader's lap.
function lapAt(lapsOfDriver, at) {
  let done = 0;
  for (const t of lapsOfDriver) if (t <= at) done += 1;
  return done + 1;
}

// Every contact of one round, both sides of each one, newest rules applied.
// Returns [] when the round has no archived file (a hand-entered archive
// round, or an import from before the archive existed) — the caller shows the
// plain form and nobody sees an error about a file they have never heard of.
// A handful of rounds' reduced results, so opening a report list doesn't
// re-read and re-parse a multi-megabyte AC result file per report. The REDUCED
// shape is cached, never the raw JSON — holding those would undo the memory
// work the site did elsewhere. Small and bounded: a steward works through one
// round at a time, and a stale entry can only exist if a round is re-imported,
// which restarts the server anyway.
const ROUND_CACHE_MAX = 8;
const roundCache = new Map();

export function contactsForRound(seasonNumber, raceNumber) {
  const cacheKey = `${seasonNumber}|${raceNumber}`;
  const hit = roundCache.get(cacheKey);
  if (hit) {
    // Re-insert so the most recently used round is the last to be evicted.
    roundCache.delete(cacheKey);
    roundCache.set(cacheKey, hit);
    return hit;
  }
  const built = buildRound(seasonNumber, raceNumber);
  roundCache.set(cacheKey, built);
  if (roundCache.size > ROUND_CACHE_MAX) roundCache.delete(roundCache.keys().next().value);
  return built;
}

// When the round's session started, as unix seconds, or null when the round has
// no archived result file. The anchor that turns an absolute moment into
// "N seconds into the race", which is the one figure a replay can be scrubbed
// to without knowing anybody's timezone.
export function sessionStartForRound(seasonNumber, raceNumber) {
  return contactsForRound(seasonNumber, raceNumber).start;
}

function buildRound(seasonNumber, raceNumber) {
  let data;
  try {
    data = findArchiveFor(seasonNumber, raceNumber);
  } catch {
    return { archived: false, start: null, contacts: [] };
  }
  if (!data) return { archived: false, start: null, contacts: [] };

  const start = sessionStart(data);

  // Laps per driver, sorted, for the lap lookup.
  const lapsByGuid = new Map();
  for (const l of data.Laps || []) {
    const t = tsOf(l);
    if (!t || !l.DriverGuid) continue;
    if (!lapsByGuid.has(l.DriverGuid)) lapsByGuid.set(l.DriverGuid, []);
    lapsByGuid.get(l.DriverGuid).push(t);
  }
  for (const arr of lapsByGuid.values()) arr.sort((a, b) => a - b);

  // The position in the file is captured BEFORE anything is thrown away,
  // because that position is the one number the league's replay app puts in
  // front of every incident it lists. It counts every event in the file, taps
  // and walls included, so it cannot be recovered from our own filtered list
  // afterwards. See `eventIndex` below.
  const raw = (data.Events || [])
    .map((e, i) => ({ e, n: i + 1 }))
    .filter(
      ({ e }) =>
        e?.Type === "COLLISION_WITH_CAR" &&
        !e.AfterSessionEnd &&
        e.Driver?.Guid &&
        e.OtherDriver?.Guid &&
        tsOf(e)
    )
    .sort((x, y) => tsOf(x.e) - tsOf(y.e));

  // The same pair banging together over two seconds is one incident, which is
  // how the site counts them everywhere else.
  const lastByPair = new Map();
  const out = [];
  for (const { e, n } of raw) {
    const at = tsOf(e);
    const pair = [e.Driver.Guid, e.OtherDriver.Guid].sort().join("|");
    const last = lastByPair.get(pair);
    lastByPair.set(pair, at);
    if (last != null && at - last <= CONTACT_DEFAULTS.mergeWindowMs / 1000) continue;

    out.push({
      // Stable across re-reads of the same file, and meaningless to guess:
      // the second it happened plus the pair. Used to name a chosen contact
      // without trusting the browser to describe it.
      id: `${at}:${pair}`,
      at, // unix seconds, the number the replay app shows
      second: start ? at - start : null, // into the session
      // Which entry of the result file this is, counting from one. The league's
      // steward tool (TeTeMaTeTe's replayTools) prints exactly this in front of
      // every row of its own incident list, so quoting it turns "find the
      // contact I mean" into reading one number off a report and looking for it
      // there. Verified identical: the file we archive and the file that tool
      // downloads from the server are the same bytes, same order.
      //
      // Expect gaps. Its list numbers every event in the file, ours keeps only
      // car-to-car hits, so a jump from 4 to 6 is correct, not a missing
      // contact — the missing numbers are walls and post-flag events.
      eventIndex: n,
      // The lap is per SIDE. Two cars in the same contact are not always on the
      // same lap — a backmarker being lapped is exactly the case a steward
      // cares about — so each driver gets their own, and whoever is reading
      // picks theirs (see contactsForDriver). `lap` stays as the Driver side's
      // for the callers that only want one number.
      lap: lapAt(lapsByGuid.get(e.Driver.Guid) || [], at),
      kph: Math.round(Number(e.ImpactSpeed) || 0),
      a: { guid: String(e.Driver.Guid), name: e.Driver.Name || "", lap: lapAt(lapsByGuid.get(e.Driver.Guid) || [], at) },
      b: { guid: String(e.OtherDriver.Guid), name: e.OtherDriver.Name || "", lap: lapAt(lapsByGuid.get(e.OtherDriver.Guid) || [], at) },
    });
  }
  return { archived: true, start, contacts: out };
}

// Whether the round's result file is on disk at all. An empty contact list means
// two completely different things — "the race has not been imported yet, come
// back tomorrow" and "Assetto Corsa recorded nothing for you in it" — and a
// driver told the wrong one goes looking for a bug that isn't there.
export function roundHasArchive(seasonNumber, raceNumber) {
  return contactsForRound(seasonNumber, raceNumber).archived === true;
}

// The contacts one driver was in, from their side, oldest first. `guid` is
// their Steam id, which the site already stores on Driver.steamId from the
// import, so a person and an AC event can be matched without going through a
// name.
export function contactsForDriver(seasonNumber, raceNumber, guid) {
  if (!guid) return [];
  const me = String(guid);
  const { contacts } = contactsForRound(seasonNumber, raceNumber);
  return contacts
    .filter((c) => c.a.guid === me || c.b.guid === me)
    .map((c) => {
      const mine = c.a.guid === me;
      return {
        id: c.id,
        at: c.at,
        second: c.second,
        eventIndex: c.eventIndex,
        // The lap is the reporting driver's OWN. This used to read
        // `mine ? c.lap : c.lap` — a ternary that picks the same branch either
        // way — so a driver who happened to be the event's OtherDriver was
        // shown, and filed, the other car's lap number. Wrong by a whole lap
        // for anyone lapping or being lapped, which is precisely the incident
        // a steward is being asked about.
        lap: (mine ? c.a.lap : c.b.lap) ?? c.lap,
        kph: c.kph,
        other: mine ? c.b : c.a,
      };
    })
    .sort((x, y) => x.at - y.at);
}
