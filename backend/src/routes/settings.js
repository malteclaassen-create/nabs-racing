// Public, read-only site settings (currently: social media links). The links
// themselves are managed by an admin in routes/admin.js and stored in the
// Setting table under `social_<platform>` keys.
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { readRaceInfo } from "../lib/raceInfo.js";

const router = Router();

// The social platforms the site knows how to render an icon for.
export const SOCIAL_KEYS = ["discord", "twitch", "youtube", "instagram", "tiktok", "x"];

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

// GET /api/settings/race-info -> the admin-edited Race Info page content, or
// { content: null } while nothing has been saved (frontend uses its defaults).
router.get("/race-info", async (req, res, next) => {
  try {
    res.json({ content: await readRaceInfo(prisma) });
  } catch (e) {
    next(e);
  }
});

export default router;
