import { describe, it, expect, vi, beforeEach } from "vitest";

// Notifications and the person links are the two things this file leans on and
// neither belongs in a unit test of the rules.
const notes = [];
vi.mock("./notifications.js", () => ({
  dbCreateNotification: async (_p, n) => {
    notes.push(n);
    return n;
  },
}));
vi.mock("./adminUsers.js", () => ({ getAdminDiscordIds: async () => ["admin1"] }));
// d1 -> 111 and d2 -> 222 have signed in with Discord. d3 never has, which is
// the case that decides whether the accused can read their own report.
vi.mock("./persons.js", () => ({
  discordIdsForDrivers: async (_p, ids) => {
    const known = { d1: "111", d2: "222" };
    return new Map(ids.filter((i) => known[i]).map((i) => [i, known[i]]));
  },
}));

const {
  dbCreateReport, dbAddMessage, dbDecideReport, canRead, readersOf, dbSetAccused,
} = await import("./reports.js");

// A report is a PRIVATE conversation, and everything below is about who is let
// into one and who is told what. Both are easy to break from a long way away —
// the readers are resolved through the person links, and every notification is
// deduplicated — so they are pinned here.

let rows;

function makePrisma() {
  rows = { Report: [], ReportMessage: [], ReportViewer: [] };
  return {
    $executeRawUnsafe: async (sql, ...a) => {
      if (sql.includes('INSERT INTO "Report"')) {
        rows.Report.push({
          id: a[0], raceId: a[1], lap: a[2], reporterDiscordId: a[3], reporterName: a[4],
          accusedDriverId: a[5], accusedName: a[6], body: a[7], source: a[8], incidentAt: a[9],
          status: "NEW", verdict: null, penaltySeconds: null, createdAt: "now", updatedAt: null,
        });
      } else if (sql.includes('INSERT INTO "ReportMessage"')) {
        rows.ReportMessage.push({ id: a[0], reportId: a[1], author: a[2], authorDiscordId: a[3], authorName: a[4], body: a[5], createdAt: "now" });
      } else if (sql.includes('INSERT INTO "ReportViewer"')) {
        rows.ReportViewer.push({ reportId: a[0], discordId: a[1], name: a[2] });
      } else if (sql.startsWith('UPDATE "Report" SET "status"')) {
        const r = rows.Report.find((x) => x.id === a[4]);
        Object.assign(r, { status: a[0], verdict: a[1], penaltySeconds: a[2], updatedAt: a[3] });
      } else if (sql.startsWith('UPDATE "Report" SET "accusedDriverId"')) {
        const r = rows.Report.find((x) => x.id === a[3]);
        Object.assign(r, { accusedDriverId: a[0], accusedName: a[1], updatedAt: a[2] });
      }
      return 1;
    },
    $queryRawUnsafe: async (sql, ...a) => {
      if (sql.includes('FROM "Report" WHERE "id"')) return rows.Report.filter((r) => r.id === a[0]);
      if (sql.includes('FROM "ReportViewer"')) return rows.ReportViewer.filter((v) => v.reportId === a[0]);
      if (sql.includes('FROM "ReportMessage"')) return rows.ReportMessage.filter((m) => m.reportId === a[0]);
      return [];
    },
  };
}

const base = { body: "He hit me at the hairpin", reporterDiscordId: "111", reporterName: "13bot" };

beforeEach(() => {
  notes.length = 0;
});

describe("who can read a report", () => {
  it("lets in the reporter, the accused and nobody else", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    expect([...(await readersOf(p, r))].sort()).toEqual(["111", "222"]);
    expect(await canRead(p, r, "111", false)).toBe(true);
    expect(await canRead(p, r, "222", false)).toBe(true);
    expect(await canRead(p, r, "999", false)).toBe(false);
    expect(await canRead(p, r, null, false)).toBe(false);
  });

  it("lets any admin in without listing them as a reader", async () => {
    // Admins are allowed by BEING admins, not by being on the thread, so taking
    // somebody's admin rights away closes every thread at once.
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    expect(await canRead(p, r, "admin1", true)).toBe(true);
    expect((await readersOf(p, r)).has("admin1")).toBe(false);
  });
});

