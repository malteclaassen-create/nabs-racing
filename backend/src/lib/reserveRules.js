// ---------------------------------------------------------------------------
// Which seats a reserve may take over, set per driver by an admin.
//
// A reserve signs up on Division 2's grid (lib/divisions.js) and gets into
// Division 1 only by taking over a Division 1 driver's seat on the Driver
// Market. The league asked for a say in who can do that (Steve, 2026-11-27):
// some reserves should not be able to get into Division 1, some should not be
// able to sub in at all, and some only when a particular driver is missing
// ("Guest and Mitch only if 13bot, Siggsta, Timmis or Takoda doesn't race").
// New drivers most of all.
//
// Three things on a reserve's row:
//
//   div1Rule   null     can put their hand up for any Division 1 seat
//              "never"  no Division 1 seat
//              "cover"  a Division 1 seat only for a round where one of the
//                       drivers in div1Cover is out
//   div1Cover  JSON array of driver ids of the same season (for "cover")
//   noSubIn    may not take over any seat on the Driver Market, in either
//              division
//
// "Out" for a round means the driver said no to it, or their seat is on the
// Driver Market for it (which is what a full-time driver's no turns into,
// lib/seatAuto.js). Somebody who has not answered yet is not out.
//
// The rules only ever bite for a reserve (a tier-0 team) and only on a
// championship round. Signing up is never refused by them: that is Division
// 2's grid, open to every reserve. A season with one division has only
// Division 1 seats, so "never" there means no seat at all.
//
// What an admin does by hand is not checked: putting a reserve into a seat on
// the admin's Driver Market tab is the admin deciding, the same way the grid
// size does not apply there (lib/waitlist.js). And nobody loses a seat to a
// rule set later, or because the driver they cover for says yes after all.
//
// New drivers: a newcomer who signs themselves up (lib/newcomers.js) is a
// reserve like any other and can put their hand up for every seat (league
// call, 2026-11-27). The admins can switch on that newcomers start with
// "never" in a season that runs Division 2 (Setting "reserve_rules"); an
// admin then lifts the rule when they are ready for a Division 1 seat.
//
// Raw-SQL columns (ensureAppSchema, migration reserve_rules), so every read
// and write goes through here.
// ---------------------------------------------------------------------------
import { DIV2_TIER, seasonHasDivision2 } from "./divisions.js";
import { getPersonGroups } from "./persons.js";

export const DIV1_RULES = ["never", "cover"];
const MAX_COVER = 20;
const SETTING_KEY = "reserve_rules";

const NO_RULE = Object.freeze({ div1: null, cover: [], noSubIn: false });

function parseCover(raw) {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list.filter((id) => typeof id === "string" && id) : [];
  } catch {
    return [];
  }
}

