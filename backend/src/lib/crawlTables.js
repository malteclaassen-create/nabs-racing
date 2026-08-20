// ---------------------------------------------------------------------------
// The NUMBERS a page shows, written into the HTML the server delivers.
//
// lib/crawlLinks.js put the site's own links into the delivered document, which
// fixed "found, never fetched". What it could not fix is what a fetched page is
// then WORTH: /drivers went out as forty driver names separated by dots, and a
// championship table read by a machine as a word list. Nothing in the document
// said that Takoda leads with 57 points, that Brawn GP is a team here, or that
// Watkins Glen was round two — every number on this site was assembled by
// JavaScript in the browser, and a young domain does not get much of Google's
// rendering budget.
//
// So the tables come out as tables. Same rule as the link block, and it is the
// only rule that matters here:
//
//   MIRROR THE PAGE. Every row is a row the reader gets at that address, in the
//   order the page puts it in, filtered the way the page filters it by default
//   (the standings leave out the reserves who never drove — utils/standingsRow).
//   Fewer columns than the page has is fine; a number the reader cannot see is
//   not, and the punishment for that is removal from the index.
//
// CACHED for ten minutes, per season, exactly like lib/siteIndex.js and for the
// same reason: this runs on every page render, and a standings table costs six
// queries and a full scoring pass. Ten minutes stale is invisible — React
// replaces the whole block the moment the app boots.
// ---------------------------------------------------------------------------
import {
  getDriverStandings,
  getT1ConstructorStandings,
  getT2ConstructorStandings,
} from "../services/standingsService.js";
import { isIdleReserve } from "./standingsRow.js";
import { readRaceTypes } from "./raceTypes.js";

const TTL_MS = 10 * 60 * 1000;
// Seasons are counted in single digits and each one holds a handful of entries,
// so this is a ceiling nothing real approaches — it is here so a crawler walking
// every archived season cannot grow the map without end.
const MAX_ENTRIES = 64;

const cache = new Map();

// Called when a result is saved, alongside invalidateSiteIndex(). Unwired for
// now for the same reason that one is: the TTL already bounds the staleness.
export function invalidateCrawlTables() {
  cache.clear();
}

// Never throws and never leaves a page without an answer: a failed rebuild
// falls back to the stale value, and a first failure to null, which every
// caller reads as "no table, keep the plain link list".
async function cached(key, build) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  try {
    const value = await build();
    if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
      cache.delete(cache.keys().next().value); // oldest out, insertion order
    }
    cache.set(key, { at: now, value });
    return value;
  } catch {
    return hit?.value ?? null;
  }
}

const pos = (n) => (n == null ? "" : `P${n}`);
const driverHref = (base, id) => `${base}/drivers/${encodeURIComponent(id)}`;
const teamHref = (base, id) => `${base}/constructors/${encodeURIComponent(id)}`;

// The season's driver standings, computed once and shared. The driver and team
// pages read this too (lib/crawlEntities.js) rather than each running the
// scoring pass again for the one row they need.
export function seasonStandings(prisma, seasonId) {
  if (!seasonId) return Promise.resolve(null);
  return cached(`standings:${seasonId}`, async () => {
    const data = await getDriverStandings(prisma, seasonId);
    return data?.standings?.length ? data : null;
  });
}

// Round number -> circuit, for the tables that name a round (a driver's season,
// the calendar). Training sessions are left out, the same set lib/siteIndex.js
// lists and the same set the standings score.
export function seasonRounds(prisma, seasonId) {
  if (!seasonId) return Promise.resolve(null);
  return cached(`rounds:${seasonId}`, async () => {
    const races = await prisma.race.findMany({
      where: { seasonId },
      select: { id: true, number: true, track: true },
      orderBy: { number: "asc" },
    });
    const types = await readRaceTypes(
      prisma,
      races.map((r) => r.id)
    ).catch(() => new Map());
    const byNumber = new Map();
    for (const r of races) {
      if ((types.get(r.id) || "CHAMPIONSHIP") === "TRAINING") continue;
      if (r.number != null) byNumber.set(r.number, r.track || "");
    }
    return byNumber.size ? byNumber : null;
  });
}

// /drivers — the championship table, in championship order.
//
// Re-numbered 1..n after the idle reserves come out, because that is what the
// page does: its P-numbers count the drivers actually in the championship, and
// a block claiming P14 where the table on screen says P11 is a block that
// disagrees with the page it mirrors.
export function driverTable(prisma, seasonId, base) {
  if (!seasonId) return Promise.resolve(null);
  return cached(`driverTable:${base}:${seasonId}`, async () => {
    const data = await getDriverStandings(prisma, seasonId);
    const rows = (data?.standings || []).filter((r) => !isIdleReserve(r));
    if (!rows.length) return null;
    return {
      columns: ["Pos", "Driver", "Team", "Pts"],
      rows: rows.map((r, i) => [
        pos(i + 1),
        r.driverId ? { href: driverHref(base, r.driverId), label: r.name } : r.name,
        r.team?.id ? { href: teamHref(base, r.team.id), label: r.team.name } : r.team?.name || "",
        String(r.total ?? 0),
      ]),
    };
  });
}

// One tier's constructor table, shared with the team pages (a team's own page
// prints its championship position and points, and that is this table's row).
export function constructorStandings(prisma, seasonId, tier) {
  if (!seasonId || (tier !== 1 && tier !== 2)) return Promise.resolve(null);
  return cached(`teams:${tier}:${seasonId}`, async () => {
    const get = tier === 1 ? getT1ConstructorStandings : getT2ConstructorStandings;
    const data = await get(prisma, seasonId);
    return data?.standings?.length ? data : null;
  });
}

// /constructors — one table per tier the season actually fields, titled the way
// the page titles them. A single-tier season gets one table and no tier name,
// because the page shows no tier switcher either.
export function constructorTables(prisma, seasonId, base, seasonName) {
  if (!seasonId) return Promise.resolve(null);
  return cached(`teamTable:${base}:${seasonId}:${seasonName || ""}`, async () => {
    const [t1, t2] = await Promise.all([
      constructorStandings(prisma, seasonId, 1),
      constructorStandings(prisma, seasonId, 2),
    ]);
    const build = (title, data) => {
      const rows = data?.standings || [];
      if (!rows.length) return null;
      return {
        title,
        columns: ["Pos", "Team", "Pts"],
        rows: rows.map((r) => [
          pos(r.position),
          r.teamId ? { href: teamHref(base, r.teamId), label: r.name } : r.name,
          String(r.total ?? 0),
        ]),
      };
    };
    const both = [t1, t2].filter((d) => d?.standings?.length).length === 2;
    const tables = [
      build(both ? "Tier 1" : `${seasonName || "Season"} teams`, t1),
      both ? build("Tier 2", t2) : null,
    ].filter(Boolean);
    return tables.length ? tables : null;
  });
}
