// ---------------------------------------------------------------------------
// The team archive, seen as teams instead of rows.
//
// Every season has its own copy of each team (ferrari_s7, ferrari_s8, ...), so
// the "Bring one over" search used to list BMW once per season it raced. Here
// the rows of one name become one entry: the newest copy (its logo and colour
// are the current ones) plus the seasons it raced.
//
// The same lookup gives a new or renamed team its logo: call a team "Porsche"
// and it takes the logo and colour the league's newest Porsche has.
// ---------------------------------------------------------------------------

import { squash, teamLineageKey } from "./teamLineage.js";

export const DIV2_TIER = 3;
// What a team gets when nobody picked a colour (the Add team form's default).
export const PLAIN_COLOR = "#888888";

const divisionOf = (t) => (Number(t.tier) === DIV2_TIER ? 2 : 1);

// Is this logo the team's own upload? Uploads are stored under the team's id
// (/api/uploads/teams/<id>.png); a logo that points anywhere else came along
// from another team and may be swapped for a better match.
export function hasOwnLogo(team) {
  if (!team?.logoUrl) return false;
  const path = String(team.logoUrl).split("?")[0];
  return path.startsWith(`/api/uploads/teams/${team.id}.`);
}

// The team rows of earlier seasons (and the other division of this one) as one
// entry per name. `numberOf` maps seasonId -> season number.
//
// Entry: { id, name, tier, color, logoUrl, seasonId, seasonNumber, seasons,
// here: { 1, 2 } } where `id` is the row to copy (newest, preferring one with a
// logo), `seasons` every season number it raced (newest first) and `here`
// whether the target season already has the name in Division 1 / Division 2.
export function libraryEntries(teams, numberOf, targetSeasonId, q = "") {
  const needle = String(q || "").trim().toLowerCase();
  const taken = { 1: new Set(), 2: new Set() };
  for (const t of teams) {
    if (t.seasonId === targetSeasonId && t.tier !== 0) taken[divisionOf(t)].add(squash(t.name));
  }

  const groups = new Map();
  for (const t of teams) {
    if (t.tier === 0) continue; // the Reserve pool is not a team to bring over
    const key = squash(t.name);
    if (!key) continue;
    const n = numberOf.get(t.seasonId) ?? 0;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { rows: [], seasons: new Set() }));
    g.rows.push({ t, n });
    g.seasons.add(n);
  }

  const out = [];
  for (const [key, g] of groups) {
    // A name only this season has, in both divisions already, has nothing to
    // offer. One that is here in a single division can still go to the other.
    const fromElsewhere = g.rows.some(({ t }) => t.seasonId !== targetSeasonId);
    const here = { 1: taken[1].has(key), 2: taken[2].has(key) };
    if (!fromElsewhere && here[1] && here[2]) continue;
    const best = pickNewest(g.rows);
    const t = best.t;
    const hit =
      !needle ||
      g.rows.some(({ t: r }) => r.name.toLowerCase().includes(needle) || r.id.toLowerCase().includes(needle)) ||
      key.includes(squash(needle));
    if (!hit) continue;
    out.push({
      id: t.id,
      name: t.name,
      tier: t.tier,
      color: t.color,
      logoUrl: t.logoUrl || null,
      seasonId: t.seasonId,
      seasonNumber: best.n,
      seasons: [...g.seasons].sort((a, b) => b - a),
      here,
    });
  }
  return out.sort((a, b) => b.seasonNumber - a.seasonNumber || a.name.localeCompare(b.name));
}

// Newest season first; in a season the row with a logo, then Division 1.
function pickNewest(rows) {
  return [...rows].sort(
    (a, b) =>
      b.n - a.n ||
      Number(!!b.t.logoUrl) - Number(!!a.t.logoUrl) ||
      divisionOf(a.t) - divisionOf(b.t)
  )[0];
}

// The team a team called `name` takes its logo from: the newest row (other
// than `excludeId`) with a logo whose name is the same once case, spaces and
// punctuation are ignored. Failing that, a team linked to it under another
// name ("Porsche Martini" for "Porsche"). Null when no team has one.
export function logoSourceFor(teams, numberOf, name, { excludeId = null, links } = {}) {
  const exact = squash(name);
  if (!exact) return null;
  const lineage = teamLineageKey(name, links);
  const withLogo = teams
    .filter((t) => t.id !== excludeId && t.logoUrl && t.tier !== 0)
    .map((t) => ({ t, n: numberOf.get(t.seasonId) ?? 0 }));
  const same = withLogo.filter(({ t }) => squash(t.name) === exact);
  const pool = same.length ? same : withLogo.filter(({ t }) => teamLineageKey(t.name, links) === lineage);
  if (!pool.length) return null;
  return pickNewest(pool).t;
}

// What to write on `team` so it carries the logo of `source`: the logo, and
// the colour too while the team still has the plain grey nobody picked.
export function logoPatch(team, source) {
  if (!source) return null;
  const patch = {};
  if (source.logoUrl && source.logoUrl !== team.logoUrl) patch.logoUrl = source.logoUrl;
  if (source.color && String(team.color || "").toLowerCase() === PLAIN_COLOR && source.color.toLowerCase() !== PLAIN_COLOR) {
    patch.color = source.color;
  }
  return Object.keys(patch).length ? patch : null;
}
