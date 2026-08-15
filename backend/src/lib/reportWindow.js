// ---------------------------------------------------------------------------
// How much of the report history a page serves before it starts asking.
//
// The cost of a report list is not the reports, it is the ROUNDS behind them.
// Every round carrying an in-game report has its result file read and parsed to
// work out where in the session each press happened (lib/reportAnchor.js), and
// an Assetto Corsa result file for a full grid is a few megabytes. One round is
// nothing. A season of them, on a page a steward opens after every race, is a
// multi-second read of files the caches underneath cannot all hold.
//
// So the list is a window on the newest rounds, and the rest is a button. The
// window is by ROUND rather than by a count of reports on purpose: it is the
// round that carries the cost, and cutting at "the last fifty reports" would
// open the same twelve files while looking like it had saved something.
// ---------------------------------------------------------------------------

// The evening just raced, and the two arguments still open behind it.
export const RECENT_ROUNDS = 3;

// The newest rounds by race date. A round with no date sorts LAST rather than
// winning by accident: an undated row is a fixture somebody has not filled in
// yet, and it must not push a real race night out of the window.
export function recentRoundIds(races, howMany = RECENT_ROUNDS) {
  if (!Array.isArray(races) || howMany <= 0) return new Set();
  const at = (r) => {
    const t = r?.date ? new Date(r.date).getTime() : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  return new Set(
    [...races]
      .sort((a, b) => at(b) - at(a))
      .slice(0, howMany)
      .map((r) => r.id)
  );
}

// The reports a windowed list serves: everything in the newest rounds, plus
// everything with no round on it at all.
//
// A report with no round cannot be windowed — there is nothing to sort it
// against — and dropping it would hide it until somebody pressed a button
// about "earlier rounds", which is not where it is. It is also the one a
// steward is most likely to be hunting for, because a report that never got a
// round attached is usually the one that went wrong.
export function withinRounds(reports, roundIds) {
  return reports.filter((r) => !r.raceId || roundIds.has(r.raceId));
}
