// ---------------------------------------------------------------------------
// The profile studio: designs a member can put on their public profile page
// (themes, banners, lettering, stats styles, effects), bought with NABS Points.
//
// The catalogue is shared with the frontend (shared/profileCosmetics.json):
// the site draws the designs, this file sells them and remembers what each
// member wears. Ownership IS the purchase row in TokenRedemption (itemKey =
// design id), like the card designs; what is worn lives in ProfileStyle.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { discordIdsForDrivers } from "./persons.js";
import { PROFILE_SLOTS, EMPTY_APPEARANCE, EMPTY_PROFILE_CONTENT } from "../../../shared/profileCustomization.mjs";

export const STUDIO_ITEMS = JSON.parse(
  readFileSync(new URL("../../../shared/profileCosmetics.json", import.meta.url), "utf8")
);
export const STUDIO_BY_ID = new Map(STUDIO_ITEMS.map((i) => [i.id, i]));
export const STUDIO_IDS = STUDIO_ITEMS.map((i) => i.id);
export const STUDIO_SLOTS = PROFILE_SLOTS;
export { EMPTY_APPEARANCE, EMPTY_PROFILE_CONTENT };

// Uploaded pictures carry the owner in the file name, hashed, so a picture can
// be checked against the member saving it without a lookup table.
export const profileMediaOwner = (discordId) => createHash("sha256").update(String(discordId)).digest("hex").slice(0, 32);

const empty = () => ({ ...EMPTY_APPEARANCE });

// One design's price: the league's per-slot override if set, else the catalogue.
export function studioPriceOf(item, studioOverrides = {}) {
  if (!item) return null;
  return studioOverrides?.[item.slot]?.cost ?? item.price;
}

// The catalogue with prices applied, for the studio page.
export function studioCatalogue(studioOverrides = {}) {
  return STUDIO_ITEMS.map((i) => ({ ...i, price: studioPriceOf(i, studioOverrides) }));
}

// Which designs this member holds. A declined (refunded) purchase stops counting.
export async function ownedStudioItems(prisma, discordId) {
  if (!discordId) return new Set();
  try {
    const ph = STUDIO_IDS.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT "itemKey" FROM "TokenRedemption"
        WHERE "discordId" = ? AND "status" <> 'DECLINED' AND "itemKey" IN (${ph})`,
      discordId,
      ...STUDIO_IDS
    );
    return new Set(rows.map((r) => r.itemKey));
  } catch {
    return new Set();
  }
}

async function styleRow(prisma, discordId) {
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "ProfileStyle" WHERE "discordId" = ?`, discordId).catch(() => []);
  return rows[0] || null;
}

function readContent(raw) {
  try {
    return { ...EMPTY_PROFILE_CONTENT, ...JSON.parse(raw || "{}") };
  } catch {
    return { ...EMPTY_PROFILE_CONTENT };
  }
}

// What is worn: only designs that are owned AND fit the slot they sit in.
function wornFrom(row, owned) {
  const out = empty();
  for (const slot of STUDIO_SLOTS) {
    const id = row?.[slot];
    if (id && owned.has(id) && STUDIO_BY_ID.get(id)?.slot === slot) out[slot] = id;
  }
  return out;
}

export async function readStudio(prisma, discordId) {
  const owned = await ownedStudioItems(prisma, discordId);
  const row = await styleRow(prisma, discordId);
  return { owned: [...owned], equipped: wornFrom(row, owned), content: readContent(row?.content) };
}