// Map driverId -> { div1, cover, noSubIn }, only for rows that have a rule.
// Empty when the columns are not there yet (fresh checkout).
export async function readReserveRules(prisma, driverIds) {
  const ids = [...new Set((driverIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "div1Rule", "div1Cover", "noSubIn" FROM "Driver"
        WHERE "id" IN (${ids.map(() => "?").join(",")})
          AND ("div1Rule" IS NOT NULL OR "noSubIn" = 1)`,
      ...ids
    );
    return new Map(
      rows.map((r) => {
        const div1 = DIV1_RULES.includes(r.div1Rule) ? r.div1Rule : null;
        return [r.id, { div1, cover: div1 === "cover" ? parseCover(r.div1Cover) : [], noSubIn: !!Number(r.noSubIn) }];
      })
    );
  } catch {
    return new Map();
  }
}

export async function readReserveRule(prisma, driverId) {
  return (await readReserveRules(prisma, [driverId])).get(driverId) || NO_RULE;
}

// Write what was sent and leave the rest. `div1` is "never", "cover" or
// anything else for "no rule"; `cover` a list of driver ids; `noSubIn` a
// boolean. Returns the rule as stored.
export async function writeReserveRule(prisma, driverId, { div1, cover, noSubIn } = {}) {
  const current = await readReserveRule(prisma, driverId);
  const next = {
    div1: div1 === undefined ? current.div1 : DIV1_RULES.includes(div1) ? div1 : null,
    cover: cover === undefined ? current.cover : [...new Set((cover || []).map(String).filter(Boolean))].slice(0, MAX_COVER),
    noSubIn: noSubIn === undefined ? current.noSubIn : !!noSubIn,
  };
  // The list belongs to "cover" alone; with any other rule it is dropped, so
  // an old list never comes back with a rule set months later.
  if (next.div1 !== "cover") next.cover = [];
  await prisma.$executeRawUnsafe(
    `UPDATE "Driver" SET "div1Rule" = ?, "div1Cover" = ?, "noSubIn" = ? WHERE "id" = ?`,
    next.div1,
    next.cover.length ? JSON.stringify(next.cover) : null,
    next.noSubIn ? 1 : 0,
    driverId
  );
  return next;
}

// The drivers a "cover" list may name: of the same season, with a seat of
// their own, and not the reserve themselves. Returns the ids that pass.
export async function validCoverIds(prisma, driver, ids) {
  const wanted = [...new Set((ids || []).map(String).filter(Boolean))].filter((id) => id !== driver.id);
  if (!wanted.length) return [];
  const rows = await prisma.driver.findMany({
    where: { id: { in: wanted }, seasonId: driver.seasonId },
    select: { id: true, team: { select: { tier: true } } },
  });
  const ok = new Set(rows.filter((r) => r.team?.tier !== 0).map((r) => r.id));
  return wanted.filter((id) => ok.has(id)).slice(0, MAX_COVER);
}

// The same person's new row in another season's Reserve pool takes the rule
// along (the sign-up that adds a known member to next season's pool, the
// season carry-over). A "cover" list is translated to the same people's rows
// in the new season; whoever has none there drops off it. Best-effort.
export async function carryReserveRule(prisma, fromDriverId, toDriver) {
  try {
    if (!fromDriverId || !toDriver?.id) return null;
    const rule = (await readReserveRules(prisma, [fromDriverId])).get(fromDriverId);
    if (!rule) return null;
    let cover = [];
    if (rule.div1 === "cover" && rule.cover.length) {
      const { byDriver, byPerson } = await getPersonGroups(prisma);
      const rows = await prisma.driver.findMany({
        where: { seasonId: toDriver.seasonId, id: { in: rule.cover.flatMap((id) => byPerson.get(byDriver.get(id)) || []) } },
        select: { id: true },
      });
      const here = new Set(rows.map((r) => r.id));
      cover = rule.cover
        .map((id) => (byPerson.get(byDriver.get(id)) || []).find((sibling) => here.has(sibling)))
        .filter(Boolean);
    }
    return await writeReserveRule(prisma, toDriver.id, { div1: rule.div1, cover, noSubIn: rule.noSubIn });
  } catch {
    return null;
  }
}

// --- New drivers ------------------------------------------------------------

// Whether a newcomer starts with "no Division 1 seat". Default: no.
export async function readNewDriverRule(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const v = row?.value ? JSON.parse(row.value) : null;
    return { noDiv1: v?.newDriversNoDiv1 === true };
  } catch {
    return { noDiv1: false };
  }
}

export async function writeNewDriverRule(prisma, { noDiv1 }) {
  const value = JSON.stringify({ newDriversNoDiv1: !!noDiv1 });
  await prisma.setting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
  return { noDiv1: !!noDiv1 };
}

// A row the site just made for a newcomer: give it the starting rule. Only in
// a season with two divisions. In a season with one, every seat is a Division
// 1 seat, and the rule would shut a newcomer out of the Driver Market there.
// Best-effort: the sign-up stands either way. Returns true when a rule was set.
export async function applyNewDriverRule(prisma, driver) {
  try {
    if (!driver?.id || !driver.seasonId) return false;
    if (!(await readNewDriverRule(prisma)).noDiv1) return false;
    if (!(await seasonHasDivision2(prisma, driver.seasonId))) return false;
    await writeReserveRule(prisma, driver.id, { div1: "never" });
    return true;
  } catch {
    return false;
  }
}

// --- Who is out --------------------------------------------------------------

// Of `driverIds`, the ones who are out of this race: they declined, or their
// seat is on the Driver Market (open or already given to somebody).
export async function driversOut(prisma, raceId, driverIds) {
  const ids = [...new Set((driverIds || []).filter(Boolean))];
  if (!raceId || !ids.length) return new Set();
  const [declined, offers] = await Promise.all([
    prisma.raceRsvp.findMany({ where: { raceId, driverId: { in: ids }, status: "DECLINED" }, select: { driverId: true } }),
    prisma.seatOffer.findMany({
      where: { raceId, driverId: { in: ids }, status: { not: "CANCELLED" } },
      select: { driverId: true },
    }),
  ]);
  return new Set([...declined, ...offers].map((r) => r.driverId));
}

// "13bot, Siggsta, Timmis or Takoda"
function orList(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

async function coverNames(prisma, ids) {
  if (!ids.length) return [];
  const rows = await prisma.driver.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  return ids.map((id) => nameOf.get(id)).filter(Boolean);
}

// --- The verdict ---------------------------------------------------------------

const isReserve = (driver) => (driver?.team ? driver.team.tier === 0 : driver?.tier === 0);

// May this reserve take over this seat? Returns null when they may, or the
// sentence that tells them why not. `driver` needs id, seasonId and its team
// (or tier); `race` needs id, seasonId and isSpecialEvent; `team` is the
// seat's team (its tier says which division the seat is in).
//
// `rule` and `twoDivisions` can be handed in by a caller that already read
// them (the market feed asks for every open seat at once).
export async function seatBlock(prisma, race, team, driver, { rule = null, twoDivisions = null } = {}) {
  if (!race?.id || !driver?.id || race.isSpecialEvent || !isReserve(driver)) return null;
  const mine = rule || (await readReserveRule(prisma, driver.id));
  const ask = "The admins set that for you, so ask them on Discord if it looks wrong";
  if (mine.noSubIn) return `You can't take over a seat. ${ask}`;
  // A Division 2 seat is open to every reserve who may sub in at all.
  if (team?.tier === DIV2_TIER || !mine.div1) return null;
  const two = twoDivisions ?? (await seasonHasDivision2(prisma, race.seasonId));
  // A season with one division has no "Division 1 seat" to name.
  const seat = two ? "a Division 1 seat" : "a seat";
  if (mine.div1 === "never") return `You can't take ${seat}. ${ask}`;
  // "cover": open as soon as one of the named drivers is out.
  if ((await driversOut(prisma, race.id, mine.cover)).size) return null;
  const names = await coverNames(prisma, mine.cover);
  if (!names.length) return `You can't take ${seat}. ${ask}`;
  return `You can only take ${seat} when ${orList(names)} isn't racing. ${
    names.length === 1 ? "They haven't" : "None of them has"
  } said no to this race`;
}
