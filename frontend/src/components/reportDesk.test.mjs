import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterReports, penaltyLabel, penaltySummary, resultsGap, reasonLabel, decisionProblem, withdrawText, isWithdrawn,
} from "./reportDesk.mjs";

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

test("a penalty reads as its kind", () => {
  assert.equal(penaltyLabel(rep({ status: "PENALTY", penaltyKind: "TIME", penaltySeconds: 5 })), "+5s");
  assert.equal(penaltyLabel(rep({ status: "PENALTY", penaltyKind: "GRID" })), "Grid drop");
  assert.equal(penaltyLabel(rep({ status: "NO_PENALTY", penaltySeconds: 5 })), null);
  assert.equal(penaltySummary(rep({ status: "PENALTY", penaltySeconds: 5 })), "5s");
  assert.equal(penaltySummary(rep({ status: "PENALTY", penaltyKind: "WARNING" })), "warning");
  assert.equal(penaltySummary(rep({ status: "NO_PENALTY", penaltyKind: "WARNING" })), null);
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

describe("decision reasons", () => {
  it("shows the reason only on a decision, and never N/A or Other", () => {
    assert.equal(reasonLabel({ status: "PENALTY", decisionReason: "UNSAFE_REJOIN" }), "Unsafe rejoin");
    assert.equal(reasonLabel({ status: "NO_PENALTY", decisionReason: "RACING_INCIDENT" }), "Racing incident");
    assert.equal(reasonLabel({ status: "NO_PENALTY", decisionReason: "NA" }), null);
    assert.equal(reasonLabel({ status: "PENALTY", decisionReason: "OTHER" }), null);
    assert.equal(reasonLabel({ status: "REVIEWING", decisionReason: "UNSAFE_REJOIN" }), null);
  });

  it("will not save a decision without a reason, or Other without words", () => {
    assert.equal(decisionProblem({ status: "REVIEWING" }), null);
    assert.equal(decisionProblem({ status: "PENALTY", decisionReason: "" }), "Pick a reason first.");
    assert.equal(decisionProblem({ status: "NO_PENALTY", decisionReason: "OTHER", verdict: " " }), "Other needs a line saying why.");
    assert.equal(decisionProblem({ status: "NO_PENALTY", decisionReason: "OTHER", verdict: "Lag" }), null);
  });
});

describe("withdrawn reports", () => {
  it("reads the reason with the note after it, or the note alone for Other", () => {
    assert.equal(withdrawText({ withdrawnAt: "x", withdrawReason: "SORTED" }), "Sorted it out with the driver");
    assert.equal(
      withdrawText({ withdrawnAt: "x", withdrawReason: "MISTAKE", withdrawNote: "Wrong car" }),
      "Filed by mistake. Wrong car"
    );
    assert.equal(withdrawText({ withdrawnAt: "x", withdrawReason: "OTHER", withdrawNote: "We spoke" }), "We spoke");
    assert.equal(withdrawText({ withdrawReason: "SORTED" }), null);
  });

  it("is a closed report with a withdrawal date", () => {
    assert.equal(isWithdrawn({ status: "DISMISSED", withdrawnAt: "x" }), true);
    assert.equal(isWithdrawn({ status: "DISMISSED" }), false);
    assert.equal(isWithdrawn({ status: "PENALTY", withdrawnAt: "x" }), false);
  });
});
