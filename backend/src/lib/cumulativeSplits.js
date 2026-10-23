// ---------------------------------------------------------------------------
// Three sectors out of a track that reports two splits.
//
// On most tracks the server manager hands every car three split records, one
// per sector, each the time spent in that sector. Yas Marina (abu_dhabi_2021_
// chq, layout_f1_2024_pitfix) does not. Practice on 21 October 2026, IvanR's
// 1:39.618:
//
//   BestLapSplits   0: 51.144   1: 82.558      (no record 2)
//   BestSplits      0: 51.061   1: 17.060
//
// Record 1 is written twice a lap. At the second sector line it holds the time
// since the START of the lap (51.144 + 31.414 = 82.558); at the finish line it
// is overwritten with the last sector on its own (99.618 - 82.558 = 17.060).
// The best lap's copy is taken in between, so it keeps the running total, and
// the best-of-each-sector keeps the smaller of the two, which is the last
// sector. Read as they come, the board showed S1 51.144, S2 82.558 and no S3,
// a best S2 of 17 seconds and no potential lap at all.
//
// The lap time puts it right. Two splits that add up to MORE than the lap
// cannot be two sector times, so the second one is the running total and the
// three sectors are a, b - a and lap - b. Seeing that on one car's best lap is
// enough to read the whole snapshot this way: it is the track, not the driver.
//
// What two records cannot say is a driver's best S2 on a lap other than their
// best one (no record of it survives the S3 overwrite), so the best S2 is the
// best lap's. The potential lap is then a little slower than it could be, never
// quicker than anything that was driven.
//
// Times stay in the upstream's nanoseconds and shape, so everything that reads
// the snapshot afterwards (services/liveTiming.js) needs no change at all.
// ---------------------------------------------------------------------------

// The records of a split collection by their own SplitIndex: an object keyed
// "0"/"1"/"2" on a car, an array in any order at the top level.
function byIndex(splits) {
  const out = [null, null, null];
  if (!splits) return out;
  const records = Array.isArray(splits) ? splits : Object.values(splits);
  records.forEach((sp, pos) => {
    if (!sp) return;
    const i = typeof sp.SplitIndex === "number" ? sp.SplitIndex : pos;
    if (i >= 0 && i < 3) out[i] = sp;
  });
  return out;
}

const timeOf = (sp) => (sp && Number.isFinite(sp.SplitTime) && sp.SplitTime > 0 ? sp.SplitTime : null);

function carsOf(status) {
  const cars = [];
  for (const group of [status?.ConnectedDrivers?.Drivers, status?.DisconnectedDrivers?.Drivers]) {
    for (const d of Object.values(group || {})) {
      for (const car of Object.values(d?.Cars || {})) if (car) cars.push(car);
    }
  }
  return cars;
}

// A best lap's two splits as the three sectors they stand for, or null when
// they are not this track's pair (three records, a sum that fits, no lap).
function bestLapSectors(car) {
  const lap = Number(car?.BestLap);
  if (!(lap > 0)) return null;
  const [r0, r1, r2] = byIndex(car.BestLapSplits);
  const a = timeOf(r0);
  const b = timeOf(r1);
  if (r2 || a == null || b == null) return null;
  if (b > a && b < lap && a + b > lap) return [a, b - a, lap - b];
  return null;
}

// Does the snapshot come from a track like this? One car's best lap says so.
export function hasCumulativeSplits(status) {
  return carsOf(status).some((car) => bestLapSectors(car) != null);
}

const record = (i, time, from = null) => ({
  SplitIndex: i,
  SplitTime: time,
  Cuts: from?.Cuts || 0,
  IsDriversBest: false,
  IsBest: false,
});
const keyed = (records) => Object.fromEntries(records.filter(Boolean).map((r) => [String(r.SplitIndex), r]));

// Is a second-record time the running total to the second line, or the last
// sector? Whichever of the two it sits closer to, by this car's best lap when
// it has one, else by the field's.
function isRunningTotal(x, ref) {
  if (!ref) return false;
  return Math.abs(x - ref.total) < Math.abs(x - ref.last);
}

