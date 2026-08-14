// ---------------------------------------------------------------------------
// The clock the in-game reporting app sends, and whether it is worth repeating.
//
// webPenalty posts a bare wall clock — "18:36:03", no date, no zone — as part
// of its thread title. The report's real timestamp is stamped on arrival
// instead (routes/reports.js POST /ingest explains why at length), and the raw
// string used to be appended to the body so any drift stayed visible.
//
// In practice that printed TWO times that disagreed on every single in-game
// report: the chip at the top of the report said 20:36:05 and the body said
// 18:36:03, because the machine relaying the press runs on UTC and the league
// reads its site from Berlin. Both were the same moment. Neither said so, and a
// steward reading the report had no way to tell which one to scrub to.
//
// So the raw clock is only worth a line when it says something the arrival time
// does not: that the app and the site genuinely disagree about the MOMENT. A
// whole timezone between them is not disagreement — it is two clocks that are
// both right — so the offset is divided out first and only the remainder counts.
// ---------------------------------------------------------------------------

// Seconds the app's clock is out by, once whole timezone offsets are taken off.
// Null when it agrees, when it cannot be read, or when there is nothing to
// compare it against.
//
// Two different granularities, on purpose.
//
// Whether the clocks AGREE is asked at quarter-hour steps, because that is what
// real timezone offsets come in — Berlin +2, India +5:30, Nepal +5:45 — with a
// two-minute tolerance on top: press to lobby relay to HTTP request is a matter
// of seconds, so anything inside that window is one moment seen twice.
//
// How far out a clock that does NOT agree is, though, is measured against whole
// hours. Measuring that at quarter-hour steps flips the sign on any ordinary
// drift: a PC eight minutes fast is nearer the next quarter than its own, and
// came out as seven minutes SLOW. The cost is that a clock out by almost
// exactly fifteen, thirty or forty-five minutes reads as a timezone and passes
// silently — which beats printing a confident wrong direction, and is a clock
// so far out that the wall time on the report was never the evidence anyway.
export function clockDrift(rawTime, arrivedAt) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(rawTime || "").trim());
  if (!m) return null;
  const at = arrivedAt instanceof Date ? arrivedAt : new Date(arrivedAt);
  if (Number.isNaN(at.getTime())) return null;
  const said = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  if (said >= 24 * 3600) return null;
  const here = at.getUTCHours() * 3600 + at.getUTCMinutes() * 60 + at.getUTCSeconds();
  // Wrapped into ±12h so a session running over midnight in one of the two
  // clocks reads as a few seconds of drift rather than 23 hours of it.
  const diff = ((((said - here) % 86400) + 86400 + 43200) % 86400) - 43200;
  const offQuarter = diff - Math.round(diff / 900) * 900;
  if (Math.abs(offQuarter) <= 120) return null; // a timezone apart, nothing more
  return diff - Math.round(diff / 3600) * 3600;
}

// The line to add under an in-game report about the app's clock, or null on the
// normal evening where the two agree and there is nothing to say.
export function clockNote(rawTime, arrivedAt) {
  const drift = clockDrift(rawTime, arrivedAt);
  if (drift == null) return null;
  const off = Math.abs(drift);
  const how = off < 3600 ? `${Math.round(off / 60)} minutes` : `${(off / 3600).toFixed(1)} hours`;
  return (
    `(The in-game app's clock read ${rawTime} when this was sent, which is ${how} ` +
    `${drift > 0 ? "ahead of" : "behind"} when it reached the site. The time on the report is when it arrived.)`
  );
}
