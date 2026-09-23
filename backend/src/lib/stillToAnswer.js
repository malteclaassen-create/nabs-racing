// ---------------------------------------------------------------------------
// Who has not answered a race yet.
//
// Silence leaves no row anywhere, so this is the roster MINUS the answers: the
// race's season, active drivers only, counted per PERSON (lib/onePerPerson.js)
// so somebody with two roster rows is neither chased twice nor chased for an
// answer their other row already gave.
//
// Two places ask the question and they must never disagree: the admin's "Still
// to answer" list, and the attendance reminder, which now goes to exactly the
// people on that list. A reminder that reached somebody the list says has
// answered — or missed somebody it says has not — would make both untrustworthy,
// so the rule lives here once and both call it.
// ---------------------------------------------------------------------------
import { getPersonGroups, discordIdsForDrivers } from "./persons.js";
import { collapseByPerson, personKey } from "./onePerPerson.js";

// The row's TEAM tier decides, not the driver's own: a Tier-2 driver parked in
// the Reserve pool is a reserve this season, and that is the roster the grid is
// built from.
export const isReserveRow = (d) => (d.team?.tier ?? d.tier) === 0;

// The pure half, so the rule can be tested without a database.
//
// `rows` are the season's active driver rows (with `team`), `rsvps` the race's
// answers ({ driverId }), `byDriver` the person links. A row parked in the
// Reserve pool loses to one in a real team when one person has both: the chase
// list is read per team, and the person is racing for one of them.
export function silentRoster({ rows, rsvps, byDriver }) {
  const roster = collapseByPerson(
    (rows || []).map((d) => ({ ...d, driverId: d.id })),
    byDriver,
    (d) => (isReserveRow(d) ? 0 : 1)
  ).kept;
  const answered = new Set((rsvps || []).map((r) => personKey(r.driverId, byDriver)));
  const silent = roster.filter((d) => !answered.has(personKey(d.id, byDriver)));
  return { roster, answered, silent };
}

// The database half. `discordIds` maps each silent driver to their EFFECTIVE
// Discord id (own row, or inherited through the person links), the same value
// the results post @mentions with — so a member whose login still points at
// last season's row is still reachable.
export async function stillToAnswer(prisma, race) {
  const [rows, rsvps, people] = await Promise.all([
    prisma.driver.findMany({
      where: { seasonId: race.seasonId, isActive: true },
      include: { team: { select: { name: true, tier: true, color: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.raceRsvp.findMany({ where: { raceId: race.id }, select: { driverId: true, status: true } }),
    getPersonGroups(prisma).catch(() => ({ byDriver: new Map(), byPerson: new Map() })),
  ]);
  const { roster, answered, silent } = silentRoster({ rows, rsvps, byDriver: people.byDriver });
  const discordIds = await discordIdsForDrivers(prisma, silent.map((d) => d.id)).catch(() => new Map());
  return { roster, answered, silent, discordIds };
}

// Which of those Discord ids the bell can actually reach: somebody who has
// logged in at least once and is not banned. A notification addressed to an
// account that never logged in would sit unread until the day they finally
// do, and by then "please answer for Saturday" is about a race long run.
//
// Returns a Set of the reachable ids.
export async function reachableDiscordIds(prisma, discordIds) {
  const ids = [...new Set((discordIds || []).filter(Boolean))];
  if (!ids.length) return new Set();
  const ph = ids.map(() => "?").join(",");
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "discordId" FROM "MemberAccount" WHERE "banned" = 0 AND "discordId" IN (${ph})`,
    ...ids
  );
  return new Set(rows.map((r) => r.discordId));
}

// Silent drivers split into the ones a personal bell note reaches and the ones
// it cannot. Pure, given the two lookups above. One person with one login gets
// one note, however many rows point at them.
export function splitByReach(silent, discordIds, reachable) {
  const recipients = new Set();
  let withoutLogin = 0;
  for (const d of silent || []) {
    const id = discordIds.get(d.id);
    if (id && reachable.has(id)) recipients.add(id);
    else withoutLogin += 1;
  }
  return { recipients: [...recipients], withoutLogin };
}
