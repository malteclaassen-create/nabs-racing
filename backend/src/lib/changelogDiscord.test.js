import { describe, it, expect } from "vitest";
import {
  changelogMessage,
  entriesToPost,
  isDiscordWebhook,
  syncChangelogToDiscord,
  setChangelogWebhook,
} from "./changelogDiscord.js";

const entry = (n, title = `Update ${n}`) => ({
  id: `pr-${n}`,
  date: "2026-10-27",
  commits: 700 + n,
  title,
  items: [
    { tag: "new", text: "React to news with any emoji" },
    { tag: "fixed", text: "Ping @everyone no more" },
  ],
});

// A Setting table in memory, enough for the Discord post's bookkeeping.
function fakePrisma() {
  const rows = new Map();
  return {
    setting: {
      findUnique: async ({ where }) => (rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null),
      upsert: async ({ where, update, create }) => rows.set(where.key, rows.has(where.key) ? update.value : create.value),
    },
  };
}

describe("isDiscordWebhook", () => {
  it("takes a Discord webhook and nothing else", () => {
    expect(isDiscordWebhook("https://discord.com/api/webhooks/123456/abc-DEF_9")).toBe(true);
    expect(isDiscordWebhook("https://discordapp.com/api/webhooks/1/x")).toBe(true);
    expect(isDiscordWebhook("http://discord.com/api/webhooks/1/x")).toBe(false);
    expect(isDiscordWebhook("https://evil.com/api/webhooks/1/x")).toBe(false);
    expect(isDiscordWebhook("https://discord.com/api/webhooks/1/x?wait=true")).toBe(false);
  });
});

describe("changelogMessage", () => {
  it("reads like a post somebody wrote: a heading, bullet points by kind, the link small and without a preview", () => {
    const e = entry(1, "Reactions");
    e.items.push({ tag: "better", text: "Long-press a reaction to see who reacted" });
    const m = changelogMessage(e, "https://nabsracing.com");
    expect(m.embeds).toBeUndefined();
    expect(m.allowed_mentions).toEqual({ parse: [] });
    expect(m.content).toBe(
      [
        "## Website update: Reactions",
        "**New**",
        "- React to news with any emoji",
        "**Changed**",
        "- Long-press a reaction to see who reacted",
        "**Fixed**",
        "- Ping @\u200beveryone no more",
        "-# Full changelog: <https://nabsracing.com/changelog>",
      ].join("\n")
    );
  });

  it("stays under Discord's 2000 characters", () => {
    const long = { ...entry(2), items: Array.from({ length: 10 }, () => ({ tag: "new", text: "x".repeat(300) })) };
    const m = changelogMessage(long, "https://nabsracing.com");
    expect(m.content.length).toBeLessThanOrEqual(2000);
    expect(m.content).toMatch(/-# Full changelog: <https:\/\/nabsracing\.com\/changelog>$/);
  });
});

describe("entriesToPost", () => {
  it("leaves out what was posted, oldest first", () => {
    expect(entriesToPost([entry(3), entry(2), entry(1)], ["pr-1"]).map((e) => e.id)).toEqual(["pr-2", "pr-3"]);
    expect(entriesToPost([{ id: "pr-9", items: [] }], [])).toEqual([]);
  });
});

describe("syncChangelogToDiscord", () => {
  it("does nothing without a webhook, notes the past first, then posts each new entry once", async () => {
    const prisma = fakePrisma();
    let entries = [entry(2), entry(1)];
    const feed = async () => ({ entries });
    const sent = [];
    const fetchImpl = async (url, init) => {
      sent.push(JSON.parse(init.body).content.split("\n")[0]);
      return { ok: true };
    };

    expect(await syncChangelogToDiscord(prisma, { feed, fetchImpl })).toEqual({ skipped: "no webhook" });
    await setChangelogWebhook(prisma, "https://discord.com/api/webhooks/1/abc");
    expect(await syncChangelogToDiscord(prisma, { feed, fetchImpl })).toEqual({ baselined: 2 });
    expect(sent).toEqual([]);

    entries = [entry(4), entry(3), entry(2), entry(1)];
    expect(await syncChangelogToDiscord(prisma, { feed, fetchImpl })).toEqual({ posted: 2 });
    expect(sent).toEqual(["## Website update: Update 3", "## Website update: Update 4"]);
    expect(await syncChangelogToDiscord(prisma, { feed, fetchImpl })).toEqual({ posted: 0 });
  });

  it("keeps an entry Discord refused for the next check", async () => {
    const prisma = fakePrisma();
    await setChangelogWebhook(prisma, "https://discord.com/api/webhooks/1/abc");
    let entries = [entry(1)];
    const feed = async () => ({ entries });
    await syncChangelogToDiscord(prisma, { feed });
    entries = [entry(2), entry(1)];
    await expect(syncChangelogToDiscord(prisma, { feed, fetchImpl: async () => ({ ok: false, status: 429 }) })).rejects.toThrow(
      /429/
    );
    const sent = [];
    await syncChangelogToDiscord(prisma, { feed, fetchImpl: async (u, i) => (sent.push(i), { ok: true }) });
    expect(sent).toHaveLength(1);
  });
});
