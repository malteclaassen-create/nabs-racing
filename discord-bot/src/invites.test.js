import { describe, it, expect } from "vitest";
import { inviteUsed, snapshotFrom } from "./invites.js";
import { leagueDay, isStale } from "./day.js";

const snap = (o) => Object.fromEntries(Object.entries(o).map(([c, [uses, who]]) => [c, { uses, inviterId: who }]));

describe("inviteUsed", () => {
  it("picks the link whose count went up", () => {
    const before = snap({ aaa: [3, "steve"], bbb: [7, "malte"] });
    const after = snap({ aaa: [4, "steve"], bbb: [7, "malte"] });
    expect(inviteUsed(before, after)).toBe("steve");
  });

  it("null when two links moved at once", () => {
    const before = snap({ aaa: [3, "steve"], bbb: [7, "malte"] });
    const after = snap({ aaa: [4, "steve"], bbb: [8, "malte"] });
    expect(inviteUsed(before, after)).toBe(null);
  });

  it("null when nothing moved", () => {
    const same = snap({ aaa: [3, "steve"] });
    expect(inviteUsed(same, same)).toBe(null);
  });

  it("unknown link counts from zero", () => {
    expect(inviteUsed(snap({}), snap({ new: [1, "steve"] }))).toBe("steve");
  });

  it("single-use link that vanished", () => {
    expect(inviteUsed(snap({ once: [0, "steve"] }), snap({}))).toBe("steve");
  });

  it("null when several links vanished", () => {
    expect(inviteUsed(snap({ one: [0, "steve"], two: [0, "malte"] }), snap({}))).toBe(null);
  });

  it("vanity url credits nobody", () => {
    expect(inviteUsed(snap({ nabs: [100, null] }), snap({ nabs: [101, null] }))).toBe(null);
  });

  it("handles missing input", () => {
    expect(inviteUsed(null, null)).toBe(null);
    expect(inviteUsed(undefined, snap({ aaa: [1, "steve"] }))).toBe("steve");
  });
});

describe("snapshotFrom", () => {
  it("keeps uses and inviter", () => {
    const out = snapshotFrom([
      { code: "aaa", uses: 4, inviter: { id: "steve" } },
      { code: "bbb", uses: null, inviterId: "malte" },
    ]);
    expect(out).toEqual({
      aaa: { uses: 4, inviterId: "steve" },
      bbb: { uses: 0, inviterId: "malte" },
    });
  });
});

describe("leagueDay", () => {
  it("uses german time", () => {
    expect(leagueDay(Date.parse("2026-06-01T22:30:00Z"))).toBe("2026-06-02");
    expect(leagueDay(Date.parse("2026-01-01T22:30:00Z"))).toBe("2026-01-01");
  });

  it("isStale after 35 days", () => {
    const now = Date.parse("2026-09-18T12:00:00Z");
    expect(isStale("2026-09-18", now)).toBe(false);
    expect(isStale("2026-08-20", now)).toBe(false);
    expect(isStale("2026-07-01", now)).toBe(true);
  });
});
