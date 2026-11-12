// The season copies: "Teams only" and "Teams and drivers". The case these were
// written for is a second division (its own series) starting from the first
// division's teams, where season numbers repeat and the old "<id>_s<number>"
// naming found every id already taken and copied nothing.
import { describe, it, expect } from "vitest";
import { CloneError, teamIdBase, freeTeamId, cloneTeams, cloneRoster } from "./seasonClone.js";

// Team and Driver tables small enough to hold in arrays. Ids are unique across
// the whole table, as in the real database: a create with a taken id throws
// the way Prisma does (P2002), so a test cannot pass by overwriting a row.
function fakePrisma({ teams = [], drivers = [] } = {}) {
  const db = { teams: teams.map((t) => ({ ...t })), drivers: drivers.map((d) => ({ ...d })), raw: [] };
  const table = (rows) => ({
    findMany: async ({ where } = {}) => rows().filter((r) => !where?.seasonId || r.seasonId === where.seasonId),
    findUnique: async ({ where }) => rows().find((r) => r.id === where.id) || null,
    create: async ({ data }) => {
      if (rows().some((r) => r.id === data.id)) {
        const err = new Error(`Unique constraint failed on id ${data.id}`);
        err.code = "P2002";
        throw err;
      }
      rows().push({ ...data });
      return data;
    },
  });
  return {
    db,
    team: table(() => db.teams),
    driver: table(() => db.drivers),
    $executeRawUnsafe: async (sql, ...args) => {
      db.raw.push({ sql, args });
      const m = /UPDATE "Driver" SET "steamId" = \? WHERE "id" = \?/.exec(sql);
      if (m) {
        const row = db.drivers.find((d) => d.id === args[1]);
        if (row) row.steamId = args[0];
      }
      return 1;
    },
  };
}

const team = (id, name, seasonId, extra = {}) => ({
  id,
  name,
  seasonId,
  tier: 1,
  color: "#ff0000",
  logoUrl: `/teams/${id}.png`,
  ...extra,
});

const driver = (id, name, teamId, seasonId, extra = {}) => ({
  id,
  name,
  discordName: `${name.toLowerCase()}#1`,
  teamId,
  seasonId,
  tier: 1,
  isActive: true,
  country: "de",
  photoUrl: `/p/${id}.jpg`,
  discordAvatar: null,
  bio: "fast",
  number: 7,
  socials: null,
  ...extra,
});

// Div 1's Season 7, as the seed has it: plain ids.
const DIV1_S7 = [
  team("ferrari", "Ferrari", "d1s7", { color: "#dc0000" }),
  team("mclaren", "McLaren", "d1s7", { color: "#ff8700" }),
  team("reserve", "Reserve", "d1s7", { tier: 0, color: "#888888", logoUrl: null }),
];

// What the route hands in for the roster copy, recording what it was asked.
function helpers({ steamIds = {}, failLink = false } = {}) {
  const links = [];
  const freshIds = [];
  return {
    links,
    freshIds,
    attachSteamIds: async (rows) => {
      for (const d of rows) d.steamId = steamIds[d.id] ?? null;
      return rows;
    },
    linkDrivers: async (ids) => {
      if (failLink) throw new Error("person links unavailable");
      links.push(ids);
    },
    uniqueDriverId: async (name) => {
      const id = `${name.toLowerCase()}_fresh${freshIds.length + 1}`;
      freshIds.push(id);
      return id;
    },
  };
}

const idsOf = (rows, seasonId) =>
  rows
    .filter((r) => r.seasonId === seasonId)
    .map((r) => r.id)
    .sort();

describe("teamIdBase", () => {
  it("drops the season suffix", () => {
    expect(teamIdBase("ferrari_s7")).toBe("ferrari");
    expect(teamIdBase("red_bull_s12")).toBe("red_bull");
  });

  it("drops it whatever its case", () => {
    expect(teamIdBase("ferrari_S7")).toBe("ferrari");
  });

  it("leaves an id without a suffix alone", () => {
    expect(teamIdBase("ferrari")).toBe("ferrari");
    expect(teamIdBase("s7_ferrari")).toBe("s7_ferrari");
  });

  it("only takes the last suffix off", () => {
    // A team that already grew one too many keeps the rest: renaming old rows
    // is not this function's job.
    expect(teamIdBase("mclaren_s7_s8")).toBe("mclaren_s7");
  });

  it("does not mistake a counter for a season", () => {
    expect(teamIdBase("ferrari_s8_2")).toBe("ferrari_s8_2");
  });

  it("copes with a number id", () => {
    expect(teamIdBase(42)).toBe("42");
  });
});

