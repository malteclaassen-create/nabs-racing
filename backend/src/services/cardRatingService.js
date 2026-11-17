// ---------------------------------------------------------------------------
// Card ratings — the numbers printed ON a driver's card, frozen for a whole
// season (the FIFA rule the league asked for):
//
//   The card a driver carries through season N shows where they stood at the
//   END of season N-1. Nothing a driver does inside season N moves their own
//   card; season N's results become the card everyone carries through N+1.
//
// So a card is a snapshot, not a live gauge. The live formula
// (driverRatingsService) still recomputes from the results on every call — it
// is what feeds this season's snapshot once the season is finished, the
// private "card vs. live" comparison on /profile, and the admin tuning panel.
//
// Resolution per driver row of the rated season:
//   1. walk the FINISHED seasons of the same series backwards (newest first),
//      up to MAX_LOOKBACK of them;
//   2. the first one where this PERSON (PersonLink, so old rows and old names
//      count) has a rating supplies the card — that is "the last card they
//      had", so a driver returning after a season out keeps their old numbers
//      instead of losing the card;
//   3. nobody with an earlier rating — a rookie, or season 1 of a series —
//      gets a LIVE card: the current season's own numbers, which still move
//      round by round until the season ends and freezes them. It is the only
//      honest option, since the formula has nothing else to read.
//
// On top of that the card is reprinted twice during the season (league wish,
// 2026-11-17): at half-time with this season's numbers as of the middle round,
// and at full-time with the final ones. See cardUpdate() below.
//
// Identity (team, tier, name) always comes from the CURRENT season's row: the
// numbers freeze, the kit does not.
//
// Pure read service, cached per season for a few minutes — one call can mean
// several full field computations of earlier seasons.
// ---------------------------------------------------------------------------
import { getDriverRatings } from "./driverRatingsService.js";
import { getRatingWindow } from "./careerRatingService.js";
import { getPersonGroups } from "../lib/persons.js";

const CACHE_MS = 5 * 60 * 1000;
// Holds the in-flight PROMISE, not the finished value, so several readers
// arriving at once share one computation (same pattern as recordsService).
const cache = new Map(); // seasonId -> { at, promise }

// How many finished seasons back we look for a driver's last card. Matches the
// rating window: older than that and the person is effectively a returnee whose
// numbers would say nothing about today.
const MAX_LOOKBACK = 7;

export function invalidateCardRatingCache() {
  cache.clear();
}

// { seasonNumber, fromSeasonNumber, rows: [...] } — rows shaped like the live
// rating rows (so every consumer keeps working), each with an extra `card`
// block saying where its numbers come from.
export async function getCardRatings(prisma, seasonId) {
  if (!seasonId) return { seasonNumber: null, fromSeasonNumber: null, rows: [] };
  const hit = cache.get(seasonId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;

  const promise = computeCardRatings(prisma, seasonId);
  cache.set(seasonId, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(seasonId)?.promise === promise) cache.delete(seasonId);
  });
  return promise;
}

// One driver's card row, or null when that person has never been rated.
export async function getCardRating(prisma, seasonId, driverId) {
  const { rows } = await getCardRatings(prisma, seasonId);
  return rows.find((r) => r.driverId === driverId) || null;
}

