// ---------------------------------------------------------------------------
// The league's overrides for the token numbers: what a rule pays (for the
// whole league, and per series where one pays differently), what a shop entry
// costs, the referral cap, the multiplier thresholds. One Setting blob,
// edited from Admin -> Tokens -> Rules and prices. The code keeps the defaults;
// this file keeps only what the league changed, so a default that moves in the
// code still moves for everybody who never touched that field.
//
// Held in memory after the first read: the payout maths runs on every balance
// read and cannot afford a database round trip per number.
// ---------------------------------------------------------------------------

export const TUNING_SETTING = "token_tuning";

let current = null; // null = not read yet
let readAt = 0;
const TTL_MS = 30 * 1000; // re-read now and then, so a change made outside this process lands too

export function overrides() {
  return current || {};
}

export async function ensureTuning(prisma) {
  if (current && Date.now() - readAt < TTL_MS) return current;
  readAt = Date.now();
  const row = await prisma.setting.findUnique({ where: { key: TUNING_SETTING } }).catch(() => null);
  try {
    current = row?.value ? JSON.parse(row.value) : {};
  } catch {
    current = {};
  }
  return current;
}

// Long enough for "from" or "ab", short enough that it cannot push the price
// off the tile.
export const PREFIX_MAX = 12;

const int = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

// Validate and normalise what the admin sent. `allowed` names the keys that
// exist, so a typo cannot smuggle in a rule or an item the code does not know.
export function cleanTuning(body, allowed) {
  const out = {};
  const bad = (msg) => ({ error: msg });

  const section = (name, fields) => {
    const src = body?.[name];
    if (!src || typeof src !== "object") return;
    const dst = {};
    for (const key of allowed[name] || []) {
      const row = src[key];
      if (!row || typeof row !== "object") continue;
      const clean = {};
      for (const f of fields) {
        if (!(f in row)) continue;
        if (f === "active") {
          clean.active = !!row.active;
        } else if (f === "prefix") {
          // The word in front of a price ("from 1,200"). Typed by hand, so it
          // is tidied and kept short; empty means the code's own word again.
          const word = String(row.prefix ?? "").replace(/\s+/g, " ").trim();
          if (word.length > PREFIX_MAX) return bad(`${name}.${key}.prefix: ${PREFIX_MAX} characters at most`);
          if (word) clean.prefix = word;
        } else {
          const n = int(row[f]);
          if (Number.isNaN(n)) return bad(`${name}.${key}.${f}: whole number, 0 or more`);
          if (n != null) clean[f] = n;
        }
      }
      if (Object.keys(clean).length) dst[key] = clean;
    }
    if (Object.keys(dst).length) out[name] = dst;
  };

  // `laps` is the training milestone (20 and 50 by default); the rules that do
  // not have one simply never send it.
  let r = section("rules", ["points", "active", "laps"]);
  if (r?.error) return r;
  r = section("shop", ["cost", "active", "prefix"]);
  if (r?.error) return r;
  r = section("cards", ["cost"]);
  if (r?.error) return r;
  r = section("studio", ["cost"]);
  if (r?.error) return r;

  // A series' own numbers, on top of the league's: { "gt-sunday": {
  // race_finish: { points: 25 }, practice_20: { points: 5 } } }. Same fields
  // and the same "empty means inherit" as the rules above, one level deeper.
  // `allowed.series` names the series that exist and `allowed.seriesRules`
  // the rules a series can change.
  if (body?.seriesRules && typeof body.seriesRules === "object") {
    const all = {};
    for (const slug of allowed.series || []) {
      const src = body.seriesRules[slug];
      if (!src || typeof src !== "object") continue;
      const dst = {};
      for (const key of allowed.seriesRules || []) {
        const row = src[key];
        if (!row || typeof row !== "object") continue;
        const clean = {};
        if ("active" in row && row.active !== "" && row.active != null) clean.active = !!row.active;
        for (const f of ["points", "laps"]) {
          if (!(f in row)) continue;
          const n = int(row[f]);
          if (Number.isNaN(n)) return bad(`${slug} ${key} ${f}: whole number, 0 or more`);
          if (n != null) clean[f] = n;
        }
        if (Object.keys(clean).length) dst[key] = clean;
      }
      if (Object.keys(dst).length) all[slug] = dst;
    }
    if (Object.keys(all).length) out.seriesRules = all;
  }

  // The day a series' own numbers start: { "gt-sunday": "2026-09-28" }. A
  // round before it, and the training week leading up to it, still pays the
  // league's numbers. Empty = from the start.
  if (body?.seriesFrom && typeof body.seriesFrom === "object") {
    const m = {};
    for (const slug of allowed.series || []) {
      const d = String(body.seriesFrom[slug] || "").trim();
      if (!d) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return bad(`${slug} from: YYYY-MM-DD`);
      m[slug] = d;
    }
    if (Object.keys(m).length) out.seriesFrom = m;
  }

  // The day the tokens started counting: races before it pay nothing.
  if (body?.startDay !== undefined) {
    const d = String(body.startDay || "").trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return bad("start date: YYYY-MM-DD");
    if (d) out.startDay = d;
  }

  // Which race servers training laps count on. `{ nabs1: false }` means the
  // laps driven there are not counted at all; a server the league has never
  // said anything about counts, which is what makes this a switch to turn OFF
  // rather than a list to remember to fill in.
  if (body?.practiceServers && typeof body.practiceServers === "object") {
    const m = {};
    for (const key of allowed.servers || []) {
      if (!(key in body.practiceServers)) continue;
      m[key] = !!body.practiceServers[key];
    }
    if (Object.keys(m).length) out.practiceServers = m;
  }

  if (body?.referralRaceLimit !== undefined) {
    const n = int(body.referralRaceLimit);
    if (Number.isNaN(n)) return bad("referral limit: whole number, 0 or more");
    if (n != null) out.referralRaceLimit = n;
  }

  if (body?.multiplier && typeof body.multiplier === "object") {
    const m = {};
    for (const half of ["chat", "voice"]) {
      const src = body.multiplier[half];
      if (!src || typeof src !== "object") continue;
      const min = int(src.min);
      const max = int(src.max);
      if (Number.isNaN(min) || Number.isNaN(max)) return bad(`${half}: whole numbers, 0 or more`);
      const row = {};
      if (min != null) row.min = min;
      if (max != null) row.max = max;
      if (row.min != null && row.max != null && row.min >= row.max) return bad(`${half}: the upper number has to be above the lower one`);
      if (Object.keys(row).length) m[half] = row;
    }
    if (Object.keys(m).length) out.multiplier = m;
  }

  return { ok: true, tuning: out };
}

export async function saveTuning(prisma, tuning) {
  const value = JSON.stringify(tuning || {});
  await prisma.setting.upsert({
    where: { key: TUNING_SETTING },
    update: { value },
    create: { key: TUNING_SETTING, value },
  });
  current = tuning || {};
  readAt = Date.now();
  return current;
}

export async function resetTuning(prisma) {
  await prisma.setting.deleteMany({ where: { key: TUNING_SETTING } }).catch(() => null);
  current = {};
  readAt = Date.now();
  return current;
}
