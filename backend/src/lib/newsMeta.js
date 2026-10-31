// ---------------------------------------------------------------------------
// The link preview of a news article (/news/<slug>).
//
// Articles are what members paste into Discord most, and every one of them
// unfurled as the site's generic card: Discord does not run the app, so it only
// ever saw index.html's fixed tags. The server fills them in here instead: the
// article's own title, its summary (or the start of its text), and its cover
// picture (or the first picture in it), the way a news site's link looks.
//
// Only PUBLISHED articles get one. A draft's address answers with the generic
// card, so a link to the desk never shows anybody an unfinished piece.
// ---------------------------------------------------------------------------
import { applyPageMeta, applyShareText, applyShareImage } from "./pageMeta.js";

const SITE = "NABS Racing League";
const DESCRIPTION_MAX = 200;

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// The article slug an address names, or null. /news/desk is the writing desk,
// not an article, and so is anything deeper than /news/<slug>.
export function newsSlugOf(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "news" || parts[1] === "desk") return null;
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return null;
  }
}

// Cut to `max` characters on a word boundary, with an ellipsis when cut.
export function clip(text, max = DESCRIPTION_MAX) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

// The article text (its small Markdown, components/newsText.mjs) as plain
// sentences: headings, pictures and quote/list markers out, the words of bold,
// italic and links kept. The first paragraphs are all a preview ever needs.
export function plainText(body) {
  const paras = [];
  let current = [];
  const flush = () => {
    if (current.length) paras.push(current.join(" "));
    current = [];
  };
  for (const raw of String(body || "").replace(/\r\n?/g, "\n").split("\n")) {
    const t = raw.trim();
    if (!t) {
      flush();
      continue;
    }
    if (/^#{1,6}\s/.test(t) || /^!\[[^\]]*\]\([^)]*\)$/.test(t)) {
      flush();
      continue;
    }
    current.push(t.replace(/^>\s?/, "").replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""));
  }
  flush();
  return paras
    .join(" ")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\s][^*]*)\*/g, "$1")
    .replace(/_([^_\s][^_]*)_/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// The first picture in the article text, for an article without a cover.
// Same rule as the cover itself: an upload on this site or an https address.
export function firstPicture(body) {
  for (const raw of String(body || "").split("\n")) {
    const m = raw.trim().match(/^!\[[^\]]*\]\(([^)\s]+)\)$/);
    if (m && isPicture(m[1])) return m[1];
  }
  return null;
}

function isPicture(url) {
  const u = String(url || "").trim();
  if (/^\/api\/uploads\/[A-Za-z0-9/_.-]+$/.test(u) && !u.includes("..")) return true;
  return /^https:\/\/[^\s"'<>]+$/i.test(u);
}

// What the preview says for an article row (or null). Pure.
export function articlePreview(row, origin) {
  if (!row || row.status !== "PUBLISHED") return null;
  const title = String(row.title || "").trim();
  if (!title) return null;
  const description = clip(String(row.summary || "").trim() || plainText(row.body)) || null;
  const pic = isPicture(row.coverUrl) ? row.coverUrl.trim() : firstPicture(row.body);
  const image = pic ? (pic.startsWith("/") ? (origin ? `${origin}${pic}` : null) : pic) : null;
  const published = row.publishedAt ? new Date(row.publishedAt) : null;
  return {
    title,
    description,
    image,
    publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
    author: String(row.authorName || "").trim() || null,
  };
}

// The preview for an address, or null when it is not a published article.
export async function newsPreview(prisma, pathname, origin) {
  const slug = newsSlugOf(pathname);
  if (!slug) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "title","summary","body","coverUrl","status","authorName","publishedAt" FROM "NewsArticle" WHERE "slug" = ? LIMIT 1`,
      slug
    );
    return articlePreview(rows?.[0], origin);
  } catch {
    return null; // a preview is never worth failing a page load over
  }
}

// Writes it into the HTML. The page title carries the site name, as every
// other page's does; the og:/twitter: title is the headline alone, because the
// unfurl prints the site name above it anyway. The picture goes in large
// (twitter:card summary_large_image is already in index.html).
export function applyNewsPreview(html, preview) {
  if (!preview) return html;
  let out = applyPageMeta(html, { title: `${preview.title} · ${SITE}`, description: preview.description });
  out = applyShareText(out, { title: preview.title });
  out = applyShareImage(out, preview.image);
  out = out.replace(/(<meta property="og:type" content=")[^"]*(")/, "$1article$2");
  const extra = [];
  if (preview.publishedAt) extra.push(`<meta property="article:published_time" content="${esc(preview.publishedAt)}" />`);
  if (preview.author) extra.push(`<meta property="article:author" content="${esc(preview.author)}" />`);
  if (extra.length) out = out.replace(/<\/head>/i, `  ${extra.join("\n    ")}\n  </head>`);
  return out;
}
