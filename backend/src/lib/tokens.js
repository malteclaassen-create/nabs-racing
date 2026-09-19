// ---------------------------------------------------------------------------
// Server tokens: the league's reward currency.
//
// A member earns tokens for the things that grow the server — racing, and
// bringing other people in through their own invite link — and spends them in a
// small shop (a helmet of their own, a card background, a role on Discord).
// Championship points decide the title; these decide nothing, which is exactly
// why they are called TOKENS and not points. Two currencies with the same name
// on one site would have been read wrong by somebody within the week.
//
// TRIAL FEATURE. Everything here is behind one switch (see isTokensEnabled):
// OFF on a real deployment unless an admin turns it on, ON locally. Disabled
// means the API says "not available" and the frontend shows no door to it at
// all, so the half-built shop cannot be found by a driver before the league has
// decided what the prizes actually are.
//
// --- how the earning works --------------------------------------------------
//
// Nothing is awarded at the moment it happens. The ledger is RECONCILED: when a
// member's balance is read, we count what they have actually done (races
// driven, people invited and what those people have done) and write the rows
// that are missing, each under a `refKey` that is unique per member. Running it
// twice changes nothing, and a rule added next month pays out retroactively for
// everything that already happened — which for a system that will certainly be
// re-tuned a few times is worth far more than the milliseconds it costs.
//
// So there is no hook in the race import, no hook in the login, and no way for
// a crash between two writes to leave somebody paid twice or not at all.
//
// --- the tables -------------------------------------------------------------
//
//   TokenAccount     one row per member: their invite code, and who invited THEM
//   TokenLedger      append-only. balance = SUM(delta). refKey makes it idempotent
//   TokenRedemption  a shop order, worked through by an admin by hand
//
// Raw SQL like Notification/MemberAccount/Feedback (the running dev server locks
// the generated Prisma client on Windows). Keep in sync with the models in
// prisma/schema.prisma and the CREATE TABLEs in lib/ensureSchema.js.
// ---------------------------------------------------------------------------
import { randomUUID, randomInt } from "crypto";
import { IS_DEPLOYED } from "./deployment.js";
import { catalogueFor, isBuyableDesign, ownedDesigns, priceOf, CARD_DESIGN_BY_KEY } from "./cardShop.js";
import { overrides, ensureTuning, saveTuning } from "./tokenTuning.js";
import { STUDIO_BY_ID, studioPriceOf, ownedStudioItems } from "./profileStudio.js";
// The league's own rules and their arithmetic live next door, with no database
// in them, so the numbers can be checked by the tests (lib/tokenRules.js).
import {
  ACTIVITY_WINDOW_DAYS,
  EARN_RULES,
  MULTIPLIER,
  RULE_BY_KEY,
  REFERRAL_RACE_LIMIT,
  activityMultiplier,
  activityWindowStart,
  leagueDay,
  pointsFor,
  raceWasClean,
  stewardingClosed,
  withMultiplier,
} from "./tokenRules.js";

export { ACTIVITY_WINDOW_DAYS, EARN_RULES, RULE_BY_KEY, REFERRAL_RACE_LIMIT, activityMultiplier };

// The one switch. Stored as a Setting so it can be flipped in the admin without
// a deploy; absent means "whatever this machine's default is", which is ON for
// a laptop and OFF for the live site.
export const TOKENS_SETTING = "tokens_enabled";

