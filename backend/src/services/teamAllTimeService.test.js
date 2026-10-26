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

  it("ranks by points, then wins", () => {
    const rows = [row("a", "t", { 1: fin(2, 18), 2: fin(2, 18) }), row("b", "t", { 1: fin(2, 18), 2: fin(6, 8), 3: fin(11, 0) }), row("c", "t", { 1: fin(1, 26) })];
    const list = teamTotalsList(addSeasonToTeamTotals(new Map(), { seasonNumber: 1, rows, teamId: "t", teamOf: noStamps }));
    expect(list.map((d) => d.driverId)).toEqual(["a", "c", "b"]);
  });
});
