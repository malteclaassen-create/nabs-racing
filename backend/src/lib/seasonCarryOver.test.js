import { describe, it, expect } from "vitest";
import {
  buildCarryOverList, readCarryOver, commitCarryOver, parsePicks, pickedByDefault, parseTeamPlan, commitTeamPlan,
} from "./seasonCarryOver.js";

// An in-memory stand-in for the handful of tables the carry over touches:
// teams, drivers, results (as start counts), person links, and the raw
// steamId / division columns.
function fakeDb({ teams = [], drivers = [], starts = {}, links = {}, steam = {}, division = {}, seasons = [] } = {}) {
  const state = {
    teams: teams.map((t) => ({ ...t })),
    drivers: drivers.map((d) => ({ isActive: true, ...d })),
    links: new Map(Object.entries(links)), // driverId -> personId
    steam: new Map(Object.entries(steam)),
    division: new Map(Object.entries(division)),
    seasons: seasons.map((s) => ({ ...s })),
    seasonDiv2: new Map(),
  };
  let personN = 0;
  const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : { ...row });
  const prisma = {
    state,
    season: {
      findUnique: async ({ where }) => state.seasons.find((s) => s.id === where.id) || null,
      findMany: async ({ where }) => state.seasons.filter((s) => s.seriesId === where.seriesId).map((s) => ({ ...s })),
    },
    team: {
      findMany: async ({ where }) =>
        state.teams
          .filter((t) =>
            where.id?.in ? where.id.in.includes(t.id) : where.seasonId?.in ? where.seasonId.in.includes(t.seasonId) : t.seasonId === where.seasonId
          )
          .map((t) => ({ ...t })),
      findUnique: async ({ where }) => state.teams.find((t) => t.id === where.id) || null,
      findFirst: async ({ where }) => state.teams.find((t) => t.seasonId === where.seasonId && t.tier === where.tier) || null,
      create: async ({ data }) => {
        if (state.teams.some((t) => t.id === data.id)) throw new Error(`team ${data.id} exists`);
        state.teams.push({ ...data });
        return { ...data };
      },
    },
    driver: {
      findMany: async ({ where, select }) =>
        state.drivers.filter((d) => d.seasonId === where.seasonId).map((d) => pick(d, select)),
      findUnique: async ({ where }) => state.drivers.find((d) => d.id === where.id) || null,
      create: async ({ data }) => {
        if (state.drivers.some((d) => d.id === data.id)) throw new Error(`driver ${data.id} exists`);
        state.drivers.push({ ...data });
        return { ...data };
      },
    },
    $queryRaw: async (strings) => {
      const q = strings.join("?");
      if (q.includes('FROM "PersonLink"')) return [...state.links].map(([driverId, personId]) => ({ driverId, personId }));
      return [];
    },
    $queryRawUnsafe: async (q, ...args) => {
      if (q.includes('FROM "RaceResult"')) {
        const seasonId = args[0];
        return Object.entries(starts)
          .filter(([id]) => state.drivers.find((d) => d.id === id)?.seasonId === seasonId)
          .map(([driverId, n]) => ({ driverId, n: BigInt(n) }));
      }
      if (q.includes('SELECT "division2" FROM "Season"')) {
        const id = args[0];
        const v = state.seasonDiv2.has(id) ? state.seasonDiv2.get(id) : state.seasons.find((x) => x.id === id)?.division2 ? 1 : 0;
        return [{ division2: v }];
      }
      if (q.includes('"division" = 2')) {
        return state.drivers.filter((d) => d.seasonId === args[0] && state.division.get(d.id) === 2).map((d) => ({ id: d.id }));
      }
      if (q.includes('SELECT "id", "steamId"')) {
        return args.map((id) => ({ id, steamId: state.steam.get(id) ?? null }));
      }
      if (q.includes('SELECT DISTINCT "personId"')) {
        return [...new Set(args.map((id) => state.links.get(id)).filter(Boolean))].map((personId) => ({ personId }));
      }
      return [];
    },
    $executeRawUnsafe: async (q, ...args) => {
      if (q.startsWith('UPDATE "Driver" SET "steamId"')) state.steam.set(args[1], args[0]);
      else if (q.startsWith('UPDATE "Driver" SET "division" = 2')) state.division.set(args[0], 2);
      else if (q.startsWith('UPDATE "PersonLink"')) {
        const [to, ...from] = args;
        for (const [k, v] of state.links) if (from.includes(v)) state.links.set(k, to);
      } else if (q.startsWith('UPDATE "Season" SET "division2"')) state.seasonDiv2.set(args[1], args[0]);
      return 1;
    },
    // dbLinkDrivers' INSERT … ON CONFLICT (tagged template: id, personId, now, personId).
    $executeRaw: async (_strings, driverId, personId) => {
      state.links.set(driverId, personId || `p${++personN}`);
      return 1;
    },
  };
  return prisma;
}

