// ---------------------------------------------------------------------------
// Per-page link previews.
//
// The league lives on Discord, so most traffic arrives as a pasted link. Every
// one of those used to unfurl into the same generic card, because index.html
// carries one fixed set of og: tags and Discord's unfurler does not run the
// JavaScript that would fill in the real page.
//
// So the server fills them in instead: for the handful of routes worth sharing
// it looks up the entity and rewrites the tags in the HTML it is about to send.
// Everything else falls through to the static tags unchanged.
// ---------------------------------------------------------------------------
import { getDriverStandings } from "../services/standingsService.js";
import { resolveSeason, resolveSeasonId } from "../services/seasonService.js";
import { getPrivateSeasonIds, getSeasonTeaser } from "../services/seasonService.js";
import { applyPenalties } from "../services/pointsCalculator.js";
import { resolveSeries } from "../lib/series.js";
import { getNameOverrides } from "./persons.js";
import { readSocialLinks } from "./leagueSocials.js";
import { primarySlug } from "./seo.js";
import { raceKickoff } from "./raceKickoff.js";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const ordinal = (n) => `P${n}`;

const SITE = "NABS Racing League";
const LEAGUE_TZ = "Europe/Berlin";
// Google cuts a search snippet off at roughly this width. Anything past it is
// wasted, so the builder below drops whole sentences rather than let one get
// chopped mid-word.
const SNIPPET_MAX = 160;

// "7 August", in league time: a race stored as 17:00 UTC is a Friday evening
// here, and near midnight the date itself would otherwise come out a day off.
const dayAndMonth = (d) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: LEAGUE_TZ, day: "numeric", month: "long" }).format(
    raceKickoff(d) || new Date(d)
  );

const berlin = (opts) => (t) => new Intl.DateTimeFormat("en-GB", { timeZone: LEAGUE_TZ, ...opts }).format(t);
const weekdayName = berlin({ weekday: "long" });
const hourOf = (t) => Number(berlin({ hour: "2-digit", hour12: false })(t));

// When the league races, phrased for the snippet: "Friday night", "Sunday", or
// NULL when the calendar does not clearly say.
//
// Nothing about the race night is assumed. The league races Friday evenings
// today, but that is a decision it can revisit, and a description that has gone
// stale in the one concrete promise it makes ("Friday night races" when the
// league moved to Saturdays) is worse than one that never made it. So:
//
//  * The day has to be the actual pattern, not merely the most common one. A
//    season split between two weekdays, or one with a handful of dated rounds so
//    far, names no day at all. Two thirds is the bar.
//  * "night" has to be earned too, from the kickoff time (raceKickoff supplies
//    the league's usual 19:00 for the date-only rows in the archive). An
//    afternoon series gets "Sunday races", not "Sunday night races".
export function raceNight(races) {
  const slots = [];
  for (const r of races) {
    const t = raceKickoff(r.date);
    if (t) slots.push({ day: weekdayName(t), evening: hourOf(t) >= 18 });
  }
  if (!slots.length) return null;
  const counts = new Map();
  for (const s of slots) counts.set(s.day, (counts.get(s.day) || 0) + 1);
  const [day, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n * 3 < slots.length * 2) return null; // no day the season really settles on
  const evenings = slots.filter((s) => s.day === day && s.evening).length;
  return evenings * 2 >= n ? `${day} night` : day;
}

// /s/<series>/drivers/<id>
async function driverMeta(prisma, seriesSlug, driverId) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { team: true, season: { select: { id: true, number: true } } },
  });
  if (!driver) return null;
  // Never let a private (unpublished) season leak through a link preview.
  const priv = await getPrivateSeasonIds(prisma).catch(() => new Set());
  if (driver.seasonId && priv.has(driver.seasonId)) return null;

  let line = driver.team?.name || "";
  try {
    const standings = await getDriverStandings(prisma, driver.seasonId);
    const row = (standings?.standings || []).find((s) => s.driverId === driver.id);
    if (row) {
      const parts = [ordinal(row.position), `${row.total} pts`];
      if (driver.team?.name) parts.push(driver.team.name);
      line = parts.join(" · ");
    }
  } catch {
    /* standings unavailable -> fall back to the team name alone */
  }
  const season = driver.season?.number ? `Season ${driver.season.number}` : "NABS Racing League";
  return {
    title: `${driver.name} · ${season}`,
    description: line ? `${line}. Full record, form and head-to-head on the NABS Racing League site.` : undefined,
  };
}

