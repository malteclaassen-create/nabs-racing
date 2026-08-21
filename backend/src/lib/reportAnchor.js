// ---------------------------------------------------------------------------
// Where in the round each report happened — the figure a steward drags the
// replay's timeline to, and the one thing on a report that does not depend on
// anybody's timezone.
//
// Two questions, in order. How far into the session was it, and can the round's
// result file name the exact contact it is about. See routes/admin.js, which
// serves what comes out of here, and components/ReplayAnchor.jsx, which draws it.
// ---------------------------------------------------------------------------
import { sessionStartForRound, contactsForDriver } from "./raceContacts.js";

// How far into its round each report happened, in seconds — the figure a
// steward drags the replay's timeline to.
//
// Worked out at READ time, not stored at insert time, because the two things it
// needs arrive at different moments: a report is filed during the race, and the
// session's start only becomes knowable when the result file is imported
// afterwards. A pinned contact already carries its own `contactSecond` from the
// archive and keeps it; everything else, above all every report fired from
// inside the race, gets one derived here as soon as the round is imported.
export function withSessionSecond(reports, races) {
  const byId = new Map(races.map((r) => [r.id, r]));
  // One archive read per ROUND, not per report: a busy round can carry a dozen.
  const startOf = new Map();
  // The figure a report already carries, used when the archive cannot supply
  // one. For a report pinned to a contact after the race that IS the archive's
  // own arithmetic and is exact; for one fired from inside the race it was read
  // off the live board mid-session (routes/reports.js POST /ingest) and is
  // right to a second or two, so it is flagged as approximate — a steward
  // scrubbing to it should know whether to expect the incident on the frame or
  // a moment either side of it.
  const stored = (r) =>
    r.contactSecond != null
      ? { ...r, sessionSecond: r.contactSecond, sessionSecondApprox: r.source === "INGAME" }
      : r;
  return reports.map((r) => {
    const race = r.raceId ? byId.get(r.raceId) : null;
    // Derive from the archive whenever it can be read, and fall back to the
    // stored figure only when it cannot. For a pinned contact the two are the
    // same arithmetic on the same anchor, so this costs nothing — and it means a
    // correction to the anchor reaches reports that were filed before it. The
    // first version measured from the green flag rather than the start of the
    // session, which left every stored figure short by the grid wait.
    if (!race || !r.incidentAt || race.number == null || race.season?.number == null) {
      return stored(r);
    }
    if (!startOf.has(race.id)) {
      let start = null;
      try {
        start = sessionStartForRound(race.season.number, race.number);
      } catch {
        start = null;
      }
      startOf.set(race.id, start);
    }
    const start = startOf.get(race.id);
    if (!start) return stored(r);
    const second = Math.round(new Date(r.incidentAt).getTime() / 1000 - start);
    // A negative figure means the report's clock and the round's archive
    // disagree about which session this was — showing "-4:12 into the race"
    // would be worse than showing nothing, and the figure the report came in
    // with is the better answer if it has one.
    return second >= 0 ? { ...r, sessionSecond: second, sessionSecondApprox: false } : stored(r);
  });
}

// --- pinning an in-game report to the contact it is about --------------------
//
// Everything above measures from WHEN THE BUTTON WAS PRESSED, and that is not
// when the incident happened. A driver gets hit, wrestles the car straight,
// then reaches for the key: the figure carries their reaction time, and past
// that the difference between this server's clock and the game server's.
// Seconds, sometimes a lot of them, and all of it in the same direction — late.
//
// The result file, though, has the answer already. Assetto Corsa recorded the
// collision with its own timestamp, on the same clock the replay is cut to, and
// it recorded WHO was in it. So a report from a driver who has exactly one
// recorded contact in the moments before they pressed the button does not need
// to be estimated at all: it can be snapped to that contact, and then it is the
// same number a report filed after the race by picking the contact off the list
// would have carried — exact, not approximate.
//
// The impact speed, the lap and the file's own event number come along with it,
// which is what lets a steward check the match rather than take it on trust.
// The accused deliberately does NOT: the file knows which car it was, but a
// driver pressing that button has not accused anybody, and turning a match into
// an accusation is the stewards' call to make, not this function's.
//
// `withOther` is that call being made. It carries the OTHER car out of the
// match — as `contactOther`, never as the accused — for the one caller that is
// entitled to see it: the stewards' desk, where somebody works through a
// round's unnamed presses after the race and says who each one was about. It is
// off by default, so the member API cannot hand a driver a name the file
// guessed and the league has not stood behind.

// How long before the press to look for the contact. Long enough for a spin, a
// recovery and a hand off the wheel; short enough that a tap the driver did not
// mean stays out of it. Nothing AFTER the press can be the incident, bar the
// two servers' clocks disagreeing, which is what the small tolerance covers.
const MATCH_BEFORE_S = 45;
const MATCH_AFTER_S = 10;

