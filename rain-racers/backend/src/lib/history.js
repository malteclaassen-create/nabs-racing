import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../db.js";
import { UPLOAD_DIR } from "../config.js";

// The league's past and present series, seasons and calendars, as collected
// from Grid Finder and the YouTube channel (seed/rain-racers-history.json,
// with the posters in seed/images), and the results Grid Finder has
// (seed/rain-racers-results.json). Loaded into an empty database on the
// first start, or from the admin's settings into one that already has data:
// a series whose address name is taken is left alone, and results only go
// into rounds that have none yet, so loading twice adds nothing twice.

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
const readSeed = (file) => JSON.parse(fs.readFileSync(path.join(SEED_DIR, file), "utf8"));

export async function loadHistory(client = prisma) {
  const { series } = readSeed("rain-racers-history.json");
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
  const results = await loadResults(client);
  return { added, skipped, results };
}

// The results from Grid Finder, into the rounds of the seeded seasons that
// have none yet. Drivers are found by name (or created) and put on the
// season's entry list. Returns how many rounds got results.
export async function loadResults(client = prisma) {
  const { series } = readSeed("rain-racers-results.json");
  const history = readSeed("rain-racers-history.json").series;
  const drivers = new Map((await client.driver.findMany()).map((d) => [d.name.toLowerCase(), d]));
  const driverId = async (name) => {
    const key = name.toLowerCase();
    if (!drivers.has(key)) drivers.set(key, await client.driver.create({ data: { name } }));
    return drivers.get(key).id;
  };
  let filled = 0;
  for (const [slug, seasons] of Object.entries(series)) {
    const seriesRow = await client.series.findUnique({ where: { slug } });
    if (!seriesRow) continue;
    for (const [seasonName, rounds] of Object.entries(seasons)) {
      const season = await client.season.findFirst({ where: { seriesId: seriesRow.id, name: seasonName } });
      if (!season) continue;
      // the season's qualifying points, unless the admin has set some
      const seed = history.find((x) => x.slug === slug)?.seasons.find((x) => x.name === seasonName);
      if (!season.qualiPointsTable && seed?.qualiPointsTable) {
        await client.season.update({ where: { id: season.id }, data: { qualiPointsTable: json(seed.qualiPointsTable) } });
      }
      for (const [roundNo, result] of Object.entries(rounds)) {
        const race = await client.race.findFirst({
          where: { seasonId: season.id, round: Number(roundNo) },
          include: { _count: { select: { results: true, qualifying: true } } },
        });
        if (!race || race._count.results || race._count.qualifying) continue;
        const enter = async (name) => {
          const id = await driverId(name);
          await client.entry.upsert({
            where: { seasonId_driverId: { seasonId: season.id, driverId: id } },
            create: { seasonId: season.id, driverId: id },
            update: {},
          });
          return id;
        };
        for (const [i, q] of (result.quali || []).entries()) {
          await client.qualiResult.create({ data: { raceId: race.id, driverId: await enter(q.driver), position: i + 1, bestLapMs: q.bestLapMs ?? null } });
        }
        for (const [n, rows] of (result.races || []).entries()) {
          if (n >= race.raceCount) break;
          for (const [i, r] of rows.entries()) {
            await client.result.create({
              data: {
                raceId: race.id,
                session: `R${n + 1}`,
                driverId: await enter(r.driver),
                position: i + 1,
                status: r.status || "FIN",
                laps: r.laps ?? 0,
                totalTimeMs: r.totalTimeMs ?? null,
                penaltyMs: r.penaltyMs ?? 0,
                pointsAdjust: r.pointsAdjust ?? 0,
              },
            });
          }
        }
        await client.race.update({ where: { id: race.id }, data: { importedAt: new Date() } });
        filled++;
      }
    }
  }
  return filled;
}

// On start: an empty database gets the history (unless SEED_HISTORY=off). A
// database that got the history before the results existed gets the results
// once (remembered in the settings table, so results deleted on purpose in
// the admin do not come back).
const RESULTS_LOADED = "historyResultsLoaded";
export async function loadHistoryIfEmpty() {
  if (process.env.SEED_HISTORY === "off") return;
  const done = await prisma.setting.findUnique({ where: { key: RESULTS_LOADED } });
  const remember = () => prisma.setting.upsert({ where: { key: RESULTS_LOADED }, create: { key: RESULTS_LOADED, value: "true" }, update: { value: "true" } });
  if ((await prisma.series.count()) === 0) {
    const { added, results } = await loadHistory();
    await remember();
    if (added.length) console.log(`Loaded the Rain Racers history: ${added.join(", ")} (${results} rounds with results).`);
    return;
  }
  if (done) return;
  const results = await loadResults();
  await remember();
  if (results) console.log(`Loaded the Rain Racers results into ${results} rounds.`);
}
