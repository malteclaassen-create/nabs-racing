// ---------------------------------------------------------------------------
// The league's social wall: the cards under the numbers band on the home page.
//
// Two sources, on purpose:
//   1. YouTube, automatically. A channel publishes a public RSS feed, so the
//      newest videos need no API key, no token and no app review — we read the
//      feed and cache it. Nothing to maintain once the channel is set.
//   2. Everything else, by hand. Instagram and TikTok publish no feed we could
//      read (Meta's oEmbed has needed an app token since 2020), so an admin
//      pastes the post link — but only the link. Picture, caption and date we
//      fetch ourselves: TikTok through its open oEmbed endpoint, Instagram
//      through the link-preview tags it serves to anything that isn't a
//      browser. Uploading a cover by hand is the fallback, not the routine.
//
// Both live in the Setting table as JSON blobs — a couple of dozen rows at most,
// the same pattern raceInfo/trackInfo already use, and no migration to deploy.
// ---------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import {
  platformOf, safeUrl, youtubeId, youtubeThumb, youtubeVerticalThumb, youtubeEmbed,
  tiktokVideoId, tiktokEmbed, LANDSCAPE, PORTRAIT,
} from "./videoLinks.js";

const CONFIG_KEY = "social_feed_config";
const POSTS_KEY = "social_feed_posts";

// Platforms a card can be. `twitch` and `x` ride along because the league links
// them anyway and a pasted clip should not be refused.
export const POST_PLATFORMS = ["youtube", "instagram", "tiktok", "twitch", "x"];

const MAX_POSTS = 40; // what an admin may store, not what the home page shows
const MAX_TITLE = 140;
const MAX_NOTE = 200;
// Picture links, unlike page links, are long: Instagram's carry a signature and
// a cache stamp and run well past a thousand characters. Cap them generously —
// too tight a limit silently throws the picture away.
const MAX_MEDIA_URL = 2000;

const cap = (s, n) => String(s ?? "").trim().slice(0, n);

// --- config ----------------------------------------------------------------

export const DEFAULT_CONFIG = {
  // What the admin pasted (a @handle URL, a /channel/UC… URL — anything).
  youtubeChannelUrl: "",
  // The resolved UC… id the RSS feed actually needs. Filled in on save.
  youtubeChannelId: "",
  // Pull the newest videos automatically?
  youtubeAuto: true,
  // How many auto-pulled videos may appear at once.
  youtubeCount: 3,
  // Total cards on the home page. 3 or 6 keeps every grid row full.
  limit: 6,
  // Take turns between the platforms instead of showing the newest posts full
  // stop. Without it a busy YouTube week fills the whole wall and the Instagram
  // and TikTok accounts look dead — which is the opposite of the point.
  mixPlatforms: true,
  // Master switch — off hides the whole section, links and all.
  enabled: true,
};

export function sanitizeConfig(input) {
  const c = { ...DEFAULT_CONFIG };
  if (!input || typeof input !== "object") return c;
  c.youtubeChannelUrl = safeUrl(input.youtubeChannelUrl, 300) || "";
  const id = String(input.youtubeChannelId || "").trim();
  c.youtubeChannelId = /^UC[A-Za-z0-9_-]{20,30}$/.test(id) ? id : "";
  c.youtubeAuto = input.youtubeAuto !== false;
  c.enabled = input.enabled !== false;
  c.mixPlatforms = input.mixPlatforms !== false;
  const n = Number(input.youtubeCount);
  c.youtubeCount = Number.isFinite(n) ? Math.min(6, Math.max(0, Math.round(n))) : DEFAULT_CONFIG.youtubeCount;
  const l = Number(input.limit);
  c.limit = Number.isFinite(l) ? Math.min(12, Math.max(1, Math.round(l))) : DEFAULT_CONFIG.limit;
  return c;
}

export async function readFeedConfig(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
    return row?.value ? sanitizeConfig(JSON.parse(row.value)) : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeFeedConfig(prisma, value) {
  const clean = sanitizeConfig(value);
  const json = JSON.stringify(clean);
  await prisma.setting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: json }, update: { value: json } });
  channelCache.clear(); // a new channel must not serve the old one's videos
  return clean;
}

