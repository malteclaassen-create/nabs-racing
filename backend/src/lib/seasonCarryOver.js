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
// Before the people comes a teams step (parseTeamPlan / commitTeamPlan): which
// of last season's teams carry on, in which division, which are new, and
// whether the season runs Division 2 at all (lib/divisions.js). Division 2
// teams are tier 3; its reserves sit in the same pool team with
// Driver.division = 2. The people list then offers the new season's teams and
// both sides of the pool. Without a teams step (a season with no teams yet)
// the people step still copies every team, as clone-roster did.
// ---------------------------------------------------------------------------
import { ensureReservePool } from "./reservePool.js";
import { dbLinkDrivers, getPersonGroups } from "./persons.js";
import { uniqueDriverId } from "./driverHandles.js";
import { DIV2_TIER, seasonHasDivision2, writeSeasonDivision2 } from "./divisions.js";

export { DIV2_TIER };

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
    teams.map((t) => [t.id, { id: t.id, name: t.name, tier: t.tier, color: t.color, logoUrl: t.logoUrl || null, people: [] }])
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

// Which team of the new season each team of the old one became: the copy by
// id (`<id>_s<N>`), else the same name in the same tier, else the same name in
// any tier (the teams step may have moved it, say into Division 2). The pool
// maps to the pool. Map source team id -> target team row.
export function matchTeams(sourceTeams, targetTeams, suffix) {
  const out = new Map();
  const byId = new Map(targetTeams.map((t) => [t.id, t]));
  const pool = targetTeams.find((t) => t.tier === 0) || null;
  for (const s of sourceTeams) {
    let hit = null;
    if (s.tier === 0) hit = pool;
    else
      hit =
        byId.get(`${s.id}${suffix}`) ||
        targetTeams.find((t) => t.tier === s.tier && norm(t.name) === norm(s.name)) ||
        targetTeams.find((t) => t.tier !== 0 && norm(t.name) === norm(s.name)) ||
        null;
    if (hit) out.set(s.id, hit);
  }
  return out;
}

// The preview: { teams: [{ id, name, tier, color, targetTeamId, people }],
// targetTeams, division2 }. `targetTeams` is what the new season already has
// (filled by the teams step), `targetTeamId` the team of the new season the
// old team's drivers go to by default, `division2` whether the new season runs
// Division 2 (then the Reserve pool has a Division 2 side).
export async function readCarryOver(prisma, { fromSeasonId, target }) {
  const targetSeasonId = target?.id || null;
  const [teams, drivers, present, persons, starts, divisions, targetTeams, division2] = await Promise.all([
    prisma.team.findMany({ where: { seasonId: fromSeasonId } }),
    prisma.driver.findMany({ where: { seasonId: fromSeasonId } }),
    targetSeasonId
      ? prisma.driver.findMany({ where: { seasonId: targetSeasonId }, select: { id: true, name: true } })
      : [],
    getPersonGroups(prisma),
    readSeasonStarts(prisma, fromSeasonId),
    readPoolDivisions(prisma, fromSeasonId),
    targetSeasonId ? prisma.team.findMany({ where: { seasonId: targetSeasonId } }) : [],
    seasonHasDivision2(prisma, targetSeasonId),
  ]);
  const list = buildCarryOverList({ teams, drivers, starts, divisions, present, persons });
  const matched = matchTeams(teams, targetTeams, `_s${target?.number ?? ""}`);
  for (const t of list) t.targetTeamId = matched.get(t.id)?.id || null;
  const shown = targetTeams
    .map((t) => ({ id: t.id, name: t.name, tier: t.tier, color: t.color, logoUrl: t.logoUrl || null }))
    .sort((a, b) => teamRank(a.tier) - teamRank(b.tier) || a.name.localeCompare(b.name));
  return { teams: list, targetTeams: shown, division2 };
}

