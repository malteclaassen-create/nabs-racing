import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  cleanGifUrl,
  readGifLink,
  resolveTenorPage,
  sanitizeCommentInput,
  shapeGiphyResult,
  searchGifs,
  shapeComment,
  replyPlacement,
  threadComments,
  commentRateCheck,
} from "./newsComments.js";

describe("cleanGifUrl", () => {
  it("takes Tenor's and GIPHY's media servers", () => {
    expect(cleanGifUrl("https://media1.tenor.com/m/Za0xjZTF3voAAAAC/f1.gif")).toBe(
      "https://media1.tenor.com/m/Za0xjZTF3voAAAAC/f1.gif"
    );
    expect(cleanGifUrl("https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif")).toBe(
      "https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif"
    );
    expect(cleanGifUrl("https://media3.giphy.com/media/v1.Y2lk/abc123/200.gif?cid=1&rid=200.gif&ct=g")).toBe(
      "https://media3.giphy.com/media/v1.Y2lk/abc123/200.gif?cid=1&rid=200.gif&ct=g"
    );
    expect(cleanGifUrl("https://i.giphy.com/abc123.webp")).toBe("https://i.giphy.com/abc123.webp");
  });

  it("refuses anything else", () => {
    expect(cleanGifUrl("http://media1.tenor.com/m/x/f1.gif")).toBe(null);
    expect(cleanGifUrl("https://example.com/f1.gif")).toBe(null);
    expect(cleanGifUrl("https://media.tenor.com.evil.com/x.gif")).toBe(null);
    expect(cleanGifUrl("https://user:pw@media.tenor.com/x.gif")).toBe(null);
    expect(cleanGifUrl("https://media.tenor.com/x.gif?a=<script>")).not.toMatch(/[<>"']/);
    expect(cleanGifUrl("https://media.tenor.com/x.gif?a=(1)")).toBe(null);
    expect(cleanGifUrl("javascript:alert(1)")).toBe(null);
    expect(cleanGifUrl("")).toBe(null);
  });
});

describe("readGifLink", () => {
  it("sends a Tenor page off to be looked up", () => {
    expect(readGifLink("https://tenor.com/view/f1-gif-25339191")).toEqual({
      tenorPage: "https://tenor.com/view/f1-gif-25339191",
    });
    expect(readGifLink("https://tenor.com/de/view/max-verstappen-gif-123")).toEqual({
      tenorPage: "https://tenor.com/de/view/max-verstappen-gif-123",
    });
    expect(readGifLink("https://tenor.com/bJ1aB.gif").tenorPage).toBe("https://tenor.com/bJ1aB.gif");
  });

  it("turns a GIPHY page into its GIF", () => {
    expect(readGifLink("https://giphy.com/gifs/formula1-f1-l0HlBO7eyXzSZkJri").gif.url).toBe(
      "https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif"
    );
  });

  it("takes a media link as it is and says no to other sites", () => {
    expect(readGifLink("https://media.tenor.com/abc/f1.gif").gif.url).toBe("https://media.tenor.com/abc/f1.gif");
    expect(readGifLink("https://example.com/x.gif").error).toBeTruthy();
    expect(readGifLink("https://tenor.com/search/f1").error).toBeTruthy();
    expect(readGifLink("not a link").error).toBeTruthy();
  });
});

describe("resolveTenorPage", () => {
  const page = `<html><head>
    <meta class="dynamic" property="og:image" content="https://media1.tenor.com/m/Za0xjZTF3voAAAAC/f1.gif">
    <meta class="dynamic" property="og:image:width" content="498">
    <meta class="dynamic" property="og:image:height" content="280">
  </head></html>`;
  const fakeFetch = (html, { ok = true, url = "https://tenor.com/view/f1-gif-25339191" } = {}) => async () => ({
    ok,
    url,
    text: async () => html,
  });

  it("reads the GIF and its size off the page", async () => {
    expect(await resolveTenorPage("https://tenor.com/view/f1-gif-25339191", { fetchImpl: fakeFetch(page) })).toEqual({
      url: "https://media1.tenor.com/m/Za0xjZTF3voAAAAC/f1.gif",
      width: 498,
      height: 280,
    });
  });

  it("gives up on a page without one, a failed answer, or a redirect off tenor.com", async () => {
    expect(await resolveTenorPage("https://tenor.com/view/x", { fetchImpl: fakeFetch("<html></html>") })).toBe(null);
    expect(await resolveTenorPage("https://tenor.com/view/x", { fetchImpl: fakeFetch(page, { ok: false }) })).toBe(null);
    expect(
      await resolveTenorPage("https://tenor.com/x.gif", { fetchImpl: fakeFetch(page, { url: "https://evil.com/" }) })
    ).toBe(null);
    const throws = async () => {
      throw new Error("offline");
    };
    expect(await resolveTenorPage("https://tenor.com/view/x", { fetchImpl: throws })).toBe(null);
  });
});

describe("GIPHY search", () => {
  const before = process.env.GIPHY_API_KEY;
  beforeEach(() => {
    process.env.GIPHY_API_KEY = "test-key";
  });
  afterEach(() => {
    if (before === undefined) delete process.env.GIPHY_API_KEY;
    else process.env.GIPHY_API_KEY = before;
  });

  const result = {
    id: "abc123",
    title: "F1 GIF",
    images: {
      downsized: { url: "https://media2.giphy.com/media/abc123/giphy-downsized.gif", width: "480", height: "270" },
      fixed_width_small: { url: "https://media2.giphy.com/media/abc123/100w.gif", width: "100", height: "56" },
    },
  };

  it("shapes a result for the picker", () => {
    expect(shapeGiphyResult(result)).toEqual({
      id: "abc123",
      title: "F1 GIF",
      url: "https://media2.giphy.com/media/abc123/giphy-downsized.gif",
      preview: "https://media2.giphy.com/media/abc123/100w.gif",
      width: 480,
      height: 270,
    });
    expect(shapeGiphyResult({ images: { downsized: { url: "https://evil.com/x.gif" } } })).toBe(null);
  });

  it("asks GIPHY once and remembers the answer", async () => {
    let calls = 0;
    let asked = "";
    const fetchImpl = async (url) => {
      calls += 1;
      asked = url;
      return { ok: true, json: async () => ({ data: [result] }) };
    };
    const first = await searchGifs("Verstappen crash", { fetchImpl, now: 1000 });
    const second = await searchGifs("verstappen crash", { fetchImpl, now: 2000 });
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(asked).toContain("/v1/gifs/search?");
    expect(asked).toContain("q=Verstappen+crash");
  });

  it("finds nothing without a key", async () => {
    delete process.env.GIPHY_API_KEY;
    expect(await searchGifs("f1", { fetchImpl: async () => ({ ok: true, json: async () => ({ data: [result] }) }) })).toEqual(
      []
    );
  });
});

describe("sanitizeCommentInput", () => {
  it("needs text or a GIF", () => {
    expect(sanitizeCommentInput({ body: "   " }).error).toBeTruthy();
    expect(sanitizeCommentInput({}).error).toBeTruthy();
  });

  it("cleans the text and keeps a GIF from Tenor or GIPHY", () => {
    const { comment } = sanitizeCommentInput({
      body: "  Send it\r\n\n\n\nfull send​ ",
      gif: { url: "https://media1.tenor.com/m/a/f1.gif", width: "498", height: 280 },
    });
    expect(comment).toEqual({
      body: "Send it\n\nfull send",
      gif: { url: "https://media1.tenor.com/m/a/f1.gif", width: 498, height: 280 },
    });
    expect(sanitizeCommentInput({ gif: { url: "https://media.giphy.com/media/abc/giphy.gif" } }).comment.body).toBe("");
  });

  it("refuses a GIF from anywhere else, and a wall of text", () => {
    expect(sanitizeCommentInput({ body: "hi", gif: { url: "https://example.com/x.gif" } }).error).toBeTruthy();
    expect(sanitizeCommentInput({ body: "x".repeat(1001) }).error).toBeTruthy();
  });
});

describe("shapeComment", () => {
  const row = {
    id: "c1c1c1c1",
    body: "Hi",
    gifUrl: null,
    discordId: "111111",
    authorName: "Munti",
    avatarUrl: null,
    driverId: "d1",
    createdAt: "2026-10-26T20:00:00.000Z",
  };

  it("lets the writer and the desk delete, nobody else", () => {
    expect(shapeComment(row, { discordId: "111111" })).toMatchObject({ mine: true, canDelete: true });
    expect(shapeComment(row, { discordId: "222222", moderator: true })).toMatchObject({ mine: false, canDelete: true });
    expect(shapeComment(row, { discordId: "222222" })).toMatchObject({ mine: false, canDelete: false });
    expect(shapeComment(row, null)).toMatchObject({ mine: false, canDelete: false, gif: null });
  });
});

describe("replies", () => {
  const top = { id: "top11111", discordId: "1", authorName: "Steve", createdAt: "2026-10-27T01:00:00.000Z" };
  const reply = {
    id: "rep11111",
    discordId: "2",
    authorName: "Tyler27",
    parentId: "top11111",
    createdAt: "2026-10-27T01:05:00.000Z",
  };

  it("answers to a comment open a thread under it; answers to a reply join that thread and name whom they answer", () => {
    expect(replyPlacement(null)).toBe(null);
    expect(replyPlacement(top)).toEqual({ parentId: "top11111", replyToName: null });
    expect(replyPlacement(reply)).toEqual({ parentId: "top11111", replyToName: "Tyler27" });
  });

  it("hangs each reply under its thread, oldest first", () => {
    const later = { ...reply, id: "rep22222", discordId: "1", replyToName: "Tyler27", createdAt: "2026-10-27T01:09:00.000Z" };
    const other = { ...top, id: "top22222" };
    const threads = threadComments([top, other], [later, reply], { discordId: "1" });
    expect(threads.map((t) => t.id)).toEqual(["top11111", "top22222"]);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["rep11111", "rep22222"]);
    expect(threads[0].replies[1]).toMatchObject({ parentId: "top11111", replyToName: "Tyler27", mine: true });
    expect(threads[1].replies).toEqual([]);
  });
});

describe("commentRateCheck", () => {
  it("wants a few seconds between comments and caps a burst", () => {
    const id = `rate-${Math.random()}`;
    expect(commentRateCheck(id, 0)).toBe(null);
    expect(commentRateCheck(id, 1000)).toBeTruthy();
    let t = 0;
    for (let i = 1; i < 20; i += 1) {
      t += 6000;
      expect(commentRateCheck(id, t)).toBe(null);
    }
    expect(commentRateCheck(id, t + 6000)).toBeTruthy();
  });
});
