import { Router } from "express";
import prisma from "../lib/prisma.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";

const router = Router();

// GET /api/seasons/teaser -> the next ANNOUNCED upcoming season, for the
// "Coming up" strip on Home/Welcome — or null. Works for PRIVATE seasons too,
// on purpose: the admin flips "Announce" (Seasons tab) to advertise a season
// before it becomes browsable, and this deliberately leaks ONLY the teaser
// facts (name, game, opener track + date), never rosters or results.
router.get("/teaser", async (req, res, next) => {
  try {
    const [active, rows] = await Promise.all([
      prisma.season.findFirst({ where: { isActive: true }, select: { number: true } }),
      prisma
        .$queryRawUnsafe(`SELECT "id","number","name","game" FROM "Season" WHERE "isAnnounced" = 1 ORDER BY "number" ASC`)
        .catch(() => []),
    ]);
    // Only a season AHEAD of the running one may announce itself (a stale flag
    // on an activated or archived season is simply ignored).
    const teased = rows.find((r) => !active || Number(r.number) > active.number);
    if (!teased) return res.json(null);
    const firstRace = await prisma.race.findFirst({
      where: { seasonId: teased.id, isSpecialEvent: false, number: { not: null }, isCompleted: false },
      orderBy: { number: "asc" },
      select: { track: true, date: true },
    });
    res.json({
      number: Number(teased.number),
      name: teased.name,
      game: teased.game || null,
      firstRace: firstRace ? { track: firstRace.track, date: firstRace.date } : null,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/seasons -> all seasons, newest first (for the public season switcher
// and season-aware copy: the Welcome page reads dropWorst/teamDropWorst/
// pointsTable so its rules texts always match the season being shown).
// Private (unpublished) seasons are hidden from the public; a signed-in admin
// sees them all (with isPublic) so the admin season switcher can reach them.
router.get("/", async (req, res, next) => {
  try {
    const isAdmin = isAdminRequest(req);
    const [seasons, raw, priv] = await Promise.all([
      prisma.season.findMany({
        orderBy: { number: "desc" },
        select: { id: true, number: true, name: true, game: true, isActive: true, dropWorst: true, pointsTable: true },
      }),
      // teamDropWorst / teamDropMode / isPublic aren't in the generated client yet -> raw read.
      prisma.$queryRawUnsafe(`SELECT "id", "teamDropWorst", "teamDropMode", "isPublic" FROM "Season"`).catch(() => []),
      getPrivateSeasonIds(prisma),
    ]);
    const rawById = new Map(raw.map((r) => [r.id, r]));
    const visible = isAdmin ? seasons : seasons.filter((s) => !priv.has(s.id));
    res.json(
      visible.map((s) => {
        const extra = rawById.get(s.id) || {};
        return {
          ...s,
          pointsTable: s.pointsTable ? JSON.parse(s.pointsTable) : null,
          teamDropWorst: extra.teamDropWorst == null ? null : Number(extra.teamDropWorst),
          teamDropMode: extra.teamDropMode === "rounds" ? "rounds" : null,
          isPublic: extra.isPublic == null ? true : !!Number(extra.isPublic),
        };
      })
    );
  } catch (e) {
    next(e);
  }
});

export default router;
