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
vi.mock("./adminUsers.js", () => ({ getAdminDiscordIds: async () => ["admin1"], isDiscordAdmin: async () => false }));
// Appointed stewards, switched on per test.
const stewards = new Set();
vi.mock("./stewards.js", () => ({ isSteward: async (_p, id) => stewards.has(String(id)) }));
// d1 -> 111 and d2 -> 222 have signed in with Discord. d3 never has, which is
// the case that decides whether the accused can read their own report.
vi.mock("./persons.js", () => ({
  discordIdsForDrivers: async (_p, ids) => {
    const known = { d1: "111", d2: "222" };
    return new Map(ids.filter((i) => known[i]).map((i) => [i, known[i]]));
  },
  // The person links, set per test: [[personId, [driverRowIds]], ...].
  getPersonGroups: async () => {
    const byDriver = new Map();
    const byPerson = new Map(personLinks);
    for (const [pid, ids] of personLinks) for (const id of ids) byDriver.set(id, pid);
    return { byDriver, byPerson };
  },
}));
let personLinks = [];

const {
  dbCreateReport, dbAddMessage, dbDecideReport, canRead, readersOf, dbSetAccused, dbRepointAccused,
  dbBlockPerson, dbUnblockPerson, dbBlocks, dbAddViewer,
  dbLinkedReports, dbEnsureIncidentGroup,
  dbAddAttachment, dbAttachments, dbDeleteReport, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES,
  dbReportsFor, roleOn, dbPenaltiesForRace, dbMarkPenaltiesApplied,
  dbGetReport, dbLicenceTable, dbDriverRecord, licenceTable, penaltyOutcome,
  readLicenceThreshold, writeLicenceThreshold, DEFAULT_LICENCE_THRESHOLD,
} = await import("./reports.js");

// A report is a PRIVATE conversation, and everything below is about who is let
// into one and who is told what. Both are easy to break from a long way away —
// the readers are resolved through the person links, and every notification is
// deduplicated — so they are pinned here.

let rows;

