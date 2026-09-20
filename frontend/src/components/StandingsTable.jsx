import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { TierBadge, Rank, PosDelta, CountUp, DriverAvatar } from "./ui.jsx";
import { playStandingsReplay } from "../utils/standingsReplay.js";
import { countryFor } from "../data/driverCountries.js";
import Flag from "./Flag.jsx";
import DriverName from "./DriverName.jsx";
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
        // `relative` for the sr-only span below. Tailwind's sr-only is
        // position:absolute, so without a positioned ancestor its containing
        // block is the page itself: it escaped both the horizontal scroller and
        // the card's overflow:hidden, and 28 of them stretched the document to
        // 572px on a 375px phone. Chrome refuses to scroll to clipped content so
        // nothing showed for it, but the page still measured wrong, and other
        // engines are less forgiving.
        className={`${base} relative text-sm text-faint line-through decoration-2`}
      >
        {label || 0}
        {/* The strike-through is the only visual marker, and the footnote under
            the table is far from the cell. Read out per cell instead. */}
        <span className="sr-only"> (dropped, not counted)</span>
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

  const { points, status, position, sprint, fastestLap } = cell;
  // A sprint weekend's cell is the sum of two results: the feature race (whose
  // position and status the cell shows) and the sprint. The tooltip spells the
  // two halves out, so a 60 next to a P1 does not look like a typo. A
  // fastest-lap bonus inside a half is named the same way, so a 36 next to a
  // P1 is explained too.
  const withFl = (pts, fl) => (fl ? `${pts} incl. +${fl} fastest lap` : `${pts}`);
  const half = (label, pos, st, pts, fl) =>
    `${label} ${st && st !== "FINISHED" ? st : pos != null ? `P${pos}` : "no result"} (${withFl(pts, fl)})`;
  const title = sprint
    ? `${half("Sprint", sprint.position, sprint.status, sprint.points, sprint.fastestLap)} + ${half("Feature", position, status, points - sprint.points, fastestLap)} = ${points}`
    : fastestLap
      ? `P${position}: ${withFl(points, fastestLap)}`
      : undefined;
  const anyFl = !!(fastestLap || sprint?.fastestLap);
  if (status && status !== "FINISHED") {
    const cls = status === "DNF" ? "text-warn" : status === "DSQ" ? "text-link" : "text-light";
    return (
      <td title={title} className={`${base} whitespace-nowrap text-[11px] font-semibold ${cls}`}>
        {status}
        {/* The feature was lost but the sprint still paid: the total the
            column adds up to has to be visible somewhere in the row. */}
        {sprint?.points > 0 && <span className="ml-0.5 text-[10px] font-semibold text-medium">+{sprint.points}</span>}
      </td>
    );
  }
  // Podium finishes light up in the medal colours (gold/silver/bronze), so a
  // driver's best rounds read straight off the matrix, season to season.
  const medal = position >= 1 && position <= 3 ? `var(--medal-${position})` : null;
  return (
    <td
      title={title}
      className={`${base} whitespace-nowrap text-sm ${medal ? "font-bold" : "text-medium"}`}
      style={medal ? { color: medal } : undefined}
    >
      {points || <span className="text-faint">0</span>}
      {/* The fastest-lap bonus is inside the number; the mark says why the
          cell pays one more than its position, the footnote spells it out. */}
      {anyFl && (
        <span className="ml-0.5 align-super text-[8px] font-bold text-fl" aria-label="fastest lap bonus">
          FL
        </span>
      )}
    </td>
  );
}

