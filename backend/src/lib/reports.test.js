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
}));

const {
  dbCreateReport, dbAddMessage, dbDecideReport, canRead, readersOf, dbSetAccused, dbRepointAccused,
  dbLinkedReports, dbEnsureIncidentGroup,
  dbAddAttachment, dbAttachments, dbDeleteReport, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES,
  dbReportsFor, roleOn, dbPenaltiesForRace, dbMarkPenaltiesApplied,
} = await import("./reports.js");

// A report is a PRIVATE conversation, and everything below is about who is let
// into one and who is told what. Both are easy to break from a long way away —
// the readers are resolved through the person links, and every notification is
// deduplicated — so they are pinned here.

let rows;

function makePrisma() {
  rows = { Report: [], ReportMessage: [], ReportViewer: [], ReportAttachment: [] };
  return {
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
      } else if (sql.startsWith('UPDATE "Report" SET "status"')) {
        const r = rows.Report.find((x) => x.id === a[4]);
        Object.assign(r, { status: a[0], verdict: a[1], penaltySeconds: a[2], updatedAt: a[3] });
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
      if (sql.includes('FROM "Report" WHERE "raceId"'))
        return rows.Report.filter(
          (r) => r.raceId === a[0] && ["PENALTY", "NO_PENALTY", "DISMISSED"].includes(r.status)
        );
      if (sql.includes('FROM "Report" ORDER BY')) return [...rows.Report];
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
