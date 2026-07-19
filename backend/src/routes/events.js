import { Router } from "express";
import prisma from "../lib/prisma.js";
import { syncRaceToDiscord } from "../services/discordService.js";
import { optionalUser, resolveDriverId, isAdminRequest } from "../middleware/auth.js";
import { resolveSeasonId, getPrivateSeasonIds } from "../services/seasonService.js";
import { resolveSeries, seasonIdsOfSeries } from "../lib/series.js";
import { readRaceFormat } from "../lib/raceFormat.js";
import { readRaceTypes } from "../lib/raceTypes.js";
import { seasonRowForDriver, dbLinkDrivers } from "../lib/persons.js";
import { ensureReservePool } from "../lib/reservePool.js";
import { readNotifySettings, attendanceOpensAt } from "../lib/notifications.js";

const router = Router();
const VALID = ["ACCEPTED", "DECLINED", "TENTATIVE"];

// Season ids whose upcoming races the events feature covers. An explicit
// ?season keeps the old single-season behaviour; otherwise EVERY season of the
// viewed series the caller may see counts (private ones admin-only) — so next
// season's races can already take sign-ups while the current season finishes.
export async function eventSeasonIds(prisma, req) {
  const admin = isAdminRequest(req);
  if (req.query.season) {
    const id = await resolveSeasonId(prisma, req.query.season, {
      includePrivate: admin,
      series: req.query.series,
    });
    return id ? [id] : [];
  }
  const series = await resolveSeries(prisma, req.query.series, { includePrivate: admin });
  const ids = series ? (await seasonIdsOfSeries(prisma, series.id)).map((s) => s.id) : [];
  if (!ids.length) {
    // Unmigrated single-series data: fall back to the active season.
    const id = await resolveSeasonId(prisma, undefined, { includePrivate: admin });
    return id ? [id] : [];
  }
  if (admin) return ids;
  const priv = await getPrivateSeasonIds(prisma);
  return ids.filter((i) => !priv.has(i));
}

// Create a Reserve-pool row for `base` (the login's linked driver row from
// another season) in `seasonId`, person-linked so career stats, login and
// @mentions keep following the same human. Used by the RSVP below: a member
// who has driven for us before may always sign up, even before the admin has
// put them on the new season's roster. Returns null only if the season is
// missing (deleted mid-request).
async function addToReservePool(prisma, base, seasonId) {
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { id: true, number: true } });
  if (!season) return null;
  const pool = await ensureReservePool(prisma, season.id);
  if (!pool) return null;

  // Season-suffixed id like the roster clone uses; uniquified just in case.
  let id = `${base.id}_s${season.number}`;
  if (await prisma.driver.findUnique({ where: { id } })) id = `${id}_${Date.now().toString(36)}`;

  const driver = await prisma.driver.create({
    data: {
      id,
      name: base.name,
      discordName: base.discordName,
      teamId: pool.id,
      tier: 0,
      isActive: true,
      seasonId: season.id,
      // Identity travels with the person (same fields as the roster clone);
      // the Discord id itself stays on the login's row — the person link
      // below is what makes login and mentions reach this row too.
      country: base.country,
      photoUrl: base.photoUrl,
      discordAvatar: base.discordAvatar,
      bio: base.bio,
      number: base.number,
      socials: base.socials,
    },
  });
  try {
    await dbLinkDrivers(prisma, [base.id, driver.id]);
  } catch {
    /* linking is best-effort; the RSVP itself must not fail on it */
  }
  return driver;
}

// GET /api/events -> upcoming races (not completed) with RSVP lists.
// Season-scoped (default: the active season) so events never mix seasons.
// An admin may target a private season (site preview); the public can't.
router.get("/", async (req, res, next) => {
  try {
    const seasonIds = await eventSeasonIds(prisma, req);
    // Championship rounds AND training sessions get RSVP (training is exactly
    // what session planning needs); special events stay announcement-only.
    const allUpcoming = await prisma.race.findMany({
      where: { isCompleted: false, seasonId: { in: seasonIds } },
      orderBy: [{ number: "asc" }, { date: "asc" }],
      include: {
        rsvps: { include: { driver: { include: { team: true } } } },
      },
    });
    const types = await readRaceTypes(prisma, allUpcoming.map((r) => r.id));
    const typeOf = (r) => types.get(r.id) || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
    const races = allUpcoming.filter((r) => typeOf(r) !== "SPECIAL");

    // Session format (raw-SQL columns) for the attendance hero.
    const format = await readRaceFormat(prisma, races.map((r) => r.id));

    // Sign-up gating + which answer columns the page shows (admin-configured).
    const notify = await readNotifySettings(prisma);

    const events = races.map((race) => {
      const grouped = { ACCEPTED: [], DECLINED: [], TENTATIVE: [] };
      for (const r of race.rsvps) {
        (grouped[r.status] || (grouped[r.status] = [])).push({
          driverId: r.driverId,
          name: r.driver.name,
          discordName: r.driver.discordName,
          country: r.driver.country || null,
          team: { name: r.driver.team.name, color: r.driver.team.color },
        });
      }
      return {
        id: race.id,
        number: race.number,
        type: typeOf(race),
        track: race.track,
        date: race.date,
        capacity: race.capacity,
        info: race.info,
        qualiMinutes: format.get(race.id)?.qualiMinutes ?? null,
        raceLaps: format.get(race.id)?.raceLaps ?? null,
        attendanceOpensAt: attendanceOpensAt(race, notify)?.toISOString() ?? null,
        visibleStatuses: notify.attendanceShow,
        counts: {
          ACCEPTED: grouped.ACCEPTED.length,
          DECLINED: grouped.DECLINED.length,
          TENTATIVE: grouped.TENTATIVE.length,
        },
        rsvps: grouped,
      };
    });

    res.json(events);
  } catch (e) {
    next(e);
  }
});

