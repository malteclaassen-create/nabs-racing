// ---------------------------------------------------------------------------
// NABS Points: the league's reward currency. Called tokens throughout the code
// so it is never confused with championship points; the site says NABS Points.
//
// Two switches, and they are separate on purpose. tokens_enabled decides who
// SEES any of it (off / admins / everyone), tokens_earning decides whether
// anything is being COUNTED. So the league can put the whole thing in front of
// the grid, set the prices, and start the counting on a day it picks.
//
// A round is paid the moment it is SAVED (payRace, called from raceWriter), at
// the multiplier each driver carries that night. That rate is stamped into
// TokenRaceRate and never rewritten, so a correction three weeks later does not
// re-value the evening.
//
// Everything else is RECONCILED: reading a balance counts what the member has
// actually done and writes the missing rows, each under a refKey that is unique
// per member. Running it twice changes nothing, a rule added next month pays out
// retroactively, and a round that could not be paid on the night (the counting
// was paused, the clean-race bonus was still with the stewards) is picked up
// here, at the stamped rate.
//
// A payment for a round is filed under the ROUND and the DRIVER. Saving a round
// deletes its result rows and writes them again with fresh ids, so a key built
// from the row id looked new after every correction and paid the grid twice.
//
//   TokenAccount     one row per member: their invite code, and who invited THEM
//   TokenLedger      append-only. balance = SUM(delta). refKey makes it idempotent
//   TokenRedemption  a shop order, worked through by an admin by hand
//
// Raw SQL like Notification/MemberAccount/Feedback (the running dev server locks
// the generated Prisma client on Windows). Keep in sync with the models in
// prisma/schema.prisma and the CREATE TABLEs in lib/ensureSchema.js.
// ---------------------------------------------------------------------------
import { randomUUID, randomInt, timingSafeEqual, createHash } from "crypto";
import { IS_DEPLOYED } from "./deployment.js";
import { catalogueFor, isBuyableDesign, ownedDesigns, priceOf, CARD_DESIGN_BY_KEY } from "./cardShop.js";
import { overrides, ensureTuning, saveTuning } from "./tokenTuning.js";
import { STUDIO_BY_ID, studioPriceOf, ownedStudioItems } from "./profileStudio.js";
// The league's own rules and their arithmetic live next door, with no database
// in them, so the numbers can be checked by the tests (lib/tokenRules.js).
import {
  ACTIVITY_WINDOW_DAYS,
  BOARD_WINDOW_DAYS,
  EARN_RULES,
  MULTIPLIER,
  RULE_BY_KEY,
  REFERRAL_RACE_LIMIT,
  activityMultiplier,
  activityWindowStart,
  boardWindowStart,
  leagueDay,
  leagueDayStart,
  pointsFor,
  raceWasClean,
  stewardingClosed,
  withMultiplier,
} from "./tokenRules.js";

export { ACTIVITY_WINDOW_DAYS, BOARD_WINDOW_DAYS, EARN_RULES, RULE_BY_KEY, REFERRAL_RACE_LIMIT, activityMultiplier };

// The one switch. Stored as a Setting so it can be flipped in the admin without
// a deploy; absent means "whatever this machine's default is", which is ON for
// a laptop and OFF for the live site.
export const TOKENS_SETTING = "tokens_enabled";

// Three settings: "off", "admins" (only league admins see the feature, to try
// it on the live site without anybody else noticing) and "all".
export const TOKEN_MODES = ["off", "admins", "all"];

// Being SEEN and being EARNED are two different decisions. The league can put
// the whole thing in front of everybody while nothing is being counted yet,
// look around, set the prices, and start the counting on a day it picks.
export const EARNING_SETTING = "tokens_earning";

export async function isEarningOn(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: EARNING_SETTING } });
    return row?.value === "1";
  } catch {
    return false;
  }
}

// Switching it on for the first time is also the day the counting starts, so
// nobody wakes up with a season of back pay they were never promised.
export async function setEarning(prisma, on) {
  const value = on ? "1" : "0";
  await prisma.setting.upsert({
    where: { key: EARNING_SETTING },
    update: { value },
    create: { key: EARNING_SETTING, value },
  });
  if (on) {
    const t = await ensureTuning(prisma);
    if (!t.startDay) await saveTuning(prisma, { ...t, startDay: leagueDay() });
  }
  return !!on;
}

export async function tokensMode(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: TOKENS_SETTING } });
    if (row?.value === "1" || row?.value === "all") return "all";
    if (row?.value === "admins") return "admins";
    if (row?.value === "0" || row?.value === "off") return "off";
  } catch {
    /* fresh database, no Setting table yet */
  }
  return IS_DEPLOYED ? "off" : "all";
}

// On at all (admins or everyone): accounts, payouts, the bot, the ledger.
export async function isTokensEnabled(prisma) {
  return (await tokensMode(prisma)) !== "off";
}

// Shown on public pages (flair, profile studio, the wall): everyone-mode only.
export async function tokensPublic(prisma) {
  return (await tokensMode(prisma)) === "all";
}

// Does THIS request get to see the feature? Admins in admins-mode, everybody
// in all-mode. `req.isAdminRequest` is set by the auth middleware for a member
// login that is a league admin (and for the PIN login).
export async function tokensVisibleTo(prisma, req) {
  const mode = await tokensMode(prisma);
  if (mode === "all") return true;
  if (mode === "admins") return req?.isAdminRequest === true;
  return false;
}

export async function setTokensMode(prisma, mode) {
  const value = TOKEN_MODES.includes(mode) ? mode : "off"; // anything else is a mistake, and a mistake stays off
  await prisma.setting.upsert({
    where: { key: TOKENS_SETTING },
    update: { value },
    create: { key: TOKENS_SETTING, value },
  });
  return value;
}
// Kept for the older callers and tests: on = everyone, off = off.
export async function setTokensEnabled(prisma, on) {
  return (await setTokensMode(prisma, on ? "all" : "off")) !== "off";
}

// The day races started counting, "YYYY-MM-DD" in league time, or null for
// "all of them, back to season 1".
export const tunedStartDay = () => overrides().startDay || null;

