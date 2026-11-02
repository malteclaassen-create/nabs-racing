import { describe, it, expect, vi, beforeEach } from "vitest";

// Everything around the newcomer rules is stood in for: the account table,
// the Reserve pool, the person links, the waiting list, Discord and the
// notifications. What is left is the part this file decides.
const accounts = new Map();
vi.mock("./members.js", () => ({
  dbGetMember: vi.fn(async (_p, id) => accounts.get(String(id)) || null),
  dbClearRaceRequest: vi.fn(async () => {}),
  applyMemberSteamId: vi.fn(async () => ({ written: false })),
  isUncheckedNewcomer: vi.fn(async () => false),
}));
vi.mock("./reservePool.js", () => ({
  ensureReservePool: vi.fn(async (_p, seasonId) => (seasonId ? { id: `pool_${seasonId}`, seasonId, tier: 0 } : null)),
}));
const links = new Map();
vi.mock("./persons.js", () => ({
  getLinkedDriverIds: vi.fn(async (_p, id) => links.get(id) || [id]),
  // Person groups from the same `links` map: every id listed under a key is
  // one person, keyed by the first id.
  getPersonGroups: vi.fn(async () => {
    const byDriver = new Map();
    const byPerson = new Map();
    for (const ids of links.values()) {
      const key = `p:${ids[0]}`;
      byPerson.set(key, ids);
      for (const id of ids) byDriver.set(id, key);
    }
    return { byDriver, byPerson };
  }),
  dbLinkDrivers: vi.fn(async () => "p"),
  dbMergeDuplicateAnswers: vi.fn(async () => 0),
}));
vi.mock("../services/driverMerge.js", () => ({ mergeDrivers: vi.fn(async () => ({ merged: true })) }));
vi.mock("./waitlist.js", () => ({ promoteFromWaitlist: vi.fn(async () => []) }));
vi.mock("../services/discordService.js", () => ({ syncRaceToDiscord: vi.fn(async () => ({ ok: true })) }));
vi.mock("./notifications.js", () => ({
  notifyAdminsNewDriver: vi.fn(async () => {}),
  notifyTurnedAway: vi.fn(async () => {}),
  notifyAdminsRecognised: vi.fn(async () => {}),
}));

const {
  joinBlock, pickNewcomerName, joinAsNewcomer, turnAwayNewcomer, newcomerRows,
  recogniseBySteam, similarNames, discordCreatedAt,
} = await import("./newcomers.js");
const { mergeDrivers } = await import("../services/driverMerge.js");
const { promoteFromWaitlist } = await import("./waitlist.js");
const { syncRaceToDiscord } = await import("../services/discordService.js");
const { notifyAdminsNewDriver, notifyTurnedAway } = await import("./notifications.js");

