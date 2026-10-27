// ---------------------------------------------------------------------------
// Every new changelog entry, posted to Discord by itself.
//
// The changelog's newer half comes from merged pull requests (changelogFeed.js).
// When a webhook for it is saved (admin System → Discord), every entry that
// appears there after that is posted to that channel once, as a plain message
// with the update's title, its changes as bullet points and a link to
// /changelog (changelogMessage).
// Some members never open the site; this is how they hear what is new on it.
//
// What has been posted is kept in one Setting blob (`ids`, the last 100). The
// first look after a webhook is saved only takes note of what is already
// there (`baselined`), so connecting a channel never floods it with the past.
// The check runs every 15 minutes (index.js); a webhook that is not set means
// it does nothing at all.
// ---------------------------------------------------------------------------
import { getChangelogFeed } from "./changelogFeed.js";

export const CHANGELOG_WEBHOOK_KEY = "discord_changelog_webhook_url";
const STATE_KEY = "changelog_discord_posted";
const KEEP_IDS = 100;
// How fresh the feed has to be for a check: a new entry reaches Discord within
// about this long of its pull request being merged.
export const CHANGELOG_POLL_MS = 15 * 60 * 1000;

const ORIGIN = String(process.env.PUBLIC_ORIGIN || "https://nabsracing.com").replace(/\/$/, "");
const TAG_OF = { new: "new", better: "better", fixed: "fixed" };

export function isDiscordWebhook(url) {
  return /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(String(url || "").trim());
}

async function readSetting(prisma, key) {
  const row = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return row?.value || null;
}

async function writeSetting(prisma, key, value) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export const getChangelogWebhook = (prisma) => readSetting(prisma, CHANGELOG_WEBHOOK_KEY);

// Saving a webhook starts a fresh baseline, so a new channel gets what comes
// next and not what came before. "" clears it.
export async function setChangelogWebhook(prisma, url) {
  await writeSetting(prisma, CHANGELOG_WEBHOOK_KEY, url || "");
  const state = await readState(prisma);
  await writeState(prisma, { ...state, baselined: false });
}

async function readState(prisma) {
  try {
    const s = JSON.parse((await readSetting(prisma, STATE_KEY)) || "{}");
    return { baselined: !!s.baselined, ids: Array.isArray(s.ids) ? s.ids.map(String) : [] };
  } catch {
    return { baselined: false, ids: [] };
  }
}

async function writeState(prisma, state) {
  await writeSetting(prisma, STATE_KEY, JSON.stringify({ baselined: !!state.baselined, ids: state.ids.slice(-KEEP_IDS) }));
}

// One changelog entry as a webhook message, written the way somebody would
// post it in Discord by hand: a heading, the changes as plain bullet points
// under New / Changed / Fixed, and the link small underneath. No card, no
// emoji labels; the link sits in <> so Discord shows no preview box for it.
// Discord's 2000-character cap is kept. Pure.
const GROUPS = [
  ["new", "New"],
  ["better", "Changed"],
  ["fixed", "Fixed"],
];

export function changelogMessage(entry, origin = ORIGIN) {
  const defuse = (s) => String(s || "").replace(/@(everyone|here)/gi, "@\u200b$1");
  const lines = [`## Website update${entry.title ? `: ${defuse(entry.title)}` : ""}`];
  for (const [tag, label] of GROUPS) {
    const items = (entry.items || []).filter((it) => (TAG_OF[it.tag] || "better") === tag);
    if (!items.length) continue;
    lines.push(`**${label}**`, ...items.map((it) => `- ${defuse(it.text)}`));
  }
  const link = `-# Full changelog: <${origin}/changelog>`;
  let content = lines.join("\n");
  if (content.length + link.length + 1 > 2000) content = `${content.slice(0, 2000 - link.length - 3)}…`;
  return { username: "NABS Racing", allowed_mentions: { parse: [] }, content: `${content}\n${link}` };
}

export async function postChangelogEntry(url, entry, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changelogMessage(entry)),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Discord answered ${res.status}`);
}

// Which entries of the feed are new to the channel: not posted yet, oldest
// first so they arrive in the order they happened. Pure.
export function entriesToPost(entries, postedIds) {
  const posted = new Set(postedIds);
  return (entries || []).filter((e) => e?.id && e.items?.length && !posted.has(e.id)).reverse();
}

// The check: post what is new, or, the first time, only take note of it.
// Answers what it did, for the log and the tests.
let running = false;
export async function syncChangelogToDiscord(prisma, { feed = getChangelogFeed, fetchImpl = fetch } = {}) {
  if (running) return { skipped: "busy" };
  running = true;
  try {
    const url = await getChangelogWebhook(prisma);
    if (!url) return { skipped: "no webhook" };
    const { entries } = await feed({ maxAgeMs: CHANGELOG_POLL_MS });
    if (!entries?.length) return { skipped: "no entries" };
    const state = await readState(prisma);
    if (!state.baselined) {
      await writeState(prisma, { baselined: true, ids: [...state.ids, ...entries.map((e) => e.id)] });
      return { baselined: entries.length };
    }
    let posted = 0;
    for (const entry of entriesToPost(entries, state.ids)) {
      await postChangelogEntry(url, entry, { fetchImpl });
      state.ids.push(entry.id);
      await writeState(prisma, state);
      posted += 1;
    }
    return { posted };
  } finally {
    running = false;
  }
}