// ---------------------------------------------------------------------------
// The shop. PLACEHOLDERS, all of them: an order lands in the admin's list and a
// human does the rest. Nothing here reaches into the site's own features yet —
// when "card design" becomes a real unlock it will hand the member a card
// edition (lib/cardEditions.js) at that point.
//
// Every entry is the same kind of thing: you pay the price, you get that thing.
// There WAS a card pack here, a draw with rarities and a reveal, and it was
// taken out on the league owner's decision — the league does not want anything
// that works like gambling, whatever the currency. So nothing in this file is
// allowed to be random, and an entry that would be bought without knowing what
// it is does not belong in it.
//
// An entry carries no colour of its own on purpose: a grid of tiles each tinted
// its own shade is the look the league asked not to have. Drop a picture into
// frontend/public/shop/<key> and it takes over — see that folder's README.
// ---------------------------------------------------------------------------
export const SHOP_ITEMS = [
  {
    key: "card_background",
    name: "Card design",
    cost: 1200,
    category: "Cards",
    description: "A design for your driver card, and you pick which one.",
    blurb: "Four collector series to pick from. Yours the moment you buy it, no draw and no luck.",
    catalogue: true,
    // The tile can only show one number, and this entry has four. The word in
    // front says so: "from 1,200". Any entry may have one, and the league can
    // change or remove it in Admin -> Tokens -> Rules and prices.
    pricePrefix: "from",
  },
  {
    key: "helmet",
    name: "Custom helmet",
    cost: 1500,
    category: "In the car",
    description: "Your own helmet design, added to the league's skin pack.",
    blurb:
      "Send the league office your design (or a picture of what you want) and it goes into the skin pack everyone downloads, so the field sees it on track.",
  },
  {
    key: "special_livery",
    name: "Special livery",
    cost: 2000,
    category: "In the car",
    description: "One of the league's own designs, on both cars of your team.",
    blurb:
      "The league keeps a few special liveries ready. Pick the one you want and it goes into the skin pack everyone downloads, on your car and your team mate's. Nobody has to draw anything for it, which is why it is the cheaper of the two. Ask your team mate first, one of the two cars is theirs.",
  },
  {
    // The key stays `car_skin` from the days this was one driver's own livery:
    // the orders already filed under it and the picture in public/shop both
    // hang off the key, and neither cares what the entry is called now.
    key: "car_skin",
    name: "Custom team skin",
    cost: 2500,
    category: "In the car",
    description: "A livery drawn for your team, on both of its cars.",
    blurb:
      "Say what you are after and the design gets drawn for your team, then it goes into the skin pack everyone downloads, on your car and your team mate's. Ask your team mate first, one of the two cars is theirs.",
  },
  {
    key: "profile_flair",
    name: "Profile flair",
    cost: 500,
    category: "On the site",
    description: "A mark next to your name on your public profile.",
    blurb:
      "Pick one of the marks below, or write your own. A mark from the list goes up the moment you buy it; wording you write yourself an admin reads first.",
    instant: true,
    once: true,
  },
  {
    key: "discord_role",
    name: "Discord role",
    cost: 600,
    category: "On Discord",
    description: "A coloured role on the NABS server.",
    blurb: "Your own colour in the member list, and the name of the role is yours to pick.",
  },
  {
    key: "profile_studio",
    name: "Profile studio",
    cost: 150,
    category: "On the site",
    description: "Themes, banners and lettering for your profile page. Designs from 150.",
    blurb: "Fifty-odd designs, bought one at a time. Try them on your own page before you buy.",
    link: "/profile/style",
    catalogue: true,
    pricePrefix: "from",
  },
  {
    key: "hall_of_fame",
    name: "Hall of fame entry",
    cost: 2500,
    category: "On the site",
    description: "Your name on the league's board for the people who built it.",
    blurb: "Your name goes on the Hall of Fame page right away, with the month you got there.",
    instant: true,
    once: true,
  },
];

// The marks a member can pick for the profile flair. Keys end up in the
// order's note and on the public profile, so change labels freely, keep the keys.
export const FLAIRS = [
  { key: "supporter", label: "Supporter" },
  { key: "veteran", label: "Veteran" },
  { key: "night_owl", label: "Night owl" },
  { key: "pit_crew", label: "Pit crew" },
  { key: "sunday_driver", label: "Sunday driver" },
  { key: "send_it", label: "Send it" },
  { key: "late_braker", label: "Late braker" },
  { key: "apex_hunter", label: "Apex hunter" },
  { key: "one_stopper", label: "One stopper" },
  { key: "tyre_whisperer", label: "Tyre whisperer" },
  { key: "rain_lover", label: "Rain lover" },
  { key: "backmarker", label: "Backmarker" },
  { key: "qualy_merchant", label: "Qualy merchant" },
  { key: "team_player", label: "Team player" },
  { key: "sim_rig", label: "Sim rig nerd" },
  { key: "friday_regular", label: "Friday regular" },
  { key: "last_lap", label: "Last lap hero" },
  { key: "coffee", label: "Runs on coffee" },
  { key: "reserve", label: "Always ready" },
  { key: "clean_racer", label: "Clean racer" },
  { key: "gravel_trap", label: "Gravel trap regular" },
  { key: "no_assists", label: "No assists" },
];
export const FLAIR_BY_KEY = new Map(FLAIRS.map((f) => [f.key, f]));

// --- the one you write yourself ---------------------------------------------
// A flair is either one of the marks above or wording the member typed. Both
// live in the same `note` column, the typed one behind a prefix, so nothing
// that already reads a flair had to learn a second shape.
//
// The typed one is the only thing in the shop that ends up on a PUBLIC page
// with words a member chose, so it does not go live on payment: it waits in
// the admin's order list like a helmet does, and only a filled order is worn.
export const CUSTOM_FLAIR_KEY = "custom";
export const CUSTOM_FLAIR_MAX = 24;
const CUSTOM_FLAIR_PREFIX = "custom:";

export const customFlairNote = (text) => `${CUSTOM_FLAIR_PREFIX}${text}`;

// Tidy up what was typed, or say what is wrong with it. Control characters out
// (invisible, and they travel), runs of spaces down to one, and a length in
// the same ballpark as the longest fixed mark.
export function cleanFlairText(text) {
  const s = [...String(text || "")]
    .map((c) => (c < " " || c.charCodeAt(0) === 127 ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return { error: "Write your wording first" };
  if (s.length > CUSTOM_FLAIR_MAX) return { error: `Keep it to ${CUSTOM_FLAIR_MAX} characters or fewer` };
  return { text: s };
}

// What a redemption's note stands for: one of the fixed marks, or the member's
// own wording. null for a note that is neither (an old row, a typo).
export function flairFromNote(note) {
  const s = String(note || "");
  if (s.startsWith(CUSTOM_FLAIR_PREFIX)) {
    const text = s.slice(CUSTOM_FLAIR_PREFIX.length).trim();
    return text ? { key: CUSTOM_FLAIR_KEY, label: text, custom: true } : null;
  }
  return FLAIR_BY_KEY.get(s) || null;
}

export const SHOP_BY_KEY = new Map(SHOP_ITEMS.map((i) => [i.key, i]));

// --- the numbers as the league has set them (Admin -> Tokens -> Rules and
// prices), falling back to the code's defaults field by field.
export function tunedRules() {
  const o = overrides().rules || {};
  return EARN_RULES.map((r) => ({
    ...r,
    points: o[r.key]?.points ?? r.points,
    // Only the training rules have one, and only they can have it moved.
    ...(r.laps == null ? {} : { laps: o[r.key]?.laps ?? r.laps }),
    active: r.key === "activity" ? r.active : (o[r.key]?.active ?? r.active),
  }));
}
const tunedRule = (key) => tunedRules().find((r) => r.key === key);
const tunedPoints = (key) => tunedRule(key)?.points ?? 0;
const ruleOn = (key) => tunedRule(key)?.active !== false;

export function tunedShop() {
  const o = overrides().shop || {};
  return SHOP_ITEMS.map((i) => ({
    ...i,
    cost: o[i.key]?.cost ?? i.cost,
    active: o[i.key]?.active ?? true,
    // The word in front of the price ("from 1,200"), empty for the entries
    // that cost exactly what they say.
    pricePrefix: o[i.key]?.prefix ?? i.pricePrefix ?? "",
  }));
}
const tunedItem = (key) => tunedShop().find((i) => i.key === key);
export const tunedReferralLimit = () => overrides().referralRaceLimit ?? REFERRAL_RACE_LIMIT;
// Does this race server's practice count towards the training milestones?
// Nothing said about a server means yes: the league switches one OFF, it does
// not have to switch them on.
export const practiceServerOn = (key) => overrides().practiceServers?.[String(key || "")] !== false;
export const tunedPracticeServers = () => overrides().practiceServers || {};
export const tunedStudio = () => overrides().studio || {};
export function tunedMultiplier() {
  const o = overrides().multiplier || {};
  return {
    ...MULTIPLIER,
    chat: { ...MULTIPLIER.chat, ...(o.chat || {}) },
    voice: { ...MULTIPLIER.voice, ...(o.voice || {}) },
  };
}

export const REDEMPTION_STATUSES = ["NEW", "DONE", "DECLINED"];

// ---------------------------------------------------------------------------
// The account: an invite code, and who invited this member.
// ---------------------------------------------------------------------------

// Six characters, no vowels and no 0/1/O/I, so a code read out loud on voice
// comes back the same. The unique index is what actually decides that two
// members never share one — the retry loop below only saves a wasted request.
const CODE_ALPHABET = "23456789BCDFGHJKLMNPQRSTVWXYZ";
function newCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export async function dbGetTokenAccount(prisma, discordId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM "TokenAccount" WHERE "discordId" = ?`,
    discordId
  );
  return rows[0] || null;
}

// The member's account, created on first sight. Called from the login and from
// every read, so a member who has never opened the page still has a code the
// moment somebody asks for their link.
export async function ensureTokenAccount(prisma, discordId) {
  if (!discordId) return null;
  const existing = await dbGetTokenAccount(prisma, discordId);
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TokenAccount" ("discordId", "code") VALUES (?, ?)`,
        discordId,
        newCode()
      );
      break;
    } catch {
      // Either the code collided (try another) or a parallel request created
      // the row first (the read below finds it and we are done).
      const now = await dbGetTokenAccount(prisma, discordId);
      if (now) return now;
    }
  }
  return dbGetTokenAccount(prisma, discordId);
}