// /s/<series>/constructors/<id> (also /teams/<id>)
async function teamMeta(prisma, teamId) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { season: { select: { number: true } }, drivers: { select: { name: true } } },
  });
  if (!team) return null;
  const priv = await getPrivateSeasonIds(prisma).catch(() => new Set());
  if (team.seasonId && priv.has(team.seasonId)) return null;
  const lineUp = team.drivers.map((d) => d.name).join(" and ");
  const season = team.season?.number ? `Season ${team.season.number}` : "NABS Racing League";
  return {
    title: `${team.name} · ${season}`,
    description: lineUp ? `Line-up: ${lineUp}. Standings, round-by-round points and team history.` : undefined,
  };
}

// The season landing page: /s/<series>, and "/" for the primary series (the
// root renders it rather than redirecting).
//
// This is the entry every search result for the league's name shows, so it is
// worth more care than a link preview. Two things it does differently from the
// other routes here:
//
//  * The TITLE names the discipline and the game. "NABS Racing League" alone
//    only ever wins the searches that already know the name, while "Formula 1
//    Racing on Assetto Corsa" is what someone looking for a league to join
//    types. The title is also the part a search engine actually weighs, so this
//    is where the words belong; the description below only decides whether the
//    result gets clicked.
//  * The DESCRIPTION is deliberately BROAD rather than a status report. It names
//    the discipline, the game, the race night and what the site holds, and
//    nothing about the season in progress, so it reads sensibly next to any of
//    the many different searches this page can turn up under and never has to be
//    rewritten as a season moves along.
async function seasonMeta(prisma, seriesSlug) {
  const series = await resolveSeries(prisma, seriesSlug, { includePrivate: false }).catch(() => null);
  if (!series) return null;
  const primary = await primarySlug(prisma).catch(() => null);
  const isPrimary = series.slug === primary;
  const brand = (t) => (isPrimary ? `${SITE} · ${t}` : `${t} · ${series.name}`);

  const seasonId = await resolveSeasonId(prisma, undefined, { series: seriesSlug }).catch(() => null);
  if (!seasonId) return { title: isPrimary ? SITE : `${series.name} · ${SITE}` };
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { game: true },
  });

  const rounds = await championshipRounds(prisma, seasonId);
  // The race night comes from the races still TO COME wherever there are any:
  // that is where a change of race day appears first. Only once nothing is left
  // to run (and no next season is on the calendar yet) does it fall back to the
  // season just driven.
  let ahead = rounds.filter((r) => !r.isCompleted);
  if (!ahead.length) {
    const teaser = await getSeasonTeaser(prisma, series).catch(() => null);
    if (teaser?.id) ahead = await championshipRounds(prisma, teaser.id);
  }

  const discipline = disciplineOf(season?.game, series.name);
  return {
    title: brand(`${discipline || "Sim"} Racing on Assetto Corsa`),
    description:
      seasonDescription({ discipline, night: raceNight(ahead.length ? ahead : rounds) }) || undefined,
  };
}

// A season's scored rounds, in order. Training sessions and one-off specials
// carry no round number and are left out: they are not the league's schedule.
function championshipRounds(prisma, seasonId) {
  return prisma.race
    .findMany({
      where: { seasonId, isSpecialEvent: false, number: { not: null } },
      select: { date: true, isCompleted: true },
      orderBy: { number: "asc" },
    })
    .catch(() => []);
}

// What is being raced, in the words people search for. The league runs a
// different era's F1 mod every season (F1 2007, F1 2010, F1 2013 …), so the
// season's own `game` is the reliable source; the series name ("F1 Friday") is
// the fallback for a season with no game set. Null for anything that is not
// recognisably Formula 1, because a GT series must not be advertised as one.
function disciplineOf(game, seriesName) {
  return /\bf1\b|formula/i.test(`${game || ""} ${seriesName || ""}`) ? "Formula 1" : null;
}