// Put designs on the profile. Every design named must be owned; slots left out
// keep what they had; null clears a slot. `content` is the personal settings
// (title, banner photo, accent colour ...), validated below.
export async function equipStudio(prisma, discordId, appearance, content) {
  if (!discordId) return { error: "Sign in with Discord first" };
  if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) return { error: "Invalid profile appearance" };
  if (Object.keys(appearance).some((s) => !STUDIO_SLOTS.includes(s))) return { error: "Invalid profile appearance" };
  const current = await readStudio(prisma, discordId);
  const owned = new Set(current.owned);
  const next = { ...current.equipped, ...appearance };
  for (const slot of STUDIO_SLOTS) {
    const id = next[slot];
    if (id != null && (!owned.has(id) || STUDIO_BY_ID.get(id)?.slot !== slot)) return { error: "Unlock this design before using it" };
  }
  const cleaned = content === undefined ? current.content : validateContent(content, discordId, current.content);
  if (cleaned?.error) return cleaned;
  const cols = STUDIO_SLOTS.map((s) => `"${s}"`).join(",");
  const marks = STUDIO_SLOTS.map(() => "?").join(",");
  const sets = STUDIO_SLOTS.map((s) => `"${s}"=excluded."${s}"`).join(",");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProfileStyle" ("discordId",${cols},"content","updatedAt") VALUES (?,${marks},?,CURRENT_TIMESTAMP)
     ON CONFLICT("discordId") DO UPDATE SET ${sets},"content"=excluded."content","updatedAt"=CURRENT_TIMESTAMP`,
    discordId,
    ...STUDIO_SLOTS.map((s) => next[s] ?? null),
    JSON.stringify(cleaned)
  );
  return readStudio(prisma, discordId);
}

// The personal settings, checked field by field. Returns the cleaned object or
// { error }. Older clients send only the fields they know; the rest is kept.
export function validateContent(input, discordId, previous = EMPTY_PROFILE_CONTENT) {
  const bad = (m) => ({ error: m });
  if (!input || typeof input !== "object" || Array.isArray(input)) return bad("Invalid profile content");
  if (Object.keys(input).some((k) => !Object.hasOwn(EMPTY_PROFILE_CONTENT, k))) return bad("Invalid profile content");
  const c = { ...EMPTY_PROFILE_CONTENT, ...previous, ...input };
  for (const [field, max] of [["title", 32], ["showcaseTitle", 60], ["showcaseText", 240]]) {
    if (typeof c[field] !== "string" || c[field].length > max) return bad(`Invalid ${field}`);
    c[field] = c[field].trim();
  }
  if (!Number.isFinite(c.bannerPosition) || c.bannerPosition < 0 || c.bannerPosition > 100) return bad("Invalid banner position");
  if (c.accentColor !== null && (typeof c.accentColor !== "string" || !/^#[0-9a-f]{6}$/i.test(c.accentColor))) return bad("Invalid accent colour");
  for (const [field, choices] of [
    ["panelShape", ["theme", "square", "soft", "round"]],
    ["density", ["comfortable", "compact"]],
    ["nameCase", ["theme", "upper", "natural"]],
  ]) {
    if (!choices.includes(c[field])) return bad(`Invalid ${field}`);
  }
  for (const [field, min, max] of [["bannerStrength", 0, 100], ["effectStrength", 0, 100], ["nameScale", 80, 120]]) {
    if (!Number.isSafeInteger(c[field]) || c[field] < min || c[field] > max) return bad(`Invalid ${field}`);
  }
  if (typeof c.motion !== "boolean") return bad("Invalid motion preference");
  if (!["card", "photo", "achievement"].includes(c.showcaseMode)) return bad("Invalid showcase type");
  if (c.achievementKey !== null && (typeof c.achievementKey !== "string" || !/^[a-z0-9_-]{1,80}$/i.test(c.achievementKey))) return bad("Invalid achievement");
  // Pictures have to be the member's own uploads, nothing linked from elsewhere.
  const prefix = `/api/uploads/profile-studio/${profileMediaOwner(discordId)}-`;
  for (const field of ["bannerImage", "showcaseImage"]) {
    const v = c[field];
    if (v === null) continue;
    if (typeof v !== "string" || !v.startsWith(prefix)) return bad("Use one of your uploaded pictures");
    if (!/^[a-z0-9-]+\.(png|jpg|webp)$/.test(v.slice("/api/uploads/profile-studio/".length))) return bad("Use one of your uploaded pictures");
  }
  return c;
}

// For the public profile page: what this driver's person wears, and their
// settings. Empty when they never touched the studio.
export async function readDriverStudio(prisma, driverId) {
  const discordId = (await discordIdsForDrivers(prisma, [driverId])).get(driverId);
  if (!discordId) return { appearance: empty(), profileContent: { ...EMPTY_PROFILE_CONTENT } };
  const owned = await ownedStudioItems(prisma, discordId);
  const row = await styleRow(prisma, discordId);
  return { appearance: wornFrom(row, owned), profileContent: readContent(row?.content) };
}
