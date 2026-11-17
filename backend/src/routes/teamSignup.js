import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, requireUser, resolveDriverId } from "../middleware/auth.js";
import { resolveSeries } from "../lib/series.js";
import {
  readSignupSettings,
  parseSignupForm,
  dbGetOwnSignup,
  dbSaveSignup,
  dbWithdrawSignup,
  shapeForSender,
} from "../lib/teamSignups.js";

// The members' side of the team sign-up (lib/teamSignups.js): the form on the
// home page of the series the admin opened it for.
//
//   GET    /api/team-signup?series=<slug>  is it open here, and my own entry
//   PUT    /api/team-signup?series=<slug>  send or change my entry
//   DELETE /api/team-signup?series=<slug>  take my entry back
//
// Sending needs a Discord login: that is how the admin knows who asked, and
// it keeps the list to one entry per person.

const router = Router();

// The running sign-up, if it is open for the series asked about.
async function openSignupFor(req) {
  const settings = await readSignupSettings(prisma);
  if (!settings.open || !settings.seriesId) return null;
  const series = await resolveSeries(prisma, req.query.series ? String(req.query.series) : undefined);
  if (!series || series.id !== settings.seriesId) return null;
  return { ...settings, series };
}

// The member's current driver name, to fill the first seat in for them.
async function driverNameOf(user) {
  try {
    const driverId = await resolveDriverId(prisma, user);
    if (driverId) {
      const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } });
      if (d?.name) return d.name;
    }
  } catch {
    /* the token's name is good enough */
  }
  return user?.driverName || user?.discordName || null;
}

router.get("/", optionalUser, async (req, res, next) => {
  try {
    const signup = await openSignupFor(req);
    if (!signup) return res.json({ open: false });
    const mine = req.user?.discordId
      ? await dbGetOwnSignup(prisma, { seriesId: signup.seriesId, label: signup.label, discordId: req.user.discordId })
      : null;
    res.json({
      open: true,
      label: signup.label,
      seriesName: signup.series.name,
      signedIn: !!req.user?.discordId,
      myName: req.user ? await driverNameOf(req.user) : null,
      mine: shapeForSender(mine),
    });
  } catch (e) {
    next(e);
  }
});

router.put("/", requireUser, async (req, res, next) => {
  try {
    const signup = await openSignupFor(req);
    if (!signup) return res.status(409).json({ error: "The team sign-up is closed." });
    const form = parseSignupForm(req.body);
    const { entry } = await dbSaveSignup(prisma, {
      seriesId: signup.seriesId,
      label: signup.label,
      discordId: req.user.discordId,
      senderName: await driverNameOf(req.user),
      form,
    });
    res.json({ ok: true, mine: shapeForSender(entry) });
  } catch (e) {
    next(e);
  }
});

router.delete("/", requireUser, async (req, res, next) => {
  try {
    const signup = await openSignupFor(req);
    if (!signup) return res.status(409).json({ error: "The team sign-up is closed." });
    await dbWithdrawSignup(prisma, { seriesId: signup.seriesId, label: signup.label, discordId: req.user.discordId });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
