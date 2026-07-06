import { Router } from "express";
import prisma from "../lib/prisma.js";
import { syncRaceToDiscord } from "../services/discordService.js";
import { optionalUser, resolveDriverId } from "../middleware/auth.js";
import { resolveSeasonId } from "../services/seasonService.js";

const router = Router();
const VALID = ["ACCEPTED", "DECLINED", "TENTATIVE"];

// GET /api/events -> upcoming races (not completed) with RSVP lists.
// Season-scoped (default: the active season) so events never mix seasons.
router.get("/", async (req, res, next) => {
  try {
    const seasonId = await resolveSeasonId(prisma, req.query.season);
    const races = await prisma.race.findMany({
      where: { isCompleted: false, isSpecialEvent: false, seasonId },
      orderBy: { number: "asc" },
      include: {
        rsvps: { include: { driver: { include: { team: true } } } },
      },
    });

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
        track: race.track,
        date: race.date,
        capacity: race.capacity,
        info: race.info,
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

    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    await prisma.raceRsvp.upsert({
      where: { raceId_driverId: { raceId: race.id, driverId } },
      update: { status },
      create: { raceId: race.id, driverId, status },
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
    await prisma.raceRsvp.deleteMany({
      where: { raceId: req.params.id, driverId },
    });
    const discord = await syncRaceToDiscord(prisma, req.params.id);
    res.json({ ok: true, discord });
  } catch (e) {
    next(e);
  }
});

export default router;