// The tables the newcomer code touches, in memory. Raw SQL writes to the
// account row are applied by reading the column names out of the statement.
function db({ drivers = [], rsvps = [], offers = [] } = {}) {
  const state = { drivers: [...drivers], rsvps: [...rsvps], offers: [...offers], raw: [] };
  const byWhere = (d, where) =>
    (!where.id || (typeof where.id === "string" ? d.id === where.id : where.id.in.includes(d.id))) &&
    (where.discordUserId === undefined || d.discordUserId === where.discordUserId);
  const prisma = {
    state,
    $executeRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      state.raw.push({ sql, values });
      const id = values[values.length - 1];
      const acc = accounts.get(String(id));
      if (acc && /UPDATE "MemberAccount"/.test(sql)) {
        const cols = [...sql.matchAll(/"(\w+)" = (\?|NULL)/g)].map((m) => [m[1], m[2]]);
        let v = 0;
        for (const [col, kind] of cols) {
          if (col === "discordId") continue;
          acc[col] = kind === "NULL" ? null : values[v++];
        }
      }
      return 1;
    },
    $transaction: async (ops) => {
      for (const op of ops) await op;
    },
    // The raw reads in recogniseBySteam: who carries a Steam id, and the
    // Steam ids on a set of rows.
    $queryRawUnsafe: async (sql, ...args) =>
      /"steamId" = \?/.test(sql)
        ? state.drivers.filter((d) => d.steamId === args[0]).map((d) => ({ id: d.id }))
        : state.drivers.filter((d) => args.includes(d.id)).map((d) => ({ id: d.id, steamId: d.steamId ?? null })),
    // Every login that has signed in (loginIds).
    $queryRaw: async () => [...accounts.keys()].map((discordId) => ({ discordId })),
    $executeRawUnsafe: async (sql, ...args) => {
      state.raw.push({ sql, values: args });
      return 1;
    },
    driver: {
      findUnique: async ({ where }) => state.drivers.find((d) => byWhere(d, where)) || null,
      findMany: async ({ where = {}, include } = {}) =>
        state.drivers
          .filter((d) => byWhere(d, where))
          .map((d) =>
            include
              ? {
                  ...d,
                  team: { name: "Reserve", tier: 0 },
                  season: { name: `Season ${d.seasonId}` },
                  _count: { results: d.results || 0 },
                }
              : d
          ),
      create: async ({ data }) => {
        if (state.drivers.some((d) => d.id === data.id || (data.discordUserId && d.discordUserId === data.discordUserId))) {
          const err = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        const row = { createdAt: new Date(), ...data };
        state.drivers.push(row);
        return row;
      },
      delete: ({ where }) => {
        state.drivers = state.drivers.filter((d) => d.id !== where.id);
        return Promise.resolve();
      },
      update: async ({ where, data }) => {
        const row = state.drivers.find((d) => d.id === where.id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const ids = typeof where.id === "string" ? [where.id] : where.id.in;
        let count = 0;
        for (const row of state.drivers.filter((d) => ids.includes(d.id))) {
          if (where.OR && !where.OR.some((c) => (c.discordUserId === null ? !row.discordUserId : !c.discordUserId.notIn.includes(row.discordUserId)))) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
    },
    raceRsvp: {
      findMany: async ({ where }) =>
        state.rsvps
          .filter((r) => where.driverId.in.includes(r.driverId))
          .map((r) => ({ ...r, race: r.race })),
      deleteMany: ({ where }) => {
        state.rsvps = state.rsvps.filter((r) => r.driverId !== where.driverId);
        return Promise.resolve();
      },
    },
    seatInterest: { deleteMany: () => Promise.resolve() },
    seatOffer: {
      findMany: async ({ where }) => state.offers.filter((o) => where.filledById.in.includes(o.filledById)),
      deleteMany: () => Promise.resolve(),
      updateMany: () => Promise.resolve(),
    },
  };
  return prisma;
}

const account = (over = {}) => ({
  discordId: "111",
  username: "newkid",
  displayName: "New Kid",
  avatarUrl: "https://cdn.example/a.png",
  banned: 0,
  mainDiscordId: null,
  turnedAwayAt: null,
  newDriverAt: null,
  ...over,
});

beforeEach(() => {
  accounts.clear();
  links.clear();
  vi.clearAllMocks();
});

describe("joinBlock", () => {
  it("lets an ordinary account sign itself up", () => {
    expect(joinBlock(account())).toBe(null);
  });
  it("says why everybody else may not", () => {
    expect(joinBlock(null)).toBe("no-account");
    expect(joinBlock(account({ banned: 1 }))).toBe("banned");
    expect(joinBlock(account({ mainDiscordId: "999" }))).toBe("second-account");
    expect(joinBlock(account({ turnedAwayAt: "2026-11-01T10:00:00.000Z" }))).toBe("turned-away");
  });
});

describe("pickNewcomerName", () => {
  it("uses the Discord display name when nobody goes by it", () => {
    expect(pickNewcomerName(account(), ["Somebody Else"])).toBe("New Kid");
  });
  it("never repeats a name already on a roster, however it is written", () => {
    expect(pickNewcomerName(account({ displayName: "Max Power", username: "maxp" }), ["max power"])).toBe("maxp");
    expect(pickNewcomerName(account(), ["NEW-KID"])).toBe("New Kid 2");
    expect(pickNewcomerName(account(), ["NEW-KID", "New Kid 2"])).toBe("New Kid 3");
  });
  it("falls back to the username, and to a plain name when there is nothing usable", () => {
    expect(pickNewcomerName(account({ displayName: null }), [])).toBe("newkid");
    expect(pickNewcomerName(account({ displayName: "!!!", username: "" }), [])).toBe("New driver");
  });
});

describe("joinAsNewcomer", () => {
  it("makes a reserve of their own, linked to the login, and marks the account as new", async () => {
    accounts.set("111", account());
    const prisma = db({ drivers: [{ id: "max", name: "Max", seasonId: "s7", discordUserId: "222" }] });
    const out = await joinAsNewcomer(prisma, { discordId: "111", seasonId: "s7", race: { number: 9, track: "Monza" } });

    expect(out.created).toBe(true);
    expect(out.driver).toMatchObject({
      id: "new_kid",
      name: "New Kid",
      discordName: "newkid",
      teamId: "pool_s7",
      tier: 0,
      seasonId: "s7",
      discordUserId: "111",
      isActive: true,
    });
    expect(accounts.get("111").newDriverAt).toBeTruthy();
    expect(notifyAdminsNewDriver).toHaveBeenCalledTimes(1);
  });

  it("hands back the driver they already have instead of making a second", async () => {
    accounts.set("111", account());
    const prisma = db({ drivers: [{ id: "new_kid", name: "New Kid", seasonId: "s7", discordUserId: "111" }] });
    const out = await joinAsNewcomer(prisma, { discordId: "111", seasonId: "s7" });
    expect(out).toEqual({ driver: expect.objectContaining({ id: "new_kid" }), created: false });
    expect(prisma.state.drivers).toHaveLength(1);
    expect(notifyAdminsNewDriver).not.toHaveBeenCalled();
  });

  it("does not sign up an account the admins turned away", async () => {
    accounts.set("111", account({ turnedAwayAt: "2026-11-01T10:00:00.000Z" }));
    const prisma = db();
    expect(await joinAsNewcomer(prisma, { discordId: "111", seasonId: "s7" })).toEqual({ error: "turned-away" });
    expect(prisma.state.drivers).toHaveLength(0);
  });

  it("takes the row a second answer at the same moment made, rather than failing", async () => {
    accounts.set("111", account());
    const prisma = db();
    // The other request's row lands between this one's look and its create.
    const create = prisma.driver.create;
    prisma.driver.create = async (args) => {
      prisma.state.drivers.push({ id: "new_kid", name: "New Kid", seasonId: "s7", discordUserId: "111" });
      return create(args);
    };
    const out = await joinAsNewcomer(prisma, { discordId: "111", seasonId: "s7" });
    expect(out.created).toBe(false);
    expect(out.driver.id).toBe("new_kid");
  });
});

describe("newcomerRows", () => {
  it("counts the rows made after the account was marked, never an older linked one", async () => {
    const marked = new Date("2026-11-02T12:00:00.000Z");
    links.set("new_kid", ["new_kid", "new_kid_s3", "old_row"]);
    const prisma = db({
      drivers: [
        { id: "new_kid", discordUserId: "111", seasonId: "s7", createdAt: new Date(marked.getTime() - 1000) },
        { id: "new_kid_s3", discordUserId: null, seasonId: "gt3", createdAt: new Date(marked.getTime() + 86_400_000) },
        { id: "old_row", discordUserId: null, seasonId: "s5", createdAt: new Date("2025-01-01T00:00:00.000Z") },
      ],
    });
    const rows = await newcomerRows(prisma, account({ newDriverAt: marked.toISOString() }));
    expect(rows.map((r) => r.id).sort()).toEqual(["new_kid", "new_kid_s3"]);
  });
});

describe("turnAwayNewcomer", () => {
  const monza = { id: "r9", number: 9, track: "Monza", seasonId: "s7", isCompleted: false };
  const spa = { id: "r10", number: 10, track: "Spa", seasonId: "s7", isCompleted: false };
  const done = { id: "r8", number: 8, track: "Imola", seasonId: "s7", isCompleted: true };

  function newcomer() {
    const at = new Date("2026-11-02T12:00:00.000Z");
    accounts.set("111", account({ newDriverAt: at.toISOString() }));
    return db({
      drivers: [
        { id: "new_kid", name: "New Kid", discordUserId: "111", seasonId: "s7", createdAt: at },
        { id: "max", name: "Max", discordUserId: "222", seasonId: "s7", createdAt: new Date("2025-01-01") },
      ],
      rsvps: [
        { raceId: "r9", driverId: "new_kid", status: "ACCEPTED", race: monza },
        { raceId: "r10", driverId: "new_kid", status: "TENTATIVE", race: spa },
        { raceId: "r8", driverId: "new_kid", status: "ACCEPTED", race: done },
        { raceId: "r9", driverId: "max", status: "ACCEPTED", race: monza },
      ],
    });
  }

  it("removes their driver and answers, frees the seat, redoes the posts and tells them", async () => {
    const prisma = newcomer();
    const out = await turnAwayNewcomer(prisma, "111");
    // The turn-away is on the account before any row goes, so a sign-up
    // arriving in between is refused rather than making a new row.
    const marked = prisma.state.raw.findIndex((r) => /"turnedAwayAt" = \?/.test(r.sql));
    const deleted = prisma.state.raw.findIndex((r) => /DELETE FROM "PersonLink"/.test(r.sql));
    expect(marked).toBeGreaterThanOrEqual(0);
    expect(marked).toBeLessThan(deleted);

    expect(out).toEqual({ removed: [{ id: "new_kid", name: "New Kid" }], answers: 2 });
    expect(prisma.state.drivers.map((d) => d.id)).toEqual(["max"]);
    expect(prisma.state.rsvps).toEqual([expect.objectContaining({ driverId: "max" })]);
    // Only the seat they actually held is handed on; a finished race is left alone.
    expect(promoteFromWaitlist.mock.calls.map((c) => c[1])).toEqual(["r9"]);
    expect(syncRaceToDiscord.mock.calls.map((c) => c[1]).sort()).toEqual(["r10", "r9"]);
    expect(notifyTurnedAway).toHaveBeenCalledWith(prisma, { discordId: "111", races: [monza, spa] });

    const acc = accounts.get("111");
    expect(acc.newDriverAt).toBe(null);
    expect(acc.turnedAwayAt).toBeTruthy();
    // And the site will not sign them up by itself again.
    expect(joinBlock(acc)).toBe("turned-away");
  });

  it("only works on a newcomer nobody has kept", async () => {
    accounts.set("111", account());
    await expect(turnAwayNewcomer(db(), "111")).rejects.toMatchObject({ status: 409 });
    await expect(turnAwayNewcomer(db(), "404")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses once they have race results, and deletes nothing", async () => {
    const prisma = newcomer();
    prisma.state.drivers[0].results = 1;
    await expect(turnAwayNewcomer(prisma, "111")).rejects.toMatchObject({ status: 409 });
    expect(prisma.state.drivers).toHaveLength(2);
    expect(prisma.state.rsvps).toHaveLength(4);
  });
});

describe("similarNames", () => {
  it("catches the same name written another way, and near misses in longer names", () => {
    expect(similarNames("Malte Goat", "maltegoat")).toBe(true);
    expect(similarNames("maltegoat86", "Maltegoat")).toBe(true);
    expect(similarNames("Verstapen", "Verstappen")).toBe(true);
  });
  it("leaves short and different names alone", () => {
    expect(similarNames("Max", "Maxwell")).toBe(false);
    expect(similarNames("Leclerc", "Sainz")).toBe(false);
    expect(similarNames("Alonso", "Alon")).toBe(false);
  });
});

describe("discordCreatedAt", () => {
  it("reads the creation time out of a Discord id", () => {
    // Discord's own documentation example: 175928847299117063 = 2016-04-30.
    expect(discordCreatedAt("175928847299117063").toISOString().slice(0, 10)).toBe("2016-04-30");
    expect(discordCreatedAt("not an id")).toBe(null);
  });
});

describe("recogniseBySteam", () => {
  const steam = "76561198000000001";

  it("puts a returning driver's login on their old entry, without a new row", async () => {
    accounts.set("111", account({ steamId: steam }));
    links.set("max_s6", ["max_s6", "max_s7"]);
    const prisma = db({
      drivers: [
        { id: "max_s6", name: "Max", seasonId: "s6", steamId: steam, discordUserId: null },
        { id: "max_s7", name: "Max", seasonId: "s7", steamId: null, discordUserId: null },
      ],
    });
    // The newest season counts as the running one here.
    prisma.driver.findMany = ((orig) => async (args) =>
      (await orig(args)).map((d) => ({ ...d, season: { number: Number(d.seasonId.slice(1)), isActive: d.seasonId === "s7", name: d.seasonId } })))(prisma.driver.findMany);

    const out = await recogniseBySteam(prisma, "111");
    expect(out.recognised).toMatchObject({ id: "max_s7", name: "Max" });
    expect(prisma.state.drivers.find((d) => d.id === "max_s7").discordUserId).toBe("111");
    expect(prisma.state.drivers).toHaveLength(2);
  });

  it("joining with a proved Steam account finds the old entry instead of making one", async () => {
    accounts.set("111", account({ steamId: steam }));
    const prisma = db({ drivers: [{ id: "max_s7", name: "Max", seasonId: "s7", steamId: steam, discordUserId: null }] });
    const out = await joinAsNewcomer(prisma, { discordId: "111", seasonId: "s7" });
    expect(out).toMatchObject({ created: false, recognised: { id: "max_s7" } });
    expect(prisma.state.drivers).toHaveLength(1);
    expect(accounts.get("111").newDriverAt ?? null).toBe(null);
  });

  it("folds the row the site already made into the old entry of the same season", async () => {
    const at = new Date("2026-11-02T12:00:00.000Z");
    accounts.set("111", account({ steamId: steam, newDriverAt: at.toISOString() }));
    const prisma = db({
      drivers: [
        { id: "new_kid", name: "New Kid", seasonId: "s7", steamId: steam, discordUserId: "111", createdAt: at },
        { id: "max_s7", name: "Max", seasonId: "s7", steamId: steam, discordUserId: null, createdAt: new Date("2025-01-01") },
      ],
    });
    await recogniseBySteam(prisma, "111");
    // The newer of two answers to one race wins before the rows are merged.
    const { dbMergeDuplicateAnswers } = await import("./persons.js");
    expect(dbMergeDuplicateAnswers).toHaveBeenCalledWith(prisma, ["max_s7", "new_kid"]);
    expect(mergeDrivers).toHaveBeenCalledWith(prisma, { keepId: "max_s7", dropId: "new_kid" });
    expect(accounts.get("111").newDriverAt).toBe(null);
  });

  it("does not move an entry another login already holds", async () => {
    accounts.set("111", account({ steamId: steam }));
    accounts.set("999", account({ discordId: "999", username: "max" }));
    const prisma = db({ drivers: [{ id: "max_s7", name: "Max", seasonId: "s7", steamId: steam, discordUserId: "999" }] });
    const out = await recogniseBySteam(prisma, "111");
    expect(out.conflict).toBe("claimed");
    expect(prisma.state.drivers[0].discordUserId).toBe("999");
  });

  it("replaces a Discord id an admin typed in that nobody signs in with", async () => {
    accounts.set("111", account({ steamId: steam }));
    const prisma = db({ drivers: [{ id: "max_s7", name: "Max", seasonId: "s7", steamId: steam, discordUserId: "123456789012345678" }] });
    const out = await recogniseBySteam(prisma, "111");
    expect(out.recognised?.id).toBe("max_s7");
    expect(prisma.state.drivers[0].discordUserId).toBe("111");
  });

  it("leaves a person with two Steam accounts on their rows to an admin", async () => {
    accounts.set("111", account({ steamId: steam }));
    links.set("max_s6", ["max_s6", "max_s7"]);
    const prisma = db({
      drivers: [
        { id: "max_s6", name: "Max", seasonId: "s6", steamId: steam, discordUserId: null },
        { id: "max_s7", name: "Max", seasonId: "s7", steamId: "76561198000000999", discordUserId: null },
      ],
    });
    const out = await recogniseBySteam(prisma, "111");
    expect(out.conflict).toBe("mixed");
    expect(prisma.state.drivers.every((d) => !d.discordUserId)).toBe(true);
  });

  it("never undoes an admin taking the login off its driver by hand", async () => {
    accounts.set("111", account({ steamId: steam, manualLinkAt: "2026-11-01T00:00:00.000Z" }));
    const prisma = db({ drivers: [{ id: "max_s7", name: "Max", seasonId: "s7", steamId: steam, discordUserId: null }] });
    expect(await recogniseBySteam(prisma, "111")).toBe(null);
    expect(prisma.state.drivers[0].discordUserId).toBe(null);
    expect(joinBlock(accounts.get("111"))).toBe("admin-hold");
  });

  it("does not pick between two different people with the same Steam id", async () => {
    accounts.set("111", account({ steamId: steam }));
    const prisma = db({
      drivers: [
        { id: "a", name: "A", seasonId: "s6", steamId: steam, discordUserId: null },
        { id: "b", name: "B", seasonId: "s7", steamId: steam, discordUserId: null },
      ],
    });
    expect((await recogniseBySteam(prisma, "111")).conflict).toBe("several");
  });

  it("does nothing without a proved Steam account, or for somebody turned away", async () => {
    const prisma = db({ drivers: [{ id: "max_s7", name: "Max", seasonId: "s7", steamId: steam, discordUserId: null }] });
    accounts.set("111", account());
    expect(await recogniseBySteam(prisma, "111")).toBe(null);
    accounts.set("111", account({ steamId: steam, turnedAwayAt: "2026-11-01T00:00:00.000Z" }));
    expect(await recogniseBySteam(prisma, "111")).toBe(null);
    expect(prisma.state.drivers[0].discordUserId).toBe(null);
  });
});
