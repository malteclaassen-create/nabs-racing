// ---------------------------------------------------------------------------
// Artwork a team needs for the shareable result graphic, which is a different
// job from the logo the site itself uses.
//
//   car   — the season's car, cut out, side-on. It fills the podium tiles.
//   mark  — the WIDE wordmark ("BRAWNGP", "WILLIAMS F1"). The site's own logo is
//           a square badge, drawn at 20px next to a name; stretched across the
//           middle of a results row it reads as a stray icon.
//   badge — the square logo in the corner of a podium tile. The site's own logo
//           is what goes there by default, and it is usually right; this is for
//           the team whose logo is dark on dark, or who want a plain version on
//           the poster without changing the one the whole site uses.
//
// All three are optional and all three fall back: no badge means the site's
// logo, no mark means the site's logo too, no car means the tile is drawn in the
// team's colour. So the graphic works the day it is switched on and gets better
// as the art arrives.
//
// Kept as a Setting blob rather than columns on Team, like raceInfo and
// trackInfo: it is presentation, it is edited in one place, and it saves a
// migration for two strings. Keyed by TEAM id, which is unique across seasons,
// so last season's cars stay with last season's teams.
// ---------------------------------------------------------------------------

const KEY = "team_art";
export const ART_KINDS = ["car", "mark", "badge"];

// How the cars are framed in the podium tiles: a zoom and two offsets, one set
// for all three. Its own key rather than a fourth kind above, because it is not
// a picture and belongs to no team — it is how the poster crops whichever cars
// end up on it this week.
//
// The bounds are the same ones the sliders offer (FRAMING_LIMITS in the
// frontend's resultGraphic.js). Repeated here on purpose: this is the edge of
// the server, and it does not get to trust that a value arrived from a slider.
const FRAMING_KEY = "poster_car_framing";
const FRAMING_BOUNDS = { zoom: [1, 3], x: [-320, 320], y: [-260, 260] };
export const DEFAULT_CAR_FRAMING = { zoom: 1, x: 0, y: 0 };

function cleanFraming(input) {
  const out = { ...DEFAULT_CAR_FRAMING };
  if (!input || typeof input !== "object") return out;
  for (const [k, [min, max]] of Object.entries(FRAMING_BOUNDS)) {
    const v = Number(input[k]);
    if (Number.isFinite(v)) out[k] = Math.min(max, Math.max(min, v));
  }
  return out;
}

export async function readCarFraming(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: FRAMING_KEY } });
    return row?.value ? cleanFraming(JSON.parse(row.value)) : { ...DEFAULT_CAR_FRAMING };
  } catch {
    return { ...DEFAULT_CAR_FRAMING };
  }
}

export async function writeCarFraming(prisma, input) {
  const value = JSON.stringify(cleanFraming(input));
  await prisma.setting.upsert({
    where: { key: FRAMING_KEY },
    create: { key: FRAMING_KEY, value },
    update: { value },
  });
  return JSON.parse(value);
}

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
