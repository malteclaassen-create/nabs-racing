// ---------------------------------------------------------------------------
// The finishing spread of a career: every classification counted into one bar
// per position, with the retirements kept apart. Plain JS so the counting can
// be tested on its own; DriverCareer.jsx draws it.
// ---------------------------------------------------------------------------

// Under this many races the shape says nothing, so the page leaves the chart
// out entirely.
export const MIN_RACES = 10;
// Beyond this the tail is one bar: a 40-car grid would otherwise be forty
// slivers, most of them empty.
export const TAIL_FROM = 21;

export function finishSpread(races) {
  const started = (races || []).filter((r) => r.status !== "DNS");
  const finished = started.filter((r) => r.status === "FINISHED" && r.position != null);
  if (!started.length) return null;
  const worst = finished.length ? Math.max(...finished.map((r) => r.position)) : 0;
  const last = Math.min(worst, TAIL_FROM - 1);
  const bars = [];
  for (let p = 1; p <= last; p += 1) {
    bars.push({ key: `p${p}`, label: String(p), position: p, count: finished.filter((r) => r.position === p).length });
  }
  const tail = finished.filter((r) => r.position >= TAIL_FROM).length;
  if (worst >= TAIL_FROM) bars.push({ key: "tail", label: `${TAIL_FROM}+`, position: TAIL_FROM, count: tail });
  const out = [];
  for (const [key, label] of [["DNF", "DNF"], ["DSQ", "DSQ"]]) {
    const count = started.filter((r) => r.status === key).length;
    if (count) out.push({ key, label, count, bad: true });
  }
  const positions = finished.map((r) => r.position).sort((a, b) => a - b);
  // "most often" means one position, never the bundled tail.
  const most = bars
    .filter((b) => b.key !== "tail")
    .reduce((m, b) => (b.count > (m?.count ?? 0) ? b : m), null);
  return {
    bars,
    out,
    starts: started.length,
    finishes: finished.length,
    avg: positions.length ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 : null,
    median: positions.length ? positions[Math.floor(positions.length / 2)] : null,
    most: most && most.count > 0 ? most : null,
  };
}

