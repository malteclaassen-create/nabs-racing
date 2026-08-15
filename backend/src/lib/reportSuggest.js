// ---------------------------------------------------------------------------
// "The file has one contact that looks like the one you are describing."
//
// A report filed after the race can pin itself to the exact contact from the
// list of the driver's own contacts (routes/reports.js POST /), and one that
// does carries the moment, the lap, the impact speed and the file's own event
// number. Most do not. A driver writes "lap 32, he hit me in the esses", names
// somebody, and sends it — and the steward is back to hunting through a
// forty-minute replay, which is the exact job the contact list exists to
// remove.
//
// But the report still says two things the result file can be asked about: a
// LAP, and often WHO. That is usually enough to find the moment. Two drivers
// have one contact on lap 32 or they have none.
//
// So this suggests rather than decides. It never writes to the report, never
// names anybody the reporter did not name, and where the file has nothing to
// offer it offers nothing — an empty list is a real answer here, and a wrong
// contact confidently presented is worse than no contact at all.
// ---------------------------------------------------------------------------
import { contactsForDriver } from "./raceContacts.js";

// A lap either side. Lap numbers come from two different countings — the
// driver's memory of what the game showed them, and this file's "laps finished
// plus one" — and an incident on the line between two laps is a lap apart in
// the two. Wider than this and a suggestion stops being a suggestion.
const LAP_SLACK = 1;

// Three is a list a steward reads. More is a search result, and if the file
// really has five candidates for one lap then nothing here can pick between
// them and the replay is the answer.
const MAX_SUGGESTIONS = 3;

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// The contacts worth showing under one report, best first.
//
// `contacts` is one driver's own contacts for the round (raceContacts.js), so
// every entry is already theirs and `other` is the car on the far side of it.
//
// When the report names somebody, only contacts WITH that driver are offered.
// Not the lap's other contacts as well: the reporter has said who it was, and
// a list that quietly widens that is a steward being shown somebody else's
// incident under the heading of this one. If the pair has nothing on that lap,
// that is the answer, and it is worth knowing on its own.
export function rankContacts(contacts, { lap, accusedGuid = null, accusedName = null } = {}) {
  if (!Array.isArray(contacts) || !contacts.length) return [];
  const named = accusedGuid ? String(accusedGuid) : null;
  const namedAs = accusedName ? norm(accusedName) : null;
  // Nothing to narrow by is not a suggestion, it is the whole round's contact
  // list under a report. The lap is what makes this useful.
  if (lap == null && !named && !namedAs) return [];

  let pool = contacts;
  if (named || namedAs) {
    pool = pool.filter(
      (c) => (named && String(c.other?.guid || "") === named) || (namedAs && norm(c.other?.name) === namedAs)
    );
    if (!pool.length) return [];
  }

  if (lap != null) {
    pool = pool.filter((c) => c.lap != null && Math.abs(c.lap - lap) <= LAP_SLACK);
  }

  return pool
    .map((c) => ({ ...c, exactLap: lap == null || c.lap === lap }))
    .sort((x, y) => {
      // The lap the driver actually gave beats a neighbour, and among equals
      // the harder hit leads: a 40 km/h shunt is what somebody files a report
      // about, a 6 km/h brush on the same lap is not.
      if (x.exactLap !== y.exactLap) return x.exactLap ? -1 : 1;
      return (y.kph || 0) - (x.kph || 0);
    })
    .slice(0, MAX_SUGGESTIONS);
}

// The Steam id of each driver a report names, in one query rather than one per
// report. Never fatal: a report whose accused cannot be resolved falls back to
// matching on the name, and one that matches neither simply gets no suggestion.
async function accusedGuids(prisma, reports) {
  const ids = [...new Set(reports.map((r) => r.accusedDriverId).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.driver
    .findMany({ where: { id: { in: ids }, steamId: { not: null } }, select: { id: true, steamId: true } })
    .catch(() => []);
  return new Map(rows.map((d) => [d.id, d.steamId]));
}

// Attach `contactSuggestions` to the reports that could use one.
//
// Only where there is a question to answer: a report that already carries a
// contact — pinned by the driver, or matched to an in-game press — is not
// improved by a list of things it might have been instead.
//
// `guidOf` maps report id -> the reporter's Steam GUID (lib/reportAnchor.js
// works this out for the anchor and hands the same map in, so the two never
// disagree about who filed what).
export async function withContactSuggestions(prisma, reports, races, guidOf) {
  const byId = new Map(races.map((r) => [r.id, r]));
  const wanted = reports.filter(
    (r) =>
      r.contactIndex == null &&
      r.contactSecond == null &&
      !r.contactMatched &&
      (r.lap != null || r.accusedDriverId || r.accusedName) &&
      guidOf.get(r.id) &&
      byId.get(r.raceId)?.season?.number != null
  );
  if (!wanted.length) return reports;
  const guids = await accusedGuids(prisma, wanted);

  const suggestions = new Map();
  for (const r of wanted) {
    const race = byId.get(r.raceId);
    let mine;
    try {
      mine = contactsForDriver(race.season.number, race.number, guidOf.get(r.id));
    } catch {
      continue; // no archived file for that round, or an unreadable one
    }
    const hits = rankContacts(mine, {
      lap: r.lap,
      accusedGuid: r.accusedDriverId ? guids.get(r.accusedDriverId) || null : null,
      accusedName: r.accusedName || null,
    });
    if (hits.length) suggestions.set(r.id, hits);
  }
  if (!suggestions.size) return reports;
  return reports.map((r) => (suggestions.has(r.id) ? { ...r, contactSuggestions: suggestions.get(r.id) } : r));
}
