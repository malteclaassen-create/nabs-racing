import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getPrivateSeasonIds, getSeasonTeaser, parseFastestLapPoints } from "../services/seasonService.js";
import { resolveSeries, seasonSeriesMap } from "../lib/series.js";
import { publicCar, CAR_COLUMNS, COVERED, writeCarUnveil, writeCarUnveilAt, writeCarFilmAt, readCarEvent, ensureCarEvent } from "../lib/carUnveil.js";

const router = Router();

// GET /api/seasons/teaser?series=<slug> -> the next ANNOUNCED upcoming season
// of the series, for the "Coming up" strip on Home/Welcome — or null. Works
// for PRIVATE seasons too, on purpose: the admin flips "Announce" (Seasons
// tab) to advertise a season before it becomes browsable, and this
// deliberately leaks ONLY the teaser facts (name, game, opener track + date),
// never rosters or results. Scoped per series so the GT page never teases the
// F1 league's next season.
router.get("/teaser", async (req, res, next) => {
  try {
    const series = await resolveSeries(prisma, req.query.series, {
      includePrivate: isAdminRequest(req),
    });
    if (!series) return res.json(null);
    // Field by field, not the whole object: getSeasonTeaser also carries the
    // season's id for its server-side callers, and the teased season is usually
    // still private.
    const t = await getSeasonTeaser(prisma, series);
    // carImageUrl belongs on the list: it is the picture the teaser panel
    // shows, so an admin upload has to reach the page. It gives away no more
    // than the panel already does.
    res.json(
      t && {
        // Admins only: what the unveil buttons on the page act on. The teased
        // season is usually still private, so nobody else gets its id.
        ...(isAdminRequest(req) ? { id: t.id } : {}),
        number: t.number,
        name: t.name,
        game: t.game,
        carImageUrl: t.carImageUrl,
        carCovered: t.carCovered,
        carUnveiledAt: t.carUnveiledAt,
        carUnveilAt: t.carUnveilAt,
        carCoverUrl: t.carCoverUrl,
        carHasFilm: t.carHasFilm,
        carFilmAt: t.carFilmAt,
        carVideoUrl: t.carVideoUrl,
        serverNow: new Date().toISOString(),
        // An unveil with no season behind it (lib/carUnveil.js).
        isEvent: !!t.isEvent,
        firstRace: t.firstRace,
      }
    );
  } catch (e) {
    next(e);
  }
});

// GET /api/seasons?series=<slug> -> the series' seasons, newest first (for the
// public season switcher and season-aware copy: the Welcome page reads
// dropWorst/teamDropWorst/pointsTable so its rules texts always match the
// season being shown). No ?series= = the active (primary) series, which keeps
// the single-series behaviour identical to before.
// Private (unpublished) seasons are hidden from the public; a signed-in admin
// sees them all (with isPublic) so the admin season switcher can reach them.
router.get("/", async (req, res, next) => {
  try {
    const isAdmin = isAdminRequest(req);
    const series = await resolveSeries(prisma, req.query.series, { includePrivate: isAdmin });
    if (!series) return res.json([]);
    const [seasons, raw, priv, bySeries] = await Promise.all([
      prisma.season.findMany({
        orderBy: { number: "desc" },
        select: { id: true, number: true, name: true, game: true, isActive: true, dropWorst: true, pointsTable: true },
      }),
      // teamDropWorst / teamDropMode / isPublic / heroImageUrl / cardsEnabled
      // aren't in the generated client yet -> raw read.
      prisma.$queryRawUnsafe(`SELECT "id", "teamDropWorst", "teamDropMode", "fastestLapPoints", "isPublic", "heroImageUrl", ${CAR_COLUMNS}, "cardsEnabled" FROM "Season"`).catch(() => []),
      getPrivateSeasonIds(prisma),
      seasonSeriesMap(prisma),
    ]);
    const rawById = new Map(raw.map((r) => [r.id, r]));
    const visible = seasons.filter(
      (s) =>
        (isAdmin || !priv.has(s.id)) &&
        // Pre-backfill rows (no series map yet) stay visible everywhere.
        (bySeries.size === 0 || bySeries.get(s.id) === series.id)
    );
    res.json(
      visible.map((s) => {
        const extra = rawById.get(s.id) || {};
        return {
          ...s,
          pointsTable: s.pointsTable ? JSON.parse(s.pointsTable) : null,
          teamDropWorst: extra.teamDropWorst == null ? null : Number(extra.teamDropWorst),
          teamDropMode: extra.teamDropMode === "rounds" ? "rounds" : null,
          // Bonus for the fastest race lap (0 = none) — the rules copy reads it.
          fastestLapPoints: parseFastestLapPoints(extra.fastestLapPoints),
          isPublic: extra.isPublic == null ? true : !!Number(extra.isPublic),
          heroImageUrl: extra.heroImageUrl || null,
          ...publicCar(extra),
          // Drives the "Cards" view switch in the driver standings and the
          // rating card on the driver page. Missing column (pre-migration
          // read) reads as ON, the behaviour every season had before.
          cardsEnabled: extra.cardsEnabled == null ? true : !!Number(extra.cardsEnabled),
        };
      })
    );
  } catch (e) {
    next(e);
  }
});

