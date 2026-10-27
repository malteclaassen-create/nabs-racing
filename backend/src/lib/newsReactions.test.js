import { describe, it, expect } from "vitest";
import { REACTIONS, readReaction, summarise, reactionRateCheck, isCrawler } from "./newsReactions.js";

describe("readReaction", () => {
  it("takes an emoji from the set on an article or a comment", () => {
    expect(readReaction({ target: "article", emoji: "🔥" })).toEqual({ targetType: "article", targetId: "", emoji: "🔥" });
    expect(readReaction({ target: "comment", id: "c1c1c1c1", emoji: "💀" })).toEqual({
      targetType: "comment",
      targetId: "c1c1c1c1",
      emoji: "💀",
    });
  });

  it("refuses anything else", () => {
    expect(readReaction({ target: "driver", emoji: "🔥" }).error).toBeTruthy();
    expect(readReaction({ target: "article", emoji: "🍆" }).error).toBeTruthy();
    expect(readReaction({ target: "article", emoji: "<script>" }).error).toBeTruthy();
    expect(readReaction(null).error).toBeTruthy();
  });
});

describe("summarise", () => {
  const rows = [
    { targetType: "article", targetId: "a1", discordId: "1", emoji: "🔥" },
    { targetType: "article", targetId: "a1", discordId: "2", emoji: "🔥" },
    { targetType: "article", targetId: "a1", discordId: "2", emoji: "👍" },
    { targetType: "comment", targetId: "c1", discordId: "1", emoji: "💀" },
  ];

  it("counts each emoji per target, says which are the viewer's, in the set's order", () => {
    const s = summarise(rows, "1");
    expect(s.article("a1")).toEqual([
      { emoji: "👍", count: 1, mine: false },
      { emoji: "🔥", count: 2, mine: true },
    ]);
    expect(s.comment("c1")).toEqual([{ emoji: "💀", count: 1, mine: true }]);
    expect(s.comment("nope")).toEqual([]);
    expect(summarise(rows, null).article("a1").some((r) => r.mine)).toBe(false);
  });

  it("offers a handful of emoji, no duplicates", () => {
    expect(new Set(REACTIONS).size).toBe(REACTIONS.length);
    expect(REACTIONS.length).toBeLessThanOrEqual(10);
  });
});

describe("isCrawler", () => {
  it("knows a crawler from a browser", () => {
    expect(isCrawler("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
    expect(isCrawler("Discordbot/2.0")).toBe(true);
    expect(isCrawler("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari")).toBe(false);
    expect(isCrawler("")).toBe(false);
  });
});

describe("reactionRateCheck", () => {
  it("lets a member click about and stops a flood", () => {
    const id = `r-${Math.random()}`;
    for (let i = 0; i < 40; i += 1) expect(reactionRateCheck(id, 1000 + i)).toBe(null);
    expect(reactionRateCheck(id, 2000)).toBeTruthy();
    expect(reactionRateCheck(id, 70_000)).toBe(null);
  });
});
