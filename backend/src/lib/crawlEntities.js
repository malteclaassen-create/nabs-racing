// ---------------------------------------------------------------------------
// What ONE page is about, written into the HTML the server delivers.
//
// lib/crawlLinks.js does this for the listing pages: /drivers gets that
// season's drivers, /races that season's rounds. The pages BEHIND those links
// got nothing — a driver's own page was handed to a crawler as a title, a
// navigation bar and a footer, five and a half kilobytes with not one fact
// about the driver in it. Google indexed them anyway and then had to write a
// description out of the only prose in the document, which is the footer's
// "A community-run sim racing championship…". Every driver on the site came out
// with the same sentence under their name, and none of them with their own.
//
// So the entity pages get the same treatment as the listings, under the same
// rule, which is the only rule that matters here:
//
//   MIRROR THE PAGE. Every fact and every link below is one the reader gets at
//   that address. Not a fact from a neighbouring page, not a link the reader
//   does not have. Showing a crawler more than a reader is cloaking, and the
//   punishment for it is removal from the index, not a better position in it.
//
// So: a driver's page shows their standings line, links their team, their
// team-mates and the full driver list — and that is exactly what goes in. It
// does NOT link the rounds they raced, so neither does this, however tempting
// eleven more internal links would be.
// ---------------------------------------------------------------------------
import { getDriverStandings } from "../services/standingsService.js";
import { getPrivateSeasonIds } from "../services/seasonService.js";
import { applyPenalties } from "../services/pointsCalculator.js";
import { getNameOverrides } from "./persons.js";

// How many finishers of a round are worth listing. The results table shows the
// whole field, so listing the whole field is the honest mirror; the cap is only
// here so a freak import cannot write a thousand links into a page.
const MAX_CLASSIFIED = 40;

// What the driver page's head-to-head panel shows before anybody presses "show
// all" (frontend/src/pages/DriverProfile.jsx, CAP). Mirroring the collapsed
// panel rather than the expanded one is the difference between a reserve's page
// carrying nine links and carrying a hundred.
const MATES_SHOWN = 9;

// The same "P9" the meta description and the page's own tables use. Written
// here rather than imported so the two files do not grow a dependency on each
// other over one string, but they must not drift: if lib/pageMeta.js changes
// how it says a position, this changes with it.
const ordinal = (n) => (n == null ? null : `P${n}`);

// A driver page's own facts and its own links.
async function driverBlock(prisma, base, driverId) {
  const driver = await prisma.driver
    .findUnique({
      where: { id: driverId },
      include: { team: { select: { id: true, name: true } }, season: { select: { id: true, number: true } } },
    })
    .catch(() => null);
  if (!driver) return null;
  // An unpublished season is not public, and a link index is publishing.
  const priv = await getPrivateSeasonIds(prisma).catch(() => new Set());
  if (driver.seasonId && priv.has(driver.seasonId)) return null;

  const facts = [];
  let mates = [];
  try {
    const standings = (await getDriverStandings(prisma, driver.seasonId))?.standings || [];
    const row = standings.find((s) => s.driverId === driver.id);
    if (row) {
      facts.push(ordinal(row.position));
      facts.push(`${row.total} pts`);
    }
    // The head-to-head panel: same team, same season, in championship order —
    // taken from the standings the page reads rather than from a query of our
    // own, so the two cannot put them in a different order.
    //
    // Capped at the number the page shows WITHOUT being asked. It collapses a
    // long list behind "show all", and the reserve bucket is a hundred drivers
    // deep: mirroring the unexpanded panel keeps this honest and stops a
    // reserve's page shipping a hundred links nobody sees on load.
    if (driver.team?.id) {
      mates = standings
        .filter((s) => s.team?.id === driver.team.id && s.driverId !== driver.id)
        .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))
        .slice(0, MATES_SHOWN)
        .map((s) => ({ id: s.driverId, name: s.name }))
        .filter((m) => m.id && m.name);
    }
  } catch {
    /* standings unavailable: the team line below still says something */
  }
  if (driver.team?.name) facts.push(driver.team.name);

  const season = driver.season?.number ? `Season ${driver.season.number}` : null;
  return {
    heading: season ? `${driver.name} · ${season}` : driver.name,
    line: facts.filter(Boolean).join(" · "),
    groups: [
      driver.team
        ? { title: "Team", links: [{ href: `${base}/constructors/${driver.team.id}`, label: driver.team.name }] }
        : null,
      mates.length
        ? {
            title: "Team-mates",
            links: mates.map((m) => ({ href: `${base}/drivers/${m.id}`, label: m.name })),
          }
        : null,
    ].filter(Boolean),
  };
}

