import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { StatusPill, Rank, TierBadge } from "./ui.jsx";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { TyreBadge } from "./TyreStrategy.jsx";
import { tyreCompound } from "../data/liveTiming.js";
import { countryFor } from "../data/driverCountries.js";
import { fmtDuration, fmtGap } from "../utils/raceDuration.js";

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

// Qualifying classification table — deliberately the same visual language as
// the race table (same row rhythm, colours, type sizes, cascade entrance):
// Pos | Driver | Team | Time | Gap (to pole). Entrants without a roster match
// (qualified but never raced/registered) render under their AC name, unlinked.
// Sectors as m:ss.mmm would be noise — quali sectors read best as ss.mmm.
function fmtSector(ms) {
  if (ms == null || !isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  return `${s}.${String(ms % 1000).padStart(3, "0")}`;
}

function QualiTable({ rows }) {
  // Sector columns only exist when the import carried them (older blobs
  // don't). The field's best time in each sector is tinted purple.
  const hasSectors = rows.some((r) => Array.isArray(r.sectors));
  const bestSector = [0, 1, 2].map((i) => {
    const vals = rows.map((r) => r.sectors?.[i]).filter((v) => v > 0);
    return vals.length ? Math.min(...vals) : null;
  });
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface2/50 text-left font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              <th className="w-14 px-3 py-3 text-center">Pos</th>
              <th className="px-3 py-3">Driver</th>
              <th className="hidden px-3 py-3 sm:table-cell">Team</th>
              {hasSectors && <th className="hidden px-3 py-3 text-right lg:table-cell">S1</th>}
              {hasSectors && <th className="hidden px-3 py-3 text-right lg:table-cell">S2</th>}
              {hasSectors && <th className="hidden px-3 py-3 text-right lg:table-cell">S3</th>}
              <th className="hidden px-3 py-3 text-right md:table-cell">Time</th>
              <th className="hidden px-3 py-3 text-right md:table-cell">Gap</th>
            </tr>
          </thead>
          {/* cascade: rows rise in one after another, like the race table */}
          <tbody className="cascade">
            {rows.map((r, i) => {
              const pole = r.position === 1 && isLap(r.bestLapMs);
              return (
                <tr
                  key={`${r.position}-${r.name}`}
                  style={{ "--i": Math.min(i, 16) }}
                  className="border-b border-border transition odd:bg-surface2/30 last:border-0 hover:bg-surface2"
                >
                  <td className="px-3 py-3.5 text-center">
                    <Rank position={r.position} />
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="h-7 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: r.team?.color || "var(--c-border)" }}
                        />
                        {r.driverId ? (
                          <Link
                            to={`/drivers/${r.driverId}`}
                            className="font-display text-base font-bold uppercase tracking-tight text-dark transition hover:text-brand"
                          >
                            {r.name}
                          </Link>
                        ) : (
                          <span className="font-display text-base font-bold uppercase tracking-tight text-dark">
                            {r.name}
                          </span>
                        )}
                        {r.driverId && <Flag code={countryFor(r.driverId, r.country)} />}
                      </span>
                      {pole && (
                        <span className="pill bg-purple-500/15 text-purple-500" title="Pole position">
                          Pole
                        </span>
                      )}
                    </div>
                    {/* phones: the lap time as a sub-line, like the race time */}
                    {isLap(r.bestLapMs) && (
                      <div className="mt-1 pl-4 font-mono text-xs tabular-nums text-light md:hidden">
                        {fmtLap(r.bestLapMs)}
                        {r.gapMs != null ? ` (${fmtGap(r.gapMs)})` : ""}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-3 py-3.5 sm:table-cell">
                    {r.team ? (
                      <Link to={`/teams/${r.team.id}`} className="inline-flex transition hover:opacity-80">
                        <TeamLogo
                          id={r.team.id}
                          name={r.team.name}
                          color={r.team.color}
                          logoUrl={r.team.logoUrl}
                          size={20}
                          showName
                          nameClassName="truncate text-sm text-medium"
                        />
                      </Link>
                    ) : (
                      <span className="font-mono text-faint">—</span>
                    )}
                  </td>
                  {hasSectors &&
                    [0, 1, 2].map((si) => {
                      const v = r.sectors?.[si];
                      const isBest = v != null && bestSector[si] != null && v === bestSector[si];
                      return (
                        <td
                          key={si}
                          className={`hidden px-3 py-3.5 text-right font-mono text-sm tabular-nums lg:table-cell ${
                            isBest ? "font-bold text-purple-500" : "text-light"
                          }`}
                          title={isBest ? "Fastest sector of the session" : undefined}
                        >
                          {fmtSector(v) || <span className="text-faint">—</span>}
                        </td>
                      );
                    })}
                  <td
                    className={`hidden px-3 py-3.5 text-right font-mono text-sm tabular-nums md:table-cell ${
                      pole ? "font-bold text-purple-500" : "text-medium"
                    }`}
                  >
                    {fmtLap(r.bestLapMs) || <span className="text-faint">—</span>}
                  </td>
                  <td className="hidden px-3 py-3.5 text-right font-mono text-sm tabular-nums text-medium md:table-cell">
                    {r.gapMs != null ? fmtGap(r.gapMs) : <span className="text-faint">—</span>}
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

// `session` ("race" | "quali") is owned by the caller — the switcher lives in
// the round header row on the Races page, not inside this component.
export default function RaceResults({ race, results, quali = null, session = "race" }) {
  const detailed = race.hasPositions;
  const hasQuali = Array.isArray(quali) && quali.length > 0;
  // Which drivers' tyre strategies are folded open (rows with stint data from
  // the AC import are clickable; older rounds simply have none).
  const [openStints, setOpenStints] = useState(() => new Set());
  const toggleStints = (driverId) =>
    setOpenStints((prev) => {
      const next = new Set(prev);
      if (next.has(driverId)) next.delete(driverId);
      else next.add(driverId);
      return next;
    });

  const lapRows = results.filter((r) => isLap(r.bestLapMs));
  const hasLaps = lapRows.length > 0;
  const hasGrid = results.some((r) => r.grid != null);
  const fastestMs = hasLaps ? Math.min(...lapRows.map((r) => r.bestLapMs)) : null;
  const fastestDriverId = hasLaps ? lapRows.find((r) => r.bestLapMs === fastestMs)?.driverId : null;
  const dotdId = race.driverOfTheDay?.driverId || null;

  // Race time / gap column (F1-style): the winner's full race time, then each
  // finisher's gap behind it, or "+N laps" for lapped cars. Steward penalties
  // are included so the times line up with the classified order.
  const adjMs = (r) => (r.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);
  const isFin = (r) => !r.status || r.status === "FINISHED";
  const leader = results.find((r) => isFin(r) && r.position === 1);
  const leaderMs = leader ? adjMs(leader) : null;
  const leaderLaps = leader?.laps ?? null;
  const hasTimes = leaderMs != null;
  function timeCell(r) {
    if (!isFin(r)) return null;
    const ms = adjMs(r);
    if (ms == null) return null;
    if (r.position === 1) return fmtDuration(ms);
    if (leaderLaps != null && r.laps != null && r.laps < leaderLaps) {
      const down = leaderLaps - r.laps;
      return `+${down} lap${down > 1 ? "s" : ""}`;
    }
    const gap = ms - (leaderMs ?? 0);
    // A smaller total time than the winner means fewer laps (no laps data to
    // say how many), so fall back to the car's own race time.
    return gap > 0 ? fmtGap(gap) : fmtDuration(ms);
  }

  if (hasQuali && session === "quali") return <QualiTable rows={quali} />;

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface2/50 text-left font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              {detailed && <th className="w-14 px-3 py-3 text-center">Pos</th>}
              {detailed && hasGrid && <th className="hidden px-3 py-3 text-center md:table-cell">Grid</th>}
              <th className="px-3 py-3">Driver</th>
              <th className="hidden px-3 py-3 sm:table-cell">Team</th>
              {/* phones: the race time moves under the driver name; the Time
                  column only appears from md up. DNF/DSQ shows in the points
                  column (those drivers score 0 anyway). */}
              {detailed && hasTimes && <th className="hidden px-3 py-3 text-right md:table-cell">Time</th>}
              {detailed && hasLaps && <th className="hidden px-3 py-3 text-right md:table-cell">Best Lap</th>}
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
              const hasStints = Array.isArray(r.stints) && r.stints.length > 0;
              const stintsOpen = hasStints && openStints.has(r.driverId);
              // Total column count for the expander row's colSpan.
              const colCount =
                2 + // driver + pts
                1 + // team (sm+)
                (detailed ? 1 : 0) +
                (detailed && hasGrid ? 1 : 0) +
                (detailed && hasTimes ? 1 : 0) +
                (detailed && hasLaps ? 1 : 0) +
                (detailed ? 1 : 0);
              return (
                <Fragment key={r.driverId}>
                <tr
                  style={{ "--i": Math.min(i, 16) }}
                  onClick={hasStints ? () => toggleStints(r.driverId) : undefined}
                  title={hasStints ? "Show tyre strategy" : undefined}
                  className={`border-b border-border transition odd:bg-surface2/30 last:border-0 hover:bg-surface2 ${
                    hasStints ? "cursor-pointer" : ""
                  }`}
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
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      {/* bar + name + flag wrap as one unit, so a long name never
                          leaves the colour bar stranded on its own line */}
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="h-7 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: r.team.color }}
                        />
                        <Link
                          to={`/drivers/${r.driverId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-display text-base font-bold uppercase tracking-tight text-dark transition hover:text-brand"
                          title={r.formerName ? `Raced as ${r.formerName}` : undefined}
                        >
                          {r.name}
                        </Link>
                        <Flag code={countryFor(r.driverId, r.country)} />
                      </span>
                      {tier != null && <TierBadge tier={tier} />}
                      {r.driverId === dotdId && (
                        <span className="pill bg-brand/20 text-brand" title="Driver of the Day">
                          ★ DOTD
                        </span>
                      )}
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
                      {hasStints && (
                        <svg
                          viewBox="0 0 24 24"
                          className={`h-3.5 w-3.5 shrink-0 text-light transition-transform ${stintsOpen ? "rotate-90" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                      )}
                    </div>
                    {/* phones: race time as a sub-line, since the Time column
                        doesn't fit next to the points there */}
                    {detailed && hasTimes && timeCell(r) && (
                      <div className="mt-1 pl-4 font-mono text-xs tabular-nums text-light md:hidden">
                        {timeCell(r)}
                      </div>
                    )}
                  </td>

                  <td className="hidden px-3 py-3.5 sm:table-cell">
                    {(() => {
                      const t = r.effectiveTeam || r.team;
                      return (
                        <Link to={`/teams/${t.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex transition hover:opacity-80">
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

                  {detailed && hasTimes && (
                    <td
                      className={`hidden px-3 py-3.5 text-right font-mono text-sm tabular-nums md:table-cell ${
                        r.position === 1 ? "font-bold text-dark" : "text-medium"
                      }`}
                    >
                      {timeCell(r) || <span className="text-faint">—</span>}
                    </td>
                  )}

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
                    {r.status && r.status !== "FINISHED" ? (
                      <StatusPill status={r.status} />
                    ) : (
                      <span className="font-mono text-lg font-bold tabular-nums text-dark">{r.points}</span>
                    )}
                  </td>
                </tr>
                {stintsOpen && (
                  <tr className="border-b border-border bg-surface2/40 last:border-0">
                    <td colSpan={colCount} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:pl-4">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-light">
                          Tyre strategy
                        </span>
                        {r.stints.map((s, idx) => {
                          const t = tyreCompound(s.tyre);
                          return (
                            <span key={idx} className="flex items-center gap-1.5">
                              {idx > 0 && (
                                <svg viewBox="0 0 24 24" className="h-3 w-3 text-faint" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M5 12h14M13 6l6 6-6 6" />
                                </svg>
                              )}
                              <TyreBadge t={t} size={22} />
                              <span className="font-mono text-xs tabular-nums text-medium">
                                {s.laps} {s.laps === 1 ? "lap" : "laps"}
                              </span>
                            </span>
                          );
                        })}
                        <span className="font-mono text-[10px] uppercase tracking-wider text-light">
                          · {r.stints.length - 1} {r.stints.length - 1 === 1 ? "stop" : "stops"}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
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
