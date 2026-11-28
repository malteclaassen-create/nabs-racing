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
import { CONTACT_DEFAULTS, ENV_CONTACT_DEFAULTS } from "../services/telemetryExtractor.js";

// AC writes timestamps as unix seconds on events and laps alike.
const tsOf = (x) => {
  const n = Number(x?.Timestamp);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Where on the circuit an event happened, as [x, z] in world metres (the
// overhead plane the track maps are drawn in; y is height and not needed).
// Rounded to 10 cm, which is far finer than any map can show. null when the
// file has no position for it.
function worldXZ(e) {
  const p = e?.WorldPosition || e?.WorldPos || null;
  if (!p) return null;
  const x = Number(p.X ?? p.x);
  const z = Number(p.Z ?? p.z);
  if (!Number.isFinite(x) || !Number.isFinite(z) || (x === 0 && z === 0)) return null;
  return [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
}

// The pace car and the broadcast car of the round, by the same two signs the
// live page goes by (services/liveTiming.js looksLikeSafetyCar): "safety" in
// the skin or a skin called just "sc", or one of the models the league has run
// as a pace car. Their contacts are not part of the race.
const PACE_CAR_MODELS = new Set(["lotus_exige_240", "mercedes_sls", "mercedes_sls_gt3", "drf_audi_rs5_dtm_2019"]);
function paceCarGuids(data) {
  const out = new Set();
  for (const c of data.Cars || []) {
    const guid = c?.Driver?.Guid;
    if (!guid) continue;
    const skin = String(c.Skin || "").trim();
    if (/safety/i.test(skin) || /^sc$/i.test(skin) || PACE_CAR_MODELS.has(String(c.Model || "").trim().toLowerCase())) out.add(String(guid));
  }
  return out;
}

// The way names are compared everywhere reports touch them (reportAnchor.js,
// reportSuggest.js, the ingest): case and punctuation dropped.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

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
// round at a time.
//
// Only rounds that HAVE a file are cached. On a race evening the reports
// arrive while the race is on and the stewards open the list straight away,
// hours before the result file is imported — and the process on the host is
// not restarted by an import. Caching "no file" at that moment kept every
// report of the round on its rough live-board figure, with no contact matched,
// until the next deploy happened to restart the server. Asking the disk again
// for a round that had nothing is one directory listing, which is what the
// results page pays on every request anyway.
//
// A re-import of a round rewrites its file; forgetRound() (called by the
// commit) drops the stale entry so the corrected file is read next time.
const ROUND_CACHE_MAX = 8;
const roundCache = new Map();

// `season` is the season row ({ id, number }); the id is what tells two
// leagues' "season 8, round 2" apart. A bare number still works. `sprint`
// asks for the weekend's sprint file rather than the feature race's: the
// sprint is a race of its own with its own contacts, filed under the same
// round number (lib/cockpitArchive.js).
// `division` 2 reads the round's Division 2 file (lib/divisions.js), which the
// archive keeps in a folder of its own under the same round number.
const roundKey = (season, raceNumber, sprint, division = 1) =>
  (season && typeof season === "object" ? `${season.id ?? ""}|${season.number}|${raceNumber}` : `|${season}|${raceNumber}`) +
  (sprint ? "|sprint" : "") +
  (Number(division) === 2 ? "|div2" : "");

export function contactsForRound(season, raceNumber, sprint = false, division = 1) {
  const cacheKey = roundKey(season, raceNumber, sprint, division);
  const hit = roundCache.get(cacheKey);
  if (hit) {
    // Re-insert so the most recently used round is the last to be evicted.
    roundCache.delete(cacheKey);
    roundCache.set(cacheKey, hit);
    return hit;
  }
  const built = buildRound(season, raceNumber, sprint, division);
  if (!built.archived) return built;
  roundCache.set(cacheKey, built);
  if (roundCache.size > ROUND_CACHE_MAX) roundCache.delete(roundCache.keys().next().value);
  return built;
}

// Drop what is cached for one round (or, with no arguments, for every round):
// the round's file has just been written or replaced, and the next reader must
// see the new one.
export function forgetRound(season = null, raceNumber = null, sprint = false, division = 1) {
  if (season == null && raceNumber == null) {
    roundCache.clear();
    return;
  }
  roundCache.delete(roundKey(season, raceNumber, sprint, division));
}

// When the round's session started, as unix seconds, or null when the round has
// no archived result file. The anchor that turns an absolute moment into
// "N seconds into the race", which is the one figure a replay can be scrubbed
// to without knowing anybody's timezone.
export function sessionStartForRound(season, raceNumber, sprint = false, division = 1) {
  return contactsForRound(season, raceNumber, sprint, division).start;
}

// The session's clock window as unix seconds, { start, end }: the replay's
// start (above) and the last lap anybody crossed the line on. Null without a
// file. What tells a sprint weekend's two races apart by the clock
// (lib/reportRehome.js).
export function sessionWindowForRound(season, raceNumber, sprint = false, division = 1) {
  const round = contactsForRound(season, raceNumber, sprint, division);
  if (!round.archived || round.start == null || round.end == null) return null;
  return { start: round.start, end: round.end };
}

// Every participant's name in the file -> their Steam GUID, exactly as the
// game wrote both. This is what lets a report be matched to a person whose
// ROSTER spelling differs from their in-game name: the report's name came off
// the game server, and so did the file's, so for the same person in the same
// round the two are the same string.
//
// Collected from every place the file writes the pair (results, car list,
// laps, events) because no single one is guaranteed present in every file.
// Each name is indexed whole and, for anyone racing under a clan tag, as the
// part after the last pipe too. A name two different GUIDs raced under is
// dropped rather than guessed at, same rule as the roster matching — within
// one round that is nearly impossible, which is exactly why this map can be
// trusted further than a roster-wide one.
function nameGuids(data) {
  const pairs = [];
  for (const r of data.Result || []) if (r?.DriverGuid && r?.DriverName) pairs.push([r.DriverName, r.DriverGuid]);
  for (const c of data.Cars || []) if (c?.Driver?.Guid && c?.Driver?.Name) pairs.push([c.Driver.Name, c.Driver.Guid]);
  for (const l of data.Laps || []) if (l?.DriverGuid && l?.DriverName) pairs.push([l.DriverName, l.DriverGuid]);
  for (const e of data.Events || []) {
    if (e?.Driver?.Guid && e?.Driver?.Name) pairs.push([e.Driver.Name, e.Driver.Guid]);
    if (e?.OtherDriver?.Guid && e?.OtherDriver?.Name) pairs.push([e.OtherDriver.Name, e.OtherDriver.Guid]);
  }

  const byName = new Map();
  const ambiguous = new Set();
  const put = (raw, guid) => {
    const key = norm(raw);
    if (!key) return;
    const seen = byName.get(key);
    if (seen && seen !== String(guid)) ambiguous.add(key);
    else byName.set(key, String(guid));
  };
  for (const [name, guid] of pairs) {
    put(name, guid);
    const cut = String(name).lastIndexOf("|");
    if (cut !== -1) put(String(name).slice(cut + 1), guid);
  }
  for (const key of ambiguous) byName.delete(key);
  return byName;
}

// The round's name -> GUID map, or an empty one when the round has no archived
// file. Cached with the round's contacts, so asking costs nothing extra.
export function guidsByNameForRound(season, raceNumber, sprint = false, division = 1) {
  return contactsForRound(season, raceNumber, sprint, division).names || new Map();
}

// Was this driver in the file, and how sure is that: "drove" when the file has
// a lap or an event of theirs, "listed" when it only names them (the result
// table and the car list also carry an entry that never left the pits, or
// never joined at all), null when it does not know them or there is no file.
// What tells the two fields of a Division 2 evening apart for one driver
// (lib/reportDivision.js): they drove in exactly one of the two files.
export function driverInRound(season, raceNumber, guid, sprint = false, division = 1) {
  if (!guid) return null;
  const round = contactsForRound(season, raceNumber, sprint, division);
  if (!round.archived) return null;
  const me = String(guid);
  if ((round.drove || []).includes(me)) return "drove";
  return (round.listed || []).includes(me) ? "listed" : null;
}

function buildRound(season, raceNumber, sprint, division = 1) {
  let data;
  try {
    data = findArchiveFor(season, raceNumber, { sprint, division });
  } catch {
    return { archived: false, start: null, contacts: [], names: new Map() };
  }
  if (!data) return { archived: false, start: null, contacts: [], names: new Map() };
  return reduceRound(data);
}

// The parts of one result file the readers below need, from the parsed JSON.
// Its own function so the tests can hand it a file without a disk.
export function reduceRound(data) {
  const start = sessionStart(data);
  const names = nameGuids(data);

  // Laps per driver, sorted, for the lap lookup.
  const lapsByGuid = new Map();
  for (const l of data.Laps || []) {
    const t = tsOf(l);
    if (!t || !l.DriverGuid) continue;
    if (!lapsByGuid.has(l.DriverGuid)) lapsByGuid.set(l.DriverGuid, []);
    lapsByGuid.get(l.DriverGuid).push(t);
  }
  for (const arr of lapsByGuid.values()) arr.sort((a, b) => a - b);
  // The last lap crossed in the file: where the session's clock window ends.
  let end = null;
  for (const arr of lapsByGuid.values()) {
    const last = arr[arr.length - 1];
    if (last != null && (end == null || last > end)) end = last;
  }

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
      // Where it happened (the contact map in the race recap, lib/contactMap.js).
      pos: worldXZ(e),
      a: { guid: String(e.Driver.Guid), name: e.Driver.Name || "", lap: lapAt(lapsByGuid.get(e.Driver.Guid) || [], at) },
      b: { guid: String(e.OtherDriver.Guid), name: e.OtherDriver.Name || "", lap: lapAt(lapsByGuid.get(e.OtherDriver.Guid) || [], at) },
    });
  }

  // Hits on the scenery, counted the way the stored figure counts them
  // (services/telemetryExtractor.js, RaceResult.envContacts): from the same
  // impact speed up, one per driver inside the merge window, nothing after the
  // flag. So the recap's "3 with the scenery" and the three marks on its map
  // are the same three.
  const walls = [];
  const lastWall = new Map();
  const envRaw = (data.Events || [])
    .filter(
      (e) =>
        e?.Type === "COLLISION_WITH_ENV" &&
        !e.AfterSessionEnd &&
        e.Driver?.Guid &&
        tsOf(e) &&
        (Number(e.ImpactSpeed) || 0) >= ENV_CONTACT_DEFAULTS.impactThreshold
    )
    .sort((x, y) => tsOf(x) - tsOf(y));
  for (const e of envRaw) {
    const at = tsOf(e);
    const guid = String(e.Driver.Guid);
    const last = lastWall.get(guid);
    lastWall.set(guid, at);
    if (last != null && at - last <= ENV_CONTACT_DEFAULTS.mergeWindowMs / 1000) continue;
    walls.push({ guid, at, lap: lapAt(lapsByGuid.get(e.Driver.Guid) || [], at), kph: Math.round(Number(e.ImpactSpeed) || 0), pos: worldXZ(e) });
  }

  // Who the file knows (driverInRound above). An event counts for both of its
  // sides, post-flag ones included: this asks who was on that server, not
  // what counts as a contact.
  const drove = new Set(lapsByGuid.keys());
  for (const e of data.Events || []) {
    if (e?.Driver?.Guid) drove.add(String(e.Driver.Guid));
    if (e?.OtherDriver?.Guid) drove.add(String(e.OtherDriver.Guid));
  }
  const listed = new Set();
  for (const r of data.Result || []) if (r?.DriverGuid) listed.add(String(r.DriverGuid));
  for (const c of data.Cars || []) if (c?.Driver?.Guid) listed.add(String(c.Driver.Guid));

  return {
    archived: true,
    start,
    end,
    contacts: out,
    names,
    drove: [...drove].map(String),
    listed: [...listed],
    walls,
    // The AC track and layout folder, exactly as the game spells them: what the
    // circuit's line is fetched under (lib/trackMaps.js).
    track: data.TrackName ? { name: String(data.TrackName), layout: data.TrackConfig ? String(data.TrackConfig) : "" } : null,
    paceCars: [...paceCarGuids(data)],
  };
}

// The whole round as the contact map reads it: every contact and every wall
// hit with where it happened, the circuit it was on and who the pace car was.
// Null when the round has no archived file.
export function contactSceneForRound(season, raceNumber, sprint = false, division = 1) {
  const round = contactsForRound(season, raceNumber, sprint, division);
  if (!round.archived) return null;
  return { contacts: round.contacts, walls: round.walls || [], track: round.track || null, paceCars: new Set(round.paceCars || []) };
}

// Whether the round's result file is on disk at all. An empty contact list means
// two completely different things — "the race has not been imported yet, come
// back tomorrow" and "Assetto Corsa recorded nothing for you in it" — and a
// driver told the wrong one goes looking for a bug that isn't there.
export function roundHasArchive(season, raceNumber, sprint = false, division = 1) {
  return contactsForRound(season, raceNumber, sprint, division).archived === true;
}

// The contacts one driver was in, from their side, oldest first. `guid` is
// their Steam id, which the site already stores on Driver.steamId from the
// import, so a person and an AC event can be matched without going through a
// name.
export function contactsForDriver(season, raceNumber, guid, sprint = false, division = 1) {
  if (!guid) return [];
  const me = String(guid);
  const { contacts } = contactsForRound(season, raceNumber, sprint, division);
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
