// ---------------------------------------------------------------------------
// Artwork a team needs for the shareable result graphic, which is a different
// job from the logo the site itself uses.
//
//   car   — the season's car, cut out, side-on. It fills the podium tiles.
//   mark  — the WIDE wordmark ("BRAWNGP", "WILLIAMS F1"). The site's own logo is
//           a square badge, drawn at 20px next to a name; stretched across the
//           middle of a results row it reads as a stray icon.
//
// Both are optional and both fall back: no mark means the square logo is used,
// no car means the tile is drawn in the team's colour. So the graphic works the
// day it is switched on and gets better as the art arrives.
//
// Kept as a Setting blob rather than columns on Team, like raceInfo and
// trackInfo: it is presentation, it is edited in one place, and it saves a
// migration for two strings. Keyed by TEAM id, which is unique across seasons,
// so last season's cars stay with last season's teams.
// ---------------------------------------------------------------------------

const KEY = "team_art";
export const ART_KINDS = ["car", "mark"];

function clean(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [teamId, art] of Object.entries(input)) {
    if (!art || typeof art !== "object") continue;
    const entry = {};
    for (const kind of ART_KINDS) {
      const v = art[kind];
      // Only our own upload paths, never an arbitrary string from the blob.
      if (typeof v === "string" && v.startsWith("/api/uploads/team-art/")) entry[kind] = v.slice(0, 300);
    }
    if (Object.keys(entry).length) out[teamId] = entry;
  }
  return out;
}

export async function readTeamArt(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    return row?.value ? clean(JSON.parse(row.value)) : {};
  } catch {
    return {};
  }
}

// Sets (or with `url = null` clears) one piece of art for one team. Returns the
// whole blob, so a caller can hand the fresh state straight back to the admin.
export async function writeTeamArt(prisma, teamId, kind, url) {
  if (!ART_KINDS.includes(kind)) throw new Error(`Unknown art kind: ${kind}`);
  const all = await readTeamArt(prisma);
  const entry = { ...(all[teamId] || {}) };
  if (url) entry[kind] = url;
  else delete entry[kind];
  if (Object.keys(entry).length) all[teamId] = entry;
  else delete all[teamId];
  const json = JSON.stringify(clean(all));
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: json }, update: { value: json } });
  return clean(all);
}
