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
