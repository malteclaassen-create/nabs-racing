// ---------------------------------------------------------------------------
// The league's token rules, exactly as the league wrote them down, and the
// arithmetic that goes with them. No database in this file, so all of it can be
// checked by the tests rather than by somebody racing.
//
// --- what earns tokens ------------------------------------------------------
//
//   Finish a race                50   x multiplier
//   ...with no penalties         20   x multiplier   (decided after stewarding)
//   Somebody signs up through
//   your referral                50
//   That person finishes a race  30   for their first 12 races, then it stops
//
// --- the multiplier ---------------------------------------------------------
//
// Being around on Discord multiplies what RACING earns, and nothing else: the
// referral points are flat, which is what keeps "bring a friend" from turning
// into the main way to earn.
//
// Two halves, chat and voice, each worth 1.1x at its lower threshold and 2.0x
// at its upper one. The league adds up what each half earns ON TOP of one:
//
//   total = 1 + (chat - 1) + (voice - 1)      which is  chat + voice - 1
//
// So 1.6 and 1.4 are "0.6 and 0.4 on top", making 2.0, and both halves at their
// maximum are "1.0 and 1.0 on top", making the 3.0x ceiling the league named.
// Neither half counts at all below its lower threshold, so somebody who never
// touches Discord is on a plain 1.0x and is never worse off than that.
//
// --- over what period -------------------------------------------------------
//
// The last THIRTY DAYS, counted afresh every day — not calendar months. So the
// multiplier is what somebody has been doing lately, and a quiet month lets it
// fall back on its own. That is also why the site keeps one row per member per
// DAY rather than a running total: a total can only ever grow, and the thing
// being measured has to be able to shrink.
//
// AFK time in a voice channel counts. The league decided that deliberately: the
// multiplier only ever multiplies RACING, so somebody parked in a channel all
// week still earns nothing until they turn up on a Friday.
//
// NOTE: nothing fills those daily rows yet — that needs the league's Discord
// bot, which does not exist. Until it does, every multiplier is 1.0x and the
// maths below sits inert, which is why it is worth having pinned down by tests
// now rather than written in a hurry the evening the bot arrives.
// ---------------------------------------------------------------------------

// How far back the multiplier looks, in days, counted in the league's own
// timezone so a day is a day for the people in it.
export const ACTIVITY_WINDOW_DAYS = 30;

export const MULTIPLIER = {
  // "MIN multiplier for chat messages: 50 messages" and so on, straight off the
  // league's sheet.
  chat: { min: 50, max: 500, unit: "messages" },
  voice: { min: 5 * 60, max: 25 * 60, unit: "minutes" }, // the sheet says 5 and 25 HOURS
  // What one half is worth at its lower and upper threshold.
  floor: 1.1,
  ceiling: 2,
  // Both halves at the top: 2 + 2 - 1.
  total: 3,
};

// One half of the multiplier. Below the lower threshold it does not count (1),
// at the threshold it is 1.1, at the upper one 2.0, and a straight line in
// between.
export function halfMultiplier(value, { min, max }) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < min) return 1;
  if (v >= max) return MULTIPLIER.ceiling;
  const share = (v - min) / (max - min);
  return MULTIPLIER.floor + share * (MULTIPLIER.ceiling - MULTIPLIER.floor);
}

