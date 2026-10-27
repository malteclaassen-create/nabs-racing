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
  it("is a card with the title, a line per change and the way to the page, pinging nobody", () => {
    const m = changelogMessage(entry(1, "Reactions"), "https://nabsracing.com");
    expect(m.allowed_mentions).toEqual({ parse: [] });
    const e = m.embeds[0];
    expect(e.title).toBe("📣 Reactions");
    expect(e.url).toBe("https://nabsracing.com/changelog");
    expect(e.description).toContain("🆕 **New** · React to news with any emoji");
    expect(e.description).toContain("🔧 **Fixed**");
    expect(e.description).not.toMatch(/@everyone/);
    expect(e.footer.text).toBe("Update #701 · nabsracing.com");
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
      sent.push(JSON.parse(init.body).embeds[0].title);
      return { ok: true };
    };

    expect(await syncChangelogToDiscord(prisma, { feed, fetchImpl })).toEqual({ skipped: "no webhook" });
    await setChangelogWebhook(prisma, "https://discord.com/api/webhooks/1/abc");
    expect(await syncChangelogToDiscord(prisma, { feed, fetchImpl })).toEqual({ baselined: 2 });
    expect(sent).toEqual([]);

    entries = [entry(4), entry(3), entry(2), entry(1)];
    expect(await syncChangelogToDiscord(prisma, { feed, fetchImpl })).toEqual({ posted: 2 });
    expect(sent).toEqual(["📣 Update 3", "📣 Update 4"]);
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