export async function dbAccountByCode(prisma, code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(c)) return null;
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "TokenAccount" WHERE "code" = ?`, c);
  return rows[0] || null;
}

// Record that `discordId` arrived through `code`. Three rules, all of them
// load-bearing: the first inviter sticks, nobody invites themselves, and only
// somebody who has never raced can be claimed. The last one stops the obvious
// one: invites pay retroactively, so claiming a three-season regular would pay
// for their whole career. Returns the inviter's id if anything was written.
export async function attachReferral(prisma, discordId, code) {
  if (!code) return null;
  const inviter = await dbAccountByCode(prisma, code);
  return linkReferral(prisma, discordId, inviter?.discordId);
}

// The same thing, told to us by the league's Discord bot instead of by a link:
// somebody joined the Discord server through a member's invite, so the bot
// knows who brought them in and says so. Same guards, deliberately — where the
// claim came from changes nothing about which claims are allowed.
export async function attachReferralById(prisma, discordId, inviterDiscordId) {
  return linkReferral(prisma, discordId, inviterDiscordId);
}

// Both ways in end here, so the three rules above are written once.
async function linkReferral(prisma, discordId, inviterDiscordId) {
  if (!discordId || !inviterDiscordId || inviterDiscordId === discordId) return null;
  const me = await ensureTokenAccount(prisma, discordId);
  if (!me || me.referredBy) return null; // already has an inviter: the first one wins
  // The inviter gets an account here if they do not have one yet: somebody can
  // bring people into the Discord long before they first open the website, and
  // that should not be the reason they are never paid for it.
  const inviter = await ensureTokenAccount(prisma, inviterDiscordId).catch(() => null);
  if (!inviter) return null;
  if (await hasRacedBefore(prisma, discordId)) return null;
  await prisma.$executeRawUnsafe(
    `UPDATE "TokenAccount" SET "referredBy" = ?, "referredAt" = CURRENT_TIMESTAMP WHERE "discordId" = ?`,
    inviter.discordId,
    discordId
  );
  return inviter.discordId;
}

// ---------------------------------------------------------------------------
// The ledger.
// ---------------------------------------------------------------------------

// One entry. `refKey` is what makes this idempotent: the same key twice for the
// same member is ignored, so the reconciliation below can run on every page
// load without paying anybody twice.
// `at` backdates the entry. Everything a member has ever done is paid at once
// the first time they open the page, so without it a five-year career lands in
// the history as seventy-four rows all stamped today, which reads as a glitch.
// A race entry carries the date of the race instead, and the history reads like
// one.
export async function dbAward(prisma, { discordId, delta, rule, title, detail = null, refKey, at = null }) {
  if (!discordId || !delta || !refKey) return false;
  const when = at ? new Date(at) : null;
  const stamp = when && !Number.isNaN(when.getTime()) ? when.toISOString() : null;
  try {
    // The count of rows actually written, so a caller can tell "paid" from
    // "already paid": OR IGNORE swallows the second attempt silently, and a
    // function that reports a payout either way is a function that lies in the
    // log every time a round is saved again.
    const written = await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "TokenLedger" ("id","discordId","delta","rule","title","detail","refKey","createdAt")
       VALUES (?,?,?,?,?,?,?,COALESCE(?, CURRENT_TIMESTAMP))`,
      randomUUID(),
      discordId,
      Math.round(delta),
      rule,
      title,
      detail,
      refKey,
      stamp
    );
    return Number(written) > 0;
  } catch {
    return false;
  }
}

export async function dbBalance(prisma, discordId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM("delta"), 0) AS bal FROM "TokenLedger" WHERE "discordId" = ?`,
    discordId
  );
  return Number(rows[0]?.bal || 0);
}

export async function dbLedger(prisma, discordId, limit = 50) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id","delta","rule","title","detail","createdAt" FROM "TokenLedger"
     WHERE "discordId" = ? ORDER BY "createdAt" DESC, "rowid" DESC LIMIT ?`,
    discordId,
    Number(limit) || 50
  );
  return rows.map((r) => ({ ...r, delta: Number(r.delta) }));
}

// ---------------------------------------------------------------------------
// Reconciliation: pay for everything this member has done that isn't paid yet.
// ---------------------------------------------------------------------------

// Every driver row that belongs to this Discord account, across seasons and
// series — the rows they are linked to directly, plus the ones an admin has
// tied to the same person (PersonLink).
export async function driverIdsFor(prisma, discordId) {
  const own = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Driver" WHERE "discordUserId" = ?`,
    discordId
  );
  const ids = new Set(own.map((r) => r.id));
  if (!ids.size) return [];
  try {
    const links = await prisma.$queryRawUnsafe(`SELECT "driverId","personId" FROM "PersonLink"`);
    const persons = new Set(links.filter((l) => ids.has(l.driverId)).map((l) => l.personId));
    for (const l of links) if (persons.has(l.personId)) ids.add(l.driverId);
  } catch {
    /* no PersonLink table yet */
  }
  return [...ids];
}

