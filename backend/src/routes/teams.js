import { Router } from "express";
import prisma from "../lib/prisma.js";
import { resolveSeasonId } from "../services/seasonService.js";
import { isAdminRequest } from "../middleware/auth.js";
import { getNameOverrides, discordIdsForDrivers } from "../lib/persons.js";
import { readDriverRoles } from "../lib/driverRoles.js";
import { stripPrivateDriverFields } from "../lib/privacy.js";
import { getT1ConstructorStandings, getT2ConstructorStandings } from "../services/standingsService.js";
import { isSeasonComplete, seasonConcluded } from "../lib/seasonComplete.js";

const router = Router();

// GET /api/teams -> all teams (with drivers) in the selected (default: active)
// season. An admin may target a private season (site preview); the public can't.
router.get("/", async (req, res, next) => {
  try {
    const admin = isAdminRequest(req);
    const seasonId = await resolveSeasonId(prisma, req.query.season, {
      includePrivate: admin,
      series: req.query.series,
    });
    const [teams, nameOverrides] = await Promise.all([
      prisma.team.findMany({
        where: { seasonId },
        include: {
          drivers: { orderBy: { name: "asc" } },
        },
        orderBy: [{ tier: "asc" }, { name: "asc" }],
      }),
      getNameOverrides(prisma),
    ]);
    // Special roles (raw-SQL column) for the role badge / admin role select.
    const allIds = teams.flatMap((t) => t.drivers.map((d) => d.id));
    const roles = await readDriverRoles(prisma, allIds);
    // Standings-hidden flag (raw-SQL column) for the admin Drivers tab toggle.
    // .catch: fresh checkout before ensureAppSchema ran.
    let hiddenSet = new Set();
    if (allIds.length) {
      const ph = allIds.map(() => "?").join(",");
      const hiddenRows = await prisma
        .$queryRawUnsafe(`SELECT "id" FROM "Driver" WHERE "hideFromStandings" = 1 AND "id" IN (${ph})`, ...allIds)
        .catch(() => []);
      hiddenSet = new Set(hiddenRows.map((r) => r.id));
    }
    // The person's EFFECTIVE Discord id: the literal value lives on one row
    // per person (unique), but login and mentions inherit it through the
    // person links — so the admin Drivers tab should show it too instead of a
    // misleading "not set" on a fresh season row. Admin-only, so the lookup is
    // skipped entirely for the public roster.
    const effectiveDiscord = admin
      ? await discordIdsForDrivers(prisma, allIds).catch(() => new Map())
      : new Map();
    // Archive rosters show the person's current name with a "raced as" note.
    // No-op for the active season (its own row already carries the current name).
    for (const t of teams) {
      for (const d of t.drivers) {
        const ov = nameOverrides.get(d.id);
        if (ov) {
          d.formerName = ov.formerName;
          d.name = ov.displayName;
        }
        d.role = roles.get(d.id) || null;
        d.hideFromStandings = hiddenSet.has(d.id);
        if (admin) {
          // Inherited from a linked season row (own column empty).
          const eff = effectiveDiscord.get(d.id) || null;
          d.inheritedDiscordUserId = !d.discordUserId && eff ? eff : null;
        } else {
          // Contact identities never leave the server for the public roster.
          // This endpoint feeds the Constructors, Live and team pages, so
          // without this every visitor's browser would download a ready-made
          // "league nickname -> real Discord and Steam account" list.
          // The admin Drivers tab and the import matcher still get them above.
          stripPrivateDriverFields(d);
        }
      }
    }
    res.json(teams);
  } catch (e) {
    next(e);
  }
});

// GET /api/teams/:id/history -> every season this team has raced, with where it
// finished the constructors' table.
//
// A team page showed one season and stopped there: no history, and none of the
// constructor titles the team had won, while a driver profile has both. The
// league has run the same names for eight seasons, so that is most of what a
// team page is for.
//
// Teams are matched across seasons by NAME within the same series. There is no
// link table for them the way PersonLink joins driver rows, and the ids are
// per-season and inconsistent ("ferrari", "s6_ferrari"), so the name is the only
// thing that actually travels. Season numbers only compare within one series, so
// the search never leaves it.
router.get("/:id/history", async (req, res, next) => {
  try {
    const team = await prisma.team.findUnique({ where: { id: req.params.id }, include: { season: true } });
    if (!team) return res.status(404).json({ error: "Team not found" });
    const seriesId = team.season?.seriesId ?? null;
    const admin = isAdminRequest(req);

    const seasons = await prisma.season.findMany({
      where: { seriesId, ...(admin ? {} : { isPublic: true }) },
      orderBy: { number: "desc" },
    });
    const siblings = await prisma.team.findMany({
      where: { name: team.name, seasonId: { in: seasons.map((s) => s.id) } },
    });
    const bySeason = new Map(siblings.map((t) => [t.seasonId, t]));

    // "Is this season's table final?" — see the note on `concluded` below.
    const active = seasons.find((s) => s.isActive) || null;
    const activeComplete = active ? await isSeasonComplete(prisma, active.id) : false;
    const isConcluded = (num) => seasonConcluded(num, active?.number ?? null, activeComplete);

    const rows = [];
    for (const season of seasons) {
      const t = bySeason.get(season.id);
      if (!t) continue;
      // Reserve rows (tier 0) have no constructors' table of their own.
      if (t.tier !== 1 && t.tier !== 2) {
        rows.push({ seasonId: season.id, seasonNumber: season.number, seasonName: season.name, teamId: t.id, tier: t.tier, position: null, points: null, of: null });
        continue;
      }
      const table = await (t.tier === 1 ? getT1ConstructorStandings : getT2ConstructorStandings)(prisma, season.id);
      const row = (table?.standings || []).find((x) => x.teamId === t.id);
      rows.push({
        seasonId: season.id,
        seasonNumber: season.number,
        seasonName: season.name,
        teamId: t.id,
        tier: t.tier,
        position: row?.position ?? null,
        points: row?.total ?? null,
        of: table?.standings?.length ?? null,
        // Whether that position is a RESULT or just today's order. An announced
        // season has every team on zero and sorts them alphabetically, so
        // without this the team first in the alphabet collected a championship
        // it has not raced for. Same rule the driver profile's seals use.
        concluded: isConcluded(season.number),
      });
    }

    // Top-three finishes, for the seal shelf — same shape the driver profile
    // uses, and only from seasons that are actually over.
    const badges = rows
      .filter((r) => r.concluded && r.position != null && r.position >= 1 && r.position <= 3)
      .map((r) => ({ position: r.position, seasonNumber: r.seasonNumber, tier: r.tier }));

    res.json({ name: team.name, seasons: rows, badges });
  } catch (e) {
    next(e);
  }
});

export default router;
