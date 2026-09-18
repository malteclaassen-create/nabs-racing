import { config } from "./config.js";

const CHUNK = 500; // site limit per call

async function post(path, body) {
  const res = await fetch(`${config.siteUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: config.tokenKey, ...body }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not json */
  }
  if (!res.ok) throw new Error(`${path}: ${json?.error || `HTTP ${res.status}`}`);
  return json || {};
}

async function sendChunked(path, entries) {
  const done = [];
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    await post(path, { entries: chunk });
    done.push(...chunk);
  }
  return done;
}

export const sendActivity = (entries) => sendChunked("/api/tokens/activity", entries);
export const sendReferrals = (entries) => sendChunked("/api/tokens/referral", entries);

// empty list = writes nothing, still checks the key
export const ping = () => post("/api/tokens/activity", { entries: [] });
