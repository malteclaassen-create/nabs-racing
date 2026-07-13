import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useLiveTiming } from "../hooks/useLiveTiming.js";
import { PageHeader, SectionHeading } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import LiveTrackMap from "../components/LiveTrackMap.jsx";
import TyreStrategy, { TyreBadge } from "../components/TyreStrategy.jsx";
import { circuitForLive } from "../data/circuits.js";
import {
  makeDriverMatcher,
  formatLap,
  formatGap,
  formatSector,
  formatCountdown,
  formatRunning,
  formatDelta,
  countryCodeFromName,
  tyreCompound,
  COMPOUND_ORDER,
} from "../data/liveTiming.js";

function prettyWeather(w) {
  if (!w) return null;
  return w.replace(/^\d+_/, "").replace(/_/g, " ");
}

// True on phone-width screens (<640px). Used to keep the long leaderboard to a
// single screenful on mobile, with a button to reveal the rest.
function useIsNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

function LiveBadge({ live }) {
  const color = live ? "#22c55e" : "#f59e0b";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider">
      <span className="relative flex h-2.5 w-2.5">
        {live && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      </span>
      <span style={{ color }}>{live ? "Live" : "Reconnecting"}</span>
    </span>
  );
}

// Live-ticking session countdown: re-syncs to the server value each board tick,
// then counts down locally between snapshots (which arrive only every ~30s).
function Countdown({ baseMs, receivedAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (baseMs == null) return <span className="font-mono tabular-nums text-dark">—</span>;
  const remaining = baseMs - (now - receivedAt);
  return <span className="font-mono tabular-nums text-dark">{formatCountdown(remaining)}</span>;
}

function Stat({ label, children }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">
        {label}
      </div>
      {children}
    </div>
  );
}

