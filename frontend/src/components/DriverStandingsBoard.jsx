import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { TierBadge, Rank, PosDelta, CountUp, DriverAvatar } from "./ui.jsx";
import { StandingsNotes, customTableOf, manualOfRow } from "./StandingsTable.jsx";
import { standingCaption } from "./DriverStandingsRow.jsx";
import { countryFor } from "../data/driverCountries.js";
import { motionOff } from "../hooks/motion.js";
import Flag from "./Flag.jsx";
import DriverName from "./DriverName.jsx";
import TeamLogo from "./TeamLogo.jsx";

// ---------------------------------------------------------------------------
// The driver standings as ONE table with two states: "list" (the ranked rows
// with the points bar) and "grid" (the same rows with a column per round).
// They used to be two components, and switching faded one card out and the
// other in, so the eye had to find its driver all over again. Now the rows
// stay put, same driver on the same line, and only what differs moves: the
// round columns open between the name and the points, the bar folds away, the
// header row and the footnotes grow in. All of that is CSS (.sboard in
// index.css) driven by a few width variables on the board, so a switch costs
// one render and no per-frame work in React.
// ---------------------------------------------------------------------------

// How long a switch takes (index.css: --t-slow). The frozen columns and the
// row-wide link wait this long before changing over when going back to the
// list, see `settled` below.
const MORPH_MS = 450;

