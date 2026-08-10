import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { postToResultsChannel } from "./discordService.js";

// The results post is the one Discord call that cannot be tried by hand: the
// webhook URL is validated as a real discord.com address, so it can never be
// pointed at a local listener, and the only other way to see the request is to
// post into the league's actual channel. So the shape of it is pinned here.
//
// The failure this is really guarding against: an attachment has to go as
// multipart with the JSON under `payload_json`, and setting Content-Type by
// hand drops the multipart boundary and Discord answers 400. It looks correct
// right up until the first race night.

const HOOK = "https://discord.com/api/webhooks/1/abc";
const prisma = { setting: { findUnique: async () => ({ value: HOOK }) } };
const png = { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), filename: "r1-result.png" };

let calls;

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (url, init) => {
    calls.push({ url, init });
    return { ok: true, text: async () => "" };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("postToResultsChannel", () => {
  it("sends plain JSON when there is no image", async () => {
    const res = await postToResultsChannel(prisma, "P1 someone");
    expect(res).toMatchObject({ ok: true, messages: 1, attached: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body).content).toBe("P1 someone");
  });

  it("sends multipart with the image, and sets no Content-Type of its own", async () => {
    const res = await postToResultsChannel(prisma, "P1 someone", png);
    expect(res).toMatchObject({ ok: true, attached: true });
    const { init } = calls[0];
    // No hand-written header: fetch must add the one carrying the boundary.
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect(JSON.parse(init.body.get("payload_json")).content).toBe("P1 someone");
    const file = init.body.get("files[0]");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(4);
  });

  it("hangs the image on the LAST message when the text had to be split", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `P${i + 1} ${"x".repeat(60)}`).join("\n");
    const res = await postToResultsChannel(prisma, long, png);
    expect(res.messages).toBeGreaterThan(1);
    // every message but the last is plain JSON...
    for (const c of calls.slice(0, -1)) expect(c.init.headers["Content-Type"]).toBe("application/json");
    // ...and the picture lands at the bottom of the thread, not in the middle.
    expect(calls.at(-1).init.body).toBeInstanceOf(FormData);
  });

  it("posts an image with no text at all", async () => {
    const res = await postToResultsChannel(prisma, "   ", png);
    expect(res).toMatchObject({ ok: true, attached: true });
    expect(calls).toHaveLength(1);
  });

  it("refuses an empty post that carries nothing", async () => {
    const res = await postToResultsChannel(prisma, "   ");
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("reports a Discord rejection instead of claiming success", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 400, text: async () => "bad boundary" }));
    const res = await postToResultsChannel(prisma, "P1 someone", png);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("400");
  });

  it("says so when no webhook is configured", async () => {
    const none = { setting: { findUnique: async () => null } };
    const res = await postToResultsChannel(none, "P1 someone", png);
    expect(res).toMatchObject({ ok: false, skipped: true });
  });
});
