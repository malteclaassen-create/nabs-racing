import { TierBadge, Rank } from "./ui.jsx";

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
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              <th className="w-14 px-3 py-3 text-center">Pos</th>
              <th className="px-3 py-3">{isDriver ? "Driver" : "Team"}</th>
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
              return (
                <tr
                  key={row.driverId || row.teamId}
                  className={`border-b border-border last:border-0 transition hover:bg-surface2 ${
                    isLeader ? "bg-brand/5" : ""
                  }`}
                >
                  <td className="px-3 py-3 text-center">
                    <Rank position={row.position} />
                  </td>

                  {isDriver ? (
                    <td className="px-3 py-3">
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
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-7 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: row.color }}
                        />
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
                    <td className="hidden px-3 py-3 text-sm text-medium md:table-cell">{row.team.name}</td>
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