function makePrisma({ races = [], settings = {} } = {}) {
  rows = { Report: [], ReportMessage: [], ReportViewer: [], ReportAttachment: [], ReportBlock: [] };
  return {
    race: {
      findMany: async ({ where }) => races.filter((r) => r.seasonId === where.seasonId),
      findUnique: async ({ where }) => races.find((r) => r.id === where.id) || null,
    },
    setting: {
      findUnique: async ({ where }) => (where.key in settings ? { key: where.key, value: settings[where.key] } : null),
      upsert: async ({ where, create }) => {
        settings[where.key] = create.value;
      },
    },
    $executeRawUnsafe: async (sql, ...a) => {
      if (sql.includes('INSERT INTO "Report"')) {
        rows.Report.push({
          id: a[0], raceId: a[1], lap: a[2], reporterDiscordId: a[3], reporterName: a[4],
          accusedDriverId: a[5], accusedName: a[6], body: a[7], source: a[8], incidentAt: a[9],
          status: "NEW", verdict: null, penaltySeconds: null, appliedSeconds: null, appliedAt: null,
          createdAt: "now", updatedAt: null,
        });
      } else if (sql.includes('INSERT INTO "ReportMessage"')) {
        rows.ReportMessage.push({ id: a[0], reportId: a[1], author: a[2], authorDiscordId: a[3], authorName: a[4], body: a[5], createdAt: "now" });
      } else if (sql.includes('INSERT INTO "ReportAttachment"')) {
        rows.ReportAttachment.push({
          id: a[0], reportId: a[1], messageId: a[2], storedName: a[3],
          name: a[4], mime: a[5], size: a[6], uploaderDiscordId: a[7], createdAt: "now",
        });
      } else if (sql.startsWith('DELETE FROM "ReportAttachment"')) {
        rows.ReportAttachment = rows.ReportAttachment.filter((x) => x.reportId !== a[0]);
      } else if (sql.includes('INSERT INTO "ReportViewer"')) {
        rows.ReportViewer.push({ reportId: a[0], discordId: a[1], name: a[2] });
      } else if (sql.includes('INSERT INTO "ReportBlock"')) {
        rows.ReportBlock.push({ reportId: a[0], discordId: a[1], name: a[2], createdAt: "now" });
      } else if (sql.startsWith('DELETE FROM "ReportBlock" WHERE "reportId" = ? AND "discordId"')) {
        rows.ReportBlock = rows.ReportBlock.filter((b) => !(b.reportId === a[0] && b.discordId === a[1]));
      } else if (sql.startsWith('DELETE FROM "ReportBlock"')) {
        rows.ReportBlock = rows.ReportBlock.filter((b) => b.reportId !== a[0]);
      } else if (sql.startsWith('DELETE FROM "ReportViewer" WHERE "reportId" = ? AND "discordId"')) {
        rows.ReportViewer = rows.ReportViewer.filter((v) => !(v.reportId === a[0] && v.discordId === a[1]));
      } else if (sql.startsWith('UPDATE "Report" SET "status"')) {
        const r = rows.Report.find((x) => x.id === a[6]);
        Object.assign(r, {
          status: a[0], verdict: a[1], penaltySeconds: a[2], penaltyKind: a[3], licencePoints: a[4], updatedAt: a[5],
        });
      } else if (sql.startsWith('UPDATE "Report" SET "accusedDriverId"')) {
        const r = rows.Report.find((x) => x.id === a[3]);
        Object.assign(r, { accusedDriverId: a[0], accusedName: a[1], updatedAt: a[2] });
      } else if (sql.startsWith('UPDATE "Report" SET "incidentGroupId"')) {
        const r = rows.Report.find((x) => x.id === a[1]);
        if (r) r.incidentGroupId = a[0];
      } else if (sql.startsWith('UPDATE "Report" SET "appliedSeconds"')) {
        const r = rows.Report.find((x) => x.id === a[2]);
        Object.assign(r, { appliedSeconds: a[0], appliedAt: a[1] });
      }
      return 1;
    },
    $queryRawUnsafe: async (sql, ...a) => {
      if (sql.includes('FROM "Report" WHERE "id"')) return rows.Report.filter((r) => r.id === a[0]);
      if (sql.includes('FROM "Report" WHERE "incidentGroupId"'))
        return rows.Report.filter((r) => r.incidentGroupId === a[0] && r.id !== a[1]);
      if (sql.includes('FROM "Report" WHERE "raceId" IN')) return rows.Report.filter((r) => a.includes(r.raceId));
      if (sql.includes('FROM "Report" WHERE "raceId"'))
        return rows.Report.filter(
          (r) => r.raceId === a[0] && ["PENALTY", "NO_PENALTY", "DISMISSED"].includes(r.status)
        );
      if (sql.includes('FROM "Report" ORDER BY')) return [...rows.Report];
      if (sql.includes('FROM "ReportBlock" WHERE "reportId"')) return rows.ReportBlock.filter((b) => b.reportId === a[0]);
      if (sql.includes('FROM "ReportBlock" WHERE "discordId"')) return rows.ReportBlock.filter((b) => b.discordId === a[0]);
      if (sql.includes('FROM "ReportViewer" WHERE "reportId" = ? AND "discordId"'))
        return rows.ReportViewer.filter((v) => v.reportId === a[0] && v.discordId === a[1]);
      if (sql.includes('FROM "ReportViewer"')) return rows.ReportViewer.filter((v) => v.reportId === a[0]);
      if (sql.includes('FROM "ReportMessage"')) return rows.ReportMessage.filter((m) => m.reportId === a[0]);
      if (sql.includes('FROM "ReportAttachment"')) return rows.ReportAttachment.filter((x) => x.reportId === a[0]);
      return [];
    },
  };
}

const base = { body: "He hit me at the hairpin", reporterDiscordId: "111", reporterName: "13bot" };

