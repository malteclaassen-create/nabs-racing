// ---------------------------------------------------------------------------
// Free announcements: the admin writes the words, picks who hears them, and the
// site delivers them to the bell and/or the events channel on Discord.
//
// Everything else in the bell is written by an event (results saved, a seat
// offered). This is the one kind a person writes, which is why it validates
// harder than the rest: a title that says nothing, a link that runs script, or
// a double click that pings sixty people twice are all things a form lets
// through unless something here says no.
//
// Delivery reuses the ordinary Notification rows. "Everyone" is ONE broadcast
// row (recipientId null) — every member sees it, including the ones who log in
// for the first time next week, which is what "everyone" means. A narrower
// audience is one personal row per linked login, because a broadcast cannot be
// narrowed. All rows of one announcement share the dedupe prefix
// `announce:<id>`, so a retried request can never write a second copy.
//
// The history ("who sent what to whom, when, where") lives in one Setting blob
// of the last 20 rather than on the Notification rows: those have no column for
// the sender, the audience or the channels, and a narrow announcement is sixty
// rows that would have to be grouped back into one line. Adding columns would
// mean a migration for what is an admin's logbook; the blob is read by one
// screen and capped, so it never grows.
// ---------------------------------------------------------------------------
import { getPersonGroups, discordIdsForDrivers } from "./persons.js";
import { collapseByPerson } from "./onePerPerson.js";
import { isReserveRow, reachableDiscordIds } from "./stillToAnswer.js";

export const ANNOUNCE_LOG_KEY = "announcement_log";
export const ANNOUNCE_LOG_SIZE = 20;

// Short enough to read in the bell's 320px panel without it turning into a
// letter; Discord's own 2000-character cap is far above all three together.
export const ANNOUNCE_LIMITS = { title: 90, body: 500, link: 300 };

export const ANNOUNCE_AUDIENCES = {
  everyone: "Everyone",
  season: "Drivers of the season",
  reserves: "Reserves only",
  fulltime: "Full-time drivers only",
};

// The same announcement arriving twice inside this window is a double submit
// (a reload that minted a new id, two admins pressing at once), not a repeat.
export const ANNOUNCE_REPEAT_MS = 60 * 1000;

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
// Control characters, including the zero-width and bidi ones that make a
// link read as something it is not.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/;

// A link is either a path on this site or a plain web address. Anything else
// (javascript:, data:, a protocol-relative //host that leaves the site while
// looking like a path, the bell's internal tour: links) is refused rather than
// cleaned up: the admin should see that the link they typed is not the one
// that would have gone out.
export function checkLink(raw) {
  const link = String(raw ?? "").trim();
  if (!link) return { link: null };
  if (link.length > ANNOUNCE_LIMITS.link) return { error: `The link is too long (${ANNOUNCE_LIMITS.link} characters at most).` };
  if (/\s/.test(link) || CONTROL_RE.test(link)) return { error: "The link can't contain spaces." };
  if (link.startsWith("/")) {
    if (link.startsWith("//") || link.startsWith("/\\")) {
      return { error: "A site link starts with a single /, like /attendance." };
    }
    return { link };
  }
  let url;
  try {
    url = new URL(link);
  } catch {
    return { error: "The link must be a site path like /attendance, or a web address starting with https://." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "Only site paths and http(s) web addresses can be linked." };
  }
  if (!url.hostname) return { error: "That web address has no host." };
  return { link: url.href };
}

