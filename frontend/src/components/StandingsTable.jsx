import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
// `dropped` = this round is one of the driver's lowest and doesn't count
// toward the total (season drop rule) -> shown struck through and dimmed.
// `droppedPts` (constructor rows) = the share of the round's points scored in
// one of a driver's own dropped rounds; it doesn't count for the team.
function RaceCell({ cell, dropped, droppedPts = 0 }) {
  const base = "px-2.5 py-3 text-center font-mono";
  if (cell == null) return <td className={`${base} text-sm text-faint`}>·</td>;

  // A fully dropped round renders the same way whatever its content: struck +
  // dim. For a team that's the case when every point that round came from a
  // driver's dropped round.
  if (dropped || (typeof cell === "number" && cell > 0 && droppedPts >= cell)) {
    const label =
      typeof cell === "number"
        ? cell
        : cell.status && cell.status !== "FINISHED"
          ? cell.status
          : cell.points;
    return (
      <td
        title="Dropped: scored in the lowest rounds, not counted toward the total"
        className={`${base} text-sm text-faint line-through decoration-2`}
      >
        {label || 0}
      </td>
    );
  }

  // driver standings: cell = { points, status }; constructor: cell = number
  if (typeof cell === "number") {
    // Partially dropped team round: one driver's points were scored in one of
    // that driver's dropped rounds -> only the teammate's share counts. Show
    // the counting share big, the full round haul small + struck.
    if (droppedPts > 0 && droppedPts < cell) {
      return (
        <td
          title={`${cell} scored: ${droppedPts} fell in a driver's dropped rounds, ${cell - droppedPts} count`}
          className={`${base} whitespace-nowrap text-sm text-medium`}
        >
          {cell - droppedPts}
          <span className="ml-1 align-middle text-[10px] text-faint line-through decoration-2">{cell}</span>
        </td>
      );
    }
    return <td className={`${base} text-sm text-medium`}>{cell || <span className="text-faint">0</span>}</td>;
  }

  const { points, status } = cell;
  if (status && status !== "FINISHED") {
    const cls = status === "DNF" ? "text-amber-600" : status === "DSQ" ? "text-primary" : "text-light";
    return <td className={`${base} text-[11px] font-semibold ${cls}`}>{status}</td>;
  }
  return <td className={`${base} text-sm text-medium`}>{points || <span className="text-faint">0</span>}</td>;
}

