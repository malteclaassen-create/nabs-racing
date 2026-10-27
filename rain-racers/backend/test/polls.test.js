import { describe, it, expect } from "vitest";
import { pollOut, comboName } from "../src/lib/polls.js";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const options = [
  { id: 1, car: "Renault Twingo", track: "Bikernieki", note: null },
  { id: 2, car: "Ferrari F2004", track: "Magny-Cours", note: null },
  { id: 3, car: "NASCAR Cup", track: "Daytona", note: "oval" },
];
const poll = (extra = {}) => ({
  id: 7,
  closesAt: "2026-10-30T18:00:00Z",
  appliedOptionId: null,
  options,
  votes: [
    { userId: 10, optionId: 2 },
    { userId: 11, optionId: 2 },
    { userId: 12, optionId: 3 },
  ],
  race: { id: 5, round: 5, name: "Week 45", startsAt: "2026-11-07T19:10:00Z", _count: { results: 0 } },
  ...extra,
});

describe("combo votes", () => {
  it("counts the votes per combo and finds the leader", () => {
    const out = pollOut(poll(), { now: NOW });
    expect(out.options.map((o) => o.votes)).toEqual([0, 2, 1]);
    expect(out).toMatchObject({ open: true, total: 3, leaders: [2], winnerId: null, applied: false });
  });
  it("tells a member their own pick, and nobody who voted for what", () => {
    expect(pollOut(poll(), { userId: 12, now: NOW }).myVote).toBe(3);
    expect(pollOut(poll(), { userId: 99, now: NOW }).myVote).toBe(null);
    expect(JSON.stringify(pollOut(poll(), { now: NOW }))).not.toContain("userId");
  });
  it("names the winner once the vote has closed", () => {
    expect(pollOut(poll({ closesAt: "2026-10-26T18:00:00Z" }), { now: NOW })).toMatchObject({ open: false, winnerId: 2 });
  });
  it("leaves a tie to the league", () => {
    const tied = poll({ closesAt: "2026-10-26T18:00:00Z", votes: [{ userId: 10, optionId: 1 }, { userId: 11, optionId: 3 }] });
    expect(pollOut(tied, { now: NOW })).toMatchObject({ open: false, leaders: [1, 3], winnerId: null });
  });
  it("closes when the admin picks a combo, even one that did not lead", () => {
    expect(pollOut(poll({ appliedOptionId: 3 }), { now: NOW })).toMatchObject({ open: false, applied: true, winnerId: 3 });
  });
  it("closes when the round has results", () => {
    expect(pollOut(poll({ race: { id: 5, round: 5, name: "x", startsAt: "", _count: { results: 4 } } }), { now: NOW }).open).toBe(false);
  });
  it("has no leader without votes", () => {
    expect(pollOut(poll({ votes: [], closesAt: "2026-10-26T18:00:00Z" }), { now: NOW })).toMatchObject({ total: 0, leaders: [], winnerId: null });
  });
  it("names a round after its combo", () => {
    expect(comboName(options[1])).toBe("Ferrari F2004 at Magny-Cours");
    expect(comboName({ car: "Mazda RX-8", track: "" })).toBe("Mazda RX-8");
  });
});