beforeEach(() => {
  notes.length = 0;
  stewards.clear();
  personLinks = [];
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

describe("shutting somebody out of one report", () => {
  // A thread is a conversation between two people who have just crashed into
  // each other. Now and then one of them writes something that has no place in
  // it, and the office needs to be able to take them out of THAT thread. It has
  // to beat every other claim: being the reporter, being the driver named, and
  // being an appointed steward are all otherwise permanent.
  it("takes the report away from the person who filed it", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    expect(await canRead(p, r, "111", false)).toBe(true);
    expect(await roleOn(p, r, "111")).toBe("REPORTER");

    await dbBlockPerson(p, r.id, "111", "13bot");

    expect(await canRead(p, r, "111", false)).toBe(false);
    // No role at all, so the thread drops out of their own list rather than
    // sitting there as a door that refuses to open.
    expect(await roleOn(p, r, "111")).toBe(null);
    expect((await dbReportsFor(p, "111")).some((x) => x.id === r.id)).toBe(false);
    expect((await readersOf(p, r)).has("111")).toBe(false);
  });

  it("takes it away from the driver it names, too", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    await dbBlockPerson(p, r.id, "222", "Bob");
    expect(await canRead(p, r, "222", false)).toBe(false);
    expect(await roleOn(p, r, "222")).toBe(null);
  });

  it("beats being a steward, for that one report", async () => {
    // A steward reads every thread in the league. Removing one from a single
    // report has to mean that report, not "unless they happen to be a steward".
    const p = makePrisma();
    stewards.add("333");
    const a = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    const b = await dbCreateReport(p, { ...base, body: "Another one entirely" });
    await dbBlockPerson(p, a.id, "333", "A steward");

    expect(await canRead(p, a, "333", false)).toBe(false);
    expect(await canRead(p, b, "333", false)).toBe(true);
    const theirs = await dbReportsFor(p, "333");
    expect(theirs.some((x) => x.id === a.id)).toBe(false);
    expect(theirs.some((x) => x.id === b.id)).toBe(true);
  });

  it("does not shut them out of anything else", async () => {
    const p = makePrisma();
    const a = await dbCreateReport(p, { ...base });
    const b = await dbCreateReport(p, { ...base, body: "A second incident, same driver" });
    await dbBlockPerson(p, a.id, "111", "13bot");
    expect(await canRead(p, a, "111", false)).toBe(false);
    expect(await canRead(p, b, "111", false)).toBe(true);
  });

  it("an admin can let them back in", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base });
    await dbBlockPerson(p, r.id, "111", "13bot");
    expect(await dbBlocks(p, r.id)).toHaveLength(1);

    await dbUnblockPerson(p, r.id, "111");
    expect(await dbBlocks(p, r.id)).toHaveLength(0);
    expect(await canRead(p, r, "111", false)).toBe(true);
    expect(await roleOn(p, r, "111")).toBe("REPORTER");
  });

  it("the two lists cannot disagree", async () => {
    // Being shut out takes away a viewer seat, and being let in as a viewer
    // lifts a block. Otherwise one of the two says yes while the other says no,
    // and the no always wins, so the yes looks like a control that does nothing.
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base });
    await dbAddViewer(p, r.id, "444", "A witness");
    expect(await canRead(p, r, "444", false)).toBe(true);

    await dbBlockPerson(p, r.id, "444", "A witness");
    expect(await canRead(p, r, "444", false)).toBe(false);

    await dbAddViewer(p, r.id, "444", "A witness");
    expect(await dbBlocks(p, r.id)).toHaveLength(0);
    expect(await canRead(p, r, "444", false)).toBe(true);
  });

  it("says nothing to the person shut out, and nothing to the admins", async () => {
    // Being removed from a thread is not a conversation, and a note saying so
    // is an invitation to carry it on somewhere else.
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base });
    notes.length = 0;
    await dbBlockPerson(p, r.id, "111", "13bot");
    expect(notes).toHaveLength(0);
  });

  it("keeps what they wrote", async () => {
    // The thread is the record of how a decision was reached, and the reason
    // somebody was removed is usually IN it.
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base });
    await dbAddMessage(p, r, { author: "REPORTER", discordId: "111", name: "13bot", body: "Something out of order" });
    const before = rows.ReportMessage.filter((m) => m.reportId === r.id).length;
    await dbBlockPerson(p, r.id, "111", "13bot");
    expect(rows.ReportMessage.filter((m) => m.reportId === r.id)).toHaveLength(before);
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
  it("refuses to change a name that is already there", async () => {
    // An accusation belongs to the person who made it, and naming somebody
    // lets them in and tells them. Re-pointing a report would leave a driver
    // sitting in a thread that is no longer about them, having read it.
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    await expect(dbSetAccused(p, r, { accusedDriverId: "d3", accusedName: "someone else" })).rejects.toThrow(
      /already names a driver/i
    );
  });

  it("refuses to name nobody", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, base);
    await expect(dbSetAccused(p, r, { accusedDriverId: null })).rejects.toThrow(/pick a driver/i);
  });

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

