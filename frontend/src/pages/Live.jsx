import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useLiveTiming } from "../hooks/useLiveTiming.js";
import { PageHeader, SectionHeading } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import LiveTrackMap from "../components/LiveTrackMap.jsx";
import TyreStrategy, { TyreBadge } from "../components/TyreStrategy.jsx";
import { circuitForLive } from "../data/circuits.js";
import { countryFor } from "../data/driverCountries.js";
import { SocialIcon, useSocial } from "../components/SocialLinks.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
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

// Live-ticking session countdown. Counts down locally every second; server
// snapshots only arrive every ~30s and their remaining-time can lag behind the
// clock, so blindly re-syncing on each snapshot made the display jump BACK up
// and oscillate in ~30s steps. Instead the projected end time is a monotonic
// anchor: a new snapshot only moves it EARLIER (we were too optimistic), or
// later by a big margin (>60s — the session was extended or is a new one).
// `resetKey` (session identity) drops the anchor entirely on a session change.
function Countdown({ baseMs, receivedAt, resetKey }) {
  const [now, setNow] = useState(Date.now());
  const endRef = useRef(null);
  const keyRef = useRef(resetKey);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (baseMs == null) {
    endRef.current = null;
    return <span className="font-mono tabular-nums text-dark">—</span>;
  }
  const candidate = receivedAt + baseMs; // this snapshot's projected end time
  if (keyRef.current !== resetKey || endRef.current == null) {
    keyRef.current = resetKey;
    endRef.current = candidate;
  } else if (candidate < endRef.current || candidate - endRef.current > 60_000) {
    endRef.current = candidate;
  }
  const remaining = endRef.current - now;
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
  // On phones the card is just the session type, the track and the server —
  // every number (best lap, time left, drivers, conditions) waits behind the
  // toggle, so the timing itself starts near the top of the screen. The
  // .collapse-row wrapper animates the reveal and turns into `display:
  // contents` from sm up, where the stats are simply part of the card's grid.
  const [showMore, setShowMore] = useState(false);
  // The panel's open height, measured from the content so the close animation
  // starts moving immediately instead of idling through a too-generous cap.
  // Measured fresh on every toggle: a mount-time measurement reads 0 when the
  // page loads at desktop width (the wrappers are `display: contents` there,
  // no box to measure) and then sticks, leaving the panel unable to open after
  // shrinking the window to phone width. The ResizeObserver keeps it honest
  // while the panel is open and its content reflows (the ticking countdown).
  const innerRef = useRef(null);
  const [panelH, setPanelH] = useState(0);
  const measure = () => {
    const el = innerRef.current;
    // scrollHeight is the content's natural height even while the clipped
    // wrapper around it is 0px tall; 0 only in the display:contents layouts,
    // where the toggle isn't rendered anyway.
    if (el) setPanelH(el.scrollHeight);
  };
  const toggleMore = () => {
    measure();
    setShowMore((v) => !v);
  };
  useLayoutEffect(() => {
    measure();
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="reveal card relative overflow-hidden">
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-amber-500 to-sky-600" />
      <div className="grid grid-cols-1 gap-4 px-4 py-3.5 sm:grid-cols-2 sm:gap-5 sm:p-6 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow sm:text-xs">
            <span>{session.type}</span>
            {session.sessionCount > 1 && (
              <span className="text-faint">
                {session.sessionIndex + 1}/{session.sessionCount}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2.5 sm:mt-2">
            {code && <Flag code={code} title={session.country} w={26} h={19} />}
            <span className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">
              {session.trackName}
            </span>
          </div>
          {session.serverName && (
            <div className="mt-1 truncate text-xs text-light">{session.serverName}</div>
          )}
        </div>

        <div className="collapse-row" style={{ height: showMore ? panelH : 0 }}>
          <div ref={innerRef} className="collapse-inner">
            {/* This grid only exists on phones — from sm up it dissolves too
                (sm:contents, like the collapse wrappers around it), so the four
                stats become grid items of the card itself and spread across
                its columns exactly as before the collapse existed. */}
            <div className="grid grid-cols-2 gap-4 pt-4 sm:contents">
              <Stat label="Session Best">
                <span className="font-mono text-xl font-bold tabular-nums text-dark sm:text-2xl">
                  {formatLap(session.bestLapMs)}
                </span>
              </Stat>

              <Stat label="Time Left">
                <span className="text-xl font-bold sm:text-2xl">
                  <Countdown
                    baseMs={session.remainingMs}
                    receivedAt={receivedAt}
                    resetKey={`${session.type}|${session.sessionIndex}|${session.trackName}`}
                  />
                </span>
              </Stat>

              <Stat label="Drivers">
                <span className="font-mono text-xl font-bold tabular-nums text-dark sm:text-2xl">
                  {session.driverCount}
                </span>
                <span className="ml-2 font-mono text-xs text-light">{session.onTrackCount} on track</span>
              </Stat>

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
        </div>
      </div>

      {/* Mobile-only expand toggle. */}
      <button
        type="button"
        onClick={toggleMore}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:bg-surface2 sm:hidden"
        aria-expanded={showMore}
      >
        {showMore ? "Show less" : "Session details"}
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
// `mobileBadges`: on phones the DRS/PIT badges have no column of their own, so
// they ride along with the driver's name (see COLS).
function DriverCell({ e, match, showLiveDot, mobileBadges = false }) {
  const name = match?.nabsName || e.name;
  const color = match?.teamColor || "var(--c-border)";
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <span className="relative flex h-8 w-1.5 shrink-0 items-center">
        <span className="h-full w-full rounded-full" style={{ backgroundColor: color }} />
        {showLiveDot && e.onTrack && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" title="On track" />
        )}
      </span>
      {/* From sm up the flag keeps its own slot ahead of the name, so the names
          line up in a column. On phones that slot is dead width, so the flag
          moves behind the name at a smaller size and the name starts flush. */}
      <span className="hidden sm:block">
        {match?.country ? (
          <Flag code={match.country} title={match.teamName} />
        ) : (
          <span className="block h-[15px] w-5 shrink-0" />
        )}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-display text-base font-bold uppercase tracking-tight text-dark" title={e.name}>
            {name}
          </span>
          {match?.country && (
            <Flag code={match.country} title={match.teamName} w={15} h={11} className="sm:hidden" />
          )}
          {/* DRS/PIT sit in their own column from sm up; on phones that column
              is 55px of mostly-empty width, so the badges ride with the name. */}
          {mobileBadges && (e.drs || e.inPits) && (
            <span className="flex shrink-0 gap-1 sm:hidden">
              {e.drs && <span className="pill bg-sky-500/15 text-sky-600">DRS</span>}
              {e.inPits && <span className="pill bg-amber-500/15 text-amber-600">PIT</span>}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-light">
          {match?.teamName || carLabel(e.carName) || "—"}
        </span>
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
    <tr
      data-flip-id={e.guid}
      style={{ "--i": Math.min(index, 16) }}
      // A leaver (race sessions keep them listed so the finishing order holds)
      // dims but stays in their slot.
      className={`border-b border-border last:border-0 transition hover:bg-surface2 ${e.onTrack ? "" : "opacity-55"}`}
    >
      <td className="py-3 pl-3.5 pr-2 text-center sm:pl-5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-base font-black tabular-nums text-medium">
          {e.position}
        </span>
      </td>
      <td className="py-3 pl-1 pr-3">
        <DriverCell e={e} match={match} />
      </td>
      <td className="hidden py-3 pr-4 text-center sm:table-cell">
        {/* Same compound chips as the strategy view — the raw server strings
            were a mix of "Medium", "Soft" and bare letter codes. */}
        {e.tyre && (
          <span className="inline-grid place-items-center align-middle" title={tyreCompound(e.tyre).name}>
            <TyreBadge t={tyreCompound(e.tyre)} size={22} />
          </span>
        )}
      </td>
      <td className="py-3 pr-4 text-right text-base">
        {e.onTrack ? (
          <CurrentLap lastLapAt={e.lastLapAt} inPits={e.inPits} />
        ) : (
          <span className="pill bg-surface2 font-mono text-light">Left</span>
        )}
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
  // pl-3.5: with the card's 1px border and the 2px the fixed-width cell leaves
  // when it centres the 32px chip, that lands the chip ~17px from the card's
  // left edge — matching the ~16.5px it sits below the row's top edge.
  { label: "Pos", cls: "w-14 py-3 pl-3.5 text-center sm:pl-5" },
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
      <td className="py-3 pl-3.5 pr-2 text-center sm:pl-5">
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-base font-black tabular-nums ${
            isP1 ? "bg-brand text-ink" : "text-medium"
          }`}
        >
          {e.position}
        </span>
      </td>
      <td className="py-3 pl-1 pr-3">
        <DriverCell e={e} match={match} showLiveDot mobileBadges />
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
        {/* On phones the gap has no column of its own, so it sits directly
            under the lap it refers to. Nothing for the leader (gap 0) or for
            a driver without a time yet. */}
        {e.gapToBestMs ? (
          <span className="block font-mono text-xs tabular-nums text-light sm:hidden">
            {formatGap(e.gapToBestMs)}
          </span>
        ) : null}
      </td>
      <td className="hidden py-3 pr-4 text-right md:table-cell">
        <span className="font-mono text-sm tabular-nums text-violet-500" title="Ideal lap (sum of best sectors)">
          {formatLap(e.potentialMs)}
        </span>
      </td>
      <td className="hidden py-3 pr-4 text-right sm:table-cell">
        <span className="font-mono text-sm tabular-nums text-light">{formatGap(e.gapToBestMs)}</span>
      </td>
      <td className="hidden py-3 pr-4 text-right sm:table-cell">
        <span className="font-mono text-sm tabular-nums text-medium">{formatLap(e.lastLapMs)}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center tabular-nums md:table-cell">
        <span className="font-mono text-sm text-medium">{e.lapCount}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center lg:table-cell">
        {e.tyre && (
          <span className="inline-grid place-items-center align-middle" title={tyreCompound(e.tyre).name}>
            <TyreBadge t={tyreCompound(e.tyre)} size={22} />
          </span>
        )}
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
      <td className="hidden py-3 pr-5 text-right sm:table-cell">
        <div className="flex justify-end gap-1.5">
          {e.drs && <span className="pill bg-sky-500/15 text-sky-600">DRS</span>}
          {e.inPits && <span className="pill bg-amber-500/15 text-amber-600">PIT</span>}
        </div>
      </td>
    </tr>
  );
}

/* ===== Championship projection ("if it ends like this") =================== */

// FLIP-animate vertical reordering inside a container: children carrying
// data-flip-id glide to their new slot whenever the list order changes
// (someone overtakes on track), plus a short green/red row flash for the
// direction. Pure transform/transition, no rAF: set the old offset with
// transitions off, force a reflow, then release — the browser animates to 0.
// Lite graphics mode and reduced motion skip it entirely (rows just jump).
function useFlipList(containerRef, dep) {
  const prevTops = useRef(new Map());
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const items = [...el.querySelectorAll("[data-flip-id]")];
    const next = new Map(items.map((it) => [it.dataset.flipId, it.getBoundingClientRect().top]));
    const skip =
      document.documentElement.classList.contains("fx-lite") ||
      (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (!skip) {
      for (const it of items) {
        const id = it.dataset.flipId;
        const before = prevTops.current.get(id);
        if (before == null) continue;
        const delta = before - next.get(id);
        if (Math.abs(delta) < 2) continue;
        it.style.transition = "none";
        it.style.transform = `translateY(${delta}px)`;
        it.classList.remove("proj-flash-up", "proj-flash-down");
        void it.offsetHeight; // commit the start position before releasing
        it.style.transition = "transform 0.7s cubic-bezier(0.22, 0.9, 0.35, 1)";
        it.style.transform = "";
        it.classList.add(delta > 0 ? "proj-flash-up" : "proj-flash-down");
        it.addEventListener(
          "animationend",
          () => it.classList.remove("proj-flash-up", "proj-flash-down"),
          { once: true }
        );
      }
    }
    prevTops.current = next;
  }, [containerRef, dep]);
}

// Position movement vs. the current table: a tinted pill with triangle +
// places gained/lost, quiet dash for no change. Louder than the old bare
// arrow on purpose — the before/after story is the point of this table.
function MovePill({ move }) {
  if (!move) {
    return (
      <span className="inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded-full bg-surface2 font-mono text-xs font-bold text-faint">
        –
      </span>
    );
  }
  const up = move > 0;
  return (
    <span
      className={`inline-flex h-6 min-w-[2.5rem] items-center justify-center gap-0.5 rounded-full px-2 font-mono text-xs font-bold tabular-nums ${
        up ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/10 text-red-500"
      }`}
      title={up ? `Up ${move} vs. the standings before this race` : `Down ${-move} vs. the standings before this race`}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
        {up ? <path d="M12 5l7 11H5z" /> : <path d="M12 19L5 8h14z" />}
      </svg>
      {Math.abs(move)}
    </span>
  );
}

// One tier's compact constructor projection card.
function TeamProjection({ title, rows, flipKey }) {
  const bodyRef = useRef(null);
  useFlipList(bodyRef, flipKey);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
        {title}
      </div>
      <table className="w-full">
        <tbody ref={bodyRef}>
          {rows.map((t) => (
            // a live projection is never a decided title: leader wash, not gold
            <tr
              key={t.teamId}
              data-flip-id={t.teamId}
              className={`border-b border-border last:border-0 ${t.position === 1 ? "row-leader" : ""}`}
            >
              <td className="w-12 py-3 pl-5 text-center font-display text-base font-black tabular-nums text-medium">
                {t.position}
              </td>
              <td className="w-14 py-3 text-center">
                <MovePill move={t.move} />
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
// `standalone` = a test/training race: the table is THIS race alone (normal
// points table, nothing counts toward the championship), so the movement
// column and constructor cards stay out.
function ChampionshipProjection({ data }) {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 12;
  const standalone = !!data.standalone;
  // Rows glide to their new slot when the running order changes mid-race.
  const bodyRef = useRef(null);
  useFlipList(bodyRef, data.updatedAt);
  // Keep the table to competitors who matter for the title picture: everyone
  // in the running race plus anyone who already has points on the board.
  const rows = data.drivers.filter((d) => d.livePosition != null || d.dnf || d.total > 0 || d.currentTotal > 0);
  const shown = showAll ? rows : rows.slice(0, LIMIT);
  return (
    <section className="reveal space-y-4">
      <SectionHeading
        eyebrow={
          standalone
            ? `Test race · ${data.race.track}`
            : `Round ${data.race.number} · ${data.race.track}`
        }
        title={standalone ? "This Race, If It Ends Like This" : "Championship, If It Ends Like This"}
        right={
          <span className="flex items-center gap-2">
            {standalone && <span className="pill bg-sky-500/15 text-sky-600">Not scored</span>}
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
          <table className={`w-full ${standalone ? "min-w-[520px]" : "min-w-[620px]"}`}>
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-light">
                <th className="w-14 py-3 pl-3.5 text-center sm:pl-5">Pos</th>
                {!standalone && <th className="w-16 py-3 text-center"></th>}
                <th className="py-3 pl-1">Driver</th>
                <th className="py-3 pr-4 text-center">Race</th>
                {/* standalone: the championship standing is context only (the
                    race isn't scored) — but it keeps the table informative */}
                <th className="py-3 pr-4 text-right">{standalone ? "Standings" : "Before"}</th>
                <th className="py-3 pr-5 text-right">{standalone ? "Pts" : "After"}</th>
              </tr>
            </thead>
            {/* No cascade here on purpose: reordering rows (React moves the DOM
                nodes) would REPLAY the entrance animation on every overtake,
                which reads as the whole table rebuilding. The FLIP glide in
                useFlipList is the only movement. */}
            <tbody ref={bodyRef}>
              {shown.map((d, i) => (
                <tr
                  key={d.driverId}
                  data-flip-id={d.driverId}
                  style={{ "--i": Math.min(i, 16) }}
                  className={`border-b border-border last:border-0 ${
                    d.position === 1 ? "row-leader" : "hover:bg-surface2"
                  }`}
                >
                  <td className="py-3 pl-3.5 pr-2 text-center sm:pl-5">
                    <span
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-base font-black tabular-nums ${
                        d.position === 1 ? "bg-brand text-ink" : "text-medium"
                      }`}
                    >
                      {d.position}
                    </span>
                  </td>
                  {!standalone && (
                    <td className="py-3 text-center">
                      <MovePill move={d.move} />
                    </td>
                  )}
                  <td className="py-3 pl-1 pr-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: d.team.color }} />
                      <TeamLogo id={d.team.id} name={d.team.name} color={d.team.color} logoUrl={d.team.logoUrl} size={24} />
                      <Flag code={countryFor(d.driverId, d.country)} />
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
                  <td className="py-3 pr-4 text-right">
                    {d.currentPosition != null ? (
                      <span
                        className="font-mono text-sm tabular-nums text-light"
                        title={
                          standalone
                            ? `Championship standing: P${d.currentPosition} with ${d.currentTotal} points (this race is not scored)`
                            : `Before this race: P${d.currentPosition} with ${d.currentTotal} points`
                        }
                      >
                        P{d.currentPosition} · {d.currentTotal}
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-faint">–</span>
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
        <TeamProjection title={data.t2?.length ? "Constructors · Tier 1" : "Constructors"} rows={data.t1} flipKey={data.updatedAt} />
        <TeamProjection title="Constructors · Tier 2" rows={data.t2} flipKey={data.updatedAt} />
      </div>

      <p className="px-1 font-mono text-[11px] uppercase tracking-wider text-light">
        {standalone
          ? "This is a test race: points use the league's normal table but count for this race only. Nothing here changes the championship standings."
          : "A projection, not a result: it assumes the race finishes in the current running order, with drop scores applied. Time penalties and stewarding are not included. The official tables update once the result is posted."}
      </p>
    </section>
  );
}

const COLS = [
  // pl-3.5: with the card's 1px border and the 2px the fixed-width cell leaves
  // when it centres the 32px chip, that lands the chip ~17px from the card's
  // left edge — matching the ~16.5px it sits below the row's top edge.
  { label: "Pos", cls: "w-14 py-3 pl-3.5 text-center sm:pl-5" },
  { label: "Driver", cls: "py-3 pl-1" },
  { label: "Sectors", cls: "hidden py-3 pr-4 lg:table-cell" },
  { label: "Best", cls: "py-3 pr-4 text-right" },
  { label: "Potential", cls: "hidden py-3 pr-4 text-right md:table-cell" },
  // On phones the gap rides along under the driver's name instead of taking a
  // column of its own — that room goes to the best lap, which is what you're
  // actually here to read.
  { label: "Gap", cls: "hidden py-3 pr-4 text-right sm:table-cell" },
  { label: "Last", cls: "hidden py-3 pr-4 text-right sm:table-cell" },
  { label: "Laps", cls: "hidden py-3 pr-4 text-center md:table-cell" },
  { label: "Tyre", cls: "hidden py-3 pr-4 text-center lg:table-cell" },
  { label: "Top", cls: "hidden py-3 pr-4 text-right xl:table-cell" },
  { label: "Pits", cls: "hidden py-3 pr-4 text-center xl:table-cell" },
  { label: "Ping", cls: "hidden py-3 pr-4 text-right xl:table-cell" },
  // DRS/PIT badges — folded into the driver cell on phones (see DriverCell).
  { label: "", cls: "hidden py-3 pr-5 sm:table-cell" },
];

/* ===== External links, view switch, track map ============================= */

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </svg>
  );
}

// The admin-configured external buttons. Left: "Join in Content Manager"
// (appears only once an admin has pasted the running server's CM deep link)
// then "Full live timing" (always shows — it has a sensible default). Right,
// on the same row: the league's Patreon (from the social links, when set).
function ExternalButtons({ links, patreonUrl }) {
  const timing = links?.liveTimingUrl;
  const join = links?.cmJoinUrl;
  if (!timing && !join && !patreonUrl) return null;
  // Lives in the PAGE HEADER's right slot (same height as the title), so the
  // actual content starts right below. One shared size; phones stack them
  // full-width under the title (the header handles the stacking).
  // Phones: one row of three equal buttons with short labels, so they don't
  // eat three stacked full-width rows before the timing even starts. The full
  // wording comes back from sm up, where there's room for it.
  const base =
    "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-bold uppercase tracking-wide transition sm:w-auto sm:flex-none sm:gap-2 sm:px-4 sm:text-sm";
  return (
    <div className="flex w-full gap-2 sm:w-auto sm:flex-wrap sm:items-center sm:justify-end sm:gap-2.5">
      {join && (
        <a
          href={join}
          target="_blank"
          rel="noreferrer noopener"
          className={`${base} bg-brand text-ink shadow-lg shadow-brand/25 hover:brightness-105`}
        >
          <ExternalIcon />
          <span className="sm:hidden">Join</span>
          <span className="hidden sm:inline">Join in Content Manager</span>
        </a>
      )}
      {timing && (
        <a
          href={timing}
          target="_blank"
          rel="noreferrer noopener"
          className={`${base} border border-border bg-card text-dark hover:bg-surface2`}
        >
          <ExternalIcon />
          <span className="sm:hidden">Timing</span>
          <span className="hidden sm:inline">Full live timing</span>
        </a>
      )}
      {patreonUrl && (
        <a
          href={patreonUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={`${base} border border-[#FF424D]/40 bg-[#FF424D]/10 text-[#FF424D] hover:bg-[#FF424D]/20`}
        >
          <SocialIcon name="patreon" className="h-4 w-4" />
          <span className="sm:hidden">Patreon</span>
          <span className="hidden sm:inline">Support us on Patreon</span>
        </a>
      )}
    </div>
  );
}

// Segmented Timing / Strategy / Standings switch, matching the profile scope
// toggle. "Standings" (the live championship projection) only exists on league
// race days — it joins the switch with a pulsing dot so it gets noticed.
function ViewSwitch({ view, setView, hasStandings }) {
  const dot = (
    <span className="relative mr-1.5 inline-flex h-2 w-2">
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
          view === "standings" ? "bg-ink" : "bg-brand"
        }`}
      />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${view === "standings" ? "bg-ink" : "bg-brand"}`} />
    </span>
  );
  return (
    <SlidingTabs
      wrapClassName="inline-flex rounded-lg border border-border bg-card p-0.5"
      btnClassName="px-4 py-1.5 text-xs uppercase tracking-wide"
      pillClassName="rounded-md bg-brand"
      items={[
        { key: "timing", label: "Timing" },
        { key: "strategy", label: "Strategy" },
        ...(hasStandings ? [{ key: "standings", label: <span className="inline-flex items-center">{dot}Standings</span> }] : []),
      ]}
      value={view}
      onChange={setView}
    />
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
function DrivingNowSection({ onTrack, match, flip = false, className = "" }) {
  // During a RACE an overtake FLIP-glides the two rows into their new slots
  // (green flash = gained, red = lost) instead of the order snapping — the
  // same useFlipList the championship projection uses, with the same lite-
  // graphics/reduced-motion opt-out. Practice/quali keep the plain re-sort:
  // there the order is a leaderboard, not on-track position.
  const bodyRef = useRef(null);
  const offRef = useRef(null);
  useFlipList(flip ? bodyRef : offRef, onTrack.map((e) => e.guid).join("|"));
  return (
    <section className={`reveal card flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Driving now</span>
        {/* No live counter up here — the track-map card says "N on track". */}
        {onTrack.length === 0 && (
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
            {/* No cascade here (matching the projection table): a websocket
                hiccup or reorder remounts rows, which REPLAYED the entrance
                fade over the whole field mid-session. The FLIP glide is the
                only movement. */}
            <tbody ref={bodyRef}>
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
// The caller supplies the display utility (the Live page hides this on phones),
// so `flex` is deliberately NOT baked in here — two competing display classes
// would resolve by Tailwind's output order rather than by intent.
function PitLaneSection({ entries, match, className = "" }) {
  const inPits = entries.filter((e) => e.onTrack && e.inPits);
  return (
    <section className={`reveal card flex-col overflow-hidden ${className}`}>
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
  // League social links — the Patreon button on the buttons row uses them.
  const social = useSocial();
  // Timing ⇄ Strategy switch (the track map sits above both).
  const [view, setView] = useState("timing");

  const connected = board?.connected && !board?.stale && socketState === "open";
  const session = board?.session;
  const entries = board?.entries || [];
  const onTrack = entries.filter((e) => e.onTrack);
  const receivedAt = useMemo(() => Date.now(), [board?.updatedAt]);
  // Nobody actually driving: the "right now" block (driving now, track map,
  // pit lane) and the strategy views would all be empty shells, so the page
  // collapses to header + best times. A race with laps on the board stays in
  // the full layout even after the post-race exodus — the finishing order in
  // Driving Now is the payoff of the session.
  const quiet =
    onTrack.length === 0 &&
    !(session?.type === "Race" && entries.some((e) => (e.lapCount || 0) > 0));

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
        // A failed poll (server restart, hiccup) keeps the last table on
        // screen instead of tearing the whole section down and rebuilding it
        // on the next success; a real deactivation arrives as active:false.
        .catch(() => {});
    load();
    const t = setInterval(load, 12000); // matches the server-side 10s cache
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // The Standings view only exists while the projection is active (race day);
  // if it deactivates mid-visit the switch falls back to Timing.
  useEffect(() => {
    if (view === "standings" && champ && !champ.active) setView("timing");
  }, [champ, view]);

  // Mobile: keep the classification to a single screenful, expandable on tap.
  const narrow = useIsNarrow();
  const [showAllTimes, setShowAllTimes] = useState(false);
  const TIMES_LIMIT = 10;
  const collapseTimes = narrow && !showAllTimes && entries.length > TIMES_LIMIT;
  const shownEntries = collapseTimes ? entries.slice(0, TIMES_LIMIT) : entries;

  // The best-times section renders in two spots — as the Timing view of the
  // full layout, and alone right under the header when the server is quiet —
  // so it lives in one place here.
  const bestTimes = (
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
              {/* The min-width was sized for the full desktop column set,
                  so phones had to scroll sideways to reach Best even
                  though only four columns were showing. It now kicks in
                  at md, where those extra columns actually appear. */}
              <table className="w-full md:min-w-[680px]">
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
  );

  return (
    <div>
      {/* No live/offline badge up here — the session card below already tells
          the story; only the admin-facing Demo pill remains. */}
      <PageHeader
        eyebrow="Real-time"
        title="Live Timing"
        // The external buttons share the title's row (right-aligned), so the
        // session card moves up to just under the header.
        right={
          <div className="flex w-full flex-col items-end gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            {board?.demo && <span className="pill bg-amber-500/15 text-amber-600">Demo</span>}
            <ExternalButtons links={extLinks} patreonUrl={social.data?.patreon} />
          </div>
        }
      />

      {!session ? (
        <div className="card flex flex-col items-center justify-center gap-3 py-12 text-center sm:py-20">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand" />
          <p className="font-mono text-sm uppercase tracking-wider text-light">
            {socketState === "open" ? "Waiting for the server…" : "Connecting to the server…"}
          </p>
        </div>
      ) : (
        <div className="content-in space-y-8">
          {/* ===== Session bar across the top ===== */}
          <SessionHeader session={session} receivedAt={receivedAt} />

          {quiet ? (
            // Empty server: the best-times board takes the "right now" slot,
            // everything else (driving now, map, pit lane, strategy) sits out.
            bestTimes
          ) : (
          <>
          {/* ===== Driving now (left, wider) beside the track map + pit lane
                 (right, narrower): one "right now" block. The map column is
                 first in the DOM so it leads on phones; explicit column starts
                 put it right on lg, and the pit-lane card stretches so both
                 columns close flush. ===== */}
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-5 lg:items-stretch">
            <div className="flex flex-col gap-4 sm:gap-6 lg:col-span-2 lg:col-start-4 lg:row-start-1">
              <TrackMapSection session={session} entries={entries} match={match} />
              {/* Phones skip the pit-lane card: the same drivers already show
                  as dimmed dots on the map above and carry a PIT badge in the
                  timing table, so it was a third copy of the same fact for a
                  screenful of height. */}
              <PitLaneSection entries={entries} match={match} className="hidden flex-1 sm:flex" />
            </div>
            <DrivingNowSection
              // In a race, drivers who left the server (post-race exodus) stay
              // listed in their final slot, dimmed — the result holds.
              onTrack={
                session.type === "Race"
                  ? entries.filter((e) => e.onTrack || (e.lapCount || 0) > 0)
                  : onTrack
              }
              match={match}
              flip={session.type === "Race"}
              className="lg:col-span-3 lg:col-start-1 lg:row-start-1"
            />
          </div>

          {/* ===== Timing / Strategy / Standings switch ===== */}
          <div className="reveal flex items-center justify-between gap-4">
            <span className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-eyebrow">
              Session view
            </span>
            <ViewSwitch view={view} setView={setView} hasStandings={!!champ?.active} />
          </div>

          {view === "standings" && champ?.active ? (
            <ChampionshipProjection data={champ} />
          ) : view === "strategy" ? (
            <section className="reveal space-y-4">
              <SectionHeading eyebrow="Tyres" title="Strategy" />
              <TyreStrategy entries={entries} matchFn={match} raceLaps={session.raceLaps} />
              <CompoundLegend entries={entries} />
            </section>
          ) : (
            bestTimes
          )}
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