// `decided` — the season's title is settled (archived, or every round in):
// first place wears gold; while the season still runs it gets the pink
// leader wash instead.
// `sprintRounds` — the rounds run as sprint+feature weekends: both races score
// the season's table, added together under that round, so those columns are
// marked (a superscript S) and explained in the footnote.
// `fastestLapPoints` — the bonus the fastest race lap pays this season (0 =
// none): the driver cells carry an FL mark where one was paid and the footnote
// explains it.
// `customPoints` — { [round]: [P1, P2, …] } for the rounds paying by their own
// table (a double-points finale): the column is marked * and explained below.
// `championOverride` — { driverId, name } when the league decided the title by
// a rule the points do not express; the row sits first and the footnote says why.
// `manualPoints` — at least one driver's total was set by hand (a bonus the
// site cannot compute, a deduction, or a total typed in whole): those rows
// carry a mark on their total and the footnote spells the rule out. The values
// themselves ride on each row as pointsAdjust / pointsOverride.
export default function StandingsTable({ variant, raceNumbers, rows, dropWorst = 3, officialTotals = false, dropMode = "driver", teamDropWorst = null, decided = false, showMovement = false, sprintRounds = [], fastestLapPoints = 0, customPoints = {}, championOverride = null, manualPoints = false }) {
  const isDriver = variant === "driver";
  const sprintSet = new Set(sprintRounds || []);
  const showSprintNote = raceNumbers.some((n) => sprintSet.has(n));
  const showFlNote = fastestLapPoints > 0 && raceNumbers.length > 0;
  const customOf = (n) => (Array.isArray(customPoints?.[n]) && customPoints[n].length ? customPoints[n] : null);
  const customRounds = raceNumbers.filter((n) => customOf(n));
  const showCustomNote = customRounds.length > 0;
  const tableText = (t) => (t.length > 6 ? `${t.slice(0, 6).join(", ")}, …` : t.join(", "));
  const showChampionNote = isDriver && !!championOverride;
  // Hand-set points: only the driver table can carry them (a season figure
  // cannot be traced to the round a team scored it in).
  const manualOf = (row) =>
    isDriver && manualPoints && (row.pointsAdjust || row.pointsOverride != null)
      ? { adjust: row.pointsAdjust || 0, override: row.pointsOverride ?? null }
      : null;
  const showManualNote = isDriver && manualPoints && rows.some((r) => manualOf(r));
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
  // One-shot replay of the latest round's position moves (see
  // utils/standingsReplay.js): rows paint at their previous ranks, then glide
  // home with the green/red flash. Armed only when the caller wants movement
  // shown and something actually moved; the cascade entrance stays off on
  // those mounts because both would fight over the rows' transform.
  const replayed = useRef(false);
  const replayCancel = useRef(null);
  const replayNode = useRef(null);
  const replayArmed =
    showMovement && !replayed.current && rows.some((r) => r.prevPosition != null && r.prevPosition !== r.position);
  // Inline callback refs detach/re-attach on EVERY render, so teardown is
  // only real when the node actually left the document (see the twin in
  // DriverStandings for the full story).
  const replayRef = (el) => {
    if (el) {
      replayNode.current = el;
      if (!replayArmed || replayed.current) return;
      replayed.current = true;
      replayCancel.current = playStandingsReplay(el);
    } else if (replayNode.current && !replayNode.current.isConnected) {
      replayCancel.current?.();
      replayCancel.current = null;
      replayNode.current = null;
    }
  };
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
      {/* overscroll-x-none: without it, swiping past the first or last round
          rubber-bands the container and hands the leftover movement to the
          page. During that bounce the frozen Pos/Driver/Pts columns ride along
          with the content instead of staying put, which is exactly what they
          are there to avoid. */}
      <div ref={scrollRef} className="overflow-x-auto overscroll-x-none">
        <table className="w-full min-w-[720px] border-collapse">
          {/* scope="col" on every header: 92 header cells across the site
              carried none, and this is the table where a screen reader most
              needs to say which round a number belongs to.
              No sticky top row here, deliberately. It was tried: the horizontal
              scroller around this table computes overflow-y to `auto` (CSS will
              not let one axis be `auto` and the other `visible`), which makes it
              the containing block for `position: sticky` — so the header pins to
              a box that itself scrolls away with the page, and nothing sticks.
              Making it work needs the table to scroll vertically inside a
              fixed-height box, which is a different page layout, not a tweak. */}
          <thead>
            <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-wider text-light">
              <th scope="col" className="sticky left-0 z-20 w-14 bg-card px-3 py-3 text-center">Pos</th>
              {/* The cap must match the body cell below or the column resolves
                  between two different maxima; the driver column is the wider
                  of the two because it also carries a photo. */}
              <th scope="col" className={`sticky left-14 z-20 ${isDriver ? "max-w-[44vw]" : "max-w-[34vw]"} sm:max-w-none bg-card px-3 py-3 transition-shadow ${leftShadow}`}>
                {isDriver ? "Driver" : "Team"}
              </th>
              {isDriver && <th scope="col" className="hidden px-3 py-3 lg:table-cell">Discord</th>}
              {isDriver && <th scope="col" className="hidden px-3 py-3 md:table-cell">Team</th>}
              {isDriver && <th scope="col" className="px-3 py-3 text-center">Tier</th>}
              {raceNumbers.map((n) => (
                <th
                  scope="col"
                  key={n}
                  className="px-2.5 py-3 text-center tabular-nums"
                  title={
                    [
                      sprintSet.has(n) ? "Sprint weekend: the sprint and the feature race both score, added together under this round" : null,
                      customOf(n) ? `Own points table for this round: ${customOf(n).join(", ")}` : null,
                    ].filter(Boolean).join(". ") || undefined
                  }
                >
                  R{n}
                  {sprintSet.has(n) && (
                    <span className="ml-0.5 align-super text-[9px] font-bold text-brand" aria-label="sprint weekend">
                      S
                    </span>
                  )}
                  {customOf(n) && (
                    <span className="ml-0.5 align-super text-[9px] font-bold text-warn" aria-label="own points table">
                      *
                    </span>
                  )}
                </th>
              ))}
              <th scope="col" className={`sticky right-0 z-20 border-l border-border bg-card px-4 py-3 text-right transition-shadow ${rightShadow}`}>
                Pts
              </th>
            </tr>
          </thead>
          {/* cascade: rows rise in one after another, top to bottom, exactly
              like the driver standings list. --i drives the per-row stagger. */}
          <tbody ref={replayRef} className={replayArmed || replayed.current ? "" : "cascade"}>
            {rows.map((row, i) => {
              const droppedSet = new Set(row.droppedRounds || []);
              return (
                <tr
                  key={row.driverId || row.teamId}
                  data-replay-prev={showMovement ? row.prevPosition ?? "" : ""}
                  style={{ "--i": Math.min(i, 16) }}
                  className={`group border-b border-border last:border-0 transition ${
                    row.position === 1 && row.total > 0
                      ? decided
                        ? "row-gold"
                        : "row-leader"
                      : "hover:bg-surface2"
                  }`}
                >
                  <td className="sticky left-0 z-10 px-3 py-3 text-center transition sticky-cell">
                    <span className="inline-flex flex-col items-center gap-0.5">
                      <Rank position={row.position} />
                      {showMovement && row.prevPosition != null && <PosDelta delta={row.prevPosition - row.position} />}
                    </span>
                  </td>

                  {isDriver ? (
                    <td className={`sticky left-14 z-10 max-w-[44vw] sm:max-w-none px-3 py-3 transition sticky-cell ${leftShadow}`}>
                      {/* Same driver line as the standings LIST: colour bar,
                          photo, name, flag. The two views are the same table
                          read two ways, and only one of them used to put a face
                          to the name. */}
                      <Link to={`/drivers/${row.driverId}`} className="group/name flex items-center gap-2.5">
                        <span
                          className="h-8 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: row.team.color }}
                        />
                        <DriverAvatar name={row.name} photoUrl={row.photoUrl} color={row.team.color} size={30} />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <DriverName driver={row} className="truncate font-display text-base font-bold uppercase tracking-tight text-dark transition group-hover/name:text-brand sm:text-lg" />
                            {/* The photo already costs this frozen column
                                ~40px; on a 375px screen the flag on top of it
                                would eat the name itself. */}
                            <span className="hidden sm:inline-flex">
                              <Flag code={countryFor(row.driverId, row.country)} />
                            </span>
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
                    <td className={`sticky left-14 z-10 max-w-[34vw] sm:max-w-none px-3 py-3 transition sticky-cell ${leftShadow}`}>
                      <Link to={`/teams/${row.teamId}`} className="group/name flex items-center gap-3">
                        <TeamLogo id={row.teamId} name={row.name} color={row.color} logoUrl={row.logoUrl} size={28} />
                        <span className="min-w-0 truncate font-display text-base font-bold uppercase tracking-tight text-dark transition group-hover/name:text-brand sm:text-lg">
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
                    {/* reserve: the total counts up from 0, and this column is
                        auto-sized — without it every gained digit re-measured
                        the whole table and the header twitched (see CountUp). */}
                    <CountUp end={row.total} reserve />
                    {/* A total the league set by hand says so on the row, or
                        the column simply disagrees with the cells beside it. */}
                    {manualOf(row) && (
                      <sup
                        className="ml-0.5 align-super text-[10px] font-bold text-warn"
                        title={
                          manualOf(row).override != null
                            ? "Total set by hand by the league"
                            : `${manualOf(row).adjust > 0 ? "+" : ""}${manualOf(row).adjust} points added by hand by the league`
                        }
                      >
                        M
                      </sup>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(showOfficialNote || showDropNote || showSprintNote || showFlNote || showCustomNote || showChampionNote || showManualNote) && (
        <div className="space-y-1 border-t border-border px-4 py-2.5 font-mono text-[11px] leading-relaxed text-light">
          {showChampionNote && (
            <p>
              <span className="font-bold uppercase text-medium">Champion by the league&rsquo;s rule.</span> {championOverride.name} is
              champion without the most points: the title was decided by the league&rsquo;s own rule for that season, and the
              table shows the season that way.
            </p>
          )}
          {showManualNote && (
            <p>
              <span className="font-bold text-warn">M</span> marks points the league set by hand: a bonus the results
              cannot show on their own, a deduction, or a total taken straight from the league&rsquo;s own sheet. The round
              columns stay as they were scored, so they may not add up to the total.
            </p>
          )}
          {showCustomNote && (
            <p>
              <span className="font-bold text-warn">*</span> marks a round with its own points table:{" "}
              {customRounds.map((n, i) => (
                <span key={n}>
                  {i > 0 && "; "}R{n}: {tableText(customOf(n))}
                </span>
              ))}
              {" "}(P1, P2, …).
            </p>
          )}
          {showFlNote && (
            <p>
              {isDriver ? (
                <>
                  <span className="font-bold text-fl">FL</span> marks a fastest-lap bonus: the driver who sets the fastest
                  race lap scores +{fastestLapPoints} on top of their finish, if they finish the race.
                </>
              ) : (
                <>
                  The fastest race lap pays +{fastestLapPoints} to its driver (if they finish), and that point counts
                  for the team they drove for.
                </>
              )}
            </p>
          )}
          {showSprintNote && (
            <p>
              <span className="font-bold text-brand">S</span> marks a sprint weekend: the sprint and the feature race both
              score the full points table, added together under that round
              {isDriver && <> (hover a cell for the two halves)</>}.
            </p>
          )}
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