async function computeCardRatings(prisma, seasonId) {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) return { seasonNumber: null, fromSeasonNumber: null, rows: [] };

  // The finished seasons of this series BEFORE the rated one, newest first.
  // getRatingWindow includes the rated season itself when it is finished, so
  // ask for one extra and drop everything from the rated season onwards.
  const previous = (await getRatingWindow(prisma, season, MAX_LOOKBACK + 1))
    .filter((s) => s.number < season.number)
    .slice(0, MAX_LOOKBACK);

  const [drivers, groups, live, rounds] = await Promise.all([
    prisma.driver.findMany({ where: { seasonId }, include: { team: true } }),
    getPersonGroups(prisma),
    // The live field of the rated season: the fallback card for anyone
    // without an earlier one (rookies, season 1).
    getDriverRatings(prisma, seasonId),
    // The championship rounds (sprint children carry no number, so they are
    // not rounds of their own): they decide the half-time and full-time
    // updates below.
    prisma.race.findMany({
      where: { seasonId, isSpecialEvent: false, number: { not: null } },
      select: { number: true, isCompleted: true },
      orderBy: { number: "asc" },
    }),
  ]);
  const liveById = new Map(live.map((r) => [r.driverId, r]));

  // The card is reprinted twice inside the season, on top of the carry-over:
  //   - at HALF-TIME, once the middle round is completed: everyone who has
  //     raced by then gets this season's numbers as of that round, frozen
  //     until the end of the season;
  //   - at FULL-TIME, once every round is completed: the season's final
  //     numbers, the same ones the next season then carries over.
  // Whoever has no row at that point (sat the first half out) keeps the card
  // they had: carried, or live for a rookie.
  const update = cardUpdate(rounds);
  let updated = null; // Map<driverId, ratingRow> of the current reprint
  if (update?.stage === "season-end") updated = liveById;
  else if (update?.stage === "mid-season") {
    const rows = await getDriverRatings(prisma, seasonId, { upToRaceNumber: update.round });
    updated = new Map(rows.map((r) => [r.driverId, r]));
  }
  const linkedOf = (driverId) => {
    const p = groups.byDriver.get(driverId);
    return p ? groups.byPerson.get(p) || [driverId] : [driverId];
  };

  // Earlier seasons are rated lazily and only once: most fields are answered by
  // the immediately previous season, so the deeper ones are usually never read.
  const fields = new Map(); // seasonId -> Map<driverId, ratingRow>
  const fieldOf = async (id) => {
    if (!fields.has(id)) {
      const rows = await getDriverRatings(prisma, id);
      fields.set(id, new Map(rows.map((r) => [r.driverId, r])));
    }
    return fields.get(id);
  };

  const rows = [];
  for (const d of drivers) {
    const reprint = updated?.get(d.id) || null;
    if (reprint) {
      rows.push({
        ...reprint,
        driverId: d.id,
        name: d.name,
        tier: d.tier,
        team: d.team
          ? { id: d.team.id, name: d.team.name, color: d.team.color, tier: d.team.tier }
          : reprint.team,
        card: {
          locked: true,
          source: update.stage,
          fromSeasonNumber: season.number,
          seasonNumber: season.number,
          asOfRound: update.round,
        },
      });
      continue;
    }

    const linked = linkedOf(d.id);
    let source = null; // { row, season }
    for (const s of previous) {
      const field = await fieldOf(s.id);
      const hit = linked.map((id) => field.get(id)).find(Boolean);
      if (hit) {
        source = { row: hit, season: s };
        break;
      }
    }
    const base = source ? source.row : liveById.get(d.id) || null;
    // Never rated anywhere (a rookie before their first start, a reserve who
    // never drove): no card, exactly as before.
    if (!base) continue;

    rows.push({
      // The snapshot's own numbers AND its supporting stats (starts, wins,
      // contacts …) — the profile's breakdown notes describe the season the
      // card was earned in, so numbers and words tell the same story.
      ...base,
      // …but the identity is always the CURRENT row: same person, new team.
      driverId: d.id,
      name: d.name,
      tier: d.tier,
      team: d.team
        ? { id: d.team.id, name: d.team.name, color: d.team.color, tier: d.team.tier }
        : base.team,
      card: {
        // frozen for the season vs. still moving (no earlier card to carry)
        locked: !!source,
        source: source ? "carried" : "live",
        fromSeasonNumber: source ? source.season.number : season.number,
        seasonNumber: season.number,
      },
    });
  }

  rows.sort((a, b) => b.ratings.overall - a.ratings.overall || b.starts - a.starts || a.name.localeCompare(b.name));
  return {
    seasonNumber: season.number,
    // The season this season's cards are based on (null = there is none, so
    // every card is live).
    fromSeasonNumber: previous[0]?.number ?? null,
    // The in-season reprint in force (null = still the carried cards).
    update,
    rows,
  };
}

// Which in-season reprint is due, from the season's numbered championship
// rounds: { stage: "season-end", round } once all are completed,
// { stage: "mid-season", round } once the middle one is (round 6 of 12,
// round 6 of 11), else null.
export function cardUpdate(rounds) {
  const list = (rounds || []).filter((r) => r.number != null).sort((a, b) => a.number - b.number);
  if (list.length < 2) return null;
  if (list.every((r) => r.isCompleted)) return { stage: "season-end", round: list[list.length - 1].number };
  // Counted, not looked up by position: a round run out of order still counts
  // towards half-time, and the cut is made at the round that completed the half.
  const done = list.filter((r) => r.isCompleted);
  const half = Math.ceil(list.length / 2);
  if (done.length >= half) return { stage: "mid-season", round: done[half - 1].number };
  return null;
}
