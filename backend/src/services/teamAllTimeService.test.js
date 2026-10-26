import { describe, it, expect } from "vitest";
import { addSeasonToTeamTotals, teamTotalsList } from "./teamAllTimeService.js";

const fin = (position, points) => ({ status: "FINISHED", position, points });
const row = (driverId, team, perRace, extra = {}) => ({
  driverId,
  name: driverId[0].toUpperCase() + driverId.slice(1),
  team: { id: team },
  perRace,
  total: Object.values(perRace).reduce((s, c) => s + (c.points || 0), 0),
  ...extra,
});
const noStamps = () => null;

describe("addSeasonToTeamTotals", () => {
  it("credits a seated driver's season to the team, every classification counted", () => {
    const rows = [
      row("duck", "ferrari", {
        1: fin(1, 25),
        2: { ...fin(3, 15 + 8), sprint: fin(2, 8) },
        3: { status: "DNF", position: null, points: 0 },
      }),
      row("goose", "mclaren", { 1: fin(2, 18) }),
    ];
    const list = teamTotalsList(addSeasonToTeamTotals(new Map(), { seasonNumber: 7, rows, teamId: "ferrari", teamOf: noStamps }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ driverId: "duck", points: 48, starts: 4, wins: 1, podiums: 3, seasons: [7] });
  });

  it("follows the result stamps for a reserve drive and a mid-season move", () => {
    const rows = [
      // A reserve whose one drive was for Ferrari.
      row("swan", "reserve", { 2: fin(1, 25) }),
      // Moved from McLaren to Ferrari after round 1; the sprint of round 2 was
      // still for McLaren.
      row("heron", "ferrari", { 1: fin(2, 18), 2: { ...fin(4, 12 + 6), sprint: fin(3, 6) } }),
    ];
    const stamps = new Map([
      ["swan|2|0", "ferrari"],
      ["heron|1|0", "mclaren"],
      ["heron|2|1", "mclaren"],
      ["heron|2|0", "ferrari"],
    ]);
    const teamOf = (d, n, sprint) => stamps.get(`${d}|${n}|${sprint ? 1 : 0}`) ?? null;
    const list = teamTotalsList(addSeasonToTeamTotals(new Map(), { seasonNumber: 7, rows, teamId: "ferrari", teamOf }));
    expect(list.map((d) => [d.driverId, d.points, d.starts, d.wins, d.podiums])).toEqual([
      ["swan", 25, 1, 1, 1],
      ["heron", 12, 1, 0, 0],
    ]);
  });

  it("adds the dropped points back for a whole season with the team, and reads totals-only archives", () => {
    const dropped = row("duck", "ferrari", { 1: fin(1, 25), 2: fin(5, 10) }, { total: 25, droppedRounds: [2] });
    const archive = { driverId: "duck_s3", name: "Duck", team: { id: "ferrari_s3" }, perRace: {}, total: 140 };
    const totals = new Map();
    const personOf = (id) => (id.startsWith("duck") ? "p:duck" : id);
    addSeasonToTeamTotals(totals, { seasonNumber: 3, rows: [archive], teamId: "ferrari_s3", teamOf: noStamps, personOf });
    addSeasonToTeamTotals(totals, { seasonNumber: 7, rows: [dropped], teamId: "ferrari", teamOf: noStamps, personOf });
    const [d] = teamTotalsList(totals);
    // One person over both seasons, shown under the newest row.
    expect(d).toMatchObject({ driverId: "duck", points: 175, starts: 2, wins: 1, seasons: [3, 7] });
  });

  it("leaves out a driver who never started or scored for the team", () => {
    const rows = [row("idle", "ferrari", {}), row("dns", "ferrari", { 1: { status: "DNS", position: null, points: 0 } })];
    const list = teamTotalsList(addSeasonToTeamTotals(new Map(), { seasonNumber: 7, rows, teamId: "ferrari", teamOf: noStamps }));
    expect(list).toEqual([]);
  });

  it("scores every finish, sprint included, on one table whatever the season paid", () => {
    // Old season paying 10-8-6…: the points stay as paid, the score is today's.
    const old = [row("duck", "t", { 1: fin(1, 10), 2: { ...fin(2, 8 + 6), sprint: fin(3, 6) }, 3: { status: "DNF", position: null, points: 0 } })];
    const list = teamTotalsList(addSeasonToTeamTotals(new Map(), { seasonNumber: 1, rows: old, teamId: "t", teamOf: noStamps }));
    expect(list[0]).toMatchObject({ points: 24, score: 35 + 30 + 25 });
    // A season's own scale can be passed in; P beyond the table scores 0.
    const deep = [row("goose", "t", { 1: fin(2, 18), 2: fin(4, 12) })];
    const [g] = teamTotalsList(addSeasonToTeamTotals(new Map(), { seasonNumber: 2, rows: deep, teamId: "t", teamOf: noStamps, scale: [3, 2, 1] }));
    expect(g.score).toBe(2);
  });

  it("ranks by score, then wins, so an early season's lower points table is no handicap", () => {
    const totals = new Map();
    // S1 paid 10-8-6: three wins, 30 points.
    addSeasonToTeamTotals(totals, { seasonNumber: 1, rows: [row("early", "t1", { 1: fin(1, 10), 2: fin(1, 10), 3: fin(1, 10) })], teamId: "t1", teamOf: noStamps });
    // S7 pays 35-30-25: three runner-ups, 90 points.
    addSeasonToTeamTotals(totals, { seasonNumber: 7, rows: [row("late", "t7", { 1: fin(2, 30), 2: fin(2, 30), 3: fin(2, 30) })], teamId: "t7", teamOf: noStamps });
    // Same score as "late", with a win: the wins decide.
    addSeasonToTeamTotals(totals, { seasonNumber: 7, rows: [row("winner", "t7", { 1: fin(1, 35), 2: fin(3, 25), 3: fin(2, 30) })], teamId: "t7", teamOf: noStamps });
    const list = teamTotalsList(totals);
    expect(list.map((d) => [d.driverId, d.score, d.points])).toEqual([
      ["early", 105, 30],
      ["winner", 90, 90],
      ["late", 90, 90],
    ]);
  });
});