// The snippet itself, kept free of the database so it can be tested.
//
// Two sentences. The first says what this is, the second what the site holds,
// and between them they are meant to read sensibly whether the visitor searched
// for an F1 league, for Assetto Corsa league racing, or for online sim racing.
// Nothing here dates: no round, no leader, no champion. That is a deliberate
// trade, made because the page turns up under a wide spread of searches and the
// snippet has to suit all of them, not because a current fact would not be nice
// to have.
//
// `night` is what the calendar supports and may well be null (see raceNight);
// every wording below therefore has to work without it.
export function seasonDescription({ discipline = null, night = null }) {
  const what = discipline
    ? `${discipline} sim racing league on Assetto Corsa.`
    : "Online sim racing league on Assetto Corsa.";

  // The second sentence, in as much detail as the width allows. Longest first,
  // and the last one holds up even if everything before it had to go.
  const champ = `Online ${discipline === "Formula 1" ? "F1 " : ""}championship with `;
  const races = night ? `${night} races, ` : "";
  const rest = [
    `${champ}${races}driver and team standings, results, live timing and sign-ups.`,
    `${champ}${races}standings, results, live timing and sign-ups.`,
    `${champ}${races}standings, results and sign-ups.`,
    `${races}standings, results, live timing and open sign-ups.`,
    `${races}results, standings and open sign-ups.`,
    "New drivers welcome.",
  ]
    .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
    .find((c) => `${what} ${c}`.length <= SNIPPET_MAX);
  return rest ? `${what} ${rest}` : what;
}

// ---------------------------------------------------------------------------
// The listing pages: /s/<series>/drivers, /constructors, /races, /records,
// /live, /attendance — each one shown for ONE season at a time.
//
// Until now every one of them shipped the site's generic title, which cost twice
// over. A search engine had no idea what separated them, and the seven seasons
// of tables behind ?season=<n> were not addresses at all. Now each section says
// what it is and which season it is showing, so "season 5 standings" and "who
// won at Monza" have something to match, and the archive stops being invisible.
//
// A section nobody would search for (the member-only areas are excluded in
// robots.txt anyway) simply gets no entry here and falls back to the site card.
// ---------------------------------------------------------------------------
const SECTIONS = {
  // The wording of each description is held to what the page actually shows. A
  // snippet promising a table that is not there is the kind of thing that
  // teaches a reader to distrust the whole result.
  drivers: {
    title: (s) => `${s} driver standings`,
    description: (s) =>
      `Driver standings for ${s} of the NABS Racing League: total points, every driver's finish in every round and the dropped scores.`,
  },
  constructors: {
    title: (s) => `${s} constructor standings`,
    description: (s) =>
      `Constructor standings for ${s}: each team's total, its points round by round and the drivers who scored them.`,
  },
  races: {
    title: (s) => `${s} results and race calendar`,
    description: (s) =>
      `Every round of ${s}: full race classifications, qualifying, fastest laps, and the calendar of circuits and dates.`,
  },
  records: {
    title: () => "League records and Hall of Fame",
    description: () =>
      "All-time NABS Racing League records: most wins, poles, fastest laps and podiums, champions by season and the Hall of Fame.",
  },
  live: {
    title: () => "Live timing",
    // Not "for race nights": the league's servers sit in an open practice
    // session all week and the board shows that too, which is most of what a
    // visitor to this page actually finds.
    description: () =>
      "Live timing from the league's race servers: running order, gaps, best laps and tyre strategy, on race nights and in practice in between.",
  },
  attendance: {
    title: (s) => `${s} sign-ups and attendance`,
    description: (s) =>
      `Who has signed up for the coming rounds of ${s}, the grid as it stands, and each driver's attendance over the season.`,
  },
};
// Second names the route table hands to the same page. The canonical tag folds
// these onto the first name (see lib/seo.js); the meta has to agree, or the two
// spellings would look like different pages after all.
const SECTION_ALIASES = { results: "races", calendar: "races", teams: "constructors" };

async function sectionMeta(prisma, seriesSlug, rawSection, query) {
  const section = SECTION_ALIASES[rawSection] || rawSection;
  const spec = SECTIONS[section];
  if (!spec) return null;
  const series = await resolveSeries(prisma, seriesSlug, { includePrivate: false }).catch(() => null);
  if (!series) return null;

  // Which season this page is showing: the one asked for, else the active one.
  // A private season resolves to null, exactly as the page's own data does, so a
  // crafted ?season=<n> cannot reveal an unpublished season through the title.
  const season = await resolveSeason(prisma, query?.season, { series: seriesSlug }).catch(() => null);
  if (!season) return null;
  const label = season.name || `Season ${season.number}`;

  // A single round, when the page was asked for one. Only the races page can be.
  if (section === "races" && query?.race) {
    const race = await raceMeta(prisma, season, query.race);
    if (race) return withSuffix(race, series, prisma);
  }

  return withSuffix({ title: spec.title(label), description: spec.description(label) }, series, prisma);
}

// The site's name goes at the END of a section title: the section is what the
// searcher was looking for, and a title that is cut off should lose the brand
// rather than the subject. A secondary series names itself too, or its tables
// would be indistinguishable from the main league's.
async function withSuffix(meta, series, prisma) {
  const primary = await primarySlug(prisma).catch(() => null);
  const tail = series.slug === primary ? SITE : `${series.name} · ${SITE}`;
  return { ...meta, title: `${meta.title} · ${tail}` };
}