// A misclick in the desk's dropdown used to mean deleting the report and
// filing it again, losing the thread and the decision. Correcting is allowed
// now — for the stewards only — and the reason re-pointing was forbidden is
// answered by telling people rather than by refusing: the wrongly named driver
// hears the report no longer names them, the right one that it does.
describe("a steward correcting who a report is about", () => {
  // A reporter nobody on the roster maps to, so the two named drivers' own
  // notifications stand out alone.
  const filed = { body: "hit at T3", reporterDiscordId: "999", reporterName: "outsider" };

  it("re-points the report, moves the seat in the thread, and tells both drivers", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...filed, accusedDriverId: "d1", accusedName: "wrong guy" });
    notes.length = 0;
    const fresh = await dbRepointAccused(p, r, { accusedDriverId: "d2", accusedName: "right guy" });
    expect(fresh.accusedDriverId).toBe("d2");
    expect(fresh.accusedName).toBe("right guy");
    expect(await canRead(p, fresh, "111", false)).toBe(false);
    expect(await canRead(p, fresh, "222", false)).toBe(true);
    expect(notes.filter((n) => n.recipientId === "111" && n.title.match(/no longer names you/i))).toHaveLength(1);
    expect(notes.filter((n) => n.recipientId === "222" && n.title.match(/names you/i))).toHaveLength(1);
  });

  it("refuses on a report that names nobody yet — that is naming, not correcting", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...filed, accusedDriverId: null });
    await expect(dbRepointAccused(p, r, { accusedDriverId: "d2", accusedName: "x" })).rejects.toThrow(
      /names nobody yet/i
    );
  });

  it("says nothing to anybody when the same driver is picked again", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, { ...filed, accusedDriverId: "d2", accusedName: "same" });
    notes.length = 0;
    const fresh = await dbRepointAccused(p, r, { accusedDriverId: "d2", accusedName: "same" });
    expect(fresh.accusedDriverId).toBe("d2");
    expect(notes).toHaveLength(0);
  });
});

// A crash with two penalties in it is ONE incident at the desk and TWO reports
// underneath: split halves share a group id, and each report lists the others
// so the steward screen can draw a decision box per driver.
describe("one incident, one report per driver", () => {
  it("groups the halves and each one lists its siblings", async () => {
    const p = makePrisma();
    const first = await dbCreateReport(p, { ...base, accusedDriverId: "d1" });
    const groupId = await dbEnsureIncidentGroup(p, first);
    // The first report's own id doubles as the group id — a lone report needs
    // nothing written to it until its first split.
    expect(groupId).toBe(first.id);
    const second = await dbCreateReport(p, { ...base, accusedDriverId: "d2", incidentGroupId: groupId });
    expect((await dbLinkedReports(p, { ...first, incidentGroupId: groupId })).map((r) => r.id)).toEqual([second.id]);
    expect((await dbLinkedReports(p, second)).map((r) => r.id)).toEqual([first.id]);
  });

  it("lists nothing for a report that was never split", async () => {
    const p = makePrisma();
    const lone = await dbCreateReport(p, { ...base, accusedDriverId: "d1" });
    expect(await dbLinkedReports(p, lone)).toEqual([]);
  });
});

describe("stewards", () => {
  it("sees every report, and the list says that is why", async () => {
    const p = makePrisma();
    await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    // s1 is neither party nor let in
    expect(await dbReportsFor(p, "s1")).toHaveLength(0);
    stewards.add("s1");
    const seen = await dbReportsFor(p, "s1");
    expect(seen).toHaveLength(1);
    expect(seen[0].myRole).toBe("STEWARD");
    expect(await canRead(p, seen[0], "s1", false)).toBe(true);
  });

  it("is outranked by actually being in the argument", async () => {
    // The label decides which section of a driver's page a report lands in, so
    // a steward who is also the accused must read as the accused.
    const p = makePrisma();
    stewards.add("222");
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    expect(await roleOn(p, r, "222")).toBe("ACCUSED");
    expect(await roleOn(p, r, "111")).toBe("REPORTER");
    stewards.delete("222");
  });

  it("does not make somebody a reader of a thread they are only judging", async () => {
    // readersOf is who gets NOTIFIED. Every steward pinged about every message
    // in the league would be a reason to turn notifications off.
    const p = makePrisma();
    stewards.add("s1");
    const r = await dbCreateReport(p, { ...base, accusedDriverId: "d2" });
    expect((await readersOf(p, r)).has("s1")).toBe(false);
  });
});

