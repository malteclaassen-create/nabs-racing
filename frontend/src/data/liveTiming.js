// Helpers for the Live page: format lap times, map in-sim driver names to NABS
// drivers (for flag + team colour), and resolve the session country flag.
import { countryFor } from "./driverCountries.js";
import { NO_VALUE } from "../utils/format.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// How close two names are, 0 to 1. A trimmed copy of the one the result import
// has always used (backend/src/services/acJsonParser.js, which owns the
// canonical version) — the board and the import should not disagree about who
// somebody is.
//
// It is here because a name in the game drifts from the name on the roster and
// nobody thinks to tell anyone: "Steven P6. Cheese" became "Steven H. Cheese",
// and somebody typed "Gabrielle Grossi" for Gabriele. Both stood on the timing
// board as strangers, with no flag and their car where their team should be.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[n];
}

function similarity(acName, driver) {
  const a = norm(acName);
  if (!a) return 0;
  let best = 0;
  for (const candidate of [driver.name, driver.discordName, driver.id]) {
    const b = norm(candidate);
    if (!b) continue;
    const maxLen = Math.max(a.length, b.length);
    let score = maxLen ? 1 - levenshtein(a, b) / maxLen : 0;
    if (a.includes(b) || b.includes(a)) score = Math.max(score, 0.9);
    best = Math.max(best, score);
  }
  return best;
}

// Deliberately stricter than the import's 0.55. An import guess is reviewed by
// an admin before it is saved; a guess here goes straight onto the board during
// a race with nobody checking, so the wrong flag on the wrong car is worse than
// no flag. The runner-up gap is the second half of that: a name has to be a
// clear winner, not merely the least bad of a crowded field.
const FUZZY_MIN = 0.8;
const FUZZY_LEAD = 0.15;

// Build a matcher from the /api/teams payload. Indexes each driver by their id,
// name and discordName (normalised) so an Assetto Corsa DriverName resolves to
// the NABS driver, their team colour and their flag.
export function makeDriverMatcher(teams) {
  const index = new Map();
  const all = [];
  for (const team of teams || []) {
    for (const d of team.drivers || []) {
      const entry = {
        id: d.id,
        nabsName: d.name,
        teamName: team.name,
        teamColor: team.color,
        tier: team.tier,
        // The row's OWN country first, the baseline name list only as a
        // fallback — the same order every other view uses. Called with just the
        // id, this consulted a hand-written list of names from the early
        // seasons and threw away whatever the admin or the driver had actually
        // set, so anyone who joined later stood on the timing board with no
        // flag while their profile, the entry list and the race pages all
        // showed one.
        country: countryFor(d.id, d.country),
        // Admin-set league role ('safety'), so the board can mark a safety car
        // driver by NAME. Not the same question as the board's own isSafetyCar,
        // which asks whether the car on track right now is the pace car.
        role: d.role || null,
      };
      for (const key of [d.id, d.name, d.discordName]) {
        const k = norm(key);
        if (k && !index.has(k)) index.set(k, entry);
      }
      // Kept for the fuzzy pass, which needs the raw names rather than the
      // normalised keys.
      all.push({ entry, name: d.name, discordName: d.discordName, id: d.id });
    }
  }
  // Every row of the board asks on every snapshot, several times a second. The
  // exact lookup is a Map hit; the fuzzy pass walks the whole roster, so its
  // answer is remembered per in-game name — the names change when somebody
  // joins the server, not between frames.
  const cache = new Map();
  return (acName) => {
    const key = norm(acName);
    if (!key) return null;
    const exact = index.get(key);
    if (exact) return exact;
    if (cache.has(key)) return cache.get(key);

    let best = null;
    let second = 0;
    for (const cand of all) {
      const score = similarity(acName, cand);
      if (!best || score > best.score) {
        second = best ? best.score : second;
        best = { entry: cand.entry, score };
      } else if (score > second) {
        second = score;
      }
    }
    const hit = best && best.score >= FUZZY_MIN && best.score - second >= FUZZY_LEAD ? best.entry : null;
    cache.set(key, hit);
    return hit;
  };
}