function SessionHeader({ session, receivedAt }) {
  const code = countryCodeFromName(session.country);
  const weather = prettyWeather(session.weather);
  // On phones the card compresses to the track + the two numbers that matter
  // during a session (best lap, time left); Drivers/Conditions tuck behind a
  // "More" toggle. From sm up everything is always shown.
  const [showMore, setShowMore] = useState(false);
  return (
    <div className="reveal card relative overflow-hidden">
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-amber-500 to-sky-600" />
      <div className="grid grid-cols-2 gap-4 p-4 sm:gap-5 sm:p-6 lg:grid-cols-6">
        <div className="col-span-2 lg:col-span-2">
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-eyebrow">
            <span>{session.type}</span>
            {session.sessionCount > 1 && (
              <span className="text-faint">
                {session.sessionIndex + 1}/{session.sessionCount}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2.5">
            {code && <Flag code={code} title={session.country} w={26} h={19} />}
            <span className="font-display text-xl font-extrabold uppercase tracking-tight text-dark">
              {session.trackName}
            </span>
          </div>
          {session.serverName && (
            <div className="mt-1 truncate text-xs text-light">{session.serverName}</div>
          )}
        </div>

        <Stat label="Session Best">
          <span className="font-mono text-xl font-bold tabular-nums text-dark sm:text-2xl">
            {formatLap(session.bestLapMs)}
          </span>
        </Stat>

        <Stat label="Time Left">
          <span className="text-xl font-bold sm:text-2xl">
            <Countdown baseMs={session.remainingMs} receivedAt={receivedAt} />
          </span>
        </Stat>

        {/* Secondary stats — hidden on phones until expanded, always shown from sm up. */}
        <div className={`${showMore ? "" : "hidden"} sm:block`}>
          <Stat label="Drivers">
            <span className="font-mono text-xl font-bold tabular-nums text-dark sm:text-2xl">
              {session.driverCount}
            </span>
            <span className="ml-2 font-mono text-xs text-light">{session.onTrackCount} on track</span>
          </Stat>
        </div>

        <div className={`${showMore ? "" : "hidden"} sm:block`}>
          <Stat label="Conditions">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              {session.ambientTemp != null && (
                <span className="text-medium">
                  Air <span className="font-mono font-bold text-dark">{session.ambientTemp}°</span>
                </span>
              )}
              {session.roadTemp != null && (
                <span className="text-medium">
                  Track <span className="font-mono font-bold text-dark">{session.roadTemp}°</span>
                </span>
              )}
              {weather && <span className="capitalize text-light">{weather}</span>}
            </div>
          </Stat>
        </div>
      </div>

      {/* Mobile-only expand toggle for the secondary stats. */}
      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2 sm:hidden"
        aria-expanded={showMore}
      >
        {showMore ? "Show less" : "Drivers & conditions"}
        <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${showMore ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

// One best-lap sector chip, coloured purple (overall best) / green (personal
// best) / amber (other), matching sim-racing timing convention.
function Sector({ s }) {
  if (!s) return <span className="inline-block w-[52px] text-center font-mono text-xs text-faint">—</span>;
  const cls = s.best
    ? "bg-violet-500/20 text-violet-500"
    : s.driversBest
    ? "bg-emerald-500/15 text-emerald-600"
    : "bg-amber-500/10 text-amber-600";
  return (
    <span className={`inline-block w-[52px] rounded text-center font-mono text-xs font-semibold tabular-nums ${cls}`}>
      {formatSector(s.ms)}
    </span>
  );
}

// Live-ticking current-lap clock for an on-track driver (now - lastLapAt).
function CurrentLap({ lastLapAt, inPits }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  if (inPits) return <span className="font-mono text-xs font-bold uppercase text-amber-600">In pit</span>;
  if (!lastLapAt) return <span className="font-mono tabular-nums text-light">—</span>;
  const ms = now - lastLapAt;
  if (ms < 0 || ms > 15 * 60 * 1000) return <span className="font-mono tabular-nums text-light">—</span>;
  return <span className="font-mono font-bold tabular-nums text-dark">{formatRunning(ms)}</span>;
}

// Guests aren't on the NABS roster, so their second line falls back to the AC
// car. Strip the mod pack's "F1 2007 - " style prefix so it reads like a car,
// not a filename ("F1 2007 - Honda RA107 SPEC2" → "Honda RA107 SPEC2").
function carLabel(carName) {
  if (!carName) return null;
  return carName.replace(/^f1\s*\d{4}\s*[-–—]\s*/i, "").trim() || null;
}

// Shared driver identity cell (team colour bar, flag, name, team).
function DriverCell({ e, match, showLiveDot }) {
  const name = match?.nabsName || e.name;
  const color = match?.teamColor || "var(--c-border)";
  return (
    <div className="flex items-center gap-3">
      <span className="relative flex h-8 w-1.5 shrink-0 items-center">
        <span className="h-full w-full rounded-full" style={{ backgroundColor: color }} />
        {showLiveDot && e.onTrack && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" title="On track" />
        )}
      </span>
      {match?.country ? (
        <Flag code={match.country} title={match.teamName} />
      ) : (
        <span className="h-[15px] w-5 shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block truncate font-display text-base font-bold uppercase tracking-tight text-dark" title={e.name}>
          {name}
        </span>
        <span className="block truncate text-xs text-light">{match?.teamName || carLabel(e.carName) || "—"}</span>
      </span>
      {e.raceNumber != null && (
        <span className="ml-1 hidden font-mono text-xs font-bold text-faint xl:inline">#{e.raceNumber}</span>
      )}
    </div>
  );
}

// A row in the "On Track Now" table — live current lap + delta to personal best.
function OnTrackRow({ e, match, index = 0 }) {
  const deltaCls = e.deltaSelfMs == null ? "text-light" : e.deltaSelfMs < 0 ? "text-emerald-600" : "text-amber-600";
  return (
    <tr style={{ "--i": Math.min(index, 16) }} className="border-b border-border last:border-0 transition hover:bg-surface2">
      <td className="py-3 pl-5 pr-2 text-center">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-base font-black tabular-nums text-medium">
          {e.position}
        </span>
      </td>
      <td className="py-3 pl-1 pr-3">
        <DriverCell e={e} match={match} />
      </td>
      <td className="hidden py-3 pr-4 text-center sm:table-cell">
        {e.tyre && <span className="pill bg-surface2 text-medium">{e.tyre}</span>}
      </td>
      <td className="py-3 pr-4 text-right text-base">
        <CurrentLap lastLapAt={e.lastLapAt} inPits={e.inPits} />
      </td>
      <td className="hidden py-3 pr-4 text-right sm:table-cell">
        <span className={`font-mono text-sm tabular-nums ${deltaCls}`}>{formatDelta(e.deltaSelfMs)}</span>
      </td>
      <td className="hidden py-3 pr-4 text-right md:table-cell">
        <span className="font-mono text-sm tabular-nums text-medium">{formatLap(e.lastLapMs)}</span>
      </td>
      <td className="py-3 pr-4 text-right">
        <span className="font-mono text-base font-bold tabular-nums text-dark">{formatLap(e.bestLapMs)}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center tabular-nums md:table-cell">
        <span className="font-mono text-sm text-medium">{e.lapCount}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center tabular-nums lg:table-cell">
        <span className="font-mono text-sm text-light">{e.numPits}</span>
      </td>
      <td className="hidden py-3 pr-4 text-right tabular-nums lg:table-cell">
        <span className="font-mono text-sm text-light">{e.ping ?? "—"}</span>
      </td>
      <td className="py-3 pr-5 text-right">
        <div className="flex justify-end gap-1.5">
          {e.drs && <span className="pill bg-sky-500/15 text-sky-600">DRS</span>}
          {e.inPits && <span className="pill bg-amber-500/15 text-amber-600">PIT</span>}
        </div>
      </td>
    </tr>
  );
}

const ONTRACK_COLS = [
  { label: "Pos", cls: "w-14 py-3 pl-5 text-center" },
  { label: "Driver", cls: "py-3 pl-1" },
  { label: "Tyre", cls: "hidden py-3 pr-4 text-center sm:table-cell" },
  { label: "Current", cls: "py-3 pr-4 text-right" },
  { label: "Δ PB", cls: "hidden py-3 pr-4 text-right sm:table-cell" },
  { label: "Last", cls: "hidden py-3 pr-4 text-right md:table-cell" },
  { label: "Best", cls: "py-3 pr-4 text-right" },
  { label: "Laps", cls: "hidden py-3 pr-4 text-center md:table-cell" },
  { label: "Pits", cls: "hidden py-3 pr-4 text-center lg:table-cell" },
  { label: "Ping", cls: "hidden py-3 pr-4 text-right lg:table-cell" },
  { label: "", cls: "py-3 pr-5" },
];

function Row({ e, match, index = 0 }) {
  const isP1 = e.position === 1;
  return (
    <tr
      style={{ "--i": Math.min(index, 16) }}
      className={`group border-b border-border last:border-0 transition hover:bg-surface2 ${
        isP1 ? "bg-brand/5" : ""
      }`}
    >
      <td className="py-3 pl-5 pr-2 text-center">
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-base font-black tabular-nums ${
            isP1 ? "bg-brand text-ink" : "text-medium"
          }`}
        >
          {e.position}
        </span>
      </td>
      <td className="py-3 pl-1 pr-3">
        <DriverCell e={e} match={match} showLiveDot />
      </td>
      {/* sectors */}
      <td className="hidden py-3 pr-4 lg:table-cell">
        <div className="flex gap-1">
          {e.sectors.map((s, i) => (
            <Sector key={i} s={s} />
          ))}
        </div>
      </td>
      <td className="py-3 pr-4 text-right">
        <span className={`font-mono text-base font-bold tabular-nums ${isP1 ? "text-eyebrow" : "text-dark"}`}>
          {formatLap(e.bestLapMs)}
        </span>
      </td>
      <td className="hidden py-3 pr-4 text-right md:table-cell">
        <span className="font-mono text-sm tabular-nums text-violet-500" title="Ideal lap (sum of best sectors)">
          {formatLap(e.potentialMs)}
        </span>
      </td>
      <td className="py-3 pr-4 text-right">
        <span className="font-mono text-sm tabular-nums text-light">{formatGap(e.gapToBestMs)}</span>
      </td>
      <td className="hidden py-3 pr-4 text-right sm:table-cell">
        <span className="font-mono text-sm tabular-nums text-medium">{formatLap(e.lastLapMs)}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center tabular-nums md:table-cell">
        <span className="font-mono text-sm text-medium">{e.lapCount}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center lg:table-cell">
        {e.tyre && <span className="pill bg-surface2 text-medium">{e.tyre}</span>}
      </td>
      <td className="hidden py-3 pr-4 text-right xl:table-cell">
        <span className="font-mono text-sm tabular-nums text-light">{e.topSpeed || "—"}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center tabular-nums xl:table-cell">
        <span className="font-mono text-sm text-light">{e.numPits}</span>
      </td>
      <td className="hidden py-3 pr-4 text-right xl:table-cell">
        <span className="font-mono text-sm tabular-nums text-light">{e.onTrack && e.ping != null ? e.ping : "—"}</span>
      </td>
      <td className="py-3 pr-5 text-right">
        <div className="flex justify-end gap-1.5">
          {e.drs && <span className="pill bg-sky-500/15 text-sky-600">DRS</span>}
          {e.inPits && <span className="pill bg-amber-500/15 text-amber-600">PIT</span>}
        </div>
      </td>
    </tr>
  );
}

/* ===== Championship projection ("if it ends like this") =================== */

// Position movement vs. the current table: green up-triangle, red down, quiet
// dot for no change.
function MoveArrow({ move }) {
  if (!move) return <span className="font-mono text-sm text-faint">·</span>;
  const up = move > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-xs font-bold tabular-nums ${
        up ? "text-emerald-600" : "text-red-500"
      }`}
      title={up ? `Up ${move} vs. current standings` : `Down ${-move} vs. current standings`}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
        {up ? <path d="M12 5l7 11H5z" /> : <path d="M12 19L5 8h14z" />}
      </svg>
      {Math.abs(move)}
    </span>
  );
}

// One tier's compact constructor projection card.
function TeamProjection({ title, rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
        {title}
      </div>
      <table className="w-full">
        <tbody>
          {rows.map((t) => (
            // a live projection is never a decided title: leader wash, not gold
            <tr key={t.teamId} className={`border-b border-border last:border-0 ${t.position === 1 ? "row-leader" : ""}`}>
              <td className="w-12 py-3 pl-5 text-center font-display text-base font-black tabular-nums text-medium">
                {t.position}
              </td>
              <td className="w-10 py-3 text-center">
                <MoveArrow move={t.move} />
              </td>
              <td className="py-3">
                <TeamLogo
                  id={t.teamId}
                  name={t.name}
                  color={t.color}
                  logoUrl={t.logoUrl}
                  size={22}
                  showName
                  nameClassName="truncate text-sm font-bold uppercase tracking-tight text-dark"
                />
              </td>
              <td className="py-3 pr-5 text-right">
                <span className="font-mono text-base font-bold tabular-nums text-dark">{t.total}</span>
                {t.gained > 0 && (
                  <span className="ml-2 font-mono text-xs font-bold tabular-nums text-emerald-600">+{t.gained}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The championship "as if the race ended right now": driver table with live
// race position and movement, plus the two constructor tiers. Data comes from
// /api/live/championship, which only activates during a league race (calendar
// cross-checked server-side) — this section simply isn't there otherwise.
function ChampionshipProjection({ data }) {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 12;
  // Keep the table to competitors who matter for the title picture: everyone
  // in the running race plus anyone who already has points on the board.
  const rows = data.drivers.filter((d) => d.livePosition != null || d.dnf || d.total > 0 || d.currentTotal > 0);
  const shown = showAll ? rows : rows.slice(0, LIMIT);
  return (
    <section className="reveal space-y-4">
      <SectionHeading
        eyebrow={`Round ${data.race.number} · ${data.race.track}`}
        title="Championship, If It Ends Like This"
        right={
          <span className="flex items-center gap-2">
            {data.simulated && <span className="pill bg-amber-500/15 text-amber-600">Demo</span>}
            <span className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-eyebrow">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
              </span>
              Projection
            </span>
          </span>
        }
      />
      <div className="card overflow-hidden">
        <div className="scrollbar-slim overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-light">
                <th className="w-14 py-3 pl-5 text-center">Pos</th>
                <th className="w-12 py-3 text-center"></th>
                <th className="py-3 pl-1">Driver</th>
                <th className="py-3 pr-4 text-center">Race</th>
                <th className="py-3 pr-5 text-right">Pts</th>
              </tr>
            </thead>
            <tbody className="cascade">
              {shown.map((d, i) => (
                <tr
                  key={d.driverId}
                  style={{ "--i": Math.min(i, 16) }}
                  className={`border-b border-border last:border-0 transition ${
                    d.position === 1 ? "row-leader" : "hover:bg-surface2"
                  }`}
                >
                  <td className="py-3 pl-5 pr-2 text-center">
                    <span
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-base font-black tabular-nums ${
                        d.position === 1 ? "bg-brand text-ink" : "text-medium"
                      }`}
                    >
                      {d.position}
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    <MoveArrow move={d.move} />
                  </td>
                  <td className="py-3 pl-1 pr-3">
                    <div className="flex items-center gap-3">
                      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: d.team.color }} />
                      {d.country ? <Flag code={d.country} /> : <span className="h-[15px] w-5 shrink-0" />}
                      <span className="min-w-0">
                        <span className="block truncate font-display text-base font-bold uppercase tracking-tight text-dark">
                          {d.name}
                        </span>
                        <span className="block truncate text-xs text-light">{d.team.name}</span>
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-center">
                    {d.livePosition != null ? (
                      <span className="pill bg-surface2 font-mono text-medium">P{d.livePosition}</span>
                    ) : d.dnf ? (
                      <span className="pill bg-red-500/10 font-mono text-red-500">DNF</span>
                    ) : (
                      <span className="font-mono text-xs text-faint">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-5 text-right">
                    <span className="font-mono text-base font-bold tabular-nums text-dark sm:text-lg">{d.total}</span>
                    {d.gained > 0 && (
                      <span className="ml-2 font-mono text-xs font-bold tabular-nums text-emerald-600">+{d.gained}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > LIMIT && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border py-3 font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2"
          >
            {showAll ? "Show top 12" : `Show all ${rows.length} drivers`}
            <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TeamProjection title={data.t2?.length ? "Constructors · Tier 1" : "Constructors"} rows={data.t1} />
        <TeamProjection title="Constructors · Tier 2" rows={data.t2} />
      </div>

      <p className="px-1 font-mono text-[11px] uppercase tracking-wider text-light">
        A projection, not a result: it assumes the race finishes in the current running order, with drop
        scores applied. Time penalties and stewarding are not included. The official tables update once the
        result is posted.
      </p>
    </section>
  );
}

const COLS = [
  { label: "Pos", cls: "w-14 py-3 pl-5 text-center" },
  { label: "Driver", cls: "py-3 pl-1" },
  { label: "Sectors", cls: "hidden py-3 pr-4 lg:table-cell" },
  { label: "Best", cls: "py-3 pr-4 text-right" },
  { label: "Potential", cls: "hidden py-3 pr-4 text-right md:table-cell" },
  { label: "Gap", cls: "py-3 pr-4 text-right" },
  { label: "Last", cls: "hidden py-3 pr-4 text-right sm:table-cell" },
  { label: "Laps", cls: "hidden py-3 pr-4 text-center md:table-cell" },
  { label: "Tyre", cls: "hidden py-3 pr-4 text-center lg:table-cell" },
  { label: "Top", cls: "hidden py-3 pr-4 text-right xl:table-cell" },
  { label: "Pits", cls: "hidden py-3 pr-4 text-center xl:table-cell" },
  { label: "Ping", cls: "hidden py-3 pr-4 text-right xl:table-cell" },
  { label: "", cls: "py-3 pr-5" },
];

/* ===== External links, view switch, track map ============================= */

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </svg>
  );
}

// The two admin-configured external buttons. "Full live timing" always shows
// (it has a sensible default); "Join in Content Manager" appears only once an
// admin has pasted the running server's CM deep link.
function ExternalButtons({ links }) {
  const timing = links?.liveTimingUrl;
  const join = links?.cmJoinUrl;
  if (!timing && !join) return null;
  return (
    <div className="mb-6 flex flex-wrap gap-2.5">
      {timing && (
        <a
          href={timing}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-dark transition hover:bg-surface2"
        >
          <ExternalIcon />
          Full live timing
        </a>
      )}
      {join && (
        <a
          href={join}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-ink shadow-lg shadow-brand/25 transition hover:brightness-105"
        >
          <ExternalIcon />
          Join in Content Manager
        </a>
      )}
    </div>
  );
}

// Segmented Timing / Strategy switch, matching the profile scope toggle.
function ViewSwitch({ view, setView }) {
  const btn = (key, label) => (
    <button
      type="button"
      onClick={() => setView(key)}
      className={`rounded-md px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
        view === key ? "bg-brand text-ink" : "text-light hover:text-dark"
      }`}
      aria-pressed={view === key}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
      {btn("timing", "Timing")}
      {btn("strategy", "Strategy")}
    </div>
  );
}

// Live track map card. Prefers the REAL overhead map with cars at their surveyed
// world positions (session.map calibration present); otherwise the stylised
// circuit outline with dots walked along the lap. Unknown circuits with no real
// map get a quiet, intentional fallback instead of a blank hole.
// Shares a row with the session card on lg+ (the map used to be its own
// full-width section, which was mostly empty margin), so the heading moved
// inside the card as a compact header strip.
function TrackMapSection({ session, entries, match, className = "" }) {
  const realMap = session.map || null;
  // Live sessions carry the mod's display name ("NABS Monza F1 2025") which the
  // tidy resolver can't place, so try the AC id (session.track) too.
  const stylised = circuitForLive(session.trackName, session.track);
  const hasMap = !!realMap || !!stylised;
  const cars = entries.filter((e) => e.onTrack || e.inPits);
  return (
    <section className={`reveal card flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Track map</span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-light">
          {cars.filter((c) => !c.inPits).length} on track
        </span>
      </div>
      <div className="p-3 sm:p-4">
        {hasMap ? (
          <>
            <LiveTrackMap
              track={session.trackName || session.track}
              cars={cars}
              matchFn={match}
              map={realMap}
              className={realMap ? "" : "mx-auto h-auto max-h-[440px] w-full text-medium"}
            />
            {/* The caveat only applies to the stylised outline; real map is exact. */}
            {!realMap && (
              <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-wider text-light">
                Car positions are approximate: dots follow each lap&rsquo;s progress, so the start line and
                direction may not match the real circuit.
              </p>
            )}
          </>
        ) : (
          <div className="py-12 text-center text-light">
            <p className="font-mono text-sm uppercase tracking-wider">No map for this circuit yet</p>
            <p className="mt-1 text-sm">{session.trackName || session.track || "Unknown track"}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// "Driving now" — the cars currently out on track, sat left of the map so the
// two share one row and read as a single "what's happening right now" block.
// The list scrolls INSIDE the card (capped height, sticky column header), so a
// packed server never turns the page into one endless table; the map column
// next door stays in proportion. Empty state (nobody out) keeps the panel
// instead of vanishing.
function DrivingNowSection({ onTrack, match, className = "" }) {
  return (
    <section className={`reveal card flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Driving now</span>
        {onTrack.length > 0 ? (
          <span className="inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {onTrack.length} live
          </span>
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-wider text-light">Nobody out</span>
        )}
      </div>
      {onTrack.length > 0 ? (
        // Phones: the list is simply capped and scrolls. lg+: the map + pit-lane
        // column next door sets the row height, and the absolutely-positioned
        // scroll area fills exactly that — the table's own length never drives
        // the page (that's what made it one endless column before).
        <div className="min-h-0 flex-1 lg:relative">
          <div className="scrollbar-slim max-h-[430px] overflow-auto lg:absolute lg:inset-0 lg:max-h-none">
            <table className="w-full min-w-[520px]">
            <thead>
              <tr className="text-left font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-light">
                {ONTRACK_COLS.map((c, i) => (
                  // sticky per-cell (sticky thead still doesn't scroll along in
                  // every browser); shadow stands in for the border, which
                  // wouldn't travel with the sticky cells either
                  <th key={i} className={`${c.cls} sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--c-border)]`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            {/* cascade: rows rise in one after another, like the standings tables */}
            <tbody className="cascade">
              {onTrack.map((e, i) => (
                <OnTrackRow key={e.guid} e={e} match={match(e.name)} index={i} />
              ))}
            </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-12 text-center">
          <p className="font-mono text-sm uppercase tracking-wider text-light">No cars out on track</p>
          <p className="text-sm text-light">Drivers show up here the moment they leave the pit lane.</p>
        </div>
      )}
    </section>
  );
}

// Sits under the track map and completes the picture: the map shows who's OUT,
// this lists who's currently sitting in the pit lane (the map's dimmed dots).
// flex-1 in the map column, so the pair always closes flush with the "driving
// now" card beside it.
function PitLaneSection({ entries, match, className = "" }) {
  const inPits = entries.filter((e) => e.onTrack && e.inPits);
  return (
    <section className={`reveal card flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Pit lane</span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-light">
          {inPits.length > 0 ? `${inPits.length} in the pits` : "Empty"}
        </span>
      </div>
      {inPits.length > 0 ? (
        <div className="scrollbar-slim max-h-[240px] flex-1 divide-y divide-border overflow-y-auto">
          {inPits.map((e) => {
            const m = match ? match(e.name) : null;
            const t = e.currentTyre ? tyreCompound(e.currentTyre) : null;
            return (
              <div key={e.guid} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: m?.teamColor || "var(--c-border)" }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-bold uppercase tracking-tight text-dark">
                    {m?.nabsName || e.name}
                  </span>
                  <span className="block truncate text-[11px] text-light">{m?.teamName || "—"}</span>
                </span>
                {t && (
                  <span
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[10px] font-black leading-none"
                    style={{
                      backgroundColor: t.color,
                      color: t.light ? "#111827" : "#fff",
                      boxShadow: t.light ? "inset 0 0 0 1px rgba(17,24,39,0.28)" : "none",
                    }}
                    title="Current compound"
                  >
                    {t.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-4 py-8 text-center">
          <p className="font-mono text-xs uppercase tracking-wider text-light">Pit lane is empty</p>
        </div>
      )}
    </section>
  );
}

// Compound colour key for the strategy view (built from the same mapping the
// bars use, so it never drifts out of sync). Lists only the compounds actually
// seen in THIS session — a server running supersoft/soft/medium shows exactly
// those three, softest first — so the key describes the graphic, not the rulebook.
function CompoundLegend({ entries }) {
  const seen = new Map();
  for (const e of entries || []) {
    const names = [e.currentTyre, ...(Array.isArray(e.stints) ? e.stints.map((s) => s.tyre) : [])];
    for (const n of names) {
      if (!n) continue;
      const t = tyreCompound(n);
      if (!seen.has(t.label)) seen.set(t.label, t);
    }
  }
  const items = [...seen.values()].sort((a, b) => {
    const ia = COMPOUND_ORDER.indexOf(a.label);
    const ib = COMPOUND_ORDER.indexOf(b.label);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  if (items.length === 0) return null;
  const anyPitted = (entries || []).some((e) => Array.isArray(e.stints) && e.stints.length > 0);
  return (
    <div className="reveal flex flex-wrap items-center gap-x-4 gap-y-2 px-1 font-mono text-[11px] uppercase tracking-wider text-light">
      {items.map((t) => (
        <span key={t.label} className="flex items-center gap-1.5">
          <TyreBadge t={t} size={16} />
          {t.name}
        </span>
      ))}
      {anyPitted && (
        <span className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm ring-1 ring-black/10 dark:ring-white/10"
            style={{ background: "repeating-linear-gradient(135deg, var(--c-surface2) 0 3px, var(--c-border) 3px 5px)" }}
          />
          In the pits
        </span>
      )}
    </div>
  );
}

export default function Live() {
  const { board, socketState } = useLiveTiming();
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const match = useMemo(() => makeDriverMatcher(teams), [teams]);
  // Admin-configured external buttons (server-manager live timing + CM join).
  const { data: extLinks } = useApi(useCallback(() => api.liveLinks(), []));
  // Timing ⇄ Strategy switch (the track map sits above both).
  const [view, setView] = useState("timing");

  const connected = board?.connected && !board?.stale && socketState === "open";
  const session = board?.session;
  const entries = board?.entries || [];
  const onTrack = entries.filter((e) => e.onTrack);
  const receivedAt = useMemo(() => Date.now(), [board?.updatedAt]);

  // Championship projection: polled (the standings only move when the race
  // order does, so ~20s is plenty). { active: false } or any error hides the
  // section entirely. `?demo=1` asks the backend for the admin-only simulation.
  const [champ, setChamp] = useState(null);
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).has("demo");
    let alive = true;
    const load = () =>
      api
        .liveChampionship(demo)
        .then((d) => alive && setChamp(d))
        .catch(() => alive && setChamp(null));
    load();
    const t = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Mobile: keep the classification to a single screenful, expandable on tap.
  const narrow = useIsNarrow();
  const [showAllTimes, setShowAllTimes] = useState(false);
  const TIMES_LIMIT = 10;
  const collapseTimes = narrow && !showAllTimes && entries.length > TIMES_LIMIT;
  const shownEntries = collapseTimes ? entries.slice(0, TIMES_LIMIT) : entries;

  return (
    <div>
      <PageHeader
        eyebrow="Real-time"
        title="Live Timing"
        right={
          <span className="flex items-center gap-2">
            {board?.demo && <span className="pill bg-amber-500/15 text-amber-600">Demo</span>}
            <LiveBadge live={connected} />
          </span>
        }
      />

      {/* External buttons (server-manager live timing + Content Manager join). */}
      <ExternalButtons links={extLinks} />

      {!session ? (
        <div className="card flex flex-col items-center justify-center gap-3 py-20 text-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand" />
          <p className="font-mono text-sm uppercase tracking-wider text-light">
            {socketState === "open" ? "Waiting for the server…" : "Connecting to the server…"}
          </p>
        </div>
      ) : (
        <div className="content-in space-y-8">
          {/* ===== Session bar across the top ===== */}
          <SessionHeader session={session} receivedAt={receivedAt} />

          {/* ===== Driving now (left, wider) beside the track map + pit lane
                 (right, narrower): one "right now" block. The map column is
                 first in the DOM so it leads on phones; explicit column starts
                 put it right on lg, and the pit-lane card stretches so both
                 columns close flush. ===== */}
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-5 lg:items-stretch">
            <div className="flex flex-col gap-4 sm:gap-6 lg:col-span-2 lg:col-start-4 lg:row-start-1">
              <TrackMapSection session={session} entries={entries} match={match} />
              <PitLaneSection entries={entries} match={match} className="flex-1" />
            </div>
            <DrivingNowSection
              onTrack={onTrack}
              match={match}
              className="lg:col-span-3 lg:col-start-1 lg:row-start-1"
            />
          </div>

          {/* ===== Championship projection (league race days only) ===== */}
          {champ?.active && <ChampionshipProjection data={champ} />}

          {/* ===== Timing / Strategy switch ===== */}
          <div className="reveal flex items-center justify-between gap-4">
            <span className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-eyebrow">
              Session view
            </span>
            <ViewSwitch view={view} setView={setView} />
          </div>

          {view === "strategy" ? (
            <section className="reveal space-y-4">
              <SectionHeading eyebrow="Tyres" title="Strategy" />
              <TyreStrategy entries={entries} matchFn={match} raceLaps={session.raceLaps} />
              <CompoundLegend entries={entries} />
            </section>
          ) : (
          <>
          {/* ===== Full session-best leaderboard (all drivers) ===== */}
          <section className="reveal space-y-4">
            <SectionHeading eyebrow="Classification" title="Session Best Times" />
            {entries.length === 0 ? (
              <div className="card py-16 text-center text-light">
                Session is live, no times set yet.
              </div>
            ) : (
              <div className="card overflow-hidden">
                <div className="scrollbar-slim overflow-x-auto">
                  <table className="w-full min-w-[680px]">
                    <thead>
                      <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-light">
                        {COLS.map((c, i) => (
                          <th key={i} className={c.cls}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    {/* cascade: rows rise in one after another, like the standings tables */}
                    <tbody className="cascade">
                      {shownEntries.map((e, i) => (
                        <Row key={e.guid} e={e} match={match(e.name)} index={i} />
                      ))}
                    </tbody>
                  </table>
                </div>
                {collapseTimes && (
                  <button
                    type="button"
                    onClick={() => setShowAllTimes(true)}
                    className="flex w-full items-center justify-center gap-1.5 border-t border-border py-3 font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2 sm:hidden"
                  >
                    Show all {entries.length} drivers
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </section>

          {/* legend */}
          <div className="reveal flex flex-wrap items-center gap-4 px-1 font-mono text-[11px] uppercase tracking-wider text-light">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-violet-500/40" /> Fastest sector
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-emerald-500/30" /> Personal best
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> On track now
            </span>
            <span className="text-faint">Potential = sum of best sectors</span>
          </div>
          </>
          )}

          {!connected && (
            <p className="text-center font-mono text-xs uppercase tracking-wider text-amber-600">
              Connection lost. Showing last known data, reconnecting…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
