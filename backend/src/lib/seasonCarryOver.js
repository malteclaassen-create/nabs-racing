// ---------------------------------------------------------------------------
// "Who comes back?" The season wizard's way of bringing last season's field
// over without dragging the whole reserve sign-up list along.
//
// The old one-click copy (clone-roster) took every driver row of the source
// season. That is right for the seat holders and wrong for most reserves: the
// pool collects everybody who ever signed up once, and most of them never
// drove a lap. Copied blindly they sit in the new season as dead rows the
// admin then deletes by hand.
//
// So the wizard first asks. readCarryOver lists the source season's people per
// team with what decides the answer (a seat or not, starts that season), and
// ticks the obvious ones: every seat holder, every reserve who raced at least
// once. A reserve who never drove stays unticked; they are not lost, the
// attendance sign-up puts them back into the Reserve pool the first time they
// answer (lib/reservePool.js, routes/events.js). commitCarryOver then copies
// the teams as clone-roster always did and creates only the people the admin
// kept, each into their old team or into the Reserve pool.
//
// Division 2 rides along without knowing about it: its teams are tier 3 and
// copy like any other team, and its reserve pool is the Driver.division flag
// on a reserve row, a raw column that only exists once Division 2 is in. Both
// reads and writes of it are guarded, so on a database without the column the
// carry over simply has one pool.
// ---------------------------------------------------------------------------
import { ensureReservePool } from "./reservePool.js";
import { dbLinkDrivers, getPersonGroups } from "./persons.js";
import { uniqueDriverId } from "./driverHandles.js";

export const DIV2_TIER = 3;

// A seat: a car in Division 1 (tier 1 or 2) or in Division 2 (tier 3).
export function holdsSeat(tier) {
  return tier === 1 || tier === 2 || tier === DIV2_TIER;
}

// Ticked unless the admin says otherwise: seat holders, and reserves who drove.
export function pickedByDefault(person) {
  return !person.already && (person.seat || person.starts > 0);
}

const norm = (v) =>
  String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

// Teams in the order the admin thinks of them: Division 1 by tier, Division 2,
// the Reserve pool last.
function teamRank(tier) {
  if (tier === 1) return 0;
  if (tier === 2) return 1;
  if (tier === DIV2_TIER) return 2;
  return 3;
}

// The pure part: source rows in, grouped list out. `starts` maps driver id to
// rounds driven, `divisions` driver id to 2 for the Division 2 reserve pool,
// `present` is the target season's roster ({ id, name }), `persons` the
// PersonLink lookup from getPersonGroups.
export function buildCarryOverList({ teams, drivers, starts, divisions, present = [], persons }) {
  const byDriver = persons?.byDriver || new Map();
  const takenNames = new Set(present.map((d) => norm(d.name)));
  const takenPersons = new Set(present.map((d) => byDriver.get(d.id)).filter(Boolean));
  const groups = new Map(
    teams.map((t) => [t.id, { id: t.id, name: t.name, tier: t.tier, color: t.color, people: [] }])
  );
  for (const d of drivers) {
    const team = groups.get(d.teamId);
    if (!team) continue;
    const tier = team.tier;
    const division = tier === DIV2_TIER || (tier === 0 && divisions?.get(d.id) === 2) ? 2 : 1;
    const personId = byDriver.get(d.id) || null;
    const person = {
      driverId: d.id,
      name: d.name,
      country: d.country || null,
      photoUrl: d.photoUrl || d.discordAvatar || null,
      teamId: team.id,
      teamName: team.name,
      tier,
      division,
      seat: holdsSeat(tier),
      starts: starts?.get(d.id) || 0,
      isActive: d.isActive !== false,
      // Already on the new season's roster (an earlier run, a sign-up, a hand
      // entry): shown, never created twice.
      already: (personId && takenPersons.has(personId)) || takenNames.has(norm(d.name)),
    };
    person.picked = pickedByDefault(person);
    team.people.push(person);
  }
  const list = [...groups.values()];
  for (const t of list) {
    t.people.sort((a, b) => Number(b.seat) - Number(a.seat) || b.starts - a.starts || a.name.localeCompare(b.name));
  }
  list.sort((a, b) => teamRank(a.tier) - teamRank(b.tier) || a.name.localeCompare(b.name));
  return list;
}

