// ---------------------------------------------------------------------------
// A pasted YouTube or Twitch address -> the player address for an <iframe>.
//
// Built in the BROWSER, not stored: Twitch refuses to play unless the player
// URL names the exact domain it is embedded on (`parent=`), and only the page
// itself knows whether it is running on nabsracing.com, a Railway preview or
// localhost. So the admin stores the ordinary link they would share in Discord,
// and this turns it into a player wherever the page happens to be served.
//
// Accepted, deliberately generously — an admin pastes whatever the platform's
// share button gave them:
//   youtube.com/watch?v=ID · youtu.be/ID · youtube.com/live/ID
//   youtube.com/embed/ID   · youtube.com/channel/UC…/live  (channel's stream)
//   twitch.tv/name         · twitch.tv/videos/123          (a past broadcast)
// Anything else returns null and the page simply shows no player.
// ---------------------------------------------------------------------------

const YT_ID = /^[\w-]{11}$/; // YouTube video ids are 11 url-safe characters

function parseUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    return new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

export function streamEmbed(raw, host) {
  const u = parseUrl(raw);
  if (!u) return null;
  const domain = u.hostname.replace(/^www\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  // The domain the player is embedded on. Twitch matches this against the
  // request's actual origin, so it has to be the live hostname, not a guess.
  const parent = (host || (typeof window !== "undefined" ? window.location.hostname : "") || "localhost").toLowerCase();

  // ---- YouTube ----
  if (domain === "youtu.be") {
    const id = parts[0];
    return id && YT_ID.test(id) ? yt(`https://www.youtube-nocookie.com/embed/${id}`) : null;
  }
  if (domain.endsWith("youtube.com")) {
    const v = u.searchParams.get("v");
    if (v && YT_ID.test(v)) return yt(`https://www.youtube-nocookie.com/embed/${v}`);
    // /live/ID, /embed/ID, /shorts/ID all carry the id in the next segment.
    const i = parts.findIndex((p) => p === "live" || p === "embed" || p === "shorts");
    if (i >= 0 && parts[i + 1] && YT_ID.test(parts[i + 1])) {
      return yt(`https://www.youtube-nocookie.com/embed/${parts[i + 1]}`);
    }
    // A channel's current stream, whatever it happens to be right now — the
    // one form that keeps working across race nights without re-pasting.
    const ci = parts.indexOf("channel");
    if (ci >= 0 && parts[ci + 1]) {
      return yt(`https://www.youtube-nocookie.com/embed/live_stream?channel=${encodeURIComponent(parts[ci + 1])}`);
    }
    return null;
  }

  // ---- Twitch ----
  if (domain.endsWith("twitch.tv")) {
    const q = `&parent=${encodeURIComponent(parent)}&autoplay=true`;
    if (parts[0] === "videos" && parts[1]) {
      return {
        kind: "twitch",
        title: "Twitch",
        accent: "#9146FF",
        embedUrl: `https://player.twitch.tv/?video=${encodeURIComponent(parts[1])}${q}`,
      };
    }
    // Ignore the platform's own non-channel pages, or "directory" would be
    // treated as somebody's channel name.
    const RESERVED = new Set(["directory", "settings", "downloads", "jobs", "p", "search", "u"]);
    const channel = parts[0];
    if (!channel || RESERVED.has(channel.toLowerCase())) return null;
    return {
      kind: "twitch",
      title: `Twitch · ${channel}`,
      accent: "#9146FF",
      embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}${q}`,
    };
  }

  return null;
}

function yt(base) {
  return {
    kind: "youtube",
    title: "YouTube",
    accent: "#FF0000",
    // autoplay is safe here: the frame is only created once a visitor has
    // pressed play (see VideoEmbed), so nothing starts on its own.
    embedUrl: `${base}${base.includes("?") ? "&" : "?"}autoplay=1&rel=0&modestbranding=1`,
  };
}
