// ---------------------------------------------------------------------------
// Copying one season's teams (and drivers) into another.
//
// The admin's "Teams only" and "Teams and drivers" buttons (season guide and
// Seasons tab, routes/admin.js clone-teams / clone-roster). The source may be
// a season of ANOTHER series: a second division races the same teams as the
// first, with its own drivers and its own standings.
//
// Team and driver ids are site-wide, but season numbers repeat across series.
// Naming a copy "<id>_s<number>" and skipping it whenever that id existed
// anywhere meant Div 2's Season 8 found every id already held by Div 1's own
// Season 8 and copied nothing at all. So a copy counts up to an id nobody
// holds, and the only thing that makes it skip is the TARGET season already
// having that team (or that driver row), which keeps a re-run harmless.
// ---------------------------------------------------------------------------

// A refusal the route answers with its status (400) instead of a 500.
export class CloneError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// The id without its season suffix, so a team travelling S6 -> S7 -> S8 does
// not grow into "mclaren_s7_s8". Only the trailing one goes: "_s7" inside a
// name is left alone, and so is a counter after it ("ferrari_s8_2").
export function teamIdBase(id) {
  return String(id).replace(/_s\d+$/i, "");
}

// A free id for a team copied into the season numbered `number`: the base,
// then this season's suffix, then a counter while somebody holds it.
export async function freeTeamId(prisma, sourceId, number) {
  const base = teamIdBase(sourceId);
  let id = `${base}_s${number}`;
  for (let n = 2; await prisma.team.findUnique({ where: { id } }); n++) id = `${base}_s${number}_${n}`;
  return id;
}

function checkSource(target, fromSeasonId) {
  if (!fromSeasonId) throw new CloneError("fromSeasonId required");
  if (fromSeasonId === target.id) throw new CloneError("Source and target season are the same");
}

// The team rows carried over: everything that is the team itself. Drivers,
// results and points stay behind.
function teamData(t, id, seasonId) {
  return { id, name: t.name, tier: t.tier, color: t.color, logoUrl: t.logoUrl, seasonId };
}

// Copies the teams of `fromSeasonId` into `target` ({ id, number }). A team
// whose name the target already has is left alone. Returns { created }.
export async function cloneTeams(prisma, target, fromSeasonId) {
  checkSource(target, fromSeasonId);
  const [sourceTeams, present] = await Promise.all([
    prisma.team.findMany({ where: { seasonId: fromSeasonId } }),
    prisma.team.findMany({ where: { seasonId: target.id }, select: { name: true } }),
  ]);
  if (sourceTeams.length === 0) throw new CloneError("Source season has no teams");
  const here = new Set(present.map((t) => t.name));

  let created = 0;
  for (const t of sourceTeams) {
    if (here.has(t.name)) continue;
    await prisma.team.create({ data: teamData(t, await freeTeamId(prisma, t.id, target.number), target.id) });
    here.add(t.name);
    created++;
  }
  return { created };
}

// Copies teams AND drivers of `fromSeasonId` into `target`: the one-click
// starting point for a new season of the same league. Drivers keep who they
// are (name, Discord name, country, photo, bio, number, socials, Steam id) and
// start the season with no results; each is person-linked to the row it came
// from, so careers, the login's season hand-over and token payouts follow.
//
// The helpers are the route's own (they read raw columns and the person
// links), passed in so this stays testable:
//   attachSteamIds(drivers)   sets d.steamId on each source row
//   linkDrivers([a, b])       records that two rows are the same person
//   uniqueDriverId(name)      a fresh driver id nobody holds
// Returns { teamsCreated, driversCreated }.
export async function cloneRoster(prisma, target, fromSeasonId, { attachSteamIds, linkDrivers, uniqueDriverId }) {
  checkSource(target, fromSeasonId);
  const [sourceTeams, sourceDrivers, present] = await Promise.all([
    prisma.team.findMany({ where: { seasonId: fromSeasonId } }),
    prisma.driver.findMany({ where: { seasonId: fromSeasonId } }),
    prisma.driver.findMany({ where: { seasonId: target.id }, select: { name: true } }),
  ]);
  if (sourceTeams.length === 0) throw new CloneError("Source season has no teams");
  // Who is on the target's roster already, by name, as the drivers-only copy
  // decides it. The id alone cannot tell: a driver whose "<id>_s<number>" was
  // held elsewhere got a fresh one, and a re-run would ask for the held id
  // again and copy them a second time.
  const onRoster = new Set(present.map((d) => d.name));

  let teamsCreated = 0;
  const teamIdMap = new Map(); // source team id -> target team id
  // A team already here (a re-run) takes its drivers back; anything else is
  // created under an id nobody holds yet, whichever series holds the rest.
  const hereByName = new Map(
    (await prisma.team.findMany({ where: { seasonId: target.id } })).map((t) => [t.name, t.id])
  );
  for (const t of sourceTeams) {
    const have = hereByName.get(t.name);
    if (have) {
      teamIdMap.set(t.id, have);
      continue;
    }
    const newId = await freeTeamId(prisma, t.id, target.number);
    await prisma.team.create({ data: teamData(t, newId, target.id) });
    teamIdMap.set(t.id, newId);
    hereByName.set(t.name, newId);
    teamsCreated++;
  }

  let driversCreated = 0;
  // Steam ids ride along. Without them the copied roster starts the season
  // blind: the result import would fall back to matching display names until
  // it captured a GUID per driver again, which is what the id is meant to avoid.
  await attachSteamIds(sourceDrivers);
  for (const d of sourceDrivers) {
    const newTeamId = teamIdMap.get(d.teamId);
    if (!newTeamId) continue; // driver of a team that wasn't copied
    if (onRoster.has(d.name)) continue; // copied on an earlier run, or put in by hand
    let newId = `${d.id}_s${target.number}`;
    const exists = await prisma.driver.findUnique({ where: { id: newId }, select: { seasonId: true } });
    if (exists?.seasonId === target.id) continue;
    // Held by a row of some other season (season numbers repeat across
    // series): a fresh id, rather than quietly leaving the driver behind.
    if (exists) newId = await uniqueDriverId(d.name);
    await prisma.driver.create({
      data: {
        id: newId,
        name: d.name,
        discordName: d.discordName,
        teamId: newTeamId,
        tier: d.tier,
        isActive: d.isActive,
        seasonId: target.id,
        country: d.country,
        photoUrl: d.photoUrl,
        discordAvatar: d.discordAvatar,
        bio: d.bio,
        number: d.number,
        socials: d.socials,
      },
    });
    if (d.steamId) {
      // Raw column (ensureAppSchema), written after the create like everywhere else.
      await prisma
        .$executeRawUnsafe(`UPDATE "Driver" SET "steamId" = ? WHERE "id" = ?`, d.steamId, newId)
        .catch(() => {});
    }
    await Promise.resolve(linkDrivers([d.id, newId])).catch(() => {});
    onRoster.add(d.name);
    driversCreated++;
  }
  return { teamsCreated, driversCreated };
}
