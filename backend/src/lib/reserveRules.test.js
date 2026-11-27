import { describe, it, expect } from "vitest";
import {
  readReserveRules, writeReserveRule, validCoverIds, driversOut, division1Block, seatBlock,
  applyNewDriverRule, writeNewDriverRule, readNewDriverRule, carryReserveRule,
} from "./reserveRules.js";

// Season s9 runs Division 2. Guest and Mitch are reserves, 13bot and Siggsta
// drive for a Division 1 team, Dee for a Division 2 team.
function db({ division2 = true } = {}) {
  const state = {
    drivers: {
      guest: { id: "guest", name: "Guest", seasonId: "s9", tier: 0, team: { tier: 0 } },
      mitch: { id: "mitch", name: "Mitch", seasonId: "s9", tier: 0, team: { tier: 0 } },
      bot: { id: "bot", name: "13bot", seasonId: "s9", tier: 2, team: { tier: 2 } },
      sigg: { id: "sigg", name: "Siggsta", seasonId: "s9", tier: 2, team: { tier: 2 } },
      dee: { id: "dee", name: "Dee", seasonId: "s9", tier: 3, team: { tier: 3 } },
      old: { id: "old", name: "Old", seasonId: "s8", tier: 1, team: { tier: 1 } },
      guest10: { id: "guest10", name: "Guest", seasonId: "s10", tier: 0, team: { tier: 0 } },
      bot10: { id: "bot10", name: "13bot", seasonId: "s10", tier: 2, team: { tier: 2 } },
    },
    rules: {},
    rsvps: [],
    offers: [],
    settings: {},
    links: [
      { driverId: "guest", personId: "p-guest" }, { driverId: "guest10", personId: "p-guest" },
      { driverId: "bot", personId: "p-bot" }, { driverId: "bot10", personId: "p-bot" },
    ],
  };
  const inList = (where, key, value) => !where[key] || where[key].in.includes(value);
  return {
    state,
    $queryRawUnsafe: async (q, ...args) => {
      if (q.includes('"division2" FROM "Season"')) return [{ division2: division2 ? 1 : 0 }];
      if (q.includes('"div1Rule"')) {
        return args.filter((id) => state.rules[id]?.div1Rule || state.rules[id]?.noSubIn).map((id) => ({ id, ...state.rules[id] }));
      }
      return [];
    },
    $queryRaw: async () => state.links,
    $executeRawUnsafe: async (q, div1Rule, div1Cover, noSubIn, id) => {
      state.rules[id] = { div1Rule, div1Cover, noSubIn };
    },
    driver: {
      findMany: async ({ where }) =>
        Object.values(state.drivers).filter((d) => inList(where, "id", d.id) && (!where.seasonId || d.seasonId === where.seasonId)),
    },
    raceRsvp: {
      findMany: async ({ where }) =>
        state.rsvps.filter((r) => r.raceId === where.raceId && r.status === where.status && inList(where, "driverId", r.driverId)),
    },
    seatOffer: {
      findMany: async ({ where }) =>
        state.offers.filter((o) => o.raceId === where.raceId && o.status !== where.status.not && inList(where, "driverId", o.driverId)),
    },
    setting: {
      findUnique: async ({ where }) => (state.settings[where.key] ? { value: state.settings[where.key] } : null),
      upsert: async ({ where, create }) => {
        state.settings[where.key] = create.value;
      },
    },
  };
}

const race = { id: "r5", seasonId: "s9", isSpecialEvent: false };
const d1Seat = { tier: 2 };
const d2Seat = { tier: 3 };