// Name to print in somebody's history for a person they brought in.
async function memberName(prisma, discordId) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "displayName","username" FROM "MemberAccount" WHERE "discordId" = ?`,
      discordId
    );
    return rows[0]?.displayName || rows[0]?.username || "A new member";
  } catch {
    return "A new member";
  }
}

// Who this member brought in. Its own function because three places ask.
async function invitedBy(prisma, discordId) {
  try {
    // Somebody brought in before the start day is not a new arrival for the
    // tokens either: the whole point of the start day is a clean zero.
    // referredAt is SQLite's CURRENT_TIMESTAMP, so it is UTC text, while the
    // start day is a Berlin date. Convert, or a member referred just after
    // midnight Berlin falls on the wrong side of the line.
    const from = startOfStartDay();
    if (from == null) {
      return await prisma.$queryRawUnsafe(
        `SELECT "discordId" FROM "TokenAccount" WHERE "referredBy" = ?`,
        discordId
      );
    }
    return await prisma.$queryRawUnsafe(
      `SELECT "discordId" FROM "TokenAccount" WHERE "referredBy" = ? AND COALESCE("referredAt", '') >= ?`,
      discordId,
      new Date(from).toISOString().slice(0, 19).replace("T", " ")
    );
  } catch {
    return [];
  }
}

// Midnight league time on the start day, as an instant, or null when the league
// has not set one and everything counts.
function startOfStartDay() {
  return leagueDayStart(tunedStartDay());
}

// What a payment for a round is filed under. The ROUND and the DRIVER, never
// the result row's id: saving a round deletes its result rows and writes them
// again with fresh ids (services/raceWriter.js), so a key built from the row id
// looks new after every correction and pays the whole grid a second time.
const raceKey = (kind, r) => `${kind}:${r.raceId || "?"}:${r.driverId || "?"}`;

// The Discord account behind each of these driver rows, following the person
// links, so somebody who signed in on one season's row is found from another.
export async function discordForDrivers(prisma, driverIds) {
  const out = new Map();
  const ids = [...new Set((driverIds || []).filter(Boolean))];
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  const own = await prisma
    .$queryRawUnsafe(`SELECT "id","discordUserId" FROM "Driver" WHERE "id" IN (${ph})`, ...ids)
    .catch(() => []);
  for (const r of own) if (r.discordUserId) out.set(r.id, r.discordUserId);
  const rest = ids.filter((id) => !out.has(id));
  if (!rest.length) return out;
  const ph2 = rest.map(() => "?").join(",");
  const linked = await prisma
    .$queryRawUnsafe(
      `SELECT mine."driverId" AS "want", d."discordUserId" AS "discordId"
         FROM "PersonLink" mine
         JOIN "PersonLink" sib ON sib."personId" = mine."personId"
         JOIN "Driver" d ON d."id" = sib."driverId"
        WHERE mine."driverId" IN (${ph2}) AND d."discordUserId" IS NOT NULL`,
      ...rest
    )
    .catch(() => []);
  for (const r of linked) if (!out.has(r.want)) out.set(r.want, r.discordId);
  return out;
}

// What this round is worth, fixed now and never again. Written the first time a
// round is saved; a correction weeks later finds the stamp already there and
// leaves it, so re-importing a round to fix one penalty does not re-value
// everybody else's evening.
export async function stampRaceRates(prisma, raceId) {
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT r."driverId" FROM "RaceResult" r
         LEFT JOIN "TokenRaceRate" t ON t."raceId" = r."raceId" AND t."driverId" = r."driverId"
        WHERE r."raceId" = ? AND t."driverId" IS NULL`,
      raceId
    )
    .catch(() => []);
  const ids = [...new Set(rows.map((r) => r.driverId).filter(Boolean))];
  if (!ids.length) return 0;
  const accounts = await discordForDrivers(prisma, ids);
  let n = 0;
  for (const driverId of ids) {
    const discordId = accounts.get(driverId);
    // No Discord account means no activity to measure, so a plain 1.0. Which is
    // what they would have been paid anyway.
    const rate = discordId ? (await multiplierFor(prisma, discordId)).total : 1;
    const ok = await prisma
      .$executeRawUnsafe(
        `INSERT OR IGNORE INTO "TokenRaceRate" ("raceId","driverId","rate") VALUES (?,?,?)`,
        raceId,
        driverId,
        Number(rate) || 1
      )
      .catch(() => 0);
    if (ok) n++;
  }
  return n;
}

// A round has been saved: fix what it is worth and pay it out now, rather than
// waiting for each member to open their page. Called from the tail of
// saveRaceResults, best-effort — a reward currency must never be able to break
// an import.
export async function payRace(prisma, raceId) {
  const stamped = await stampRaceRates(prisma, raceId);
  if (!(await isEarningOn(prisma))) return { stamped, paid: 0 };
  const from = startOfStartDay();
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT r."driverId" AS "driverId", r."penaltySeconds" AS "penaltySeconds",
              r."gamePenalties" AS "gamePenalties",
              ra."id" AS "raceId", ra."track" AS "track", ra."date" AS "date",
              rate."rate" AS "rate"
         FROM "RaceResult" r
         JOIN "Race" ra ON ra."id" = r."raceId"
         LEFT JOIN "TokenRaceRate" rate ON rate."raceId" = ra."id" AND rate."driverId" = r."driverId"
        WHERE r."raceId" = ? AND ra."isCompleted" = 1 AND r."status" = 'FINISHED'
          ${from == null ? "" : `AND ra."date" >= ?`}`,
      ...(from == null ? [raceId] : [raceId, from])
    )
    .catch(() => []);
  if (!rows.length) return { stamped, paid: 0 };
  const accounts = await discordForDrivers(prisma, rows.map((r) => r.driverId));
  let paid = 0;
  for (const r of rows) {
    const discordId = accounts.get(r.driverId);
    if (!discordId) continue; // never signed in: nothing to pay it into yet
    await ensureTokenAccount(prisma, discordId);
    const rate = Number(r.rate) || 1;
    if (ruleOn("race_finish")) {
      const wrote = await dbAward(prisma, {
        discordId,
        delta: withMultiplier(tunedPoints("race_finish"), rate),
        rule: "race_finish",
        title: "Finished a race",
        detail: r.track || null,
        refKey: raceKey("race", r),
        at: r.date,
      });
      if (wrote) paid++;
    }
    // Usually still open on the night: the bonus waits for the stewards and is
    // picked up by syncEarned on the Tuesday, at the rate stamped above.
    if (ruleOn("clean_race") && raceWasClean(r) && stewardingClosed(r.date)) {
      await dbAward(prisma, {
        discordId,
        delta: withMultiplier(tunedPoints("clean_race"), rate),
        rule: "clean_race",
        title: "Clean race, no penalties",
        detail: r.track || null,
        refKey: raceKey("clean", r),
        at: r.date,
      });
    }
  }
  return { stamped, paid };
}

// Every race this member has FINISHED, with what the round needs for the
// clean-race bonus. DNS, DNF and DSQ are not finishes and pay nothing: the
// league's sheet says "FINISH a race".
async function racesFinished(prisma, discordId) {
  const ids = await driverIdsFor(prisma, discordId);
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(",");
  // Race.date is a DATETIME, which SQLite keeps as epoch milliseconds, so the
  // cutoff has to be a NUMBER. Handing it an ISO string compares text against
  // an integer, which is never true, and every race quietly pays nothing.
  const from = startOfStartDay();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r."id" AS "resultId", r."driverId" AS "driverId",
            r."penaltySeconds" AS "penaltySeconds",
            r."gamePenalties" AS "gamePenalties",
            ra."id" AS "raceId", ra."track" AS "track", ra."date" AS "date",
            rate."rate" AS "rate"
       FROM "RaceResult" r
       JOIN "Race" ra ON ra."id" = r."raceId"
       LEFT JOIN "TokenRaceRate" rate ON rate."raceId" = ra."id" AND rate."driverId" = r."driverId"
      WHERE r."driverId" IN (${ph}) AND ra."isCompleted" = 1 AND r."status" = 'FINISHED'
        ${from == null ? "" : `AND ra."date" >= ?`}
      ORDER BY ra."date" ASC`,
    ...ids,
    ...(from == null ? [] : [from])
  );
  return rows;
}

