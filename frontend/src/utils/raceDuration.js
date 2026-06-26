// Race durations and gaps (in milliseconds) -> human strings.
// Distinct from raceTime.js, which formats the *clock* kickoff time. These
// format elapsed race time (a car's TotalTime) and the gap behind another car,
// so the admin can see how close cars finished and what a time penalty does.

function parts(ms) {
  const totalMs = Math.round(ms);
  const msPart = totalMs % 1000;
  let s = Math.floor(totalMs / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return { h, m, s, msPart };
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

// Absolute race time, e.g. "20:34.567" or "1:02:03.456".
export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "";
  const { h, m, s, msPart } = parts(ms);
  const tail = `${pad(s)}.${pad(msPart, 3)}`;
  return h > 0 ? `${h}:${pad(m)}:${tail}` : `${m}:${tail}`;
}

// Gap behind another car, e.g. "+5.231" or "+1:05.231". "" for 0 / none.
export function fmtGap(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "";
  const { m, s, msPart } = parts(ms);
  const tail = `${pad(s)}.${pad(msPart, 3)}`;
  return m > 0 ? `+${m}:${tail}` : `+${s}.${pad(msPart, 3)}`;
}

// A results row's time cell: the leader's absolute time, a "+gap" behind the
// leader, or "–" when there's no usable time (legacy round / non-finisher).
// `leaderMs` is the fastest total time among the round's finishers.
export function fmtTimeCell(row, leaderMs) {
  if (!row || row.status !== "FINISHED" || !(row.totalTimeMs > 0)) return "–";
  if (leaderMs == null || row.totalTimeMs === leaderMs) return fmtDuration(row.totalTimeMs);
  return fmtGap(row.totalTimeMs - leaderMs);
}
