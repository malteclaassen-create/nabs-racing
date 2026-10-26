// Small pieces of the comment section under an article (NewsComments.jsx),
// kept apart so they can be tested without a browser.

// "just now", "5m", "3h", "2d", then the date. Comments read like a chat, so
// the recent ones say how long ago and the old ones when.
export function commentAge(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  const d = new Date(t);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${d.getDate()} ${month}${d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}

// Whether something pasted into the comment box is a GIF link on its own (the
// way Discord's "copy link" hands one over), so the box can turn it into the
// GIF instead of a line of address. The server decides whether it really is
// one; this only decides whether to ask.
const GIF_LINK_RE =
  /^https?:\/\/(?:www\.)?(?:tenor\.com\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?view\/\S+|tenor\.com\/[A-Za-z0-9]+\.gif|giphy\.com\/(?:gifs|stickers)\/\S+|(?:media\d*\.|c\.)tenor\.com\/\S+|(?:media\d*|i)\.giphy\.com\/\S+)$/i;

export function looksLikeGifLink(text) {
  return GIF_LINK_RE.test(String(text ?? "").trim());
}

// The box a GIF gets in a comment: its own shape, no taller than `maxH`, no
// wider than `maxW`. Without a known size, a square-ish default the picture
// fills.
export function gifBox(gif, { maxW = 320, maxH = 240 } = {}) {
  const w = Number(gif?.width);
  const h = Number(gif?.height);
  if (!(w > 0 && h > 0)) return { width: maxW, height: Math.round(maxW * 0.6) };
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}
