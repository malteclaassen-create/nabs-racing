// The grid-to-flag track of the recap's finishing card, shared with the
// season review's best round.
// The whole grid as a track, back of the field on the left and P1 on the
// right, and the car sliding from where it started to where it finished,
// leaving its team colour behind it.
export default function GridToFlag({ grid, finish, field }) {
  const at = (p) => ((field - p) / Math.max(1, field - 1)) * 100;
  const from = at(grid);
  const to = at(finish);
  const w = Math.abs(to - from);
  const step = field > 30 ? 10 : field > 12 ? 5 : 1;
  const ticks = [];
  for (let p = field; p >= 1; p -= 1) if (p === 1 || p === field || p % step === 0) ticks.push(p);
  return (
    <div className="relative h-14 w-full">
      <div className="absolute inset-x-0 top-5 h-px bg-border" />
      {ticks.map((p) => (
        <div key={p} className="absolute top-5 -translate-x-1/2" style={{ left: `${at(p)}%` }}>
          <div className="mx-auto h-2 w-px bg-border" />
          <div className="mt-1 font-mono text-[10px] font-bold tabular-nums text-faint">P{p}</div>
        </div>
      ))}
      {/* The trail is pinned to the GRID slot and grows towards the finish:
          from the left when places were gained, from the right when they
          were lost, so it follows the car instead of filling in backwards. */}
      <div
        className={`rr-sweep-trail absolute top-[19px] h-[3px] ${to >= from ? "" : "rr-from-right"}`}
        style={{
          ...(to >= from ? { left: `${from}%` } : { right: `${100 - from}%` }),
          width: `${w}%`,
          background: "var(--recap-team)",
          opacity: 0.6,
        }}
      />
      <div className="absolute top-5 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-light bg-card" style={{ left: `${from}%` }} title={`Grid P${grid}`} />
      <div className="rr-sweep-layer pointer-events-none absolute inset-x-0 top-5" style={{ "--from": `${from}%`, "--to": `${to}%` }}>
        <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
          <div className="h-4 w-4 rounded-full ring-4 ring-card" style={{ background: "var(--recap-team)" }} />
        </div>
      </div>
    </div>
  );
}

