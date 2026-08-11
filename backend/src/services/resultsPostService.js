// ---------------------------------------------------------------------------
// Builds the Discord "#results" post for a completed round, in two lengths.
//
//   full   the classification with real @mentions (drivers who logged in via
//          Discord get pinged, everyone else appears in bold), non-finishers
//          grouped at the bottom, and a stats block from the stored results
//          plus AC telemetry.
//   short  the round, the podium, and a link. For the weeks the poster carries
//          the message: the picture already lists the top ten, so printing it
//          underneath is the same information twice.
//
// Both are drafts. The admin reads them in Content and edits before posting, so
// custom team emojis, role pings and flags can be added by hand there.
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

// Where the short version's link points: the round's own page on this site.
// `origin` comes from the request rather than a setting, the same way the
// canonical tags do it, so it is right on the live domain and right in a local
// preview, without anybody maintaining a second copy of the address.
// The season number rides along for every season but the active one, in that
// order, because that is the address lib/seo.js calls canonical and the one
// lib/siteIndex.js puts in the sitemap. Without it the round belongs to
// whichever season the reader happens to be on: the races page looks the id up
// in the season it has loaded, does not find it, and quietly shows a different
// round instead. That also happens to every link already posted, the moment the
// next season goes active — which is exactly why the number has to be in there.
async function raceLink(prisma, race, origin) {
  if (!origin || !race?.seasonId) return null;
  const season = await prisma.season
    .findUnique({ where: { id: race.seasonId }, include: { series: true } })
    .catch(() => null);
  const slug = season?.series?.slug;
  const seasonQ = season && !season.isActive && season.number != null ? `season=${season.number}&` : "";
  return `${origin}${slug ? `/s/${slug}` : ""}/races?${seasonQ}race=${race.id}`;
}

// Returns { full, short, mentions }, or null when the race doesn't exist or has
// no results yet. `mentions` maps each Discord id used in the text to the
// driver's name: the message itself can only carry "<@1234...>", and the
// admin's preview has to show the "@13bot" that Discord will.
export async function buildResultsPost(prisma, raceId, { origin = null } = {}) {
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

  const MEDALS = ["🥇", "🥈", "🥉"];
  // A championship round is "ROUND 7". A training session or a special event has
  // no round number, and "ROUND ? - SPA" is what it used to say — so they are
  // named for what they are instead of for the number they do not have.
  const kind = race.type || (race.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
  const what =
    kind === "CHAMPIONSHIP" && race.number != null
      ? `ROUND ${race.number}`
      : kind === "SPECIAL"
        ? "SPECIAL EVENT"
        : kind === "TRAINING"
          ? "TRAINING"
          : "ROUND ?";
  const heading = `**${what} - ${String(race.track || "").toUpperCase()}**`;

  const lines = [];
  lines.push(heading);
  lines.push("");
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

  // The short version. The podium on one line and a link to the round, because
  // everything the long version spells out is already ON the picture that goes
  // with it. The three medals sit on one line rather than three: as mention
  // chips they are wide, and stacked they read as the start of a list that then
  // stops after three.
  const link = await raceLink(prisma, race, origin);
  const podium = finishers
    .filter((r) => r.position <= 3)
    .map((r) => `${MEDALS[r.position - 1]} ${who(r)}`)
    .join("  ");
  const shortLines = [heading, ""];
  if (podium) shortLines.push(podium, "");
  // A masked link, which is what turns the address into the one blue sentence
  // in the message. With no origin there is nothing honest to link to, so the
  // line is left out rather than pointed somewhere wrong.
  if (link) shortLines.push(`[Full classification, lap times and stats on the website](${link})`);

  // Only the ids that actually appear, so the preview never has to guess.
  const mentions = {};
  for (const r of applied) {
    const id = discordIds.get(r.driverId);
    if (id) mentions[id] = r.driver.name;
  }

  return {
    full: lines.join("\n"),
    short: shortLines.join("\n").trimEnd(),
    mentions,
  };
}
