// The one thing this guard keeps getting wrong: counting a zero-point
// constructor row as a race the team took part in.
import { describe, it, expect } from "vitest";
import { teamDeletionBlockers } from "./teamDeletion.js";

describe("teamDeletionBlockers", () => {
  it("lets a team with nothing on it go", () => {
    expect(teamDeletionBlockers({})).toEqual([]);
  });

  it("does not count rounds the team sat out on 0 (the blank standings rows)", () => {
    // scoredRounds only ever counts rows whose points moved, so a team six
    // rounds into a season with 0 everywhere has nothing here to report.
    expect(teamDeletionBlockers({ drivers: 0, scoredRounds: 0 })).toEqual([]);
  });

  it("blocks on a round the team actually scored in", () => {
    expect(teamDeletionBlockers({ scoredRounds: 2 })).toEqual(["2 round(s) where it scored points"]);
  });

  it("names both kinds of result separately", () => {
    // `subResults` is the reserve-sub relation, `stampedResults` the team a
    // round was saved under — different columns, different fixes.
    expect(teamDeletionBlockers({ subResults: 1, stampedResults: 3 })).toEqual([
      "1 race result(s) subbed for it",
      "3 race result(s) scored under it",
    ]);
  });

  it("reads drivers first, then results, then points", () => {
    expect(teamDeletionBlockers({ drivers: 2, subResults: 1, stampedResults: 1, scoredRounds: 1 })).toEqual([
      "2 driver(s) in its seats",
      "1 race result(s) subbed for it",
      "1 race result(s) scored under it",
      "1 round(s) where it scored points",
    ]);
  });

  it("refuses while a recorded transfer still names the team", () => {
    // DriverTeamChange has no foreign key: without this the round the transfer
    // starts at would be saved under a team id that no longer exists.
    expect(teamDeletionBlockers({ transfers: 2 })).toEqual(["2 recorded driver transfer(s) to it"]);
  });
});