// --- Discord activity --------------------------------------------------------

// The key the league's Discord bot signs its reports with. Same shape and the
// same reasoning as the telemetry recorder's key (lib/telemetryKeys.js): the
// bot runs somewhere else, under somebody else's hand, so it gets a secret of
// its own rather than an admin login — and the key can be replaced without
// touching anything the members can see.
export const ACTIVITY_KEY_SETTING = "token_activity_key";

export async function readActivityKey(prisma) {
  const row = await prisma.setting.findUnique({ where: { key: ACTIVITY_KEY_SETTING } }).catch(() => null);
  return row?.value || null;
}

// Mint one if there is none. Called by the admin page that shows it.
export async function ensureActivityKey(prisma) {
  const existing = await readActivityKey(prisma);
  if (existing) return existing;
  const key = randomUUID().replace(/-/g, "");
  await prisma.setting.upsert({
    where: { key: ACTIVITY_KEY_SETTING },
    update: { value: key },
    create: { key: ACTIVITY_KEY_SETTING, value: key },
  });
  return key;
}

// Compared byte by byte in constant time, and hashed to a fixed length first so
// that a wrong guess does not even give away how long the real key is. No key
// set means no door: the bot cannot report anything until an admin makes one.
export async function activityKeyValid(prisma, given) {
  const key = await readActivityKey(prisma);
  if (!key || typeof given !== "string" || !given) return false;
  const digest = (v) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(given), digest(key));
}


// One day of one member's activity, as the bot reports it. Absolute totals for
// that day, not increments, so the bot can resend a day as often as it likes.
export async function recordActivity(prisma, discordId, { day, messages = 0, minutes = 0 } = {}) {
  if (!discordId) return { error: "Which member?" };
  const d = String(day || leagueDay());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: "Bad day" };
  await ensureTokenAccount(prisma, discordId);
  // A day's totals only ever go UP, so the higher number wins. Straight
  // overwriting looked right until you think about where the bot runs: on a
  // host with no disk of its own it loses its notes on every restart, starts
  // the day again at zero, and five minutes later reports a smaller number than
  // the one already stored. A redeploy in the middle of a race night would have
  // wiped that night.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TokenActivity" ("discordId","day","messages","minutes")
     VALUES (?,?,?,?)
     ON CONFLICT("discordId","day") DO UPDATE SET
       "messages" = MAX("TokenActivity"."messages", excluded."messages"),
       "minutes" = MAX("TokenActivity"."minutes", excluded."minutes"),
       "updatedAt" = CURRENT_TIMESTAMP`,
    discordId,
    d,
    Math.max(0, Math.round(Number(messages) || 0)),
    Math.max(0, Math.round(Number(minutes) || 0))
  );
  return { ok: true, day: d };
}

// What this member has done in the window that counts: today and the
// twenty-nine days before it. Older rows simply fall out of the sum, which is
// how a multiplier earned in a busy month fades again in a quiet one.
export async function activityTotals(prisma, discordId) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("messages"),0) AS m, COALESCE(SUM("minutes"),0) AS v
         FROM "TokenActivity" WHERE "discordId" = ? AND "day" >= ?`,
      discordId,
      activityWindowStart()
    );
    return { chatMessages: Number(rows[0]?.m || 0), vcMinutes: Number(rows[0]?.v || 0) };
  } catch {
    // No table yet (a database from before the trial): nobody has any activity,
    // which is the right answer and never an error the member should see.
    return { chatMessages: 0, vcMinutes: 0 };
  }
}

// The multiplier this member currently carries. 1.0 for everybody until the
// Discord bot is reporting, see lib/tokenRules.js.
export async function multiplierFor(prisma, discordId) {
  const totals = await activityTotals(prisma, discordId);
  return { ...activityMultiplier(totals, tunedMultiplier()), ...totals, windowDays: ACTIVITY_WINDOW_DAYS };
}

// Bring one member's ledger up to date. Safe to call as often as you like.
export async function syncEarned(prisma, discordId) {
  if (!discordId) return;
  // Paused: balances stand still. Shop purchases and the league office's own
  // bookings still work, and the moment it is switched on everything from the
  // start day is credited in one go.
  if (!(await isEarningOn(prisma))) return;
  await ensureTokenAccount(prisma, discordId);
  // A round is worth what it was worth the night it was imported: payRace
  // stamps each driver's multiplier then (TokenRaceRate) and everything here
  // reads that stamp. The live multiplier is only the fallback, for a round
  // saved before any of this existed. Without it a race would be worth whatever
  // the member's last thirty days happened to look like on the day the site got
  // round to paying it, which is a different number every day.
  const { total: live } = await multiplierFor(prisma, discordId);
  const rateOf = (r) => Number(r.rate) || live;

  // --- what they finished themselves
  for (const r of await racesFinished(prisma, discordId)) {
    // The two are switched separately: the league can keep the clean-race bonus
    // while paying nothing for a plain finish.
    if (ruleOn("race_finish"))
      await dbAward(prisma, {
        discordId,
        delta: withMultiplier(tunedPoints("race_finish"), rateOf(r)),
        rule: "race_finish",
        title: "Finished a race",
        detail: r.track || null,
        refKey: raceKey("race", r),
        at: r.date,
      });
    // The bonus for a round nobody was penalised in, once the stewards are done
    // with it. Before that it is not decided, and a token paid out early cannot
    // be taken back on the Monday without it looking like a mistake.
    if (ruleOn("clean_race") && raceWasClean(r) && stewardingClosed(r.date)) {
      await dbAward(prisma, {
        discordId,
        delta: withMultiplier(tunedPoints("clean_race"), rateOf(r)),
        rule: "clean_race",
        title: "Clean race, no penalties",
        detail: r.track || null,
        refKey: raceKey("clean", r),
        at: r.date,
      });
    }
  }

  // --- what the people they brought in did
  for (const inv of await invitedBy(prisma, discordId)) {
    const who = await memberName(prisma, inv.discordId);
    if (ruleOn("referral_join"))
      await dbAward(prisma, {
        discordId,
        delta: tunedPoints("referral_join"),
      rule: "referral_join",
      title: "Someone signed up through you",
      detail: who,
      refKey: `referral-join:${inv.discordId}`,
    });
    // Their first twelve finishes pay, and then this stops. Keyed on the round
    // rather than on a running count, so the cap cannot be walked past by a
    // result being corrected.
    if (!ruleOn("referral_race")) continue;
    const theirs = (await racesFinished(prisma, inv.discordId)).slice(0, tunedReferralLimit());
    for (const r of theirs) {
      await dbAward(prisma, {
        discordId,
        delta: tunedPoints("referral_race"),
        rule: "referral_race",
        title: `${who} finished a race`,
        detail: r.track || null,
        refKey: `referral-race:${inv.discordId}:${r.raceId || r.resultId}`,
        at: r.date,
      });
    }
  }
}