export default function StandingsTable({ variant, raceNumbers, rows, dropWorst = 3, officialTotals = false, dropMode = "driver", teamDropWorst = null }) {
  const isDriver = variant === "driver";
  // Constructor tables can use a team-level drop rule instead of inheriting
  // each driver's dropped rounds — the footnote must match whichever is in
  // force: "team" counts single-driver round scores, "teamRounds" counts whole
  // team rounds (the official sheet's style).
  const teamDrop = !isDriver && (dropMode === "team" || dropMode === "teamRounds");
  const showDropNote = isDriver
    ? dropWorst > 0 && raceNumbers.length > 0
    : teamDrop
      ? teamDropWorst > 0 && raceNumbers.length > 0
      : dropWorst > 0 && raceNumbers.length > 0;
  const [scrollRef, edge] = useScrollEdges();
  // Archive seasons: totals are the league's official final sheet, while the
  // round columns are reconstructed from the era's result posts — the two can
  // legitimately differ (penalties, bonus points, gaps in the old data).
  const showOfficialNote = officialTotals && raceNumbers.length > 0;

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
          {/* cascade: rows rise in one after another, top to bottom, exactly
              like the driver standings list. --i drives the per-row stagger. */}
          <tbody className="cascade">
            {rows.map((row, i) => {
              const droppedSet = new Set(row.droppedRounds || []);
              return (
                <tr
                  key={row.driverId || row.teamId}
                  style={{ "--i": Math.min(i, 16) }}
                  className="group border-b border-border last:border-0 transition hover:bg-surface2"
                >
                  <td className="sticky left-0 z-10 px-3 py-3 text-center transition sticky-cell">
                    <Rank position={row.position} />
                  </td>

                  {isDriver ? (
                    <td className={`sticky left-14 z-10 px-3 py-3 transition sticky-cell ${leftShadow}`}>
                      <Link to={`/drivers/${row.driverId}`} className="group/name flex items-center gap-3">
                        <span
                          className="h-7 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: row.team.color }}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-display text-base font-bold uppercase tracking-tight text-dark transition group-hover/name:text-brand sm:text-lg">
                            {row.name}
                          </span>
                          {row.formerName && (
                            <span className="block font-mono text-[10px] uppercase tracking-wider text-faint">
                              raced as {row.formerName}
                            </span>
                          )}
                        </span>
                        {!row.isActive && (
                          <span className="pill bg-surface2 text-light">inactive</span>
                        )}
                      </Link>
                    </td>
                  ) : (
                    <td className={`sticky left-14 z-10 px-3 py-3 transition sticky-cell ${leftShadow}`}>
                      <Link to={`/teams/${row.teamId}`} className="group/name flex items-center gap-3">
                        <TeamLogo id={row.teamId} name={row.name} color={row.color} logoUrl={row.logoUrl} size={28} />
                        <span className="font-display text-base font-bold uppercase tracking-tight text-dark transition group-hover/name:text-brand sm:text-lg">
                          {row.name}
                        </span>
                      </Link>
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
                    <RaceCell
                      key={n}
                      cell={row.perRace[n] ?? null}
                      dropped={droppedSet.has(n)}
                      droppedPts={row.droppedPerRace?.[n] || 0}
                    />
                  ))}

                  <td className={`sticky right-0 z-10 border-l border-border px-4 py-3 text-right font-mono text-lg font-bold tabular-nums text-dark transition sticky-cell sm:text-xl ${rightShadow}`}>
                    {row.total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(showOfficialNote || showDropNote) && (
        <div className="space-y-1 border-t border-border px-4 py-2.5 font-mono text-[11px] leading-relaxed text-light">
          {showDropNote && (
            <p>
              {isDriver ? (
                <>
                  <span className="text-faint line-through decoration-2">Struck-through</span> rounds are dropped: each
                  driver&rsquo;s {dropWorst} lowest-scoring round{dropWorst === 1 ? " doesn't" : "s don't"} count toward the
                  total{raceNumbers.length > dropWorst && <> (best {raceNumbers.length - dropWorst} of {raceNumbers.length})</>}.
                </>
              ) : dropMode === "teamRounds" ? (
                <>
                  <span className="text-faint line-through decoration-2">Struck-through</span> rounds are dropped: each
                  team&rsquo;s {teamDropWorst} lowest round total{teamDropWorst === 1 ? " doesn't" : "s don't"} count toward the
                  team total; rounds not yet run count as 0 and are dropped first
                  {raceNumbers.length > teamDropWorst && <> (best {raceNumbers.length - teamDropWorst} of {raceNumbers.length})</>}.
                </>
              ) : teamDrop ? (
                <>
                  <span className="text-faint line-through decoration-2">Struck-through</span> points are dropped: each
                  team&rsquo;s {teamDropWorst} lowest single-driver round score{teamDropWorst === 1 ? " doesn't" : "s don't"} count
                  toward the team total, so a round can count partially (the teammate&rsquo;s share still scores).
                </>
              ) : (
                <>
                  <span className="text-faint line-through decoration-2">Struck-through</span> points are dropped: each
                  driver&rsquo;s {dropWorst} lowest-scoring round{dropWorst === 1 ? " doesn't" : "s don't"} count for the team
                  they drove for that round, so a round can count partially (the teammate&rsquo;s share still scores).
                </>
              )}
            </p>
          )}
          {showOfficialNote && (
            <p>
              <span className="font-bold uppercase text-medium">Pts = official final standings.</span> The round columns
              are reconstructed from the era&rsquo;s result posts. Penalties, bonus points and gaps in the old records
              mean they may not add up to the official totals exactly.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