// Rewrites the snapshot's split records in place so every car carries three
// sectors, the way any other track does. A snapshot from a track that reports
// three is left exactly as it came. Returns the snapshot.
export function repairCumulativeSplits(status) {
  const cars = carsOf(status);
  const read = cars.map((car) => ({ car, sectors: bestLapSectors(car) }));
  const known = read.filter((r) => r.sectors);
  if (!known.length) return status;

  // The field's typical running total and last sector, for a car that has no
  // best lap of its own to judge its current lap by.
  const median = (xs) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const fieldRef = {
    total: median(known.map((r) => r.sectors[0] + r.sectors[1])),
    last: median(known.map((r) => r.sectors[2])),
  };

  const sessionBest = [null, null, null];
  const bestsOf = [];
  for (const { car, sectors } of read) {
    const lapRec = byIndex(car.BestLapSplits);
    const ref = sectors ? { total: sectors[0] + sectors[1], last: sectors[2] } : fieldRef;

    // The best lap. A car whose second record already is the last sector (the
    // overwrite landed before the copy) gets its middle sector from the lap.
    if (sectors) {
      car.BestLapSplits = keyed(sectors.map((t, i) => record(i, t, lapRec[i === 2 ? 1 : i])));
    } else {
      const lap = Number(car.BestLap);
      const a = timeOf(lapRec[0]);
      const x = timeOf(lapRec[1]);
      if (!lapRec[2] && lap > 0 && a != null && x != null && !isRunningTotal(x, ref) && lap - a - x > 0) {
        car.BestLapSplits = keyed([record(0, a, lapRec[0]), record(1, lap - a - x), record(2, x, lapRec[1])]);
      }
    }
    const lapSectors = byIndex(car.BestLapSplits).map(timeOf);
    const lapHasThree = lapSectors.every((t) => t != null);

    // The best of each sector. The second record is the best S3 unless no lap
    // has reached the line since it was last a running total.
    const bestRec = byIndex(car.BestSplits);
    if (!bestRec[2]) {
      const s1 = timeOf(bestRec[0]);
      const x = timeOf(bestRec[1]);
      const s3Seen = x != null && !isRunningTotal(x, ref) ? x : null;
      const best = [
        s1 != null && lapHasThree ? Math.min(s1, lapSectors[0]) : s1 ?? lapSectors[0],
        lapSectors[1],
        s3Seen != null && lapHasThree ? Math.min(s3Seen, lapSectors[2]) : s3Seen ?? lapSectors[2],
      ];
      car.BestSplits = keyed(
        best.map((t, i) => (t == null ? null : { ...record(i, t, i === 2 ? bestRec[1] : bestRec[i]), IsDriversBest: true }))
      );
    }
    const best = byIndex(car.BestSplits).map(timeOf);
    bestsOf.push({ car, best });
    best.forEach((t, i) => {
      if (t != null && (sessionBest[i] == null || t < sessionBest[i])) sessionBest[i] = t;
    });
    // Green on the best lap is "their best of this sector", which only the
    // three sectors just worked out can answer.
    for (const [i, r] of byIndex(car.BestLapSplits).entries()) if (r) r.IsDriversBest = r.SplitTime === best[i];

    // The lap being driven. One record is the first sector, as anywhere. Two
    // are either the running total to the second line (mid-lap) or the first
    // and last sectors of a lap that just ended, whose middle the last lap time
    // gives back. Neither: nothing, so the page counts sector one afresh rather
    // than a middle sector that is already over.
    const cur = byIndex(car.CurrentLapSplits);
    if (!cur[2] && cur[1]) {
      const a = timeOf(cur[0]);
      const x = timeOf(cur[1]);
      const last = Number(car.LastLap);
      if (a != null && x != null && x > a && isRunningTotal(x, ref)) {
        car.CurrentLapSplits = keyed([record(0, a, cur[0]), record(1, x - a, cur[1])]);
      } else if (a != null && x != null && last > 0 && last - a - x > 0) {
        car.CurrentLapSplits = keyed([record(0, a, cur[0]), record(1, last - a - x), record(2, x, cur[1])]);
      } else {
        car.CurrentLapSplits = {};
      }
    }
  }

  // Purple: the session's best of each sector, at the top level where the
  // board looks for it, and on the records that hold it.
  for (const { best, car } of bestsOf) {
    for (const [i, r] of byIndex(car.BestSplits).entries()) if (r) r.IsBest = best[i] === sessionBest[i];
  }
  status.BestSplits = sessionBest.map((t, i) => (t == null ? null : { ...record(i, t), IsBest: true })).filter(Boolean);
  return status;
}