// --- manual posts ----------------------------------------------------------

// One stored card. `coverUrl` is an uploaded image and always wins over
// `thumbUrl` (which is the platform's own, and may be a link that expires).
function sanitizePost(input) {
  const url = safeUrl(input?.url);
  if (!url) return null;
  const platform = POST_PLATFORMS.includes(input?.platform) ? input.platform : platformOf(url);
  if (!platform) return null;
  const postedAt = input?.postedAt ? new Date(input.postedAt) : null;
  // The shape of the post, as width/height. A vertical clip has to stay
  // vertical on the page; forcing everything into one letterbox is how a Reel
  // ends up as a thin strip between two black bars. Clamped so a broken number
  // can't produce a card a screen and a half tall.
  const ratio = Number(input?.aspect);
  return {
    id: String(input?.id || "").trim() || randomUUID(),
    platform,
    url,
    title: cap(input?.title, MAX_TITLE),
    note: cap(input?.note, MAX_NOTE),
    thumbUrl: safeUrl(input?.thumbUrl, MAX_MEDIA_URL) || null,
    coverUrl: typeof input?.coverUrl === "string" && input.coverUrl.startsWith("/api/uploads/") ? input.coverUrl : null,
    // Where the post plays inside our page, when the platform allows it at all.
    embedUrl: safeUrl(input?.embedUrl, MAX_MEDIA_URL) || null,
    aspect: Number.isFinite(ratio) && ratio > 0 ? Math.min(2, Math.max(0.5, Number(ratio.toFixed(4)))) : null,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt.toISOString() : null,
    pinned: !!input?.pinned,
  };
}

export function sanitizePosts(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const p of input) {
    const clean = sanitizePost(p);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
    if (out.length >= MAX_POSTS) break;
  }
  return out;
}

export async function readPosts(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: POSTS_KEY } });
    return row?.value ? sanitizePosts(JSON.parse(row.value)) : [];
  } catch {
    return [];
  }
}

export async function writePosts(prisma, posts) {
  const clean = sanitizePosts(posts);
  const json = JSON.stringify(clean);
  await prisma.setting.upsert({ where: { key: POSTS_KEY }, create: { key: POSTS_KEY, value: json }, update: { value: json } });
  return clean;
}

// --- talking to the platforms ----------------------------------------------

const UA = "NabsRacing/1.0 (league website)";

// Every outbound call is best-effort and short-fused: the home page must render
// with or without YouTube answering, so a hanging request is worse than none.
async function fetchText(url, ms = 6000) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
function decodeXml(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#\d+);/gi, (m, name) => XML_ENTITIES[name.toLowerCase()] ?? m);
}

// Resolve whatever channel URL the admin pasted to the UC… id the RSS feed
// needs. A /channel/UC… link answers itself; a @handle or /c/ link only exists
// as HTML, so we read the page and pick the id out of it. Returns null when the
// page doesn't look like a channel (typo, deleted channel, YouTube changed).
export async function resolveChannelId(url) {
  const clean = safeUrl(url, 300);
  if (!clean) return null;
  const direct = clean.match(/\/channel\/(UC[A-Za-z0-9_-]{20,30})/);
  if (direct) return direct[1];
  let html;
  try {
    html = await fetchText(clean, 8000);
  } catch {
    return null;
  }
  const m =
    html.match(/"(?:externalId|channelId)"\s*:\s*"(UC[A-Za-z0-9_-]{20,30})"/) ||
    html.match(/channel\/(UC[A-Za-z0-9_-]{20,30})/);
  return m ? m[1] : null;
}

// The newest videos of a channel, from its public RSS feed. Cached in memory —
// the home page is the busiest page on the site and YouTube publishes at most a
// few videos a week, so re-reading it per visitor would be pure waste.
const channelCache = new Map(); // channelId -> { at, videos }
const CHANNEL_TTL_MS = 30 * 60 * 1000;