describe("attachments", () => {
  it("takes pictures, clips and a PDF, and nothing that runs", async () => {
    // A closed list, not a blocklist: these files are opened by the other
    // driver and by the stewards, from the league's own domain.
    expect(Object.keys(ATTACHMENT_TYPES).sort()).toEqual([
      "application/pdf", "image/gif", "image/jpeg", "image/png", "image/webp",
      "video/mp4", "video/quicktime", "video/webm",
    ]);
    expect(ATTACHMENT_TYPES["application/x-msdownload"]).toBeUndefined();
    expect(ATTACHMENT_TYPES["image/svg+xml"]).toBeUndefined(); // an SVG can carry a script
    expect(MAX_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024);
  });

  it("lets a message be nothing but a picture", async () => {
    // "Here, look" with a clip attached is a complete thought, and refusing it
    // would make somebody type a full stop to send a video.
    const p = makePrisma();
    const r = await dbCreateReport(p, base);
    await expect(dbAddMessage(p, r, { author: "REPORTER", body: "" })).rejects.toThrow(/empty/i);
    const ok = await dbAddMessage(p, r, { author: "REPORTER", body: "", allowEmpty: true });
    expect(ok.messageId).toBeTruthy();
  });

  it("hands back the files hanging on a report, and never the name on disk", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, base);
    const { messageId } = await dbAddMessage(p, r, { author: "REPORTER", body: "look" });
    await dbAddAttachment(p, {
      reportId: r.id, messageId, storedName: "secret-on-disk.png",
      name: "contact.png", mime: "image/png", size: 4242, uploaderDiscordId: "111",
    });
    const [a] = await dbAttachments(p, r.id);
    expect(a).toMatchObject({ reportId: r.id, messageId, name: "contact.png", mime: "image/png", size: 4242 });
    // The path on disk is the server's business.
    expect(JSON.stringify(a)).not.toContain("secret-on-disk");
  });

  it("gives back the files to delete when a report goes, so they can be removed", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, base);
    await dbAddAttachment(p, {
      reportId: r.id, messageId: null, storedName: "abc.mp4",
      name: "clip.mp4", mime: "video/mp4", size: 10,
    });
    expect(await dbDeleteReport(p, r.id)).toEqual(["abc.mp4"]);
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