// Validate the whole form. Returns { value } or { error }; never throws.
export function validateAnnouncement(input) {
  const o = input && typeof input === "object" ? input : {};
  const id = String(o.id ?? "");
  if (!ID_RE.test(id)) return { error: "Missing announcement id. Reload the page and try again." };

  const title = String(o.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { error: "The announcement needs a title." };
  if (title.length > ANNOUNCE_LIMITS.title) return { error: `The title is too long (${ANNOUNCE_LIMITS.title} characters at most).` };
  if (CONTROL_RE.test(title)) return { error: "The title contains invisible characters." };

  // Line breaks are kept in the message (Discord shows them; the bell folds
  // them), everything else invisible is not.
  const body = String(o.body ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (body.length > ANNOUNCE_LIMITS.body) return { error: `The message is too long (${ANNOUNCE_LIMITS.body} characters at most).` };
  if (CONTROL_RE.test(body.replace(/\n/g, ""))) return { error: "The message contains invisible characters." };

  const checked = checkLink(o.link);
  if (checked.error) return { error: checked.error };

  const audience = String(o.audience ?? "");
  if (!Object.hasOwn(ANNOUNCE_AUDIENCES, audience)) return { error: "Pick who the announcement is for." };

  const ch = o.channels && typeof o.channels === "object" ? o.channels : {};
  const channels = { bell: ch.bell === true, discord: ch.discord === true };
  if (!channels.bell && !channels.discord) return { error: "Pick at least one channel: the bell, Discord, or both." };

  return { value: { id, title, body: body || null, link: checked.link, audience, channels } };
}

// Which of the season's rows an audience covers. Pure, so the rule can be
// tested. One row per PERSON (lib/onePerPerson.js); where one person has a
// real team AND a Reserve-pool row, the real team wins, the same tie-break the
// "Still to answer" list uses — so "full-time only" reaches a driver who also
// sits in the reserve pool, and "reserves only" does not.
export function audienceRows({ rows, byDriver, audience }) {
  const people = collapseByPerson(
    (rows || []).map((d) => ({ ...d, driverId: d.id })),
    byDriver,
    (d) => (isReserveRow(d) ? 0 : 1)
  ).kept;
  if (audience === "reserves") return people.filter(isReserveRow);
  if (audience === "fulltime") return people.filter((d) => !isReserveRow(d));
  return people;
}

// Who an announcement reaches, from the database. For "everyone" that is every
// member who has logged in and is not banned (they see the broadcast); for the
// others it is the linked logins of the matching drivers, and `withoutLogin`
// counts the drivers the bell cannot reach at all.
export async function resolveAudience(prisma, { audience, seasonId }) {
  if (audience === "everyone") {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "MemberAccount" WHERE "banned" = 0`);
    return { broadcast: true, recipients: [], reach: Number(rows[0]?.n || 0), drivers: null, withoutLogin: 0 };
  }
  if (!seasonId) return { broadcast: false, recipients: [], reach: 0, drivers: 0, withoutLogin: 0 };
  const [rows, people] = await Promise.all([
    prisma.driver.findMany({
      where: { seasonId, isActive: true },
      include: { team: { select: { tier: true } } },
    }),
    getPersonGroups(prisma).catch(() => ({ byDriver: new Map() })),
  ]);
  const picked = audienceRows({ rows, byDriver: people.byDriver, audience });
  const ids = await discordIdsForDrivers(prisma, picked.map((d) => d.id)).catch(() => new Map());
  const reachable = await reachableDiscordIds(prisma, [...ids.values()]);
  const recipients = new Set();
  let withoutLogin = 0;
  for (const d of picked) {
    const id = ids.get(d.id);
    if (id && reachable.has(id)) recipients.add(id);
    else withoutLogin += 1;
  }
  return {
    broadcast: false,
    recipients: [...recipients],
    reach: recipients.size,
    drivers: picked.length,
    withoutLogin,
  };
}

// The Discord text. @everyone and @here are broken with a zero-width space:
// the events webhook lets every mention through, and one typed into a free
// text box would ping the whole server — a decision this form never asked
// the admin to make. A site path becomes a full address, since Discord has no
// idea which site "/attendance" is on.
export function discordText({ title, body, link }, origin = "") {
  const defuse = (s) => String(s || "").replace(/@(everyone|here)/gi, "@\u200b$1");
  const href = link && link.startsWith("/") ? `${origin}${link}` : link;
  return [`📣 **${defuse(title)}**`, body ? defuse(body) : null, href || null].filter(Boolean).join("\n");
}

// A fingerprint of what was said to whom, for the double-submit guard.
export const announceFingerprint = (v) =>
  JSON.stringify([v.title, v.body || "", v.link || "", v.audience, !!v.channels?.bell, !!v.channels?.discord]);

export async function readAnnouncementLog(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: ANNOUNCE_LOG_KEY } });
    const arr = row?.value ? JSON.parse(row.value) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Newest first, capped. Returns the stored list.
export async function appendAnnouncementLog(prisma, entry) {
  const list = [entry, ...(await readAnnouncementLog(prisma)).filter((e) => e?.id !== entry.id)].slice(
    0,
    ANNOUNCE_LOG_SIZE
  );
  const value = JSON.stringify(list);
  await prisma.setting.upsert({
    where: { key: ANNOUNCE_LOG_KEY },
    update: { value },
    create: { key: ANNOUNCE_LOG_KEY, value },
  });
  return list;
}

// The earlier send this request repeats, if it is one: the same id (a retried
// request), or the same words to the same audience inside the repeat window.
export function findDuplicate(log, value, now = Date.now()) {
  const fp = announceFingerprint(value);
  return (
    (log || []).find(
      (e) =>
        e?.id === value.id ||
        (announceFingerprint(e) === fp && now - new Date(e.at).getTime() < ANNOUNCE_REPEAT_MS)
    ) || null
  );
}
