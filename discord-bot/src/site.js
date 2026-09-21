import { config } from "./config.js";

const CHUNK = 500; // site limit per call

const TIMEOUT_MS = 20_000;

async function post(path, body) {
  // with no timeout a black-holed connection never settles, and the flush that
  // is waiting on it never lets go of its lock or writes state.json again
  const res = await fetch(`${config.siteUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: config.tokenKey, ...body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
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
export const sendNames = (entries) => sendChunked("/api/tokens/names", entries);

// empty list = writes nothing, still checks the key
export const ping = () => post("/api/tokens/activity", { entries: [] });
