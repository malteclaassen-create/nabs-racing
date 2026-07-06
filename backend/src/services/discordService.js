// ---------------------------------------------------------------------------
// Discord integration via WEBHOOK (no bot to host).
// Posts an Apollo-style event message listing who has Accepted / Declined /
// Tentative for an upcoming race, and EDITS that same message on every change
// (the message id is stored on the Race).
// ---------------------------------------------------------------------------

const WEBHOOK_KEY = "discord_webhook_url";

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

// Order matches the Apollo layout: Accepted · Declined · Tentative
const STATUS_META = {
  ACCEPTED: { label: "✅ Accepted", color: 0x16a34a },
  DECLINED: { label: "❌ Declined", color: 0xb91c1c },
  TENTATIVE: { label: "❓ Tentative", color: 0xeab308 },
};

function fmtDate(date) {
  if (!date) return "Date TBA";
  // Discord renders <t:unix:F> as a localized timestamp for every viewer.
  const unix = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${unix}:F>`;
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
  if (race.info) desc.push(race.info);
  desc.push("Sign up on the NABS Racing website.");

  return {
    title: `🏁 Round ${race.number} · ${race.track}`,
    description: desc.join("\n"),
    color: 0xb91c1c,
    fields,
    footer: { text: "NABS Racing League · Season 7" },
    timestamp: new Date().toISOString(),
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
      include: { rsvps: { include: { driver: true } } },
    });
    if (!race) return { ok: false, reason: "race not found" };

    const payload = { embeds: [buildEmbed(race, race.rsvps)] };

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