export async function fetchChannelVideos(channelId, { force = false } = {}) {
  if (!/^UC[A-Za-z0-9_-]{20,30}$/.test(String(channelId || ""))) return [];
  const hit = channelCache.get(channelId);
  if (!force && hit && Date.now() - hit.at < CHANNEL_TTL_MS) return hit.videos;
  let xml;
  try {
    xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  } catch {
    // Keep serving the last good answer through a YouTube hiccup; only a
    // channel we never reached at all ends up empty.
    return hit?.videos || [];
  }
  const entries = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    if (!youtubeId(id)) continue;
    entries.push({
      id: `yt:${id}`,
      platform: "youtube",
      videoId: id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: decodeXml(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ""),
      embedUrl: youtubeEmbed(id),
      postedAt: entry.match(/<published>([^<]+)<\/published>/)?.[1] || null,
      note: "",
      auto: true,
    });
  }
  // A channel that posts Shorts as well as full videos has both shapes in one
  // feed, so each one is asked about individually (cached per video id, and the
  // whole feed is cached for half an hour on top).
  const videos = await Promise.all(
    entries.map(async (v) => ({ ...v, ...(await youtubeShape(v.videoId)) }))
  );
  channelCache.set(channelId, { at: Date.now(), videos });
  return videos;
}

// --- reading a post's preview off the platform -------------------------------

// The Open Graph tags a page publishes for link previews — the same thing
// WhatsApp and Discord read when you paste a link into a chat.
//
// This is how we get an Instagram post's picture without a Meta app token.
// Instagram serves those tags to anything that isn't a browser; ask with a
// browser's user-agent and you get the empty JavaScript shell instead. So we
// ask as ourselves — a named link-preview reader, no pretending to be Google's
// or Meta's crawler.
const OG_UA = "NabsRacingLeague/1.0 (+link preview; contact: league admin)";

const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
function decodeHtml(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(Number(d)); } catch { return ""; }
    })
    .replace(/&([a-z]+);/gi, (m, name) => HTML_ENTITIES[name.toLowerCase()] ?? m);
}

function ogTag(html, prop) {
  const a = new RegExp(`property=["']og:${prop}["'][^>]*content=["']([^"']*)["']`, "i").exec(html);
  if (a) return decodeHtml(a[1]);
  const b = new RegExp(`content=["']([^"']*)["'][^>]*property=["']og:${prop}["']`, "i").exec(html);
  return b ? decodeHtml(b[1]) : null;
}

async function fetchOpenGraph(url) {
  let html;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": OG_UA, accept: "text/html" },
      signal: AbortSignal.timeout(9000),
      redirect: "follow",
    });
    if (!res.ok) return {};
    html = await res.text();
  } catch {
    return {};
  }
  return { title: ogTag(html, "title"), description: ogTag(html, "description"), image: ogTag(html, "image") };
}

// Instagram's og:title is the account and the caption glued together —
// `Some Account on Instagram: "the actual caption"`. The caption is the part
// worth putting on a card, so peel the wrapper off.
function captionFrom(ogTitle, ogDescription) {
  const strip = (s) => {
    const m = /(?:on (?:Instagram|TikTok|Threads)|):\s*["“](.+)["”]\s*$/s.exec(String(s || "").trim());
    return (m ? m[1] : String(s || "")).trim();
  };
  const t = strip(ogTitle);
  if (t) return cap(t.split("\n")[0], MAX_TITLE);
  return cap(strip(ogDescription).split("\n")[0], MAX_TITLE);
}