// nanosecond-derived ms -> "1:27.622" / "27.6s". null -> NO_VALUE.
export function formatLap(ms) {
  if (!ms || ms <= 0) return NO_VALUE;
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  const sStr = s.toFixed(3).padStart(6, "0"); // "07.622"
  return m > 0 ? `${m}:${sStr}` : `${s.toFixed(3)}`;
}

// Gap to session best: "+0.315" / NO_VALUE.
export function formatGap(ms) {
  if (ms == null) return NO_VALUE;
  if (ms === 0) return "0.000";
  return `+${(ms / 1000).toFixed(3)}`;
}

// A RACE gap: how far up the road somebody is, which past a certain point stops
// being a number of seconds and becomes a number of laps. The board decides
// which of the two applies and ships them separately (gapToLeaderMs, lapsDown),
// so nothing has to be guessed from the size of a number here.
export function formatRaceGap(ms, lapsDown) {
  if (lapsDown > 0) return `+${lapsDown} LAP${lapsDown > 1 ? "S" : ""}`;
  return formatGap(ms);
}

// Top speed -> "312.47" (km/h, two decimals). The server sends the value with
// its decimals intact; a bare integer hid how close two cars actually were down
// the straight. Anything missing (or a car with no lap yet) -> NO_VALUE.
export function formatSpeed(kmh) {
  if (kmh == null || !Number.isFinite(Number(kmh)) || Number(kmh) <= 0) return NO_VALUE;
  return Number(kmh).toFixed(2);
}

// Sector time -> "31.116". null -> NO_VALUE.
export function formatSector(ms) {
  if (!ms || ms <= 0) return NO_VALUE;
  return (ms / 1000).toFixed(3);
}

// Running current-lap clock -> "1:54.3" (tenths). null -> NO_VALUE.
export function formatRunning(ms) {
  if (ms == null || ms < 0) return NO_VALUE;
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : s.toFixed(1);
}

