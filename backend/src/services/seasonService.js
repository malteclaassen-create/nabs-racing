// ---------------------------------------------------------------------------
// Season helpers. The public site shows ONE season at a time: the active one
// by default, or a specific season when the client asks for it (?season=N).
// Everything season-scoped (teams, drivers, races, standings) is filtered
// through the id resolved here, so older seasons stay readable as an archive.
// ---------------------------------------------------------------------------

// The currently active season (falls back to the highest-numbered one).
export async function getActiveSeason(prisma) {
  const active = await prisma.season.findFirst({ where: { isActive: true } });
  if (active) return active;
  return prisma.season.findFirst({ orderBy: { number: "desc" } });
}

// Resolve a season from an optional round-number selector (e.g. a query param).
// `null`/undefined -> the active season. Returns null if nothing matches.
export async function resolveSeason(prisma, seasonNumber) {
  if (seasonNumber === undefined || seasonNumber === null || seasonNumber === "") {
    return getActiveSeason(prisma);
  }
  const n = Number(seasonNumber);
  if (!Number.isFinite(n)) return getActiveSeason(prisma);
  return prisma.season.findUnique({ where: { number: n } });
}

// Convenience: just the id of the resolved season (or null).
export async function resolveSeasonId(prisma, seasonNumber) {
  const s = await resolveSeason(prisma, seasonNumber);
  return s ? s.id : null;
}

// ---------------------------------------------------------------------------
// Per-season scoring rules (admin-editable on the Seasons tab).
// ---------------------------------------------------------------------------

// Parse a Season.pointsTable JSON string into a clean array of non-negative
// integers, or null when unset/invalid (callers then use the league default).
export function parsePointsTable(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const nums = arr.map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null;
    return nums;
  } catch {
    return null;
  }
}

// Parse a Season.finalStandings JSON string into { drivers, teams } arrays of
// { id, points }, or null when unset/invalid. Used for archived seasons whose
// official totals are stored verbatim (see standingsService). Entries missing
// an id or with a negative/non-integer points value are dropped; a section that
// ends up empty becomes []. Returns null only when the whole thing is unusable.
export function parseFinalStandings(raw) {
  if (!raw) return null;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const clean = (arr, key) =>
    (Array.isArray(arr) ? arr : [])
      .map((e) => ({ id: e?.[key], points: Number(e?.points) }))
      .filter((e) => typeof e.id === "string" && e.id && Number.isInteger(e.points) && e.points >= 0);
  const drivers = clean(obj.drivers, "driverId");
  const teams = clean(obj.teams, "teamId");
  if (drivers.length === 0 && teams.length === 0) return null;
  // Optional official per-race team points (archived seasons whose constructor
  // table is stored verbatim): { teamId: { round: points } }. Kept loosely
  // validated — the standings service only reads finite numbers from it.
  let teamPerRace = null;
  if (obj.teamPerRace && typeof obj.teamPerRace === "object") {
    teamPerRace = {};
    for (const [teamId, byRound] of Object.entries(obj.teamPerRace)) {
      if (!byRound || typeof byRound !== "object") continue;
      const clean = {};
      for (const [round, pts] of Object.entries(byRound)) {
        const n = Number(pts);
        if (Number.isFinite(n)) clean[round] = n;
      }
      teamPerRace[teamId] = clean;
    }
  }
  return { drivers, teams, teamPerRace };
}

// The effective scoring rules for a season: { dropWorst, pointsTable, finalStandings }.
// `pointsTable` is null for "league default" (pointsCalculator's table);
// `dropWorst` counts the lowest rounds dropped from totals (0 = none);
// `finalStandings` is null unless the season stores authoritative official totals.
// Works with a season row or a bare id; tolerates unknown ids (defaults).
export async function getSeasonScoring(prisma, seasonOrId) {
  let season = seasonOrId;
  if (typeof seasonOrId === "string") {
    season = await prisma.season.findUnique({ where: { id: seasonOrId } });
  }
  return {
    dropWorst: Number.isInteger(season?.dropWorst) && season.dropWorst >= 0 ? season.dropWorst : 3,
    pointsTable: parsePointsTable(season?.pointsTable),
    finalStandings: parseFinalStandings(season?.finalStandings),
  };
}