describe("telling people", () => {
  it("tells the accused that a report names them", async () => {
    const p = makePrisma();
    await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    const toAccused = notes.filter((n) => n.recipientId === "222");
    expect(toAccused).toHaveLength(1);
    expect(toAccused[0].title).toMatch(/names you/i);
    expect(toAccused[0].link).toMatch(/^\/reports\?id=/);
  });

  it("does not tell somebody they reported themselves", async () => {
    const p = makePrisma();
    await dbCreateReport(p, { ...base, reporterDiscordId: "222", accusedDriverId: "d2" });
    expect(notes.filter((n) => n.recipientId === "222")).toHaveLength(0);
  });

  it("says so when the driver named has no Discord account to tell", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d3" });
    expect(r.accusedReachable).toBe(false);
    expect(notes.some((n) => n.title.match(/names you/i))).toBe(false);
  });

  it("tells BOTH drivers the outcome, not just whichever came first", async () => {
    // The dedupe key used to leave out the recipient, so two people on one
    // thread shared one slot and only the first was ever told.
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    notes.length = 0;
    await dbDecideReport(p, r, { status: "PENALTY", penaltySeconds: 5, verdict: "Five seconds." });
    const told = notes.filter((n) => n.title.match(/has been decided/i)).map((n) => n.recipientId);
    expect(told.sort()).toEqual(["111", "222"]);
    expect(new Set(notes.map((n) => n.dedupeKey)).size).toBe(notes.length);
  });

  it("tells them again when a decision is corrected", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    await dbDecideReport(p, r, { status: "PENALTY", penaltySeconds: 5, verdict: "Five." });
    notes.length = 0;
    await dbDecideReport(p, r, { status: "PENALTY", penaltySeconds: 10, verdict: "Ten." });
    expect(notes.filter((n) => n.title.match(/has been decided/i))).toHaveLength(2);
  });

  it("tells them again even when the correction is the same shape as before", async () => {
    // The key used to carry the verdict's LENGTH, so swapping "5s for the
    // contact" for "5s for the weaving" — same status, same seconds, same
    // number of characters — was thrown away as a duplicate.
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    await dbDecideReport(p, r, { status: "PENALTY", penaltySeconds: 5, verdict: "aaaa" });
    notes.length = 0;
    await dbDecideReport(p, r, { status: "PENALTY", penaltySeconds: 5, verdict: "bbbb" });
    expect(notes.filter((n) => n.title.match(/has been decided/i))).toHaveLength(2);
    expect(new Set(notes.map((n) => n.dedupeKey)).size).toBe(notes.length);
  });

  it("says how many people the outcome actually reached", async () => {
    // "Both drivers have been told" is wrong when the accused has no account,
    // and wrong again when nobody is named at all.
    const p = makePrisma();
    const two = await dbDecideReport(p, await dbCreateReport(p, { ...base, accusedDriverId: "d2" }), { status: "NO_PENALTY" });
    expect(two.told).toBe(2);
    const one = await dbDecideReport(p, await dbCreateReport(p, { ...base, accusedDriverId: "d3" }), { status: "NO_PENALTY" });
    expect(one.told).toBe(1);
  });

  it("says nothing for a status that is not an ending", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    notes.length = 0;
    await dbDecideReport(p, r, { status: "REVIEWING" });
    expect(notes).toHaveLength(0);
  });

  it("tells everyone on a thread about a new message except whoever wrote it", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    notes.length = 0;
    await dbAddMessage(p, r, { author: "REPORTER", discordId: "111", name: "13bot", body: "Lap 14." });
    const told = notes.filter((n) => n.title.match(/new message/i)).map((n) => n.recipientId);
    expect(told).toContain("222");
    expect(told).not.toContain("111");
  });
});

describe("naming the driver afterwards", () => {
  it("lets them in and tells them", async () => {
    // An in-game report knows who SENT it and not who they are complaining
    // about, so this is the only way that driver ever sees the thread.
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: null });
    expect(await canRead(p, r, "222", false)).toBe(false);
    notes.length = 0;
    const fresh = await dbSetAccused(p, r, { accusedDriverId: "d2", accusedName: "mtimmis" });
    expect(fresh.accusedReachable).toBe(true);
    expect(await canRead(p, fresh, "222", false)).toBe(true);
    expect(notes.filter((n) => n.recipientId === "222" && n.title.match(/names you/i))).toHaveLength(1);
  });
});

describe("what a report will not accept", () => {
  it("refuses a body with nothing in it", async () => {
    const p = makePrisma();
    await expect(dbCreateReport(p, { ...base, body: "hi" })).rejects.toThrow(/say a little more/i);
  });

  it("refuses an empty message", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, base);
    await expect(dbAddMessage(p, r, { author: "ADMIN", body: "  " })).rejects.toThrow(/empty/i);
  });

  it("refuses a status it does not know", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, base);
    await expect(dbDecideReport(p, r, { status: "MAYBE" })).rejects.toThrow(/unknown status/i);
  });

  it("keeps seconds inside a sane range", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, base);
    expect((await dbDecideReport(p, r, { status: "PENALTY", penaltySeconds: -5 })).penaltySeconds).toBe(0);
    expect((await dbDecideReport(p, r, { status: "PENALTY", penaltySeconds: 9999 })).penaltySeconds).toBe(600);
  });
});
