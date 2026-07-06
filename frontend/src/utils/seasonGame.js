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
