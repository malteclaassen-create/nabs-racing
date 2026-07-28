import { describe, it, expect } from "vitest";
import { buildFeed, sanitizePosts, sanitizeConfig, imageSize, extractUrls } from "./socialFeed.js";

// A stand-in for the two Setting rows the wall reads. Nothing here touches the
// network: `youtubeAuto` is off in every case, so buildFeed stays offline and
// only its ordering is under test.
function fakePrisma({ config = {}, posts = [] }) {
  const rows = {
    social_feed_config: JSON.stringify({ youtubeAuto: false, limit: 6, ...config }),
    social_feed_posts: JSON.stringify(posts),
  };
  return { setting: { findUnique: async ({ where }) => (rows[where.key] ? { value: rows[where.key] } : null) } };
}

const post = (platform, day, extra = {}) => ({
  id: `${platform}-${day}`,
  platform,
  url:
    platform === "youtube"
      ? "https://www.youtube.com/watch?v=aaaaaaaaaaa"
      : `https://www.${platform}.com/p/x${day}/`,
  title: `${platform} ${day}`,
  postedAt: `2026-07-${day}T12:00:00.000Z`,
  ...extra,
});

const platforms = (feed) => feed.posts.map((p) => p.platform);

describe("social wall ordering", () => {
  it("takes turns between the platforms instead of showing the newest first", async () => {
    // Three YouTube posts in a row would otherwise swallow the whole wall.
    const prisma = fakePrisma({
      posts: [
        post("youtube", "20"), post("youtube", "19"), post("youtube", "18"),
        post("instagram", "10"), post("tiktok", "09"), post("tiktok", "08"),
      ],
    });
    expect(platforms(await buildFeed(prisma))).toEqual([
      "youtube", "instagram", "tiktok", "youtube", "tiktok", "youtube",
    ]);
  });

  it("leads with whichever platform posted most recently", async () => {
    const prisma = fakePrisma({
      posts: [post("youtube", "10"), post("instagram", "25"), post("tiktok", "05")],
    });
    expect(platforms(await buildFeed(prisma))).toEqual(["instagram", "youtube", "tiktok"]);
  });

  it("shows each platform's freshest post first", async () => {
    const prisma = fakePrisma({
      posts: [post("tiktok", "05"), post("tiktok", "22"), post("youtube", "20")],
    });
    const feed = await buildFeed(prisma);
    expect(feed.posts.map((p) => p.title)).toEqual(["tiktok 22", "youtube 20", "tiktok 05"]);
  });

  it("gives a silent platform's slot to the others rather than leaving a hole", async () => {
    const prisma = fakePrisma({ posts: [post("youtube", "20"), post("youtube", "19"), post("youtube", "18")] });
    expect(platforms(await buildFeed(prisma))).toEqual(["youtube", "youtube", "youtube"]);
  });

  it("keeps pinned cards in front, mixing or not", async () => {
    const prisma = fakePrisma({
      posts: [post("youtube", "25"), post("instagram", "24"), post("tiktok", "01", { pinned: true })],
    });
    expect(platforms(await buildFeed(prisma))).toEqual(["tiktok", "youtube", "instagram"]);
  });

  it("falls back to plain newest-first when the mix is switched off", async () => {
    const prisma = fakePrisma({
      config: { mixPlatforms: false },
      posts: [post("youtube", "20"), post("youtube", "19"), post("instagram", "10")],
    });
    expect(platforms(await buildFeed(prisma))).toEqual(["youtube", "youtube", "instagram"]);
  });

  it("never returns more cards than the page asks for", async () => {
    const prisma = fakePrisma({
      config: { limit: 3 },
      posts: [post("youtube", "20"), post("instagram", "19"), post("tiktok", "18"), post("youtube", "17")],
    });
    expect(platforms(await buildFeed(prisma))).toEqual(["youtube", "instagram", "tiktok"]);
  });

  it("says nothing at all when the section is switched off", async () => {
    const prisma = fakePrisma({ config: { enabled: false }, posts: [post("youtube", "20")] });
    expect(await buildFeed(prisma)).toEqual({ enabled: false, posts: [] });
  });
});