// Has this member ever taken a start? Any start, finished or not — somebody who
// has been on the grid is in the league already, which is what the referral
// guard needs to know.
async function hasRacedBefore(prisma, discordId) {
  const ids = await driverIdsFor(prisma, discordId);
  if (!ids.length) return false;
  const ph = ids.map(() => "?").join(",");
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "RaceResult" r JOIN "Race" ra ON ra."id" = r."raceId"
      WHERE r."driverId" IN (${ph}) AND ra."isCompleted" = 1 AND r."status" <> 'DNS' LIMIT 1`,
    ...ids
  );
  return rows.length > 0;
}

// How this member is doing, in the numbers the page prints above the fold.
export async function tokenStats(prisma, discordId) {
  const mine = await racesFinished(prisma, discordId);
  const invited = await invitedBy(prisma, discordId);
  let invitedRacing = 0;
  for (const inv of invited) {
    if ((await racesFinished(prisma, inv.discordId)).length) invitedRacing++;
  }
  const activity = await multiplierFor(prisma, discordId);
  return {
    races: mine.length,
    invited: invited.length,
    invitedRacing,
    multiplier: activity.total,
    // The parts behind that number, for the bar on the Tokens page.
    activity: { ...activity, max: MULTIPLIER.total, chatRange: tunedMultiplier().chat, voiceRange: tunedMultiplier().voice },
  };
}

// Has the Discord bot ever delivered anything? Decides whether the activity
// rule on the members' page still says "not connected yet".
export async function botConnected(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT 1 AS one FROM "TokenActivity" LIMIT 1`).catch(() => []);
  return rows.length > 0;
}

// The rules as the page should show them today: the activity line reads
// differently once the bot is actually feeding numbers.
export async function rulesForDisplay(prisma) {
  const connected = await botConnected(prisma);
  return tunedRules().map((r) =>
    r.key === "activity" && connected
      ? {
          ...r,
          hint: `Multiplies what racing earns, up to ${MULTIPLIER.total}x. Counted over your last ${ACTIVITY_WINDOW_DAYS} days on Discord, fresh every day.`,
        }
      : r
  );
}

// ---------------------------------------------------------------------------
// The shop.
// ---------------------------------------------------------------------------

export async function dbRedemptions(prisma, discordId = null) {
  const rows = discordId
    ? await prisma.$queryRawUnsafe(
        `SELECT * FROM "TokenRedemption" WHERE "discordId" = ? ORDER BY "createdAt" DESC`,
        discordId
      )
    : await prisma.$queryRawUnsafe(
        `SELECT r.*, m."username", m."displayName" FROM "TokenRedemption" r
         LEFT JOIN "MemberAccount" m ON m."discordId" = r."discordId"
         ORDER BY r."createdAt" DESC LIMIT 200`
      );
  return rows.map((r) => {
    const item = SHOP_BY_KEY.get(r.itemKey);
    const flair = r.itemKey === "profile_flair" ? flairFromNote(r.note) : null;
    return {
      ...r,
      cost: Number(r.cost),
      member: r.displayName || r.username || undefined,
      // Only the things a person has to do (helmet, car skin, Discord role) are orders
      // in the admin sense; card designs, fixed flairs and wall entries the
      // site fills itself and are just a record. A flair somebody WROTE is a
      // person's job again: those words go on a public page.
      manual: !!item && (flair?.custom ? true : !item.instant && !item.catalogue),
      detail: flair?.label || null,
      // The wording itself, so the admin's row can show it and correct it.
      flairText: flair?.custom ? flair.label : null,
    };
  });
}

// One row in somebody's collection: something they bought.
async function writeRedemption(prisma, { id, discordId, key, name, cost, status = "NEW", note = null }) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TokenRedemption" ("id","discordId","itemKey","itemName","cost","status","note")
     VALUES (?,?,?,?,?,?,?)`,
    id,
    discordId,
    key,
    name,
    cost,
    status,
    note
  );
  return id;
}

// Every purchase goes through here, and all of it happens or none of it does.
// The balance is read INSIDE the transaction and the money moves before the
// item is written, so two clicks landing together cannot both pass the check,
// and a failed ledger write cannot leave somebody holding a design for free.
// `owns` is asked inside as well, for the things you can only have once.
async function spend(prisma, { discordId, cost, key, name, status, note = null, rule, title, detail, owns = null }) {
  try {
    return await prisma.$transaction(async (tx) => {
      if (owns && (await owns(tx))) return { error: "You already have that one" };
      const balance = await dbBalance(tx, discordId);
      if (balance < cost) return { error: "Not enough points for that yet" };
      const id = randomUUID();
      const paid = await dbAward(tx, { discordId, delta: -cost, rule, title, detail, refKey: `${rule}:${id}` });
      if (!paid) throw new Error("the ledger would not take it");
      await writeRedemption(tx, { id, discordId, key, name, cost, status, note });
      return { ok: true, id, balance: balance - cost };
    });
  } catch {
    return { error: "That did not go through. Try again." };
  }
}

// Spend tokens on a shop item. Returns { error } rather than throwing for the
// two things a member can get wrong, so the page can say which one it was.
export async function redeemItem(prisma, discordId, itemKey, choice = null, text = null) {
  const item = tunedItem(String(itemKey || ""));
  if (!item || !item.active) return { error: "Unknown item" };
  // The card designs are bought one by one from the catalogue (buyCardDesign),
  // never as a blank order for the league office.
  if (item.catalogue) return { error: "Pick a design from the catalogue" };
  let note = null;
  // A flair somebody wrote themselves is the one instant item that is not
  // instant: the words are going on a public page, so an admin reads them
  // first and it waits in the order list until they do.
  let instant = !!item.instant;
  if (item.key === "profile_flair") {
    if (String(choice || "") === CUSTOM_FLAIR_KEY) {
      const clean = cleanFlairText(text);
      if (clean.error) return { error: clean.error };
      note = customFlairNote(clean.text);
      instant = false;
    } else {
      const flair = FLAIR_BY_KEY.get(String(choice || ""));
      if (!flair) return { error: "Pick a mark first" };
      note = flair.key;
    }
  }
  await syncEarned(prisma, discordId);
  // Instant items are filled by the site itself, the rest wait for a person.
  const out = await spend(prisma, {
    discordId,
    cost: item.cost,
    key: item.key,
    name: item.name,
    status: instant ? "DONE" : "NEW",
    note,
    rule: "redeem",
    title: `${instant ? "Bought" : "Ordered"}: ${item.name}`,
    detail: instant ? "Yours right away" : "Waiting for the league office",
    // A name on the wall and a mark are one each: without this a double click
    // pays twice for one line, and there is nothing to give back.
    owns: item.once ? (tx) => hasBought(tx, discordId, item.key, note) : null,
  });
  return out.error ? out : { ...out, instant };
}

// Has this member already bought this item? For a flair, the mark matters: a
// second, different one is a real purchase, the same one twice is not.
async function hasBought(prisma, discordId, key, note = null) {
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT 1 FROM "TokenRedemption"
        WHERE "discordId" = ? AND "itemKey" = ? AND "status" <> 'DECLINED'
          ${note == null ? "" : `AND "note" = ?`} LIMIT 1`,
      ...(note == null ? [discordId, key] : [discordId, key, note])
    )
    .catch(() => []);
  return rows.length > 0;
}

