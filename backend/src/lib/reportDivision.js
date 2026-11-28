// ---------------------------------------------------------------------------
// Which of an evening's two fields a report belongs to.
//
// With Division 2 (lib/divisions.js) a round is two races at the same time on
// two servers, each with a result file, a replay and a session clock of its
// own. Division 2's classification sits on a hidden child row of the round.
// A report has to be on the row of the race it happened in: that row decides
// which file its contacts and its "N into the race" are read from
// (lib/reportAnchor.js), which replay a steward opens, and which
// classification a time penalty is typed into (the results editor asks by
// race, lib/reports.js dbPenaltiesForRace).
//
// Nobody picks the division. The form offers the round, the in-game button
// knows only a name, and the child row does not even exist until Division 2's
// result is imported. So it is worked out from who filed the report: the
// result files say who drove where, and a driver drove in exactly one of the
// two. Asked in two places:
//
//   * when a report is filed on the site (reportRaceFor), and
//   * when either result file of the round is imported
//     (rehomeDivisionReports), for everything that arrived before: the
//     in-game presses of the evening above all, which all land on the round.
//
// Only ever on evidence. A report whose filer the files do not know (a
// steward filing for somebody, a name nobody raced under) stays where it is,
// and an admin can still move it by hand.
// ---------------------------------------------------------------------------
import { driverInRound, guidsByNameForRound, roundHasArchive } from "./raceContacts.js";
import { readDivisionChildren, readDivisionParents, seasonHasDivision2 } from "./divisions.js";
import { reporterGuids } from "./reportAnchor.js";
import { getLinkedDriverIds } from "./persons.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// 1 or 2 when the round's files place this driver in one field, null when
// they cannot: no file knows them, or both know them equally well. A lap or an
// event outranks a mere entry (lib/raceContacts.js driverInRound), because a
// reserve can be on both servers' entry lists and still only drive on one.
export function fieldOfGuid(season, raceNumber, guid) {
  if (!guid || raceNumber == null) return null;
  const rank = { drove: 2, listed: 1 };
  let one = 0;
  let two = 0;
  try {
    one = rank[driverInRound(season, raceNumber, guid, false, 1)] || 0;
    two = rank[driverInRound(season, raceNumber, guid, false, 2)] || 0;
  } catch {
    return null;
  }
  return one === two ? null : one > two ? 1 : 2;
}

// The same question for a name off the game server (an in-game press whose
// driver the roster cannot place): the files' own name lists, whole and
// without a clan tag. A name both files carry is nobody's.
export function fieldOfName(season, raceNumber, name) {
  const raw = String(name || "");
  const cut = raw.lastIndexOf("|");
  const keys = [raw, cut === -1 ? "" : raw.slice(cut + 1)].map(norm).filter(Boolean);
  if (!keys.length || raceNumber == null) return null;
  const guidIn = (division) => {
    try {
      const names = guidsByNameForRound(season, raceNumber, false, division);
      return keys.map((k) => names.get(k)).find(Boolean) || null;
    } catch {
      return null;
    }
  };
  const one = guidIn(1);
  const two = guidIn(2);
  if (one && two) return one === two ? fieldOfGuid(season, raceNumber, one) : null;
  if (one) return fieldOfGuid(season, raceNumber, one) ?? 1;
  return two ? (fieldOfGuid(season, raceNumber, two) ?? 2) : null;
}

// A round's two rows and what the archive files them under, from either row.
// Null for a race that has no Division 2 row (yet): there is one field.
async function fieldsOf(prisma, raceId) {
  if (!raceId) return null;
  const up = (await readDivisionParents(prisma, [raceId])).get(raceId) || null;
  const roundId = up || raceId;
  const childId = up ? raceId : (await readDivisionChildren(prisma, [raceId])).get(raceId) || null;
  if (!childId) return null;
  const round = await prisma.race
    .findUnique({ where: { id: roundId }, select: { id: true, number: true, season: { select: { id: true, number: true } } } })
    .catch(() => null);
  if (!round?.season) return null;
  return { round, childId };
}

// The stored classifications, for a round whose file cannot say (entered by
// hand, or archived before the files were kept): the field whose results name
// one of this person's driver rows.
async function fieldByResults(prisma, { round, childId }, { guid, discordId }) {
  try {
    const ids = new Set();
    if (discordId) {
      const claimed = await prisma.driver.findMany({ where: { discordUserId: String(discordId) }, select: { id: true } });
      for (const c of claimed) for (const id of await getLinkedDriverIds(prisma, c.id)) ids.add(id);
    }
    if (guid) {
      const rows = await prisma.driver.findMany({ where: { steamId: String(guid), seasonId: round.season.id }, select: { id: true } });
      for (const r of rows) ids.add(r.id);
    }
    if (!ids.size) return null;
    const rows = await prisma.raceResult.findMany({
      where: { raceId: { in: [round.id, childId] }, driverId: { in: [...ids] } },
      select: { raceId: true },
    });
    const one = rows.some((r) => r.raceId === round.id);
    const two = rows.some((r) => r.raceId === childId);
    return one === two ? null : one ? 1 : 2;
  } catch {
    return null;
  }
}