// Tracks how far the scroller is scrolled, so the frozen Pos/Driver and Pts
// columns cast a shadow only when content is actually tucked beneath them.
// The board inside grows and shrinks without the scroller changing size, so
// it is watched as well, or the shadow would miss the round columns opening.
function useScrollEdges() {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 2;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdge((e) => (e.start === start && e.end === end ? e : { start, end }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return [ref, edge];
}

// One round's points for one driver, with status colouring. `dropped` = one
// of the driver's lowest rounds, not counted toward the total (season drop
// rule): struck through and dimmed.
function RoundCell({ cell, dropped, grid }) {
  const role = grid ? "cell" : undefined;
  const base = "sb-cell relative flex items-center justify-center whitespace-nowrap font-mono";
  if (cell == null)
    return (
      <div role={role} className={`${base} text-sm text-faint`}>
        ·
      </div>
    );

  if (dropped) {
    const label = cell.status && cell.status !== "FINISHED" ? cell.status : cell.points;
    return (
      <div
        role={role}
        title="Dropped: scored in the lowest rounds, not counted toward the total"
        // `relative` (in base) holds the sr-only span below: Tailwind's sr-only
        // is position:absolute, and without a positioned ancestor it escaped the
        // scroller and stretched the page on phones.
        className={`${base} text-sm text-faint line-through decoration-2`}
      >
        <span>
          {label || 0}
          {/* The strike-through is the only visual marker, and the footnote
              under the table is far from the cell. Read out per cell instead. */}
          <span className="sr-only"> (dropped, not counted)</span>
        </span>
      </div>
    );
  }

  const { points, status, position, sprint, fastestLap } = cell;
  // A sprint weekend's cell is the sum of two results: the feature race (whose
  // position and status the cell shows) and the sprint. The tooltip spells the
  // two halves out, so a 60 next to a P1 does not look like a typo. A
  // fastest-lap bonus inside a half is named the same way.
  const withFl = (pts, fl) => (fl ? `${pts} incl. +${fl} fastest lap` : `${pts}`);
  const half = (label, pos, st, pts, fl) =>
    `${label} ${st && st !== "FINISHED" ? st : pos != null ? `P${pos}` : "no result"} (${withFl(pts, fl)})`;
  const title = sprint
    ? `${half("Feature", position, status, points - sprint.points, fastestLap)} + ${half("Sprint", sprint.position, sprint.status, sprint.points, sprint.fastestLap)} = ${points}`
    : fastestLap
      ? `P${position}: ${withFl(points, fastestLap)}`
      : undefined;
  const anyFl = !!(fastestLap || sprint?.fastestLap);
  if (status && status !== "FINISHED") {
    const cls = status === "DNF" ? "text-warn" : status === "DSQ" ? "text-link" : "text-light";
    return (
      <div role={role} title={title} className={`${base} text-[11px] font-semibold ${cls}`}>
        <span>
          {status}
          {/* The feature was lost but the sprint still paid: the total the
              column adds up to has to be visible somewhere in the row. */}
          {sprint?.points > 0 && <span className="ml-0.5 text-[10px] font-semibold text-medium">+{sprint.points}</span>}
        </span>
      </div>
    );
  }
  // Podium finishes light up in the medal colours, so a driver's best rounds
  // read straight off the matrix, season to season.
  const medal = position >= 1 && position <= 3 ? `var(--medal-${position})` : null;
  return (
    <div
      role={role}
      title={title}
      className={`${base} text-sm ${medal ? "font-bold" : "text-medium"}`}
      style={medal ? { color: medal } : undefined}
    >
      <span>
        {points || <span className="text-faint">0</span>}
        {/* The fastest-lap bonus is inside the number; the mark says why the
            cell pays one more than its position, the footnote spells it out. */}
        {anyFl && (
          <span className="ml-0.5 align-super text-[8px] font-bold text-fl" aria-label="fastest lap bonus">
            FL
          </span>
        )}
      </span>
    </div>
  );
}

function BoardRow({ d, index, leaderTotal, grid, sticky, roundsOn, raceNumbers, multiTier, champion, decided, delta, deltaSlot, manual, leftShadow, rightShadow }) {
  const gap = leaderTotal - d.total;
  const pct = d.total > 0 && leaderTotal > 0 ? Math.max(4, (d.total / leaderTotal) * 100) : 0;
  const droppedSet = new Set(d.droppedRounds || []);
  const flag = countryFor(d.driverId, d.country);
  return (
    <div
      role={grid ? "row" : undefined}
      data-driver-id={d.driverId}
      data-replay-prev={d.prevPosition ?? ""}
      style={{ "--i": index }}
      className={`group relative flex items-stretch transition ${
        champion ? (decided ? "row-gold" : "row-leader") : "hover:bg-surface2"
      }`}
    >
      <div
        role={grid ? "cell" : undefined}
        className={`sb-pos sticky-cell flex items-center gap-2.5 pl-3 pr-2.5 transition sm:gap-4 sm:pl-5 sm:pr-4 ${sticky ? "sticky left-0 z-10" : ""}`}
      >
        <Rank position={d.position} />
        {/* A debut has no arrow; keep its slot so the colour bars stay in one line */}
        {delta != null ? <PosDelta delta={delta} /> : deltaSlot && <PosDelta none />}
      </div>

      <div
        role={grid ? "rowheader" : undefined}
        className={`sb-driver sticky-cell flex items-center py-3 pr-2.5 transition sm:pr-4 ${sticky ? `sticky z-10 ${leftShadow}` : ""}`}
        style={sticky ? { left: "var(--sb-pos)" } : undefined}
      >
        {/* The one link in the row. In the list it stretches over the whole
            row (the ::after), as the row itself used to be the link; in the
            round view the cells keep their own tooltips and only the name
            leads to the profile. The stretch needs the row as its containing
            block, which is why the frozen columns only freeze in the round
            view: a sticky cell would capture it. */}
        <Link
          to={`/drivers/${d.driverId}`}
          className={`group/name flex min-w-0 flex-1 items-center ${
            sticky
              ? ""
              : "after:absolute after:inset-0 after:z-[2] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent"
          }`}
        >
          <span className="mr-2.5 h-9 w-1.5 shrink-0 rounded-full sm:mr-4" style={{ backgroundColor: d.team.color }} />
          <span className="sb-avatar">
            <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={d.team.color} size={36} />
          </span>
          <span className="block min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <DriverName
                driver={d}
                className={`truncate font-display text-base font-bold uppercase tracking-tight text-dark transition sm:text-lg ${
                  grid ? "group-hover/name:text-brand" : ""
                }`}
              />
              {/* Folds away on a phone in the round view, where the name
                  column is only 8rem wide. */}
              {flag && (
                <span className="sb-flag inline-flex shrink-0">
                  <Flag code={flag} />
                </span>
              )}
              {/* On phones the badge stole the name's room (even short names
                  were cut); the tier filter tabs above cover that info there.
                  A season with one class only shows it in the round view, where
                  it tells the reserves apart. */}
              {multiTier ? (
                <span className="hidden sm:inline-flex">
                  <TierBadge tier={d.tier} />
                </span>
              ) : (
                <span
                  className="sb-only-grid-x hidden shrink-0 sm:inline-flex"
                  style={{ marginLeft: "calc((var(--sb-g) - 1) * 0.5rem)" }}
                  aria-hidden={!grid}
                >
                  <TierBadge tier={d.tier} />
                </span>
              )}
              {!d.isActive && <span className="pill bg-surface2 text-light">inactive</span>}
            </span>
            <TeamLogo
              id={d.team.id}
              name={d.team.name}
              color={d.team.color}
              logoUrl={d.team.logoUrl}
              size={16}
              showName
              nameClassName="truncate text-xs text-light sm:text-sm"
            />
            {d.formerName && (
              <span className="sb-only-grid block truncate font-mono text-[10px] uppercase tracking-wider text-faint" aria-hidden={!grid}>
                raced as {d.formerName}
              </span>
            )}
          </span>
        </Link>
      </div>

      {/* points bar, list only (md and up), with the gap after it */}
      <div className="sb-bar flex items-center" aria-hidden>
        <div className="w-full shrink-0 pr-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div className="bar-fill h-full rounded-full" style={{ "--w": `${pct}%`, backgroundColor: d.team.color }} />
          </div>
        </div>
      </div>

      {/* round view only: Discord name (lg and up), then a cell per round */}
      <div role={grid ? "cell" : undefined} className="sb-discord invisible flex items-center lg:visible" aria-hidden={!grid}>
        <span className="w-36 shrink-0 truncate pr-3 text-sm text-light">{d.discordName}</span>
      </div>
      <div className="sb-rounds flex items-stretch" aria-hidden={!grid}>
        {roundsOn &&
          raceNumbers.map((n) => (
            <RoundCell key={n} cell={d.perRace?.[n] ?? null} dropped={droppedSet.has(n)} grid={grid} />
          ))}
      </div>

      <div
        role={grid ? "cell" : undefined}
        className={`sb-pts sticky-cell flex flex-col items-end justify-center pr-3 text-right transition-[background-color,box-shadow] sm:pr-5 ${
          sticky ? `sticky right-0 z-10 ${rightShadow}` : ""
        }`}
      >
        <div className="relative font-mono text-lg font-bold tabular-nums text-dark sm:text-xl">
          <CountUp end={d.total} duration={900} />
          {/* A total the league set by hand says so in the round view, where
              the footnote explains it; otherwise the column simply disagrees
              with the cells beside it. Hung outside the number so the number
              does not shift when it fades in. */}
          {manual && (
            <sup
              className="absolute left-full top-0 ml-0.5 text-[10px] font-bold text-warn"
              style={{ opacity: "var(--sb-g)" }}
              aria-hidden={!grid}
              title={
                manual.override != null
                  ? "Total set by hand by the league"
                  : `${manual.adjust > 0 ? "+" : ""}${manual.adjust} points added by hand by the league`
              }
            >
              M
            </sup>
          )}
        </div>
        <div className="font-mono text-[11px] tabular-nums text-light">{standingCaption(d.position, gap, { lower: true })}</div>
      </div>
    </div>
  );
}

// `mode` — "list" or "grid". `rows` are the rows on show (filters and search
// applied, positions as they should read). `deltaById` — movement since the
// previous round per driver, empty when the arrows are off. `rowsRef` — the
// callback ref the page uses to run the position replay on the rows.
export default function DriverStandingsBoard({
  mode,
  rows,
  leaderTotal,
  raceNumbers,
  sprintRounds = [],
  fastestLapPoints = 0,
  customPoints = {},
  championOverride = null,
  manualPoints = false,
  dropWorst = 3,
  officialTotals = false,
  decided = false,
  multiTier = false,
  championIds,
  deltaById,
  rowsRef,
}) {
  const grid = mode === "grid";
  const sprintSet = new Set(sprintRounds || []);
  const customOf = (n) => customTableOf(customPoints, n);
  const deltaSlot = deltaById.size > 0;
  const [scrollRef, edge] = useScrollEdges();

  // The round cells are a thousand-odd elements nobody needs until the round
  // view is opened once. Mounted then (they open from zero width, so arriving
  // in the same render as the switch is invisible) and kept after.
  const [roundsOn, setRoundsOn] = useState(grid);
  if (grid && !roundsOn) setRoundsOn(true);

  // Which layout rules are in force: the frozen columns (round view) or the
  // row-wide link (list). Going TO the round view they change at once, since
  // the columns only start opening. Going back they wait for the board to
  // finish closing: a frozen column let go while the rounds are still
  // scrolled sideways would jump to where the scroll left it.
  const [settled, setSettled] = useState(mode);
  if (grid && settled !== "grid") setSettled("grid");
  useEffect(() => {
    if (mode === settled) return;
    const t = setTimeout(() => setSettled(mode), motionOff() ? 0 : MORPH_MS + 50);
    return () => clearTimeout(t);
  }, [mode, settled]);
  const sticky = settled === "grid";

  // Back to the list: the rounds fold away, so take the sideways scroll home
  // with them instead of leaving the browser to clamp it frame by frame.
  useEffect(() => {
    if (mode !== "list") return;
    const el = scrollRef.current;
    if (el && el.scrollLeft > 0) el.scrollTo({ left: 0, behavior: motionOff() ? "auto" : "smooth" });
  }, [mode, scrollRef]);

  // A different set of rows (tier, search, filters) keeps the board standing:
  // rows that stay glide from where they were to their new line, rows that are
  // new deal in through the cascade like on first load, and rows that left are
  // simply gone. Rebuilding the board for this flashed every row on screen,
  // even when the visible part of the table did not change at all.
  const lastTops = useRef(null);
  const boxRef = useRef(null);
  // The page's own ref is a callback (the replay starts from it); this one is
  // just for measuring. Both get the node.
  const setRowsBox = (el) => {
    boxRef.current = el;
    rowsRef?.(el);
  };
  const idsKey = rows.map((d) => d.driverId).join(",");
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const now = new Map();
    for (const el of box.children) if (el.dataset.driverId) now.set(el.dataset.driverId, el.offsetTop);
    const before = lastTops.current;
    lastTops.current = now;
    if (!before || motionOff()) return;
    const moved = [];
    for (const el of box.children) {
      const was = before.get(el.dataset.driverId);
      const dy = was == null ? 0 : was - now.get(el.dataset.driverId);
      if (!dy) continue;
      el.style.transition = "none";
      el.style.translate = `0 ${dy}px`;
      moved.push(el);
    }
    if (!moved.length) return;
    void box.offsetHeight; // commit the old spots before letting go
    for (const el of moved) {
      el.style.transition = "translate var(--t-base) var(--e-out)";
      el.style.translate = "";
      el.addEventListener("transitionend", () => { el.style.transition = ""; }, { once: true });
    }
    // Keyed on the row set only: the List / By round morph changes heights
    // on its own and must not be read as rows moving.
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const leftShadow = edge.start ? "shadow-[10px_0_12px_-10px_rgba(0,0,0,0.45)]" : "";
  const rightShadow = edge.end ? "shadow-[-10px_0_12px_-10px_rgba(0,0,0,0.45)]" : "";
  const headCell = "flex items-center";

  return (
    <div className="card overflow-hidden">
      {/* overscroll-x-none: without it, swiping past the first or last round
          rubber-bands the container and hands the leftover movement to the
          page, and the frozen columns ride along with the bounce.
          overflow-y-hidden: a sideways scroller cannot leave the other axis
          visible anyway (it would compute to auto), and auto flashed a
          vertical scrollbar while the bottom rows rose in. */}
      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden overscroll-x-none">
        <div
          className={`sboard ${deltaSlot ? "sboard-delta" : ""}`}
          data-mode={mode}
          style={{ "--sb-n": raceNumbers.length }}
          role={grid ? "table" : undefined}
          aria-label={grid ? "Points by round" : undefined}
        >
          {/* No sticky top row, deliberately: the sideways scroller is the
              containing block for `position: sticky`, so a header pinned to
              it scrolls away with the page all the same. */}
          <div className="sb-head" aria-hidden={!grid}>
            <div
              role={grid ? "row" : undefined}
              className="flex h-10 items-stretch border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-wider text-light"
            >
              <div role={grid ? "columnheader" : undefined} className={`sb-pos sticky-cell pl-3 sm:pl-5 ${headCell} ${sticky ? "sticky left-0 z-20" : ""}`}>
                Pos
              </div>
              <div
                role={grid ? "columnheader" : undefined}
                className={`sb-driver sticky-cell transition-shadow ${headCell} ${sticky ? `sticky z-20 ${leftShadow}` : ""}`}
                style={sticky ? { left: "var(--sb-pos)" } : undefined}
              >
                Driver
              </div>
              <div className="sb-bar" />
              <div role={grid ? "columnheader" : undefined} className={`sb-discord invisible lg:visible ${headCell}`}>
                <span className="w-36 shrink-0">Discord</span>
              </div>
              <div className="sb-rounds flex items-stretch">
                {roundsOn &&
                  raceNumbers.map((n) => (
                    <div
                      key={n}
                      role={grid ? "columnheader" : undefined}
                      className={`sb-cell justify-center tabular-nums ${headCell}`}
                      title={
                        [
                          sprintSet.has(n) ? "Sprint weekend: the feature race and the sprint both score, added together under this round" : null,
                          customOf(n) ? `Own points table for this round: ${customOf(n).join(", ")}` : null,
                        ].filter(Boolean).join(". ") || undefined
                      }
                    >
                      <span>
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
                      </span>
                    </div>
                  ))}
              </div>
              <div
                role={grid ? "columnheader" : undefined}
                className={`sb-pts sticky-cell justify-end pr-3 transition-shadow sm:pr-5 ${headCell} ${sticky ? `sticky right-0 z-20 ${rightShadow}` : ""}`}
              >
                Pts
              </div>
            </div>
          </div>

          {/* cascade: rows rise in one after another, top to bottom, the same
              entrance as a race result on the Races page. --i drives the
              stagger; the replay re-deals the movers by the slot they start in. */}
          <div ref={setRowsBox} role={grid ? "rowgroup" : undefined} className="sboard-rows cascade divide-y divide-border">
            {rows.map((d, i) => (
              <BoardRow
                key={d.driverId}
                d={d}
                index={Math.min(i, 16)}
                leaderTotal={leaderTotal}
                grid={grid}
                sticky={sticky}
                roundsOn={roundsOn}
                raceNumbers={raceNumbers}
                multiTier={multiTier}
                champion={championIds.has(d.driverId)}
                decided={decided}
                delta={deltaById.has(d.driverId) ? deltaById.get(d.driverId) : null}
                deltaSlot={deltaSlot}
                manual={manualOfRow(true, manualPoints, d)}
                leftShadow={leftShadow}
                rightShadow={rightShadow}
              />
            ))}
          </div>
        </div>
      </div>
      <div className={`sb-fold ${grid ? "is-open" : ""}`}>
        <div>
          <StandingsNotes
            variant="driver"
            raceNumbers={raceNumbers}
            rows={rows}
            dropWorst={dropWorst}
            officialTotals={officialTotals}
            sprintRounds={sprintRounds}
            fastestLapPoints={fastestLapPoints}
            customPoints={customPoints}
            championOverride={championOverride}
            manualPoints={manualPoints}
          />
        </div>
      </div>
    </div>
  );
}
