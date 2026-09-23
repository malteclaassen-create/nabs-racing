import test from "node:test";
import assert from "node:assert/strict";
import { filterReports, penaltyLabel, penaltySummary, resultsGap } from "./reportDesk.mjs";

const rep = (over = {}) => ({
  id: "x",
  status: "NEW",
  source: "SITE",
  raceId: "r1",
  reporterName: "13bot",
  accusedDriverId: "d2",
  accusedName: "mtimmis",
  ...over,
});

test("only a TIME penalty can be missing from the results", () => {
  assert.equal(resultsGap(rep({ status: "PENALTY", penaltyKind: "TIME", penaltySeconds: 5 })), "decided +5s, not yet in results");
  assert.equal(resultsGap(rep({ status: "PENALTY", penaltyKind: "TIME", penaltySeconds: 5, appliedSeconds: 5 })), null);
  assert.equal(
    resultsGap(rep({ status: "PENALTY", penaltyKind: "TIME", penaltySeconds: 10, appliedSeconds: 5 })),
    "decided +10s, results have +5s"
  );
  // No kind stored is a penalty from before kinds, which was seconds.
  assert.equal(resultsGap(rep({ status: "PENALTY", penaltySeconds: 5 })), "decided +5s, not yet in results");
  assert.equal(resultsGap(rep({ status: "PENALTY", penaltyKind: "WARNING" })), null);
  assert.equal(resultsGap(rep({ status: "PENALTY", penaltyKind: "DSQ", appliedSeconds: 0 })), null);
});

test("seconds written and then taken back are still in the results until the editor saves", () => {
  assert.equal(resultsGap(rep({ status: "NO_PENALTY", appliedSeconds: 5 })), "+5s still in results");
  assert.equal(resultsGap(rep({ status: "PENALTY", penaltyKind: "WARNING", appliedSeconds: 5 })), "+5s still in results");
});

test("a penalty reads as its kind, with its points", () => {
  assert.equal(penaltyLabel(rep({ status: "PENALTY", penaltyKind: "TIME", penaltySeconds: 5 })), "+5s");
  assert.equal(penaltyLabel(rep({ status: "PENALTY", penaltyKind: "GRID" })), "Grid drop");
  assert.equal(penaltyLabel(rep({ status: "NO_PENALTY", penaltySeconds: 5 })), null);
  assert.equal(penaltySummary(rep({ status: "PENALTY", penaltySeconds: 5, licencePoints: 2 })), "5s, 2 licence points");
  assert.equal(penaltySummary(rep({ status: "PENALTY", penaltyKind: "WARNING", licencePoints: 1 })), "warning, 1 licence point");
  assert.equal(penaltySummary(rep({ status: "PENALTY", penaltyKind: "TIME" })), null);
});

test("the list filters combine", () => {
  const all = [
    rep({ id: "a" }),
    rep({ id: "b", status: "PENALTY", raceId: "r2", source: "INGAME" }),
    rep({ id: "c", accusedDriverId: null, accusedName: null, reporterName: "Steve" }),
    rep({ id: "d", raceId: null, accusedName: "Max Power" }),
  ];
  const ids = (f) => filterReports(all, f).map((r) => r.id);
  assert.deepEqual(ids({ show: "open" }), ["a", "c", "d"]);
  assert.deepEqual(ids({ show: "decided" }), ["b"]);
  assert.deepEqual(ids({ show: "all", raceId: "r2" }), ["b"]);
  assert.deepEqual(ids({ show: "all", raceId: "none" }), ["d"]);
  assert.deepEqual(ids({ show: "all", source: "INGAME" }), ["b"]);
  assert.deepEqual(ids({ show: "all", unnamed: true }), ["c"]);
  // Either side of the report, any case, part of a name.
  assert.deepEqual(ids({ show: "all", q: "power" }), ["d"]);
  assert.deepEqual(ids({ show: "all", q: "STEVE" }), ["c"]);
  assert.deepEqual(ids({ show: "open", q: "mtim" }), ["a"]);
});
