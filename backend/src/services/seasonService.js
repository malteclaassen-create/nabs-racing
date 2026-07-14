// ---------------------------------------------------------------------------
// Season helpers. The public site shows ONE season at a time: the active one
// by default, or a specific season when the client asks for it (?season=N).
// Everything season-scoped (teams, drivers, races, standings) is filtered
// through the id resolved here, so older seasons stay readable as an archive.
// ---------------------------------------------------------------------------

// --- season privacy (Phase 9) ----------------------------------------------
// Private seasons are hidden from every public read. isPublic is a raw-SQL
// column (may not be in the generated client), read here with a short cache so
// it costs about one query per 30s instead of one per request. The admin toggle
// invalidates it so a publish/hide takes effect on the next request.
import { getActiveSeries, resolveSeries } from "../lib/series.js";

const PRIVATE_CACHE_MS = 30_000;
let privateCache = { set: null, at: 0 };

export function invalidatePrivateSeasonCache() {
  privateCache = { set: null, at: 0 };
}

export async function getPrivateSeasonIds(prisma) {
  const now = Date.now();
  if (!privateCache.set || now - privateCache.at > PRIVATE_CACHE_MS) {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT "id" FROM "Season" WHERE "isPublic" = 0`);
      privateCache = { set: new Set(rows.map((r) => r.id)), at: now };
    } catch {
      // Column missing (fresh checkout before ensureAppSchema): nothing private.
      privateCache = { set: new Set(), at: now };
    }
  }
  return privateCache.set;
}

// The seasons (ids, ordered by number desc) of ONE series. seriesId is a
// raw-SQL column (may not be in the generated client) -> raw read. A null
// seriesId (fresh checkout before the backfill ran) means "no filter", so the
// site keeps working exactly as in single-series days.
async function seasonIdsInSeries(prisma, seriesId) {
  if (!seriesId) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Season" WHERE "seriesId" = ? ORDER BY "number" DESC`,
      seriesId
    );
    return rows.map((r) => r.id);
  } catch {
    return null;
  }
}

// The currently active season OF A SERIES (invariant since the series model:
// max. one active season per seriesId, not globally). Falls back to the
// series' highest-numbered PUBLIC season, so a public fallback never lands on
// a private one. `seriesId` null/omitted = the active (primary) series.
export async function getActiveSeason(prisma, seriesId = null) {
  if (!seriesId) {
    const series = await getActiveSeries(prisma);
    seriesId = series?.id || null;
  }
  const inSeries = await seasonIdsInSeries(prisma, seriesId);
  const active = await prisma.season.findFirst({
    where: { isActive: true, ...(inSeries ? { id: { in: inSeries } } : {}) },
  });
  if (active) return active;
  const priv = await getPrivateSeasonIds(prisma);
  const seasons = await prisma.season.findMany({
    where: inSeries ? { id: { in: inSeries } } : {},
    orderBy: { number: "desc" },
  });
  return seasons.find((s) => !priv.has(s.id)) || seasons[0] || null;
}

// Resolve a season from an optional round-number selector (e.g. a query param).
// `null`/undefined -> the active season. Returns null if nothing matches.
// Public callers use the default (includePrivate=false): a specific PRIVATE
// season number resolves to null so its data can't be reached by a crafted
// ?season=N. Admin callers pass { includePrivate: true }.
// `series` (a slug from ?series=) scopes everything to that series — season
// numbers are per-series now, so "season 1" of the GT series is a different
// row than "season 1" of the F1 league. Omitted = the active (primary) series;
// an unknown or (for non-admins) private slug resolves to null.
export async function resolveSeason(prisma, seasonNumber, { includePrivate = false, series } = {}) {
  const seriesRow = await resolveSeries(prisma, series, { includePrivate });
  if (series !== undefined && series !== null && series !== "" && !seriesRow) return null;
  const seriesId = seriesRow?.id || null;
  if (seasonNumber === undefined || seasonNumber === null || seasonNumber === "") {
    return getActiveSeason(prisma, seriesId);
  }
  const n = Number(seasonNumber);
  if (!Number.isFinite(n)) return getActiveSeason(prisma, seriesId);
  // Numbers are unique per series: look the season up INSIDE the series (raw
  // read — seriesId is a raw-SQL column). Without a series filter (pre-backfill
  // DB) this falls back to the old global number lookup.
  let s = null;
  if (seriesId) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Season" WHERE "number" = ? AND "seriesId" = ?`,
        n,
        seriesId
      );
      s = rows[0] ? await prisma.season.findUnique({ where: { id: rows[0].id } }) : null;
    } catch {
      s = await prisma.season.findFirst({ where: { number: n } });
    }
  } else {
    s = await prisma.season.findFirst({ where: { number: n } });
  }
  if (!s) return null;
  if (!includePrivate) {
    const priv = await getPrivateSeasonIds(prisma);
    if (priv.has(s.id)) return null;
  }
  return s;
}

// Convenience: just the id of the resolved season (or null).
export async function resolveSeasonId(prisma, seasonNumber, opts) {
  const s = await resolveSeason(prisma, seasonNumber, opts);
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
  // teamDropWorst/teamDropMode may not be in the generated client yet -> raw
  // read. teamDropWorst: null = legacy behaviour (teams inherit each driver's
  // own dropped rounds); 0 = no team drop; N = drop N per team. teamDropMode
  // says what N counts: null/'results' = single-driver round scores, 'rounds' =
  // whole team round totals (the official sheet's style).
  let teamDropWorst = null;
  let teamDropMode = null;
  if (season?.id) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "teamDropWorst", "teamDropMode" FROM "Season" WHERE "id" = ?`,
        season.id
      );
      const v = rows[0]?.teamDropWorst;
      teamDropWorst = v == null ? null : Number(v);
      teamDropMode = rows[0]?.teamDropMode === "rounds" ? "rounds" : null;
    } catch {
      teamDropWorst = null;
    }
  }
  return {
    dropWorst: Number.isInteger(season?.dropWorst) && season.dropWorst >= 0 ? season.dropWorst : 3,
    teamDropWorst,
    teamDropMode,
    pointsTable: parsePointsTable(season?.pointsTable),
    finalStandings: parseFinalStandings(season?.finalStandings),
  };
}