const S8 = { id: "s8", number: 8, division2: true, seriesId: "f1" };
const S9 = { id: "s9", number: 9, seriesId: "f1" };

function season8() {
  return fakeDb({
    seasons: [S8, S9],
    teams: [
      { id: "ferrari_s8", name: "Ferrari", tier: 1, color: "#f00", seasonId: "s8" },
      { id: "minardi_s8", name: "Minardi", tier: 2, color: "#000", seasonId: "s8" },
      { id: "redbull2_s8", name: "Red Bull", tier: 3, color: "#00f", seasonId: "s8" },
      { id: "reserve_s8", name: "Reserve", tier: 0, color: "#666", seasonId: "s8" },
    ],
    drivers: [
      { id: "malte_s8", name: "Malte", discordName: "malte", teamId: "ferrari_s8", tier: 1, seasonId: "s8", country: "de" },
      { id: "steve_s7_s8", name: "Steve", discordName: "steve", teamId: "minardi_s8", tier: 2, seasonId: "s8", isActive: false },
      { id: "rookie_s8", name: "Rookie", discordName: "rookie", teamId: "redbull2_s8", tier: 3, seasonId: "s8" },
      { id: "sub_s8", name: "Sub Driver", discordName: "sub", teamId: "reserve_s8", tier: 0, seasonId: "s8" },
      { id: "ghost_s8", name: "Ghost", discordName: "ghost", teamId: "reserve_s8", tier: 0, seasonId: "s8" },
      { id: "newbie_s8", name: "Newbie", discordName: "newbie", teamId: "reserve_s8", tier: 0, seasonId: "s8" },
    ],
    starts: { malte_s8: 12, steve_s7_s8: 10, rookie_s8: 0, sub_s8: 2 },
    links: { steve_s7: "p-steve", steve_s7_s8: "p-steve" },
    steam: { malte_s8: "7656119" },
    division: { newbie_s8: 2 },
  });
}

describe("pickedByDefault", () => {
  it("ticks seats and reserves who drove, not reserves who never did", () => {
    expect(pickedByDefault({ seat: true, starts: 0 })).toBe(true);
    expect(pickedByDefault({ seat: false, starts: 1 })).toBe(true);
    expect(pickedByDefault({ seat: false, starts: 0 })).toBe(false);
    expect(pickedByDefault({ seat: true, starts: 5, already: true })).toBe(false);
  });
});

describe("parsePicks", () => {
  it("keeps driver ids, the place and a team, nothing else", () => {
    const picks = parsePicks([
      { driverId: "a" },
      { driverId: "b", to: "reserve", teamId: "x" },
      { driverId: "c", to: "team", teamId: "ferrari_s8" },
      { driverId: 3 },
      null,
      { to: "team" },
    ]);
    expect([...picks]).toEqual([
      ["a", { to: "team", teamId: null, targetTeamId: null }],
      ["b", { to: "reserve", teamId: null, targetTeamId: null }],
      ["c", { to: "team", teamId: "ferrari_s8", targetTeamId: null }],
    ]);
    expect(parsePicks([{ driverId: "e", targetTeamId: "x_s9" }]).get("e").targetTeamId).toBe("x_s9");
    expect(parsePicks("nope").size).toBe(0);
  });
});