// Three settings: "off", "admins" (only league admins see the feature, to try
// it on the live site without anybody else noticing) and "all".
export const TOKEN_MODES = ["off", "admins", "all"];

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
  // The league starts from zero: the first time the points go on (for anybody),
  // today becomes the day races start counting. Nothing before it pays. The
  // admin can move the date afterwards under Rules and prices.
  if (value !== "off") {
    const t = await ensureTuning(prisma);
    if (!t.startDay) await saveTuning(prisma, { ...t, startDay: leagueDay() });
  }
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
    key: "profile_flair",
    name: "Profile flair",
    cost: 500,
    category: "On the site",
    description: "A mark next to your name on your public profile.",
    blurb: "Pick one of the marks below. It sits next to your name on your public profile page from the moment you buy it, no waiting for anybody.",
    instant: true,
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
    blurb: "Fifty-odd designs for your public profile: page themes, banners, name lettering, stats styles and effects. Try them on your own page before you buy.",
    link: "/profile/style",
    catalogue: true,
  },
  {
    key: "hall_of_fame",
    name: "Hall of fame entry",
    cost: 2500,
    category: "On the site",
    description: "Your name on the league's board for the people who built it.",
    blurb:
      "The most expensive thing in here on purpose: a name on the wall should take about a season to earn. Your name goes on the Hall of Fame page right away, with the month you got there.",
    instant: true,
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

export const SHOP_BY_KEY = new Map(SHOP_ITEMS.map((i) => [i.key, i]));

// --- the numbers as the league has set them (Admin -> Tokens -> Rules and
// prices), falling back to the code's defaults field by field.
export function tunedRules() {
  const o = overrides().rules || {};
  return EARN_RULES.map((r) => ({
    ...r,
    points: o[r.key]?.points ?? r.points,
    active: r.key === "activity" ? r.active : (o[r.key]?.active ?? r.active),
  }));
}
const tunedRule = (key) => tunedRules().find((r) => r.key === key);
const tunedPoints = (key) => tunedRule(key)?.points ?? 0;
const ruleOn = (key) => tunedRule(key)?.active !== false;

export function tunedShop() {
  const o = overrides().shop || {};
  return SHOP_ITEMS.map((i) => ({ ...i, cost: o[i.key]?.cost ?? i.cost, active: o[i.key]?.active ?? true }));
}
const tunedItem = (key) => tunedShop().find((i) => i.key === key);
export const tunedReferralLimit = () => overrides().referralRaceLimit ?? REFERRAL_RACE_LIMIT;
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

// Record that `discordId` arrived through `code`. Deliberately unforgiving, and
// every one of these three rules is load-bearing:
//
//   * a member keeps the FIRST inviter they ever had, for good
//   * nobody invites themselves
//   * only somebody who has never raced can be claimed as an invite
//
// The last one is the one that stops the obvious exploit. Payouts for an invite
// are retroactive over that person's whole career, so without it, sending your
// link to a driver who has been in the league for three seasons and having them
// click it would pay you for their seventy races. "Invited" has to mean "was
// not here yet", and the honest version of that is: they have not raced.
//
// Returns the inviter's id when something was actually written.
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
    await prisma.$executeRawUnsafe(
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
    return true;
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
async function driverIdsFor(prisma, discordId) {
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
    return await prisma.$queryRawUnsafe(
      `SELECT "discordId" FROM "TokenAccount" WHERE "referredBy" = ? AND COALESCE("referredAt", '') >= ?`,
      discordId,
      tunedStartDay() ? `${tunedStartDay()} 00:00:00` : ""
    );
  } catch {
    return [];
  }
}

// Every race this member has FINISHED, with what the round needs for the
// clean-race bonus. DNS, DNF and DSQ are not finishes and pay nothing: the
// league's sheet says "FINISH a race".
async function racesFinished(prisma, discordId) {
  const ids = await driverIdsFor(prisma, discordId);
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(",");
  const rows = await prisma.$queryRawUnsafe(
    `SELECT r."id" AS "resultId", r."penaltySeconds" AS "penaltySeconds",
            r."gamePenalties" AS "gamePenalties",
            ra."track" AS "track", ra."date" AS "date"
       FROM "RaceResult" r
       JOIN "Race" ra ON ra."id" = r."raceId"
      WHERE r."driverId" IN (${ph}) AND ra."isCompleted" = 1 AND r."status" = 'FINISHED'
        AND ra."date" >= ?
      ORDER BY ra."date" ASC`,
    ...ids,
    // ISO dates compare as text; with no start day, everything is after "".
    tunedStartDay() ? `${tunedStartDay()}T00:00:00` : ""
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

export async function activityKeyValid(prisma, given) {
  const key = await readActivityKey(prisma);
  return !!key && typeof given === "string" && given.length === key.length && given === key;
}


// One day of one member's activity, as the bot reports it. Absolute totals for
// that day, not increments: the bot can send today's numbers as often as it
// likes — every five minutes, or twice because it restarted — and the row ends
// up saying the same thing either way.
export async function recordActivity(prisma, discordId, { day, messages = 0, minutes = 0 } = {}) {
  if (!discordId) return { error: "Which member?" };
  const d = String(day || leagueDay());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: "Bad day" };
  await ensureTokenAccount(prisma, discordId);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TokenActivity" ("discordId","day","messages","minutes")
     VALUES (?,?,?,?)
     ON CONFLICT("discordId","day") DO UPDATE SET
       "messages" = excluded."messages",
       "minutes" = excluded."minutes",
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

// The multiplier this member currently carries. Nothing writes the daily rows
// yet, so this is 1.0 for everybody until the bot exists — see lib/tokenRules.js.
export async function multiplierFor(prisma, discordId) {
  const totals = await activityTotals(prisma, discordId);
  return { ...activityMultiplier(totals, tunedMultiplier()), ...totals, windowDays: ACTIVITY_WINDOW_DAYS };
}

// Bring one member's ledger up to date. Safe to call as often as you like.
export async function syncEarned(prisma, discordId) {
  if (!discordId) return;
  await ensureTokenAccount(prisma, discordId);
  // The multiplier is applied when a race is PAID, and the row is written once
  // and never rewritten. So it is the multiplier you had when the round landed,
  // not the one you have today: racing in a week you were around for is worth
  // what it was worth that week, and nobody's history silently re-values itself
  // every time they say something on Discord.
  const { total: multiplier } = await multiplierFor(prisma, discordId);

  // --- what they finished themselves
  for (const r of await racesFinished(prisma, discordId)) {
    if (!ruleOn("race_finish")) break;
    await dbAward(prisma, {
      discordId,
      delta: withMultiplier(tunedPoints("race_finish"), multiplier),
      rule: "race_finish",
      title: "Finished a race",
      detail: r.track || null,
      refKey: `race:${r.resultId}`,
      at: r.date,
    });
    // The bonus for a round nobody was penalised in, once the stewards are done
    // with it. Before that it is not decided, and a token paid out early cannot
    // be taken back on the Monday without it looking like a mistake.
    if (ruleOn("clean_race") && raceWasClean(r) && stewardingClosed(r.date)) {
      await dbAward(prisma, {
        discordId,
        delta: withMultiplier(tunedPoints("clean_race"), multiplier),
        rule: "clean_race",
        title: "Clean race, no penalties",
        detail: r.track || null,
        refKey: `clean:${r.resultId}`,
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
    // Their first twelve finishes pay, and then this stops. Keyed on the race
    // itself rather than on a running count, so the cap cannot be walked past
    // by a race being re-imported or a result being corrected.
    if (!ruleOn("referral_race")) continue;
    const theirs = (await racesFinished(prisma, inv.discordId)).slice(0, tunedReferralLimit());
    for (const r of theirs) {
      await dbAward(prisma, {
        discordId,
        delta: tunedPoints("referral_race"),
        rule: "referral_race",
        title: `${who} finished a race`,
        detail: r.track || null,
        refKey: `referral-race:${inv.discordId}:${r.resultId}`,
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
    return {
      ...r,
      cost: Number(r.cost),
      member: r.displayName || r.username || undefined,
      // Only the things a person has to do (helmet, Discord role) are orders
      // in the admin sense; card designs, flairs and wall entries the site
      // fills itself and are just a record.
      manual: !!item && !item.instant && !item.catalogue,
      detail: r.itemKey === "profile_flair" ? FLAIR_BY_KEY.get(r.note)?.label || null : null,
    };
  });
}

// One row in somebody's collection: something they bought.
async function writeRedemption(prisma, { discordId, key, name, cost, status = "NEW", note = null }) {
  const id = randomUUID();
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

// Spend tokens on a shop item. Returns { error } rather than throwing for the
// two things a member can get wrong, so the page can say which one it was.
export async function redeemItem(prisma, discordId, itemKey, choice = null) {
  const item = tunedItem(String(itemKey || ""));
  if (!item || !item.active) return { error: "Unknown item" };
  // The card designs are bought one by one from the catalogue (buyCardDesign),
  // never as a blank order for the league office.
  if (item.catalogue) return { error: "Pick a design from the catalogue" };
  let note = null;
  if (item.key === "profile_flair") {
    const flair = FLAIR_BY_KEY.get(String(choice || ""));
    if (!flair) return { error: "Pick a mark first" };
    note = flair.key;
  }
  await syncEarned(prisma, discordId);
  const balance = await dbBalance(prisma, discordId);
  if (balance < item.cost) return { error: "Not enough points for that yet" };
  // Instant items are filled by the site itself, the rest wait for a person.
  const id = await writeRedemption(prisma, {
    discordId,
    key: item.key,
    name: item.name,
    cost: item.cost,
    status: item.instant ? "DONE" : "NEW",
    note,
  });
  await dbAward(prisma, {
    discordId,
    delta: -item.cost,
    rule: "redeem",
    title: `${item.instant ? "Bought" : "Ordered"}: ${item.name}`,
    detail: item.instant ? "Yours right away" : "Waiting for the league office",
    refKey: `redeem:${id}`,
  });
  return { ok: true, id, balance: balance - item.cost, instant: !!item.instant };
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
    const f = FLAIR_BY_KEY.get(r.note);
    if (f) out.set(r.discordId, f);
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
export async function leaderboard(prisma, limit = 10) {
  const earned = await prisma
    .$queryRawUnsafe(
      `SELECT "discordId", SUM("delta") AS "earned"
         FROM "TokenLedger" WHERE "delta" > 0 AND "rule" <> 'refund'
        GROUP BY "discordId" ORDER BY "earned" DESC, MIN("createdAt") ASC LIMIT ?`,
      limit
    )
    .catch(() => []);
  const active = await prisma
    .$queryRawUnsafe(
      `SELECT "discordId", SUM("messages") AS "messages", SUM("minutes") AS "minutes"
         FROM "TokenActivity" WHERE "day" >= ?
        GROUP BY "discordId" ORDER BY (SUM("messages") + SUM("minutes")) DESC LIMIT ?`,
      activityWindowStart(),
      limit
    )
    .catch(() => []);
  const names = await namesFor(prisma, [...earned, ...active].map((r) => r.discordId));
  return {
    earned: earned.map((r) => ({ discordId: r.discordId, ...names.get(r.discordId), earned: Number(r.earned) })),
    active: active.map((r) => ({
      discordId: r.discordId,
      ...names.get(r.discordId),
      messages: Number(r.messages),
      minutes: Number(r.minutes),
    })),
    windowDays: ACTIVITY_WINDOW_DAYS,
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
  const owned = await ownedDesigns(prisma, discordId);
  if (owned.has(key)) return { error: "You already have that one" };
  await syncEarned(prisma, discordId);
  const balance = await dbBalance(prisma, discordId);
  if (balance < cost) return { error: "Not enough points for that yet" };
  const id = await writeRedemption(prisma, {
    discordId,
    key,
    name: design.name,
    cost,
    status: "DONE",
  });
  await dbAward(prisma, {
    discordId,
    delta: -cost,
    rule: "card_design",
    title: `Bought: ${design.name}`,
    detail: "Card design, yours right away",
    refKey: `card:${id}`,
  });
  return { ok: true, id, design: { ...design, cost }, balance: balance - cost };
}

// A profile studio design: paid once, owned for good, worn from the studio
// page. Same shape as a card design, and the same rule: nothing here is ever
// handed out by results.
export async function buyStudioItem(prisma, discordId, itemId) {
  const item = STUDIO_BY_ID.get(String(itemId || ""));
  if (!item) return { error: "Unknown design" };
  const cost = studioPriceOf(item, tunedStudio());
  const owned = await ownedStudioItems(prisma, discordId);
  if (owned.has(item.id)) return { error: "You already have that one" };
  await syncEarned(prisma, discordId);
  const balance = await dbBalance(prisma, discordId);
  if (balance < cost) return { error: "Not enough points for that yet" };
  const id = await writeRedemption(prisma, { discordId, key: item.id, name: item.name, cost, status: "DONE" });
  await dbAward(prisma, {
    discordId,
    delta: -cost,
    rule: "studio",
    title: `Bought: ${item.name}`,
    detail: "Profile design, yours right away",
    refKey: `studio:${id}`,
  });
  return { ok: true, id, balance: balance - cost };
}

// An admin working through an order. Declining refunds it — the tokens were
// never spent on anything, and a member who cannot see why an order vanished
// writes to the admin about it, which is worse than the refund row.
export async function setRedemptionStatus(prisma, id, status, note = null) {
  const s = String(status || "").toUpperCase();
  if (!REDEMPTION_STATUSES.includes(s)) return { error: "Unknown status" };
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "TokenRedemption" WHERE "id" = ?`, id);
  const row = rows[0];
  if (!row) return { error: "Not found" };
  await prisma.$executeRawUnsafe(
    `UPDATE "TokenRedemption" SET "status" = ?, "note" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`,
    s,
    note ?? row.note ?? null,
    id
  );
  if (s === "DECLINED") {
    await dbAward(prisma, {
      discordId: row.discordId,
      delta: Number(row.cost),
      rule: "refund",
      title: `Refunded: ${row.itemName}`,
      detail: note || "The league office could not fill this order",
      refKey: `refund:${id}`,
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