describe("stored cards", () => {
  it("keeps a post's shape and drops a nonsensical one", () => {
    const [portrait, broken] = sanitizePosts([
      { ...post("tiktok", "01"), aspect: 0.5625 },
      { ...post("tiktok", "02"), aspect: 99 },
    ]);
    expect(portrait.aspect).toBe(0.5625);
    expect(broken.aspect).toBe(2); // clamped, not obeyed
  });

  it("refuses a link no platform owns", () => {
    expect(sanitizePosts([{ url: "https://example.com/x", title: "nope" }])).toEqual([]);
  });

  it("keeps picture links that are far longer than a page link", () => {
    // Instagram's are well over a thousand characters; an over-tight cap used
    // to throw the picture away without a word.
    const long = `https://scontent.cdninstagram.com/v/x.jpg?${"a=1&".repeat(300)}`;
    expect(sanitizePosts([{ ...post("instagram", "01"), thumbUrl: long }])[0].thumbUrl).toBe(long);
  });

  it("defaults the mix on but lets it be turned off", () => {
    expect(sanitizeConfig({}).mixPlatforms).toBe(true);
    expect(sanitizeConfig({ mixPlatforms: false }).mixPlatforms).toBe(false);
  });
});

describe("picking links out of a pasted batch", () => {
  it("reads a plain column of links", () => {
    expect(extractUrls("https://a.com/1\nhttps://b.com/2\n\nhttps://c.com/3")).toEqual([
      "https://a.com/1", "https://b.com/2", "https://c.com/3",
    ]);
  });

  it("finds links inside the message they were copied with", () => {
    const pasted = `check these out! https://www.instagram.com/p/AbCdEfGhIjK/ and this one
      https://www.tiktok.com/@nabs/video/7123456789012345678 — that last lap 🔥`;
    expect(extractUrls(pasted)).toEqual([
      "https://www.instagram.com/p/AbCdEfGhIjK/",
      "https://www.tiktok.com/@nabs/video/7123456789012345678",
    ]);
  });

  it("does not swallow the punctuation after a link", () => {
    expect(extractUrls("see https://a.com/x, then https://b.com/y.")).toEqual(["https://a.com/x", "https://b.com/y"]);
  });

  it("keeps a link's own trailing slash and query", () => {
    expect(extractUrls("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30")).toEqual([
      "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30",
    ]);
  });

  it("ignores repeats inside the same paste", () => {
    expect(extractUrls("https://a.com/1 https://a.com/1 https://a.com/2")).toEqual(["https://a.com/1", "https://a.com/2"]);
  });

  it("takes an array as readily as a blob of text", () => {
    expect(extractUrls(["https://a.com/1", "https://b.com/2"])).toEqual(["https://a.com/1", "https://b.com/2"]);
  });

  it("stops at the batch limit instead of accepting a whole address book", () => {
    const many = Array.from({ length: 40 }, (_, i) => `https://a.com/${i}`).join("\n");
    expect(extractUrls(many)).toHaveLength(25);
    expect(extractUrls(many, 3)).toHaveLength(3);
  });

  it("finds nothing in text without links, and doesn't fall over on nothing", () => {
    expect(extractUrls("no links here at all")).toEqual([]);
    expect(extractUrls("")).toEqual([]);
    expect(extractUrls(null)).toEqual([]);
    expect(extractUrls(undefined)).toEqual([]);
  });

  it("skips anything that isn't http(s)", () => {
    expect(extractUrls("javascript:alert(1) ftp://x.com/f https://ok.com/1")).toEqual(["https://ok.com/1"]);
  });
});

describe("reading a picture's own dimensions", () => {
  it("reads a PNG header", () => {
    const b = Buffer.alloc(24);
    b[0] = 0x89; b[1] = 0x50;
    b.writeUInt32BE(1080, 16);
    b.writeUInt32BE(1920, 20);
    expect(imageSize(b)).toEqual({ width: 1080, height: 1920 });
  });

  it("reads a GIF header", () => {
    const b = Buffer.alloc(24);
    b[0] = 0x47; b[1] = 0x49;
    b.writeUInt16LE(640, 6);
    b.writeUInt16LE(480, 8);
    expect(imageSize(b)).toEqual({ width: 640, height: 480 });
  });

  it("walks a JPEG's segments to the frame header", () => {
    // SOI, a 4-byte filler segment, then SOF0 carrying 361x640 (a Reel cover).
    const b = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
      (() => { const h = Buffer.alloc(4); h.writeUInt16BE(640, 0); h.writeUInt16BE(361, 2); return h; })(),
      Buffer.alloc(10),
    ]);
    expect(imageSize(b)).toEqual({ width: 361, height: 640 });
  });

  it("shrugs at bytes that are not an image", () => {
    expect(imageSize(Buffer.alloc(4))).toBeNull();
    expect(imageSize(Buffer.from("not an image at all, just text here"))).toBeNull();
  });
});
