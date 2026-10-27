import { describe, it, expect } from "vitest";
import { REACTIONS, readReaction, summarise, reactionRateCheck, isCrawler, isEmoji } from "./newsReactions.js";

describe("isEmoji", () => {
  it("takes any one emoji, joined ones and flags included", () => {
    for (const e of ["👍", "❤️", "🏎️", "🫡", "👍🏽", "👨‍👩‍👧", "🏳️‍🌈", "🇩🇪", "🇦🇺", "1️⃣", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"]) expect(isEmoji(e)).toBe(true);
  });

  it("refuses text, a row of emoji, and empty-looking things", () => {
    for (const e of ["", "a", "lol", "👍👍", "👍 ", "1", "#", "\u200D", "\uFE0F", "<b>", "🇩", "x".repeat(40)])
      expect(isEmoji(e)).toBe(false);
  });
});

describe("readReaction", () => {
  it("takes any emoji on an article or a comment", () => {
    expect(readReaction({ target: "article", emoji: "🔥" })).toEqual({ targetType: "article", targetId: "", emoji: "🔥" });
    expect(readReaction({ target: "comment", id: "c1c1c1c1", emoji: "🫡" })).toEqual({
      targetType: "comment",
      targetId: "c1c1c1c1",
      emoji: "🫡",
    });
  });

  it("refuses anything else", () => {
    expect(readReaction({ target: "driver", emoji: "🔥" }).error).toBeTruthy();
    expect(readReaction({ target: "article", emoji: "nice" }).error).toBeTruthy();
    expect(readReaction({ target: "article", emoji: "<script>" }).error).toBeTruthy();
    expect(readReaction(null).error).toBeTruthy();
  });
});

describe("summarise", () => {
  const rows = [
    { targetType: "article", targetId: "a1", discordId: "1", emoji: "🔥", authorName: "Siggsta" },
    { targetType: "article", targetId: "a1", discordId: "2", emoji: "🔥", authorName: "Steve" },
    { targetType: "article", targetId: "a1", discordId: "2", emoji: "👍", authorName: "Steve" },
    { targetType: "comment", targetId: "c1", discordId: "1", emoji: "💀", authorName: null },
  ];

  it("counts each emoji per target, in the order they arrived, with who put it there", () => {
    const s = summarise(rows, "1");
    expect(s.article("a1")).toEqual([
      { emoji: "🔥", count: 2, mine: true, names: ["You", "Steve"] },
      { emoji: "👍", count: 1, mine: false, names: ["Steve"] },
    ]);
    expect(s.comment("c1")).toEqual([{ emoji: "💀", count: 1, mine: true, names: ["You"] }]);
    expect(s.comment("nope")).toEqual([]);
    const anon = summarise(rows, null);
    expect(anon.article("a1").some((r) => r.mine)).toBe(false);
    expect(anon.comment("c1")[0].names).toEqual(["A member"]);
  });

  it("opens the picker on a handful of quick ones, no duplicates", () => {
    expect(new Set(REACTIONS).size).toBe(REACTIONS.length);
    expect(REACTIONS.every(isEmoji)).toBe(true);
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
