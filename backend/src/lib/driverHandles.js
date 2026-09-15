import { resolveSeries, seasonIdsOfSeries } from "./series.js";
import { getActiveSeason, getPrivateSeasonIds } from "../services/seasonService.js";

// A person's address inside a league: /s/<series>/drivers/<handle>, the
// handle being their name in url form ("Maltegoat" -> "maltegoat"). The row
// ids behind the pages are per season and carry whatever the roster copy
// appended ("maltegoat_s8_s7"), which is nothing a visitor should read in the
// address bar. The series in the address and the selected season say which of
// the person's rows the handle means; a row id still resolves as itself, so
// every older link keeps working.
//
// Same slug rule as the admin's uniqueDriverId, so a fresh row's id and its
// handle start out identical.
export function driverHandle(name) {
  return (
    String(name || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "driver"
  );
}

// The driver row `key` means under /s/<series> with season <season> selected
// (number; null = that league's active season). Order of preference:
//   1. a row of that season whose handle (or id) is the key,
//   2. the person's latest row in the league (the page then says they did not
//      race the selected season),
//   3. the key as a plain row id, wherever it lives (older links, other league).
// Private seasons are left out unless `includePrivate` (an admin reading).
// Returns { id } or null.
export async function resolveDriverRow(prisma, key, { series = null, season = null, includePrivate = false } = {}) {
  const k = String(key || "").trim();
  if (!k) return null;
  const exact = async () => {
    const d = await prisma.driver.findUnique({ where: { id: k }, select: { id: true } });
    return d ? { id: d.id } : null;
  };
  if (!series) return exact();
  const s = await resolveSeries(prisma, series, { includePrivate: true }).catch(() => null);
  if (!s) return exact();
  const seasons = await seasonIdsOfSeries(prisma, s.id);
  if (!seasons.length) return exact();
  const priv = includePrivate ? new Set() : await getPrivateSeasonIds(prisma).catch(() => new Set());
  const visible = seasons.filter((x) => !priv.has(x.id));
  if (!visible.length) return exact();
  const numberOf = new Map(visible.map((x) => [x.id, x.number]));
  const rows = await prisma.driver.findMany({
    where: { seasonId: { in: visible.map((x) => x.id) } },
    select: { id: true, name: true, seasonId: true, isActive: true },
  });
  const mine = rows.filter((r) => r.id === k || driverHandle(r.name) === k);
  if (!mine.length) return exact();
  // Two rows of one season can answer to the same handle (a handle change
  // mid-season): the row that IS the key, else the active one, else the first.
  const pick = (list) => list.find((r) => r.id === k) || list.find((r) => r.isActive) || list[0];
  let n = season != null && Number.isFinite(Number(season)) ? Number(season) : null;
  if (n == null) {
    const active = await getActiveSeason(prisma, s.id).catch(() => null);
    n = active ? Number(active.number) : null;
  }
  if (n != null) {
    const inSeason = mine.filter((r) => numberOf.get(r.seasonId) === n);
    if (inSeason.length) return { id: pick(inSeason).id };
  }
  // Not in that season: their latest season here (among its rows the same
  // preference as above, but never an older row just because its id is the key).
  mine.sort((a, b) => (numberOf.get(b.seasonId) ?? 0) - (numberOf.get(a.seasonId) ?? 0));
  const latest = numberOf.get(mine[0].seasonId);
  return { id: pick(mine.filter((r) => numberOf.get(r.seasonId) === latest)).id };
}
