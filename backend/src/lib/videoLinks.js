// ---------------------------------------------------------------------------
// Turning a pasted video/post URL into something the site can render.
//
// Two features paste links: the per-track hotlap videos (lib/trackInfo.js) and
// the league's social wall (lib/socialFeed.js). Both need the same two answers —
// "which platform is this?" and "which video id?" — so the parsing lives here
// once instead of in each of them.
//
// Nothing here talks to the network. It's pure string work on a URL, so an
// admin's typo fails as a clear "that isn't a YouTube link", not as a timeout.
// ---------------------------------------------------------------------------

// Everything YouTube hands out: watch?v=, youtu.be/, /shorts/, /embed/, /live/.
// Ids are 11 characters of [A-Za-z0-9_-]; anything else is not an id.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeId(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  // A bare id is accepted too — admins do paste those.
  if (YT_ID.test(raw)) return raw;
  let u;
  try {
    u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return YT_ID.test(id || "") ? id : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtube-nocookie.com") return null;
  const v = u.searchParams.get("v");
  if (v && YT_ID.test(v)) return v;
  const parts = u.pathname.split("/").filter(Boolean);
  if (["shorts", "embed", "live", "v"].includes(parts[0]) && YT_ID.test(parts[1] || "")) return parts[1];
  return null;
}

// Which platform a pasted post URL belongs to, or null when we don't know it.
// Only the platforms the social wall renders a card for.
export function platformOf(url) {
  let u;
  try {
    u = new URL(String(url || "").trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube";
  if (host.endsWith("instagram.com")) return "instagram";
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host.endsWith("twitch.tv")) return "twitch";
  if (host === "x.com" || host.endsWith("twitter.com")) return "x";
  return null;
}

// The still image YouTube serves for a video. hqdefault exists for every video
// (maxresdefault does not), so this never 404s into an empty card.
export function youtubeThumb(id) {
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

// The vertical still. YouTube only publishes this one for Shorts — for an
// ordinary landscape video the address 404s. That makes it two answers in one:
// whether a video is portrait, and the full-height picture to show if it is.
// (The usual thumbnails are all 16:9 or 4:3 even for a Short, so they can't
// tell us anything about the video's shape.)
export function youtubeVerticalThumb(id) {
  return id ? `https://i.ytimg.com/vi/${id}/oardefault.jpg` : null;
}

// The player address for a video id. youtube-nocookie so a visitor who never
// presses play never gets a YouTube cookie.
export function youtubeEmbed(id) {
  return id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1` : null;
}

// TikTok's own player. Takes the numeric video id out of a post URL
// (…/@account/video/<id>) — its oEmbed reports the same id as
// `embed_product_id`, which is the more reliable source when we have it.
export function tiktokVideoId(url) {
  const m = /\/video\/(\d{6,25})/.exec(String(url || "")) || /\/v\/(\d{6,25})/.exec(String(url || ""));
  return m ? m[1] : null;
}

export function tiktokEmbed(id) {
  return /^\d{6,25}$/.test(String(id || "")) ? `https://www.tiktok.com/embed/v2/${id}` : null;
}

// Shapes, as width/height. Nothing but named numbers, so the intent reads.
export const LANDSCAPE = 16 / 9;
export const PORTRAIT = 9 / 16;

// An http(s) URL, trimmed and length-capped, or null. Used wherever an admin
// pastes a link we only ever hand back to the browser as an href/src.
export function safeUrl(value, max = 500) {
  const s = String(value ?? "").trim();
  if (!s || s.length > max) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : null;
  } catch {
    return null;
  }
}