describe("freeTeamId", () => {
  it("is the base plus the season when nobody holds it", async () => {
    expect(await freeTeamId(fakePrisma(), "ferrari", 8)).toBe("ferrari_s8");
  });

  it("swaps the old season for the new one", async () => {
    expect(await freeTeamId(fakePrisma(), "ferrari_s7", 8)).toBe("ferrari_s8");
  });

  it("counts up while the id is taken", async () => {
    const p = fakePrisma({ teams: [team("ferrari_s8", "Ferrari", "d1s8")] });
    expect(await freeTeamId(p, "ferrari", 8)).toBe("ferrari_s8_2");
  });

  it("keeps counting past every taken id", async () => {
    const p = fakePrisma({
      teams: [
        team("ferrari_s8", "Ferrari", "d1s8"),
        team("ferrari_s8_2", "Ferrari", "d2s8"),
        team("ferrari_s8_3", "Ferrari", "d3s8"),
      ],
    });
    expect(await freeTeamId(p, "ferrari_s7", 8)).toBe("ferrari_s8_4");
  });

  it("does not care about other seasons' numbers", async () => {
    const p = fakePrisma({ teams: [team("ferrari_s7", "Ferrari", "d1s7")] });
    expect(await freeTeamId(p, "ferrari", 8)).toBe("ferrari_s8");
  });
});