describe("buildCarryOverList", () => {
  it("groups by team, Division 1 tiers first, then Division 2, the pool last", () => {
    const list = buildCarryOverList({
      teams: [
        { id: "r", name: "Reserve", tier: 0 },
        { id: "d2", name: "Red Bull", tier: 3 },
        { id: "t2", name: "Minardi", tier: 2 },
        { id: "t1", name: "Ferrari", tier: 1 },
      ],
      drivers: [
        { id: "a", name: "A", teamId: "t1" },
        { id: "b", name: "B", teamId: "r" },
        { id: "c", name: "C", teamId: "d2" },
      ],
      starts: new Map(),
    });
    expect(list.map((t) => t.name)).toEqual(["Ferrari", "Minardi", "Red Bull", "Reserve"]);
    expect(list[2].people[0]).toMatchObject({ name: "C", seat: true, division: 2, picked: true });
    expect(list[3].people[0]).toMatchObject({ name: "B", seat: false, picked: false });
  });

  it("marks who is on the new roster already, by person link or by name", () => {
    const list = buildCarryOverList({
      teams: [{ id: "t1", name: "Ferrari", tier: 1 }],
      drivers: [
        { id: "a8", name: "Anna", teamId: "t1" },
        { id: "b8", name: "Ben", teamId: "t1" },
        { id: "c8", name: "Carl", teamId: "t1" },
      ],
      starts: new Map(),
      present: [
        { id: "a9", name: "Anna R." },
        { id: "x9", name: "ben" },
      ],
      persons: { byDriver: new Map([["a8", "pa"], ["a9", "pa"]]) },
    });
    const by = Object.fromEntries(list[0].people.map((p) => [p.name, p]));
    expect(by.Anna).toMatchObject({ already: true, picked: false });
    expect(by.Ben).toMatchObject({ already: true, picked: false });
    expect(by.Carl).toMatchObject({ already: false, picked: true });
  });
});

describe("readCarryOver", () => {
  it("lists last season with starts and seats; reserves are in the one pool", async () => {
    const prisma = season8();
    const { teams } = await readCarryOver(prisma, { fromSeasonId: "s8", target: S9 });
    const people = Object.fromEntries(teams.flatMap((t) => t.people).map((p) => [p.name, p]));
    expect(people.Malte).toMatchObject({ seat: true, starts: 12, picked: true, teamName: "Ferrari" });
    expect(people.Steve).toMatchObject({ seat: true, starts: 10, picked: true, isActive: false });
    expect(people.Rookie).toMatchObject({ seat: true, starts: 0, picked: true, division: 2 });
    expect(people["Sub Driver"]).toMatchObject({ seat: false, starts: 2, picked: true });
    expect(people.Ghost).toMatchObject({ seat: false, starts: 0, picked: false, division: 1 });
    // An old Division 2 flag on a reserve is ignored: one Reserve pool.
    expect(people.Newbie).toMatchObject({ seat: false, starts: 0, picked: false, division: 1 });
  });
});

