// Helpers for the Live page: format lap times, map in-sim driver names to NABS
// drivers (for flag + team colour), and resolve the session country flag.
import { countryFor } from "./driverCountries.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Build a matcher from the /api/teams payload. Indexes each driver by their id,
// name and discordName (normalised) so an Assetto Corsa DriverName resolves to
// the NABS driver, their team colour and their flag.
export function makeDriverMatcher(teams) {
  const index = new Map();
  for (const team of teams || []) {
    for (const d of team.drivers || []) {
      const entry = {
        id: d.id,
        nabsName: d.name,
        teamName: team.name,
        teamColor: team.color,
        tier: team.tier,
        country: countryFor(d.id),
      };
      for (const key of [d.id, d.name, d.discordName]) {
        const k = norm(key);
        if (k && !index.has(k)) index.set(k, entry);
      }
    }
  }
  return (acName) => index.get(norm(acName)) || null;
}

// nanosecond-derived ms -> "1:27.622" / "27.6s". null -> "—".
export function formatLap(ms) {
  if (!ms || ms <= 0) return "—";
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  const sStr = s.toFixed(3).padStart(6, "0"); // "07.622"
  return m > 0 ? `${m}:${sStr}` : `${s.toFixed(3)}`;
}

// Gap to session best: "+0.315" / "—".
export function formatGap(ms) {
  if (ms == null) return "—";
  if (ms === 0) return "0.000";
  return `+${(ms / 1000).toFixed(3)}`;
}

// Sector time -> "31.116". null -> "—".
export function formatSector(ms) {
  if (!ms || ms <= 0) return "—";
  return (ms / 1000).toFixed(3);
}

// Running current-lap clock -> "1:54.3" (tenths). null -> "—".
export function formatRunning(ms) {
  if (ms == null || ms < 0) return "—";
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : s.toFixed(1);
}

// Delta to personal best -> "-0.215" (faster) / "+0.318" (slower). null -> "—".
export function formatDelta(ms) {
  if (ms == null) return "—";
  const sign = ms > 0 ? "+" : ms < 0 ? "-" : "";
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}`;
}

// Remaining time -> "6d 01:48:51" or "48:51". null -> "—".
export function formatCountdown(ms) {
  if (ms == null || ms < 0) return "—";
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
