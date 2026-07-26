// Splits a season's game label (e.g. "F1 2007 · Assetto Corsa") into the car
// era and the sim platform, so page copy can reference either part and stays
// correct when a season runs on different cars or a different sim. The
// separator may be "·", "/" or "|"; a missing platform falls back to the
// league's long-time home, Assetto Corsa.
export function seasonGameParts(season) {
  const [era, platform] = (season?.game || "").split(/[·/|]/).map((s) => s.trim());
  return {
    era: era || null,
    platform: platform || "Assetto Corsa",
  };
}

// The same label, always written with the site's separator. The field is free
// text an admin types per season, so the eight seasons ended up reading
// "F1 2007 · Assetto Corsa" seven times and "F1 2010 / Assetto Corsa" once —
// and the era strip on the landing page puts them side by side, where one odd
// slash is the only thing that catches the eye. Normalising on the way out
// keeps the admin free to type whatever and the page consistent regardless.
// Returns null for an empty field so callers can keep using `&&`.
export function seasonGameLabel(season) {
  if (!season?.game) return null;
  const { era, platform } = seasonGameParts(season);
  return era ? `${era} · ${platform}` : platform;
}
