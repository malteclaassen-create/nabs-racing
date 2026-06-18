import { StatusPill, Rank, TierBadge } from "./ui.jsx";
import Flag from "./Flag.jsx";
import { countryFor } from "../data/driverCountries.js";

// Small "?" help marker with a hover tooltip (native title).
function Help({ text }) {
  return (
    <span
      title={text}
      className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-light/50 text-[9px] font-bold text-light"
    >
      ?
    </span>
  );
}

export default function RaceResults({ race, results }) {
  const detailed = race.hasPositions;

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface2/50 text-left font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              {detailed && <th className="w-14 px-3 py-3 text-center">Pos</th>}
              <th className="px-3 py-3">Driver</th>
              <th className="hidden px-3 py-3 sm:table-cell">Team</th>
              {detailed && <th className="px-3 py-3 text-center">Status</th>}
              {detailed && (
                <th className="hidden px-3 py-3 text-center lg:table-cell">
                  <span className="inline-flex items-center">
                    Tier 2
                    <Help text="Tier-2 constructor scoring: Tier-1 drivers are removed, the rest of the field is re-ranked, and points are awarded by that new position. Shows the driver's Tier-2 position and the points it gave their constructor. Tier-1 drivers don't score here." />
                  </span>
                </th>
              )}
              <th className="px-4 py-3 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const tier = r.tier ?? r.team?.tier;
              return (
                <tr
                  key={r.driverId}
                  className="border-b border-border transition odd:bg-surface2/30 last:border-0 hover:bg-surface2"
                >
                  {detailed && (
                    <td className="px-3 py-3.5 text-center">
                      {r.position != null ? (
                        <Rank position={r.position} />
                      ) : (
                        <span className="font-mono text-faint">—</span>
                      )}
                    </td>
                  )}

                  <td className="px-3 py-3.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className="h-7 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: r.team.color }}
                      />
                      <span className="font-display text-base font-bold uppercase tracking-tight text-dark">
                        {r.name}
                      </span>
                      <Flag code={countryFor(r.driverId)} />
                      {tier != null && <TierBadge tier={tier} />}
                      {r.isSub && r.subForTeam && (
                        <span className="pill bg-amber-100 text-amber-700">sub · {r.subForTeam.name}</span>
                      )}
                    </div>
                  </td>

                  <td className="hidden px-3 py-3.5 text-sm text-medium sm:table-cell">
                    {r.effectiveTeam ? r.effectiveTeam.name : r.team.name}
                  </td>

                  {detailed && (
                    <td className="px-3 py-3.5 text-center">
                      {!r.status || r.status === "FINISHED" ? (
                        <span className="font-mono text-faint">—</span>
                      ) : (
                        <StatusPill status={r.status} />
                      )}
                    </td>
                  )}

                  {detailed && (
                    <td className="hidden px-3 py-3.5 text-center lg:table-cell">
                      {r.t2 ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="pill bg-primary/10 text-primary">P{r.t2.rank}</span>
                          {r.t2.scoresForTeam ? (
                            <span className="font-mono text-sm font-bold tabular-nums text-dark">
                              +{r.t2.points}
                            </span>
                          ) : (
                            <span
                              className="font-mono text-[11px] uppercase text-light"
                              title="Occupies a slot in the Tier-2 ranking but scores for no constructor (reserve without a Tier-2 team)."
                            >
                              slot only
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="font-mono text-faint">—</span>
                      )}
                    </td>
                  )}

                  <td className="px-4 py-3.5 text-right">
                    <span className="font-mono text-lg font-bold tabular-nums text-dark">{r.points}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detailed && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border bg-surface2/60 px-4 py-3 text-[11px] text-light">
          <span className="font-bold uppercase tracking-wider text-medium">Legend</span>
          <span className="flex items-center gap-1.5">
            <TierBadge tier={1} /> Tier&nbsp;1
          </span>
          <span className="flex items-center gap-1.5">
            <TierBadge tier={2} /> Tier&nbsp;2
          </span>
          <span className="flex items-center gap-1.5">
            <TierBadge tier={0} /> Reserve
          </span>
          <span>
            <span className="font-semibold text-medium">Tier 2 column</span> = re-ranked position once Tier-1
            drivers are removed → constructor points.
          </span>
        </div>
      )}
    </div>
  );
}