// The race row a report by this person belongs on, given the row they picked
// (the round, or its Division 2 row from a link on that race's page). The
// picked row comes back unchanged when the round has one field or nothing
// places the person.
export async function reportRaceFor(prisma, raceId, { guid = null, discordId = null } = {}) {
  if (!raceId) return raceId || null;
  try {
    const fields = await fieldsOf(prisma, raceId);
    if (!fields) return raceId;
    const field =
      fieldOfGuid(fields.round.season, fields.round.number, guid) ??
      (await fieldByResults(prisma, fields, { guid, discordId }));
    return field === 2 ? fields.childId : field === 1 ? fields.round.id : raceId;
  } catch {
    return raceId;
  }
}

// Why a driver's contact list for a round is empty, in the words the form
// already knows: "not-imported" while their race's file is not there,
// "none-recorded" once it is. `race` is the row the list was read from
// (lib/sprintRaces.js withSprintRounds shape). On a Division 2 evening the
// round's own file being there says nothing to a Division 2 driver: until
// theirs is imported too, a file that does not know them means "not yet".
export async function emptyContactsReason(prisma, race, guid) {
  const division = race.division === 2 ? 2 : 1;
  if (!roundHasArchive(race.season, race.number, race.sprint, division)) return "not-imported";
  if (race.sprint || driverInRound(race.season, race.number, guid, false, division)) return "none-recorded";
  if (!(await seasonHasDivision2(prisma, race.season?.id).catch(() => false))) return "none-recorded";
  return roundHasArchive(race.season, race.number, false, division === 2 ? 1 : 2) ? "none-recorded" : "not-imported";
}

// Move every report of a round onto the row of the field its filer drove in.
// `season` is the season row, `parent` the round ({ id, number }), `childId`
// its Division 2 row. Called by the import once either file lands, and safe to
// call again: a report already in the right place is left alone. Returns how
// many changed race.
//
// A report the driver pinned to a contact is never moved: the contact came
// out of one file, and the report was filed under that file's race.
export async function rehomeDivisionReports(prisma, { season, parent, childId }) {
  if (!season || !parent?.id || !childId || parent.number == null) return 0;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "raceId", "source", "reporterDiscordId", "reporterName", "contactIndex" FROM "Report"
      WHERE "raceId" IN (?, ?)`,
    parent.id,
    childId
  );
  const movable = rows.filter((r) => !(r.source !== "INGAME" && r.contactIndex != null));
  if (!movable.length) return 0;
  // The roster's answer to "whose GUID is this" (no races handed in, so no
  // file is asked here: which file to ask is the question).
  const guids = await reporterGuids(prisma, movable).catch(() => new Map());
  let moved = 0;
  for (const r of movable) {
    const field =
      fieldOfGuid(season, parent.number, guids.get(r.id)) ??
      (r.source === "INGAME" ? fieldOfName(season, parent.number, r.reporterName) : null);
    const target = field === 2 ? childId : field === 1 ? parent.id : null;
    if (!target || target === r.raceId) continue;
    await prisma.$executeRawUnsafe(`UPDATE "Report" SET "raceId" = ? WHERE "id" = ?`, target, r.id);
    moved += 1;
  }
  return moved;
}

// ---------------------------------------------------------------------------
// Once, for the rounds raced before this existed: every report of a Division 2
// evening was filed under the round, so Division 2's sat on Division 1's row,
// measured against Division 1's file. Flag-guarded (Setting), so it runs on
// the first boot with this code and never again; every later round is moved
// by its own import.
// ---------------------------------------------------------------------------
const MARKER = "reports_division_rehomed";

export async function rehomeDivisionReportsOnce(prisma) {
  try {
    const done = await prisma.setting.findUnique({ where: { key: MARKER } }).catch(() => null);
    if (done) return 0;
    const children = await prisma.$queryRawUnsafe(
      `SELECT "id", "parentRaceId" FROM "Race" WHERE "division" = 2 AND "parentRaceId" IS NOT NULL`
    );
    let moved = 0;
    for (const child of children) {
      const parent = await prisma.race
        .findUnique({ where: { id: child.parentRaceId }, select: { id: true, number: true, season: true } })
        .catch(() => null);
      if (!parent?.season) continue;
      moved += await rehomeDivisionReports(prisma, { season: parent.season, parent, childId: child.id }).catch(() => 0);
    }
    await prisma.setting.upsert({
      where: { key: MARKER },
      update: { value: new Date().toISOString() },
      create: { key: MARKER, value: new Date().toISOString() },
    });
    if (moved) console.log(`reports: moved ${moved} report(s) onto their Division 2 race`);
    return moved;
  } catch (e) {
    console.error("reports: division rehome:", e.message);
    return 0;
  }
}
