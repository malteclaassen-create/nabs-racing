// ---------------------------------------------------------------------------
// Builds the Discord "#results" post for a completed round: the classification
// with real @mentions (drivers who logged in via Discord get pinged, everyone
// else appears in bold), non-finishers grouped at the bottom, and a stats
// block from the stored results + AC telemetry. The admin previews and edits
// the text in the results editor before posting, so the generated message is
// a starting point, not gospel — custom team emojis, role pings and flags can
// be added by hand there.
// ---------------------------------------------------------------------------
import { applyPenalties } from "./pointsCalculator.js";
import { telemetryForRace } from "../lib/telemetryRead.js";
import { discordIdsForDrivers } from "../lib/persons.js";

// 1:38.853 — same shape the site uses for lap times.
function fmtLap(ms) {
  if (!ms || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

// Returns the message text, or null when the race doesn't exist / has no
// results yet.
export async function buildResultsPost(prisma, raceId) {
  const race = await prisma.race.findUnique({ where: { id: raceId } });
  if (!race) return null;
  const [results, telemetry] = await Promise.all([
    prisma.raceResult.findMany({ where: { raceId }, include: { driver: true } }),
    telemetryForRace(prisma, raceId),
  ]);
  if (!results.length) return null;
  // Discord ids across the person's linked rows: the id lives on one row per
  // person and moves on login, so a fresh season's rows may not carry it yet.
  const discordIds = await discordIdsForDrivers(prisma, results.map((r) => r.driverId));

  // Final classification: penalties applied, finishers by position, the rest
  // grouped by status at the bottom — same order as the site's results view.
  const applied = applyPenalties(results);
  const finishers = applied
    .filter((r) => r.status === "FINISHED" && r.position != null)
    .sort((a, b) => a.position - b.position);
  const rest = applied.filter((r) => !(r.status === "FINISHED" && r.position != null));

  // <@id> pings the member's Discord account; drivers without a known id
  // (never logged in, no admin-entered id) appear as plain bold text instead.
  const who = (r) => {
    const id = discordIds.get(r.driverId);
    return id ? `<@${id}>` : `**${r.driver.name}**`;
  };
  const tel = (r) => telemetry.get(r.driverId) || {};

  const lines = [];
  lines.push(`**ROUND ${race.number ?? "?"} - ${String(race.track || "").toUpperCase()}**`);
  lines.push("");
  const MEDALS = ["🥇", "🥈", "🥉"];
  for (const r of finishers) {
    lines.push(`${r.position <= 3 ? MEDALS[r.position - 1] : `P${r.position}.`} ${who(r)}`);
  }
  for (const status of ["DNF", "DSQ", "DNS"]) {
    const group = rest.filter((r) => r.status === status);
    if (group.length) lines.push(`${status}. ${group.map(who).join(" ")}`);
  }

  // Stats block — each line only appears when its data was actually imported.
  const stats = [];
  const pole = applied.find((r) => r.grid === 1);
  if (pole) stats.push(`🎯 Pole - ${who(pole)}`);
  const lapRows = applied.filter((r) => r.bestLapMs > 0);
  if (lapRows.length) {
    const fl = lapRows.reduce((a, b) => (b.bestLapMs < a.bestLapMs ? b : a));
    stats.push(`⏱️ Fastest Lap - ${who(fl)} - ${fmtLap(fl.bestLapMs)}`);
  }
  const consRows = applied.filter((r) => tel(r).consistencyPct != null);
  if (consRows.length) {
    const c = consRows.reduce((a, b) => (tel(b).consistencyPct > tel(a).consistencyPct ? b : a));
    stats.push(`🔥 Most Consistent Driver - ${who(c)} - ${tel(c).consistencyPct.toFixed(2)}%`);
  }
  const crashRows = applied.filter((r) => tel(r).contacts != null);
  if (crashRows.length) {
    const count = (x) => `${tel(x).contacts} ${tel(x).contacts === 1 ? "Collision" : "Collisions"}`;
    const least = crashRows.reduce((a, b) => (tel(b).contacts < tel(a).contacts ? b : a));
    const most = crashRows.reduce((a, b) => (tel(b).contacts > tel(a).contacts ? b : a));
    stats.push(`🤝 Least Crashes - ${who(least)} - ${count(least)}`);
    if (most.driverId !== least.driverId) stats.push(`💥 Most Crashes - ${who(most)} - ${count(most)}`);
  }
  // Driver of the Day — raw columns (may not be in the generated client).
  try {
    const dr = await prisma.$queryRawUnsafe(
      `SELECT "driverOfTheDayId", "driverOfTheDayBy" FROM "Race" WHERE "id" = ?`,
      raceId
    );
    const dotdId = dr[0]?.driverOfTheDayId || null;
    if (dotdId) {
      const row = applied.find((r) => r.driverId === dotdId);
      const by = dr[0]?.driverOfTheDayBy || null;
      if (row) stats.push(`⭐ ${by ? `${by}'s ` : ""}DOTD - ${who(row)}`);
    }
  } catch {
    /* column missing pre-migration */
  }

  if (stats.length) {
    lines.push("", "**STATS**", "");
    lines.push(...stats);
  }
  return lines.join("\n");
}