// ---------------------------------------------------------------------------
// One round: /s/<series>/races?race=<id>.
//
// About a hundred of these exist and they are the most specific thing the site
// holds: a result at a named circuit on a named date. They were all one address
// before this, which meant Google had one page where the league has a hundred.
// ---------------------------------------------------------------------------
async function raceMeta(prisma, season, raceId) {
  const found = await prisma.race
    .findFirst({
      where: { id: String(raceId), seasonId: season.id },
      select: { id: true, number: true, track: true, date: true, isCompleted: true },
    })
    .catch(() => null);
  if (!found) return null; // not this season's round: leave the page's own meta
  const race = { ...found, track: prettyTrack(found.track) };

  const label = season.name || `Season ${season.number}`;
  // A championship round is "Round 5"; a one-off has no round number, so it is
  // named for what it is instead. Both need a form that reads in a title and one
  // that reads mid-sentence.
  const heading = race.number != null ? `Round ${race.number}` : "Special event";
  const inText = race.number != null ? `Round ${race.number} of ${label}` : `a special event in ${label}`;

  if (!race.isCompleted) {
    const when = race.date ? ` on ${dayAndMonth(race.date)}` : "";
    const opens = inText.charAt(0).toUpperCase() + inText.slice(1);
    return {
      title: `${race.track} · ${heading}, ${label}`,
      description: `${opens} at ${race.track}${when}. Entry list, sign-up, session format and live timing when the lights go out.`,
    };
  }

  const podium = await racePodium(prisma, race.id);
  const title = `${race.track} results · ${heading}, ${label}`;
  if (!podium.length) {
    return {
      title,
      description: `Full classification of ${inText} at ${race.track}, with qualifying, fastest laps and the points it scored.`,
    };
  }
  const [win, second, third] = podium;
  const beat = [second, third].filter(Boolean).join(" and ");
  const opening = beat
    ? `${win} won ${inText} at ${race.track}, ahead of ${beat}.`
    : `${win} won ${inText} at ${race.track}.`;
  const detail = "Full classification, qualifying, fastest lap and points.";
  return {
    title,
    description: `${opening} ${detail}`.length <= SNIPPET_MAX ? `${opening} ${detail}` : opening,
  };
}

// Circuits a search result should keep in capitals even though the name around
// them gets tidied. COTA is the one the league actually races; the rest are cheap
// insurance against the next admin typing one in.
const ACRONYM_TRACKS = new Set(["COTA", "GP", "USA", "UK"]);

// A track name fit for a title.
//
// The names are free text an admin types, and thirteen years of league archive
// are inconsistent about it: seasons 1 to 6 came in as "KYALAMI" and "ROAD
// AMERICA", one season 7 round as "interlagos", the rest as "Monza". On the site
// this never showed, because its own styling puts them in capitals anyway. In a
// search result it does show, and a title in block capitals is one of the things
// Google rewrites for you rather than displaying.
//
// So: all capitals gets tidied word by word, all lowercase gets its first letter,
// and anything already mixed is left exactly as the admin wrote it.
export function prettyTrack(name) {
  const raw = String(name || "").trim();
  if (!raw) return raw;
  if (!/[a-z]/.test(raw)) {
    return raw.replace(/[^\s-]+/g, (w) => (ACRONYM_TRACKS.has(w) ? w : w[0] + w.slice(1).toLowerCase()));
  }
  if (!/[A-Z]/.test(raw)) return raw[0].toUpperCase() + raw.slice(1);
  return raw;
}

// The first three finishers, by the same rules the results page shows: steward
// time penalties applied and the field closed up so a DNF holds no place.
// Anything less than that would print a podium the site itself contradicts.
async function racePodium(prisma, raceId) {
  const [rows, overrides] = await Promise.all([
    prisma.raceResult
      .findMany({ where: { raceId }, include: { driver: { select: { id: true, name: true } } } })
      .catch(() => []),
    getNameOverrides(prisma).catch(() => new Map()),
  ]);
  if (!rows.length) return [];
  const finished = applyPenalties(rows)
    .filter((r) => r.status === "FINISHED" && r.position != null)
    .sort((a, b) => a.position - b.position)
    .slice(0, 3);
  return finished.map((r) => overrides.get(r.driverId)?.displayName || r.driver?.name).filter(Boolean);
}

