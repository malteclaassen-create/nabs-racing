// same day logic as the website (backend/src/lib/tokenRules.js)
export const LEAGUE_TZ = "Europe/Berlin";

const FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: LEAGUE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function leagueDay(t = Date.now()) {
  const parts = {};
  for (const p of FORMAT.formatToParts(new Date(t))) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// website looks at 30 days, keep a bit more in case a send failed
export const KEEP_DAYS = 35;

export function isStale(day, now = Date.now()) {
  const cutoff = new Date(now - KEEP_DAYS * 24 * 3600 * 1000);
  return day < leagueDay(cutoff.getTime());
}
