// ---------------------------------------------------------------------------
// Nightly database upkeep. Three chores, once a day in the small hours (UTC),
// so the database file on the volume only ever holds what the site uses:
//
//   1. Live incidents (services/liveIncidents.js) older than a month go. The
//      race control board only ever reads the session that is running, from
//      its start, so a collision from last month is never shown again - but
//      every one of them was being kept, from every 24/7 practice session,
//      and copied into all forty backups besides.
//   2. The WAL file is checkpointed and cut back to nothing. SQLite reuses it
//      without shrinking it, so one busy evening (a backup reading while
//      results are written) left it at its biggest size for good.
//   3. VACUUM, when deleted rows have left a real share of the file empty.
//      SQLite reuses free pages but never gives them back to the disk; old
//      notifications, traffic rows and incidents pruned above stay as holes.
//      Only when nobody is on track, because it locks the database for the
//      second or two it takes.
// ---------------------------------------------------------------------------

export const INCIDENT_KEEP_DAYS = 30;
// The hour (UTC) the upkeep runs in: 3-4 in the morning in Europe, hours
// away from any league race.
export const MAINTENANCE_HOUR_UTC = 3;
// VACUUM only when at least this share of the file AND this many bytes are
// free pages: below that the rewrite is not worth the lock.
const VACUUM_MIN_FREE_SHARE = 0.2;
const VACUUM_MIN_FREE_BYTES = 8 * 1024 * 1024;

export async function pruneOldIncidents(prisma, now = Date.now()) {
  const cutoff = now - INCIDENT_KEEP_DAYS * 24 * 3600 * 1000;
  return prisma.$executeRawUnsafe(`DELETE FROM "Incident" WHERE "createdAtMs" < ?`, cutoff);
}

export function worthVacuuming({ pageSize, pageCount, freePages }) {
  if (!pageCount || !pageSize) return false;
  return freePages / pageCount >= VACUUM_MIN_FREE_SHARE && freePages * pageSize >= VACUUM_MIN_FREE_BYTES;
}

const pragmaNumber = async (prisma, name) => {
  const rows = await prisma.$queryRawUnsafe(`PRAGMA ${name}`);
  return Number(Object.values(rows?.[0] || {})[0] || 0);
};

// One night's run. `isQuiet()` says whether nobody is driving on any server
// right now; without it VACUUM is skipped. Every step stands alone: one that
// fails is logged and the others still run.
export async function runDbMaintenance(prisma, { isQuiet = () => false } = {}) {
  const out = { incidents: 0, vacuumed: false, freeShare: null };
  try {
    out.incidents = Number(await pruneOldIncidents(prisma)) || 0;
  } catch (e) {
    console.error("[db] incident prune:", e?.message || e);
  }
  try {
    const stats = {
      pageSize: await pragmaNumber(prisma, "page_size"),
      pageCount: await pragmaNumber(prisma, "page_count"),
      freePages: await pragmaNumber(prisma, "freelist_count"),
    };
    out.freeShare = stats.pageCount ? Math.round((stats.freePages / stats.pageCount) * 100) / 100 : 0;
    if (worthVacuuming(stats) && isQuiet()) {
      await prisma.$executeRawUnsafe("VACUUM");
      out.vacuumed = true;
    }
  } catch (e) {
    console.error("[db] vacuum:", e?.message || e);
  }
  try {
    // After the VACUUM, which in WAL mode writes the whole file through the WAL.
    await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (e) {
    console.error("[db] wal checkpoint:", e?.message || e);
  }
  console.log(
    `[db] nightly upkeep: ${out.incidents} old incident(s) removed, ` +
      `${out.vacuumed ? "vacuumed" : "no vacuum"} (free share ${out.freeShare}), WAL checkpointed`
  );
  return out;
}

// Checks every 20 minutes (an hourly timer drifts, and could step over the
// hour now and then); runs on the first check inside the maintenance hour,
// once per day. unref() so it never holds the process open.
export function startDbMaintenance(prisma, { isQuiet } = {}) {
  let lastDay = null;
  const tick = () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== MAINTENANCE_HOUR_UTC || day === lastDay) return;
    lastDay = day;
    runDbMaintenance(prisma, { isQuiet }).catch((e) => console.error("[db] upkeep:", e?.message || e));
  };
  return setInterval(tick, 20 * 60 * 1000).unref();
}