// The season landing page is the most requested address on the site, and its
// meta costs a few queries (the series, the season, the calendar, and in the
// off-season the announced season's calendar too). A minute of cache turns that
// into about one computation per minute, and staleness is not a concern: the
// answer only changes when the race calendar does.
const LANDING_TTL_MS = 60 * 1000;
const landingCache = new Map(); // pathname -> { at, meta }

async function cachedSeasonMeta(prisma, key, seriesSlug) {
  const hit = landingCache.get(key);
  if (hit && Date.now() - hit.at < LANDING_TTL_MS) return hit.meta;
  const meta = await seasonMeta(prisma, seriesSlug);
  landingCache.set(key, { at: Date.now(), meta });
  return meta;
}

// Returns { title, description } for a shareable route, or null.
//
// `query` matters as much as the path here: ?season=<n> is what makes an
// archived season's tables a page of their own, and ?race=<id> what makes a
// single round one. Both are addresses in the sitemap, so both need to answer
// with something of their own rather than the site's generic card.
export async function buildPageMeta(prisma, pathname, query = {}) {
  try {
    const parts = pathname.split("/").filter(Boolean);
    // The root: the primary series' season landing page (no slug to resolve,
    // resolveSeries picks the primary one for undefined).
    //
    // /join is the same page under a linkable address (see the fold in
    // lib/seo.js), so it answers with the same title and description. Two
    // addresses that render one page must not describe themselves differently,
    // or the page argues with its own canonical tag.
    if (!parts.length || (parts.length === 1 && parts[0] === "join")) {
      return await cachedSeasonMeta(prisma, "/", undefined);
    }
    if (parts[0] !== "s" || !parts[1]) return null;
    const [, seriesSlug, section, id] = parts;
    if (!section) return await cachedSeasonMeta(prisma, `/s/${seriesSlug}`, seriesSlug);
    if (id && section === "drivers") return await driverMeta(prisma, seriesSlug, id);
    if (id && (section === "constructors" || section === "teams")) return await teamMeta(prisma, id);
    if (!id) return await sectionMeta(prisma, seriesSlug, section, query);
    return null;
  } catch {
    // A preview is never worth failing a page load over.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Who the league IS, as structured data.
//
// Google currently answers "what is NABS Racing" out of SimGrid, because the
// league's own site never states it in a form a machine can read: the name, the
// logo, the sport, and the accounts that are also the league. That is what this
// is for. It goes on the home page only, which is the address everything else
// points at.
//
// Deliberately modest: only facts the database already holds, no invented
// founding dates or member counts. A description that cannot be verified on the
// page is the kind of thing that gets structured data ignored altogether.
// ---------------------------------------------------------------------------
export async function buildOrganizationJsonLd(prisma, origin) {
  try {
    const [series, social] = await Promise.all([
      resolveSeries(prisma, undefined, { includePrivate: false }).catch(() => null),
      readSocialLinks(prisma).catch(() => ({})),
    ]);
    const sameAs = Object.values(social || {}).filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
    const meta = await buildPageMeta(prisma, "/").catch(() => null);
    return {
      "@context": "https://schema.org",
      "@type": "SportsOrganization",
      name: SITE,
      url: `${origin}/`,
      logo: `${origin}/icon-512.png`,
      image: `${origin}/og-image.jpg`,
      sport: "Sim racing",
      ...(meta?.description ? { description: meta.description } : {}),
      ...(series?.name ? { subOrganization: { "@type": "SportsOrganization", name: series.name } } : {}),
      ...(sameAs.length ? { sameAs } : {}),
    };
  } catch {
    return null; // never worth failing a page load over
  }
}

// Put it in the page. One script tag, replaced rather than appended so a reload
// of the same HTML never stacks two of them.
export function applyJsonLd(html, data) {
  if (!data) return html;
  // "<" cannot appear raw inside a script element, whatever it is escaping from.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const tag = `<script type="application/ld+json">${json}</script>`;
  if (/<script type="application\/ld\+json">[\s\S]*?<\/script>/i.test(html)) {
    return html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/i, tag);
  }
  return html.replace(/<\/head>/i, `  ${tag}\n  </head>`);
}

// Rewrites the title and the og:/twitter: description+title tags in the shipped
// index.html. Replaces rather than appends, because an unfurler takes the first
// matching tag it sees.
export function applyPageMeta(html, meta) {
  if (!meta) return html;
  let out = html;
  if (meta.title) {
    const t = esc(meta.title);
    out = out
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
      .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`);
  }
  if (meta.description) {
    const d = esc(meta.description);
    out = out
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
      .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`);
  }
  return out;
}
