// ---------------------------------------------------------------------------
// The server-token endpoints: the member's own page, and the admin's list.
//
// Two routers out of one file, because they are two views of the same three
// tables and splitting them would mean keeping the same imports in sync twice.
// The member router is mounted at /api/tokens, the admin one at
// /api/admin/tokens (src/index.js).
//
// Every MEMBER route asks isTokensEnabled first (the two bot routes at the
// bottom do not, see there). While the trial is off the member
// side answers a plain { enabled: false } — not a 404 and not an error, because
// the page uses that answer to show nothing at all. The admin side stays open
// either way: the switch itself lives there, and a list you cannot reach is a
// switch you cannot turn back on.
// ---------------------------------------------------------------------------
import { Router } from "express";
import { ensureTuning, overrides, cleanTuning, saveTuning, resetTuning } from "../lib/tokenTuning.js";
import { EARN_RULES as RULE_DEFAULTS, MULTIPLIER, REFERRAL_RACE_LIMIT } from "../lib/tokenRules.js";
import { CARD_COLLECTIONS } from "../lib/cardShop.js";
import multer from "multer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { UPLOADS_DIR } from "../lib/dataDirs.js";
import { STUDIO_SLOTS, studioCatalogue, readStudio, equipStudio, profileMediaOwner } from "../lib/profileStudio.js";
import { practiceProgress } from "../lib/practiceTokens.js";
import { LIVE_SERVERS } from "../lib/liveServers.js";
import prisma from "../lib/prisma.js";
import { requireUser, requireAdmin } from "../middleware/auth.js";
import {
  SHOP_ITEMS,
  isTokensEnabled,
  tokensMode,
  tokensPublic,
  tokensVisibleTo,
  setTokensMode,
  isEarningOn,
  setEarning,
  TOKEN_MODES,
  setTokensEnabled,
  ensureTokenAccount,
  attachReferral,
  attachReferralByName,
  canNameInviter,
  removeReferral,
  rulesForDisplay,
  botConnected,
  tunedShop,
  tunedStudio,
  buyStudioItem,
  tunedStartDay,
  tunedReferralLimit,
  tunedPracticeServers,
  tunedMultiplier,
  FLAIRS,
  CUSTOM_FLAIR_MAX,
  hallOfFameWall,
  leaderboard,
  syncEarned,
  dbBalance,
  dbLedger,
  unseenGain,
  markSeen,
  dbRedemptions,
  redeemItem,
  recordActivity,
  activityKeyValid,
  ensureActivityKey,
  cardCatalogueFor,
  buyCardDesign,
  setRedemptionStatus,
  adminAdjust,
  adminOverview,
  rememberNames,
  tokenStats,
} from "../lib/tokens.js";

const router = Router();
// The league's own numbers have to be in memory before any payout maths runs.
router.use((req, res, next) => ensureTuning(prisma).then(() => next(), next));