// Instagram's og:description carries the posting date in English
// ("… - account on December 18, 2024: …"). Worth reading: it puts a hand-added
// post at its real place in the wall instead of "whenever it was pasted".
function dateFrom(description) {
  const m = /\son ([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(String(description || ""));
  if (!m) return null;
  const d = new Date(`${m[1]} 12:00:00 UTC`);
  return Number.isNaN(d.getTime()) || d.getTime() > Date.now() ? null : d.toISOString();
}

// Is a YouTube video a Short (vertical) or an ordinary landscape one, and which
// still image belongs to it? YouTube publishes an `oardefault.jpg` — the full
// vertical frame — for Shorts and only for Shorts, so asking for it answers
// both questions at once. Every other thumbnail address is 16:9 or 4:3 whatever
// the video's real shape, which is why the plain thumbnail can't be trusted.
//
// Cached: the answer for a video id never changes, and the channel feed asks
// for the same handful of ids every half hour.
const shapeCache = new Map(); // videoId -> { thumbUrl, aspect }

export async function youtubeShape(id) {
  if (!id) return { thumbUrl: null, aspect: null };
  if (shapeCache.has(id)) return shapeCache.get(id);
  let shape = { thumbUrl: youtubeThumb(id), aspect: LANDSCAPE };
  try {
    const vertical = youtubeVerticalThumb(id);
    const res = await fetch(vertical, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    if (res.ok) shape = { thumbUrl: vertical, aspect: PORTRAIT };
  } catch {
    /* couldn't ask — landscape is the safe assumption */
  }
  shapeCache.set(id, shape);
  return shape;
}

// Width and height straight out of an image's own bytes. Instagram publishes no
// size for its pictures, and a Reel's cover is the only thing that tells us the
// post is vertical — so we read it off the file we just downloaded.
// Understands the four formats an upload or a platform ever hands us.
export function imageSize(b) {
  if (!b || b.length < 24) return null;
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  // WebP (RIFF….WEBP) — three sub-formats, each storing the size differently.
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const n = b.readUInt32LE(21);
      return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const rd24 = (o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
      return { width: rd24(24) + 1, height: rd24(27) + 1 };
    }
    return null;
  }
  // JPEG: walk the segment chain to the start-of-frame, which carries the size.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      }
      const len = b.readUInt16BE(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

// Title + thumbnail for a pasted post, so the admin doesn't have to type them.
// Three different doors, one per platform: YouTube answers from the id alone,
// TikTok has an open oEmbed endpoint, and Instagram only talks through its
// link-preview tags. `needsCover` means we found no picture and the card wants
// one uploaded.
export async function lookupPost(url) {
  const clean = safeUrl(url);
  if (!clean) throw new Error("Paste a full link starting with https://");
  const platform = platformOf(clean);
  if (!platform) throw new Error("That link isn't a YouTube, Instagram, TikTok, Twitch or X post");
  const base = {
    url: clean, platform, title: "", thumbUrl: null, postedAt: null,
    embedUrl: null, aspect: null, needsCover: false,
  };

  if (platform === "youtube") {
    const id = youtubeId(clean);
    const shape = await youtubeShape(id);
    base.thumbUrl = shape.thumbUrl;
    base.aspect = shape.aspect;
    base.embedUrl = youtubeEmbed(id);
    base.title = await oembedTitle(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(clean)}`);
  } else if (platform === "tiktok") {
    const data = await oembed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(clean)}`);
    base.title = cap(data?.title, MAX_TITLE);
    base.thumbUrl = safeUrl(data?.thumbnail_url, MAX_MEDIA_URL) || null;
    // TikTok states the thumbnail's size (576x1024 for the usual vertical clip).
    const w = Number(data?.thumbnail_width);
    const h = Number(data?.thumbnail_height);
    if (w > 0 && h > 0) base.aspect = w / h;
    base.embedUrl = tiktokEmbed(data?.embed_product_id || tiktokVideoId(clean));
  }

  // Open Graph fills whatever is still missing — and for Instagram, X and
  // Twitch it's the only source there is.
  if (!base.thumbUrl || !base.title) {
    const og = await fetchOpenGraph(clean);
    if (!base.thumbUrl) base.thumbUrl = safeUrl(og.image, MAX_MEDIA_URL) || null;
    if (!base.title) base.title = captionFrom(og.title, og.description);
    base.postedAt = dateFrom(og.description);
  }

  base.needsCover = !base.thumbUrl;
  return base;
}

async function oembed(url) {
  try {
    return JSON.parse(await fetchText(url, 6000));
  } catch {
    return null;
  }
}
async function oembedTitle(url) {
  const d = await oembed(url);
  return cap(d?.title, MAX_TITLE);
}

// Every link out of a pasted blob of text, in the order they appear and without
// repeats. Written for what an admin actually pastes: a column of addresses, a
// chat message, a note with words around the links. Trailing punctuation is
// trimmed because "…/p/abc/, and this one" would otherwise swallow the comma.
export function extractUrls(input, max = 25) {
  const text = Array.isArray(input) ? input.join("\n") : String(input ?? "");
  const out = [];
  const seen = new Set();
  for (const raw of text.match(/https?:\/\/[^\s"'<>]+/gi) || []) {
    const url = raw.replace(/[.,;:)\]}>]+$/, "");
    const clean = safeUrl(url, MAX_MEDIA_URL);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

// --- keeping the picture --------------------------------------------------

// Instagram and TikTok hand out picture links that EXPIRE — Instagram's carry
// an `oe=` stamp, TikTok's an `x-expires=`, both a couple of days out. Point a
// card straight at one and it goes blank by the weekend. So we fetch the image
// once, when the post is added, and serve our own copy from then on.
//
// Only ever called with a URL a platform itself just gave us, and only by an
// admin, but it still refuses anything that isn't a plain public https image.
const IMAGE_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Hostnames that resolve inside the network the server sits in. A platform
// never returns one; a redirect chain trying to make us read something local
// would.
function isPrivateHost(host) {
  const h = String(host || "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^\[?::1\]?$/.test(h)) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

// Returns { buffer, ext } or null. Never throws — a missing picture is a
// plainer card, not a failed save.
export async function downloadImage(url) {
  const clean = safeUrl(url, MAX_MEDIA_URL);
  if (!clean) return null;
  let u;
  try {
    u = new URL(clean);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || isPrivateHost(u.hostname)) return null;
  try {
    const res = await fetch(clean, { headers: { "user-agent": OG_UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const ext = IMAGE_EXT[(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()];
    if (!ext) return null;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_IMAGE_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
    // The picture's own dimensions double as the post's shape, for the
    // platforms that won't tell us one (Instagram above all).
    const dim = imageSize(buffer);
    return { buffer, ext, width: dim?.width || null, height: dim?.height || null };
  } catch {
    return null;
  }
}

// --- what the home page renders --------------------------------------------

// Manual posts and auto-pulled videos merged into one list: pinned cards first,
// then newest first. A manually added YouTube video wins over the same video
// coming out of the feed, so pinning one doesn't show it twice.
export async function buildFeed(prisma) {
  const [config, posts] = await Promise.all([readFeedConfig(prisma), readPosts(prisma)]);
  if (!config.enabled) return { enabled: false, posts: [] };

  const manual = posts.map((p) => ({
    ...p,
    videoId: p.platform === "youtube" ? youtubeId(p.url) : null,
    // Our own copy wins over the platform's link, which expires.
    thumbUrl: p.coverUrl || p.thumbUrl,
    aspect: p.aspect || LANDSCAPE,
    auto: false,
  }));

  let auto = [];
  if (config.youtubeAuto && config.youtubeChannelId && config.youtubeCount > 0) {
    const manualVideoIds = new Set(manual.map((p) => p.videoId).filter(Boolean));
    auto = (await fetchChannelVideos(config.youtubeChannelId))
      .filter((v) => !manualVideoIds.has(v.videoId))
      .slice(0, config.youtubeCount);
  }

  const time = (p) => (p.postedAt ? new Date(p.postedAt).getTime() : 0);
  const byDate = [...manual, ...auto].sort((a, b) => time(b) - time(a));

  // Pinned cards are an explicit decision and outrank everything, mixing or not.
  const pinned = byDate.filter((p) => p.pinned);
  const rest = byDate.filter((p) => !p.pinned);

  const ordered = [...pinned, ...(config.mixPlatforms ? takeTurns(rest, time) : rest)];
  return { enabled: true, posts: ordered.slice(0, config.limit) };
}

// One from each platform, then the next from each, and so on: YouTube,
// Instagram, TikTok, YouTube, … Whoever posted most recently leads the round,
// and a platform that has run out is simply skipped, so a quiet Instagram
// account costs a slot rather than leaving a hole. Everything is already
// newest-first going in, so each platform still shows its freshest post first.
function takeTurns(posts, time) {
  const queues = new Map();
  for (const p of posts) {
    if (!queues.has(p.platform)) queues.set(p.platform, []);
    queues.get(p.platform).push(p);
  }
  const rounds = [...queues.values()].sort((a, b) => time(b[0]) - time(a[0]));
  const deepest = Math.max(0, ...rounds.map((q) => q.length));
  const out = [];
  for (let i = 0; i < deepest; i++) {
    for (const q of rounds) if (q[i]) out.push(q[i]);
  }
  return out;
}
