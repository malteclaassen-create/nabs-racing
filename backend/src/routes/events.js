import { Router } from "express";
import prisma from "../lib/prisma.js";
import { syncRaceToDiscord } from "../services/discordService.js";
import { optionalUser, resolveDriverId, isAdminRequest } from "../middleware/auth.js";
import { resolveSeasonId } from "../services/seasonService.js";
import { readRaceFormat } from "../lib/raceFormat.js";
import { readRaceTypes } from "../lib/raceTypes.js";
import { seasonRowForDriver } from "../lib/persons.js";

const router = Router();
const VALID = ["ACCEPTED", "DECLINED", "TENTATIVE"];

// GET /api/events -> upcoming races (not completed) with RSVP lists.
// Season-scoped (default: the active season) so events never mix seasons.
// An admin may target a private season (site preview); the public can't.
router.get("/", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season, {
      includePrivate: isAdminRequest(req),
      series: req.query.series,
    });
    // Championship rounds AND training sessions get RSVP (training is exactly
    // what session planning needs); special events stay announcement-only.
    const allUpcoming = await prisma.race.findMany({
      where: { isCompleted: false, seasonId },
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

    // RSVP as the person's row in the RACE's season — the login may still
    // point at another season's row (e.g. answering next season's opener
    // before ever logging in again after the season switch).
    const base = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!base) return res.status(404).json({ error: "Driver not found" });
    const driver = await seasonRowForDriver(prisma, base, race.seasonId, req.user?.discordId);
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
