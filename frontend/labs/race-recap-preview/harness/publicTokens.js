// The NABS Tokens chapter for the real round. The member's token ledger is
// private (the real payload carries `points: null`), so what this round EARNED
// is worked out here from the league's public token rules, exactly as the
// backend pays a round (origin/main backend/src/lib/tokenRules.js EARN_RULES,
// lib/tokens.js payRace/syncEarned, lib/raceRecap.js pointsFor):
//
//   race_finish  "Finished a race"           50 x rate   status FINISHED
//   clean_race   "Clean race, no penalties"  20 x rate   raceWasClean(): no steward
//                                                         time penalty and the import
//                                                         recorded 0 in-game penalties;
//                                                         paid once stewardingClosed()
//                                                         (the first Tuesday after the
//                                                         race, 09:00 Berlin), before
//                                                         that it is shown as pending
//
// Nothing else in the rules is about the race result: no tokens for the
// position, the fastest lap, pole or laps led. The training-lap and referral
// rules are about the week and the person, not the round, and are not public.
// `rate` is the Discord activity multiplier stamped for the round; the rules
// put everybody on 1.0 until the league's Discord bot reports (the "activity"
// rule is `active: false`), so the round is priced at 1.0 here.
//
// The balance and the next card design depend on the member's whole ledger
// and purchases, which are private: they are SAMPLE values, flagged `sample`,
// and the card says so on the page.

const RULES = { race_finish: 50, clean_race: 20 };
const LEAGUE_TZ = "Europe/Berlin";

const withMultiplier = (points, m) => Math.round(points * (Number.isFinite(m) && m > 0 ? m : 1));

function raceWasClean(r) {
  if (!r) return false;
  if (Number(r.penaltySeconds || 0) > 0) return false;
  if (r.gamePenalties == null) return false;
  return Number(r.gamePenalties) === 0;
}

// tokenRules.js stewardsDoneAt: the first Tuesday after the race day, 09:00
// league time.
function leagueParts(t) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: LEAGUE_TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
  const out = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}
function leagueInstant(y, m, d, hour) {
  const guess = Date.UTC(y, m - 1, d, hour);
  const p = leagueParts(guess);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return guess - (asUtc - guess);
}
function stewardsDoneAt(raceDate) {
  const t = new Date(raceDate).getTime();
  if (!Number.isFinite(t)) return null;
  const p = leagueParts(t);
  const weekday = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay();
  const wait = (2 - weekday + 7) % 7 || 7;
  return leagueInstant(+p.year, +p.month, +p.day + wait, 9);
}

export function publicTokens(recap, now = Date.now()) {
  const row = recap.results.find((r) => r.driverId === recap.you?.driverId);
  if (!row || row.status !== "FINISHED") return null;
  const rate = 1;
  const entries = [{ rule: "race_finish", title: "Finished a race", delta: withMultiplier(RULES.race_finish, rate), race: null }];
  const pending = [];
  if (raceWasClean(row)) {
    const clean = { rule: "clean_race", title: "Clean race, no penalties", delta: withMultiplier(RULES.clean_race, rate), race: null };
    const done = stewardsDoneAt(recap.race.date);
    if (done != null && now >= done) entries.push(clean);
    else pending.push(clean);
  }
  return {
    earning: true,
    rate: null,
    entries,
    earned: entries.reduce((s, e) => s + e.delta, 0),
    pending,
    hypothetical: false,
    fromRules: true,
    // SAMPLE: the real balance and the cheapest card design still to buy are
    // private. 700 is the public price of the cheapest series (Spectrum,
    // lib/cardShop.js); which design is next depends on what is owned.
    balance: 540,
    nextCard: { name: "Liquid Holo", collection: "Spectrum", cost: 700 },
    sample: { balance: true, nextCard: true },
  };
}