// The seconds a steward decides do not write themselves into a classification —
// the results editor types them, and a human saves them. What is pinned here is
// the bookkeeping that lets the editor do the typing without ever doing it
// twice: what is OUTSTANDING is what the reports decided minus what has already
// been written.
describe("penalties owed to a classification", () => {
  const inRound = { ...base, raceId: "r1", accusedDriverId: "d2", accusedName: "mtimmis" };

  async function decided(p, seconds, extra = {}) {
    const r = await dbCreateReport(p, { ...inRound, ...extra });
    await dbDecideReport(p, r, { status: "PENALTY", penaltySeconds: seconds, verdict: `${seconds}s` });
    return r;
  }

  it("adds a round's incidents up per driver", async () => {
    // The editor has ONE penalty cell per driver. Compared a report at a time,
    // typing five would satisfy both and the second penalty would vanish.
    const p = makePrisma();
    await decided(p, 5);
    await decided(p, 5);
    const [g] = await dbPenaltiesForRace(p, "r1");
    expect(g.driverId).toBe("d2");
    expect(g.decided).toBe(10);
    expect(g.outstanding).toBe(10);
    expect(g.reports).toHaveLength(2);
  });

  it("stops asking once the seconds have been entered", async () => {
    const p = makePrisma();
    const r = await decided(p, 5);
    await dbMarkPenaltiesApplied(p, [r.id]);
    const [g] = await dbPenaltiesForRace(p, "r1");
    expect(g.decided).toBe(5);
    expect(g.applied).toBe(5);
    expect(g.outstanding).toBe(0);
  });

  it("asks only for the DIFFERENCE when a verdict is corrected", async () => {
    // Five were entered and the stewards then made it ten. Asking for ten again
    // would put fifteen on the driver.
    const p = makePrisma();
    const r = await decided(p, 5);
    await dbMarkPenaltiesApplied(p, [r.id]);
    await dbDecideReport(p, await import("./reports.js").then((m) => m.dbGetReport(p, r.id)), {
      status: "PENALTY",
      penaltySeconds: 10,
      verdict: "Ten after all.",
    });
    const [g] = await dbPenaltiesForRace(p, "r1");
    expect(g.outstanding).toBe(5);
  });

  it("takes the seconds back off when a penalty is reversed after it was entered", async () => {
    const p = makePrisma();
    const r = await decided(p, 5);
    await dbMarkPenaltiesApplied(p, [r.id]);
    const { dbGetReport } = await import("./reports.js");
    await dbDecideReport(p, await dbGetReport(p, r.id), { status: "NO_PENALTY", verdict: "On reflection, no." });
    const [g] = await dbPenaltiesForRace(p, "r1");
    expect(g.decided).toBe(0);
    expect(g.outstanding).toBe(-5);
    // And once the editor has taken them off, the round is square again and
    // the reversal drops out of the list entirely: nothing decided, nothing
    // entered, nothing left for the desk to do about it.
    await dbMarkPenaltiesApplied(p, [r.id]);
    expect(await dbPenaltiesForRace(p, "r1")).toHaveLength(0);
  });

  it("marking twice cannot make a penalty count twice", async () => {
    const p = makePrisma();
    const r = await decided(p, 5);
    await dbMarkPenaltiesApplied(p, [r.id]);
    await dbMarkPenaltiesApplied(p, [r.id]);
    const [g] = await dbPenaltiesForRace(p, "r1");
    expect(g.applied).toBe(5);
    expect(g.outstanding).toBe(0);
  });

  it("says out loud when a penalty names nobody", async () => {
    // It cannot be put on a row, and the fix is in the Reports tab: somebody
    // has to say who it was about.
    const p = makePrisma();
    await decided(p, 5, { accusedDriverId: null, accusedName: null });
    const [g] = await dbPenaltiesForRace(p, "r1");
    expect(g.driverId).toBe(null);
    expect(g.outstanding).toBe(5);
  });

  it("leaves decisions that are not penalties out of it", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, inRound);
    await dbDecideReport(p, r, { status: "NO_PENALTY", verdict: "Racing incident." });
    expect(await dbPenaltiesForRace(p, "r1")).toHaveLength(0);
  });
});

