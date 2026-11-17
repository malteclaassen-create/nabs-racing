// ---------------------------------------------------------------------------
// What is on a race photo, so the season story (seasonReviewService.js) only
// shows a picture where it fits what the slide says: the driver's best race
// with their car in it, a crash from the race they had most contact in, both
// cars of their team together on the team-mate slide.
//
// The tags live in data/racePhotoTags.json, keyed by the photo's file name
// (the gallery's own stable name, see racePhotos.js). They were set by
// looking at each picture; a photo without tags is simply never picked.
//
// A tag: { kind, teams, pair, focus, quality }
//   kind     crash | battle | start | solo | pack | podium | pits | other
//   teams    team ids clearly visible
//   pair     a team whose two cars are both in the picture
//   focus    the team of the car the picture is about
//   quality  hero | ok | weak (weak ones are never shown)
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readRacePhotos, racePhotoUrl } from "./racePhotos.js";

const KINDS = new Set(["crash", "battle", "start", "solo", "pack", "podium", "pits", "other"]);
const QUALITY = new Set(["hero", "ok", "weak"]);
const TEAM_ID = /^[a-z0-9_-]{1,64}$/i;

export function cleanTag(t) {
  if (!t || typeof t !== "object") return null;
  const kind = KINDS.has(t.kind) ? t.kind : "other";
  const quality = QUALITY.has(t.quality) ? t.quality : "ok";
  const teams = Array.isArray(t.teams) ? [...new Set(t.teams.filter((x) => typeof x === "string" && TEAM_ID.test(x)))] : [];
  const team = (x) => (typeof x === "string" && TEAM_ID.test(x) ? x : null);
  return { kind, quality, teams, pair: team(t.pair), focus: team(t.focus) };
}

let cache = null;
export function photoTags() {
  if (cache) return cache;
  cache = new Map();
  try {
    const file = fileURLToPath(new URL("../data/racePhotoTags.json", import.meta.url));
    const list = JSON.parse(readFileSync(file, "utf8"));
    for (const row of Array.isArray(list) ? list : []) {
      const tag = cleanTag(row);
      if (tag && typeof row.file === "string") cache.set(row.file, tag);
    }
  } catch {
    /* no tags shipped: no photos in the story */
  }
  return cache;
}

// The tagged, showable photos of the given races, in gallery order.
export async function taggedPhotos(prisma, races) {
  const tags = photoTags();
  if (!tags.size) return [];
  const out = [];
  for (const { raceId, round } of races) {
    const photos = await readRacePhotos(prisma, raceId);
    for (const p of photos) {
      const tag = tags.get(p.file);
      if (!tag || tag.quality === "weak") continue;
      out.push({ raceId, round, url: racePhotoUrl(p.file), ...tag });
    }
  }
  return out;
}