// GET /api/tokens — everything the member's Tokens panel draws, in one call:
// the balance, their invite code, how tokens are earned, what they have earned
// so far and what the shop sells.
router.get("/", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.json({ enabled: false });
    const discordId = req.user.discordId;
    await syncEarned(prisma, discordId);
    const account = await ensureTokenAccount(prisma, discordId);
    res.json({
      enabled: true,
      balance: await dbBalance(prisma, discordId),
      code: account?.code || null,
      invitedBy: account?.referredBy ? true : false,
      // New and nobody named yet: the page asks "who invited you?".
      canNameInviter: await canNameInviter(prisma, discordId, account),
      rules: await rulesForDisplay(prisma),
      shop: tunedShop().filter((i) => i.active),
      flairs: FLAIRS,
      customFlairMax: CUSTOM_FLAIR_MAX,
      botConnected: await botConnected(prisma),
      earning: await isEarningOn(prisma),
      startDay: tunedStartDay(),
      // The card designs are their own catalogue behind the "Card design" entry
      // of the shop: four series, with what this member already owns marked.
      cardDesigns: await cardCatalogueFor(prisma, discordId),
      ledger: await dbLedger(prisma, discordId),
      orders: await dbRedemptions(prisma, discordId),
      stats: await tokenStats(prisma, discordId),
      // This week's training laps, and what they have paid so far.
      practice: await practiceProgress(prisma, discordId).catch(() => null),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/tokens/balance — the number for the nav bar, and what has happened
// to it since the bar last said it out loud. Its own route because the bar asks
// on every page and has no use for the history.
router.get("/balance", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.json({ enabled: false });
    const discordId = req.user.discordId;
    await syncEarned(prisma, discordId);
    const balance = await dbBalance(prisma, discordId);
    // `gain` is null unless something was actually earned since last time. The
    // bar plays it and then POSTs /seen; nothing is marked as shown here, so a
    // page that is opened and closed again before the animation runs still gets
    // the news on the next visit.
    const gain = await unseenGain(prisma, discordId, balance).catch(() => null);
    res.json({ enabled: true, balance, gain });
  } catch (e) {
    next(e);
  }
});

// POST /api/tokens/seen — "I have shown the member this balance". Sent by the
// nav bar once the count has finished climbing.
router.post("/seen", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.json({ ok: false });
    const discordId = req.user.discordId;
    res.json(await markSeen(prisma, discordId, await dbBalance(prisma, discordId)));
  } catch (e) {
    next(e);
  }
});

// POST /api/tokens/invite { code } — the invite link the browser is still
// carrying, handed in after the fact.
//
// The login already does this (routes/discordAuth.js), and this is the second
// door for the cases that one cannot cover: a member who signed in before the
// trial existed, and, on a laptop, the dev login, which never goes near the
// Discord callback. Harmless to call with anything: attachReferral refuses a
// member who already has an inviter, their own code, and anybody who has
// already raced.
router.post("/invite", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.status(403).json({ error: "Not available" });
    const inviter = await attachReferral(prisma, req.user.discordId, req.body?.code);
    res.json({ attached: !!inviter });
  } catch (e) {
    next(e);
  }
});

// POST /api/tokens/invited-by { name } — a newcomer says who brought them in:
// that member's invite code, or their name as the site shows it.
router.post("/invited-by", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.status(403).json({ error: "Not available" });
    const out = await attachReferralByName(prisma, req.user.discordId, req.body?.name);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

// POST /api/tokens/card-design { key } — buy one card design. Unlike every
// other purchase this one completes itself: the design is on the member's
// picker the moment the answer comes back.
router.post("/card-design", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.status(403).json({ error: "Not available" });
    const out = await buyCardDesign(prisma, req.user.discordId, req.body?.key);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

// POST /api/tokens/redeem { itemKey } — spend on a shop item.
router.post("/redeem", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.status(403).json({ error: "Not available" });
    const out = await redeemItem(prisma, req.user.discordId, req.body?.itemKey, req.body?.choice, req.body?.text);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

// --- the profile studio ------------------------------------------------------
// GET /api/tokens/studio: the catalogue with today's prices, what this member
// owns and wears, and their settings.
router.get("/studio", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.json({ enabled: false });
    const mine = await readStudio(prisma, req.user.discordId);
    res.json({
      enabled: true,
      items: studioCatalogue(tunedStudio()),
      balance: await dbBalance(prisma, req.user.discordId),
      ...mine,
    });
  } catch (e) {
    next(e);
  }
});
router.post("/studio/buy", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.status(403).json({ error: "Not available" });
    const out = await buyStudioItem(prisma, req.user.discordId, req.body?.itemId);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json({ ...out, ...(await readStudio(prisma, req.user.discordId)) });
  } catch (e) {
    next(e);
  }
});
router.put("/studio/appearance", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.status(403).json({ error: "Not available" });
    const out = await equipStudio(prisma, req.user.discordId, req.body?.appearance || {}, req.body?.content);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) {
    next(e);
  }
});
// A banner, showcase or page-background picture. Kept under the member's hashed id so the save
// above can tell their own uploads from anything else.
const studioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
router.post(
  "/studio/image/:kind",
  requireUser,
  (req, res, next) =>
    studioUpload.single("file")(req, res, (error) => {
      if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Pictures must be 8 MB or smaller" });
      next(error);
    }),
  async (req, res, next) => {
    try {
      if (!(await tokensVisibleTo(prisma, req))) return res.status(403).json({ error: "Not available" });
      if (!["banner", "showcase", "background"].includes(req.params.kind)) return res.status(400).json({ error: "Invalid picture type" });
      const b = req.file?.buffer;
      const isPng = b?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isJpg = b?.[0] === 255 && b?.[1] === 216 && b?.[2] === 255;
      const isWebp = b?.subarray(0, 4).toString() === "RIFF" && b?.subarray(8, 12).toString() === "WEBP";
      const ext = isPng ? "png" : isJpg ? "jpg" : isWebp ? "webp" : null;
      if (!ext) return res.status(400).json({ error: "Use a PNG, JPG or WebP image (up to 8 MB)" });
      const dir = join(UPLOADS_DIR, "profile-studio");
      mkdirSync(dir, { recursive: true });
      const filename = `${profileMediaOwner(req.user.discordId)}-${req.params.kind}-${randomUUID()}.${ext}`;
      writeFileSync(join(dir, filename), b);
      res.json({ url: `/api/uploads/profile-studio/${filename}` });
    } catch (e) {
      next(e);
    }
  }
);