// Rounds each driver of the season started (DNS left out). A sprint weekend or
// a Division 2 round keeps its second classification on a child race row, so
// rounds are counted by their parent: a weekend is one start, not two.
export async function readSeasonStarts(prisma, seasonId) {
  const sql = (round) =>
    `SELECT rr."driverId" AS "driverId", COUNT(DISTINCT ${round}) AS "n"
       FROM "RaceResult" rr JOIN "Race" r ON r."id" = rr."raceId"
      WHERE r."seasonId" = ? AND rr."status" <> 'DNS'
      GROUP BY rr."driverId"`;
  let rows;
  try {
    rows = await prisma.$queryRawUnsafe(sql(`COALESCE(r."parentRaceId", r."id")`), seasonId);
  } catch {
    rows = await prisma.$queryRawUnsafe(sql(`r."id"`), seasonId).catch(() => []);
  }
  return new Map(rows.map((r) => [r.driverId, Number(r.n) || 0]));
}

// Driver id -> 2 for the reserves of the Division 2 pool. Empty when the
// column is not there (no Division 2 on this database).
export async function readPoolDivisions(prisma, seasonId) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Driver" WHERE "seasonId" = ? AND "division" = 2`,
      seasonId
    );
    return new Map(rows.map((r) => [r.id, 2]));
  } catch {
    return new Map();
  }
}