describe("cloneTeams", () => {
  it("copies every team of the source into the target", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    expect(await cloneTeams(p, { id: "d1s8", number: 8 }, "d1s7")).toEqual({ created: 3 });
    expect(idsOf(p.db.teams, "d1s8")).toEqual(["ferrari_s8", "mclaren_s8", "reserve_s8"]);
  });

  it("brings name, tier, colour and logo along", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    await cloneTeams(p, { id: "d1s8", number: 8 }, "d1s7");
    expect(p.db.teams.find((t) => t.id === "ferrari_s8")).toEqual({
      id: "ferrari_s8",
      name: "Ferrari",
      seasonId: "d1s8",
      tier: 1,
      color: "#dc0000",
      logoUrl: "/teams/ferrari.png",
    });
    // The reserve pool stays the reserve pool.
    expect(p.db.teams.find((t) => t.id === "reserve_s8")).toMatchObject({ tier: 0, logoUrl: null });
  });

  it("leaves the source season as it was", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    await cloneTeams(p, { id: "d1s8", number: 8 }, "d1s7");
    expect(p.db.teams.filter((t) => t.seasonId === "d1s7")).toEqual(DIV1_S7);
  });

  it("does not copy any drivers", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: [driver("ana", "Ana", "ferrari", "d1s7")] });
    await cloneTeams(p, { id: "d1s8", number: 8 }, "d1s7");
    expect(p.db.drivers).toHaveLength(1);
  });

  it("gives a second division's Season 8 all the teams, next to the first division's Season 8", async () => {
    // Div 1 rolled over first and holds ferrari_s8 and friends.
    const p = fakePrisma({ teams: DIV1_S7 });
    await cloneTeams(p, { id: "d1s8", number: 8 }, "d1s7");
    // Div 2's own Season 8 copies the same teams. The old naming found every
    // id taken and answered "Copied 0 team(s)".
    expect(await cloneTeams(p, { id: "d2s8", number: 8 }, "d1s7")).toEqual({ created: 3 });
    expect(idsOf(p.db.teams, "d2s8")).toEqual(["ferrari_s8_2", "mclaren_s8_2", "reserve_s8_2"]);
    // Div 1's rows are untouched and still Div 1's.
    expect(idsOf(p.db.teams, "d1s8")).toEqual(["ferrari_s8", "mclaren_s8", "reserve_s8"]);
  });

  it("also works copying from the first division's Season 8 itself", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    await cloneTeams(p, { id: "d1s8", number: 8 }, "d1s7");
    expect(await cloneTeams(p, { id: "d2s8", number: 8 }, "d1s8")).toEqual({ created: 3 });
    expect(idsOf(p.db.teams, "d2s8")).toEqual(["ferrari_s8_2", "mclaren_s8_2", "reserve_s8_2"]);
  });

  it("keeps a third division apart from both", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    await cloneTeams(p, { id: "d1s8", number: 8 }, "d1s7");
    await cloneTeams(p, { id: "d2s8", number: 8 }, "d1s7");
    await cloneTeams(p, { id: "d3s8", number: 8 }, "d1s7");
    expect(idsOf(p.db.teams, "d3s8")).toEqual(["ferrari_s8_3", "mclaren_s8_3", "reserve_s8_3"]);
    expect(p.db.teams).toHaveLength(12);
  });

  it("can start a division at Season 1", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    await cloneTeams(p, { id: "d2s1", number: 1 }, "d1s7");
    expect(idsOf(p.db.teams, "d2s1")).toEqual(["ferrari_s1", "mclaren_s1", "reserve_s1"]);
  });

  it("does not let suffixes pile up season after season", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    await cloneTeams(p, { id: "d1s8", number: 8 }, "d1s7");
    await cloneTeams(p, { id: "d1s9", number: 9 }, "d1s8");
    expect(idsOf(p.db.teams, "d1s9")).toEqual(["ferrari_s9", "mclaren_s9", "reserve_s9"]);
  });

  it("copies nothing twice when run again", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    await cloneTeams(p, { id: "d2s8", number: 8 }, "d1s7");
    expect(await cloneTeams(p, { id: "d2s8", number: 8 }, "d1s7")).toEqual({ created: 0 });
    expect(p.db.teams.filter((t) => t.seasonId === "d2s8")).toHaveLength(3);
  });

  it("only adds what the target is missing", async () => {
    // McLaren was put in by hand already, under an id of the admin's own.
    const p = fakePrisma({ teams: [...DIV1_S7, team("macca", "McLaren", "d2s8")] });
    expect(await cloneTeams(p, { id: "d2s8", number: 8 }, "d1s7")).toEqual({ created: 2 });
    expect(idsOf(p.db.teams, "d2s8")).toEqual(["ferrari_s8", "macca", "reserve_s8"]);
  });

  it("copies two source teams of the same name only once", async () => {
    const p = fakePrisma({ teams: [...DIV1_S7, team("ferrari_b", "Ferrari", "d1s7")] });
    expect(await cloneTeams(p, { id: "d2s8", number: 8 }, "d1s7")).toEqual({ created: 3 });
  });

  it("refuses without a source season", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    await expect(cloneTeams(p, { id: "d2s8", number: 8 }, "")).rejects.toThrow("fromSeasonId required");
    await expect(cloneTeams(p, { id: "d2s8", number: 8 }, undefined)).rejects.toBeInstanceOf(CloneError);
  });

  it("refuses to copy a season into itself", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    await expect(cloneTeams(p, { id: "d1s7", number: 7 }, "d1s7")).rejects.toThrow(
      "Source and target season are the same"
    );
    expect(p.db.teams).toHaveLength(3);
  });

  it("refuses a source with no teams", async () => {
    const err = await cloneTeams(fakePrisma(), { id: "d2s8", number: 8 }, "empty").catch((e) => e);
    expect(err).toBeInstanceOf(CloneError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("Source season has no teams");
  });
});

