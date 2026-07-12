// ---------------------------------------------------------------------------
// Tiny self-hosted traffic counter (admin "Traffic" tab). Privacy-first:
// no cookies, no external service, nothing personal stored. A visitor is a
// sha256 hash of ip+user-agent+DAY+server secret — the hash rotates every day,
// so the same person can be counted once per day but can never be followed
// across days, and the raw ip/agent never touch the database.
//
// Tables live outside the generated Prisma client (created by ensureAppSchema,
// raw SQL — same pattern as PersonLink/MemberAccount):
//   TrafficView    (day, path, views)  — aggregated page views, stays tiny
//   TrafficVisitor (day, hash)         — daily unique markers, pruned after ~6 months
// ---------------------------------------------------------------------------
import { createHash } from "crypto";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const LEAGUE_TZ = "Europe/Berlin"; // league days, so "today" matches race evenings

export function trafficDay(t = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LEAGUE_TZ }).format(t); // YYYY-MM-DD
}

// Obvious crawlers don't count as people.
const BOT_RE = /bot|crawler|spider|crawling|preview|fetch|monitor|curl|wget|python-requests|headless/i;

// Normalize a SPA path for the stats: strip query/hash, cap length, collapse
// per-driver/team detail pages so the top-pages list stays readable.
export function normalizePath(raw) {
  let p = String(raw || "").split("?")[0].split("#")[0].trim();
  if (!p.startsWith("/") || p.length > 100) return null;
  if (p.startsWith("/admin") || p.startsWith("/auth")) return null; // never counted
  if (p.startsWith("/drivers/")) return "/drivers/<profile>";
  if (p.startsWith("/teams/") || p.startsWith("/constructors/")) return "/teams/<profile>";
  return p;
}

export async function recordHit(prisma, { path, ip, userAgent }) {
  const p = normalizePath(path);
  if (!p) return false;
  if (BOT_RE.test(userAgent || "")) return false;
  const day = trafficDay();
  const hash = createHash("sha256")
    .update(`${day}|${ip || "?"}|${userAgent || "?"}|${SECRET}`)
    .digest("hex")
    .slice(0, 32);
  await prisma.$executeRaw`
    INSERT INTO "TrafficView" ("day","path","views") VALUES (${day}, ${p}, 1)
    ON CONFLICT("day","path") DO UPDATE SET "views" = "views" + 1`;
  await prisma.$executeRaw`
    INSERT INTO "TrafficVisitor" ("day","hash") VALUES (${day}, ${hash})
    ON CONFLICT("day","hash") DO NOTHING`;
  // Occasional cleanup: daily-unique markers older than ~6 months are useless.
  if (Math.random() < 0.01) {
    const cutoff = trafficDay(new Date(Date.now() - 180 * 86400000));
    await prisma.$executeRaw`DELETE FROM "TrafficVisitor" WHERE "day" < ${cutoff}`;
  }
  return true;
}

// Everything the admin Traffic tab shows, in one payload.
export async function getTrafficStats(prisma) {
  const today = trafficDay();
  const since = (days) => trafficDay(new Date(Date.now() - days * 86400000));
  const num = (rows, key = "n") => Number(rows?.[0]?.[key] ?? 0);

  const [vToday, v7, v30, vAll, uToday, u7, u30, uAll, series, pages] = await Promise.all([
    prisma.$queryRaw`SELECT COALESCE(SUM("views"),0) n FROM "TrafficView" WHERE "day" = ${today}`,
    prisma.$queryRaw`SELECT COALESCE(SUM("views"),0) n FROM "TrafficView" WHERE "day" >= ${since(6)}`,
    prisma.$queryRaw`SELECT COALESCE(SUM("views"),0) n FROM "TrafficView" WHERE "day" >= ${since(29)}`,
    prisma.$queryRaw`SELECT COALESCE(SUM("views"),0) n FROM "TrafficView"`,
    prisma.$queryRaw`SELECT COUNT(*) n FROM "TrafficVisitor" WHERE "day" = ${today}`,
    prisma.$queryRaw`SELECT COUNT(*) n FROM "TrafficVisitor" WHERE "day" >= ${since(6)}`,
    prisma.$queryRaw`SELECT COUNT(*) n FROM "TrafficVisitor" WHERE "day" >= ${since(29)}`,
    prisma.$queryRaw`SELECT COUNT(*) n FROM "TrafficVisitor"`,
    prisma.$queryRaw`
      SELECT v."day" day,
             (SELECT COALESCE(SUM("views"),0) FROM "TrafficView" t WHERE t."day" = v."day") views,
             COUNT(*) visitors
      FROM "TrafficVisitor" v
      WHERE v."day" >= ${since(13)}
      GROUP BY v."day" ORDER BY v."day" DESC`,
    prisma.$queryRaw`
      SELECT "path", SUM("views") views FROM "TrafficView"
      WHERE "day" >= ${since(29)}
      GROUP BY "path" ORDER BY views DESC LIMIT 12`,
  ]);

  return {
    views: { today: num(vToday), last7: num(v7), last30: num(v30), total: num(vAll) },
    // Visitors are counted uniquely PER DAY (the anonymous marker rotates
    // daily) — multi-day numbers are the sum of daily uniques.
    visitors: { today: num(uToday), last7: num(u7), last30: num(u30), total: num(uAll) },
    days: series.map((r) => ({ day: r.day, views: Number(r.views), visitors: Number(r.visitors) })),
    topPages: pages.map((r) => ({ path: r.path, views: Number(r.views) })),
  };
}