async function readSteamIds(prisma, ids) {
  const out = new Map();
  if (!ids.length) return out;
  try {
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "id", "steamId" FROM "Driver" WHERE "id" IN (${chunk.map(() => "?").join(", ")})`,
        ...chunk
      );
      for (const r of rows) if (r.steamId) out.set(r.id, r.steamId);
    }
  } catch {
    /* no column yet: the first import of the season captures them again */
  }
  return out;
}

// The preview: { teams: [{ id, name, tier, color, people: [...] }] }.
export async function readCarryOver(prisma, { fromSeasonId, targetSeasonId }) {
  const [teams, drivers, present, persons, starts, divisions] = await Promise.all([
    prisma.team.findMany({ where: { seasonId: fromSeasonId } }),
    prisma.driver.findMany({ where: { seasonId: fromSeasonId } }),
    targetSeasonId
      ? prisma.driver.findMany({ where: { seasonId: targetSeasonId }, select: { id: true, name: true } })
      : [],
    getPersonGroups(prisma),
    readSeasonStarts(prisma, fromSeasonId),
    readPoolDivisions(prisma, fromSeasonId),
  ]);
  return { teams: buildCarryOverList({ teams, drivers, starts, divisions, present, persons }) };
}

// Turn the request body's picks into a clean Map driverId -> { to, teamId }.
// to "reserve" = the Reserve pool; to "team" = a team, `teamId` naming which
// one of the SOURCE season's teams (its copy here is used), or none for the
// driver's own team. That is how a driver changes team, or a reserve gets a
// seat, in the same step.
export function parsePicks(raw) {
  const out = new Map();
  if (!Array.isArray(raw)) return out;
  for (const p of raw) {
    const id = typeof p?.driverId === "string" ? p.driverId : null;
    if (!id) continue;
    const teamId = p.to !== "reserve" && typeof p.teamId === "string" && p.teamId ? p.teamId : null;
    out.set(id, { to: p.to === "reserve" ? "reserve" : "team", teamId });
  }
  return out;
}

// Copy the teams (all of them, as clone-roster does) and create the picked
// people. `target` is the season row ({ id, number }). Returns
// { teamsCreated, driversCreated, drivers: [{ name, teamName }], skipped }.
export async function commitCarryOver(prisma, { target, fromSeasonId, picks }) {
  const suffix = `_s${target.number}`;
  const [sourceTeams, sourceDrivers, targetTeams, present, persons, divisions] = await Promise.all([
    prisma.team.findMany({ where: { seasonId: fromSeasonId } }),
    prisma.driver.findMany({ where: { seasonId: fromSeasonId } }),
    prisma.team.findMany({ where: { seasonId: target.id } }),
    prisma.driver.findMany({ where: { seasonId: target.id }, select: { id: true, name: true } }),
    getPersonGroups(prisma),
    readPoolDivisions(prisma, fromSeasonId),
  ]);

  // Teams. A team already here (an earlier run, "Teams only", the same name
  // and tier entered by hand) is used as it is rather than doubled.
  const teamMap = new Map(); // source team id -> target team row
  const byNameTier = new Map(targetTeams.map((t) => [`${t.tier}|${norm(t.name)}`, t]));
  const byId = new Map(targetTeams.map((t) => [t.id, t]));
  let teamsCreated = 0;
  for (const t of sourceTeams) {
    const newId = `${t.id}${suffix}`;
    let row = byId.get(newId) || byNameTier.get(`${t.tier}|${norm(t.name)}`) || null;
    if (!row) {
      // The id belongs to another season already (a deleted and recreated
      // season of the same number): a fresh one rather than no team.
      const id = (await prisma.team.findUnique({ where: { id: newId } })) ? `${newId}_${Date.now().toString(36)}` : newId;
      row = await prisma.team.create({
        data: { id, name: t.name, tier: t.tier, color: t.color, logoUrl: t.logoUrl, seasonId: target.id },
      });
      byNameTier.set(`${t.tier}|${norm(t.name)}`, row);
      teamsCreated++;
    }
    teamMap.set(t.id, row);
  }
  let pool = [...teamMap.values()].find((t) => t.tier === 0) || targetTeams.find((t) => t.tier === 0) || null;

  // Division 2 runs in the new season when it ran in the old one and its teams
  // came along. Guarded: no column, nothing to switch.
  if (sourceTeams.some((t) => t.tier === DIV2_TIER)) {
    await prisma
      .$executeRawUnsafe(
        `UPDATE "Season" SET "division2" = (SELECT "division2" FROM "Season" WHERE "id" = ?) WHERE "id" = ?`,
        fromSeasonId,
        target.id
      )
      .catch(() => {});
  }

  const takenNames = new Set(present.map((d) => norm(d.name)));
  const takenPersons = new Set(present.map((d) => persons.byDriver.get(d.id)).filter(Boolean));
  const chosen = sourceDrivers.filter((d) => picks.has(d.id));
  const steamIds = await readSteamIds(
    prisma,
    chosen.map((d) => d.id)
  );
  const sourceTeamById = new Map(sourceTeams.map((t) => [t.id, t]));

  const created = [];
  const skipped = [];
  for (const d of chosen) {
    const personId = persons.byDriver.get(d.id) || null;
    if ((personId && takenPersons.has(personId)) || takenNames.has(norm(d.name))) {
      skipped.push({ name: d.name, reason: "already on this season's roster" });
      continue;
    }
    const fromTeam = sourceTeamById.get(d.teamId);
    const wasDiv2 = fromTeam?.tier === DIV2_TIER || (fromTeam?.tier === 0 && divisions.get(d.id) === 2);
    const pick = picks.get(d.id);
    // An unknown team id falls back to the driver's own team, never the pool.
    const wantTeam =
      pick.to === "reserve" ? null : sourceTeamById.get(pick.teamId) || sourceTeamById.get(d.teamId) || null;
    let team;
    if (!wantTeam || wantTeam.tier === 0) {
      pool = pool || (await ensureReservePool(prisma, target.id));
      team = pool;
    } else {
      team = teamMap.get(wantTeam.id) || null;
    }
    if (!team) {
      skipped.push({ name: d.name, reason: `no team called "${wantTeam?.name || "?"}" in this season` });
      continue;
    }

    let id = `${d.id.replace(/(_s\d+)+$/, "")}${suffix}`;
    if (await prisma.driver.findUnique({ where: { id } })) id = await uniqueDriverId(prisma, d.name);
    await prisma.driver.create({
      data: {
        id,
        name: d.name,
        discordName: d.discordName,
        teamId: team.id,
        tier: team.tier,
        // Ticked means coming back, whatever the old row said at the end.
        isActive: true,
        seasonId: target.id,
        // Identity travels with the person; the season starts with no results.
        // The Discord id stays behind (unique site-wide); the person link below
        // is what makes the login reach this row.
        country: d.country,
        photoUrl: d.photoUrl,
        discordAvatar: d.discordAvatar,
        bio: d.bio,
        number: d.number,
        socials: d.socials,
      },
    });
    const steamId = steamIds.get(d.id);
    if (steamId) {
      await prisma.$executeRawUnsafe(`UPDATE "Driver" SET "steamId" = ? WHERE "id" = ?`, steamId, id).catch(() => {});
    }
    // A Division 2 driver moved to the pool waits in the Division 2 pool.
    if (team.tier === 0 && wasDiv2) {
      await prisma.$executeRawUnsafe(`UPDATE "Driver" SET "division" = 2 WHERE "id" = ?`, id).catch(() => {});
    }
    await dbLinkDrivers(prisma, [d.id, id]).catch(() => {});
    takenNames.add(norm(d.name));
    if (personId) takenPersons.add(personId);
    created.push({ name: d.name, teamName: team.name });
  }
  return { teamsCreated, driversCreated: created.length, drivers: created, skipped };
}
