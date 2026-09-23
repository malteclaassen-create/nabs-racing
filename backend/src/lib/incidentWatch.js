// ---------------------------------------------------------------------------
// Incident watch: who keeps turning up in the accidents.
//
// The tier reps asked for the stewarding version of the attendance Activity
// view. That one shows who has gone quiet without anybody having to open every
// round; this one shows who keeps hitting things, from numbers the site
// already has: the contacts, wall hits, cuts and in-game penalties the AC
// result file gives each driver (services/telemetryExtractor.js), and the
// steward reports that named them.
//
// Deliberately NO threshold and NO flag. A contact count says a car touched
// another car above a minimum impact speed; it does not say whose fault it
// was, and the victim of a punt registers the same contact as the driver who
// punted. A list that labelled somebody "dangerous" from that would be making
// the stewards' decision for them. This is a sortable overview and the people
// reading it do the judging.
//
// Per PERSON, like the rest of the stewarding (lib/reports.js driverRecord):
// somebody who changed teams mid-season and raced on two roster rows is one
// line with both halves added together.
//
// Per ROUND, with a sprint weekend's two classifications as one round: the
// sprint child (lib/sprintRaces.js) is folded into its event through `roundOf`,
// the same way the standings score it under the event's number. One evening,
// one line in the breakdown, both races' contacts in it.
//
// A round whose result file was imported before the telemetry columns existed
// has NULLs in them, and that is "no data", not "clean". Treated as zero it
// would pull a driver's average down for rounds nobody measured, so a null is
// carried through as null and left out of both the sum and the count the
// average divides by.
//
// Pure, so the arithmetic is tested without a database; the route in
// routes/admin.js does the reading.
// ---------------------------------------------------------------------------

// The four numbers read off the result file, in the order the page shows them.
export const INCIDENT_FIELDS = ["contacts", "envContacts", "cuts", "gamePenalties"];

// The windows the card offers: the last three rounds, the last five, and the
// whole season (0). Anything else sent is read as the whole season.
export const WINDOW_CHOICES = [3, 5, 0];

// A DNS row is a driver who was entered and never took the start: nothing they
// did in the race can be counted, and the round is not one of their races.
const started = (r) => !!r && r.status !== "DNS";

const num = (v) => (v == null ? null : Number(v));

// Two decimals is as fine as "per race" needs to be read, and it keeps the
// payload from carrying 0.3333333333333333.
const perRace = (total, n) => (n > 0 && total != null ? Math.round((total / n) * 100) / 100 : null);

// A person's display row: this season's (`current`), on the roster, in a real
// team — the same preference the attendance views use when a person has two
// rows. A row of another season only names somebody who has none this season.
const rowRank = (d) => (d.current === false ? 0 : 4) + (d.isActive === false ? 0 : 2) + ((d.tier ?? 0) === 0 ? 0 : 1);

// `rounds`   the season's championship rounds that have been run, in race order
//            [{ id, number, track, date }]
// `roundOf`  Map raceId -> round id, covering the rounds and their sprint children
// `results`  [{ raceId, driverId, status, contacts, envContacts, cuts, gamePenalties }]
// `reports`  [{ raceId, accusedDriverId, status }]
// `rows`     every driver row involved [{ id, name, team, teamColor, tier, isActive, current }]
// `personOf` driver id -> person key (unlinked rows stand for themselves)
// `last`     how many of the latest rounds to look at; 0 = the whole season
export function incidentWatch({
  rounds = [],
  roundOf = new Map(),
  results = [],
  reports = [],
  rows = [],
  personOf = (id) => id,
  last = 0,
} = {}) {
  const span = last > 0 ? rounds.slice(-last) : [...rounds];
  const inWindow = new Set(span.map((r) => r.id));
  const roundFor = (raceId) => {
    const id = roundOf.get(raceId) ?? raceId;
    return inWindow.has(id) ? id : null;
  };

  // person -> round id -> the cell being added up.
  const cells = new Map();
  const cellOf = (key, roundId) => {
    if (!cells.has(key)) cells.set(key, new Map());
    const byRound = cells.get(key);
    if (!byRound.has(roundId)) {
      byRound.set(roundId, {
        started: false,
        contacts: null,
        envContacts: null,
        cuts: null,
        gamePenalties: null,
        reports: 0,
        penalties: 0,
      });
    }
    return byRound.get(roundId);
  };

  // Which rounds have ANY telemetry at all, so the page can say "no data for
  // R3" once instead of on every driver's line.
  const measured = new Set();
  for (const r of results) {
    const roundId = roundFor(r.raceId);
    if (!roundId || !started(r)) continue;
    const cell = cellOf(personOf(r.driverId), roundId);
    cell.started = true;
    for (const f of INCIDENT_FIELDS) {
      const v = num(r[f]);
      if (v == null) continue;
      // A sprint weekend's two races add up; one of them without data leaves
      // the other's number standing rather than wiping it.
      cell[f] = (cell[f] ?? 0) + v;
      measured.add(roundId);
    }
  }
  for (const rep of reports) {
    if (!rep.accusedDriverId) continue;
    const roundId = roundFor(rep.raceId);
    if (!roundId) continue;
    const cell = cellOf(personOf(rep.accusedDriverId), roundId);
    cell.reports += 1;
    if (rep.status === "PENALTY") cell.penalties += 1;
  }

  // The row each person is shown as.
  const shownAs = new Map();
  for (const d of rows) {
    const key = personOf(d.id);
    const seen = shownAs.get(key);
    if (!seen || rowRank(d) > rowRank(seen)) shownAs.set(key, d);
  }

  const drivers = [];
  for (const [key, byRound] of cells) {
    const d = shownAs.get(key) || {};
    const breakdown = span.map((round) => {
      const c = byRound.get(round.id);
      return {
        roundId: round.id,
        number: round.number ?? null,
        track: round.track || null,
        started: !!c?.started,
        contacts: c?.contacts ?? null,
        envContacts: c?.envContacts ?? null,
        cuts: c?.cuts ?? null,
        gamePenalties: c?.gamePenalties ?? null,
        reports: c?.reports || 0,
        penalties: c?.penalties || 0,
      };
    });
    const raced = breakdown.filter((b) => b.started);
    const totals = {};
    const averages = {};
    const measuredRaces = {};
    for (const f of INCIDENT_FIELDS) {
      const known = raced.filter((b) => b[f] != null);
      measuredRaces[f] = known.length;
      totals[f] = known.length ? known.reduce((s, b) => s + b[f], 0) : null;
      averages[f] = perRace(totals[f], known.length);
    }
    drivers.push({
      key,
      driverId: d.id || null,
      name: d.name || "Unknown driver",
      team: d.team || null,
      teamColor: d.teamColor || null,
      tier: d.tier ?? null,
      races: raced.length,
      totals,
      averages,
      measuredRaces,
      reports: breakdown.reduce((s, b) => s + b.reports, 0),
      penalties: breakdown.reduce((s, b) => s + b.penalties, 0),
      rounds: breakdown,
    });
  }

  // Most contacts per race first, the page's default; no data sinks to the
  // bottom rather than reading as the cleanest driver on the grid.
  drivers.sort(
    (a, b) =>
      (b.averages.contacts ?? -1) - (a.averages.contacts ?? -1) ||
      b.reports - a.reports ||
      a.name.localeCompare(b.name)
  );

  return {
    rounds: span.map((r) => ({
      id: r.id,
      number: r.number ?? null,
      track: r.track || null,
      date: r.date || null,
      measured: measured.has(r.id),
    })),
    drivers,
  };
}
