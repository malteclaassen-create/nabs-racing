import { Link, useNavigate } from "react-router-dom";
import { CalendarCheck as CalendarDays } from "./icons/filled.jsx";
import { CardBar, MEDAL, StatusPill } from "./ui.jsx";
import Flag from "./Flag.jsx";
import CircuitMap from "./CircuitMap.jsx";
import { circuitFor, flagFor } from "../data/circuits.js";
import { fmtLap, fmtRaceDate, NO_VALUE } from "../utils/format.js";

// Race by race on the driver profile: every round of the season in calendar
// order, the run ones with the circuit outline, where the driver started and
// finished, their best lap and what the round paid, the ones still ahead
// greyed out with their date. A table from md up, two-line rows on a phone.
//
// Positions are the classified ones the profile already carries (a time
// penalty moves the car), and struck points are the rounds the season's drop
// rule takes off the total.

// The circuit's long name under the short one, when it says something more
// ("Spa" over "Spa-Francorchamps", nothing under "Mugello").
function circuitName(track) {
  const c = circuitFor(track)?.circuit;
  return c && c.toLowerCase() !== String(track || "").toLowerCase() ? c : null;
}

function Outline({ track, color, className }) {
  return (
    <span className={`flex shrink-0 items-center justify-center ${className}`} style={{ color }} aria-hidden="true">
      <CircuitMap track={track} strokeWidth={1.6} className="h-full w-full" />
    </span>
  );
}

// The result chip, medal-filled on the podium. Same chip the table always had.
function ResultChip({ position, status, title, small = false }) {
  if (status !== "FINISHED" || position == null) return <StatusPill status={status} />;
  const medal = position <= 3 ? MEDAL[position - 1] : null;
  return (
    <span
      className={`inline-flex h-7 items-center justify-center rounded-md px-1.5 font-display font-black tabular-nums ${
        small ? "min-w-[2.1rem] text-xs" : "min-w-[2rem] text-sm"
      } ${medal ? "text-ink" : "bg-surface2 text-dark ring-1 ring-border"}`}
      style={medal ? { backgroundColor: medal } : undefined}
      title={title}
    >
      P{position}
    </span>
  );
}

const Delta = ({ delta }) =>
  delta == null || delta === 0 ? (
    <span className="text-faint">±0</span>
  ) : (
    <span className={delta > 0 ? "text-ok" : "text-bad"}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>
  );