// A team page: who drove for it that season.
async function teamBlock(prisma, base, teamId) {
  const team = await prisma.team
    .findUnique({ where: { id: teamId }, select: { id: true, name: true, seasonId: true } })
    .catch(() => null);
  if (!team) return null;
  // The TEAM's season, not whichever one the visitor is browsing. A team row
  // belongs to one season, and filtering its drivers by the active season
  // instead emptied every page for an older season's team — which is most of
  // them, and exactly the pages that need the help.
  if (team.seasonId) {
    const priv = await getPrivateSeasonIds(prisma).catch(() => new Set());
    if (priv.has(team.seasonId)) return null;
  }
  const drivers = await prisma.driver
    .findMany({
      where: { teamId: team.id, ...(team.seasonId ? { seasonId: team.seasonId } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
    .catch(() => []);
  return {
    heading: team.name,
    line: "",
    groups: drivers.length
      ? [{ title: "Drivers", links: drivers.map((d) => ({ href: `${base}/drivers/${d.id}`, label: d.name })) }]
      : [],
  };
}

// One round: the classification the results page prints, in its order, with the
// steward penalties applied — the same rules the page itself renders by, so the
// two cannot disagree about who finished where.
async function raceBlock(prisma, base, raceId) {
  const race = await prisma.race
    .findUnique({
      where: { id: raceId },
      select: { id: true, number: true, track: true, seasonId: true, season: { select: { number: true, isPublic: true } } },
    })
    .catch(() => null);
  if (!race || race.season?.isPublic === false) return null;

  const [rows, overrides] = await Promise.all([
    prisma.raceResult
      .findMany({ where: { raceId: race.id }, include: { driver: { select: { id: true, name: true } } } })
      .catch(() => []),
    getNameOverrides(prisma).catch(() => new Map()),
  ]);
  const classified = applyPenalties(rows)
    .filter((r) => r.status === "FINISHED" && r.position != null)
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_CLASSIFIED)
    .filter((r) => r.driver?.id);

  const round = race.number != null ? `Round ${race.number}` : "Round";
  return {
    heading: race.track ? `${round} · ${race.track}` : round,
    line: classified.length ? `${classified.length} classified` : "",
    groups: classified.length
      ? [
          {
            title: "Classification",
            links: classified.map((r) => ({
              href: `${base}/drivers/${r.driver.id}`,
              label: overrides.get(r.driverId)?.displayName || r.driver.name,
            })),
          },
        ]
      : [],
  };
}

// The season's leaders, which is the one table the home page puts on screen and
// links: three drivers, in order, under "Title race right now". Three, because
// that is what the card holds — a top ten here would be a table the reader
// never sees.
async function homeBlock(prisma, base, seasonId) {
  if (!seasonId) return null;
  let top = [];
  try {
    const standings = await getDriverStandings(prisma, seasonId);
    top = (standings?.standings || []).slice(0, 3);
  } catch {
    return null;
  }
  if (!top.length) return null;
  return {
    heading: "",
    line: "",
    groups: [
      {
        title: "Standings",
        links: top
          .filter((d) => d.driverId && d.name)
          .map((d) => ({ href: `${base}/drivers/${d.driverId}`, label: `${ordinal(d.position)} ${d.name}` })),
      },
    ],
  };
}

// The entity block for an address, or null when the address is not one of these
// or has nothing behind it. Never throws: a link index is not worth failing a
// page load over.
export async function buildEntityBlock(prisma, { base, section, id, raceId, seasonId, isHome }) {
  try {
    if (isHome) return await homeBlock(prisma, base, seasonId);
    if (section === "drivers" && id) return await driverBlock(prisma, base, id);
    if ((section === "constructors" || section === "teams") && id) return await teamBlock(prisma, base, id);
    if (section === "races" && raceId) return await raceBlock(prisma, base, raceId);
    return null;
  } catch {
    return null;
  }
}
