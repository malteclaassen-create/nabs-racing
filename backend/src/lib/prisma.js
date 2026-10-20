import { PrismaClient } from "@prisma/client";

// How many SQLite connections Prisma may hold open. Its default is two per CPU
// core plus one, counting the cores of the whole machine: 9 on a 4-core laptop,
// dozens on a large Railway host, each with its own page cache and statement
// cache in memory. SQLite writes one at a time anyway and WAL lets readers run
// beside the writer, so a handful covers this site's traffic. A DATABASE_URL
// that names its own connection_limit keeps it.
export const SQLITE_CONNECTION_LIMIT = 4;

export function withConnectionLimit(url, limit = SQLITE_CONNECTION_LIMIT) {
  if (!url || !url.startsWith("file:") || /[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=${limit}`;
}

const databaseUrl = withConnectionLimit(process.env.DATABASE_URL);

// Single shared Prisma client instance.
const prisma = new PrismaClient(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined);

// SQLite tuning, applied once at boot. The default rollback-journal mode makes
// readers block while a write is in progress: on race night an import commit
// writes while everyone refreshes standings, which surfaces as SQLITE_BUSY. WAL
// lets those readers proceed alongside the writer; busy_timeout makes a
// contended connection wait rather than fail immediately; synchronous=NORMAL is
// the safe durability pairing for WAL. journal_mode is persisted in the db file
// (set once, stays set); busy_timeout is per-connection, so it is re-applied on
// every boot. Must never take the app down: on failure we log and carry on.
async function applySqlitePragmas() {
  try {
    // journal_mode returns a row ("wal"), so query rather than execute.
    await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
    await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL");
  } catch (e) {
    console.error("Could not apply SQLite pragmas (continuing anyway):", e.message);
  }
}
applySqlitePragmas();

export default prisma;