// A decision has a KIND as well as seconds. Only TIME ever reaches the results
// editor; the rest are recorded and shown, and carried out by hand. Pinned here
// because the editor fills its penalty column from dbPenaltiesForRace on its
// own, so a warning that leaked seconds into it would put time on a driver
// nobody meant to.
describe("the kind of a penalty", () => {
  const inRound = { ...base, raceId: "r1", accusedDriverId: "d2", accusedName: "mtimmis" };

  it("reads a penalty with no kind given as TIME, which is what every old one was", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, inRound);
    const d = await dbDecideReport(p, r, { status: "PENALTY", penaltySeconds: 5 });
    expect(d.penaltyKind).toBe("TIME");
    expect(d.penaltySeconds).toBe(5);
    // And a row stored before the column existed reads the same way.
    rows.Report[0].penaltyKind = null;
    expect((await dbGetReport(p, r.id)).penaltyKind).toBe("TIME");
  });

  it("refuses a kind it does not know rather than reading it as seconds", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, inRound);
    await expect(dbDecideReport(p, r, { status: "PENALTY", penaltyKind: "BAN", penaltySeconds: 5 })).rejects.toThrow(
      /unknown penalty kind/i
    );
    // Nothing was written by the refused call.
    expect((await dbGetReport(p, r.id)).status).toBe("NEW");
    // Case does not matter; the spelling does.
    expect((await dbDecideReport(p, r, { status: "PENALTY", penaltyKind: "grid" })).penaltyKind).toBe("GRID");
  });

  it("keeps no seconds on a kind that is not TIME", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, inRound);
    const d = await dbDecideReport(p, r, { status: "PENALTY", penaltyKind: "WARNING", penaltySeconds: 5 });
    expect(d.penaltySeconds).toBe(null);
  });

  it("puts TIME penalties into the editor's figures exactly as before, and nothing else", async () => {
    const p = makePrisma();
    const time = await dbCreateReport(p, inRound);
    await dbDecideReport(p, time, { status: "PENALTY", penaltyKind: "TIME", penaltySeconds: 5, licencePoints: 2 });
    for (const kind of ["WARNING", "GRID", "DSQ"]) {
      const r = await dbCreateReport(p, inRound);
      await dbDecideReport(p, r, { status: "PENALTY", penaltyKind: kind, penaltySeconds: 30, licencePoints: 3 });
    }
    const [g] = await dbPenaltiesForRace(p, "r1");
    expect(g.decided).toBe(5);
    expect(g.outstanding).toBe(5);
    expect(g.reports.map((x) => x.id)).toEqual([time.id]);
  });

  it("takes the seconds back off when an entered time penalty becomes a warning", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, inRound);
    await dbDecideReport(p, r, { status: "PENALTY", penaltySeconds: 5 });
    await dbMarkPenaltiesApplied(p, [r.id]);
    await dbDecideReport(p, await dbGetReport(p, r.id), { status: "PENALTY", penaltyKind: "WARNING" });
    const [g] = await dbPenaltiesForRace(p, "r1");
    expect(g.decided).toBe(0);
    expect(g.outstanding).toBe(-5);
  });

  it("tells the drivers what kind it was and the points it carried", async () => {
    expect(penaltyOutcome({ status: "PENALTY", penaltyKind: "TIME", penaltySeconds: 5 })).toBe("Penalty: 5 seconds.");
    expect(penaltyOutcome({ status: "PENALTY", penaltyKind: "TIME", penaltySeconds: 5, licencePoints: 2 })).toBe(
      "Penalty: 5 seconds, 2 licence points."
    );
    expect(penaltyOutcome({ status: "PENALTY", penaltyKind: "DSQ", licencePoints: 1 })).toBe(
      "Penalty: disqualification, 1 licence point."
    );
    expect(penaltyOutcome({ status: "PENALTY", penaltyKind: "TIME" })).toBe("A penalty was given.");
    expect(penaltyOutcome({ status: "NO_PENALTY", licencePoints: 4 })).toBe("No penalty was given.");
  });
});

