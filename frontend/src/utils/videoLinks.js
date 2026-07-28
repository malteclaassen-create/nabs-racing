// Front-end twin of backend/src/lib/videoLinks.js — same rules, so the admin's
// live preview agrees with what the server will accept. The server stays the
// authority: this only decides whether to show a preview while typing.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeId(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
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
