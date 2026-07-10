import { useState } from "react";
import { Link } from "react-router-dom";

// "How the race unfolded": a slope chart connecting each driver's grid slot
// (left) to their finishing position (right) in their team colour. Hovering or
// tapping a name/line isolates that driver; everything else fades back. Only
// classified finishers are drawn; retirements are listed underneath, because a
// DNF holds no slot in this league's classification.
const ROW_H = 30;

function DeltaChip({ delta }) {
  if (!delta) return <span className="w-8 shrink-0 text-right font-mono text-[10px] text-faint">·</span>;
  const up = delta > 0;
  return (
    <span
      className={`w-8 shrink-0 text-right font-mono text-[10px] font-bold ${up ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}
    >
      {up ? `▲${delta}` : `▼${-delta}`}
    </span>
  );
}

export default function RaceFlow({ race, results }) {
  const [active, setActive] = useState(null);

  const classified = results.filter((r) => r.grid != null && r.position != null);
  if (!race.hasPositions || classified.length < 4) return null;

  const byGrid = [...classified].sort((a, b) => a.grid - b.grid);
  const byFinish = [...classified].sort((a, b) => a.position - b.position);
  const n = classified.length;
  const height = n * ROW_H;
  const y = (idx) => idx * ROW_H + ROW_H / 2;
  const finishIdx = new Map(byFinish.map((r, i) => [r.driverId, i]));
  const retired = results.filter((r) => r.grid != null && r.position == null);
  const biggest = classified.reduce((best, r) => {
    const d = r.grid - r.position;
    return best == null || d > best.grid - best.position ? r : best;
  }, null);
  const biggestDelta = biggest ? biggest.grid - biggest.position : 0;

  const dimmed = (id) => active && active !== id;

  const row = (r, side) => {
    const delta = r.grid - r.position;
    return (
      <Link
        key={r.driverId}
        to={`/drivers/${r.driverId}`}
        onMouseEnter={() => setActive(r.driverId)}
        onMouseLeave={() => setActive(null)}
        className={`flex items-center gap-1.5 px-1 transition-opacity ${dimmed(r.driverId) ? "opacity-30" : ""}`}
        style={{ height: ROW_H }}
      >
        {side === "left" ? (
          <>
            <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-light">{r.grid}</span>
            <span className="min-w-0 truncate font-display text-[13px] font-bold uppercase tracking-tight text-dark">
              {r.name}
            </span>
          </>
        ) : (
          <>
            <span className="w-6 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums text-dark">{r.position}</span>
            <span className="min-w-0 flex-1 truncate font-display text-[13px] font-bold uppercase tracking-tight text-dark">
              {r.name}
            </span>
            <DeltaChip delta={delta} />
          </>
        )}
      </Link>
    );
  };

  return (
    <div className="card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Race flow</div>
          <h3 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight text-dark">
            Grid to flag
          </h3>
        </div>
        {biggest && biggestDelta > 0 && (
          <Link
            to={`/drivers/${biggest.driverId}`}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface2 px-3 py-1.5 text-sm transition hover:border-brand/40"
            onMouseEnter={() => setActive(biggest.driverId)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">Drive of the chart</span>
            <span className="font-display text-[13px] font-bold uppercase text-dark">{biggest.name}</span>
            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">▲{biggestDelta}</span>
          </Link>
        )}
      </div>

      <div className="flex items-stretch">
        {/* grid order; the finish side matters more, so on phones this column
            gives up width to it */}
        <div className="w-24 shrink-0 sm:w-44">
          <div className="mb-1 px-1 font-mono text-[10px] font-bold uppercase tracking-wider text-light">Grid</div>
          {byGrid.map((r) => row(r, "left"))}
        </div>

        {/* the slopes; key on race id so the draw-in replays per race */}
        <div className="min-w-0 flex-1 pt-[18px]">
          <svg
            key={race.id}
            viewBox={`0 0 100 ${height}`}
            preserveAspectRatio="none"
            className="block w-full"
            style={{ height }}
            aria-hidden="true"
          >
            {byGrid.map((r, i) => {
              const y1 = y(i);
              const y2 = y(finishIdx.get(r.driverId));
              const isActive = active === r.driverId;
              return (
                <path
                  key={r.driverId}
                  d={`M0,${y1} C38,${y1} 62,${y2} 100,${y2}`}
                  fill="none"
                  stroke={r.team?.color || "#64748b"}
                  strokeWidth={isActive ? 3.5 : 2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  pathLength="1"
                  className="raceflow-line"
                  style={{ "--i": i, opacity: dimmed(r.driverId) ? 0.15 : isActive ? 1 : 0.75 }}
                  onMouseEnter={() => setActive(r.driverId)}
                  onMouseLeave={() => setActive(null)}
                />
              );
            })}
          </svg>
        </div>

        {/* finishing order */}
        <div className="w-36 shrink-0 sm:w-52">
          <div className="mb-1 px-1 text-right font-mono text-[10px] font-bold uppercase tracking-wider text-light sm:text-left">
            Finish
          </div>
          {byFinish.map((r) => row(r, "right"))}
        </div>
      </div>

      {retired.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-sm text-light">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider">Not classified</span>
          {retired.map((r) => (
            <Link key={r.driverId} to={`/drivers/${r.driverId}`} className="flex items-center gap-1.5 transition hover:text-dark">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.team?.color || "#64748b" }} />
              {r.name}
              <span className="font-mono text-[10px] uppercase text-faint">{r.status || "DNF"}</span>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-light">
        Every line is one driver, from starting slot (left) to finishing position (right). Hover or tap a name to
        follow a single car through the field.
      </p>
    </div>
  );
}
