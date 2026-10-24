// ---------------------------------------------------------------------------
// The race report the site writes by itself, the moment a round's result is
// saved. It knows what the classification knows (who won from where, the
// podium, the biggest climb, the fastest lap, the retirements, what it did to
// the championship) and nothing else, so by default it lands as a DRAFT on the
// news desk: the facts are done, a writer adds the stories and the jokes and
// presses publish. The league can also let it publish straight away, or switch
// it off (Setting news_auto_reports: off | draft | publish).
//
// composeRaceReport is pure (facts in, article out) so the wording can be
// tested; draftRaceReport does the reading and the writing. Each round gets at
// most one, ever: a marker Setting remembers the round once its report was
// written, so a re-import or an edit later never brings back a draft the desk
// already deleted.
// ---------------------------------------------------------------------------
import { raceDetailPayload } from "../services/raceDetailService.js";
import { getDriverStandings } from "../services/standingsService.js";
import { readPoleHolders } from "./raceHonours.js";
import { readRaceHeroes } from "./raceHero.js";
import { readRaceTypes } from "./raceTypes.js";
import { prettyTrack } from "./pageMeta.js";
import { createArticle, findAutoReport, readNewsWriters } from "./news.js";
import { racePageLink, seasonIsPublic, dbCreateNotification, readNotifySettings } from "./notifications.js";
import { getAdminDiscordIds } from "./adminUsers.js";

export const AUTO_REPORT_KEY = "news_auto_reports";
export const AUTO_REPORT_MODES = ["off", "draft", "publish"];
const DONE_PREFIX = "news_auto_report_done:";

// Rounds older than this when their result is saved are archive work (filling
// in a past season), not news.
const FRESH_DAYS = 14;

export async function autoReportMode(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: AUTO_REPORT_KEY } });
    if (AUTO_REPORT_MODES.includes(row?.value)) return row.value;
  } catch {
    /* fresh database */
  }
  return "off";
}

export async function setAutoReportMode(prisma, mode) {
  const value = AUTO_REPORT_MODES.includes(mode) ? mode : "off";
  await prisma.setting.upsert({
    where: { key: AUTO_REPORT_KEY },
    create: { key: AUTO_REPORT_KEY, value },
    update: { value },
  });
  return value;
}

// --- the words ---------------------------------------------------------------

// A small, stable choice: the same round always reads the same, different
// rounds read differently.
function pick(list, seed, salt = 0) {
  let h = 2166136261 ^ salt;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return list[Math.abs(h) % list.length];
}

const ordinal = (n) => `P${n}`;

function fmtGap(ms) {
  if (!(ms > 0)) return null;
  const s = ms / 1000;
  if (s >= 60) {
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
  }
  return `${s.toFixed(3)} seconds`;
}

