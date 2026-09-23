import { describe, it, expect } from "vitest";
import {
  validateAnnouncement, checkLink, audienceRows, resolveAudience, discordText, findDuplicate,
  ANNOUNCE_LIMITS, ANNOUNCE_REPEAT_MS,
} from "./announcements.js";

const base = { id: "a1b2c3d4e5", title: "Server move tonight", audience: "everyone", channels: { bell: true } };

describe("validateAnnouncement", () => {
  it("accepts a minimal announcement and tidies the text", () => {
    const { value, error } = validateAnnouncement({ ...base, title: "  Server   move tonight ", body: "Line one\r\n\r\n\r\n\r\nLine two  " });
    expect(error).toBeUndefined();
    expect(value.title).toBe("Server move tonight");
    expect(value.body).toBe("Line one\n\nLine two");
    expect(value.link).toBeNull();
    expect(value.channels).toEqual({ bell: true, discord: false });
  });

  it("needs a title", () => {
    expect(validateAnnouncement({ ...base, title: "   " }).error).toMatch(/title/);
  });

  it("holds the length limits", () => {
    expect(validateAnnouncement({ ...base, title: "x".repeat(ANNOUNCE_LIMITS.title) }).error).toBeUndefined();
    expect(validateAnnouncement({ ...base, title: "x".repeat(ANNOUNCE_LIMITS.title + 1) }).error).toMatch(/too long/);
    expect(validateAnnouncement({ ...base, body: "x".repeat(ANNOUNCE_LIMITS.body + 1) }).error).toMatch(/too long/);
    expect(validateAnnouncement({ ...base, link: `/${"x".repeat(ANNOUNCE_LIMITS.link)}` }).error).toMatch(/too long/);
  });

  it("refuses invisible characters", () => {
    expect(validateAnnouncement({ ...base, title: "Race\u202etonight" }).error).toMatch(/invisible/);
    expect(validateAnnouncement({ ...base, body: "ok\u0007" }).error).toMatch(/invisible/);
  });

  it("needs a known audience and at least one channel", () => {
    expect(validateAnnouncement({ ...base, audience: "admins" }).error).toMatch(/who/);
    expect(validateAnnouncement({ ...base, audience: "toString" }).error).toMatch(/who/);
    expect(validateAnnouncement({ ...base, channels: {} }).error).toMatch(/channel/);
    // Only a real true counts: "false" as a string is not a yes.
    expect(validateAnnouncement({ ...base, channels: { bell: "false" } }).error).toMatch(/channel/);
  });

  it("needs a well-formed id, the thing that makes a retry harmless", () => {
    expect(validateAnnouncement({ ...base, id: "" }).error).toMatch(/id/);
    expect(validateAnnouncement({ ...base, id: "short" }).error).toMatch(/id/);
    expect(validateAnnouncement({ ...base, id: "has spaces in it" }).error).toMatch(/id/);
  });
});

describe("checkLink", () => {
  it("takes site paths and http(s) addresses", () => {
    expect(checkLink("/attendance?race=1")).toEqual({ link: "/attendance?race=1" });
    expect(checkLink("https://example.com/ab")).toEqual({ link: "https://example.com/ab" });
    expect(checkLink("http://example.com")).toEqual({ link: "http://example.com/" });
    expect(checkLink("")).toEqual({ link: null });
    expect(checkLink(null)).toEqual({ link: null });
  });

  it("refuses everything else", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,hi",
      "tour:welcome",
      "//evil.example/path",
      "/\\evil.example",
      "attendance",
      "ftp://example.com/file",
      "/with space",
      "https://exa\u200bmple.com",
    ]) {
      expect(checkLink(bad).error, bad).toBeTruthy();
    }
  });
});

// A season roster: two full-timers and two reserves, plus a Reserve-pool row
// of a full-timer, linked to them as one person (a Tier-2 driver who was also
// parked in the pool).
const rows = [
  { id: "d1", team: { tier: 1 } },
  { id: "d2", team: { tier: 2 } },
  { id: "r1", team: { tier: 0 } },
  { id: "r2", team: { tier: 0 } },
  { id: "d2-reserve", team: { tier: 0 } },
];
const byDriver = new Map([
  ["d2", "p2"],
  ["d2-reserve", "p2"],
]);