describe("commitCarryOver", () => {
  it("copies every team and only the picked people, linked to who they were", async () => {
    const prisma = season8();
    const picks = parsePicks([
      { driverId: "malte_s8" },
      { driverId: "steve_s7_s8", to: "reserve" },
      { driverId: "rookie_s8" },
      { driverId: "sub_s8" },
      { driverId: "newbie_s8" },
    ]);
    const out = await commitCarryOver(prisma, { target: S9, fromSeasonId: "s8", picks });
    expect(out).toMatchObject({ teamsCreated: 4, driversCreated: 5, skipped: [] });

    const s9 = prisma.state.drivers.filter((d) => d.seasonId === "s9");
    const byName = Object.fromEntries(s9.map((d) => [d.name, d]));
    expect(Object.keys(byName).sort()).toEqual(["Malte", "Newbie", "Rookie", "Steve", "Sub Driver"]);
    // Ghost never drove and was not ticked: not created.
    expect(byName.Ghost).toBeUndefined();

    expect(byName.Malte).toMatchObject({ id: "malte_s9", teamId: "ferrari_s8_s9", tier: 1, country: "de", isActive: true });
    // The id loses the old suffix chain instead of growing another one.
    expect(byName.Steve).toMatchObject({ id: "steve_s9", teamId: "reserve_s8_s9", tier: 0, isActive: true });
    expect(byName.Rookie).toMatchObject({ teamId: "redbull2_s8_s9", tier: 3 });
    expect(byName["Sub Driver"]).toMatchObject({ teamId: "reserve_s8_s9", tier: 0 });

    // Steam id rides along, and the Division 2 reserve stays in its pool.
    expect(prisma.state.steam.get("malte_s9")).toBe("7656119");
    // One Reserve pool: nobody gets a Division 2 pool flag.
    expect(prisma.state.division.has("newbie_s9")).toBe(false);
    expect(prisma.state.division.has("sub_s9")).toBe(false);

    // Person links: Steve joins his existing person, the others get one each.
    expect(prisma.state.links.get("steve_s9")).toBe("p-steve");
    expect(prisma.state.links.get("malte_s9")).toBe(prisma.state.links.get("malte_s8"));
    expect(prisma.state.links.get("malte_s9")).toBeTruthy();

    // Division 2 teams came along, so the switch is on too.
    expect(prisma.state.seasonDiv2.get("s9")).toBe(1);
  });

  it("a Division 2 driver sent to the pool joins the one Reserve pool", async () => {
    const prisma = season8();
    await commitCarryOver(prisma, { target: S9, fromSeasonId: "s8", picks: parsePicks([{ driverId: "rookie_s8", to: "reserve" }]) });
    const rookie = prisma.state.drivers.find((d) => d.seasonId === "s9" && d.name === "Rookie");
    expect(rookie).toMatchObject({ tier: 0, teamId: "reserve_s8_s9" });
    expect(prisma.state.division.has(rookie.id)).toBe(false);
  });

  it("moves a driver to another team, and gives a reserve a seat", async () => {
    const prisma = season8();
    const picks = parsePicks([
      { driverId: "malte_s8", to: "team", teamId: "minardi_s8" },
      { driverId: "sub_s8", to: "team", teamId: "ferrari_s8" },
      { driverId: "rookie_s8", to: "team", teamId: "somewhere_else" },
    ]);
    await commitCarryOver(prisma, { target: S9, fromSeasonId: "s8", picks });
    const by = Object.fromEntries(prisma.state.drivers.filter((d) => d.seasonId === "s9").map((d) => [d.name, d]));
    expect(by.Malte).toMatchObject({ teamId: "minardi_s8_s9", tier: 2 });
    expect(by["Sub Driver"]).toMatchObject({ teamId: "ferrari_s8_s9", tier: 1 });
    // A team id that is not in the source season: their own team, not the pool.
    expect(by.Rookie).toMatchObject({ teamId: "redbull2_s8_s9", tier: 3 });
  });

  it("is safe to run twice and leaves people already there alone", async () => {
    const prisma = season8();
    const picks = parsePicks([{ driverId: "malte_s8" }, { driverId: "sub_s8" }]);
    await commitCarryOver(prisma, { target: S9, fromSeasonId: "s8", picks });
    const again = await commitCarryOver(prisma, { target: S9, fromSeasonId: "s8", picks });
    expect(again.teamsCreated).toBe(0);
    expect(again.driversCreated).toBe(0);
    expect(again.skipped.map((s) => s.name).sort()).toEqual(["Malte", "Sub Driver"]);
    expect(prisma.state.drivers.filter((d) => d.seasonId === "s9")).toHaveLength(2);
    expect(prisma.state.teams.filter((t) => t.seasonId === "s9")).toHaveLength(4);
  });

  it("once the new season has teams, uses those and copies none", async () => {
    const prisma = season8();
    prisma.state.teams.push({ id: "ferrari_new", name: "Ferrari", tier: 1, color: "#f00", seasonId: "s9" });
    const out = await commitCarryOver(prisma, {
      target: S9,
      fromSeasonId: "s8",
      picks: parsePicks([{ driverId: "malte_s8" }, { driverId: "steve_s7_s8" }]),
    });
    expect(out.teamsCreated).toBe(0);
    expect(prisma.state.drivers.find((d) => d.id === "malte_s9").teamId).toBe("ferrari_new");
    // Minardi is not in the new season: Steve waits in the pool, made on demand.
    const steve = prisma.state.drivers.find((d) => d.id === "steve_s9");
    expect(steve.tier).toBe(0);
  });

  it("ignores picks that are not in the source season", async () => {
    const prisma = season8();
    prisma.state.drivers.push({ id: "other_s3", name: "Other", teamId: "x", tier: 1, seasonId: "s3" });
    const out = await commitCarryOver(prisma, { target: S9, fromSeasonId: "s8", picks: parsePicks([{ driverId: "other_s3" }]) });
    expect(out.driversCreated).toBe(0);
  });
});

