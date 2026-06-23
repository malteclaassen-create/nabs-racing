import { TierBadge, Rank } from "./ui.jsx";
import TeamLogo from "./TeamLogo.jsx";

// Per-race points cell with status colouring.
function RaceCell({ cell }) {
  if (cell == null) return <td className="px-2.5 py-3 text-center font-mono text-sm text-faint">·</td>;

  // driver standings: cell = { points, status }; constructor: cell = number
  if (typeof cell === "number") {
    return (
      <td className="px-2.5 py-3 text-center font-mono text-sm text-medium">
        {cell || <span className="text-faint">0</span>}
      </td>
    );
  }

  const { points, status } = cell;
  if (status && status !== "FINISHED") {
    const cls = status === "DNF" ? "text-amber-600" : status === "DSQ" ? "text-primary" : "text-light";
    return <td className={`px-2.5 py-3 text-center font-mono text-[11px] font-semibold ${cls}`}>{status}</td>;
  }
  return (
    <td className="px-2.5 py-3 text-center font-mono text-sm text-medium">
      {points || <span className="text-faint">0</span>}
    </td>
  );
}

export default function StandingsTable({ variant, raceNumbers, rows }) {
  const isDriver = variant === "driver";

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              <th className="sticky left-0 z-20 w-14 bg-card px-3 py-3 text-center">Pos</th>
              <th className="sticky left-14 z-20 bg-card px-3 py-3">{isDriver ? "Driver" : "Team"}</th>
              {isDriver && <th className="hidden px-3 py-3 lg:table-cell">Discord</th>}
              {isDriver && <th className="hidden px-3 py-3 md:table-cell">Team</th>}
              {isDriver && <th className="px-3 py-3 text-center">Tier</th>}
              {raceNumbers.map((n) => (
                <th key={n} className="px-2.5 py-3 text-center tabular-nums">
                  R{n}
                </th>
              ))}
              <th className="px-4 py-3 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isLeader = row.position === 1;
              const stickyBg = isLeader ? "bg-brand/5" : "bg-card";
              return (
                <tr
                  key={row.driverId || row.teamId}
                  className={`group border-b border-border last:border-0 transition hover:bg-surface2 ${
                    isLeader ? "bg-brand/5" : ""
                  }`}
                >
                  <td className={`sticky left-0 z-10 px-3 py-3 text-center ${stickyBg} group-hover:bg-surface2`}>
                    <Rank position={row.position} />
                  </td>

                  {isDriver ? (
                    <td className={`sticky left-14 z-10 px-3 py-3 ${stickyBg} group-hover:bg-surface2`}>
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
                    <td className={`sticky left-14 z-10 px-3 py-3 ${stickyBg} group-hover:bg-surface2`}>
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
                    <RaceCell key={n} cell={row.perRace[n] ?? null} />
                  ))}

                  <td className="px-4 py-3 text-right font-mono text-base font-bold tabular-nums text-dark">
                    {row.total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