describe("audienceRows", () => {
  it("counts people, not rows", () => {
    expect(audienceRows({ rows, byDriver, audience: "season" }).map((d) => d.id).sort()).toEqual(["d1", "d2", "r1", "r2"]);
  });

  it("puts a person with a real team among the full-timers, not the reserves", () => {
    expect(audienceRows({ rows, byDriver, audience: "fulltime" }).map((d) => d.id).sort()).toEqual(["d1", "d2"]);
    expect(audienceRows({ rows, byDriver, audience: "reserves" }).map((d) => d.id).sort()).toEqual(["r1", "r2"]);
  });
});

// Just enough prisma for resolveAudience: the roster, the person links, the
// Driver discord ids and the member accounts.
function fakePrisma({ discord = {}, members = [], banned = [] } = {}) {
  return {
    driver: { findMany: async () => rows },
    $queryRaw: async () => [...byDriver.entries()].map(([driverId, personId]) => ({ driverId, personId })),
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes("COUNT(*)")) return [{ n: members.filter((m) => !banned.includes(m)).length }];
      if (sql.includes('FROM "MemberAccount"')) {
        return args.filter((id) => members.includes(id) && !banned.includes(id)).map((discordId) => ({ discordId }));
      }
      if (sql.includes('FROM "Driver"')) {
        return args
          .filter((id) => rows.some((r) => r.id === id))
          .map((id) => ({ id, discordUserId: discord[id] || null }))
          .filter((r) => !sql.includes("IS NOT NULL") || r.discordUserId);
      }
      return [];
    },
  };
}

describe("resolveAudience", () => {
  const prisma = fakePrisma({
    // d2's login sits on the reserve row; it follows the person to d2.
    discord: { d1: "u1", "d2-reserve": "u2", r1: "u3", r2: "u4" },
    members: ["u1", "u2", "u3", "u4", "u9"],
    banned: ["u4"],
  });

  it("sends everyone ONE broadcast, sized by the members who can see it", async () => {
    const r = await resolveAudience(prisma, { audience: "everyone", seasonId: "s1" });
    expect(r.broadcast).toBe(true);
    expect(r.recipients).toEqual([]);
    expect(r.reach).toBe(4); // u9 has no driver but still sees a broadcast; u4 is banned
  });

  it("sends a narrower audience to the linked logins, counting who it cannot reach", async () => {
    const full = await resolveAudience(prisma, { audience: "fulltime", seasonId: "s1" });
    expect(full.broadcast).toBe(false);
    expect(full.recipients.sort()).toEqual(["u1", "u2"]);
    expect(full.withoutLogin).toBe(0);

    const reserves = await resolveAudience(prisma, { audience: "reserves", seasonId: "s1" });
    expect(reserves.recipients).toEqual(["u3"]);
    // r2's account is banned: counted, not notified.
    expect(reserves.withoutLogin).toBe(1);
    expect(reserves.drivers).toBe(2);

    const season = await resolveAudience(prisma, { audience: "season", seasonId: "s1" });
    expect(season.reach).toBe(3);
    expect(season.drivers).toBe(4);
  });

  it("reaches nobody when there is no season to send to", async () => {
    const r = await resolveAudience(prisma, { audience: "season", seasonId: null });
    expect(r).toMatchObject({ broadcast: false, reach: 0, recipients: [] });
  });
});

describe("discordText", () => {
  it("defuses mass mentions and makes a site path absolute", () => {
    const text = discordText({ title: "@everyone race", body: "ping @here", link: "/attendance" }, "https://nabs.example");
    expect(text).not.toMatch(/@everyone|@here/);
    expect(text).toContain("https://nabs.example/attendance");
  });

  it("leaves a web address alone", () => {
    expect(discordText({ title: "t", link: "https://x.example/y" }, "https://nabs.example")).toContain("\nhttps://x.example/y");
  });
});

describe("findDuplicate", () => {
  const sent = { ...validateAnnouncement(base).value, at: new Date(1_000_000).toISOString() };

  it("finds a retry by its id, however late", () => {
    expect(findDuplicate([sent], { ...sent, title: "changed" }, 1_000_000 + 10 * ANNOUNCE_REPEAT_MS)).toBe(sent);
  });

  it("treats the same words inside the window as a double submit", () => {
    const again = { ...sent, id: "zzzzzzzzzz" };
    expect(findDuplicate([sent], again, 1_000_000 + 1000)).toBe(sent);
    expect(findDuplicate([sent], again, 1_000_000 + ANNOUNCE_REPEAT_MS + 1)).toBeNull();
    expect(findDuplicate([sent], { ...again, audience: "reserves" }, 1_000_000 + 1000)).toBeNull();
  });
});