describe("cloneRoster", () => {
  const DIV1_DRIVERS = [
    driver("ana", "Ana", "ferrari", "d1s7", { discordUserId: "111" }),
    driver("ben", "Ben", "mclaren", "d1s7"),
    driver("cat", "Cat", "reserve", "d1s7", { tier: 0, isActive: false }),
  ];

  it("copies the teams and puts each driver in their team's copy", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    const h = helpers();
    expect(await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", h)).toEqual({ teamsCreated: 3, driversCreated: 3 });
    const byName = Object.fromEntries(p.db.drivers.filter((d) => d.seasonId === "d1s8").map((d) => [d.name, d]));
    expect(byName.Ana.teamId).toBe("ferrari_s8");
    expect(byName.Ben.teamId).toBe("mclaren_s8");
    expect(byName.Cat.teamId).toBe("reserve_s8");
  });

  it("names the driver rows after the season", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers());
    expect(idsOf(p.db.drivers, "d1s8")).toEqual(["ana_s8", "ben_s8", "cat_s8"]);
  });

  it("carries who the driver is, not their Discord login", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers());
    const ana = p.db.drivers.find((d) => d.id === "ana_s8");
    expect(ana).toMatchObject({
      name: "Ana",
      discordName: "ana#1",
      tier: 1,
      isActive: true,
      country: "de",
      photoUrl: "/p/ana.jpg",
      bio: "fast",
      number: 7,
      seasonId: "d1s8",
    });
    // The Discord id is unique site-wide; the person link is what reaches the new row.
    expect(ana.discordUserId).toBeUndefined();
  });

  it("keeps a driver's tier and active flag as they were", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers());
    expect(p.db.drivers.find((d) => d.id === "cat_s8")).toMatchObject({ tier: 0, isActive: false });
  });

  it("links every copied row to the row it came from", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    const h = helpers();
    await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", h);
    expect(h.links).toEqual([
      ["ana", "ana_s8"],
      ["ben", "ben_s8"],
      ["cat", "cat_s8"],
    ]);
  });

  it("brings the Steam id along for the drivers who have one", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers({ steamIds: { ana: "7656119" } }));
    expect(p.db.drivers.find((d) => d.id === "ana_s8").steamId).toBe("7656119");
    expect(p.db.drivers.find((d) => d.id === "ben_s8").steamId).toBeUndefined();
    // One write, for the one driver with an id.
    expect(p.db.raw).toHaveLength(1);
  });

  it("still copies the driver when the person link cannot be written", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    expect(await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers({ failLink: true }))).toEqual({
      teamsCreated: 3,
      driversCreated: 3,
    });
  });

  it("also copes with a link helper that answers without a promise", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    const h = { ...helpers(), linkDrivers: () => undefined };
    expect((await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", h)).driversCreated).toBe(3);
  });

  it("gives a driver whose id another season holds a fresh one instead of leaving them out", async () => {
    // ana_s8 already exists in another series' Season 8 (a different person,
    // or the same one racing there too).
    const p = fakePrisma({
      teams: [...DIV1_S7, team("ferrari_s8", "Ferrari", "d2s8")],
      drivers: [...DIV1_DRIVERS, driver("ana_s8", "Ana", "ferrari_s8", "d2s8")],
    });
    const h = helpers();
    expect(await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", h)).toEqual({ teamsCreated: 3, driversCreated: 3 });
    expect(h.freshIds).toEqual(["ana_fresh1"]);
    expect(p.db.drivers.find((d) => d.id === "ana_fresh1")).toMatchObject({ seasonId: "d1s8", name: "Ana" });
    expect(h.links).toContainEqual(["ana", "ana_fresh1"]);
    // The other season's row is still where it was.
    expect(p.db.drivers.find((d) => d.id === "ana_s8").seasonId).toBe("d2s8");
  });

  it("does not copy a driver who got a fresh id a second time when run again", async () => {
    // Div 1's Season 8 holds ana_s8 / ben_s8 / cat_s8, so a Div 2 Season 8
    // copied from the same season gives every driver a fresh id. A second run
    // asks for ana_s8 again, finds it in Div 1 again, and must still see that
    // Ana is already on Div 2's roster.
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers());
    const h = helpers();
    expect(await cloneRoster(p, { id: "d2s8", number: 8 }, "d1s7", h)).toEqual({ teamsCreated: 3, driversCreated: 3 });
    expect(await cloneRoster(p, { id: "d2s8", number: 8 }, "d1s7", h)).toEqual({ teamsCreated: 0, driversCreated: 0 });
    expect(p.db.drivers.filter((d) => d.seasonId === "d2s8")).toHaveLength(3);
    expect(h.freshIds).toHaveLength(3);
  });

  it("leaves a driver already put on the target's roster by hand where they are", async () => {
    const p = fakePrisma({
      teams: [...DIV1_S7, team("ferrari_s8", "Ferrari", "d1s8")],
      drivers: [...DIV1_DRIVERS, driver("ana_new", "Ana", "ferrari_s8", "d1s8")],
    });
    expect((await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers())).driversCreated).toBe(2);
    expect(p.db.drivers.filter((d) => d.seasonId === "d1s8" && d.name === "Ana").map((d) => d.id)).toEqual([
      "ana_new",
    ]);
  });

  it("places drivers in the team copies even when those got a counter", async () => {
    const p = fakePrisma({ teams: [...DIV1_S7, team("ferrari_s8", "Ferrari", "d2s8")], drivers: DIV1_DRIVERS });
    await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers());
    expect(p.db.drivers.find((d) => d.id === "ana_s8").teamId).toBe("ferrari_s8_2");
    expect(p.db.teams.find((t) => t.id === "ferrari_s8_2").seasonId).toBe("d1s8");
  });

  it("puts drivers in the target's own team when it already has one of that name", async () => {
    const p = fakePrisma({ teams: [...DIV1_S7, team("scuderia", "Ferrari", "d1s8")], drivers: DIV1_DRIVERS });
    expect(await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers())).toEqual({
      teamsCreated: 2,
      driversCreated: 3,
    });
    expect(p.db.drivers.find((d) => d.id === "ana_s8").teamId).toBe("scuderia");
  });

  it("copies nothing twice when run again", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    const h = helpers();
    await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", h);
    expect(await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", h)).toEqual({ teamsCreated: 0, driversCreated: 0 });
    expect(p.db.teams.filter((t) => t.seasonId === "d1s8")).toHaveLength(3);
    expect(p.db.drivers.filter((d) => d.seasonId === "d1s8")).toHaveLength(3);
    expect(h.freshIds).toEqual([]);
  });

  it("leaves out a driver whose team is not in the source season", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: [...DIV1_DRIVERS, driver("ghost", "Ghost", "gone", "d1s7")] });
    expect((await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers())).driversCreated).toBe(3);
    expect(p.db.drivers.some((d) => d.name === "Ghost" && d.seasonId === "d1s8")).toBe(false);
  });

  it("copies the teams of a season that has no drivers yet", async () => {
    const p = fakePrisma({ teams: DIV1_S7 });
    expect(await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers())).toEqual({
      teamsCreated: 3,
      driversCreated: 0,
    });
  });

  it("leaves the source season's drivers as they were", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    await cloneRoster(p, { id: "d1s8", number: 8 }, "d1s7", helpers({ steamIds: { ana: "7656119" } }));
    expect(p.db.drivers.filter((d) => d.seasonId === "d1s7").map((d) => [d.id, d.teamId])).toEqual([
      ["ana", "ferrari"],
      ["ben", "mclaren"],
      ["cat", "reserve"],
    ]);
  });

  it("refuses the same things the team copy refuses", async () => {
    const p = fakePrisma({ teams: DIV1_S7, drivers: DIV1_DRIVERS });
    await expect(cloneRoster(p, { id: "d1s8", number: 8 }, null, helpers())).rejects.toThrow("fromSeasonId required");
    await expect(cloneRoster(p, { id: "d1s7", number: 7 }, "d1s7", helpers())).rejects.toThrow(
      "Source and target season are the same"
    );
    await expect(cloneRoster(fakePrisma(), { id: "d1s8", number: 8 }, "d1s7", helpers())).rejects.toThrow(
      "Source season has no teams"
    );
    expect(p.db.teams).toHaveLength(3);
    expect(p.db.drivers).toHaveLength(3);
  });
});

describe("CloneError", () => {
  it("is a 400 unless told otherwise", () => {
    expect(new CloneError("nope").status).toBe(400);
    expect(new CloneError("gone", 404).status).toBe(404);
    expect(new CloneError("nope")).toBeInstanceOf(Error);
  });
});
