// ---------------------------------------------------------------------------
// Grid slots from a qualifying the driver never took part in.
//
// A driver who skips qualifying still gets a grid slot: the back of the field
// (P36 on a 35-car quali sheet, say). That number says nothing about their
// pace, yet it went straight into Avg Grid and Best Grid, so one missed
// session could drag an average of 4 up to 7.
//
// So: where a round has a qualifying on file (Race.qualiJson) and the driver is
// not on it, their grid slot of that round does not count for the grid stats.
// One guard against a false alarm: a quali entrant whose name never matched a
// roster driver has no driverId, and that could be our driver. Then we only
// call it a missed session when the grid slot is behind every car on the
// sheet, which nobody who set a lap can be.
// ---------------------------------------------------------------------------

const CHUNK = 400; // keep IN (...) lists well under SQLite's bind limit

// Map<raceId, { ids: Set<driverId>, count, unmatched }> for the given races
// that have a qualifying on file. Races without one are absent.
export async function readQualiSheets(prisma, raceIds) {
  const ids = [...new Set([...(raceIds || [])].filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    let rows = [];
    try {
      rows = await prisma.$queryRawUnsafe(
        `SELECT "id", "qualiJson" FROM "Race" WHERE "qualiJson" IS NOT NULL AND "id" IN (${slice.map(() => "?").join(",")})`,
        ...slice
      );
    } catch {
      rows = []; // column missing (pre-migration): no sheets, nothing changes
    }
    for (const row of rows) {
      const sheet = sheetOf(row?.qualiJson);
      if (sheet) out.set(row.id, sheet);
    }
  }
  return out;
}

// The parsed sheet of one qualiJson string, or null. Pure, for the tests and
// for callers that already hold the blob.
export function sheetOf(qualiJson) {
  if (!qualiJson) return null;
  let blob;
  try {
    blob = typeof qualiJson === "string" ? JSON.parse(qualiJson) : qualiJson;
  } catch {
    return null; // a corrupt blob changes nothing
  }
  const entries = Array.isArray(blob?.entries) ? blob.entries.filter(Boolean) : [];
  if (!entries.length) return null;
  return {
    ids: new Set(entries.map((e) => e.driverId).filter(Boolean)),
    count: entries.length,
    unmatched: entries.some((e) => !e.driverId),
  };
}

// Did this result's driver miss the qualifying of its race? Pure.
export function missedQuali(result, sheets) {
  const sheet = sheets?.get(result?.raceId);
  if (!sheet || !result?.driverId) return false;
  if (sheet.ids.has(result.driverId)) return false;
  if (!sheet.unmatched) return true;
  return result.grid != null && result.grid > sheet.count;
}

// The grid slot as the grid stats should see it: null when the driver missed
// that round's qualifying, the stored slot otherwise.
export function statGrid(result, sheets) {
  if (result?.grid == null) return null;
  return missedQuali(result, sheets) ? null : result.grid;
}
