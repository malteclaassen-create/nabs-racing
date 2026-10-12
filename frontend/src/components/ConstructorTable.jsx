import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { List as ListIcon, Table2 } from "lucide-react";
import { Rank, PosDelta, CountUp } from "./ui.jsx";
import { StandingsNotes } from "./StandingsTable.jsx";
import { standingCaption } from "./DriverStandingsRow.jsx";
import { playStandingsReplay } from "../utils/standingsReplay.js";
import { flagFor } from "../data/circuits.js";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";

// A team colour at a given strength over whatever sits behind it. color-mix so
// any colour string the admin typed works, not only six-digit hex.
const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// One-shot replay of the latest round's position moves (utils/standingsReplay.js),
// the same contract the round matrix on the driver standings uses: rows paint
// at their previous ranks, then glide home. Each container (table body, phone
// list) gets its own, because only the one on screen has rows to move.
function useReplay(armed) {
  const played = useRef(false);
  const cancel = useRef(null);
  const node = useRef(null);
  const willPlay = armed && !played.current;
  const ref = (el) => {
    if (el) {
      node.current = el;
      if (!willPlay || played.current) return;
      const c = playStandingsReplay(el);
      // Hidden (the other layout is showing): nothing moved, try again when
      // this container comes on screen.
      if (!c) return;
      played.current = true;
      cancel.current = c;
    } else if (node.current && !node.current.isConnected) {
      cancel.current?.();
      cancel.current = null;
      node.current = null;
    }
  };
  return [ref, willPlay || played.current];
}

// What a team round cell holds: the points the race paid, the share that
// counts, and whether the drop rule took all or part of it.
function cellOf(row, n) {
  const pts = row.perRace?.[n];
  if (pts == null) return null;
  const dropped = Math.min(pts, row.droppedPerRace?.[n] || 0);
  return { pts, counted: pts - dropped, dropped, all: pts > 0 && dropped >= pts, part: dropped > 0 && dropped < pts };
}

function RoundCell({ cell, best }) {
  const base = "px-1.5 py-3 text-center font-mono tabular-nums";
  if (!cell) return <td className={`${base} text-xs text-faint`}>·</td>;
  if (cell.all)
    return (
      <td
        title="Dropped: not counted toward the total"
        className={`${base} relative text-sm text-faint line-through decoration-2`}
      >
        {cell.pts}
        <span className="sr-only"> (dropped, not counted)</span>
      </td>
    );
  if (cell.part)
    return (
      <td
        title={`${cell.pts} scored: ${cell.dropped} dropped, ${cell.counted} count`}
        className={`${base} whitespace-nowrap text-sm`}
      >
        <span className="font-semibold text-dark">{cell.counted}</span>
        <sup className="ml-0.5 text-[9px] text-faint line-through">{cell.pts}</sup>
      </td>
    );
  if (best)
    return (
      <td className={`${base} text-sm font-bold text-dark`} title="This team's best round">
        <span className="rounded-md bg-brand/25 px-1.5 py-0.5">{cell.pts}</span>
      </td>
    );
  return (
    <td className={`${base} text-sm ${cell.pts ? "text-medium" : "text-faint"}`}>{cell.pts}</td>
  );
}

