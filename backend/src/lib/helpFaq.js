// Admin-editable Help & troubleshooting page (/help). Same storage as the
// Welcome FAQ (welcomeFaq.js): one JSON blob in the Setting table, and while
// nothing is saved the frontend shows its built-in questions
// (frontend/src/data/helpDefaults.js).
//
// Shape: { topics: [{ title, items: [{ q, a }] }] }. Topics exist so the page
// can be read as "Joining the server", "Race day", ... instead of one long list;
// the admins asked for a place to point people at, so it has to be scannable.

export const HELP_FAQ_KEY = "help_faq_content";

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Lenient like the other content blobs: incomplete entries are dropped instead
// of failing the save, and everything is capped.
export function sanitizeHelpFaq(input) {
  const topics = Array.isArray(input) ? input : Array.isArray(input?.topics) ? input.topics : null;
  if (!topics) return null;
  const out = [];
  for (const t of topics.slice(0, 20)) {
    if (!t || typeof t !== "object") continue;
    const title = str(t.title, 80);
    const items = [];
    for (const it of (Array.isArray(t.items) ? t.items : []).slice(0, 40)) {
      if (!it || typeof it !== "object") continue;
      const q = str(it.q, 200);
      const a = str(it.a, 3000);
      if (q && a) items.push({ q, a });
    }
    if (title && items.length) out.push({ title, items });
  }
  return { topics: out };
}

export async function readHelpFaq(prisma) {
  const row = await prisma.setting.findUnique({ where: { key: HELP_FAQ_KEY } });
  if (!row) return null;
  try {
    const clean = sanitizeHelpFaq(JSON.parse(row.value));
    return clean?.topics.length ? clean : null;
  } catch {
    return null;
  }
}

// content = null (or nothing usable) clears the override → built-in defaults.
export async function writeHelpFaq(prisma, content) {
  const clean = content == null ? null : sanitizeHelpFaq(content);
  if (!clean || clean.topics.length === 0) {
    await prisma.setting.deleteMany({ where: { key: HELP_FAQ_KEY } });
    return null;
  }
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: HELP_FAQ_KEY },
    update: { value },
    create: { key: HELP_FAQ_KEY, value },
  });
  return clean;
}
