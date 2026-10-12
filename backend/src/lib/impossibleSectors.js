// ---------------------------------------------------------------------------
// Best sectors nobody could have driven.
//
// The race server keeps every driver's best of each sector, whichever lap it
// was on, and counts cuts per sector. It does not catch everything: on
// Silverstone a driver's best S3 came in at 22.789 with no cut on it, while
// every other S3 of the week, his own best lap's included, was 25.6 or more.
// A short cut the server does not see, or a split taken after a jump back to
// the pits, gives exactly that: one sector seconds quicker than anything else.
//
// So a best sector has to be believable against two things before the board
// shows it, sums it into the potential lap or paints it purple:
//   - the driver's own best lap, whose sectors were driven on a full lap: a
//     best sector more than OWN_SHARE quicker than that lap's sector is not a
//     better line through the same corners, it is a different track;
//   - the rest of the field: more than FIELD_SHARE quicker than anybody else's
//     best of that sector.
// Both have to fail. A driver whose best lap had one messy sector can have a
// best sector well under it, and a quick driver can be clear of the field;
// neither alone is a cut. With nobody else to compare against, the own-lap
// test alone decides, at a wider margin.
//
// A sector that fails is replaced by the sector of the driver's best lap,
// which they did drive, and the time it replaced is kept on the entry
// (droppedSectors) for anyone who wants to see what was taken out.
//
// Pure, so it can be tested without a server.
// ---------------------------------------------------------------------------

export const OWN_SHARE = 0.05;
export const FIELD_SHARE = 0.03;
export const ALONE_SHARE = 0.08;

const msOf = (s) => (s && Number.isFinite(s.ms) && s.ms > 0 ? s.ms : null);

// Is `ms` believable for this sector? `own` is the sector of the driver's best
// lap, `next` the quickest best sector of anyone else (null when unknown).
export function impossibleSector(ms, own, next) {
  if (ms == null) return false;
  if (next == null) return own != null && ms < own * (1 - ALONE_SHARE);
  const fieldFails = ms < next * (1 - FIELD_SHARE);
  if (own == null) return ms < next * (1 - OWN_SHARE);
  return fieldFails && ms < own * (1 - OWN_SHARE);
}

// Goes through a board's entries (each with `sectors`, the best lap's three,
// and `bestSectors`, the driver's best of each) and takes out the best sectors
// that fail. Changes the entries in place; returns, per sector, the times that
// were taken out, so the session's own best of a sector can be checked
// against them.
export function dropImpossibleSectors(entries, { potential = (ms) => (ms.every((v) => v != null) ? ms[0] + ms[1] + ms[2] : null) } = {}) {
  const dropped = [new Set(), new Set(), new Set()];
  const list = (entries || []).filter((e) => Array.isArray(e?.bestSectors));
  for (let i = 0; i < 3; i++) {
    const bests = list.map((e) => msOf(e.bestSectors[i]));
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      const ms = bests[k];
      if (ms == null) continue;
      let next = null;
      bests.forEach((v, j) => { if (j !== k && v != null && (next == null || v < next)) next = v; });
      const own = msOf(e.sectors?.[i]);
      if (!impossibleSector(ms, own, next)) continue;
      dropped[i].add(ms);
      e.droppedSectors = e.droppedSectors || [null, null, null];
      e.droppedSectors[i] = ms;
      e.bestSectors[i] = own != null ? { ...e.sectors[i], best: false, driversBest: true, cuts: 0 } : null;
    }
  }
  for (const e of list) {
    if (!e.droppedSectors) continue;
    e.potentialMs = potential(e.bestSectors.map(msOf));
    // The best lap's own sector is green again: it is their best of it now.
    e.sectors?.forEach((s, i) => { if (s && e.droppedSectors[i] != null) s.driversBest = true; });
  }
  return dropped;
}
