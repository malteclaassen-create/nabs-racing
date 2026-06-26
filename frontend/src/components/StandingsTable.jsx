import { useEffect, useRef, useState } from "react";
import { TierBadge, Rank } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";

// Tracks how far a horizontal scroller is scrolled, so the frozen Pos/Team and
// Pts columns can cast a shadow only when content is actually tucked beneath
// them (and not on wide screens where the whole table fits).
function useScrollEdges() {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setEdge({
        start: el.scrollLeft > 2,
        end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return [ref, edge];
}

// Per-race points cell with status colouring.
// `dropped` = this round is one of the competitor's 3 lowest and doesn't count
// toward the total -> shown struck through and dimmed.
function RaceCell({ cell, dropped }) {
  const base = "px-2.5 py-3 text-center font-mono";
  if (cell == null) return <td className={`${base} text-sm text-faint`}>·</td>;

  // A dropped round renders the same way whatever its content: struck + dim.
  if (dropped) {
    const label =
      typeof cell === "number"
        ? cell
        : cell.status && cell.status !== "FINISHED"
          ? cell.status
          : cell.points;
    return (
      <td
        title="Dropped — one of the 3 lowest rounds, not counted toward the total"
        className={`${base} text-sm text-faint line-through decoration-2`}
      >
        {label || 0}
      </td>
    );
  }

  // driver standings: cell = { points, status }; constructor: cell = number
  if (typeof cell === "number") {
    return <td className={`${base} text-sm text-medium`}>{cell || <span className="text-faint">0</span>}</td>;
  }

  const { points, status } = cell;
  if (status && status !== "FINISHED") {
    const cls = status === "DNF" ? "text-amber-600" : status === "DSQ" ? "text-primary" : "text-light";
    return <td className={`${base} text-[11px] font-semibold ${cls}`}>{status}</td>;
  }
  return <td className={`${base} text-sm text-medium`}>{points || <span className="text-faint">0</span>}</td>;
}

export default function StandingsTable({ variant, raceNumbers, rows }) {
  const isDriver = variant === "driver";
  const [scrollRef, edge] = useScrollEdges();

  // Shadows on the frozen columns, only while there's hidden content to that
  // side — doubles as the "there's more to scroll" hint for the round matrix.
  const leftShadow = edge.start ? "shadow-[10px_0_12px_-10px_rgba(0,0,0,0.45)]" : "";
  const rightShadow = edge.end ? "shadow-[-10px_0_12px_-10px_rgba(0,0,0,0.45)]" : "";

  return (
    <div className="card overflow-hidden">
      <div ref={scrollRef} className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              <th className="sticky left-0 z-20 w-14 bg-card px-3 py-3 text-center">Pos</th>
              <th className={`sticky left-14 z-20 bg-card px-3 py-3 transition-shadow ${leftShadow}`}>
                {isDriver ? "Driver" : "Team"}
              </th>
              {isDriver && <th className="hidden px-3 py-3 lg:table-cell">Discord</th>}
              {isDriver && <th className="hidden px-3 py-3 md:table-cell">Team</th>}
              {isDriver && <th className="px-3 py-3 text-center">Tier</th>}
              {raceNumbers.map((n) => (
                <th key={n} className="px-2.5 py-3 text-center tabular-nums">
                  R{n}
                </th>
              ))}
              <th className={`sticky right-0 z-20 border-l border-border bg-card px-4 py-3 text-right transition-shadow ${rightShadow}`}>
                Pts
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const droppedSet = new Set(row.droppedRounds || []);
              return (
                <tr
                  key={row.driverId || row.teamId}
                  className="group border-b border-border last:border-0 transition hover:bg-surface2"
                >
                  <td className="sticky left-0 z-10 px-3 py-3 text-center transition sticky-cell">
                    <Rank position={row.position} />
                  </td>

                  {isDriver ? (
                    <td className={`sticky left-14 z-10 px-3 py-3 transition sticky-cell ${leftShadow}`}>
                      <div className="flex items-center gap-3">
                        <span
                          className="h-7 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: row.team.color }}
                        />
                        <span className="font-display text-base font-bold uppercase tracking-tight text-dark">
                          {row.name}
                        </span>
                        {!row.isActive && (
                          <span className="pill bg-surface2 text-light">inactive</span>
                        )}
                      </div>
                    </td>
                  ) : (
                    <td className={`sticky left-14 z-10 px-3 py-3 transition sticky-cell ${leftShadow}`}>
                      <div className="flex items-center gap-3">
                        <TeamLogo id={row.teamId} name={row.name} color={row.color} logoUrl={row.logoUrl} size={28} />
                        <span className="font-display text-base font-bold uppercase tracking-tight text-dark">
                          {row.name}
                        </span>
                      </div>
                    </td>
                  )}

                  {isDriver && (
                    <td className="hidden px-3 py-3 text-sm text-light lg:table-cell">{row.discordName}</td>
                  )}
                  {isDriver && (
                    <td className="hidden px-3 py-3 md:table-cell">
                      <TeamLogo
                        id={row.team.id}
                        name={row.team.name}
                        color={row.team.color}
                        logoUrl={row.team.logoUrl}
                        size={20}
                        showName
                        nameClassName="truncate text-sm text-medium"
                      />
                    </td>
                  )}
                  {isDriver && (
                    <td className="px-3 py-3 text-center">
                      <TierBadge tier={row.tier} />
                    </td>
                  )}

                  {raceNumbers.map((n) => (
                    <RaceCell key={n} cell={row.perRace[n] ?? null} dropped={droppedSet.has(n)} />
                  ))}

                  <td className={`sticky right-0 z-10 border-l border-border px-4 py-3 text-right font-mono text-base font-bold tabular-nums text-dark transition sticky-cell ${rightShadow}`}>
                    {row.total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2.5 font-mono text-[11px] leading-relaxed text-light">
        <span className="text-faint line-through decoration-2">Struck-through</span> rounds are dropped — each{" "}
        {isDriver ? "driver" : "team"}&rsquo;s 3 lowest-scoring rounds don&rsquo;t count toward the total (best 9 of 12).
      </p>
    </div>
  );
}
