// The link preview of a news article: what Discord shows for a pasted
// /news/<slug> link.
import { describe, it, expect } from "vitest";
import { newsSlugOf, clip, plainText, firstPicture, articlePreview, newsPreview, applyNewsPreview } from "./newsMeta.js";

const O = "https://nabsracing.com";
const HTML = `<head>
    <title>NABS Racing League</title>
    <meta name="description" content="Formula 1 sim racing league" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="NABS Racing League" />
    <meta property="og:description" content="Formula 1 sim racing league" />
    <meta property="og:image" content="https://nabsracing.com/og-image.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:title" content="NABS Racing League" />
    <meta name="twitter:description" content="Formula 1 sim racing league" />
    <meta name="twitter:image" content="https://nabsracing.com/og-image.jpg" />
  </head>`;

const row = (over = {}) => ({
  title: "5 Winners and 5 Losers from Abu Dhabi",
  summary: "Who came away happy from the season finale, and who did not.",
  body: "## Winners\n\nFirst paragraph.",
  coverUrl: "/api/uploads/news/abu-dhabi.jpg",
  status: "PUBLISHED",
  authorName: "Steve",
  publishedAt: "2026-10-30T18:00:00.000Z",
  ...over,
});

describe("newsSlugOf", () => {
  it("names the article an address is", () => {
    expect(newsSlugOf("/news/5-winners-and-5-losers-from-abu-dhabi")).toBe("5-winners-and-5-losers-from-abu-dhabi");
    expect(newsSlugOf("/news/abc/")).toBe("abc");
  });
  it("leaves the list, the desk and anything else alone", () => {
    expect(newsSlugOf("/news")).toBe(null);
    expect(newsSlugOf("/news/desk")).toBe(null);
    expect(newsSlugOf("/news/desk/abc")).toBe(null);
    expect(newsSlugOf("/s/friday-f1/drivers")).toBe(null);
    expect(newsSlugOf("/news/%E0%A4%A")).toBe(null);
  });
});

describe("description", () => {
  it("cuts on a word with an ellipsis", () => {
    expect(clip("short")).toBe("short");
    const long = "word ".repeat(80);
    const out = clip(long, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("word…")).toBe(true);
  });
  it("reads the article text as plain words", () => {
    const body = "## Heading\n\n![a picture](/api/uploads/x.jpg)\n\nThe **fastest** lap went to *Max*, see [the results](/s/f1/races).\n\n> A quote\n- a point";
    expect(plainText(body)).toBe("The fastest lap went to Max, see the results. A quote a point");
  });
  it("uses the summary, else the start of the text", () => {
    expect(articlePreview(row(), O).description).toBe("Who came away happy from the season finale, and who did not.");
    expect(articlePreview(row({ summary: null }), O).description).toBe("First paragraph.");
  });
});

describe("picture", () => {
  it("is the cover, made absolute", () => {
    expect(articlePreview(row(), O).image).toBe(`${O}/api/uploads/news/abu-dhabi.jpg`);
    expect(articlePreview(row({ coverUrl: "https://cdn.example/p.jpg" }), O).image).toBe("https://cdn.example/p.jpg");
  });
  it("falls back to the first picture in the text, else none", () => {
    const body = "Intro\n\n![x](javascript:alert(1))\n\n![y](/api/uploads/news/in-text.png)";
    expect(firstPicture(body)).toBe("/api/uploads/news/in-text.png");
    expect(articlePreview(row({ coverUrl: null, body }), O).image).toBe(`${O}/api/uploads/news/in-text.png`);
    expect(articlePreview(row({ coverUrl: "http://plain.example/x.jpg", body: "text" }), O).image).toBe(null);
  });
});

describe("articlePreview", () => {
  it("never describes a draft", () => {
    expect(articlePreview(row({ status: "DRAFT" }), O)).toBe(null);
    expect(articlePreview(null, O)).toBe(null);
  });
});

describe("newsPreview", () => {
  it("looks the article up by its slug", async () => {
    let asked;
    const prisma = { $queryRawUnsafe: async (_sql, slug) => ((asked = slug), [row()]) };
    const p = await newsPreview(prisma, "/news/5-winners", O);
    expect(asked).toBe("5-winners");
    expect(p.title).toBe("5 Winners and 5 Losers from Abu Dhabi");
  });
  it("answers null for other pages and on a database error", async () => {
    const fail = { $queryRawUnsafe: async () => { throw new Error("down"); } };
    expect(await newsPreview(fail, "/news/x", O)).toBe(null);
    expect(await newsPreview(fail, "/news/desk", O)).toBe(null);
  });
});

describe("applyNewsPreview", () => {
  it("writes the article into the tags", () => {
    const out = applyNewsPreview(HTML, articlePreview(row({ title: 'Rock & "Roll"' }), O));
    expect(out).toContain('<title>Rock &amp; &quot;Roll&quot; · NABS Racing League</title>');
    expect(out).toContain('<meta property="og:title" content="Rock &amp; &quot;Roll&quot;" />');
    expect(out).toContain('<meta name="twitter:title" content="Rock &amp; &quot;Roll&quot;" />');
    expect(out).toContain('<meta property="og:description" content="Who came away happy from the season finale, and who did not." />');
    expect(out).toContain(`<meta property="og:image" content="${O}/api/uploads/news/abu-dhabi.jpg" />`);
    expect(out).toContain(`<meta name="twitter:image" content="${O}/api/uploads/news/abu-dhabi.jpg" />`);
    expect(out).not.toContain("og:image:width");
    expect(out).toContain('<meta property="og:type" content="article" />');
    expect(out).toContain('<meta property="article:published_time" content="2026-10-30T18:00:00.000Z" />');
    expect(out).toContain('<meta property="article:author" content="Steve" />');
  });
  it("keeps the shipped picture when the article has none", () => {
    const out = applyNewsPreview(HTML, articlePreview(row({ coverUrl: null }), O));
    expect(out).toContain('<meta property="og:image" content="https://nabsracing.com/og-image.jpg" />');
  });
  it("leaves the page alone without a preview", () => {
    expect(applyNewsPreview(HTML, null)).toBe(HTML);
  });
});
