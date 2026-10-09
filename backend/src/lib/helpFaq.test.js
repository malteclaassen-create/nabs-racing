import { describe, expect, it } from "vitest";
import { sanitizeHelpFaq } from "./helpFaq.js";

describe("sanitizeHelpFaq", () => {
  it("keeps topics with at least one complete question", () => {
    const out = sanitizeHelpFaq({
      topics: [
        { title: " Server ", items: [{ q: " Kicked? ", a: " Run the check. " }, { q: "no answer", a: "" }] },
        { title: "Empty", items: [] },
        { title: "", items: [{ q: "x", a: "y" }] },
      ],
    });
    expect(out).toEqual({ topics: [{ title: "Server", items: [{ q: "Kicked?", a: "Run the check." }] }] });
  });

  it("rejects what is not a topic list at all", () => {
    expect(sanitizeHelpFaq("nope")).toBeNull();
    expect(sanitizeHelpFaq({})).toBeNull();
  });

  it("caps sizes", () => {
    const out = sanitizeHelpFaq({ topics: [{ title: "t", items: [{ q: "q", a: "a".repeat(5000) }] }] });
    expect(out.topics[0].items[0].a).toHaveLength(3000);
  });
});
