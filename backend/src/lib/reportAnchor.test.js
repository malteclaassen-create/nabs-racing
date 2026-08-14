import { describe, it, expect, vi, beforeEach } from "vitest";

// The round's archive, stubbed: a session that started at unix 1000, and the
// contacts one driver was in. The real thing reads a multi-megabyte AC result
// file off disk (lib/raceContacts.js) — what matters here is what is done with
// the numbers, not how they are parsed.
const SESSION_START = 1000;
let contacts = [];
vi.mock("./raceContacts.js", () => ({
  sessionStartForRound: () => SESSION_START,
  contactsForDriver: (_s, _r, guid) => contacts.filter((c) => c.guid === guid),
}));

const { anchorReports, withSessionSecond } = await import("./reportAnchor.js");

const RACE = { id: "race1", number: 2, season: { number: 8 } };
// A driver on the roster, racing under a clan tag, with a Steam id.
const DRIVERS = [
  { name: "Maltegoat", discordName: "malte", discordUserId: "111", steamId: "STEAM1" },
  { name: "Kronos", discordName: "kronos", discordUserId: "222", steamId: "STEAM2" },
];
const prisma = { driver: { findMany: async () => DRIVERS } };

// A report as it comes out of the table: the moment the BUTTON was pressed.
const pressedAt = (second, over = {}) => ({
  id: over.id || "r1",
  source: "INGAME",
  raceId: "race1",
  reporterName: "NABS | Maltegoat",
  reporterDiscordId: null,
  incidentAt: new Date((SESSION_START + second) * 1000).toISOString(),
  contactSecond: null,
  contactKph: null,
  contactIndex: null,
  lap: null,
  ...over,
});

const contact = (guid, second, over = {}) => ({
  guid,
  second,
  kph: over.kph ?? 87,
  eventIndex: over.eventIndex ?? 42,
  lap: over.lap ?? 14,
  other: { name: "Kronos" },
});

beforeEach(() => {
  contacts = [];
});

// An in-game report knows when the button was pressed, and that is the incident
// plus however long the driver took to reach for it. The result file knows when
// the cars actually touched.
describe("matching an in-game report to the contact it is about", () => {
  it("moves the report onto the collision the file recorded", async () => {
    contacts = [contact("STEAM1", 1200)];
    const [r] = await anchorReports(prisma, [pressedAt(1208)], [RACE]);
    expect(r.sessionSecond).toBe(1200); // not 1208 — the eight seconds were the driver
    expect(r.contactMatched).toBe(true);
    expect(r.sessionSecondApprox).toBe(false);
  });

  it("brings the file's own detail with it, so the match can be checked", async () => {
    contacts = [contact("STEAM1", 1200, { kph: 93, eventIndex: 77, lap: 9 })];
    const [r] = await anchorReports(prisma, [pressedAt(1206)], [RACE]);
    expect(r.contactKph).toBe(93);
    expect(r.contactIndex).toBe(77);
    expect(r.lap).toBe(9);
  });

  // Fault is the stewards' to decide. The file knows which car it was; a driver
  // pressing a button has not accused anybody.
  it("never names the other driver as the accused", async () => {
    contacts = [contact("STEAM1", 1200)];
    const [r] = await anchorReports(prisma, [pressedAt(1205)], [RACE]);
    expect(r.accusedName ?? null).toBe(null);
  });

  it("takes the LAST contact before the press, not the first of a pile-up", async () => {
    contacts = [contact("STEAM1", 1180), contact("STEAM1", 1183), contact("STEAM1", 1186)];
    const [r] = await anchorReports(prisma, [pressedAt(1192)], [RACE]);
    expect(r.sessionSecond).toBe(1186);
  });

  it("leaves the report alone when the driver was in no contact at all", async () => {
    contacts = [contact("STEAM2", 1200)]; // somebody else's
    const [r] = await anchorReports(prisma, [pressedAt(1208)], [RACE]);
    expect(r.sessionSecond).toBe(1208); // the press, unchanged
    expect(r.contactMatched).toBeUndefined();
  });

  it("does not reach back to an unrelated tap minutes earlier", async () => {
    contacts = [contact("STEAM1", 900)];
    const [r] = await anchorReports(prisma, [pressedAt(1208)], [RACE]);
    expect(r.sessionSecond).toBe(1208);
  });

  // Nothing after the press can be what it was about — bar the two servers'
  // clocks disagreeing, which the small tolerance covers.
  it("tolerates a little clock skew but not a later crash", async () => {
    contacts = [contact("STEAM1", 1212)];
    expect((await anchorReports(prisma, [pressedAt(1208)], [RACE]))[0].sessionSecond).toBe(1212);
    contacts = [contact("STEAM1", 1260)];
    expect((await anchorReports(prisma, [pressedAt(1208)], [RACE]))[0].sessionSecond).toBe(1208);
  });

  it("finds the driver by their Discord link when the report carries one", async () => {
    contacts = [contact("STEAM2", 1200)];
    const [r] = await anchorReports(
      prisma,
      [pressedAt(1207, { reporterName: "somebody renamed since", reporterDiscordId: "222" })],
      [RACE]
    );
    expect(r.sessionSecond).toBe(1200);
  });

  // A wrong guid pins the report to somebody else's crash, which is worse than
  // no match at all.
  it("refuses to guess when two people race under the same name", async () => {
    const twins = {
      driver: {
        findMany: async () => [
          { name: "Alex", discordName: "alex", discordUserId: null, steamId: "STEAM_A" },
          { name: "alex", discordName: "alex2", discordUserId: null, steamId: "STEAM_B" },
        ],
      },
    };
    contacts = [contact("STEAM_A", 1200)];
    const [r] = await anchorReports(twins, [pressedAt(1208, { reporterName: "Alex" })], [RACE]);
    expect(r.sessionSecond).toBe(1208);
  });

  it("leaves a report the driver pinned themselves exactly as they pinned it", async () => {
    contacts = [contact("STEAM1", 1200)];
    const own = pressedAt(1150, { source: "SITE", contactSecond: 1150, contactKph: 55, contactIndex: 3 });
    const [r] = await anchorReports(prisma, [own], [RACE]);
    expect(r.sessionSecond).toBe(1150);
    expect(r.contactKph).toBe(55);
    expect(r.contactMatched).toBeUndefined();
  });

  it("does not fall over on a round with no archive or no round at all", async () => {
    const loose = pressedAt(1208, { raceId: null, incidentAt: null });
    const [r] = await anchorReports(prisma, [loose], []);
    expect(r.sessionSecond).toBeUndefined();
  });
});

// The figure before any of that: how far into the session the report landed.
describe("how far into the round a report happened", () => {
  it("measures from the session start, not the report's own clock", () => {
    const [r] = withSessionSecond([pressedAt(742)], [RACE]);
    expect(r.sessionSecond).toBe(742);
  });

  it("falls back to the live figure, flagged as approximate, when there is no archive", () => {
    const [r] = withSessionSecond([pressedAt(742, { raceId: null, contactSecond: 700 })], []);
    expect(r.sessionSecond).toBe(700);
    expect(r.sessionSecondApprox).toBe(true);
  });

  it("keeps a pinned contact's figure exact", () => {
    const [r] = withSessionSecond([pressedAt(742, { raceId: null, source: "SITE", contactSecond: 700 })], []);
    expect(r.sessionSecondApprox).toBe(false);
  });
});
