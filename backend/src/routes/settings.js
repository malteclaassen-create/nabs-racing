// Public, read-only site settings (currently: social media links). The links
// themselves are managed by an admin in routes/admin.js and stored in the
// Setting table under `social_<platform>` keys.
import { Router } from "express";
import prisma from "../lib/prisma.js";
import { readRaceInfo } from "../lib/raceInfo.js";
import { readWelcomeFaq } from "../lib/welcomeFaq.js";
import { readPrivacyInfo } from "../lib/privacyInfo.js";
import { discordMemberCount, leagueSince, yearsOfRacing } from "../lib/leagueStats.js";
import { buildFeed } from "../lib/socialFeed.js";
import { isTelemetryPublic } from "../lib/telemetryAccess.js";

const router = Router();

// The league's social links moved to lib/leagueSocials.js when the home page's
// structured data became a second reader of them. Imported and re-exported here
// so every existing importer (the admin routes) keeps working unchanged.
import { SOCIAL_KEYS, readSocialLinks } from "../lib/leagueSocials.js";
export { SOCIAL_KEYS, readSocialLinks };

// Live Timing page external links (admin-managed under these Setting keys).
// The full live-timing default is derived from the same upstream origin the
// relay talks to, so it points at the server manager's own page out of the box;
// the Content Manager join link starts empty (its button hides until an admin
// pastes the real acstuff.ru/… deep link for the running server).
const LIVE_TIMING_ORIGIN = process.env.LIVE_TIMING_ORIGIN || "https://nabs1.emperorservers.com";
export const LIVE_LINK_DEFAULTS = {
  liveTimingUrl: `${LIVE_TIMING_ORIGIN}/live-timing`,
  cmJoinUrl: "",
  // A YouTube or Twitch address whose player is embedded on the live page while
  // someone is streaming the race. Stored raw (as the admin pasted it): the
  // embed address is built in the browser, because Twitch refuses to play
  // unless the URL names the exact domain it is embedded on, which only the
  // page itself knows. Empty = no player, which is the normal state.
  streamUrl: "",
};

// Read the configured Live-page links, applying the defaults for anything unset.
export async function readLiveLinks(prismaClient) {
  const rows = await prismaClient.setting.findMany({
    where: { key: { in: ["live_timing_url", "live_cm_join_url", "live_stream_url"] } },
  });
  const get = (k) => rows.find((r) => r.key === k)?.value || "";
  return {
    liveTimingUrl: get("live_timing_url") || LIVE_LINK_DEFAULTS.liveTimingUrl,
    cmJoinUrl: get("live_cm_join_url") || LIVE_LINK_DEFAULTS.cmJoinUrl,
    streamUrl: get("live_stream_url") || LIVE_LINK_DEFAULTS.streamUrl,
  };
}

// GET /api/settings/telemetry -> may the members' side show recorded laps.
//
// One boolean, read by the /tools page to decide whether to draw the
// comparison at all. Public on purpose: it says whether a feature is on, which
// is what the page it belongs to would say anyway, and asking costs a member
// nothing. The endpoints it gates check for themselves (lib/telemetryAccess.js)
// — this only saves the page from drawing a card that would then 401.
router.get("/telemetry", async (req, res, next) => {
  try {
    res.json({ public: await isTelemetryPublic(prisma) });
  } catch (e) {
    next(e);
  }
});

// GET /api/settings/social -> the public social links map.
router.get("/social", async (req, res, next) => {
  try {
    res.json(await readSocialLinks(prisma));
  } catch (e) {
    next(e);
  }
});

// GET /api/settings/privacy -> who is responsible for the site, and what the
// Android app is called. Public and login-free, because the page that reads it
// has to be readable by anyone, an app store reviewer included.
router.get("/privacy", async (req, res, next) => {
  try {
    res.json(await readPrivacyInfo(prisma));
  } catch (e) {
    next(e);
  }
});

// GET /api/settings/league-stats -> the two headline numbers the database has
// no answer for: how many people are in the Discord, and how long the league has
// been running. See lib/leagueStats.js for why neither can be derived. Both may
// be null, and the landing page has a fallback for each.
router.get("/league-stats", async (req, res, next) => {
  try {
    const [members, since] = await Promise.all([discordMemberCount(prisma), leagueSince(prisma)]);
    res.json({ discordMembers: members, since, years: yearsOfRacing(since) });
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

// GET /api/settings/social-feed -> the cards for the home page's social wall:
// the league's latest YouTube videos (read from the channel's public feed) mixed
// with the Instagram/TikTok posts an admin added by hand. See lib/socialFeed.js.
// Never fails the page: a platform that doesn't answer just means fewer cards.
router.get("/social-feed", async (req, res, next) => {
  try {
    res.json(await buildFeed(prisma));
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