describe("a reserve's rule", () => {
  it("is nothing until an admin sets one", async () => {
    const prisma = db();
    expect((await readReserveRules(prisma, ["guest"])).size).toBe(0);
    expect(await division1Block(prisma, race, prisma.state.drivers.guest)).toBeNull();
    expect(await seatBlock(prisma, race, d1Seat, prisma.state.drivers.guest)).toBeNull();
  });

  it("writes only what was sent, and drops the list with any rule but cover", async () => {
    const prisma = db();
    await writeReserveRule(prisma, "guest", { div1: "cover", cover: ["bot", "sigg", "bot"] });
    expect((await readReserveRules(prisma, ["guest"])).get("guest")).toEqual({ div1: "cover", cover: ["bot", "sigg"], noSubIn: false });
    await writeReserveRule(prisma, "guest", { noSubIn: true });
    expect((await readReserveRules(prisma, ["guest"])).get("guest")).toEqual({ div1: "cover", cover: ["bot", "sigg"], noSubIn: true });
    await writeReserveRule(prisma, "guest", { div1: "never" });
    expect((await readReserveRules(prisma, ["guest"])).get("guest")).toEqual({ div1: "never", cover: [], noSubIn: true });
    await writeReserveRule(prisma, "guest", { div1: "", noSubIn: false });
    expect((await readReserveRules(prisma, ["guest"])).size).toBe(0);
  });

  it("a cover list takes this season's seated drivers only", async () => {
    const prisma = db();
    const guest = prisma.state.drivers.guest;
    expect(await validCoverIds(prisma, guest, ["bot", "mitch", "old", "guest", "nobody", "sigg"])).toEqual(["bot", "sigg"]);
  });
});

