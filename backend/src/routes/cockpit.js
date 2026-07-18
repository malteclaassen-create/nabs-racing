// ---------------------------------------------------------------------------
// The private Cockpit: member-only, always about the LOGGED-IN driver (the
// acting row is re-resolved from the DB per request, exactly like routes/me.js
// — never trust a driverId from the client). Mounted at /api/me/cockpit.
// ---------------------------------------------------------------------------
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { optionalUser, resolveDriverId } from "../middleware/auth.js";
import {
  getCockpitOverview,
  getCockpitSeason,
  getCockpitTracks,
  getCockpitCareer,
  getCockpitDuels,
  getCockpitAchievements,
  getCockpitRaceList,
  getCockpitInsights,
  getCockpitRaceAnalysis,
  saveCockpitGoals,
  savePinnedAchievements,
} from "../services/cockpitService.js";
import { notifyAchievements } from "../lib/notifications.js";

const router = Router();
router.use(optionalUser);

async function requireDriver(req, res) {
  const driverId = await resolveDriverId(prisma, req.user);
  if (!driverId) {
    res.status(401).json({ error: "Sign in with Discord first" });
    return null;
  }
  return driverId;
}

// One thin wrapper per read tab: resolve the acting driver, run the builder.
function tab(builder) {
  return async (req, res, next) => {
    try {
      const driverId = await requireDriver(req, res);
      if (!driverId) return;
      const data = await builder(prisma, driverId, req);
      if (!data) return res.status(404).json({ error: "Driver not found" });
      res.json(data);
    } catch (e) {
      next(e);
    }
  };
}

router.get("/overview", tab(getCockpitOverview));
router.get("/season", tab(getCockpitSeason));
router.get("/tracks", tab(getCockpitTracks));
router.get("/career", tab(getCockpitCareer));
router.get("/duels", tab(getCockpitDuels));
router.get("/races", tab(getCockpitRaceList));
router.get("/insights", tab(getCockpitInsights));
router.get("/race/:raceId", tab((p, id, req) => getCockpitRaceAnalysis(p, id, req.params.raceId)));

// Achievements: computing the state is also the moment to reconcile the bell
// (best-effort, same as the card-editions endpoint).
router.get(
  "/achievements",
  tab(async (p, id) => {
    const data = await getCockpitAchievements(p, id);
    if (data) {
      // The masked entries still carry unlocked=false; the notifier only cares
      // about unlocked ones, whose full metadata is present.
      notifyAchievements(p, id, data.achievements.filter((a) => !a.masked));
    }
    return data;
  })
);

// PUT /api/me/cockpit/goals { goals: [{id?, text, done?}] } -> the driver's own
// season goals (private, max 8).
router.put("/goals", async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    const goals = await saveCockpitGoals(prisma, driverId, req.body?.goals);
    res.json({ ok: true, goals });
  } catch (e) {
    next(e);
  }
});

// PUT /api/me/cockpit/pins { keys: [...] } -> up to three achievements shown on
// the PUBLIC profile. Unlock state is re-checked server-side.
router.put("/pins", async (req, res, next) => {
  try {
    const driverId = await requireDriver(req, res);
    if (!driverId) return;
    const state = await getCockpitAchievements(prisma, driverId);
    if (!state) return res.status(404).json({ error: "Driver not found" });
    const unlocked = new Set(state.achievements.filter((a) => a.unlocked).map((a) => a.key));
    const pinned = await savePinnedAchievements(prisma, driverId, req.body?.keys, unlocked);
    res.json({ ok: true, pinned });
  } catch (e) {
    next(e);
  }
});

export default router;
