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
import { getPrivateSeasonIds, getSeasonScoring } from "../services/seasonService.js";
import { applyPenalties, getDriverResultPoints } from "../services/pointsCalculator.js";
import { getNameOverrides } from "./persons.js";
import { seasonStandings, seasonRounds, constructorStandings } from "./crawlTables.js";

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

// The driver page's race-by-race table, as far as this block carries it:
// round, circuit, where they finished, what it paid. The page has one more
// column (the starting grid, which lives in the qualifying blob) and this does
// not — fewer columns than the page shows is honest, invented ones are not.
//
// Rounds the driver did not enter are left out rather than printed as empty
// rows: the page prints the whole calendar because it has the width for a grid
// of dashes, and this is a paragraph of text in a document.
async function roundTable(prisma, seasonId, row) {
  const rounds = await seasonRounds(prisma, seasonId).catch(() => null);
  if (!rounds) return null;
  const entries = Object.entries(row.perRace || {})
    .map(([num, r]) => ({ num: Number(num), ...r }))
    .filter((r) => Number.isFinite(r.num) && rounds.has(r.num))
    .sort((a, b) => a.num - b.num);
  if (!entries.length) return null;
  return {
    title: "Race by race",
    columns: ["Rnd", "Circuit", "Race", "Pts"],
    rows: entries.map((r) => [
      String(r.num),
      rounds.get(r.num) || "",
      // A finish is a position; anything else is why there is none. Same words
      // the results table prints (DNF, DSQ, DNS).
      r.status === "FINISHED" && r.position != null ? ordinal(r.position) : r.status || "",
      String(r.points ?? 0),
    ]),
  };
}

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
  let byRound = null;
  try {
    // The season's table, computed once for the whole site and held for ten
    // minutes (lib/crawlTables.js) rather than scored again for every driver
    // page a crawler walks through.
    const standings = (await seasonStandings(prisma, driver.seasonId))?.standings || [];
    const row = standings.find((s) => s.driverId === driver.id);
    if (row) {
      facts.push(ordinal(row.position));
      facts.push(`${row.total} pts`);
      byRound = await roundTable(prisma, driver.seasonId, row);
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
      byRound,
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
    .findUnique({ where: { id: teamId }, select: { id: true, name: true, tier: true, seasonId: true } })
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
  if (!drivers.length) return { heading: team.name, line: "", groups: [] };

  // What the team page prints beside each driver: where they stand and what
  // they have scored. In championship order, not alphabetical, because that is
  // the order the line-up appears in on the page.
  const standings = (await seasonStandings(prisma, team.seasonId).catch(() => null))?.standings || [];
  const rowById = new Map(standings.map((r) => [r.driverId, r]));
  const known = drivers.filter((d) => rowById.has(d.id));
  if (known.length !== drivers.length || !known.length) {
    return {
      heading: team.name,
      line: "",
      groups: [
        { title: "Drivers", links: drivers.map((d) => ({ href: `${base}/drivers/${d.id}`, label: d.name })) },
      ],
    };
  }
  known.sort((a, b) => (rowById.get(a.id).position ?? 1e9) - (rowById.get(b.id).position ?? 1e9));
  // The team's own championship line, straight off the constructor table its
  // page reads. Deliberately NOT the sum of its drivers' points: the drop rule
  // works per driver and per round, so that sum is a number nobody's page
  // shows and nobody could reproduce.
  const cs = (await constructorStandings(prisma, team.seasonId, team.tier).catch(() => null))?.standings || [];
  const teamRow = cs.find((r) => r.teamId === team.id);
  return {
    heading: team.name,
    line: teamRow ? `${ordinal(teamRow.position)} · ${teamRow.total} pts` : "",
    groups: [
      {
        title: "Drivers",
        columns: ["Driver", "Pos", "Pts"],
        rows: known.map((d) => {
          const r = rowById.get(d.id);
          return [
            { href: `${base}/drivers/${d.id}`, label: r.name || d.name },
            ordinal(r.position) || "",
            String(r.total ?? 0),
          ];
        }),
      },
    ],
  };
}

// One round: the classification the results page prints, in its order, with the
// steward penalties applied — the same rules the page itself renders by, so the
// two cannot disagree about who finished where.
async function raceBlock(prisma, base, raceId) {
  const race = await prisma.race
    .findUnique({
      where: { id: raceId },
      select: {
        id: true,
        number: true,
        track: true,
        seasonId: true,
        isSpecialEvent: true,
        season: { select: { number: true, isPublic: true } },
      },
    })
    .catch(() => null);
  if (!race || race.season?.isPublic === false) return null;

  const classified = await classification(prisma, race, MAX_CLASSIFIED);
  const round = race.number != null ? `Round ${race.number}` : "Round";
  return {
    heading: race.track ? `${round} · ${race.track}` : round,
    line: classified.length ? `${classified.length} classified` : "",
    groups: classified.length ? [classificationTable(base, classified, !race.isSpecialEvent)] : [],
  };
}

// One round's finishers, in finishing order, scored by the season's own points
// table — the same numbers in the same order as the results table on the page.
// Penalties are applied first (services/pointsCalculator), because a position
// after a five-second penalty is the position that counts.
async function classification(prisma, race, limit) {
  const [rows, overrides, scoring] = await Promise.all([
    prisma.raceResult
      .findMany({
        where: { raceId: race.id },
        include: { driver: { select: { id: true, name: true, team: { select: { id: true, name: true } } } } },
      })
      .catch(() => []),
    getNameOverrides(prisma).catch(() => new Map()),
    getSeasonScoring(prisma, race.seasonId).catch(() => ({})),
  ]);
  const table = scoring?.pointsTable || undefined;
  return applyPenalties(rows)
    .filter((r) => r.status === "FINISHED" && r.position != null && r.driver?.id)
    .sort((a, b) => a.position - b.position)
    .slice(0, limit)
    .map((r) => ({
      position: r.position,
      driverId: r.driver.id,
      name: overrides.get(r.driverId)?.displayName || r.driver.name,
      team: r.driver.team || null,
      points: getDriverResultPoints(r, table),
    }));
}

// Pos | Driver | Team | Pts, minus the points column for a session that scores
// nothing (a special event) — the page drops that column there too.
function classificationTable(base, rows, scores) {
  return {
    title: "Classification",
    columns: scores ? ["Pos", "Driver", "Team", "Pts"] : ["Pos", "Driver", "Team"],
    rows: rows.map((r) => {
      const cells = [
        ordinal(r.position),
        { href: `${base}/drivers/${r.driverId}`, label: r.name },
        r.team?.id ? { href: `${base}/constructors/${r.team.id}`, label: r.team.name } : r.team?.name || "",
      ];
      if (scores) cells.push(String(r.points ?? 0));
      return cells;
    }),
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
    const standings = await seasonStandings(prisma, seasonId);
    top = (standings?.standings || []).slice(0, 3);
  } catch {
    return null;
  }
  if (!top.length) return null;
  // The hero card above the standings: the round just run, its podium, and what
  // it paid. Three, because the card holds three — the round's own page has the
  // rest, and this block links straight to it.
  const latest = await latestRound(prisma, base, seasonId);
  return {
    heading: "",
    line: "",
    groups: [
      latest,
      {
        title: "Standings",
        links: top
          .filter((d) => d.driverId && d.name)
          .map((d) => ({ href: `${base}/drivers/${d.driverId}`, label: `${ordinal(d.position)} ${d.name}` })),
      },
    ].filter(Boolean),
  };
}

// The latest completed championship round of a season, as the home page's hero
// shows it. Special events and training sessions are not rounds and never take
// the card.
async function latestRound(prisma, base, seasonId) {
  const race = await prisma.race
    .findFirst({
      where: { seasonId, isCompleted: true, isSpecialEvent: false },
      orderBy: { number: "desc" },
      select: { id: true, number: true, track: true, seasonId: true, isSpecialEvent: true },
    })
    .catch(() => null);
  if (!race) return null;
  const podium = await classification(prisma, race, 3);
  if (!podium.length) return null;
  const round = race.number != null ? `Round ${race.number}` : "Latest race";
  const block = classificationTable(base, podium, true);
  return { ...block, title: race.track ? `${round} · ${race.track}` : round };
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
