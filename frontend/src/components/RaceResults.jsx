import { Link } from "react-router-dom";
import { StatusPill, Rank, TierBadge, MEDAL } from "./ui.jsx";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
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

// A plausible lap time (AC stores a huge sentinel for "no lap set").
const MAX_LAP_MS = 1_800_000; // 30 min
const isLap = (ms) => ms > 0 && ms <= MAX_LAP_MS;

// milliseconds -> "1:20.027"
function fmtLap(ms) {
  if (!isLap(ms)) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function PodiumCard({ row, rank }) {
  return (
    <div className="shine relative flex items-center gap-3 overflow-hidden rounded-xl border border-border bg-card p-3" style={{ "--i": rank }}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: row.team.color }} />
      <span
        className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-base font-black text-ink"
        style={{ backgroundColor: MEDAL[rank] }}
      >
        {rank + 1}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Link
            to={`/drivers/${row.driverId}`}
            className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark transition hover:text-brand"
          >
            {row.name}
          </Link>
          <Flag code={countryFor(row.driverId, row.country)} w={16} h={12} />
        </div>
        <div className="truncate text-xs text-light">
          {(row.effectiveTeam || row.team).name}
        </div>
      </div>
      <div className="ml-auto pr-1 text-right">
        <div className="font-mono text-lg font-bold leading-none tabular-nums text-dark">{row.points}</div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-light">pts</div>
      </div>
    </div>
  );
}

export default function RaceResults({ race, results }) {
  const detailed = race.hasPositions;

  const lapRows = results.filter((r) => isLap(r.bestLapMs));
  const hasLaps = lapRows.length > 0;
  const hasGrid = results.some((r) => r.grid != null);
  const fastestMs = hasLaps ? Math.min(...lapRows.map((r) => r.bestLapMs)) : null;
  const fastestDriverId = hasLaps ? lapRows.find((r) => r.bestLapMs === fastestMs)?.driverId : null;
  const fastest = fastestDriverId ? results.find((r) => r.driverId === fastestDriverId) : null;

  const podium = detailed
    ? results.filter((r) => r.position != null && (!r.status || r.status === "FINISHED")).slice(0, 3)
    : [];
  const finishers = results.filter((r) => (!r.status || r.status === "FINISHED") && r.position != null).length;

  return (
    <div className="card overflow-hidden">
      {/* Summary: podium + fastest lap */}
      {detailed && podium.length > 0 && (
        <div className="cascade grid gap-3 border-b border-border bg-surface2/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {podium.map((row, i) => (
            <PodiumCard key={row.driverId} row={row} rank={i} />
          ))}
          {fastest && (
            <div className="shine relative flex items-center gap-3 overflow-hidden rounded-xl border border-purple-500/40 bg-purple-500/[0.07] p-3" style={{ "--i": 3 }}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/20 text-purple-500">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="13" r="8" />
                  <path d="M12 13V9M9 2h6M19.5 5.5l-1.5 1.5" />
                </svg>
              </span>
              <div className="min-w-0">
                <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-purple-500">
                  Fastest Lap
                </div>
                <div className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark">
                  {fastest.name}
                </div>
              </div>
              <div className="ml-auto pr-1 font-mono text-base font-bold tabular-nums text-purple-500">
                {fmtLap(fastestMs)}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface2/50 text-left font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              {detailed && <th className="w-14 px-3 py-3 text-center">Pos</th>}
              {detailed && hasGrid && <th className="hidden px-3 py-3 text-center md:table-cell">Grid</th>}
              <th className="px-3 py-3">Driver</th>
              <th className="hidden px-3 py-3 sm:table-cell">Team</th>
              {detailed && hasLaps && <th className="hidden px-3 py-3 text-right md:table-cell">Best Lap</th>}
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
          {/* cascade: rows rise in one after another, like the standings tables */}
          <tbody className="cascade">
            {results.map((r, i) => {
              const tier = r.tier ?? r.team?.tier;
              const isFastest = r.driverId === fastestDriverId;
              const gridDelta = r.grid != null && r.position != null ? r.grid - r.position : null;
              return (
                <tr
                  key={r.driverId}
                  style={{ "--i": Math.min(i, 16) }}
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

                  {detailed && hasGrid && (
                    <td className="hidden px-3 py-3.5 text-center md:table-cell">
                      {r.grid != null ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-mono text-sm tabular-nums text-medium">{r.grid}</span>
                          {gridDelta != null && gridDelta !== 0 && (
                            <span
                              className={`font-mono text-[10px] font-bold ${
                                gridDelta > 0 ? "text-emerald-600" : "text-red-500"
                              }`}
                            >
                              {gridDelta > 0 ? `▲${gridDelta}` : `▼${-gridDelta}`}
                            </span>
                          )}
                        </span>
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
                      <Link
                        to={`/drivers/${r.driverId}`}
                        className="font-display text-base font-bold uppercase tracking-tight text-dark transition hover:text-brand"
                      >
                        {r.name}
                      </Link>
                      <Flag code={countryFor(r.driverId, r.country)} />
                      {tier != null && <TierBadge tier={tier} />}
                      {isFastest && (
                        <span className="pill bg-purple-500/15 text-purple-500" title="Fastest lap of the race">
                          FL
                        </span>
                      )}
                      {r.isSub && r.subForTeam && (
                        <span className="pill bg-amber-100 text-amber-700">sub · {r.subForTeam.name}</span>
                      )}
                      {r.penaltySeconds > 0 && (
                        <span className="pill bg-red-500/15 text-red-500" title="Time penalty applied">
                          +{r.penaltySeconds}s pen
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="hidden px-3 py-3.5 sm:table-cell">
                    {(() => {
                      const t = r.effectiveTeam || r.team;
                      return (
                        <Link to={`/teams/${t.id}`} className="inline-flex transition hover:opacity-80">
                          <TeamLogo
                            id={t.id}
                            name={t.name}
                            color={t.color}
                            logoUrl={t.logoUrl}
                            size={20}
                            showName
                            nameClassName="truncate text-sm text-medium"
                          />
                        </Link>
                      );
                    })()}
                  </td>

                  {detailed && hasLaps && (
                    <td
                      className={`hidden px-3 py-3.5 text-right font-mono text-sm tabular-nums md:table-cell ${
                        isFastest ? "font-bold text-purple-500" : "text-medium"
                      }`}
                    >
                      {fmtLap(r.bestLapMs) || <span className="text-faint">—</span>}
                    </td>
                  )}

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
          {hasLaps && (
            <span className="flex items-center gap-1.5">
              <span className="pill bg-purple-500/15 text-purple-500">FL</span> Fastest lap
            </span>
          )}
          <span>
            <span className="font-semibold text-medium">Tier 2 column</span> = re-ranked position once Tier-1
            drivers are removed → constructor points.
          </span>
        </div>
      )}
    </div>
  );
}