describe("licence points", () => {
  const S7 = [
    { id: "r1", seasonId: "s7", number: 1, track: "Spa", date: "2026-03-01" },
    { id: "r2", seasonId: "s7", number: 2, track: "Monza", date: "2026-03-08" },
    { id: "r3", seasonId: "s7", number: 3, track: "Imola", date: "2026-03-15" },
  ];
  const S6 = [{ id: "old", seasonId: "s6", number: 9, track: "Suzuka", date: "2025-11-01" }];

  async function penalise(p, raceId, driverId, points, extra = {}) {
    const r = await dbCreateReport(p, { ...base, raceId, accusedDriverId: driverId, accusedName: driverId });
    return dbDecideReport(p, r, { status: "PENALTY", penaltyKind: "WARNING", licencePoints: points, ...extra });
  }

  it("refuses points outside 0 to 12, and fractions", async () => {
    const p = makePrisma();
    const r = await dbCreateReport(p, base);
    for (const bad of [-1, 13, 2.5, "lots"]) {
      await expect(dbDecideReport(p, r, { status: "PENALTY", licencePoints: bad })).rejects.toThrow(/0 to 12/);
    }
    expect((await dbDecideReport(p, r, { status: "PENALTY", licencePoints: "12" })).licencePoints).toBe(12);
    expect((await dbDecideReport(p, r, { status: "PENALTY", licencePoints: "" })).licencePoints).toBe(null);
  });

  it("adds up per PERSON within the season of the report's race", async () => {
    // d2 and d2b are the same human on two rows of one season (a team change
    // mid-season); d9 is somebody else. The S6 points belong to last season.
    personLinks = [["steve", ["d2", "d2b"]]];
    const p = makePrisma({ races: [...S7, ...S6] });
    await penalise(p, "r1", "d2", 3);
    await penalise(p, "r2", "d2b", 4);
    await penalise(p, "r2", "d9", 2);
    await penalise(p, "old", "d2", 10);
    const { drivers, threshold } = await dbLicenceTable(p, "s7");
    expect(threshold).toBe(DEFAULT_LICENCE_THRESHOLD);
    expect(drivers.map((d) => [d.key, d.points, d.decisions])).toEqual([
      ["steve", 7, 2],
      ["d9", 2, 1],
    ]);
    expect((await dbLicenceTable(p, "s6")).drivers.map((d) => [d.key, d.points])).toEqual([["steve", 10]]);
  });

  it("only counts decisions that stand as penalties", async () => {
    const p = makePrisma({ races: S7 });
    await penalise(p, "r1", "d2", 5);
    // Reversed afterwards: the points stay in the column and count for nothing.
    const reversed = await penalise(p, "r2", "d2", 6);
    await dbDecideReport(p, reversed, { status: "NO_PENALTY", licencePoints: 6 });
    // Not decided yet at all.
    await dbCreateReport(p, { ...base, raceId: "r3", accusedDriverId: "d2" });
    const [row] = (await dbLicenceTable(p, "s7")).drivers;
    expect(row.points).toBe(5);
    expect(row.decisions).toBe(1);
  });

  it("flags a driver as due a ban on REACHING the threshold, and the threshold is a setting", async () => {
    const p = makePrisma({ races: S7 });
    await penalise(p, "r1", "d2", 6);
    await penalise(p, "r2", "d2", 5);
    await penalise(p, "r3", "d2", 1);
    await penalise(p, "r1", "d9", 11);
    const flags = async () => Object.fromEntries((await dbLicenceTable(p, "s7")).drivers.map((d) => [d.key, d.flagged]));
    expect(await flags()).toEqual({ d2: true, d9: false });
    await writeLicenceThreshold(p, 10);
    expect(await readLicenceThreshold(p)).toBe(10);
    expect(await flags()).toEqual({ d2: true, d9: true });
    await expect(writeLicenceThreshold(p, 0)).rejects.toThrow(/1 to 99/);
    await expect(writeLicenceThreshold(p, "x")).rejects.toThrow(/1 to 99/);
  });

  it("sorts most points first", () => {
    const rep = (id, d, pts) => ({ id, status: "PENALTY", accusedDriverId: d, accusedName: d, licencePoints: pts });
    const t = licenceTable([rep("1", "a", 1), rep("2", "b", 5), rep("3", "c", 0), rep("4", "a", 1)]);
    expect(t.map((x) => x.key)).toEqual(["b", "a", "c"]);
  });

  it("gives the named driver's season in race order with a running total", async () => {
    personLinks = [["steve", ["d2", "d2b"]]];
    const p = makePrisma({ races: [...S7, ...S6] });
    // Filed out of order on purpose: round 3 first, then round 1.
    const third = await penalise(p, "r3", "d2", 2);
    await penalise(p, "r1", "d2b", 4, { penaltyKind: "TIME", penaltySeconds: 5 });
    await penalise(p, "old", "d2", 9);
    await penalise(p, "r2", "d9", 3);
    const open = await dbCreateReport(p, { ...base, raceId: "r2", accusedDriverId: "d2", accusedName: "Steve" });
    const rec = await dbDriverRecord(p, open);
    expect(rec.seasonId).toBe("s7");
    expect(rec.entries.map((e) => [e.raceId, e.runningTotal, e.current])).toEqual([
      ["r1", 4, false],
      ["r2", 4, true],
      ["r3", 6, false],
    ]);
    expect(rec.entries[0]).toMatchObject({ penaltyKind: "TIME", penaltySeconds: 5, licencePoints: 4, counts: true });
    expect(rec.entries[2].id).toBe(third.id);
    expect(rec.total).toBe(6);
    expect(rec.flagged).toBe(false);
  });

  it("has no record for a report that names nobody or no round", async () => {
    const p = makePrisma({ races: S7 });
    expect(await dbDriverRecord(p, await dbCreateReport(p, { ...base, raceId: "r1" }))).toBe(null);
    expect(await dbDriverRecord(p, await dbCreateReport(p, { ...base, accusedDriverId: "d2" }))).toBe(null);
  });
});