// Delta to personal best -> "-0.215" (faster) / "+0.318" (slower). null -> NO_VALUE.
export function formatDelta(ms) {
  if (ms == null) return NO_VALUE;
  const sign = ms > 0 ? "+" : ms < 0 ? "-" : "";
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}`;
}

// Remaining time -> "6d 01:48:51" or "48:51". null -> NO_VALUE.
export function formatCountdown(ms) {
  if (ms == null || ms < 0) return NO_VALUE;
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// Minimal country-name -> ISO code map for the session header flag (the live
// feed gives a country name, not a code). Extend as new tracks appear.
const COUNTRY_CODE = {
  turkey: "tr",
  italy: "it",
  germany: "de",
  france: "fr",
  spain: "es",
  bahrain: "bh",
  "saudi arabia": "sa",
  "czech republic": "cz",
  czechia: "cz",
  belgium: "be",
  australia: "au",
  brazil: "br",
  "united states": "us",
  usa: "us",
  "united kingdom": "gb",
  uk: "gb",
  japan: "jp",
  austria: "at",
  netherlands: "nl",
  portugal: "pt",
  mexico: "mx",
  canada: "ca",
  china: "cn",
  hungary: "hu",
  azerbaijan: "az",
  singapore: "sg",
  qatar: "qa",
  "united arab emirates": "ae",
  uae: "ae",
};

export function countryCodeFromName(name) {
  return COUNTRY_CODE[String(name || "").trim().toLowerCase()] || "";
}

// --- Tyre compounds ---------------------------------------------------------
// Map an Assetto Corsa compound name onto the F1-TV colour convention for the
// strategy view. AC mods name tyres every which way ("Soft", "(S)", "SM",
// "Hypersoft", "Wet"…), so we sniff the normalised string rather than demand an
// exact match; anything we can't place gets a stable colour from a small palette
// (hashed off the name, so the same unknown compound always keeps one colour).
const COMPOUND_PALETTE = ["#38bdf8", "#fb923c", "#c084fc", "#2dd4bf", "#f472b6", "#a3a3a3"];

// A light chip needs dark text + a thin rim to stay legible; everything else
// takes white text. Medium is white in the league scheme, so it sits here too.
const LIGHT_COMPOUNDS = new Set(["hard", "superhard", "medium"]);

// Short codes (as the current-tyre field ships them, e.g. "S", "SS", "I") take
// priority, so they can't be misread by the substring checks below (a tidy "ss"
// isn't "soft"). Then the descriptive names, most specific first, so "supersoft"
// resolves before plain "soft". Handles messy mod strings like "Soft (S)" too.
const SHORT_CODES = {
  hs: "hypersoft",
  us: "ultrasoft",
  ss: "supersoft",
  sh: "superhard",
  s: "soft",
  m: "medium",
  h: "hard",
  i: "intermediate",
  in: "intermediate",
  int: "intermediate",
  inter: "intermediate",
  w: "wet",
  wet: "wet",
};

function compoundKey(name) {
  const n = String(name || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!n) return null;
  if (SHORT_CODES[n]) return SHORT_CODES[n];
  if (n.includes("inter")) return "intermediate";
  if (n.includes("wet")) return "wet";
  if (n.includes("hyper")) return "hypersoft";
  if (n.includes("ultra")) return "ultrasoft";
  if (n.includes("super") && n.includes("soft")) return "supersoft";
  if (n.includes("super") && n.includes("hard")) return "superhard";
  if (n.includes("soft")) return "soft";
  if (n.includes("medium")) return "medium";
  if (n.includes("hard")) return "hard";
  return null;
}

// NABS league colour scheme (matched to the on-stream race-standings graphic):
// hypersoft pink, supersoft red, soft yellow, medium white, hard ice blue —
// i.e. one step "softer-coloured" than modern F1 (soft is yellow here, not red).
// Ultrasoft/superhard stay defined (purple / light grey) in case a future mod
// runs them, but the league doesn't use them. `light` compounds (see
// LIGHT_COMPOUNDS) are pale, so they take dark text + a thin rim.
//
// >>> To recolour a compound, change its `color` here (any CSS/hex value). If a
// >>> colour becomes pale, also add its key to LIGHT_COMPOUNDS above so the
// >>> letter flips to dark. That's the only place tyre colours are defined.
const COMPOUND_META = {
  hypersoft: { color: "#f472b6", label: "HS", name: "Hypersoft" },
  ultrasoft: { color: "#a855f7", label: "US", name: "Ultrasoft" },
  supersoft: { color: "#e11d2e", label: "SS", name: "Supersoft" },
  soft: { color: "#f4c410", label: "S", name: "Soft" },
  medium: { color: "#eceff3", label: "M", name: "Medium" },
  hard: { color: "#93d5ef", label: "H", name: "Hard" },
  superhard: { color: "#cbd5e1", label: "SH", name: "Superhard" },
  intermediate: { color: "#22c55e", label: "I", name: "Intermediate" },
  wet: { color: "#3b82f6", label: "W", name: "Wet" },
};

// Softest-to-hardest, then rain — the display order for legends and pickers.
export const COMPOUND_ORDER = ["HS", "US", "SS", "S", "M", "H", "SH", "I", "W"];

// Stable colour for an unknown compound: a tiny string hash into the palette.
function hashPick(str, arr) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

// { color, label, name, light } for a compound name. `light` marks pale chips
// that need dark text; `name` is the display name for legends (unknown
// compounds keep whatever the mod calls them).
export function tyreCompound(name) {
  const key = compoundKey(name);
  if (key && COMPOUND_META[key]) {
    return { ...COMPOUND_META[key], light: LIGHT_COMPOUNDS.has(key) };
  }
  const raw = String(name || "").trim();
  return {
    color: raw ? hashPick(raw.toLowerCase(), COMPOUND_PALETTE) : "#94a3b8",
    label: raw ? raw.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?" : "?",
    name: raw || "Unknown",
    light: false,
  };
}
