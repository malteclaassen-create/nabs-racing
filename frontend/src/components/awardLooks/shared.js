// ---------------------------------------------------------------------------
// What every Season awards look needs to know about one award's winner, worked
// out once so the looks only decide how it is drawn (Hall of Fame preview).
// ---------------------------------------------------------------------------
import { countryFor } from "../../data/driverCountries.js";
import { flagFor } from "../../data/circuits.js";

function fmtRaceDay(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// award: one entry of GET /standings/awards (kind: driver | team | race | text).
// Returns:
//   kind      the award kind
//   name      the winner as it should read (driver, team, track or typed name)
//   sub       one short line under the name, or null (team name / "Tier 2" /
//             "Round 7 · 8 May 2026")
//   to        link target, or null when there is nothing to open
//   flag      ISO country code for a flag, or null
//   driver    { driverId, name, photoUrl, country, tier, team } for a driver award
//   team      { id, name, color, logoUrl, tier } for a team award, or the
//             driver's team for a driver award
//   race      { id, round, track, country, date, isCompleted } for a race award
//   color     an accent colour for the winner (team colour), or null
export function winnerOf(award, seasonNumber) {
  const q = `?season=${seasonNumber}`;
  if (award.kind === "driver") {
    const d = award.driver;
    return {
      kind: "driver",
      name: d.name,
      sub: d.team?.name || null,
      to: `/drivers/${d.driverId}${q}`,
      flag: countryFor(d.driverId, d.country) || null,
      driver: d,
      team: d.team || null,
      race: null,
      color: d.team?.color || null,
    };
  }
  if (award.kind === "team") {
    const t = award.team;
    return {
      kind: "team",
      name: t.name,
      sub: t.tier ? `Tier ${t.tier}` : null,
      to: `/teams/${t.id}${q}`,
      flag: null,
      driver: null,
      team: t,
      race: null,
      color: t.color || null,
    };
  }
  if (award.kind === "race") {
    const r = award.race;
    return {
      kind: "race",
      name: r.track,
      sub: [r.round != null ? `Round ${r.round}` : null, fmtRaceDay(r.date)].filter(Boolean).join(" · ") || null,
      to: r.isCompleted ? `/races${q}&race=${r.id}` : null,
      flag: flagFor(r.track, r.country) || null,
      driver: null,
      team: null,
      race: r,
      color: null,
    };
  }
  return {
    kind: "text",
    name: award.winnerText,
    sub: null,
    to: null,
    flag: null,
    driver: null,
    team: null,
    race: null,
    color: null,
  };
}
