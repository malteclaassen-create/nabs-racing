import { resolveSeries } from "./series.js";

// Admin-editable content of the Race Info page (intro, "New here?" hint, rule
// cards, sporting regulations, footnotes). Stored as one JSON blob in the
// Setting table; the frontend falls back to its built-in defaults while
// nothing is saved yet.

export const RACE_INFO_KEY = "race_info_content";

// A special event (Series.kind "event") has a Race Info page of its own: its
// car, its format and its rules, none of the championship's points or tiers.
// Stored per series. Championships all share the one page above.
export async function raceInfoKeyFor(prisma, slug, { includePrivate = false } = {}) {
  const series = await resolveSeries(prisma, slug, { includePrivate });
  if (series?.kind === "event") return { key: `${RACE_INFO_KEY}:series:${series.id}`, event: true };
  return { key: RACE_INFO_KEY, event: false };
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Sanitize whatever the admin editor sends into a well-formed content object.
// Lenient on purpose (drops broken entries instead of rejecting the save), but
// hard-capped so nobody can store megabytes under this key.
export function sanitizeRaceInfo(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out = {
    subtitle: str(input.subtitle, 300),
    cards: [],
    pointsFootnote: str(input.pointsFootnote, 600),
    rulebook: [],
    rulebookFootnote: str(input.rulebookFootnote, 600),
  };
  // The "New here?" hint in the page header. Content saved before the hint was
  // editable has no such key, and that must keep showing the standard hint, so
  // the key is only written when the editor sent it. An empty string is a real
  // answer: the admin cleared it and the page hides the hint.
  if (typeof input.newHere === "string") out.newHere = str(input.newHere, 400);
  for (const c of Array.isArray(input.cards) ? input.cards.slice(0, 12) : []) {
    if (!c || typeof c !== "object") continue;
    const title = str(c.title, 120);
    const text = str(c.text, 1000);
    if (!title || !text) continue;
    out.cards.push({ icon: str(c.icon, 30) || "info", title, text });
  }
  for (const g of Array.isArray(input.rulebook) ? input.rulebook.slice(0, 24) : []) {
    if (!g || typeof g !== "object") continue;
    const subject = str(g.subject, 120);
    const rules = (Array.isArray(g.rules) ? g.rules.slice(0, 40) : [])
      .map((r) => str(r, 600))
      .filter(Boolean);
    if (!subject || !rules.length) continue;
    out.rulebook.push({ subject, icon: str(g.icon, 30) || "info", rules });
  }
  return out;
}

export async function readRaceInfo(prisma, key = RACE_INFO_KEY) {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return sanitizeRaceInfo(JSON.parse(row.value));
  } catch {
    return null;
  }
}

// content = null clears the override (page goes back to the built-in defaults).
export async function writeRaceInfo(prisma, content, key = RACE_INFO_KEY) {
  if (content == null) {
    await prisma.setting.deleteMany({ where: { key } });
    return null;
  }
  const clean = sanitizeRaceInfo(content);
  if (!clean) throw Object.assign(new Error("Invalid race info content"), { status: 400 });
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  return clean;
}
