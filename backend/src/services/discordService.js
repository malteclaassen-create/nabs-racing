// ---------------------------------------------------------------------------
// Discord integration via WEBHOOK (no bot to host).
// Posts an Apollo-style event message listing who has Accepted / Declined /
// Tentative for an upcoming race, and EDITS that same message on every change
// (the message id is stored on the Race).
// ---------------------------------------------------------------------------
import { raceKickoff } from "../lib/raceKickoff.js";
import { readRaceFormat } from "../lib/raceFormat.js";
import { readRaceTypes } from "../lib/raceTypes.js";

const WEBHOOK_KEY = "discord_webhook_url";
// Results posts go to their OWN channel/webhook (#results), separate from the
// event/RSVP channel above — configured in the results editor.
const RESULTS_WEBHOOK_KEY = "discord_results_webhook_url";

export async function getWebhookUrl(prisma) {
  const s = await prisma.setting.findUnique({ where: { key: WEBHOOK_KEY } });
  return s?.value || null;
}

export async function setWebhookUrl(prisma, url) {
  await prisma.setting.upsert({
    where: { key: WEBHOOK_KEY },
    update: { value: url },
    create: { key: WEBHOOK_KEY, value: url },
  });
}

export async function getResultsWebhookUrl(prisma) {
  const s = await prisma.setting.findUnique({ where: { key: RESULTS_WEBHOOK_KEY } });
  return s?.value || null;
}

export async function setResultsWebhookUrl(prisma, url) {
  await prisma.setting.upsert({
    where: { key: RESULTS_WEBHOOK_KEY },
    update: { value: url },
    create: { key: RESULTS_WEBHOOK_KEY, value: url },
  });
}

// Free-form post to the results channel. Discord caps one message at 2000
// characters, so long posts (a 25-car field plus stats) are split at line
// breaks and sent in order. allowed_mentions lets the <@id> codes ping the
// drivers and any role mention the admin typed into the preview.
export async function postToResultsChannel(prisma, content) {
  const url = await getResultsWebhookUrl(prisma);
  if (!url) return { ok: false, skipped: true, reason: "no results webhook configured" };
  const chunks = [];
  let current = "";
  for (const rawLine of String(content).split("\n")) {
    // A single absurdly long line still has to fit a message on its own.
    const line = rawLine.length > 1900 ? rawLine.slice(0, 1900) : rawLine;
    if (current && current.length + 1 + line.length > 1900) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current.trim()) chunks.push(current);
  if (!chunks.length) return { ok: false, reason: "empty message" };
  try {
    for (const chunk of chunks) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunk, allowed_mentions: { parse: ["users", "roles"] } }),
      });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, reason: `discord ${res.status}: ${text.slice(0, 200)}` };
      }
    }
    return { ok: true, messages: chunks.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Order matches the Apollo layout: Accepted · Declined · Tentative
const STATUS_META = {
  ACCEPTED: { label: "✅ Accepted", color: 0x16a34a },
  DECLINED: { label: "❌ Declined", color: 0xb91c1c },
  TENTATIVE: { label: "❓ Tentative", color: 0xeab308 },
};

function fmtDate(date) {
  // Date-only entries resolve to the league's usual start time (19:00 German
  // time) instead of midnight — see lib/raceKickoff.js.
  const kickoff = raceKickoff(date);
  if (!kickoff) return "Date TBA";
  // Discord renders <t:unix:F> as a localized timestamp for every viewer.
  const unix = Math.floor(kickoff.getTime() / 1000);
  return `<t:${unix}:F>`;
}

// "8" reads better as "Season 8"; a season with a real name keeps it as-is.
// (Same convention as the frontend's season teaser.)
function seasonLabel(season) {
  if (!season?.name) return null;
  const name = String(season.name).trim();
  return /^\d+$/.test(name) ? `Season ${name}` : name;
}

function buildEmbed(race, rsvps) {
  const groups = { ACCEPTED: [], TENTATIVE: [], DECLINED: [] };
  for (const r of rsvps) {
    const name = r.driver?.discordName || r.driver?.name || r.driverId;
    if (groups[r.status]) groups[r.status].push(name);
  }

  const cap = race.capacity || 40;
  const fields = Object.entries(STATUS_META).map(([key, meta]) => {
    // Apollo-style: "Accepted (28/40)" for the accepted column, count only otherwise.
    const count = key === "ACCEPTED" ? `${groups[key].length}/${cap}` : `${groups[key].length}`;
    return {
      name: `${meta.label} (${count})`,
      value: groups[key].length ? groups[key].join("\n") : "—",
      inline: true,
    };
  });

  const desc = [`**${fmtDate(race.date)}**`];
  // Session format line (Apollo-style), only the parts that are actually set.
  const sessions = [];
  if (race.qualiMinutes) sessions.push(`${race.qualiMinutes} min qualifying`);
  if (race.raceLaps) sessions.push(`${race.raceLaps} lap race`);
  if (sessions.length) desc.push("", "**SESSIONS**", sessions.join(" · "));
  // Free text (rules, mods, links…) exactly as the admin wrote it.
  if (race.info) desc.push("", race.info);
  desc.push("", "Sign up on the NABS Racing website.");

  // Footer names the race's OWN season (the race row carries it), so the text
  // stays right across season changes without anyone touching it. No embed
  // timestamp on purpose: Discord would render a localized "today at 12:29"
  // next to the footer, which reads like a second (wrong) race time.
  const season = seasonLabel(race.season);
  // Training sessions have no round number; specials neither (not announced
  // today, but the title must never read "Round null").
  const title =
    race.number != null
      ? `🏁 Round ${race.number} · ${race.track}`
      : race.type === "TRAINING"
        ? `🏁 Training · ${race.track}`
        : `🏁 ${race.track}`;
  return {
    title,
    description: desc.join("\n"),
    color: 0xb91c1c,
    fields,
    footer: { text: season ? `NABS Racing League · ${season}` : "NABS Racing League" },
  };
}

// Posts (first time) or edits (subsequently) the event message for a race.
// Returns { ok, skipped?, messageId? }. Never throws to the caller.
export async function syncRaceToDiscord(prisma, raceId) {
  try {
    const url = await getWebhookUrl(prisma);
    if (!url) return { ok: false, skipped: true, reason: "no webhook configured" };

    const race = await prisma.race.findUnique({
      where: { id: raceId },
      include: { rsvps: { include: { driver: true } }, season: { select: { name: true } } },
    });
    if (!race) return { ok: false, reason: "race not found" };
    // Session format + race type (raw-SQL columns, not in the generated client).
    const format = (await readRaceFormat(prisma, [race.id])).get(race.id) || {};
    const type = (await readRaceTypes(prisma, [race.id])).get(race.id) || null;

    const payload = { embeds: [buildEmbed({ ...race, ...format, type }, race.rsvps)] };

    // Try to edit the existing message first.
    if (race.discordMessageId) {
      const res = await fetch(`${url}/messages/${race.discordMessageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true, messageId: race.discordMessageId };
      // Message was deleted in Discord -> fall through and create a new one.
    }

    // Create a new message (?wait=true returns the created message with its id).
    const res = await fetch(`${url}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, reason: `discord ${res.status}: ${text.slice(0, 200)}` };
    }
    const msg = await res.json();
    await prisma.race.update({
      where: { id: raceId },
      data: { discordMessageId: msg.id },
    });
    return { ok: true, messageId: msg.id };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Lightweight free-form announcement (e.g. results posted).
export async function announce(prisma, content) {
  const url = await getWebhookUrl(prisma);
  if (!url) return { ok: false, skipped: true };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