describe("parseTeamPlan", () => {
  it("keeps the kept teams with their tier and the new ones", () => {
    const plan = parseTeamPlan({
      division2: true,
      teams: [{ sourceId: "ferrari_s8", tier: 1 }, { sourceId: "", tier: 1 }],
      newTeams: [{ name: "  Jordan ", tier: 3, color: "#ffcc00" }, { name: "", tier: 1 }, { name: "Spyker", tier: 2, color: "red" }],
    });
    expect(plan).toEqual({
      division2: true,
      teams: [{ sourceId: "ferrari_s8", tier: 1 }],
      newTeams: [
        { name: "Jordan", tier: 3, color: "#ffcc00" },
        { name: "Spyker", tier: 2, color: "#64748b" },
      ],
    });
  });

  it("refuses a Division 2 team while Division 2 is off, and odd tiers", () => {
    expect(parseTeamPlan({ teams: [{ sourceId: "a", tier: 3 }] }).error).toMatch(/Division 2/);
    expect(parseTeamPlan({ teams: [{ sourceId: "a", tier: 0 }] }).error).toBeTruthy();
  });
});

describe("teams step, then people", () => {
  it("creates only the kept teams, in the tier picked, plus new ones and the pool", async () => {
    const prisma = season8();
    const plan = parseTeamPlan({
      division2: true,
      teams: [
        { sourceId: "ferrari_s8", tier: 1 },
        { sourceId: "minardi_s8", tier: 3 }, // Minardi moves to Division 2
      ],
      newTeams: [{ name: "Jordan", tier: 3, color: "#ffcc00" }],
    });
    const out = await commitTeamPlan(prisma, { target: S9, fromSeasonId: "s8", plan });
    expect(out.teamsCreated).toBe(4);
    const s9 = prisma.state.teams.filter((t) => t.seasonId === "s9");
    expect(s9.map((t) => [t.id, t.tier]).sort()).toEqual([
      ["ferrari_s8_s9", 1],
      ["jordan_s9", 3],
      ["minardi_s8_d2_s9", 3],
      ["reserve_s8_s9", 0],
    ]);
    expect(prisma.state.seasonDiv2.get("s9")).toBe(1);
    // Red Bull (Division 2 last season) did not carry on: not created.
    expect(s9.some((t) => t.name === "Red Bull")).toBe(false);
  });

  it("the people list points at the new teams, and people land where they were sent", async () => {
    const prisma = season8();
    await commitTeamPlan(prisma, {
      target: S9,
      fromSeasonId: "s8",
      plan: parseTeamPlan({
        division2: true,
        teams: [{ sourceId: "ferrari_s8", tier: 1 }, { sourceId: "minardi_s8", tier: 3 }],
        newTeams: [{ name: "Jordan", tier: 3 }],
      }),
    });
    const preview = await readCarryOver(prisma, { fromSeasonId: "s8", target: S9 });
    const byName = Object.fromEntries(preview.teams.map((t) => [t.name, t]));
    expect(byName.Ferrari.targetTeamId).toBe("ferrari_s8_s9");
    expect(byName.Minardi.targetTeamId).toBe("minardi_s8_d2_s9");
    expect(byName["Red Bull"].targetTeamId).toBe(null);
    expect(byName.Reserve.targetTeamId).toBe("reserve_s8_s9");
    expect(preview.targetTeams.map((t) => t.name)).toEqual(["Ferrari", "Jordan", "Minardi", "Reserve"]);
    expect(preview.division2).toBe(true);

    const out = await commitCarryOver(prisma, {
      target: S9,
      fromSeasonId: "s8",
      picks: parsePicks([
        { driverId: "malte_s8" }, // own team, Ferrari
        { driverId: "steve_s7_s8" }, // own team, Minardi, now in Division 2
        { driverId: "rookie_s8" }, // Red Bull did not carry on: the pool, Division 2 side
        { driverId: "sub_s8", to: "team", targetTeamId: "jordan_s9" },
        { driverId: "ghost_s8", to: "reserve" },
      ]),
    });
    expect(out.teamsCreated).toBe(0);
    const by = Object.fromEntries(prisma.state.drivers.filter((d) => d.seasonId === "s9").map((d) => [d.name, d]));
    expect(by.Malte).toMatchObject({ teamId: "ferrari_s8_s9", tier: 1 });
    expect(by.Steve).toMatchObject({ teamId: "minardi_s8_d2_s9", tier: 3 });
    expect(by.Rookie).toMatchObject({ teamId: "reserve_s8_s9", tier: 0 });
    expect(prisma.state.division.has(by.Rookie.id)).toBe(false);
    expect(by["Sub Driver"]).toMatchObject({ teamId: "jordan_s9", tier: 3 });
    expect(by.Ghost).toMatchObject({ teamId: "reserve_s8_s9", tier: 0 });
    expect(prisma.state.division.has(by.Ghost.id)).toBe(false);
  });
});