describe("no Division 1", () => {
  it("refuses the sign-up and a Division 1 seat, not a Division 2 seat", async () => {
    const prisma = db();
    const guest = prisma.state.drivers.guest;
    await writeReserveRule(prisma, "guest", { div1: "never" });
    expect(await division1Block(prisma, race, guest)).toMatch(/can't sign up for Division 1/);
    expect(await seatBlock(prisma, race, d1Seat, guest)).toMatch(/Division 1/);
    expect(await seatBlock(prisma, race, d2Seat, guest)).toBeNull();
  });

  it("does not name a division in a season with one grid", async () => {
    const prisma = db({ division2: false });
    await writeReserveRule(prisma, "guest", { div1: "never" });
    const said = await division1Block(prisma, race, prisma.state.drivers.guest);
    expect(said).toMatch(/sign up as a reserve/);
    expect(said).not.toMatch(/Division/);
  });

  it("leaves a driver with a seat, a special event and a training alone", async () => {
    const prisma = db();
    await writeReserveRule(prisma, "bot", { div1: "never", noSubIn: true });
    await writeReserveRule(prisma, "guest", { div1: "never", noSubIn: true });
    expect(await division1Block(prisma, race, prisma.state.drivers.bot)).toBeNull();
    const event = { ...race, isSpecialEvent: true };
    expect(await division1Block(prisma, event, prisma.state.drivers.guest)).toBeNull();
    expect(await seatBlock(prisma, event, d1Seat, prisma.state.drivers.guest)).toBeNull();
  });
});

describe("only when one of these drivers is out", () => {
  it("is shut while all of them race, and says who", async () => {
    const prisma = db();
    await writeReserveRule(prisma, "guest", { div1: "cover", cover: ["bot", "sigg"] });
    const said = await division1Block(prisma, race, prisma.state.drivers.guest);
    expect(said).toMatch(/when 13bot or Siggsta isn't racing/);
    expect(await seatBlock(prisma, race, d1Seat, prisma.state.drivers.guest)).toBe(said);
  });

  it("opens when one of them says no", async () => {
    const prisma = db();
    await writeReserveRule(prisma, "guest", { div1: "cover", cover: ["bot", "sigg"] });
    prisma.state.rsvps.push({ raceId: "r5", driverId: "sigg", status: "DECLINED" });
    expect(await division1Block(prisma, race, prisma.state.drivers.guest)).toBeNull();
    expect(await seatBlock(prisma, race, d1Seat, prisma.state.drivers.guest)).toBeNull();
    // Another race is another question.
    expect(await division1Block(prisma, { ...race, id: "r6" }, prisma.state.drivers.guest)).not.toBeNull();
  });

  it("opens when a seat of theirs is on the market, but not for a cancelled offer or a maybe", async () => {
    const prisma = db();
    await writeReserveRule(prisma, "guest", { div1: "cover", cover: ["bot"] });
    prisma.state.offers.push({ raceId: "r5", driverId: "bot", status: "CANCELLED" });
    prisma.state.rsvps.push({ raceId: "r5", driverId: "bot", status: "TENTATIVE" });
    expect([...(await driversOut(prisma, "r5", ["bot"]))]).toEqual([]);
    expect(await division1Block(prisma, race, prisma.state.drivers.guest)).toMatch(/when 13bot isn't racing/);
    prisma.state.offers.push({ raceId: "r5", driverId: "bot", status: "FILLED" });
    expect([...(await driversOut(prisma, "r5", ["bot"]))]).toEqual(["bot"]);
    expect(await division1Block(prisma, race, prisma.state.drivers.guest)).toBeNull();
  });

  it("with nobody on the list it is simply shut", async () => {
    const prisma = db();
    await writeReserveRule(prisma, "guest", { div1: "cover", cover: [] });
    expect(await division1Block(prisma, race, prisma.state.drivers.guest)).toMatch(/can't sign up for Division 1/);
  });
});

describe("no subbing in", () => {
  it("refuses every seat, in both divisions, and leaves the sign-up alone", async () => {
    const prisma = db();
    const mitch = prisma.state.drivers.mitch;
    await writeReserveRule(prisma, "mitch", { noSubIn: true });
    expect(await seatBlock(prisma, race, d1Seat, mitch)).toMatch(/can't take over a seat/);
    expect(await seatBlock(prisma, race, d2Seat, mitch)).toMatch(/can't take over a seat/);
    expect(await division1Block(prisma, race, mitch)).toBeNull();
  });
});

describe("new drivers", () => {
  it("start without Division 1 in a season with Division 2", async () => {
    const prisma = db();
    expect(await applyNewDriverRule(prisma, { id: "guest", seasonId: "s9" })).toBe(true);
    expect((await readReserveRules(prisma, ["guest"])).get("guest").div1).toBe("never");
  });

  it("are left alone in a season with one grid", async () => {
    const prisma = db({ division2: false });
    expect(await applyNewDriverRule(prisma, { id: "guest", seasonId: "s9" })).toBe(false);
    expect((await readReserveRules(prisma, ["guest"])).size).toBe(0);
  });

  it("are left alone once the admins switch it off", async () => {
    const prisma = db();
    expect((await readNewDriverRule(prisma)).noDiv1).toBe(true);
    await writeNewDriverRule(prisma, { noDiv1: false });
    expect((await readNewDriverRule(prisma)).noDiv1).toBe(false);
    expect(await applyNewDriverRule(prisma, { id: "guest", seasonId: "s9" })).toBe(false);
  });
});

describe("a new season", () => {
  it("takes the rule along, with the list as the same people's new rows", async () => {
    const prisma = db();
    await writeReserveRule(prisma, "guest", { div1: "cover", cover: ["bot", "sigg"], noSubIn: true });
    await carryReserveRule(prisma, "guest", prisma.state.drivers.guest10);
    // Siggsta has no row in the new season, so drops off the list.
    expect((await readReserveRules(prisma, ["guest10"])).get("guest10")).toEqual({ div1: "cover", cover: ["bot10"], noSubIn: true });
  });

  it("carries nothing for a reserve without a rule", async () => {
    const prisma = db();
    expect(await carryReserveRule(prisma, "mitch", prisma.state.drivers.guest10)).toBeNull();
    expect((await readReserveRules(prisma, ["guest10"])).size).toBe(0);
  });
});
