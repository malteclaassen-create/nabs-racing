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
// Filtering mirrors the contact STAT the site already publishes
// (services/telemetryExtractor.js): light taps are dropped, repeated hits
// between the same pair inside the merge window count once, and anything after
// the flag is ignored. Two different numbers for the same word would be worse
// than either.
// ---------------------------------------------------------------------------
import { findArchiveFor } from "./cockpitArchive.js";
import { CONTACT_DEFAULTS } from "../services/telemetryExtractor.js";

// AC writes timestamps as unix seconds on events and laps alike.
const tsOf = (x) => {
  const n = Number(x?.Timestamp);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// When the session actually started: the earliest thing in the file, minus the
// first lap's duration where we have one. A contact in the run to turn one
// happens BEFORE anybody has completed a lap, so anchoring on the first lap
// crossing would put those at a negative time.
function sessionStart(data) {
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
export function contactsForRound(seasonNumber, raceNumber) {
  let data;
  try {
    data = findArchiveFor(seasonNumber, raceNumber);
  } catch {
    return { start: null, contacts: [] };
  }
  if (!data) return { start: null, contacts: [] };

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

  const raw = (data.Events || [])
    .filter(
      (e) =>
        e?.Type === "COLLISION_WITH_CAR" &&
        !e.AfterSessionEnd &&
        (e.ImpactSpeed || 0) >= CONTACT_DEFAULTS.impactThreshold &&
        e.Driver?.Guid &&
        e.OtherDriver?.Guid &&
        tsOf(e)
    )
    .sort((a, b) => tsOf(a) - tsOf(b));

  // The same pair banging together over two seconds is one incident, which is
  // how the site counts them everywhere else.
  const lastByPair = new Map();
  const out = [];
  for (const e of raw) {
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
      lap: lapAt(lapsByGuid.get(e.Driver.Guid) || [], at),
      kph: Math.round(Number(e.ImpactSpeed) || 0),
      a: { guid: String(e.Driver.Guid), name: e.Driver.Name || "" },
      b: { guid: String(e.OtherDriver.Guid), name: e.OtherDriver.Name || "" },
    });
  }
  return { start, contacts: out };
}

// The contacts one driver was in, from their side, newest first. `guid` is
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
        // The lap is the reporting driver's own, so show theirs.
        lap: mine ? c.lap : c.lap,
        kph: c.kph,
        other: mine ? c.b : c.a,
      };
    })
    .sort((x, y) => x.at - y.at);
}