// GET /api/seasons/car-unveil?series=<slug>&number=<n> -> is the season's car
// still under its cover? Asked every few seconds by a page showing the cover;
// the first answer without it starts the reveal there.
//   { covered, unveiledAt, unveilAt, serverNow, coverUrl, carImageUrl,
//     hasFilm, filmAt, carVideoUrl }
//   (the picture only once unveiled, the film only once released; serverNow
//   so every page counts down to unveilAt on the same clock)
router.get("/car-unveil", async (req, res, next) => {
  try {
    const series = await resolveSeries(prisma, req.query.series, { includePrivate: isAdminRequest(req) });
    const number = Number(req.query.number);
    if (!series || !Number.isFinite(number)) return res.status(404).json({ error: "Not found" });
    const rows = await prisma
      .$queryRawUnsafe(
        `SELECT ${CAR_COLUMNS} FROM "Season" WHERE "number" = ? AND ("seriesId" = ? OR "seriesId" IS NULL)`,
        number,
        series.id
      )
      .catch(() => []);
    // The series' own unveil answers for the number it goes by.
    const event = await readCarEvent(prisma, series.id);
    const teased = event?.carUnveil != null ? await getSeasonTeaser(prisma, series) : null;
    const row = teased?.isEvent && teased.number === number ? event : rows[0];
    if (!row) return res.status(404).json({ error: "Not found" });
    const car = publicCar(row);
    res.set("Cache-Control", "no-store");
    res.json({
      covered: car.carCovered,
      unveiledAt: car.carUnveiledAt,
      unveilAt: car.carUnveilAt,
      serverNow: new Date().toISOString(),
      coverUrl: car.carCoverUrl,
      carImageUrl: car.carImageUrl,
      hasFilm: car.carHasFilm,
      filmAt: car.carFilmAt,
      carVideoUrl: car.carVideoUrl,
    });
  } catch (e) {
    next(e);
  }
});

// Localhost only, and only with DEV_UNVEIL_SWITCH=1 in the environment: moves
// the teased season through the night for UnveilDevBar, without an admin login.
// Never set this on a server anybody else can reach.
if (process.env.DEV_UNVEIL_SWITCH === "1") {
  router.get("/dev-unveil", async (req, res, next) => {
    try {
      const series = await resolveSeries(prisma, req.query.series, { includePrivate: true });
      const row = await readCarEvent(prisma, series.id);
      res.json({ carImageUrl: row?.carImageUrl || null, carVideoUrl: row?.carVideoUrl || null });
    } catch (e) {
      next(e);
    }
  });
  router.post("/dev-unveil", async (req, res, next) => {
    try {
      const series = await resolveSeries(prisma, req.query.series, { includePrivate: true });
      const teased = await getSeasonTeaser(prisma, series);
      const id = teased && !teased.isEvent ? teased.id : await ensureCarEvent(prisma, series.id);
      const now = new Date();
      const { state } = req.body || {};
      if (state === "covered" || state === "soon") {
        const at = new Date(now);
        if (state === "covered") {
          at.setHours(19, 0, 0, 0);
          if (at <= now) at.setDate(at.getDate() + 1);
        } else {
          at.setSeconds(at.getSeconds() - 1);
        }
        await writeCarUnveil(prisma, id, COVERED);
        await writeCarUnveilAt(prisma, id, at.toISOString());
        await writeCarFilmAt(prisma, id, null);
      } else if (state === "unveiled") {
        await writeCarUnveil(prisma, id, now.toISOString());
      } else if (state === "film") {
        await writeCarFilmAt(prisma, id, now.toISOString());
      } else {
        return res.status(400).json({ error: "Unknown state" });
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
}

export default router;
