import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../db.js";
import { UPLOAD_DIR } from "../config.js";

// The league's past and present series, seasons and calendars, as collected
// from Grid Finder and the YouTube channel (seed/rain-racers-history.json,
// with the posters in seed/images). Loaded into an empty database on the
// first start, or from the admin's settings into one that already has data:
// a series whose address name is taken is left alone, so loading twice adds
// nothing twice.

const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../seed");
const IMAGES_DIR = path.join(UPLOAD_DIR, "images");

// A poster from seed/images, copied next to the uploads once.
function seedImage(name) {
  if (!name || !/^[\w.-]+\.(jpe?g|png|webp)$/.test(name)) return null;
  const src = path.join(SEED_DIR, "images", name);
  if (!fs.existsSync(src)) return null;
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const target = path.join(IMAGES_DIR, `seed-${name}`);
  if (!fs.existsSync(target)) fs.copyFileSync(src, target);
  return `/api/uploads/images/seed-${name}`;
}

const json = (v) => (v == null ? null : JSON.stringify(v));

export async function loadHistory(client = prisma) {
  const { series } = JSON.parse(fs.readFileSync(path.join(SEED_DIR, "rain-racers-history.json"), "utf8"));
  const added = [];
  const skipped = [];
  for (const s of series) {
    if (await client.series.findUnique({ where: { slug: s.slug } })) {
      skipped.push(s.name);
      continue;
    }
    const row = await client.series.create({
      data: {
        name: s.name,
        slug: s.slug,
        color: s.color ?? null,
        description: s.description ?? null,
        schedule: s.schedule ?? null,
        archived: !!s.archived,
        order: s.order ?? 0,
        imageUrl: seedImage(s.image),
      },
    });
    for (const season of s.seasons) {
      const created = await client.season.create({
        data: {
          seriesId: row.id,
          name: season.name,
          description: season.description ?? null,
          imageUrl: seedImage(season.image),
          isCurrent: !!season.isCurrent,
          pointsMode: season.pointsMode === "REVERSE" ? "REVERSE" : "TABLE",
          pointsTable: json(season.pointsTable),
          raceTables: json(season.raceTables),
          qualiPointsTable: json(season.qualiPointsTable),
          dropWorst: season.dropWorst ?? 0,
        },
      });
      for (const r of season.rounds) {
        await client.race.create({
          data: {
            seasonId: created.id,
            round: r.round,
            name: r.name,
            track: r.track ?? "",
            mysteryTrack: !!r.mysteryTrack,
            car: r.car ?? null,
            startsAt: new Date(r.startsAt),
            notes: r.notes ?? null,
            raceCount: r.raceCount ?? 1,
            imageUrl: seedImage(r.image),
            videoUrl: r.videoUrl ?? null,
            timetable: r.timetable?.length ? json(r.timetable) : null,
            pointsTable: json(r.pointsTable),
          },
        });
      }
    }
    added.push(s.name);
  }
  return { added, skipped };
}

// On start: an empty database gets the history (unless SEED_HISTORY=off).
export async function loadHistoryIfEmpty() {
  if (process.env.SEED_HISTORY === "off") return;
  if ((await prisma.series.count()) > 0) return;
  const { added } = await loadHistory();
  if (added.length) console.log(`Loaded the Rain Racers history: ${added.join(", ")}.`);
}
