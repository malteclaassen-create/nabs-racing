// Public, read-only site settings (currently: social media links). The links
// themselves are managed by an admin in routes/admin.js and stored in the
// Setting table under `social_<platform>` keys.
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { readRaceInfo } from "../lib/raceInfo.js";
import { readWelcomeFaq } from "../lib/welcomeFaq.js";

const router = Router();

// The social platforms the site knows how to render an icon for.
export const SOCIAL_KEYS = ["discord", "twitch", "youtube", "instagram", "tiktok", "x"];

// Live Timing page external links (admin-managed under these Setting keys).
// The full live-timing default is derived from the same upstream origin the
// relay talks to, so it points at the server manager's own page out of the box;
// the Content Manager join link starts empty (its button hides until an admin
// pastes the real acstuff.ru/… deep link for the running server).
const LIVE_TIMING_ORIGIN = process.env.LIVE_TIMING_ORIGIN || "https://nabs1.emperorservers.com";
export const LIVE_LINK_DEFAULTS = {
  liveTimingUrl: `${LIVE_TIMING_ORIGIN}/live-timing`,
  cmJoinUrl: "",
};

// Read the configured Live-page links, applying the defaults for anything unset.
export async function readLiveLinks(prismaClient) {
  const rows = await prismaClient.setting.findMany({
    where: { key: { in: ["live_timing_url", "live_cm_join_url"] } },
  });
  const get = (k) => rows.find((r) => r.key === k)?.value || "";
  return {
    liveTimingUrl: get("live_timing_url") || LIVE_LINK_DEFAULTS.liveTimingUrl,
    cmJoinUrl: get("live_cm_join_url") || LIVE_LINK_DEFAULTS.cmJoinUrl,
  };
}

// Read the configured social links as { discord, twitch, ... } (empty = unset).
export async function readSocialLinks(prismaClient) {
  const rows = await prismaClient.setting.findMany({
    where: { key: { in: SOCIAL_KEYS.map((k) => `social_${k}`) } },
  });
  const map = {};
  for (const k of SOCIAL_KEYS) map[k] = rows.find((r) => r.key === `social_${k}`)?.value || "";
  return map;
}

// GET /api/settings/social -> the public social links map.
router.get("/social", async (req, res, next) => {
  try {
    res.json(await readSocialLinks(prisma));
  } catch (e) {
    next(e);
  }
});

// GET /api/settings/live -> the public Live-page external links (with defaults).
router.get("/live", async (req, res, next) => {
  try {
    res.json(await readLiveLinks(prisma));
  } catch (e) {
    next(e);
  }
});

// GET /api/settings/race-info -> the admin-edited Race Info page content, or
// { content: null } while nothing has been saved (frontend uses its defaults).
router.get("/race-info", async (req, res, next) => {
  try {
    res.json({ content: await readRaceInfo(prisma) });
  } catch (e) {
    next(e);
  }
});

// GET /api/settings/welcome-faq -> the admin-edited Welcome-page FAQ, or
// { content: null } while nothing is saved (frontend uses its defaults).
router.get("/welcome-faq", async (req, res, next) => {
  try {
    res.json({ content: await readWelcomeFaq(prisma) });
  } catch (e) {
    next(e);
  }
});

export default router;
