// Admin-editable FAQ shown on the public Welcome (newcomer) page. Stored as one
// JSON blob in the Setting table; while nothing is saved the frontend falls
// back to its built-in, season-aware default questions.

export const WELCOME_FAQ_KEY = "welcome_faq_content";

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Sanitize whatever the admin editor sends into a clean [{ q, a }] list.
// Lenient (drops incomplete entries instead of rejecting the save) and capped.
export function sanitizeWelcomeFaq(input) {
  const items = Array.isArray(input) ? input : Array.isArray(input?.items) ? input.items : null;
  if (!items) return null;
  const out = [];
  for (const it of items.slice(0, 30)) {
    if (!it || typeof it !== "object") continue;
    const q = str(it.q, 200);
    const a = str(it.a, 1500);
    if (!q || !a) continue;
    out.push({ q, a });
  }
  return out;
}

export async function readWelcomeFaq(prisma) {
  const row = await prisma.setting.findUnique({ where: { key: WELCOME_FAQ_KEY } });
  if (!row) return null;
  try {
    return sanitizeWelcomeFaq(JSON.parse(row.value));
  } catch {
    return null;
  }
}

// content = null (or an empty list) clears the override → built-in defaults.
export async function writeWelcomeFaq(prisma, content) {
  const clean = content == null ? null : sanitizeWelcomeFaq(content);
  if (!clean || clean.length === 0) {
    await prisma.setting.deleteMany({ where: { key: WELCOME_FAQ_KEY } });
    return null;
  }
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: WELCOME_FAQ_KEY },
    update: { value },
    create: { key: WELCOME_FAQ_KEY, value },
  });
  return clean;
}
