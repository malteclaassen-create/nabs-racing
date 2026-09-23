import { describe, it, expect } from "vitest";
import { silentRoster, splitByReach } from "./stillToAnswer.js";
import { sendAttendancePing, previewAttendancePing, ATTENDANCE_PING_KEY } from "./notifications.js";

// Two full-timers, one reserve, and a Reserve-pool row that belongs to the
// first full-timer (linked as one person).
const rows = [
  { id: "a", team: { tier: 1 } },
  { id: "b", team: { tier: 2 } },
  { id: "r", team: { tier: 0 } },
  { id: "a-pool", team: { tier: 0 } },
];
const byDriver = new Map([
  ["a", "pa"],
  ["a-pool", "pa"],
]);

describe("silentRoster", () => {
  it("is the roster minus the answers, per person", () => {
    const { roster, silent } = silentRoster({ rows, rsvps: [{ driverId: "b" }], byDriver });
    expect(roster.map((d) => d.id).sort()).toEqual(["a", "b", "r"]);
    expect(silent.map((d) => d.id).sort()).toEqual(["a", "r"]);
  });

  it("counts an answer given on a person's other row", () => {
    const { silent } = silentRoster({ rows, rsvps: [{ driverId: "a-pool" }], byDriver });
    expect(silent.map((d) => d.id).sort()).toEqual(["b", "r"]);
  });
});

describe("splitByReach", () => {
  it("sends one note per login and counts the rest", () => {
    const silent = [{ id: "a" }, { id: "b" }, { id: "r" }, { id: "x" }];
    const ids = new Map([
      ["a", "u1"],
      ["b", "u2"],
      ["x", "u1"], // same login twice: one note
    ]);
    const { recipients, withoutLogin } = splitByReach(silent, ids, new Set(["u1"]));
    expect(recipients).toEqual(["u1"]);
    // b has a login that never signed in, r has none at all.
    expect(withoutLogin).toBe(2);
  });
});

// A prisma stand-in for the reminder: one race, the roster above, the answers,
// the logins, and the Setting + Notification writes it makes.
function fakePrisma({ rsvps = [], discord = {}, members = [], hidden = [], completed = false } = {}) {
  const settings = new Map();
  const notes = [];
  return {
    settings,
    notes,
    race: {
      findUnique: async () => ({ id: "race1", seasonId: "s1", number: 4, track: "Spa", isCompleted: completed }),
    },
    driver: { findMany: async () => rows },
    raceRsvp: { findMany: async () => rsvps },
    setting: {
      findUnique: async ({ where }) => {
        if (where.key === "attendance_hidden") return { key: where.key, value: JSON.stringify(hidden) };
        return settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null;
      },
      upsert: async ({ where, create }) => settings.set(where.key, create.value),
    },
    $queryRaw: async () => [...byDriver.entries()].map(([driverId, personId]) => ({ driverId, personId })),
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('FROM "MemberAccount"')) {
        return args.filter((id) => members.includes(id)).map((discordId) => ({ discordId }));
      }
      if (sql.includes('FROM "Driver"')) {
        return args
          .map((id) => ({ id, discordUserId: discord[id] || null }))
          .filter((r) => !sql.includes("IS NOT NULL") || r.discordUserId);
      }
      return [];
    },
    $executeRaw: async (strings, ...values) => {
      // INSERT OR IGNORE INTO "Notification" (id,type,title,body,link,recipientId,dedupeKey,createdAt)
      notes.push({ type: values[1], title: values[2], recipientId: values[5], dedupeKey: values[6] });
    },
  };
}

describe("sendAttendancePing", () => {
  it("reminds only the silent drivers who can be reached, personally", async () => {
    const p = fakePrisma({
      rsvps: [{ driverId: "b" }],
      discord: { "a-pool": "ua", b: "ub", r: "ur" },
      members: ["ua", "ub"],
    });
    const res = await sendAttendancePing(p, "race1");
    // b answered; a is reached through the login on their other row; r's
    // login never signed in.
    expect(res.sent).toBe(1);
    expect(res.withoutLogin).toBe(1);
    expect(p.notes.map((n) => n.recipientId)).toEqual(["ua"]);
    expect(p.notes.every((n) => n.recipientId)).toBe(true); // no broadcast
    const log = JSON.parse(p.settings.get(ATTENDANCE_PING_KEY));
    expect(log.race1).toMatchObject({ sent: 1, withoutLogin: 1 });
    expect(log.race1.at).toBe(res.lastSentAt);
  });

  it("answers a second press within the minute with the first one", async () => {
    const p = fakePrisma({ discord: { a: "ua" }, members: ["ua"] });
    const first = await sendAttendancePing(p, "race1");
    const second = await sendAttendancePing(p, "race1");
    expect(second.repeated).toBe(true);
    expect(second.lastSentAt).toBe(first.lastSentAt);
    expect(p.notes).toHaveLength(1);
  });

  it("refuses completed and hidden races", async () => {
    await expect(sendAttendancePing(fakePrisma({ completed: true }), "race1")).rejects.toThrow(/completed/);
    await expect(sendAttendancePing(fakePrisma({ hidden: ["race1"] }), "race1")).rejects.toThrow(/hidden/);
  });

  it("previews without sending", async () => {
    const p = fakePrisma({ discord: { a: "ua", b: "ub" }, members: ["ua"] });
    const pre = await previewAttendancePing(p, "race1");
    expect(pre).toMatchObject({ silent: 3, reachable: 1, withoutLogin: 2, lastSentAt: null });
    expect(p.notes).toHaveLength(0);
  });
});
