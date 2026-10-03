import { describe, it, expect } from "vitest";
import { planAccountLink } from "./accountLinks.js";
import { mainOf } from "./members.js";

// One driver, two Discord accounts. The rules that decide which account a
// login acts as, and what linking two accounts does to their driver rows.

describe("mainOf", () => {
  it("leaves an ordinary account as it is", () => {
    expect(mainOf(new Map(), "a")).toBe("a");
  });

  it("sends a second account to its main", () => {
    expect(mainOf(new Map([["b", "a"]]), "b")).toBe("a");
  });

  it("follows a chain to its end and stops on a loop", () => {
    expect(mainOf(new Map([["c", "b"], ["b", "a"]]), "c")).toBe("a");
    // A hand-edited loop must not hang every request.
    expect(["a", "b"]).toContain(mainOf(new Map([["a", "b"], ["b", "a"]]), "a"));
  });

  it("answers in strings, whatever the id came in as", () => {
    expect(mainOf(new Map([["997", "1479"]]), 997)).toBe("1479");
  });
});

describe("planAccountLink", () => {
  const row = (id) => ({ id });

  it("refuses an account twice, also through an existing link", () => {
    expect(planAccountLink({ altId: "a", mainId: "a", altMap: new Map() }).error).toBeTruthy();
    // b is already a second account of a: making a a second account of b
    // would be a loop.
    expect(planAccountLink({ altId: "a", mainId: "b", altMap: new Map([["b", "a"]]) }).error).toBeTruthy();
  });

  it("links under the main of a second account, so links stay one level deep", () => {
    const plan = planAccountLink({ altId: "c", mainId: "b", altMap: new Map([["b", "a"]]) });
    expect(plan.main).toBe("a");
    expect(plan.alt).toBe("c");
  });

  it("hands the second account's row to a main without one", () => {
    expect(planAccountLink({ altId: "b", mainId: "a", altMap: new Map(), altRow: row("shinso_s8_s7") }).rows).toBe("move");
  });

  it("joins the two rows as one person when both accounts have one", () => {
    // Shinso: the F1 row on the old account, the F3 Alpine row on the new.
    const plan = planAccountLink({
      altId: "1479",
      mainId: "997",
      altMap: new Map(),
      altRow: row("shinso_s8_s7"),
      mainRow: row("shinso_s8"),
    });
    expect(plan.rows).toBe("join");
  });

  it("touches no row when the second account has none", () => {
    expect(planAccountLink({ altId: "b", mainId: "a", altMap: new Map(), mainRow: row("x") }).rows).toBe("none");
    expect(planAccountLink({ altId: "b", mainId: "a", altMap: new Map() }).rows).toBe("none");
  });
});