// The whole multiplier for one member. Rounded to two decimals because it is a
// number people will compare with each other, and 1.7300000000000002 is not a
// number anybody compares.
export function activityMultiplier({ chatMessages = 0, vcMinutes = 0 } = {}, m = MULTIPLIER) {
  const chat = halfMultiplier(chatMessages, m.chat || MULTIPLIER.chat);
  const voice = halfMultiplier(vcMinutes, m.voice || MULTIPLIER.voice);
  const total = Math.min(MULTIPLIER.total, Math.max(1, chat + voice - 1));
  return {
    chat: Math.round(chat * 100) / 100,
    voice: Math.round(voice * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

// What a multiplied rule actually pays. Whole tokens: a balance with a half in
// it would be a balance nobody trusts.
export function withMultiplier(points, multiplier) {
  const m = Number(multiplier);
  return Math.round(Number(points) * (Number.isFinite(m) && m > 0 ? m : 1));
}

// --- the rules themselves ----------------------------------------------------
//
// `boosted` marks the ones the multiplier applies to — the green boxes on the
// league's sheet. `active: false` is a rule the site cannot measure yet.
export const EARN_RULES = [
  {
    key: "race_finish",
    label: "Finish a race",
    hint: "Every round you take the flag in, in any series.",
    points: 50,
    unit: "per race",
    boosted: true,
    active: true,
  },
  {
    key: "clean_race",
    label: "Finish it without a penalty",
    hint: "On top of the 50. Paid on the Tuesday after the round, once the stewards have been through the reports.",
    points: 20,
    unit: "per clean race",
    boosted: true,
    active: true,
  },
  {
    key: "referral_join",
    label: "Someone signs up through you",
    hint: "They use your invite link, or name you when they join.",
    points: 50,
    unit: "per person",
    active: true,
  },
  {
    key: "referral_race",
    label: "That person finishes a race",
    hint: "For their first 12 races. After that this one stops paying.",
    points: 30,
    unit: "per race",
    active: true,
  },
  {
    key: "activity",
    label: "Chat and voice activity",
    hint: "Multiplies what racing earns, up to 3x. Needs the league's Discord bot, which is not connected yet.",
    points: 0,
    unit: "multiplier",
    active: false,
  },
];

export const RULE_BY_KEY = new Map(EARN_RULES.map((r) => [r.key, r]));
export const pointsFor = (key) => RULE_BY_KEY.get(key)?.points || 0;

// How many of an invited driver's races still pay the person who brought them
// in. Twelve is a season, which is the point: a referral is worth a season of
// somebody else's racing, not a pension.
export const REFERRAL_RACE_LIMIT = 12;

// The clean-race bonus is only worth anything once the stewards have finished
// with the round: a penalty handed out afterwards has to be able to take it
// away again, and a token already paid cannot be taken back without looking
// like a mistake.
//
// The league's sheet says "this only applies on tuesday morning", and the
// reason is the league's own routine: the stewards work through the reports on
// MONDAY, so Tuesday morning is the first moment a round is settled. That is
// what this computes — the first Tuesday after the race, at nine in the
// morning, league time — rather than "N days later", which would land on a
// different weekday for the Friday league than for the Sunday one.
const LEAGUE_TZ = "Europe/Berlin";
const REVIEW_HOUR = 9; // "tuesday morning"
const TUESDAY = 2; // as JavaScript counts weekdays: Sunday is 0

// What the league's clock reads at an instant, as civil parts.
function leagueParts(t) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LEAGUE_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

// The instant at which a given civil time in the league's timezone happens.
// Guess it in UTC, ask what the league's clock called that moment, and correct
// by the difference — the same trick the frontend's reportsAccess.js uses, and
// off by an hour only inside the one hour a year the clocks go back.
function leagueInstant(y, m, d, hour) {
  const guess = Date.UTC(y, m - 1, d, hour);
  const p = leagueParts(guess);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return guess - (asUtc - guess);
}

// The league's calendar day for an instant, as "YYYY-MM-DD". The bot counts in
// days, and a day has to mean the same thing to it and to the site.
export function leagueDay(t = Date.now()) {
  const p = leagueParts(t);
  return `${p.year}-${p.month}-${p.day}`;
}

// Midnight league time on a "YYYY-MM-DD", as an instant. The start day is a
// date the admin typed in Berlin, but the things it is compared against are
// stored in two different shapes, so both callers convert from here rather
// than each pasting a date into a string and hoping.
export function leagueDayStart(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m) return null;
  return leagueInstant(+m[1], +m[2], +m[3], 0);
}

// The first day that still counts towards the multiplier: today and the
// twenty-nine before it. Everything older has fallen out of the window.
export function activityWindowStart(now = Date.now()) {
  const p = leagueParts(now);
  const start = Date.UTC(+p.year, +p.month - 1, +p.day - (ACTIVITY_WINDOW_DAYS - 1));
  const d = new Date(start);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// When the stewards are done with a round: the first Tuesday AFTER the day it
// was raced, at nine in the morning. A round raced on a Tuesday waits for the
// next one, because its reports are read the Monday after it, not the one
// before.
export function stewardsDoneAt(raceDate) {
  if (!raceDate) return null;
  const t = new Date(raceDate).getTime();
  if (!Number.isFinite(t)) return null;
  const p = leagueParts(t);
  const y = +p.year;
  const m = +p.month;
  const d = +p.day;
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const wait = ((TUESDAY - weekday + 7) % 7) || 7; // never the race day itself
  return leagueInstant(y, m, d + wait, REVIEW_HOUR);
}

export function stewardingClosed(raceDate, now = Date.now()) {
  const done = stewardsDoneAt(raceDate);
  return done != null && now >= done; // no date, no idea whether it is settled
}

// Was this a clean race? No steward time penalty, and no in-game penalty that
// the import recorded. A round imported before the game-penalty columns existed
// carries null there, and null is NOT taken as "clean": the bonus is a reward
// for something we know happened, not for a gap in the data.
export function raceWasClean(result) {
  if (!result) return false;
  if (Number(result.penaltySeconds || 0) > 0) return false;
  if (result.gamePenalties == null) return false;
  return Number(result.gamePenalties) === 0;
}