// The flair each of these members wears: the newest one they bought that is
// still filled. Map discordId -> { key, label }.
export async function flairsFor(prisma, discordIds) {
  const ids = [...new Set((discordIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT "discordId","note" FROM "TokenRedemption"
        WHERE "itemKey" = 'profile_flair' AND "status" = 'DONE' AND "discordId" IN (${ph})
        ORDER BY "createdAt" ASC`,
      ...ids
    )
    .catch(() => []);
  for (const r of rows) {
    const f = flairFromNote(r.note);
    if (f) out.set(r.discordId, { key: f.key, label: f.label });
  }
  return out;
}

// Names for a set of members, the way the site knows them: driver name if
// they have a row, else the Discord name. Map discordId -> { name, avatarUrl }.
async function namesFor(prisma, discordIds) {
  const ids = [...new Set((discordIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT m."discordId", m."displayName", m."username", m."avatarUrl",
              (SELECT d."name" FROM "Driver" d WHERE d."discordUserId" = m."discordId" ORDER BY d."id" DESC LIMIT 1) AS "driverName",
              (SELECT d."photoUrl" FROM "Driver" d WHERE d."discordUserId" = m."discordId" AND d."photoUrl" IS NOT NULL LIMIT 1) AS "photoUrl"
         FROM "MemberAccount" m WHERE m."discordId" IN (${ph})`,
      ...ids
    )
    .catch(() => []);
  for (const r of rows) {
    out.set(r.discordId, {
      name: r.driverName || r.displayName || r.username || "A member",
      avatarUrl: r.photoUrl || r.avatarUrl || null,
    });
  }
  for (const id of ids) if (!out.has(id)) out.set(id, { name: "A member", avatarUrl: null });
  return out;
}

// Who has earned the most, and who is most around on Discord. Spending is
// left out on purpose: buying things should not push you down a list.
export async function leaderboard(prisma, limit = 10, meId = null) {
  const earned = await prisma
    .$queryRawUnsafe(
      `SELECT "discordId", SUM("delta") AS "earned"
         FROM "TokenLedger" WHERE "delta" > 0 AND "rule" <> 'refund'
        GROUP BY "discordId" ORDER BY "earned" DESC, MIN("createdAt") ASC LIMIT ?`,
      limit
    )
    .catch(() => []);
  // Two boards, not one ranked on messages plus minutes added together. Those
  // are different units: an hour of voice is sixty and a good evening of typing
  // is twenty, so the sum was really a voice board with a rounding error, and
  // somebody who only ever types could not appear on it at all.
  const since = boardWindowStart();
  const board = (column) =>
    prisma
      .$queryRawUnsafe(
        `SELECT "discordId", SUM("messages") AS "messages", SUM("minutes") AS "minutes"
           FROM "TokenActivity" WHERE "day" >= ?
          GROUP BY "discordId" HAVING SUM("${column}") > 0
          ORDER BY SUM("${column}") DESC LIMIT ?`,
        since,
        limit
      )
      .catch(() => []);
  const voice = await board("minutes");
  const chatty = await board("messages");
  const names = await namesFor(prisma, [...earned, ...voice, ...chatty].map((r) => r.discordId));
  const line = (prefix) => (r, i) => ({
    id: `${prefix}${i}`,
    mine: r.discordId === meId,
    ...names.get(r.discordId),
    messages: Number(r.messages),
    minutes: Number(r.minutes),
  });
  return {
    earned: earned.map((r, i) => ({ id: `e${i}`, mine: r.discordId === meId, ...names.get(r.discordId), earned: Number(r.earned) })),
    voice: voice.map(line("v")),
    chat: chatty.map(line("c")),
    windowDays: BOARD_WINDOW_DAYS,
  };
}

// Everybody with a filled hall-of-fame entry, oldest first, under the name the
// site knows them by: their driver row if they have one, else their Discord name.
export async function hallOfFameWall(prisma) {
  const rows = await prisma
    .$queryRawUnsafe(
      `SELECT r."discordId", r."createdAt", d."name" AS "driverName", m."displayName", m."username"
         FROM "TokenRedemption" r
         LEFT JOIN "Driver" d ON d."discordUserId" = r."discordId"
         LEFT JOIN "MemberAccount" m ON m."discordId" = r."discordId"
        WHERE r."itemKey" = 'hall_of_fame' AND r."status" = 'DONE'
        ORDER BY r."createdAt" ASC`
    )
    .catch(() => []);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.discordId)) continue; // bought twice: one line
    seen.add(r.discordId);
    out.push({ name: r.driverName || r.displayName || r.username || "A member", since: r.createdAt });
  }
  return out;
}

// ---------------------------------------------------------------------------
// "What happened while I was away"
//
// The nav bar shows a running balance, and a number that is simply larger than
// yesterday tells nobody anything. So the account remembers the balance it last
// SHOWED this member (seenBalance) and how far down the ledger that was
// (seenRowId); everything past those two is news, and the bar celebrates it
// once: a "+100" over the count, then the count climbing to the new total.
//
// Deliberately NOT "everything since a timestamp": race entries are backdated
// to the evening they were driven (dbAward's `at`), so a round credited today
// but raced three weeks ago would never count as news. SQLite's rowid only ever
// goes up, which is exactly the property needed here.
//
// Spending is not news either. Buying a card design is something the member
// just did on purpose, and having the bar congratulate them on it a second
// later would be silly — so only a RISE is ever shown.

// The whole decision, with no database in it: given what the member was last
// shown and what they have now, is there anything to celebrate?
//
//   null seen  -> their first look. A history is not news; show nothing.
//   same       -> nothing happened.
//   lower      -> they spent. Their own doing, announced by the shop, not here.
//   higher     -> news, and how much of it.
export function gainFromSeen(seenBalance, balance) {
  if (seenBalance == null) return null;
  const from = Number(seenBalance);
  const now = Number(balance);
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null;
  const gained = now - from;
  return gained > 0 ? { gained, from } : null;
}

// The rowid of the newest ledger row for this member, or 0.
async function newestLedgerRow(prisma, discordId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX("rowid"), 0) AS top FROM "TokenLedger" WHERE "discordId" = ?`,
    discordId
  );
  return Number(rows[0]?.top || 0);
}

// What to celebrate, if anything: { gained, reasons } with gained > 0, or null.
// `reasons` are the unseen entries, newest first, so the bar can name what the
// tokens were for ("Raced a round") instead of just flashing a number.
export async function unseenGain(prisma, discordId, balance) {
  const account = await dbGetTokenAccount(prisma, discordId);
  if (!account) return null;
  const seenBalance = account.seenBalance;
  const rise = gainFromSeen(seenBalance, balance);
  if (!rise) {
    // Three cases, one answer: a first look (nothing to celebrate, so take the
    // mark from here), nothing happened, or they spent — in which case the mark
    // follows the balance DOWN, so the next payout is measured from there
    // rather than from an old high-water mark.
    if (seenBalance == null || balance < Number(seenBalance)) {
      await markSeen(prisma, discordId, balance);
    }
    return null;
  }
  const since = Number(account.seenRowId || 0);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "title", "detail", "delta" FROM "TokenLedger"
      WHERE "discordId" = ? AND "rowid" > ? AND "delta" > 0
      ORDER BY "rowid" DESC LIMIT 6`,
    discordId,
    since
  );
  return {
    ...rise,
    reasons: rows.map((r) => ({ title: r.title, detail: r.detail, delta: Number(r.delta) })),
  };
}