// The constructors' table of one tier. Wide screens get the round matrix: team
// colour down the left edge, the drivers under the team name, the team's best
// round marked, dropped points struck through and a gap column. Phones get a
// list with a small bar per round instead, and the full matrix one tap away
// (scrolling sideways under frozen Pos/Team and Pts columns, like every other
// round table on the site).
export default function ConstructorTable({ standings, races = [], rosterByTeam = new Map(), decided = false, showMovement = false }) {
  const [phoneTable, setPhoneTable] = useState(false);
  const rows = standings.standings;
  const raceNumbers = standings.raceNumbers;
  const sprintSet = new Set(standings.sprintRounds || []);
  const customPoints = standings.customPoints || {};
  const isCustom = (n) => Array.isArray(customPoints[n]) && customPoints[n].length > 0;
  const raceByNumber = new Map(races.filter((r) => !r.isSpecialEvent && r.number != null).map((r) => [r.number, r]));
  const done = new Set(raceNumbers.filter((n) => rows.some((r) => r.perRace?.[n] != null)));
  const leaderTotal = rows[0]?.total ?? 0;
  const maxRound = Math.max(1, ...rows.flatMap((r) => raceNumbers.map((n) => r.perRace?.[n] ?? 0)));

  const moved = showMovement && rows.some((r) => r.prevPosition != null && r.prevPosition !== r.position);
  const [tableReplay, tableReplaying] = useReplay(moved);
  const [listReplay, listReplaying] = useReplay(moved);

  // The legend shows real cells from this table, never made-up numbers.
  const cells = rows.flatMap((r) => raceNumbers.map((n) => cellOf(r, n)).filter(Boolean));
  const bestEver = Math.max(0, ...cells.map((c) => c.pts));
  const allExample = cells.find((c) => c.all);
  const partExample = cells.find((c) => c.part);
  // The frozen Pos column: Rank and arrow side by side on wide screens,
  // stacked on phones so the frozen part leaves room for the rounds. Literal
  // class strings, so Tailwind sees them.
  const posW = showMovement
    ? "w-[50px] min-w-[50px] md:w-[92px] md:min-w-[92px]"
    : "w-[50px] min-w-[50px] md:w-[60px] md:min-w-[60px]";
  const teamLeft = showMovement ? "left-[50px] md:left-[92px]" : "left-[50px] md:left-[60px]";
  const driversOf = (teamId) => (rosterByTeam.get(teamId) || []).map((d) => d.name).join(" · ");
  const gapOf = (row) => standingCaption(row.position, leaderTotal - row.total, { decided });
  const rowTone = (row) => (row.position === 1 && row.total > 0 && decided ? "row-gold" : "hover:bg-surface2");

  return (
    <div className="card overflow-hidden">
      {/* Phones: the list. */}
      <div className={phoneTable ? "hidden" : "md:hidden"}>
        <div className="flex items-center justify-between border-b border-border px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
          <span>
            Team{raceNumbers.length > 0 && <> · R{raceNumbers[0]} to R{raceNumbers[raceNumbers.length - 1]}</>}
          </span>
          <span>Pts</span>
        </div>
        <ul ref={listReplay} className={`divide-y divide-border ${listReplaying ? "" : "cascade"}`}>
          {rows.map((row, i) => (
            <li
              key={row.teamId}
              data-replay-prev={showMovement ? row.prevPosition ?? "" : ""}
              style={{ "--i": Math.min(i, 16) }}
              className={row.position === 1 && row.total > 0 && decided ? "row-gold" : ""}
            >
              <Link to={`/teams/${row.teamId}`} className="relative flex items-center gap-3 px-4 py-3 transition hover:bg-surface2">
                <span className="absolute inset-y-2 left-0 w-1 rounded-r" style={{ backgroundColor: row.color }} />
                <Rank position={row.position} />
                <TeamLogo id={row.teamId} name={row.name} color={row.color} logoUrl={row.logoUrl} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark">{row.name}</span>
                    {showMovement && <PosDelta delta={row.prevPosition != null ? row.prevPosition - row.position : null} none={row.prevPosition == null} />}
                  </div>
                  {/* One bar per round, to the scale of the tier's best round.
                      Dropped points fade, rounds not run yet are a flat line. */}
                  <div className="mt-1.5 flex h-[22px] items-end gap-[2px]" aria-hidden="true">
                    {raceNumbers.map((n) => {
                      const c = cellOf(row, n);
                      if (!c || c.pts === 0)
                        return <span key={n} className={`h-[2px] flex-1 rounded-sm bg-border ${c ? "" : "opacity-50"}`} />;
                      const pct = Math.round((c.counted / c.pts) * 100);
                      return (
                        <span
                          key={n}
                          className="flex-1 rounded-sm"
                          style={{
                            height: Math.max(2, Math.round((c.pts / maxRound) * 22)),
                            background: c.all
                              ? tint(row.color, 35)
                              : c.part
                                ? `linear-gradient(to top, ${row.color} ${pct}%, ${tint(row.color, 35)} ${pct}%)`
                                : row.color,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-display text-xl font-black tabular-nums text-dark">
                    <CountUp end={row.total} reserve />
                  </div>
                  <div className="font-mono text-[10px] text-light">{gapOf(row)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Wide screens (and phones that asked for it): the round matrix. */}
      <div className={phoneTable ? "block" : "hidden md:block"}>
        {/* overflow-y-hidden: the rows rising in briefly reach below the box,
            and a sideways scroller shows a scrollbar for that (y computes to
            auto beside x: auto). */}
        <div className="overflow-x-auto overflow-y-hidden overscroll-x-none">
          {/* Separate borders on the cells, top borders only: the frozen
              columns paint an opaque background that would cover a collapsed
              row border (see StandingsTable for the long story). */}
          <table className="w-full min-w-[720px] border-separate border-spacing-0 [&>tbody>tr>td]:border-t [&>tbody>tr>td]:border-border">
            <thead>
              <tr className="font-mono text-[10px] font-bold uppercase text-light">
                <th scope="col" className={`sticky left-0 z-20 ${posW} bg-card pb-2 pl-3 pt-3 text-left md:pl-4`}>Pos</th>
                <th scope="col" className={`sticky ${teamLeft} z-20 w-36 min-w-[9rem] max-w-[9rem] bg-card pb-2 pr-3 pt-3 text-left md:w-auto md:min-w-0 md:max-w-none md:pr-4`}>Team</th>
                {raceNumbers.map((n) => {
                  const race = raceByNumber.get(n);
                  const circ = race ? flagFor(race.track, race.country) : null;
                  return (
                    <th
                      key={n}
                      scope="col"
                      className={`px-1.5 pb-2 pt-3 text-center ${done.has(n) ? "" : "text-faint"}`}
                      title={
                        [
                          race?.track,
                          sprintSet.has(n) ? "Sprint weekend: the feature race and the sprint both score, added together under this round" : null,
                          isCustom(n) ? `Own points table for this round: ${customPoints[n].join(", ")}` : null,
                        ].filter(Boolean).join(". ") || undefined
                      }
                    >
                      <span className="flex flex-col items-center gap-1">
                        {circ ? <Flag code={circ.country} title={circ.countryName} w={14} h={10} /> : <span className="h-[10px]" />}
                        <span className="whitespace-nowrap">
                          R{n}
                          {sprintSet.has(n) && <span className="ml-0.5 align-super text-[8px] font-bold text-brand" aria-label="sprint weekend">S</span>}
                          {isCustom(n) && <span className="ml-0.5 align-super text-[8px] font-bold text-warn" aria-label="own points table">*</span>}
                        </span>
                      </span>
                    </th>
                  );
                })}
                <th scope="col" className="px-3 pb-2 pt-3 text-right">Gap</th>
                <th scope="col" className="sticky right-0 z-20 bg-surface2 px-4 pb-2 pt-3 text-right">Pts</th>
              </tr>
            </thead>
            <tbody ref={tableReplay} className={tableReplaying ? "" : "cascade"}>
              {rows.map((row, i) => {
                const counted = raceNumbers.map((n) => cellOf(row, n)).filter(Boolean);
                const best = Math.max(0, ...counted.map((c) => c.pts));
                return (
                  <tr
                    key={row.teamId}
                    data-replay-prev={showMovement ? row.prevPosition ?? "" : ""}
                    style={{ "--i": Math.min(i, 16) }}
                    className={`group transition ${rowTone(row)}`}
                  >
                    <td className={`sticky left-0 z-10 ${posW} py-3 pl-3 pr-1.5 transition sticky-cell md:pl-4 md:pr-2`}>
                      <span className="absolute inset-y-2 left-0 w-1 rounded-r" style={{ backgroundColor: row.color }} />
                      <span className="flex flex-col items-center gap-0.5 md:flex-row md:gap-1.5">
                        <Rank position={row.position} />
                        {showMovement && <PosDelta delta={row.prevPosition != null ? row.prevPosition - row.position : null} none={row.prevPosition == null} />}
                      </span>
                    </td>
                    <td className={`sticky ${teamLeft} z-10 w-36 min-w-[9rem] max-w-[9rem] py-3 pr-3 transition sticky-cell md:w-auto md:min-w-0 md:max-w-none md:pr-4`}>
                      <Link to={`/teams/${row.teamId}`} className="group/name flex items-center gap-3">
                        <TeamLogo id={row.teamId} name={row.name} color={row.color} logoUrl={row.logoUrl} size={30} />
                        <span className="min-w-0">
                          <span className="line-clamp-2 font-display text-[13px] font-extrabold uppercase leading-tight tracking-tight text-dark transition group-hover/name:text-brand md:line-clamp-none md:truncate md:text-[15px]">
                            {row.name}
                          </span>
                          {driversOf(row.teamId) && <span className="hidden truncate text-xs text-light md:block">{driversOf(row.teamId)}</span>}
                        </span>
                      </Link>
                    </td>
                    {raceNumbers.map((n) => {
                      const c = cellOf(row, n);
                      return <RoundCell key={n} cell={c} best={!!c && best > 0 && c.pts === best && !c.all} />;
                    })}
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-light">{gapOf(row)}</td>
                    <td className="sticky right-0 z-10 bg-surface2 px-4 py-3 text-right font-display text-xl font-black tabular-nums text-dark transition sticky-cell">
                      <CountUp end={row.total} reserve />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2 border-t border-border px-4 py-3">
        {bestEver > 0 && (
          <div className={`flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-light ${phoneTable ? "flex" : "hidden md:flex"}`}>
            <span className="flex items-center gap-1.5">
              <span className="rounded bg-brand/25 px-1 font-bold text-dark">{bestEver}</span> a team&rsquo;s best round
            </span>
            {allExample && (
              <span className="flex items-center gap-1.5">
                <span className="text-faint line-through decoration-2">{allExample.pts}</span> dropped round
              </span>
            )}
            {partExample && (
              <span className="flex items-center gap-1.5">
                <span>
                  <b className="text-dark">{partExample.counted}</b>
                  <sup className="ml-0.5 text-faint line-through">{partExample.pts}</sup>
                </span>
                partly dropped
              </span>
            )}
          </div>
        )}
        <StandingsNotes
          variant="constructor"
          raceNumbers={raceNumbers}
          rows={rows}
          dropWorst={standings.dropMode === "driver" ? standings.projectedDrops ?? standings.dropWorst : standings.dropWorst}
          officialTotals={standings.officialTotals}
          dropMode={standings.dropMode}
          teamDropWorst={
            standings.dropMode === "team"
              ? standings.projectedTeamDrops ?? standings.teamDropWorst
              : standings.dropMode === "teamRounds"
                ? standings.projectedDrops ?? standings.teamDropWorst
                : standings.teamDropWorst
          }
          sprintRounds={standings.sprintRounds || []}
          fastestLapPoints={standings.fastestLapPoints || 0}
          customPoints={customPoints}
          className=""
        />
      </div>

      {raceNumbers.length > 0 && (
        <button
          type="button"
          onClick={() => setPhoneTable((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border py-3 text-sm font-semibold text-link transition hover:bg-surface2 md:hidden"
        >
          {phoneTable ? <ListIcon className="h-4 w-4" aria-hidden="true" /> : <Table2 className="h-4 w-4" aria-hidden="true" />}
          {phoneTable ? "Back to the list" : "Round-by-round table"}
        </button>
      )}
    </div>
  );
}