// A team id for a new team: its name in id form plus the season, `_2`, `_3`
// on the end when taken. Kept to letters, digits and _ (the id becomes the
// logo's file name).
async function freshTeamId(prisma, name, suffix) {
  const base =
    String(name || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "team";
  let id = `${base}${suffix}`;
  for (let i = 2; await prisma.team.findUnique({ where: { id } }); i++) id = `${base}${suffix}_${i}`;
  return id;
}

const TEAM_TIERS = new Set([1, 2, DIV2_TIER]);
const HEX = /^#[0-9a-f]{6}$/i;

// The teams step: body { teams: [{ sourceId, tier }], newTeams: [{ name, tier,
// color }], division2 } -> clean lists, or { error }.
export function parseTeamPlan(body) {
  const division2 = !!body?.division2;
  const teams = [];
  for (const t of Array.isArray(body?.teams) ? body.teams : []) {
    if (typeof t?.sourceId !== "string" || !t.sourceId) continue;
    const tier = Number(t.tier);
    if (!TEAM_TIERS.has(tier)) return { error: "Each team needs Tier 1, Tier 2 or Division 2" };
    teams.push({ sourceId: t.sourceId, tier });
  }
  const newTeams = [];
  for (const t of Array.isArray(body?.newTeams) ? body.newTeams : []) {
    const name = String(t?.name || "").trim().slice(0, 60);
    if (!name) continue;
    const tier = Number(t.tier);
    if (!TEAM_TIERS.has(tier)) return { error: `${name} needs Tier 1, Tier 2 or Division 2` };
    newTeams.push({ name, tier, color: HEX.test(t?.color || "") ? t.color : "#64748b" });
  }
  if (!division2 && [...teams, ...newTeams].some((t) => t.tier === DIV2_TIER)) {
    return { error: "Switch Division 2 on for this season before giving it Division 2 teams" };
  }
  return { teams, newTeams, division2 };
}

// Create the new season's teams from the plan: the kept old teams (in the tier
// picked for them), the new ones, and the Reserve pool. A team the season has
// already (same name and tier) is left as it is. Also switches Division 2 on
// or off for the season. Returns { teamsCreated }.
export async function commitTeamPlan(prisma, { target, fromSeasonId, plan }) {
  const suffix = `_s${target.number}`;
  const [sourceTeams, targetTeams] = await Promise.all([
    fromSeasonId ? prisma.team.findMany({ where: { seasonId: fromSeasonId } }) : [],
    prisma.team.findMany({ where: { seasonId: target.id } }),
  ]);
  const have = (name, tier) => targetTeams.some((t) => t.tier === tier && norm(t.name) === norm(name));
  const sourceById = new Map(sourceTeams.map((t) => [t.id, t]));
  let teamsCreated = 0;
  const add = async (data) => {
    const row = await prisma.team.create({ data: { ...data, seasonId: target.id } });
    targetTeams.push(row);
    teamsCreated++;
  };
  for (const k of plan.teams) {
    const s = sourceById.get(k.sourceId);
    if (!s || s.tier === 0 || have(s.name, k.tier)) continue;
    const id = (await prisma.team.findUnique({ where: { id: `${s.id}${suffix}` } }))
      ? await freshTeamId(prisma, s.name, suffix)
      : `${s.id}${suffix}`;
    await add({ id, name: s.name, tier: k.tier, color: s.color, logoUrl: s.logoUrl });
  }
  for (const n of plan.newTeams) {
    if (have(n.name, n.tier)) continue;
    await add({ id: await freshTeamId(prisma, n.name, suffix), name: n.name, tier: n.tier, color: n.color });
  }
  // The pool: last season's, copied, so it keeps its name and colour.
  if (!targetTeams.some((t) => t.tier === 0)) {
    const oldPool = sourceTeams.find((t) => t.tier === 0);
    if (oldPool && !(await prisma.team.findUnique({ where: { id: `${oldPool.id}${suffix}` } }))) {
      await add({ id: `${oldPool.id}${suffix}`, name: oldPool.name, tier: 0, color: oldPool.color, logoUrl: oldPool.logoUrl });
    } else {
      await ensureReservePool(prisma, target.id);
    }
  }
  await writeSeasonDivision2(prisma, target.id, plan.division2).catch(() => {});
  return { teamsCreated };
}

// Turn the request body's picks into a clean Map driverId -> { to, teamId,
// targetTeamId, division }.
//   to "reserve": the Reserve pool; `division` 2 = its Division 2 side, 1 =
//     Division 1's, none = wherever the driver came from.
//   to "team": `targetTeamId` names a team of the NEW season (what the wizard
//     sends once the teams step has made them); `teamId` one of the OLD
//     season's teams (its copy is used); neither = the driver's own team.
export function parsePicks(raw) {
  const out = new Map();
  if (!Array.isArray(raw)) return out;
  const str = (v) => (typeof v === "string" && v ? v : null);
  for (const p of raw) {
    const id = str(p?.driverId);
    if (!id) continue;
    if (p.to === "reserve") {
      const division = Number(p.division) === 2 ? 2 : Number(p.division) === 1 ? 1 : null;
      out.set(id, { to: "reserve", teamId: null, targetTeamId: null, division });
    } else {
      out.set(id, { to: "team", teamId: str(p.teamId), targetTeamId: str(p.targetTeamId), division: null });
    }
  }
  return out;
}

// Create the picked people in the new season. When the season has no teams
// yet (no teams step), all of last season's teams are copied first, as
// clone-roster always did. `target` is the season row ({ id, number }).
// Returns { teamsCreated, driversCreated, drivers: [{ name, teamName }], skipped }.
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

  let teamsCreated = 0;
  if (!targetTeams.some((t) => t.tier !== 0)) {
    // No teams step: every team comes along as it was.
    for (const t of sourceTeams) {
      const newId = `${t.id}${suffix}`;
      if (targetTeams.some((x) => x.id === newId || (x.tier === t.tier && norm(x.name) === norm(t.name)))) continue;
      // The id belongs to another season already (a deleted and recreated
      // season of the same number): a fresh one rather than no team.
      const id = (await prisma.team.findUnique({ where: { id: newId } })) ? `${newId}_${Date.now().toString(36)}` : newId;
      const row = await prisma.team.create({
        data: { id, name: t.name, tier: t.tier, color: t.color, logoUrl: t.logoUrl, seasonId: target.id },
      });
      targetTeams.push(row);
      teamsCreated++;
    }
    // Division 2 runs in the new season when it ran in the old one.
    if (sourceTeams.some((t) => t.tier === DIV2_TIER) && (await seasonHasDivision2(prisma, fromSeasonId))) {
      await writeSeasonDivision2(prisma, target.id, true).catch(() => {});
    }
  }
  const teamMap = matchTeams(sourceTeams, targetTeams, suffix); // old team id -> new team row
  const targetById = new Map(targetTeams.map((t) => [t.id, t]));
  let pool = targetTeams.find((t) => t.tier === 0) || null;

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
    let team = null;
    if (pick.to === "team") {
      // A team of the new season by id; else the copy of the old team asked
      // for; an unknown id falls back to the driver's own team.
      const asked = pick.targetTeamId ? targetById.get(pick.targetTeamId) : null;
      const fromOld = sourceTeamById.get(pick.teamId) || fromTeam || null;
      team = asked || (fromOld ? teamMap.get(fromOld.id) : null) || null;
    }
    // The pool: asked for, a reserve staying a reserve, or a team that did not
    // carry on (they wait in the pool rather than being left out).
    if (!team || team.tier === 0) {
      pool = pool || (await ensureReservePool(prisma, target.id));
      team = pool;
    }
    const poolDivision = pick.division || (wasDiv2 ? 2 : 1);

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
    // The Division 2 side of the pool: picked, or where they came from.
    if (team.tier === 0 && poolDivision === 2) {
      await prisma.$executeRawUnsafe(`UPDATE "Driver" SET "division" = 2 WHERE "id" = ?`, id).catch(() => {});
    }
    await dbLinkDrivers(prisma, [d.id, id]).catch(() => {});
    takenNames.add(norm(d.name));
    if (personId) takenPersons.add(personId);
    created.push({ name: d.name, teamName: team.name });
  }
  return { teamsCreated, driversCreated: created.length, drivers: created, skipped };
}
