// ---------------------------------------------------------------------------
// Which team rows across seasons are the SAME team.
//
// Team ids are per season and inconsistent ("ferrari", "s6_ferrari") and there
// is no link table for teams, so the name is what travels from season to
// season (the team page's season-by-season table and its all-time drivers).
// Matching the raw name split one team into several whenever it was typed a
// little differently ("Mclaren" / "McLaren", "Redbull" / "Red Bull") or raced
// under a sponsor name for a while ("Porsche Martini" / "Porsche").
//
// So two names are the same team when they agree after case, spaces and
// punctuation are ignored, or when an admin has linked them: "Volvo Racing is
// the same team as Volvo" (Admin → Teams → Same team, other name). The links
// are one Setting blob, so a new one needs no deploy; until an admin first
// saves the list, DEFAULT_TEAM_LINKS below stand in for it.
// ---------------------------------------------------------------------------

const KEY = "team_links";
const MAX_NAME = 80;

export const squash = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// The renames known before links could be made in the admin.
export const DEFAULT_TEAM_LINKS = [
  { from: "Porsche Martini", to: "Porsche" },
  { from: "BMW Sauber", to: "Sauber" },
];

// [{ from, to }] -> Map(squashed from -> squashed to).
export function linkMap(links) {
  const map = new Map();
  for (const l of links || []) map.set(squash(l.from), squash(l.to));
  return map;
}

const DEFAULT_MAP = linkMap(DEFAULT_TEAM_LINKS);

// Links chain ("Volvo Cyan Racing" -> "Volvo Racing" -> "Volvo"), so follow
// them to the end. writeTeamLinks refuses loops; the guard is for a blob
// edited by hand.
export function teamLineageKey(name, links = DEFAULT_MAP) {
  let key = squash(name);
  const seen = new Set([key]);
  while (links.has(key)) {
    const next = links.get(key);
    if (seen.has(next)) break;
    seen.add(next);
    key = next;
  }
  return key;
}

// From the team rows of several seasons, the one row per season that is the
// same team as `name`: Map<seasonId, team>. Should a season hold two rows of
// the same team, the one spelled exactly like `name` wins.
export function sameTeamBySeason(teams, name, links = DEFAULT_MAP) {
  const key = teamLineageKey(name, links);
  const out = new Map();
  for (const t of teams) {
    if (teamLineageKey(t.name, links) !== key) continue;
    const have = out.get(t.seasonId);
    if (!have || (have.name !== name && t.name === name)) out.set(t.seasonId, t);
  }
  return out;
}

export async function readTeamLinks(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    if (!row) return DEFAULT_TEAM_LINKS;
    const arr = JSON.parse(row.value);
    if (!Array.isArray(arr)) return DEFAULT_TEAM_LINKS;
    return arr.filter((l) => l && typeof l.from === "string" && typeof l.to === "string");
  } catch {
    return DEFAULT_TEAM_LINKS;
  }
}

export async function readTeamLinkMap(prisma) {
  return linkMap(await readTeamLinks(prisma));
}

// Checks and tidies a list from the admin. Returns { links } or { error }.
// A name can only point at one team, so a later link for the same name
// replaces the earlier one.
export function cleanTeamLinks(input) {
  if (!Array.isArray(input)) return { error: "links must be a list" };
  const byFrom = new Map();
  for (const l of input) {
    const from = String(l?.from ?? "").trim().slice(0, MAX_NAME);
    const to = String(l?.to ?? "").trim().slice(0, MAX_NAME);
    if (!squash(from) || !squash(to)) return { error: "Both team names are needed" };
    if (squash(from) === squash(to)) {
      return { error: `"${from}" and "${to}" already count as the same team (capitals, spaces and punctuation are ignored)` };
    }
    byFrom.set(squash(from), { from, to });
  }
  const links = [...byFrom.values()];
  const map = linkMap(links);
  for (const l of links) {
    // A loop: following `to` leads back to `from`.
    let key = squash(l.to);
    const seen = new Set([key]);
    while (map.has(key)) {
      key = map.get(key);
      if (key === squash(l.from)) {
        return { error: `"${l.from}" → "${l.to}" would go round in a circle. Remove the other link first.` };
      }
      if (seen.has(key)) break;
      seen.add(key);
    }
  }
  return { links };
}

export async function writeTeamLinks(prisma, links) {
  const value = JSON.stringify(links);
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return links;
}

// Names that look like the same team but are not joined up yet: one squashed
// name starts or ends with the other ("Volvo Racing" / "Volvo"). Only a
// suggestion; plenty of real pairs ("Red Bull" / "Red Bull Junior") are two
// teams. `names` are the team names of one series.
export function suggestTeamLinks(names, links = DEFAULT_MAP) {
  const unique = [...new Map(names.map((n) => [squash(n), n])).entries()].filter(([k]) => k.length >= 3);
  const out = [];
  for (const [ka, a] of unique) {
    for (const [kb, b] of unique) {
      if (ka.length <= kb.length) continue;
      if (!ka.startsWith(kb) && !ka.endsWith(kb)) continue;
      // Already linked to some team: "BMW Sauber" is Sauber, not BMW.
      if (links.has(ka)) continue;
      if (teamLineageKey(a, links) === teamLineageKey(b, links)) continue;
      out.push({ from: a, to: b });
    }
  }
  return out.sort((x, y) => x.to.localeCompare(y.to) || x.from.localeCompare(y.from));
}