// GET /api/tokens/practice — the training week on its own, so the page can
// follow it while somebody is out on track without rebuilding the whole panel.
router.get("/practice", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.json({ enabled: false });
    // `?series=` is the page saying which one it is showing; the answer leads
    // with that week and carries the others alongside it.
    const prefer = String(req.query.series || "").slice(0, 80) || null;
    res.json({ enabled: true, practice: await practiceProgress(prisma, req.user.discordId, { prefer }) });
  } catch (e) {
    next(e);
  }
});

// GET /api/tokens/leaderboard: top earners and the most present on Discord.
router.get("/leaderboard", requireUser, async (req, res, next) => {
  try {
    if (!(await tokensVisibleTo(prisma, req))) return res.json({ enabled: false });
    // Marked here rather than handing every member the whole table's Discord
    // ids and letting the browser compare: the page only needs to know which
    // line is yours.
    const board = await leaderboard(prisma, 10, req.user.discordId);
    res.json({ enabled: true, ...board });
  } catch (e) {
    next(e);
  }
});

// GET /api/tokens/wall: the names on the Hall of Fame wall. Public, no login.
router.get("/wall", async (req, res, next) => {
  try {
    if (!(await tokensPublic(prisma))) return res.json({ enabled: false, wall: [] });
    res.json({ enabled: true, wall: await hallOfFameWall(prisma) });
  } catch (e) {
    next(e);
  }
});

// POST /api/tokens/activity — the league's Discord bot reporting what a member
// did on a given day: how many messages they wrote, how many minutes they sat
// in voice. Absolute totals FOR THAT DAY, so the bot may send the same day as
// often as it likes.
//
//   { key, entries: [{ discordId, day?, messages, minutes }, ...] }
//
// Signed with the bot's own key rather than an admin login (see
// ACTIVITY_KEY_SETTING): the bot runs somewhere else, under somebody else's
// hand. No member session is involved, which is why this sits outside the
// requireUser block above.
// No isTokensEnabled check here or on /referral: the bot may run BEFORE the
// feature is switched on for members, so the thirty-day window is already
// full on day one instead of everybody starting at 1.0x. The key is the gate.
router.post("/activity", async (req, res, next) => {
  try {
    if (!(await activityKeyValid(prisma, req.body?.key))) {
      return res.status(401).json({ error: "Bad key" });
    }
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (entries.length > 500) return res.status(400).json({ error: "Too many entries at once" });
    let written = 0;
    for (const e of entries) {
      const out = await recordActivity(prisma, e?.discordId, e);
      if (out.ok) written++;
    }
    res.json({ ok: true, written, skipped: entries.length - written });
  } catch (e) {
    next(e);
  }
});