describe("Division 2 has the same teams as Division 1, kept apart", () => {
  it("one old team becomes two teams, and drivers go to the right one", async () => {
    const prisma = season8();
    await commitTeamPlan(prisma, {
      target: S9,
      fromSeasonId: "s8",
      plan: parseTeamPlan({
        division2: true,
        teams: [
          { sourceId: "ferrari_s8", tier: 1 },
          { sourceId: "ferrari_s8", tier: 3 },
          { sourceId: "minardi_s8", tier: 1 }, // Tier 2 last season, Tier 1 now
        ],
      }),
    });
    const s9 = prisma.state.teams.filter((t) => t.seasonId === "s9");
    expect(s9.filter((t) => t.name === "Ferrari").map((t) => [t.id, t.tier]).sort()).toEqual([
      ["ferrari_s8_d2_s9", 3],
      ["ferrari_s8_s9", 1],
    ]);
    expect(s9.find((t) => t.name === "Minardi").tier).toBe(1);

    const pv = await readCarryOver(prisma, { fromSeasonId: "s8", target: S9 });
    // Last season's Ferrari maps to the Division 1 Ferrari, not the Division 2 copy.
    expect(pv.teams.find((t) => t.name === "Ferrari").targetTeamId).toBe("ferrari_s8_s9");
    expect(pv.teams.find((t) => t.name === "Minardi").targetTeamId).toBe("minardi_s8_s9");

    await commitCarryOver(prisma, {
      target: S9,
      fromSeasonId: "s8",
      picks: parsePicks([{ driverId: "malte_s8" }, { driverId: "sub_s8", to: "team", targetTeamId: "ferrari_s8_d2_s9" }]),
    });
    const by = Object.fromEntries(prisma.state.drivers.filter((d) => d.seasonId === "s9").map((d) => [d.name, d]));
    expect(by.Malte).toMatchObject({ teamId: "ferrari_s8_s9", tier: 1 });
    expect(by["Sub Driver"]).toMatchObject({ teamId: "ferrari_s8_d2_s9", tier: 3 });
  });
});

describe("team search", () => {
  it("offers every team the league ever had, once, newest season first", async () => {
    const prisma = season8();
    prisma.state.seasons.push({ id: "s3", number: 3, seriesId: "f1" }, { id: "x1", number: 1, seriesId: "other" });
    prisma.state.teams.push(
      { id: "jordan_s3", name: "Jordan", tier: 1, color: "#ff0", logoUrl: "/j.png", seasonId: "s3" },
      { id: "ferrari_s3", name: "Ferrari", tier: 1, color: "#a00", seasonId: "s3" },
      { id: "elsewhere", name: "Elsewhere", tier: 1, color: "#000", seasonId: "x1" }
    );
    const { pastTeams } = await readCarryOver(prisma, { fromSeasonId: "s8", target: S9 });
    const by = Object.fromEntries(pastTeams.map((t) => [t.name, t]));
    expect(by.Jordan).toMatchObject({ id: "jordan_s3", seasonNumber: 3, logoUrl: "/j.png" });
    expect(by.Ferrari).toMatchObject({ id: "ferrari_s8", seasonNumber: 8 });
    expect(by.Elsewhere).toBeUndefined();
    expect(by.Reserve).toBeUndefined();

    // Picking an old team brings it back with its look.
    await commitTeamPlan(prisma, {
      target: S9,
      fromSeasonId: "s8",
      plan: parseTeamPlan({ division2: true, teams: [{ sourceId: "jordan_s3", tier: 3 }] }),
    });
    const jordan = prisma.state.teams.find((t) => t.seasonId === "s9" && t.name === "Jordan");
    expect(jordan).toMatchObject({ id: "jordan_s3_d2_s9", tier: 3, color: "#ff0", logoUrl: "/j.png" });
  });
});