// Start to finish on a strip of the grid: the hollow ring is the slot they
// started from, the dot where they finished, the bar between them green for
// places won and red for places lost. Log scale, so the front of the field,
// where one place is worth the most, gets the most room.
function GridFinish({ grid, position, finished, scaleMax }) {
  if (grid == null && !finished) return <span className="text-faint">{NO_VALUE}</span>;
  const delta = finished && grid != null ? grid - position : null;
  const at = (p) => (Math.log(Math.max(1, p)) / Math.log(scaleMax)) * 100;
  const spur = finished && grid != null;
  const tone = delta > 0 ? "bg-ok" : delta < 0 ? "bg-bad" : "bg-faint";
  const lo = spur ? Math.min(at(grid), at(position)) : 0;
  const hi = spur ? Math.max(at(grid), at(position)) : 0;
  return (
    <div className="flex items-center gap-3">
      {spur && (
        <div className="relative hidden h-5 w-20 shrink-0 xl:block" aria-hidden="true">
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
          <div className={`absolute top-1/2 h-1 -translate-y-1/2 rounded-full opacity-40 ${tone}`} style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
          <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-faint bg-card" style={{ left: `${at(grid)}%` }} />
          <span className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${tone}`} style={{ left: `${at(position)}%` }} />
        </div>
      )}
      <span className="whitespace-nowrap font-mono text-xs tabular-nums text-light">
        {!finished ? `from P${grid}` : `${grid != null ? `P${grid}` : NO_VALUE} → P${position}`}
      </span>
      {spur && (
        <span className="font-mono text-xs font-bold tabular-nums">
          <Delta delta={delta} />
        </span>
      )}
    </div>
  );
}

function BestLap({ ms, fastest }) {
  const lap = fmtLap(ms);
  if (!lap) return <span className="text-faint">{NO_VALUE}</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${fastest ? "font-bold text-fl" : "text-medium"}`}>
      {lap}
      {fastest && (
        <span className="pill bg-purple-500/15 text-fl" title="Fastest lap of the race">
          FL
        </span>
      )}
    </span>
  );
}

export default function DriverRaceByRace({
  perRace = [],
  seasonRounds = [],
  color,
  droppedRounds,
  dropWorst = 0,
  totalRounds = 0,
  seasonNumber,
  standings = [],
  hasSprint = false,
}) {
  const navigate = useNavigate();
  const ran = new Set(perRace.map((r) => r.number));
  const upcoming = (seasonRounds || []).filter((s) => !s.isCompleted && !ran.has(s.number));
  // The grid strip's far end: the deepest slot this driver started or ended
  // in all season, at least a short field's worth.
  const scaleMax = Math.max(
    10,
    ...perRace.flatMap((r) => [r.grid, r.position, r.sprint?.grid, r.sprint?.position]).filter((v) => v != null)
  );
  // The points bar is read against the biggest haul anyone took from a single
  // round this season.
  const roundMax = Math.max(
    1,
    ...standings.flatMap((s) => Object.values(s.perRace || {}).map((c) => c?.points || 0))
  );
  const anyFastest = perRace.some((r) => r.fastestLap);
  const hrefOf = (r) =>
    r.raceId ? `/races?race=${r.raceId}${seasonNumber != null ? `&season=${seasonNumber}` : ""}` : null;
  const finishedOf = (r) => r.status === "FINISHED" && r.position != null;
  const sprintText = (s) =>
    s.status === "FINISHED" && s.position != null ? `Sprint P${s.position}` : `Sprint ${s.status}`;
  // Grid to finish, best lap and the result (and sprint) share one cell on an
  // upcoming row.
  const upcomingSpan = 3 + (hasSprint ? 1 : 0);

  return (
    <div className="reveal card overflow-hidden lg:col-span-2">
      <CardBar title="Race by Race" />

      {/* md and up: the table. */}
      <div className="hidden overflow-x-auto overflow-y-hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
              <th className="px-5 py-2.5">Rnd</th>
              <th className="px-2 py-2.5">Circuit</th>
              <th className="px-2 py-2.5">Grid → Finish</th>
              <th className="px-2 py-2.5 text-center">{hasSprint ? "Feature" : "Race"}</th>
              {hasSprint && (
                <th className="px-2 py-2.5 text-center" title="The sprint race of a sprint weekend (scores like the feature race, added to the round)">
                  Sprint
                </th>
              )}
              <th className="px-2 py-2.5">Best lap</th>
              <th className="px-5 py-2.5 text-right">Pts</th>
            </tr>
          </thead>
          {/* cascade: rounds deal in one after another, like the standings rows */}
          <tbody className="cascade divide-y divide-border">
            {perRace.map((r, i) => {
              const finished = finishedOf(r);
              const dropped = droppedRounds?.has(r.number);
              const raceHref = hrefOf(r);
              const sub = circuitName(r.track);
              return (
                <tr
                  key={r.number}
                  style={{ "--i": Math.min(i, 16) }}
                  title={dropped ? "Dropped: one of the lowest-scoring rounds, not counted toward the total" : raceHref ? "Open this race" : undefined}
                  onClick={raceHref ? () => navigate(raceHref) : undefined}
                  onKeyDown={raceHref ? (e) => { if (e.key === "Enter") navigate(raceHref); } : undefined}
                  tabIndex={raceHref ? 0 : undefined}
                  role={raceHref ? "link" : undefined}
                  className={`group transition hover:bg-surface2 ${raceHref ? "cursor-pointer" : ""}`}
                >
                  <td className="px-5 py-3 font-mono font-bold tabular-nums text-light">{r.number}</td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-3">
                      <Outline track={r.track} color={color} className="h-7 w-9" />
                      <Flag code={flagFor(r.track)?.country} w={20} h={14} />
                      <div className="min-w-0">
                        <div className="font-display font-bold uppercase leading-tight tracking-tight text-dark transition group-hover:text-brand">{r.track}</div>
                        {sub && <div className="truncate text-[11px] text-light">{sub}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    <GridFinish grid={r.grid} position={r.position} finished={finished} scaleMax={scaleMax} />
                  </td>
                  <td className="px-2 py-3 text-center">
                    <ResultChip position={r.position} status={r.status} />
                  </td>
                  {hasSprint && (
                    <td className="px-2 py-3 text-center">
                      {r.sprint ? (
                        <ResultChip
                          position={r.sprint.position}
                          status={r.sprint.status}
                          title={r.sprint.position != null ? `Sprint P${r.sprint.position} · ${r.sprint.points} pts` : undefined}
                        />
                      ) : (
                        <span className="text-faint" title="No sprint this round">{NO_VALUE}</span>
                      )}
                    </td>
                  )}
                  <td className="px-2 py-3 font-mono text-xs tabular-nums">
                    <BestLap ms={r.bestLapMs} fastest={r.fastestLap} />
                  </td>
                  <td className="px-5 py-3" title={r.sprint ? `Feature ${r.points - r.sprint.points} + sprint ${r.sprint.points} = ${r.points}` : undefined}>
                    <div className="flex items-center justify-end gap-3">
                      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface2 xl:block" aria-hidden="true">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(100, (r.points / roundMax) * 100)}%`, backgroundColor: dropped ? "var(--c-faint)" : color }}
                        />
                      </div>
                      <span className="min-w-[1.75rem] text-right font-display text-base font-black tabular-nums">
                        {dropped ? (
                          <span className="text-faint line-through decoration-2">{r.points}</span>
                        ) : (
                          <span className="text-dark">{r.points}</span>
                        )}
                      </span>
                    </div>
                    {/* A sprint weekend's total is two results: say so under
                        the number, so a 60 next to a P3 adds up. */}
                    {r.sprint && (
                      <span className="block text-right font-mono text-[10px] font-semibold tabular-nums text-light">
                        {r.points - r.sprint.points} + {r.sprint.points}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {upcoming.map((s, j) => (
              <tr key={`u${s.number}`} style={{ "--i": Math.min(perRace.length + j, 16) }} className="bg-surface2/50 text-faint">
                <td className="px-5 py-3 font-mono font-bold tabular-nums">{s.number}</td>
                <td className="px-2 py-3">
                  <div className="flex items-center gap-3">
                    <Outline track={s.track} color="var(--c-faint)" className="h-7 w-9 opacity-60" />
                    <Flag code={flagFor(s.track)?.country} w={20} h={14} className="opacity-60" />
                    <span className="font-display font-bold uppercase tracking-tight">{s.track}</span>
                    {j === 0 && <span className="pill bg-brand text-onbrand">Next</span>}
                  </div>
                </td>
                <td colSpan={upcomingSpan} className="px-2 py-3 font-mono text-xs uppercase tracking-wider">
                  {s.date ? `${fmtRaceDate(s.date)} · upcoming` : "upcoming"}
                </td>
                <td className="px-5 py-3">
                  <CalendarDays className="ml-auto h-4 w-4" aria-hidden="true" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: two-line rows, the whole row opens the race. */}
      <ul className="cascade divide-y divide-border md:hidden">
        {perRace.map((r, i) => {
          const finished = finishedOf(r);
          const dropped = droppedRounds?.has(r.number);
          const raceHref = hrefOf(r);
          const delta = finished && r.grid != null ? r.grid - r.position : null;
          const lap = fmtLap(r.bestLapMs);
          const body = (
            <>
              <span className="w-5 shrink-0 font-mono text-xs font-bold tabular-nums text-light">{r.number}</span>
              <Outline track={r.track} color={color} className="h-7 w-8" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Flag code={flagFor(r.track)?.country} w={16} h={12} />
                  <span className="truncate font-display text-sm font-bold uppercase tracking-tight text-dark">{r.track}</span>
                </div>
                <div className="truncate font-mono text-[11px] uppercase tabular-nums text-light">
                  {r.grid != null ? `Grid P${r.grid}` : "No grid"}
                  {delta != null && (
                    <>
                      {" · "}
                      <Delta delta={delta} />
                    </>
                  )}
                  {lap && (
                    <>
                      {" · "}
                      <span className={r.fastestLap ? "font-bold text-fl" : ""}>
                        {lap}
                        {r.fastestLap && " FL"}
                      </span>
                    </>
                  )}
                  {r.sprint && ` · ${sprintText(r.sprint)}`}
                </div>
              </div>
              <ResultChip position={r.position} status={r.status} small />
              <span className="w-8 shrink-0 text-right font-display font-black tabular-nums">
                {dropped ? <span className="text-faint line-through decoration-2">{r.points}</span> : <span className="text-dark">{r.points}</span>}
              </span>
            </>
          );
          return (
            <li key={r.number} style={{ "--i": Math.min(i, 16) }}>
              {raceHref ? (
                <Link to={raceHref} className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface2">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3">{body}</div>
              )}
            </li>
          );
        })}
        {upcoming.map((s, j) => (
          <li key={`u${s.number}`} style={{ "--i": Math.min(perRace.length + j, 16) }} className="flex items-center gap-3 bg-surface2/50 px-4 py-3">
            <span className="w-5 shrink-0 font-mono text-xs font-bold tabular-nums text-light">{s.number}</span>
            <Outline track={s.track} color="var(--c-faint)" className="h-7 w-8 opacity-60" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Flag code={flagFor(s.track)?.country} w={16} h={12} className="opacity-60" />
                <span className="truncate font-display text-sm font-bold uppercase tracking-tight text-faint">{s.track}</span>
              </div>
              <div className="font-mono text-[11px] uppercase text-light">{s.date ? fmtRaceDate(s.date) : "upcoming"}</div>
            </div>
            {j === 0 && <span className="pill bg-brand text-onbrand">Next</span>}
          </li>
        ))}
      </ul>

      {(dropWorst > 0 || anyFastest) && (
        <p className="border-t border-border px-5 py-2.5 font-mono text-[11px] leading-relaxed text-light sm:px-6">
          {dropWorst > 0 && (
            <>
              <span className="text-faint line-through decoration-2">Struck</span> points are dropped: a driver&rsquo;s {dropWorst}
              {" "}lowest-scoring round{dropWorst === 1 ? " doesn't" : "s don't"} count toward the total
              {totalRounds > dropWorst && <> (best {totalRounds - dropWorst} of {totalRounds})</>}.
            </>
          )}
          {anyFastest && (
            <span className={dropWorst > 0 ? "ml-2" : ""}>
              <span className="font-bold text-fl">FL</span> fastest lap of the race.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
