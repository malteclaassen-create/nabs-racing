// ---------------------------------------------------------------------------
// Rating card editions: the unlockable card designs a driver picks on /profile.
// Some are free, most are earned. This file is the catalogue + the pure unlock
// logic (no Prisma, so it's unit-testable); the stats/seals it reasons over are
// gathered by cardUnlockInputs in driverProfileService.js and the picked key is
// read/written per Driver row (Driver.cardStyle, raw SQL like cardPhotoPos).
//
// Two kinds of requirement, deliberately different (see card-editions spec):
//   * MILESTONE (req.stat): career totals over the person's seasons <= N —
//     earned once, kept forever, so the set only grows on newer cards.
//   * TITLE (req.badge / req.teamBadge): a podium/team seal of a SPECIFIC
//     season, so "Champion" means "won THIS season", not "won once". `offset`
//     shifts which season is required (defending champion = last season's seal).
// N is always the seasonNumber of the row being edited — nothing hardcoded.
// ---------------------------------------------------------------------------

export const CARD_EDITIONS = [
  // free: always selectable
  { key: "classic", name: "Classic", tagline: "Team colour", req: null },
  { key: "nabs", name: "NABS", tagline: "League edition", req: null },
  { key: "mono", name: "Mono", tagline: "Purist black & white", req: null },

  // milestone: career stats over seasons <= N
  { key: "rookie", name: "Rookie", tagline: "10 starts", req: { stat: "starts", n: 10 } },
  { key: "veteran", name: "Veteran", tagline: "20 starts", req: { stat: "starts", n: 20 } },
  { key: "legend", name: "Legend", tagline: "50 starts", req: { stat: "starts", n: 50 } },
  { key: "winner", name: "Winner", tagline: "First win", req: { stat: "wins", n: 1 } },
  { key: "dominator", name: "Dominator", tagline: "10 wins", req: { stat: "wins", n: 10 } },
  { key: "podium", name: "Podium", tagline: "10 podiums", req: { stat: "podiums", n: 10 } },
  { key: "poleman", name: "Poleman", tagline: "First pole", req: { stat: "poles", n: 1 } },
  { key: "qualiking", name: "Quali King", tagline: "5 poles", req: { stat: "poles", n: 5 } },

  // title: a podium seal of THIS season
  { key: "champion", name: "Champion", tagline: "Title this season", req: { badge: "champion" } },
  { key: "vice", name: "Vice", tagline: "P2 this season", req: { badge: "vice" } },
  { key: "bronze", name: "Bronze", tagline: "P3 this season", req: { badge: "third" } },
  { key: "teamchamp", name: "Team Champion", tagline: "Team title this season", req: { teamBadge: 1 } },

  // title: the PREVIOUS season's seal (F1-correct: you race the #1 the year after)
  { key: "defending", name: "Defending Champion", tagline: "Reigning titleholder", req: { badge: "champion", offset: -1 } },
];

export const CARD_EDITION_KEYS = CARD_EDITIONS.map((e) => e.key);
export const DEFAULT_CARD_EDITION = "classic";

// Compute the unlock state of every edition for ONE driver row.
//   stats:      { starts, wins, podiums, poles } — aggregated over seasons <= N
//   badges:     [{ type: "champion"|"vice"|"third", seasonNumber, ... }]
//   teamBadges: [{ position: 1|2|3, seasonNumber, ... }]
//   n:          the seasonNumber of the row being edited
// Returns [{ key, name, tagline, unlocked, requirement, have?, need? }].
export function unlockStateFor(stats, badges, teamBadges, n) {
  const s = stats || {};
  const bl = Array.isArray(badges) ? badges : [];
  const tbl = Array.isArray(teamBadges) ? teamBadges : [];
  return CARD_EDITIONS.map((e) => {
    const base = { key: e.key, name: e.name, tagline: e.tagline, requirement: e.req };
    // Free.
    if (!e.req) return { ...base, unlocked: true };
    // Milestone: career stat over seasons <= N, with progress for the picker.
    if (e.req.stat) {
      const have = Number(s[e.req.stat]) || 0;
      return { ...base, unlocked: have >= e.req.n, have, need: e.req.n };
    }
    // Title: a driver podium seal of the required season (binary — no progress).
    if (e.req.badge) {
      const want = n + (e.req.offset ?? 0);
      const unlocked = bl.some((b) => b.type === e.req.badge && b.seasonNumber === want);
      return { ...base, unlocked };
    }
    // Title: a constructor seal of the required position in the required season.
    if (e.req.teamBadge != null) {
      const want = n + (e.req.offset ?? 0);
      const unlocked = tbl.some((b) => b.position === e.req.teamBadge && b.seasonNumber === want);
      return { ...base, unlocked };
    }
    return { ...base, unlocked: false };
  });
}

// Is `key` a real edition key? (null/classic are both "the default", handled by
// callers.) Used to sanitise stored/incoming values.
export function isKnownEdition(key) {
  return typeof key === "string" && CARD_EDITION_KEYS.includes(key);
}

// The stored edition for one driver row (null = classic). Raw read, column-safe
// (mirrors readCardPhotoPos): an unknown key falls back to null.
export async function readCardEdition(prisma, driverId) {
  try {
    const rows = await prisma.$queryRaw`SELECT "cardStyle" FROM "Driver" WHERE "id" = ${driverId}`;
    const key = rows[0]?.cardStyle;
    return isKnownEdition(key) && key !== DEFAULT_CARD_EDITION ? key : null;
  } catch {
    return null;
  }
}