// The Steam GUID each of these reports was filed by. Assetto Corsa knows people
// by that number and nothing else, so it is the only way to ask the file "which
// of these contacts were theirs".
//
// The Discord id the report carries is tried first — it is the per-person link
// the ingest resolved, and it survives a rename. Names are the fallback, matched
// the way the ingest matches them (case and punctuation dropped, a clan tag like
// "NABS | Malte" also tried on its own). A name that two different people race
// under is thrown away rather than guessed at: a wrong guid here would pin the
// report to somebody else's crash.
// Steam ids proved on the login rather than captured by a result import. Raw
// SQL because MemberAccount's columns are hand-managed (lib/members.js), and
// never fatal: a report that cannot be matched keeps the anchor it came with.
async function accountSteamIds(prisma) {
  try {
    return await prisma.$queryRawUnsafe(
      `SELECT "discordId", "steamId" FROM "MemberAccount" WHERE "steamId" IS NOT NULL`
    );
  } catch {
    return [];
  }
}

export async function reporterGuids(prisma, reports) {
  const out = new Map();
  const drivers = await prisma.driver
    .findMany({
      where: { steamId: { not: null } },
      select: { name: true, discordName: true, discordUserId: true, steamId: true },
    })
    .catch(() => []);

  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const byDiscord = new Map();
  // The id proved on the LOGIN by "Sign in through Steam", for the drivers whose
  // season row has not picked one up from a result import yet. Loaded first so a
  // Driver row's id, which is the one Assetto Corsa actually raced under, wins
  // where both exist.
  for (const m of await accountSteamIds(prisma)) byDiscord.set(String(m.discordId), m.steamId);
  const byName = new Map();
  const ambiguous = new Set();
  for (const d of drivers) {
    if (d.discordUserId) byDiscord.set(String(d.discordUserId), d.steamId);
    for (const raw of [d.name, d.discordName]) {
      const key = norm(raw);
      if (!key) continue;
      const seen = byName.get(key);
      if (seen && seen !== d.steamId) ambiguous.add(key);
      else byName.set(key, d.steamId);
    }
  }
  for (const key of ambiguous) byName.delete(key);

  for (const r of reports) {
    const viaDiscord = r.reporterDiscordId ? byDiscord.get(String(r.reporterDiscordId)) : null;
    if (viaDiscord) {
      out.set(r.id, viaDiscord);
      continue;
    }
    const name = String(r.reporterName || "");
    const tagCut = name.lastIndexOf("|");
    const guid = [name, tagCut === -1 ? "" : name.slice(tagCut + 1)]
      .map((c) => byName.get(norm(c)))
      .find(Boolean);
    if (guid) out.set(r.id, guid);
  }
  return out;
}

// The contact a report is about, or null when the file cannot settle it: the
// driver was in none in that window (they pressed the button about a spin, or
// about somebody else's incident), or the round has no archived file at all.
//
// The LATEST one in the window, not the nearest. A first-corner pile-up is
// several contacts over a few seconds and the press comes after all of them;
// the one that finally made the driver reach for the key is the last.
function contactBehind(seasonNumber, raceNumber, guid, second) {
  let mine;
  try {
    mine = contactsForDriver(seasonNumber, raceNumber, guid);
  } catch {
    return null;
  }
  let best = null;
  for (const c of mine) {
    if (c.second == null) continue;
    if (c.second > second + MATCH_AFTER_S) break; // sorted: nothing later can qualify
    if (c.second < second - MATCH_BEFORE_S) continue;
    best = c;
  }
  return best;
}

// The read shape both report endpoints hand out: the session figure, and then
// the exact contact where the file can name one.
// `knownGuids` lets a caller that has already worked out who filed what hand
// the map in — the stewards' desk needs the same map for its contact
// suggestions (lib/reportSuggest.js), and resolving it twice per request would
// read the whole roster twice to reach the same answer.
export async function anchorReports(prisma, reports, races, knownGuids = null, { withOther = false } = {}) {
  const anchored = withSessionSecond(reports, races);
  const byId = new Map(races.map((x) => [x.id, x]));
  const candidates = anchored.filter(
    (r) => r.source === "INGAME" && r.sessionSecond != null && byId.get(r.raceId)?.season?.number != null
  );
  if (!candidates.length) return anchored;
  const guids = knownGuids || (await reporterGuids(prisma, candidates).catch(() => new Map()));
  if (!guids.size) return anchored;

  const wanted = new Set(candidates.map((r) => r.id));
  return anchored.map((r) => {
    const guid = wanted.has(r.id) ? guids.get(r.id) : null;
    if (!guid) return r;
    const race = byId.get(r.raceId);
    const hit = contactBehind(race.season.number, race.number, guid, r.sessionSecond);
    if (!hit) return r;
    return {
      ...r,
      sessionSecond: hit.second,
      sessionSecondApprox: false,
      // How the figure was arrived at, so the chip can say so and a steward can
      // weigh it. A matched contact is evidence about a moment, not about fault.
      contactMatched: true,
      // Everything the file knows about that moment. Never overwrites what the
      // report already carries — a driver who pinned their own contact has
      // already said which one, and that answer outranks this one.
      contactKph: r.contactKph ?? hit.kph,
      contactIndex: r.contactIndex ?? hit.eventIndex,
      lap: r.lap ?? hit.lap,
      // Who the file says was on the other side of it. A fact about a
      // collision, not a verdict about it — see the note above.
      contactOther: withOther && hit.other ? { name: hit.other.name || null, guid: hit.other.guid || null } : undefined,
    };
  });
}