// GET /api/events/open -> { open } — is any upcoming race currently taking
// attendance answers? Drives whether the nav bar shows the Attendance item:
// it appears when a sign-up window opens (or a race is scheduled, with no
// window configured) and leaves again once the race's result is saved
// (isCompleted takes it out of the upcoming set).
router.get("/open", async (req, res, next) => {
  try {
    const seasonIds = await eventSeasonIds(prisma, req);
    const upcoming = await prisma.race.findMany({
      where: { isCompleted: false, seasonId: { in: seasonIds } },
      select: { id: true, date: true, isSpecialEvent: true },
    });
    const types = await readRaceTypes(prisma, upcoming.map((r) => r.id));
    const notify = await readNotifySettings(prisma);
    const now = Date.now();
    const open = upcoming.some((r) => {
      const type = types.get(r.id) || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
      if (type === "SPECIAL") return false;
      const opens = attendanceOpensAt(r, notify);
      return !opens || opens.getTime() <= now;
    });
    res.json({ open });
  } catch (e) {
    next(e);
  }
});

// POST /api/events/:id/rsvp  { driverId, status }
// Upserts the driver's status for the race and syncs the Discord message.
router.post("/:id/rsvp", optionalUser, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    // Identity must come from a Discord login (forgery-proof). No anonymous
    // RSVP. Resolved fresh from the DB so an admin unlink applies immediately.
    const driverId = await resolveDriverId(prisma, req.user);
    if (!driverId) return res.status(401).json({ error: "Sign in with Discord to respond" });
    if (!VALID.includes(status)) return res.status(400).json({ error: "Invalid status" });

    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    if (!race) return res.status(404).json({ error: "Race not found" });
    if (race.isCompleted) return res.status(400).json({ error: "Race already completed" });

    // The sign-up window (admin-configured) is enforced here too, so the
    // buttons can't be worked around via the API before it opens.
    const opens = attendanceOpensAt(race, await readNotifySettings(prisma));
    if (opens && opens.getTime() > Date.now()) {
      const when = new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC", weekday: "short", day: "2-digit", month: "short",
        hour: "2-digit", minute: "2-digit",
      }).format(opens);
      return res.status(403).json({ error: `Sign-up isn't open yet. It opens ${when} UTC` });
    }

    // RSVP as the person's row in the RACE's season — the login may still
    // point at another season's row (e.g. answering next season's opener
    // before ever logging in again after the season switch).
    const base = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!base) return res.status(404).json({ error: "Driver not found" });
    let driver = await seasonRowForDriver(prisma, base, race.seasonId, req.user?.discordId);
    // Known member, but no row in the race's season yet (e.g. next season's
    // roster is still being built): let them sign up anyway. Their login is
    // already tied to a real driver of this series, so we add them to the
    // season's Reserve pool on the spot — the admin then sees the sign-up AND
    // the person in the roster, and the race import checks who actually drove.
    // Accounts never linked to any driver still can't RSVP (the 401 above).
    if (!driver) driver = await addToReservePool(prisma, base, race.seasonId);
    if (!driver) return res.status(403).json({ error: "You're not on this season's roster" });

    await prisma.raceRsvp.upsert({
      where: { raceId_driverId: { raceId: race.id, driverId: driver.id } },
      update: { status },
      create: { raceId: race.id, driverId: driver.id, status },
    });

    // Fire-and-await Discord sync, but don't fail the request if Discord errors.
    const discord = await syncRaceToDiscord(prisma, race.id);
    res.json({ ok: true, discord });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/events/:id/rsvp/:driverId  -> remove a driver's RSVP
router.delete("/:id/rsvp/:driverId", optionalUser, async (req, res, next) => {
  try {
    const driverId = await resolveDriverId(prisma, req.user);
    if (!driverId) return res.status(401).json({ error: "Sign in with Discord to respond" });
    // Same season mapping as the RSVP above, so removing hits the row that
    // actually answered. (The :driverId param is ignored on purpose — the
    // caller can only ever remove their OWN response.)
    const race = await prisma.race.findUnique({ where: { id: req.params.id } });
    const base = await prisma.driver.findUnique({ where: { id: driverId } });
    const driver = race && base ? await seasonRowForDriver(prisma, base, race.seasonId, req.user?.discordId) : base;
    await prisma.raceRsvp.deleteMany({
      where: { raceId: req.params.id, driverId: driver?.id || driverId },
    });
    const discord = await syncRaceToDiscord(prisma, req.params.id);
    res.json({ ok: true, discord });
  } catch (e) {
    next(e);
  }
});

export default router;