function fmtLap(ms) {
  if (!(ms > 0) || ms > 1_800_000) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

const teamOf = (r) => r?.effectiveTeam?.name || r?.team?.name || null;
const withTeam = (r) => (teamOf(r) ? `**${r.name}** (${teamOf(r)})` : `**${r.name}**`);

// facts: {
//   race: { id, number, track, seriesName? }, link,
//   results: rows of raceDetailPayload (penalties applied),
//   poleDriverId, standingsAfter, standingsBefore (rows: driverId, name, total),
//   coverUrl, draft (true = leave the writer a note)
// }
// Returns { title, summary, body, category, coverUrl } or null when the round
// has no classified finisher to write about.
export function composeRaceReport(facts) {
  const { race, results = [], poleDriverId = null, standingsAfter = [], standingsBefore = [], link = null } = facts;
  const finished = results
    .filter((r) => r.status === "FINISHED" && r.position != null)
    .sort((a, b) => a.position - b.position);
  if (!finished.length) return null;

  const seed = race.id || race.track;
  const track = prettyTrack(race.track) || "the circuit";
  const round = race.number ? `Round ${race.number}` : null;
  const [p1, p2, p3] = finished;

  const title = pick(
    [
      `${p1.name} wins at ${track}`,
      `${p1.name} conquers ${track}`,
      round ? `${p1.name} takes ${round} at ${track}` : `${p1.name} on top at ${track}`,
      `${track}: ${p1.name} does it`,
    ],
    seed
  );

  const leader = standingsAfter[0] || null;
  const second = standingsAfter[1] || null;
  const summaryBits = [];
  summaryBits.push(
    p2
      ? `${p1.name} beat ${p2.name}${p3 ? ` and ${p3.name}` : ""} at ${track}${round ? ` in ${round}` : ""}.`
      : `${p1.name} won at ${track}${round ? ` in ${round}` : ""}.`
  );
  if (leader && second && leader.total > 0) {
    const gap = leader.total - second.total;
    summaryBits.push(
      gap > 0
        ? `${leader.name} leads the championship by ${gap} point${gap === 1 ? "" : "s"}.`
        : `${leader.name} and ${second.name} are level on points at the top.`
    );
  }
  const summary = summaryBits.join(" ");

  const parts = [];

  // --- the opening
  const fromGrid = p1.grid > 0 ? p1.grid : null;
  const gapToP2 = p2 && p1.totalTimeMs > 0 && p2.totalTimeMs > p1.totalTimeMs ? p2.totalTimeMs - p1.totalTimeMs : null;
  const opening = [];
  if (fromGrid === 1) {
    opening.push(
      pick(
        [
          `${withTeam(p1)} started from pole at ${track} and never looked back.`,
          `Pole, win, job done: ${withTeam(p1)} converted P1 on the grid into victory at ${track}.`,
          `${withTeam(p1)} led the field away from pole and brought it home at ${track}.`,
        ],
        seed,
        1
      )
    );
  } else if (fromGrid) {
    opening.push(
      pick(
        [
          `${withTeam(p1)} came from ${ordinal(fromGrid)} on the grid to win at ${track}.`,
          `Starting ${ordinal(fromGrid)} was no problem for ${withTeam(p1)}, who won at ${track}.`,
          `${withTeam(p1)} climbed from ${ordinal(fromGrid)} to the top step at ${track}.`,
        ],
        seed,
        2
      )
    );
  } else {
    opening.push(`${withTeam(p1)} won at ${track}.`);
  }
  if (gapToP2 != null) {
    const gap = fmtGap(gapToP2);
    opening.push(
      gapToP2 < 1000
        ? `It was tight at the flag: ${p2.name} finished just ${gap} behind.`
        : gapToP2 > 15000
          ? `${p2.name} was the best of the rest, ${gap} down the road.`
          : `${p2.name} crossed the line ${gap} later.`
    );
  }
  parts.push(opening.join(" "));

  // --- the podium
  const podium = finished.slice(0, 3);
  if (podium.length > 1) {
    parts.push(["## The podium", ...podium.map((r, i) => `${i + 1}. ${withTeam(r)}`)].join("\n"));
  }

  // --- the race in numbers
  const notes = [];
  const pole = poleDriverId ? results.find((r) => r.driverId === poleDriverId) : null;
  if (pole && pole.driverId !== p1.driverId) {
    notes.push(
      pole.status === "FINISHED" && pole.position != null
        ? `Pole sitter ${pole.name} finished ${ordinal(pole.position)}.`
        : `Pole sitter ${pole.name} did not see the flag.`
    );
  }
  const climbers = finished
    .filter((r) => r.grid > 0 && r.grid - r.position >= 3)
    .sort((a, b) => b.grid - b.position - (a.grid - a.position));
  const climber = climbers[0];
  if (climber) {
    notes.push(
      `Mover of the day: ${climber.name} went from ${ordinal(climber.grid)} to ${ordinal(climber.position)}, ${
        climber.grid - climber.position
      } places gained.`
    );
  }
  const fl =
    results.find((r) => r.fastestLap) ||
    [...results].filter((r) => fmtLap(r.bestLapMs)).sort((a, b) => a.bestLapMs - b.bestLapMs)[0];
  if (fl && fmtLap(fl.bestLapMs)) notes.push(`Fastest lap: ${fl.name}, ${fmtLap(fl.bestLapMs)}.`);
  else if (fl) notes.push(`Fastest lap: ${fl.name}.`);
  const penalised = results.filter((r) => r.penaltySeconds > 0);
  if (penalised.length) {
    notes.push(
      `The stewards were busy: ${penalised
        .map((r) => `${r.name} (+${Number(r.penaltySeconds)}s)`)
        .join(", ")}.`
    );
  }
  const out = results.filter((r) => r.status === "DNF" || r.status === "DSQ");
  if (out.length) {
    const dnf = out.filter((r) => r.status === "DNF").map((r) => r.name);
    const dsq = out.filter((r) => r.status === "DSQ").map((r) => r.name);
    if (dnf.length) notes.push(`${dnf.length === 1 ? "Retirement" : "Retirements"}: ${dnf.join(", ")}.`);
    if (dsq.length) notes.push(`Disqualified: ${dsq.join(", ")}.`);
  }
  if (notes.length) parts.push(["## The race in numbers", ...notes.map((n) => `- ${n}`)].join("\n"));

  // --- the championship
  if (leader && leader.total > 0) {
    const champ = [];
    const before = standingsBefore[0] || null;
    if (before && before.driverId !== leader.driverId && before.total > 0) {
      champ.push(`There is a new championship leader: ${leader.name} takes over from ${before.name}.`);
    } else {
      champ.push(`${leader.name} stays on top of the championship.`);
    }
    if (second) {
      const gap = leader.total - second.total;
      champ.push(
        gap > 0
          ? `${second.name} is ${gap} point${gap === 1 ? "" : "s"} behind (${leader.total} to ${second.total}).`
          : `${second.name} is level on ${leader.total} points.`
      );
    }
    const top5 = standingsAfter.slice(0, 5).map((r, i) => `${i + 1}. ${r.name} – ${r.total} pts`);
    parts.push(["## The championship", champ.join(" "), "", ...top5].join("\n"));
  }

  if (link) parts.push(`[Full classification](${link})`);

  if (facts.draft) {
    parts.push(
      "> Writer's corner: this draft was written from the results. Add the stories, the drama and the jokes, then publish."
    );
  }

  return {
    title,
    summary,
    body: parts.join("\n\n"),
    category: "RACES",
    coverUrl: facts.coverUrl || null,
  };
}

// --- reading the round and writing the article -------------------------------

async function gatherFacts(prisma, raceId) {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: { season: { select: { id: true, number: true } } },
  });
  if (!race) return null;
  const detail = await raceDetailPayload(prisma, race);
  const isChampionship =
    ((await readRaceTypes(prisma, [race.id])).get(race.id) || (race.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP")) ===
    "CHAMPIONSHIP";
  let standingsAfter = [];
  let standingsBefore = [];
  if (isChampionship && race.number != null && race.seasonId) {
    try {
      const [after, before] = await Promise.all([
        getDriverStandings(prisma, race.seasonId, { upToRound: race.number }),
        race.number > 1 ? getDriverStandings(prisma, race.seasonId, { upToRound: race.number - 1 }) : null,
      ]);
      standingsAfter = after?.standings || [];
      standingsBefore = before?.standings || [];
    } catch {
      /* a report without the championship is still a report */
    }
  }
  const pole = (await readPoleHolders(prisma, [race.id])).get(race.id) || null;
  const hero = (await readRaceHeroes(prisma, [race.id])).get(race.id) || null;
  return {
    raw: race,
    race: { id: race.id, number: isChampionship ? race.number : null, track: race.track },
    results: detail?.results || [],
    poleDriverId: pole,
    standingsAfter,
    standingsBefore,
    coverUrl: hero || detail?.photos?.[0]?.url || null,
    link: await racePageLink(prisma, race),
  };
}

// The report of one round as a fresh article object (not stored). For the
// desk's "write the report for this round" button and for the automatic run.
export async function buildRaceReport(prisma, raceId, { draft = true } = {}) {
  const facts = await gatherFacts(prisma, raceId);
  if (!facts) return null;
  const article = composeRaceReport({ ...facts, draft });
  return article ? { article, race: facts.raw } : null;
}

async function alreadyDone(prisma, raceId) {
  const row = await prisma.setting.findUnique({ where: { key: DONE_PREFIX + raceId } }).catch(() => null);
  return !!row;
}

async function markDone(prisma, raceId) {
  await prisma.setting
    .upsert({
      where: { key: DONE_PREFIX + raceId },
      create: { key: DONE_PREFIX + raceId, value: new Date().toISOString() },
      update: {},
    })
    .catch(() => {});
}

// Tell the desk a draft is waiting: a personal bell entry for every writer and
// every Discord admin. Only when the newsDrafts bell is switched on.
async function tellTheDesk(prisma, article, race) {
  if (!(await readNotifySettings(prisma)).newsDrafts) return;
  const ids = new Set([...(await readNewsWriters(prisma)), ...(await getAdminDiscordIds(prisma))]);
  const track = prettyTrack(race.track) || "the last round";
  for (const recipientId of ids) {
    await dbCreateNotification(prisma, {
      type: "NEWS",
      title: `Race report draft ready: ${track}`,
      body: "The facts are written. Add your take and publish it.",
      link: `/news/desk/${article.id}`,
      recipientId,
      dedupeKey: `news-draft:${article.id}:${recipientId}`,
    }).catch(() => {});
  }
}

// Announce a freshly published article to everyone (once per article). Only
// when the newsPublished bell is switched on.
export async function announceArticle(prisma, article) {
  if (!article || article.status !== "PUBLISHED") return;
  if (!(await readNotifySettings(prisma)).newsPublished) return;
  await dbCreateNotification(prisma, {
    type: "NEWS",
    title: article.title,
    body: article.summary || null,
    link: `/news/${article.slug}`,
    dedupeKey: `news:${article.id}`,
  }).catch(() => {});
}

// Called after a round's result is saved (routes/admin.js). Best-effort and
// silent: the save already succeeded and must stay successful.
export async function draftRaceReport(prisma, race) {
  try {
    if (!race?.id) return null;
    const mode = await autoReportMode(prisma);
    if (mode === "off") return null;
    if (await alreadyDone(prisma, race.id)) return null;
    if (await findAutoReport(prisma, race.id)) return null;
    if (!(await seasonIsPublic(prisma, race.seasonId))) return null;
    if (race.date && Date.now() - new Date(race.date).getTime() > FRESH_DAYS * 86400000) return null;

    const built = await buildRaceReport(prisma, race.id, { draft: mode === "draft" });
    if (!built) return null;
    const stored = await createArticle(
      prisma,
      { ...built.article, status: mode === "publish" ? "PUBLISHED" : "DRAFT" },
      { source: "AUTO", raceId: race.id, author: { name: "NABS News Desk" } }
    );
    await markDone(prisma, race.id);
    if (stored?.status === "PUBLISHED") await announceArticle(prisma, stored);
    else if (stored) await tellTheDesk(prisma, stored, built.race);
    return stored;
  } catch (e) {
    console.warn(`[news] race report for ${race?.id} skipped: ${e.message}`);
    return null;
  }
}
