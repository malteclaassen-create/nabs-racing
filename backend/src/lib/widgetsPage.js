// ---------------------------------------------------------------------------
// Who sees the Widgets section of the personal area.
//
// The iPhone widgets are tried out by the admins first. The section sits in
// every member's profile menu from the start, but only admins get it until an
// admin switches this on (Admin -> Site texts -> Widgets). Then it is everyone's,
// with no deploy in between.
//
// Only the page is gated. The widget data (/api/widget) and the setup files stay
// public, because the widgets on a phone fetch them without anybody signed in.
// ---------------------------------------------------------------------------

export const WIDGETS_PAGE_PUBLIC_KEY = "widgets_page_public";

// Read on every profile visit, changed about once. Thirty seconds, the same
// bargain as lib/telemetryAccess.js: a flip takes hold on the next page.
const CACHE_MS = 30_000;
let cache = { at: 0, value: null };

export function invalidateWidgetsPageVisibility() {
  cache = { at: 0, value: null };
}

export async function isWidgetsPagePublic(prisma) {
  const now = Date.now();
  if (cache.value !== null && now - cache.at < CACHE_MS) return cache.value;
  let on = false;
  try {
    const row = await prisma.setting.findUnique({ where: { key: WIDGETS_PAGE_PUBLIC_KEY } });
    on = String(row?.value || "") === "1";
  } catch {
    // A database that cannot answer keeps it with the admins.
    on = false;
  }
  cache = { at: now, value: on };
  return on;
}

export async function setWidgetsPagePublic(prisma, on) {
  const value = on ? "1" : "";
  await prisma.setting.upsert({
    where: { key: WIDGETS_PAGE_PUBLIC_KEY },
    create: { key: WIDGETS_PAGE_PUBLIC_KEY, value },
    update: { value },
  });
  invalidateWidgetsPageVisibility();
  return !!on;
}
