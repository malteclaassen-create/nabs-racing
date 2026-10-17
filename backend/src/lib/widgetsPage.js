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
//
// The page's Android half (the NABS app, android/) has a switch of its own, the
// same way round: admins first, then everyone. It only matters once the page
// itself is open; until then nobody but the admins sees either half. The app
// download (/android.apk) is not gated, only the page that offers it.
// ---------------------------------------------------------------------------

export const WIDGETS_PAGE_PUBLIC_KEY = "widgets_page_public";
export const WIDGETS_ANDROID_PUBLIC_KEY = "widgets_android_public";

// Read on every profile visit, changed about once. Thirty seconds, the same
// bargain as lib/telemetryAccess.js: a flip takes hold on the next page.
const CACHE_MS = 30_000;
let cache = new Map(); // key -> { at, value }

export function invalidateWidgetsPageVisibility() {
  cache = new Map();
}

async function readSwitch(prisma, key) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  let on = false;
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    on = String(row?.value || "") === "1";
  } catch {
    // A database that cannot answer keeps it with the admins.
    on = false;
  }
  cache.set(key, { at: now, value: on });
  return on;
}

async function writeSwitch(prisma, key, on) {
  const value = on ? "1" : "";
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  invalidateWidgetsPageVisibility();
  return !!on;
}

export const isWidgetsPagePublic = (prisma) => readSwitch(prisma, WIDGETS_PAGE_PUBLIC_KEY);
export const setWidgetsPagePublic = (prisma, on) => writeSwitch(prisma, WIDGETS_PAGE_PUBLIC_KEY, on);
export const isAndroidWidgetsPublic = (prisma) => readSwitch(prisma, WIDGETS_ANDROID_PUBLIC_KEY);
export const setAndroidWidgetsPublic = (prisma, on) => writeSwitch(prisma, WIDGETS_ANDROID_PUBLIC_KEY, on);
