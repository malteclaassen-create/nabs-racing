import { describe, it, expect } from "vitest";
import { personKey, collapseByPerson, byNewestAnswer, duplicateRsvps } from "./onePerPerson.js";

// One person, one answer. The case this exists for: somebody signs up, changes
// their handle, logs in again onto a second roster row of the SAME season, and
// answers again — so the entry list showed "urma" and "urmagaeddon" one above
// the other and the grid counted two cars for one driver.
//
// urma (d1) and urmagaeddon (d2) are one person; steve (d9) is not linked to
// anybody, which is the ordinary case and must keep behaving as it always did.
const byDriver = new Map([
  ["d1", "p1"],
  ["d2", "p1"],
]);

const rsvp = (driverId, status, updatedAt) => ({ driverId, status, updatedAt });

describe("who a row belongs to", () => {
  it("answers with the person where there is one", () => {
    expect(personKey("d1", byDriver)).toBe("p1");
    expect(personKey("d2", byDriver)).toBe("p1");
  });

  it("makes an unlinked row its own person", () => {
    // And never one that could collide with a personId.
    expect(personKey("d9", byDriver)).toBe("row:d9");
    expect(personKey("p1", byDriver)).toBe("row:p1");
  });
});

describe("collapsing a race's answers", () => {
  it("keeps one line per person and leaves everybody else alone", () => {
    const { kept } = collapseByPerson(
      [
        rsvp("d1", "ACCEPTED", "2026-08-01T10:00:00Z"),
        rsvp("d2", "ACCEPTED", "2026-08-02T10:00:00Z"),
        rsvp("d9", "ACCEPTED", "2026-08-01T10:00:00Z"),
      ],
      byDriver,
      byNewestAnswer
    );
    expect(kept.map((r) => r.driverId).sort()).toEqual(["d2", "d9"]);
  });

  it("takes the answer they gave LAST, whichever row it was on", () => {
    // Accepted as urma, renamed, then declined as urmagaeddon: they are not
    // coming, however emphatically the older row still says otherwise.
    const { kept } = collapseByPerson(
      [
        rsvp("d1", "ACCEPTED", "2026-08-01T10:00:00Z"),
        rsvp("d2", "DECLINED", "2026-08-05T10:00:00Z"),
      ],
      byDriver,
      byNewestAnswer
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].status).toBe("DECLINED");
  });

  it("takes it just the same when the newest one came in first", () => {
    // The database hands rows back in no particular order, so the newest
    // answer has to win from either side of the comparison.
    const { kept } = collapseByPerson(
      [
        rsvp("d2", "DECLINED", "2026-08-05T10:00:00Z"),
        rsvp("d1", "ACCEPTED", "2026-08-01T10:00:00Z"),
      ],
      byDriver,
      byNewestAnswer
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].status).toBe("DECLINED");
  });

  it("hands back the losers, so they can be cleared out of the table", () => {
    const rows = [
      rsvp("d1", "ACCEPTED", "2026-08-01T10:00:00Z"),
      rsvp("d2", "DECLINED", "2026-08-05T10:00:00Z"),
      rsvp("d9", "ACCEPTED", "2026-08-01T10:00:00Z"),
    ];
    expect(duplicateRsvps(rows, byDriver).map((r) => r.driverId)).toEqual(["d1"]);
  });

  it("changes nothing at all for a league with no linked rows", () => {
    const rows = [rsvp("d1", "ACCEPTED", "x"), rsvp("d2", "DECLINED", "y"), rsvp("d9", "TENTATIVE", "z")];
    const { kept, dropped } = collapseByPerson(rows, new Map(), byNewestAnswer);
    expect(kept).toEqual(rows);
    expect(dropped).toEqual([]);
  });

  it("survives a missing link table and an empty race", () => {
    expect(collapseByPerson([], byDriver, byNewestAnswer).kept).toEqual([]);
    expect(collapseByPerson(null, undefined, byNewestAnswer).kept).toEqual([]);
    expect(personKey("d1", undefined)).toBe("row:d1");
  });

  it("ranks a real team above the reserve pool when asked to", () => {
    // The chase list is read per team, and a person parked in the Reserve pool
    // on one row while racing for a team on another is racing for the team.
    const rows = [
      { driverId: "d1", team: { tier: 0 } },
      { driverId: "d2", team: { tier: 1 } },
    ];
    const { kept } = collapseByPerson(rows, byDriver, (d) => (d.team.tier === 0 ? 0 : 1));
    expect(kept).toHaveLength(1);
    expect(kept[0].driverId).toBe("d2");
  });

  it("keeps an answer with no timestamp rather than losing the person", () => {
    // A row written before updatedAt existed ranks lowest, but if it is all
    // the person has it still has to be the line they get.
    const { kept } = collapseByPerson([rsvp("d1", "ACCEPTED", null)], byDriver, byNewestAnswer);
    expect(kept).toHaveLength(1);
    expect(kept[0].driverId).toBe("d1");
  });
});
