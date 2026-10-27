import prisma from "../db.js";
import { getSettings } from "./settings.js";
import { buildStandings } from "./standings.js";
import { teamAt } from "./stats.js";

// Loading what the public pages and the admin share: which season is meant,
// its rounds with everything the standings need, and the team of a driver
// at a round.

// The season asked for (?season=<id>), else the current season of the series
// asked for (?series=<slug>), else of the first series, else the newest.
export async function resolveSeason({ season, series } = {}) {
  if (season) {
    const s = await prisma.season.findUnique({ where: { id: Number(season) || 0 }, include: { series: true } });
    if (s) return s;
  }
  const seriesRow = series
    ? await prisma.series.findUnique({ where: { slug: String(series) } })
    : await prisma.series.findFirst({ orderBy: [{ order: "asc" }, { id: "asc" }] });
  if (!seriesRow) return null;
  return (
    (await prisma.season.findFirst({ where: { seriesId: seriesRow.id, isCurrent: true }, include: { series: true } })) ||
    (await prisma.season.findFirst({ where: { seriesId: seriesRow.id }, orderBy: { id: "desc" }, include: { series: true } }))
  );
}

export const resultInclude = { driver: true, team: true };

// The rounds of a season with results, qualifying and the number of "yes"
// answers, in round order.
export async function seasonRaces(seasonId) {
  if (!seasonId) return [];
  return prisma.race.findMany({
    where: { seasonId },
    include: {
      results: { include: resultInclude },
      qualifying: { include: { driver: true } },
      _count: { select: { signups: { where: { status: "in" } } } },
    },
    orderBy: [{ round: "asc" }, { startsAt: "asc" }],
  });
}

export async function seasonStandings(season, races) {
  if (!season) return buildStandings([], await getSettings());
  const list = races ?? (await seasonRaces(season.id));
  const manualPoints = await prisma.manualPoints.findMany({ where: { seasonId: season.id } });
  return buildStandings(list, await getSettings(), { season, manualPoints });
}

// Team of every driver of a season at a round, from the entry list and the
// transfers: Map(driverId -> teamId|null).
export async function teamsAtRound(seasonId, roundNo, client = prisma) {
  const [entries, transfers] = await Promise.all([
    client.entry.findMany({ where: { seasonId } }),
    client.transfer.findMany({ where: { seasonId } }),
  ]);
  const out = new Map();
  for (const entry of entries) {
    out.set(entry.driverId, teamAt({ entry, transfers: transfers.filter((t) => t.driverId === entry.driverId) }, roundNo));
  }
  return out;
}

// After an entry or a transfer changed: put every result of that driver in
// that season on the team they drove for in that round.
export async function recomputeResultTeams(client, seasonId, driverId) {
  const entry = await client.entry.findUnique({ where: { seasonId_driverId: { seasonId, driverId } } });
  const transfers = await client.transfer.findMany({ where: { seasonId, driverId } });
  // not on the entry list and never moved: the teams stored at the import stand
  if (!entry && !transfers.length) return;
  const results = await client.result.findMany({ where: { driverId, race: { seasonId } }, include: { race: true } });
  for (const r of results) {
    const teamId = teamAt({ entry, transfers }, r.race.round);
    if (teamId !== r.teamId) await client.result.update({ where: { id: r.id }, data: { teamId } });
  }
}