// --- the admin's side --------------------------------------------------------

export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.use((req, res, next) => ensureTuning(prisma).then(() => next(), next));

// GET /api/admin/tokens — the switch, everyone's balance, every open order.
adminRouter.get("/", async (req, res, next) => {
  try {
    res.json({
      enabled: await isTokensEnabled(prisma),
      mode: await tokensMode(prisma),
      earning: await isEarningOn(prisma),
      rules: await rulesForDisplay(prisma),
      shop: tunedShop(),
      members: await adminOverview(prisma),
      orders: await dbRedemptions(prisma),
      tuning: overrides(),
      defaults: {
        rules: RULE_DEFAULTS,
        shop: SHOP_ITEMS,
        cards: CARD_COLLECTIONS,
        referralRaceLimit: REFERRAL_RACE_LIMIT,
        multiplier: MULTIPLIER,
        // The race servers, for the "which of these do training laps count
        // on" switches. Nothing said about one means it counts.
        servers: LIVE_SERVERS.map((s) => ({ key: s.key, name: s.name })),
      },
      cards: CARD_COLLECTIONS.map((c) => ({ ...c, cost: overrides().cards?.[c.key]?.cost ?? c.cost })),
      // The studio's per-type prices: the catalogue's own number per slot
      // (uniform within a slot), and what the league set instead.
      studio: STUDIO_SLOTS.filter((slot) => studioCatalogue().some((i) => i.slot === slot)).map((slot) => ({
        key: slot,
        cost: tunedStudio()[slot]?.cost ?? studioCatalogue().find((i) => i.slot === slot).price,
        defaultCost: studioCatalogue().find((i) => i.slot === slot).price,
      })),
      referralRaceLimit: tunedReferralLimit(),
      practiceServers: tunedPracticeServers(),
      multiplier: tunedMultiplier(),
      startDay: tunedStartDay(),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/tokens/names — the bot saying what the people on the server are
// called. Names only, nothing is created here: an account that does not exist
// is a person the site has no reason to know about.
//
//   { key, entries: [{ discordId, name }, ...] }
router.post("/names", async (req, res, next) => {
  try {
    if (!(await activityKeyValid(prisma, req.body?.key))) {
      return res.status(401).json({ error: "Bad key" });
    }
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (entries.length > 500) return res.status(400).json({ error: "Too many entries at once" });
    const written = await rememberNames(prisma, entries);
    res.json({ ok: true, written, skipped: entries.length - written });
  } catch (e) {
    next(e);
  }
});

// POST /api/tokens/referral — the league's Discord bot reporting who brought
// somebody into the server. Discord itself knows this: every invite link on a
// server counts its uses and names the member who made it, so a bot that takes
// a snapshot of those counts and compares them when somebody joins can tell
// which link was used, and therefore who invited them.
//
// Which is exactly the trouble: the link used is usually the server's everyday
// invite, made by an admin, who was then credited with every newcomer. So this
// no longer links anybody; it only keeps the names the bot sends along.
//
//   { key, entries: [{ discordId, inviterDiscordId }, ...] }
//
// Safe to send the same join twice, or to re-send the whole server on the day
// the bot is switched on: the first inviter a member ever had is kept, and
// somebody who has already raced can never be claimed as a new arrival.
router.post("/referral", async (req, res, next) => {
  try {
    if (!(await activityKeyValid(prisma, req.body?.key))) {
      return res.status(401).json({ error: "Bad key" });
    }
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (entries.length > 500) return res.status(400).json({ error: "Too many entries at once" });
    // Nothing is credited from here any more. Discord only knows whose invite
    // link was used, and the server's everyday link belongs to whichever admin
    // made it, who then got every newcomer. An invite counts when the newcomer
    // used the member's own link on the site, or names them (/invited-by).
    // The names are still worth keeping, for the admin list.
    const linked = 0;
    // Both names come along for the ride when the bot knows them: whoever just
    // joined has no account on the site yet, and the admin list would have
    // nothing to call them.
    await rememberNames(prisma, [
      ...entries.map((e) => ({ discordId: e?.discordId, name: e?.name })),
      ...entries.map((e) => ({ discordId: e?.inviterDiscordId, name: e?.inviterName })),
    ]);
    // "skipped" is the normal case, not an error: most of what the bot sends is
    // something the site already knew.
    res.json({ ok: true, linked, skipped: entries.length - linked });
  } catch (e) {
    next(e);
  }
});

// PUT /api/admin/tokens/tuning: the league's own numbers. Sends the whole
// set every time; a field left empty falls back to the code's default.
adminRouter.put("/tuning", async (req, res, next) => {
  try {
    const out = cleanTuning(req.body, {
      rules: RULE_DEFAULTS.map((r) => r.key),
      shop: SHOP_ITEMS.map((i) => i.key),
      cards: CARD_COLLECTIONS.map((c) => c.key),
      studio: [...new Set(STUDIO_SLOTS)],
      servers: LIVE_SERVERS.map((s) => s.key),
    });
    if (out.error) return res.status(400).json({ error: out.error });
    // The start day is stamped by the earning switch, not typed into this form.
    // A save that does not mention it keeps it: dropping it would put every
    // race back to season 1 in scope, which is the one thing here that cannot
    // be undone by typing the number back.
    const before = await ensureTuning(prisma);
    if (req.body?.startDay === undefined && before.startDay) out.tuning.startDay = before.startDay;
    res.json({ ok: true, tuning: await saveTuning(prisma, out.tuning) });
  } catch (e) {
    next(e);
  }
});
// "Back to defaults" resets the rules and prices, and keeps the start day for
// the same reason a save does (see above): it is stamped by the earning
// switch, and losing it would pay every race back to season 1.
adminRouter.delete("/tuning", async (req, res, next) => {
  try {
    const before = await ensureTuning(prisma);
    const tuning = await resetTuning(prisma);
    if (before.startDay) return res.json({ ok: true, tuning: await saveTuning(prisma, { startDay: before.startDay }) });
    res.json({ ok: true, tuning });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/tokens/activity-key — the key the Discord bot signs with,
// minted on first sight. Shown in the admin so whoever runs the bot can copy it.
adminRouter.get("/activity-key", async (req, res, next) => {
  try {
    res.json({ key: await ensureActivityKey(prisma) });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/tokens/enabled { enabled } — turn the trial on or off.
adminRouter.post("/enabled", async (req, res, next) => {
  try {
    const mode = TOKEN_MODES.includes(req.body?.mode) ? req.body.mode : req.body?.enabled ? "all" : "off";
    const saved = await setTokensMode(prisma, mode);
    res.json({ enabled: saved !== "off", mode: saved });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/tokens/earning { on } — start or pause the counting.
adminRouter.post("/earning", async (req, res, next) => {
  try {
    const on = await setEarning(prisma, !!req.body?.on);
    res.json({ earning: on, startDay: tunedStartDay() });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/tokens/adjust { discordId, delta, note } — a hand-written
// award or deduction.
adminRouter.post("/adjust", async (req, res, next) => {
  try {
    const { discordId, delta, note } = req.body || {};
    if (!discordId) return res.status(400).json({ error: "Which member?" });
    const out = await adminAdjust(prisma, discordId, delta, note);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/tokens/referral/:discordId — take a wrong inviter back
// off a member, and what the inviter was paid for them.
adminRouter.delete("/referral/:discordId", async (req, res, next) => {
  try {
    const out = await removeReferral(prisma, req.params.discordId);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/admin/tokens/orders/:id { status, note, flairText } — work through
// an order. flairText only does anything on a flair somebody wrote themselves.
adminRouter.patch("/orders/:id", async (req, res, next) => {
  try {
    const out = await setRedemptionStatus(prisma, req.params.id, req.body?.status, req.body?.note, req.body?.flairText);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

export default router;
