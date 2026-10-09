import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { StatusPill, Rank, TierBadge, SafetyCarBadge, NoData } from "./ui.jsx";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import { TyreBadge } from "./TyreStrategy.jsx";
import { tyreCompound } from "../data/liveTiming.js";
import { countryFor } from "../data/driverCountries.js";
import { fmtDuration, fmtGap } from "../utils/raceDuration.js";
import { fmtLap, isLapTime } from "../utils/format.js";

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
const isLap = isLapTime;

// milliseconds -> "1:20.027"

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
                      {r.role === "safety" && <SafetyCarBadge compact />}
                      {pole && (
                        <span className="pill bg-purple-500/15 text-fl" title="Pole position">
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
                      <NoData className="font-mono" />
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
                            isBest ? "font-bold text-fl" : "text-light"
                          }`}
                          title={isBest ? "Fastest sector of the session" : undefined}
                        >
                          {fmtSector(v) || <NoData />}
                        </td>
                      );
                    })}
                  <td
                    className={`hidden px-3 py-3.5 text-right font-mono text-sm tabular-nums md:table-cell ${
                      pole ? "font-bold text-fl" : "text-medium"
                    }`}
                  >
                    {fmtLap(r.bestLapMs) || <NoData label="no lap set" />}
                  </td>
                  <td className="hidden px-3 py-3.5 text-right font-mono text-sm tabular-nums text-medium md:table-cell">
                    {r.gapMs != null ? fmtGap(r.gapMs) : <NoData />}
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

// The race in one thin strip: every stint a segment as long as its laps, in
// its compound's colour, with a hair of gap where the car pitted. The strip is
// scaled to the longest race in the field, so a retirement or a lapped car
// visibly runs short. Medium (and any other near-white compound) gets a faint
// outline, or it would vanish into a light card.
function StintBar({ stints, totalLaps }) {
  const driven = stints.reduce((s, x) => s + (x.laps || 0), 0);
  const rest = Math.max(0, (totalLaps || driven) - driven);
  return (
    <span className="flex h-1.5 w-full max-w-[13rem] gap-[2px] overflow-hidden rounded-full bg-surface2">
      {stints.map((s, idx) => {
        const t = tyreCompound(s.tyre);
        return (
          <span
            key={idx}
            className="h-full"
            style={{
              flex: `${Math.max(1, s.laps || 0)} 1 0`,
              backgroundColor: t.color,
              boxShadow: t.light ? "inset 0 0 0 1px rgba(10,15,30,0.25)" : undefined,
            }}
          />
        );
      })}
      {rest > 0 && <span className="h-full" style={{ flex: `${rest} 1 0` }} />}
    </span>
  );
}

// The race result on a phone: one row per car instead of a table squeezed to
// three columns. Position, team colour, then the driver with their flag and
// marks, a mono line with team · tier · grid (and places won or lost), and the
// tyre strip; on the right the gap (or the winner's race time) over the best
// lap, and the points. Tapping the strip folds out the stints with lap counts.
function MobileClassification({ race, results, scores, detailed, hasTimes, timeCell, isFin, fastestDriverId, dotdId, openStints, toggleStints }) {
  const eyebrow = race.parentRaceId ? "Sprint" : race.type === "TRAINING" ? "Training" : race.type === "SPECIAL" ? "Special event" : "Race";
  const anyPenalty = results.some((r) => r.penaltySeconds > 0);
  // The length the tyre strips are scaled to: the most laps anyone drove.
  const totalLaps = Math.max(
    0,
    ...results.map((r) => r.laps || (Array.isArray(r.stints) ? r.stints.reduce((s, x) => s + (x.laps || 0), 0) : 0))
  );
  return (
    <div className="card overflow-hidden md:hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4">
        <div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">{eyebrow}</div>
          <h3 className="mt-0.5 font-display text-lg font-extrabold uppercase leading-tight tracking-tight text-dark">
            Full classification
          </h3>
        </div>
        {anyPenalty && hasTimes && (
          <p className="max-w-[9.5rem] pt-1 text-right font-mono text-[11px] leading-snug text-light">
            Gaps include time penalties
          </p>
        )}
      </div>
      <ol className="cascade">
        {results.map((r, i) => {
          const tier = r.tier ?? r.team?.tier;
          const team = r.effectiveTeam || r.team;
          const finished = isFin(r);
          const classified = r.position != null && finished;
          const winner = detailed && classified && r.position === 1;
          const isFastest = r.driverId === fastestDriverId;
          const gridDelta = r.grid != null && classified ? r.grid - r.position : null;
          const hasStints = Array.isArray(r.stints) && r.stints.length > 0;
          const stintsOpen = hasStints && openStints.has(r.driverId);
          const time = detailed && hasTimes ? timeCell(r) : null;
          const lap = isLap(r.bestLapMs) ? fmtLap(r.bestLapMs) : null;
          const tierLabel = tier === 1 ? "T1" : tier === 2 ? "T2" : tier != null ? "RES" : null;
          return (
            <li
              key={r.driverId}
              style={{ "--i": Math.min(i, 16) }}
              className={`${i === results.length - 1 ? "" : "border-b border-border"} ${winner ? "bg-brand/10" : ""}`}
            >
              <div className="flex items-center gap-2.5 px-3.5 py-3.5">
                {detailed && (
                  <span className="shrink-0">
                    {!classified ? (
                      <span className="inline-flex h-8 w-8 items-center justify-center">
                        <NoData className="font-mono" />
                      </span>
                    ) : r.position <= 3 ? (
                      <Rank position={r.position} />
                    ) : (
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-brand/10 font-display text-sm font-black tabular-nums text-dark">
                        {r.position}
                      </span>
                    )}
                  </span>
                )}
                <span
                  className="w-1 shrink-0 self-stretch rounded-full"
                  style={{ backgroundColor: team?.color || "var(--c-border)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <Flag code={countryFor(r.driverId, r.country)} />
                      <Link
                        to={`/drivers/${r.driverId}`}
                        className="truncate font-display text-base font-bold uppercase tracking-tight text-dark"
                        title={r.formerName ? `Raced as ${r.formerName}` : undefined}
                      >
                        {r.name}
                      </Link>
                    </span>
                    {isFastest && (
                      <span className="pill bg-purple-500/15 text-fl" title="Fastest lap of the race">
                        FL{r.fastestLap > 0 ? ` +${r.fastestLap}` : ""}
                      </span>
                    )}
                    {r.driverId === dotdId && (
                      <span className="pill bg-brand/20 text-eyebrow" title="Driver of the Day">
                        DOTD
                      </span>
                    )}
                    {r.role === "safety" && <SafetyCarBadge compact />}
                    {r.penaltySeconds > 0 && (
                      <span className="pill bg-warn/15 normal-case text-warn" title="Time penalty applied">
                        +{r.penaltySeconds}s
                      </span>
                    )}
                  </div>
                  {/* the team name gives way first, so tier, grid and the
                      places won or lost always stay readable */}
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap font-mono text-xs text-light">
                    <span className="min-w-0 truncate">
                      {team?.name}
                      {r.isSub && r.subForTeam ? " (sub)" : ""}
                    </span>
                    {(tierLabel || (detailed && r.grid != null)) && (
                      <span className="shrink-0">
                        {tierLabel ? `· ${tierLabel}` : ""}
                        {detailed && r.grid != null ? ` · P${r.grid}` : ""}
                      </span>
                    )}
                    {gridDelta != null && gridDelta !== 0 && (
                      <span className={`shrink-0 font-bold ${gridDelta > 0 ? "text-ok" : "text-bad"}`}>
                        {gridDelta > 0 ? `▲${gridDelta}` : `▼${-gridDelta}`}
                      </span>
                    )}
                  </div>
                  {hasStints && (
                    <button
                      type="button"
                      onClick={() => toggleStints(r.driverId)}
                      aria-expanded={stintsOpen}
                      aria-label={`${stintsOpen ? "Hide" : "Show"} tyre strategy of ${r.name}`}
                      className="-my-1.5 flex w-full items-center py-1.5"
                    >
                      <StintBar stints={r.stints} totalLaps={totalLaps} />
                    </button>
                  )}
                </div>
                {(time || lap) && (
                  <div className="shrink-0 text-right font-mono tabular-nums leading-tight">
                    {time && <div className={`text-sm ${winner ? "font-bold text-dark" : "text-dark"}`}>{time}</div>}
                    {lap && (
                      <div className={`text-xs ${time ? "mt-1" : ""} ${isFastest ? "font-bold text-fl" : "text-light"}`}>{lap}</div>
                    )}
                  </div>
                )}
                <div className="w-9 shrink-0 text-right">
                  {r.status && r.status !== "FINISHED" ? (
                    <StatusPill status={r.status} />
                  ) : scores ? (
                    <span className="font-mono text-xl font-bold tabular-nums text-dark">{r.points}</span>
                  ) : null}
                </div>
              </div>
              {hasStints && (
                <div className={`grid transition-[grid-template-rows] duration-base ease-out-soft ${stintsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-surface2/40 px-4 py-3">
                      {r.stints.map((s, idx) => (
                        <span key={idx} className="flex items-center gap-1.5">
                          <TyreBadge t={tyreCompound(s.tyre)} size={20} />
                          <span className="font-mono text-xs tabular-nums text-medium">
                            {s.laps} {s.laps === 1 ? "lap" : "laps"}
                          </span>
                        </span>
                      ))}
                      <span className="font-mono text-[11px] uppercase tracking-wider text-light">
                        · {r.stints.length - 1} {r.stints.length - 1 === 1 ? "stop" : "stops"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// `session` ("race" | "quali") is owned by the caller — the switcher lives in
// the round header row on the Races page, not inside this component.
export default function RaceResults({ race, results, quali = null, session = "race" }) {
  const detailed = race.hasPositions;
  // Training sessions and special events are run for fun and score nothing, but
  // they open in this same table and it printed a full 35/30/25 points column
  // plus the Tier-2 constructor column for them — numbers that look official and
  // are not in any standing. The importer still stores them, so the fix is to
  // stop showing what does not count. The API says what counts (`scores`): a
  // championship round, and the sprint of one — the sprint row is typed like a
  // special event so nothing counts it as a round of its own, yet it pays the
  // same points as the feature race under that weekend's round.
  const scores = race.scores ?? (race.type || "CHAMPIONSHIP") === "CHAMPIONSHIP";
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

  // Whether anyone in this classification is one of the league's safety car
  // drivers — the legend only explains a mark the table actually shows.
  const hasSafetyCar = results.some((r) => r.role === "safety");
  const lapRows = results.filter((r) => isLap(r.bestLapMs));
  const hasLaps = lapRows.length > 0;
  const hasGrid = results.some((r) => r.grid != null);
  const fastestMs = hasLaps ? Math.min(...lapRows.map((r) => r.bestLapMs)) : null;
  // The admin-recorded holder (archive rounds without lap data) wins over the
  // derivation from stored lap times, so the FL pill can show without a time.
  const fastestDriverId =
    race.fastestLapDriverId ||
    (hasLaps ? lapRows.find((r) => r.bestLapMs === fastestMs)?.driverId : null);
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
    <>
    <MobileClassification
      race={race}
      results={results}
      scores={scores}
      detailed={detailed}
      hasTimes={hasTimes}
      timeCell={timeCell}
      isFin={isFin}
      fastestDriverId={fastestDriverId}
      dotdId={dotdId}
      openStints={openStints}
      toggleStints={toggleStints}
    />
    {/* From md up the full table; phones get the row list above. */}
    <div className="card hidden overflow-hidden md:block">
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
              {detailed && scores && (
                <th className="hidden px-3 py-3 text-center lg:table-cell">
                  <span className="inline-flex items-center">
                    Tier 2
                    <Help text="Tier-2 constructor scoring: Tier-1 drivers are removed, the rest of the field is re-ranked, and points are awarded by that new position. Shows the driver's Tier-2 position and the points it gave their constructor. Tier-1 drivers don't score here." />
                  </span>
                </th>
              )}
              {/* The column stays even when nothing scores: it is also where a
                  DNF or DSQ is shown, and a retirement is just as real in a
                  training session. Only the points number goes. */}
              <th className="px-4 py-3 text-right">{scores ? "Pts" : ""}</th>
            </tr>
          </thead>
          {/* cascade: rows rise in one after another, like the standings tables */}
          <tbody className="cascade">
            {results.map((r, i) => {
              const tier = r.tier ?? r.team?.tier;
              const isFastest = r.driverId === fastestDriverId;
              const gridDelta = r.grid != null && r.position != null && isFin(r) ? r.grid - r.position : null;
              const hasStints = Array.isArray(r.stints) && r.stints.length > 0;
              const stintsOpen = hasStints && openStints.has(r.driverId);
              // Total column count for the expander row's colSpan.
              const colCount =
                2 + // driver + the points/status column
                1 + // team (sm+)
                (detailed ? 1 : 0) +
                (detailed && hasGrid ? 1 : 0) +
                (detailed && hasTimes ? 1 : 0) +
                (detailed && hasLaps ? 1 : 0) +
                (detailed && scores ? 1 : 0); // the Tier-2 column
              return (
                <Fragment key={r.driverId}>
                <tr
                  style={{ "--i": Math.min(i, 16) }}
                  onClick={hasStints ? () => toggleStints(r.driverId) : undefined}
                  title={hasStints ? "Show tyre strategy" : undefined}
                  // the drawer row after it means last: never matches any more
                  className={`transition hover:bg-surface2 ${i % 2 ? "" : "bg-surface2/30"} ${
                    i === results.length - 1 ? "" : "border-b border-border"
                  } ${hasStints ? "cursor-pointer" : ""}`}
                >
                  {detailed && (
                    <td className="px-3 py-3.5 text-center">
                      {/* DNF/DSQ hold no classified place (the table has no gaps),
                          so their old raw number (19, 21 after P32) stays out. */}
                      {r.position != null && isFin(r) ? (
                        <Rank position={r.position} />
                      ) : (
                        <NoData className="font-mono" />
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
                                gridDelta > 0 ? "text-ok" : "text-bad"
                              }`}
                            >
                              {gridDelta > 0 ? `▲${gridDelta}` : `▼${-gridDelta}`}
                            </span>
                          )}
                        </span>
                      ) : (
                        <NoData className="font-mono" />
                      )}
                    </td>
                  )}

                  <td className="px-3 py-3.5">
                    {/* The chevron sits outside the wrapping row, or on a phone it
                        wrapped onto a line of its own under the name. */}
                    <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
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
                      {r.role === "safety" && <SafetyCarBadge compact />}
                      {r.driverId === dotdId && (
                        <span className="pill bg-brand/20 text-brand" title="Driver of the Day">
                          DOTD
                        </span>
                      )}
                      {isFastest && (
                        <span
                          className="pill bg-purple-500/15 text-fl"
                          title={
                            r.fastestLap > 0
                              ? `Fastest lap of the race: +${r.fastestLap} bonus point${r.fastestLap === 1 ? "" : "s"}`
                              : race.fastestLapPoints > 0
                                ? "Fastest lap of the race (no bonus: did not finish, or an official result)"
                                : "Fastest lap of the race"
                          }
                        >
                          FL{r.fastestLap > 0 ? ` +${r.fastestLap}` : ""}
                        </span>
                      )}
                      {r.isSub && r.subForTeam && (
                        <span className="pill bg-warn/15 text-warn">sub · {r.subForTeam.name}</span>
                      )}
                      {r.penaltySeconds > 0 && (
                        <span className="pill bg-red-500/15 text-bad" title="Time penalty applied">
                          +{r.penaltySeconds}s pen
                        </span>
                      )}
                    </div>
                    {/* phones: race time as a sub-line, since the Time column
                        doesn't fit next to the points there */}
                    {detailed && hasTimes && timeCell(r) && (
                      <div className="mt-1 pl-4 font-mono text-xs tabular-nums text-light md:hidden">
                        {timeCell(r)}
                      </div>
                    )}
                    </div>
                    {hasStints && (
                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 text-light transition-transform ${stintsOpen ? "rotate-90" : ""}`}
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                    )}
                    </div>
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
                      {timeCell(r) || <NoData />}
                    </td>
                  )}

                  {detailed && hasLaps && (
                    <td
                      className={`hidden px-3 py-3.5 text-right font-mono text-sm tabular-nums md:table-cell ${
                        isFastest ? "font-bold text-fl" : "text-medium"
                      }`}
                    >
                      {fmtLap(r.bestLapMs) || <NoData label="no lap set" />}
                    </td>
                  )}

                  {detailed && scores && (
                    <td className="hidden px-3 py-3.5 text-center lg:table-cell">
                      {r.t2 ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="pill bg-link/10 text-link">P{r.t2.rank}</span>
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
                        <NoData className="font-mono" />
                      )}
                    </td>
                  )}

                  <td className="px-4 py-3.5 text-right">
                    {r.status && r.status !== "FINISHED" ? (
                      <StatusPill status={r.status} />
                    ) : scores ? (
                      <span className="font-mono text-lg font-bold tabular-nums text-dark">{r.points}</span>
                    ) : null}
                  </td>
                </tr>
                {/* Always there, folded to zero height when closed, so opening it
                    slides down instead of popping in. w-0 min-w-full keeps the
                    strip out of the table's width sums: sized normally, a long
                    strategy widened its column and shoved the driver column
                    narrower, which wrapped badges in rows further up. */}
                {hasStints && (
                  <tr aria-hidden={!stintsOpen}>
                    <td colSpan={colCount} className="p-0">
                      <div className={`stint-drawer grid w-0 min-w-full transition-[grid-template-rows] duration-base ease-out-soft ${stintsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                      <div className="min-h-0 overflow-hidden">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface2/40 px-4 py-3 sm:pl-8">
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
                      </div>
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
          {Array.isArray(race.pointsTable) && race.pointsTable.length > 0 && (
            <span className="flex items-center gap-1.5" title={`Points per position for this round: ${race.pointsTable.join(", ")}`}>
              <span className="pill bg-warn/15 text-warn">*</span> Own points table for this round
            </span>
          )}
          {fastestDriverId && (
            <span className="flex items-center gap-1.5">
              <span className="pill bg-purple-500/15 text-fl">FL</span> Fastest lap
            </span>
          )}
          {hasSafetyCar && (
            <span className="flex items-center gap-1.5">
              <SafetyCarBadge compact /> Safety car driver
            </span>
          )}
          <span>
            <span className="font-semibold text-medium">Tier 2 column</span> = re-ranked position once Tier-1
            drivers are removed → constructor points.
          </span>
        </div>
      )}
    </div>
    </>
  );
}
