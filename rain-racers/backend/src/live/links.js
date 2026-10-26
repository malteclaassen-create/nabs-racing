// The server manager's own pages for a live socket, for the buttons on the
// live page: its live timing page, and the Content Manager link that joins
// the race server. The server manager has that link on its live timing page
// (the green Join button); it is read off there and kept a few minutes.

const KEEP_MS = 5 * 60 * 1000;
const cache = new Map(); // site -> { at, links }

const siteOf = (socketUrl) => {
  try {
    const u = new URL(socketUrl);
    return `${u.protocol === "ws:" ? "http" : "https"}://${u.host}`;
  } catch {
    return null;
  }
};

// The join link in the server manager's page, or null.
export function joinLinkIn(html) {
  const m = /id="cm-join-link"[^>]*href="([^"]+)"/.exec(html) || /href="(https:\/\/acstuff\.[a-z]+\/s\/q:race\/online\/join\?[^"]+)"/.exec(html);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

export async function serverLinks(socketUrl) {
  const site = siteOf(socketUrl);
  if (!site) return null;
  const hit = cache.get(site);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.links;
  const liveTiming = `${site}/live-timing`;
  let join = null;
  try {
    const res = await fetch(liveTiming, { signal: AbortSignal.timeout(8000) });
    if (res.ok) join = joinLinkIn(await res.text());
  } catch {
    // the server manager is not answering: the live timing link still goes out
  }
  const links = { liveTiming, join };
  cache.set(site, { at: Date.now(), links });
  return links;
}