// Record that the member has now been shown `balance`. Called by the bar once
// its animation has run, and by unseenGain itself for the two cases that have
// nothing to show.
export async function markSeen(prisma, discordId, balance) {
  const top = await newestLedgerRow(prisma, discordId);
  await prisma.$executeRawUnsafe(
    `UPDATE "TokenAccount" SET "seenBalance" = ?, "seenRowId" = ? WHERE "discordId" = ?`,
    Math.round(Number(balance) || 0),
    top,
    discordId
  );
  return { ok: true, seenBalance: Math.round(Number(balance) || 0), seenRowId: top };
}

// --- the card designs -------------------------------------------------------
//
// The one thing in this shop that serves itself: a design is unlocked the
// second it is paid for, because the site can hand it over without a human
// (lib/cardShop.js, and the picker in routes/me.js reads the same rows). So the
// order is written as DONE rather than NEW, and the league office never sees it
// unless something needs refunding.

// The four series with prices and a mark against what this member already has.
export async function cardCatalogueFor(prisma, discordId) {
  return catalogueFor(await ownedDesigns(prisma, discordId), overrides().cards);
}

export async function buyCardDesign(prisma, discordId, key) {
  if (!isBuyableDesign(key)) return { error: "Unknown card design" };
  const design = CARD_DESIGN_BY_KEY.get(key);
  const cost = priceOf(key, overrides().cards);
  if ((await ownedDesigns(prisma, discordId)).has(key)) return { error: "You already have that one" };
  await syncEarned(prisma, discordId);
  const out = await spend(prisma, {
    discordId,
    cost,
    key,
    name: design.name,
    status: "DONE",
    rule: "card_design",
    title: `Bought: ${design.name}`,
    detail: "Card design, yours right away",
    owns: async (tx) => (await ownedDesigns(tx, discordId)).has(key),
  });
  return out.error ? out : { ...out, design: { ...design, cost } };
}

// A profile studio design: paid once, owned for good, worn from the studio
// page. Same shape as a card design, and the same rule: nothing here is ever
// handed out by results.
export async function buyStudioItem(prisma, discordId, itemId) {
  const item = STUDIO_BY_ID.get(String(itemId || ""));
  if (!item) return { error: "Unknown design" };
  const cost = studioPriceOf(item, tunedStudio());
  if ((await ownedStudioItems(prisma, discordId)).has(item.id)) return { error: "You already have that one" };
  await syncEarned(prisma, discordId);
  return spend(prisma, {
    discordId,
    cost,
    key: item.id,
    name: item.name,
    status: "DONE",
    rule: "studio",
    title: `Bought: ${item.name}`,
    detail: "Profile design, yours right away",
    owns: async (tx) => (await ownedStudioItems(tx, discordId)).has(item.id),
  });
}

// An admin working through an order. Declining refunds it — the tokens were
// never spent on anything, and a member who cannot see why an order vanished
// writes to the admin about it, which is worse than the refund row.
export async function setRedemptionStatus(prisma, id, status, note = null, flairText = null) {
  const s = String(status || "").toUpperCase();
  if (!REDEMPTION_STATUSES.includes(s)) return { error: "Unknown status" };
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "TokenRedemption" WHERE "id" = ?`, id);
  const row = rows[0];
  if (!row) return { error: "Not found" };
  // A flair keeps WHICH mark was picked in the note, so an admin typing a note
  // on the order would otherwise wipe the thing the member paid for. The one
  // they wrote themselves the admin may reword, which is the point of reading
  // it, and that comes in as its own field rather than as the note.
  const flair = row.itemKey === "profile_flair" ? flairFromNote(row.note) : null;
  let keptNote = flair ? (row.note ?? null) : (note ?? row.note ?? null);
  if (flair?.custom && flairText != null && String(flairText).trim() !== flair.label) {
    const clean = cleanFlairText(flairText);
    if (clean.error) return { error: clean.error };
    keptNote = customFlairNote(clean.text);
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "TokenRedemption" SET "status" = ?, "note" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`,
    s,
    keptNote,
    id
  );
  const wasDeclined = String(row.status || "").toUpperCase() === "DECLINED";
  if (s === "DECLINED" && !wasDeclined) {
    await dbAward(prisma, {
      discordId: row.discordId,
      delta: Number(row.cost),
      rule: "refund",
      title: `Refunded: ${row.itemName}`,
      detail: note || "The league office could not fill this order",
      refKey: `refund:${id}`,
    });
  }
  // Undeclining gives the item back, so it has to take the refund back too.
  // Without this, decline-by-mistake then put-it-right leaves the member with
  // the thing AND the points.
  if (wasDeclined && s !== "DECLINED") {
    await dbAward(prisma, {
      discordId: row.discordId,
      delta: -Number(row.cost),
      rule: "redeem",
      title: `Back on: ${row.itemName}`,
      detail: "The league office picked this order up again",
      refKey: `unrefund:${id}`,
    });
  }
  return { ok: true };
}

// A hand-written award or deduction from the admin. Its own refKey every time,
// because "give Steve 200 for the stream" is not a thing to be deduplicated.
export async function adminAdjust(prisma, discordId, delta, note) {
  const n = Math.round(Number(delta) || 0);
  if (!n) return { error: "Give a number of points" };
  await ensureTokenAccount(prisma, discordId);
  await dbAward(prisma, {
    discordId,
    delta: n,
    rule: "admin",
    title: n > 0 ? "From the league office" : "Adjusted by the league office",
    detail: (note || "").trim() || null,
    refKey: `admin:${randomUUID()}`,
  });
  return { ok: true, balance: await dbBalance(prisma, discordId) };
}

// Everyone who has an account, with their balance and who invited them — the
// admin's table. One query for the balances rather than one per member.
export async function adminOverview(prisma) {
  const accounts = await prisma.$queryRawUnsafe(
    `SELECT a."discordId", a."code", a."referredBy", a."createdAt",
            m."username", m."displayName", m."avatarUrl"
       FROM "TokenAccount" a
       LEFT JOIN "MemberAccount" m ON m."discordId" = a."discordId"
      ORDER BY a."createdAt" ASC`
  );
  const balances = await prisma.$queryRawUnsafe(
    `SELECT "discordId", COALESCE(SUM("delta"),0) AS bal FROM "TokenLedger" GROUP BY "discordId"`
  );
  const byId = new Map(balances.map((b) => [b.discordId, Number(b.bal)]));
  const names = new Map(accounts.map((a) => [a.discordId, a.displayName || a.username || a.discordId]));
  return accounts.map((a) => ({
    discordId: a.discordId,
    name: a.displayName || a.username || a.discordId,
    avatarUrl: a.avatarUrl || null,
    code: a.code,
    balance: byId.get(a.discordId) || 0,
    invitedBy: a.referredBy ? names.get(a.referredBy) || a.referredBy : null,
    invitedCount: accounts.filter((x) => x.referredBy === a.discordId).length,
    createdAt: a.createdAt,
  }));
}
