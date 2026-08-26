import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { raceKickoff, fmtRaceTime, LIVE_WINDOW_MS } from "../utils/raceTime.js";
import { useApi } from "../hooks/useApi.js";
import { useLiveTiming } from "../hooks/useLiveTiming.js";
import { useNow } from "../hooks/useNow.js";
import { motionOff } from "../hooks/motion.js";
import { useVisiblePoll } from "../hooks/useVisiblePoll.js";
import { PageHeader, SectionHeading, SafetyCarBadge, NoData} from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import LiveTrackMap from "../components/LiveTrackMap.jsx";
import { useLiveServers, LiveServerSwitch } from "../components/LiveServerSwitch.jsx";
import TyreStrategy, { TyreBadge } from "../components/TyreStrategy.jsx";
import { circuitForLive } from "../data/circuits.js";
import { countryFor } from "../data/driverCountries.js";
import { SocialIcon, useSocial } from "../components/SocialLinks.jsx";
import VideoEmbed from "../components/VideoEmbed.jsx";
import { streamEmbed } from "../utils/streamEmbed.js";
import SlidingTabs from "../components/SlidingTabs.jsx";
import { LiveSortMenu, LiveColumnsMenu } from "../components/LiveTableMenu.jsx";
import { useLiveTablePrefs } from "../hooks/useLiveTablePrefs.js";
import { fmtRaceDate, NO_VALUE} from "../utils/format.js";
import {
  makeDriverMatcher,
  formatLap,
  formatGap,
  formatRaceGap,
  formatSector,
  formatRunningSector,
  formatCountdown,
  formatRunning,
  formatDelta,
  formatSpeed,
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
    return <NoData className="font-mono tabular-nums text-dark" />;
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

// min-w-0: this div is a grid item, and a grid item's automatic minimum size is
// its min-content width — so a `truncate` child (nowrap) would push the item
// wider than its track instead of ellipsing, and a long leader's name would run
// into the tile beside it.
function Stat({ label, children }) {
  return (
    <div className="min-w-0">
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
  const isRace = session.type === "Race";
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
      {/* The one thing that changes how everything below it should be read. It
          sits above the numbers rather than among them, and stays put on phones
          instead of hiding behind the details toggle — a caution is not a
          detail. Yellow, because that is what it is. */}
      {session.safetyCar && (
        <div
          role="status"
          className="flex items-center gap-2.5 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 sm:px-6"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-warn sm:text-xs">
            Safety car on track
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 px-4 py-3.5 sm:grid-cols-2 sm:gap-5 sm:p-6 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow sm:text-[11px]">
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
              {/* A race asks different questions of the same two tiles. Who is
                  winning beats what the fastest lap was — the fastest lap stays,
                  as the small line underneath — and a lap-limited race has no
                  clock to count down, so the dash that used to sit there becomes
                  the number everybody actually wants. A TIMED race keeps the
                  clock; practice and qualifying are untouched. */}
              {isRace ? (
                <Stat label="Leader">
                  <span
                    className="block truncate font-display text-xl font-bold uppercase text-dark sm:text-2xl"
                    title={session.leaderName || undefined}
                  >
                    {session.leaderName || NO_VALUE}
                  </span>
                  {session.bestLapMs > 0 && (
                    <span className="font-mono text-xs text-light">
                      fastest {formatLap(session.bestLapMs)}
                    </span>
                  )}
                </Stat>
              ) : (
                <Stat label="Session Best">
                  <span className="font-mono text-xl font-bold tabular-nums text-dark sm:text-2xl">
                    {formatLap(session.bestLapMs)}
                  </span>
                </Stat>
              )}

              {isRace && session.lapsLeft != null ? (
                <Stat label="Laps Left">
                  <span className="font-mono text-xl font-bold tabular-nums text-dark sm:text-2xl">
                    {session.lapsLeft}
                  </span>
                  <span className="ml-2 font-mono text-xs text-light">of {session.raceLaps}</span>
                </Stat>
              ) : (
                <Stat label="Time Left">
                  <span className="text-xl font-bold sm:text-2xl">
                    <Countdown
                      baseMs={session.remainingMs}
                      receivedAt={receivedAt}
                      resetKey={`${session.type}|${session.sessionIndex}|${session.trackName}`}
                    />
                  </span>
                </Stat>
              )}

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

// One sector chip, coloured purple (session's fastest) / green (the driver's own
// best) / amber (anything else) / red (a sector with a cut in it — the time is
// there but it wasn't earned), matching sim-racing timing convention and the
// race server's own timing page. The purple is the shared fastest-lap token
// rather than a fixed violet-500, which sat at 2.9:1 on the dark board — the
// same tone the FL badge uses elsewhere, so the convention reads the same across
// the site and stays legible in both themes.
//
// `compact` is the narrower chip the Driving-now table uses for the lap in
// progress: that card shares a row with the track map, so its column has to
// stay slim. A null sector still takes its width, so chips don't jump sideways
// as the lap fills in.
// How long the digits take to run up to a sector time that just landed, and the
// curve they run on: fast out of the blocks, long settle, so the last few
// thousandths are readable rather than a blur that stops.
const ROLL_MS = 420;
const rollEase = (t) => 1 - Math.pow(1 - t, 3);

// The number a chip is showing right now: normally just the value it was given,
// but for the first frames after a NEW value arrives it runs up to it.
//
// Only on a change, never on mount. The board arrives every 700ms and a full
// grid is 114 of these; animating whatever the first frame happened to contain
// would set the entire page running at once on load, every load, and animating
// on each board would mean it never stopped. A sector time changes when a
// driver improves it, which is exactly the moment worth showing.
//
// The count starts from the previous value rather than from zero, because these
// are lap times: rolling 31.402 -> 31.198 through the tenths that separate them
// shows the improvement, where a run up from zero would just be a slot machine.
function useRolledMs(target) {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = target;
    // Nothing to animate: the first value, a cleared chip, or no real change.
    if (from == null || target == null || from === target || motionOff()) {
      setShown(target);
      return undefined;
    }
    const startedAt = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - startedAt) / ROLL_MS);
      setShown(Math.round(from + (target - from) * rollEase(p)));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);

  return shown;
}

// How long the purple beat runs. Must match .sector-purple in index.css, which
// is on the --t-tell step of the motion scale.
const BEAT_MS = 700;

// "" normally; "sector-purple" or "sector-green" for one beat after the chip
// ENTERS that state. Taking the fastest sector is the moment worth showing, and
// holding it is not, so a chip that keeps the record goes still again.
//
// Held in state with a timer rather than derived from a ref each render, and
// that is not a style preference. These chips re-render at wildly different
// rates: a row in the main table redraws when the board lands, every 700ms,
// while the strip under a driver's clock redraws ten times a second with the
// running sector. Deriving the class from "was it best last render" gives the
// first a full beat and the second about a tenth of one, so the same event
// would flash properly in one place and blink in the other. A timer gives both
// the whole animation.
function useSectorBeat(s) {
  const [beat, setBeat] = useState("");
  const prev = useRef(null); // null = first sight of this chip: no beat
  const timer = useRef(0);

  const best = !!s?.best;
  const driversBest = !!s?.driversBest;

  useEffect(() => {
    const was = prev.current;
    prev.current = { best, driversBest };
    if (!was || motionOff()) return undefined;
    const next = best && !was.best ? "sector-purple" : driversBest && !best && !was.driversBest ? "sector-green" : "";
    if (!next) return undefined;
    setBeat(next);
    clearTimeout(timer.current);
    // Cleared again afterwards so the class is gone before the chip could earn
    // the same beat a second time; left on, the browser would not replay it.
    timer.current = setTimeout(() => setBeat(""), BEAT_MS);
    return undefined;
  }, [best, driversBest]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return beat;
}

// One sector chip.
//
// Three things it can be, and they are deliberately different shapes:
//
//   a RESULT      the sector of the driver's best lap. Purple for the fastest
//                 in the session, green for the driver's own best, amber
//                 otherwise, red if they cut. The digits run up when the time
//                 improves, and taking the purple plays once (see .sector-purple
//                 in index.css).
//   RUNNING       the sector the driver is in at this moment: `runningMs` is a
//                 live number climbing on the shared clock. It wears none of the
//                 result colours, because it is not a result yet; a dashed
//                 outline and a slow breath say so, and it hardens into its real
//                 colour the instant the split lands.
//   NOTHING       no time, no chip.
function Sector({ s, compact = false, runningMs = null }) {
  const size = compact ? "w-[46px] text-[10px]" : "w-[52px] text-xs";
  // The transparent border is not decoration: the running chip wears a real one
  // (dashed, to say the number is not a result yet), and without a matching
  // invisible one on the other two shapes a row grew two pixels the moment a
  // driver started a sector and shrank again when it landed.
  const base = `inline-block ${size} rounded border border-transparent text-center font-mono font-semibold tabular-nums`;

  const beat = useSectorBeat(s);
  const rolled = useRolledMs(s ? s.ms : null);

  if (runningMs != null) {
    return (
      <span
        className={`${base} sector-live border-dashed border-light/40 text-light`}
        title="This sector is still being driven"
      >
        {formatRunningSector(runningMs)}
      </span>
    );
  }

  if (!s) return <NoData className={base} />;

  const cls = s.cuts
    ? "bg-red-500/10 text-bad"
    : s.best
    ? "bg-fl/20 text-fl"
    : s.driversBest
    ? "bg-ok/15 text-ok"
    : "bg-warn/10 text-warn";
  return (
    <span
      className={`${base} ${cls}${beat ? ` ${beat}` : ""}`}
      title={
        s.cuts
          ? `${s.cuts} cut${s.cuts > 1 ? "s" : ""} in this sector`
          : s.best
          ? "Fastest sector of the session"
          : s.driversBest
          ? "This driver's best sector"
          : undefined
      }
    >
      {formatSector(rolled ?? s.ms)}
    </span>
  );
}

// The lap a driver is on RIGHT NOW, filling in sector by sector as they cross
// each split — the same build-up the race server's own timing page shows, from
// the same source (the snapshot's CurrentLapSplits). Practice and qualifying
// only: in a race the interesting question is the gap to the car ahead, not
// which tenth of sector two someone is having, and the column has no room for
// both. Nothing is DRAWN until the first split of the lap lands, so a driver who
// has just left the pits doesn't get an empty second line.
//
// The line is still THERE though, holding its height, and that is the whole
// point of the `invisible` branch below. Splits appear and vanish constantly:
// every driver, every lap, and again the moment anyone pits. When the line came
// and went with them, every one of those moments resized a row and shoved the
// rest of the table down a notch. Reserving the space costs 20 pixels a row and
// buys a board that holds still.
// A sector that has been running longer than this is not a sector, it is a
// stale row: someone parked, went to the garage without the board noticing, or
// the lap start we are counting from belongs to a lap they abandoned. Three
// minutes is longer than any sector on any circuit the league runs and short
// enough that a wrong number does not sit there all session.
const MAX_RUNNING_SECTOR_MS = 3 * 60 * 1000;

// How long the finished lap's three splits stay on the line after the driver
// crosses it, before sector one takes over and starts counting. Long enough to
// read the lap you just did, short enough that the new one is still young when
// the number starts moving.
const FINISHED_LAP_HOLD_MS = 10_000;

// Every badge in the flags column sits in the same box. They are all three
// letters, but not the same three letters: OUT is six pixels wider than PIT,
// and with the column sized to its content that was six pixels of table sliding
// sideways the moment a driver left the pit lane.
const BADGE_BOX = "w-[42px] justify-center";

function BuildingSectors({ sectors, lastLapAt, outLap = false }) {
  // The clock runs whenever there is a lap to measure: either to count a sector
  // or to expire the hold below.
  const now = useNow(lastLapAt != null && !outLap);
  const elapsed = lastLapAt != null ? Math.max(0, now - lastLapAt) : null;

  // Three filled splits are the lap that just ENDED. They stay up for a moment
  // after the line, because they are the thing everyone wants to read right
  // then, and only then does sector one take the line over. Blanking them the
  // instant the lap ticked over left the entire first sector empty, which is
  // the same complaint from the other side: on a second flying lap you saw
  // nothing at all until the first split landed half a minute later.
  const lapDone = !!sectors && sectors.every(Boolean);
  const holding = lapDone && (elapsed == null || elapsed < FINISHED_LAP_HOLD_MS);
  const shown = lapDone && !holding ? [null, null, null] : sectors;

  // The sector being driven is the first empty box, and how long they have been
  // in it is the lap clock minus the splits already banked. Both halves come
  // from the board itself (lastLapAt is when this lap started, the filled boxes
  // are its splits), so nothing is estimated.
  const nextIdx = shown ? shown.findIndex((x) => !x) : -1;
  const hasSplit = !!shown?.some(Boolean);
  // Sector ONE counts too, which it did not use to. Two things had to be true
  // first: the finished lap's splits have to give the line up (the hold above),
  // and the board has to say when a driver is on an out lap, so the clock is
  // not started from a crossing that happened before a pit stop. Without the
  // second, a driver leaving the pits would have got a first sector counting
  // their time in the garage.
  const running = nextIdx >= 0 && lastLapAt != null && !outLap;

  // Same three boxes, same gap, same margin: only the ink is missing, so the row
  // is exactly as tall as it will be a moment later when the first split lands.
  if (!hasSplit && !running) {
    return (
      <div aria-hidden className="mt-1 flex justify-end gap-1 invisible">
        {[0, 1, 2].map((i) => (
          <Sector key={i} s={null} compact />
        ))}
      </div>
    );
  }

  let runningMs = null;
  if (running) {
    const banked = shown.slice(0, nextIdx).reduce((a, x) => a + (x?.ms || 0), 0);
    // The splits are FACTS: the server has already timed them. So the lap is at
    // least as old as their sum, whatever the clock says, and the running
    // sector starts from zero the moment a split lands rather than waiting for
    // the clock to catch up with it. (The clock is on the board's own time now,
    // see useNow.js, which is what left it a second or two behind before.)
    const ms = Math.max(elapsed, banked) - banked;
    if (ms >= 0 && ms < MAX_RUNNING_SECTOR_MS) runningMs = ms;
  }

  return (
    <div className="mt-1 flex justify-end gap-1">
      {(shown || [null, null, null]).map((s, i) => (
        <Sector key={i} s={s} compact runningMs={i === nextIdx ? runningMs : null} />
      ))}
    </div>
  );
}

// Live-ticking current-lap clock for an on-track driver (now - lastLapAt).
// `startedAt` is the fallback for the opening lap of a race: nobody has crossed
// the line yet, so there is no last crossing to count from — but that lap began
// at the green light, and the board now says when that was. Only passed for a
// driver with no completed lap in a race; in practice a first lap starts
// whenever the driver left the pits, which nothing knows, so it stays blank.
function CurrentLap({ lastLapAt, inPits, outLap = false, startedAt = null }) {
  // The shared board clock, so this and the sector chips underneath it are
  // measuring from the same instant. Its own interval used to run on the
  // browser's clock, which is what put the two out of step.
  const now = useNow(!inPits && !outLap);
  if (inPits) return <span className="font-mono text-[11px] font-bold uppercase text-warn">In pit</span>;
  // Out of the pits, not yet across the line: the last crossing on file is from
  // before the stop, so counting from it would print the stop as lap time. The
  // lap has no start anybody knows, and saying so beats an invented number.
  if (outLap) return <span className="font-mono text-[11px] font-bold uppercase text-light">Out lap</span>;
  const from = lastLapAt || startedAt;
  if (!from) return <NoData className="font-mono tabular-nums" />;
  const ms = now - from;
  if (ms < 0 || ms > 15 * 60 * 1000) return <NoData className="font-mono tabular-nums" />;
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
// they ride along with the driver's name (see TIMING_COLUMNS).
// `badgesAlways`: same thing at every width, for a reader who switched the flags
// column off entirely — the badges are the only place PIT is visible.
function DriverCell({ e, match, showLiveDot, mobileBadges = false, badgesAlways = false }) {
  const name = match?.nabsName || e.name;
  const color = match?.teamColor || "var(--c-border)";
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <span className="relative flex h-8 w-1.5 shrink-0 items-center">
        <span className="h-full w-full rounded-full" style={{ backgroundColor: color }} />
        {showLiveDot && e.onTrack && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" title="On track">
            {/* Colour was the only carrier of this: no text, and `title` never
                appears on a touch device. */}
            <span className="sr-only">On track</span>
          </span>
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
          {/* One of the league's safety car drivers. Stays on whatever they are
              driving tonight — it says who this person is, not what car is out
              there, which is the position column's "SC". */}
          {match?.role === "safety" && <SafetyCarBadge compact />}
          {/* DRS/PIT sit in their own column from sm up; on phones that column
              is 55px of mostly-empty width, so the badges ride with the name. */}
          {(mobileBadges || badgesAlways) && (e.drs || e.inPits || e.outLap) && (
            <span className={`flex shrink-0 gap-1 ${badgesAlways ? "" : "sm:hidden"}`}>
              {e.drs && <span className="pill bg-sky-500/15 text-sky-600">DRS</span>}
              {e.inPits && <span className="pill bg-amber-500/15 text-warn">PIT</span>}
              {e.outLap && !e.inPits && <span className="pill bg-surface2 text-medium">OUT</span>}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-light">
          {match?.teamName || carLabel(e.carName) || NO_VALUE}
        </span>
      </span>
      {e.raceNumber != null && (
        <span className="ml-1 hidden font-mono text-xs font-bold text-faint xl:inline">#{e.raceNumber}</span>
      )}
    </div>
  );
}

// A row in the "On Track Now" table — live current lap, and either the delta to
// the driver's own best (practice, qualifying) or the gap to the leader (race).
function OnTrackRow({ e, match, index = 0, isRace = false, raceStartedAt = null }) {
  const deltaCls = e.deltaSelfMs == null ? "text-light" : e.deltaSelfMs < 0 ? "text-ok" : "text-warn";
  return (
    <tr
      data-flip-id={e.guid}
      style={{ "--i": Math.min(index, 16) }}
      // A leaver (race sessions keep them listed so the finishing order holds)
      // dims but stays in their slot.
      className={`border-b border-border last:border-0 transition hover:bg-surface2 ${e.onTrack ? "" : "opacity-55"}`}
    >
      <td className="py-3 pl-3.5 pr-2 text-center sm:pl-5">
        {/* The safety car is on the road but not in the race, so it carries no
            position — the board ranks it last precisely so it doesn't take a
            number off a driver. */}
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-display font-black tabular-nums ${
            e.isSafetyCar ? "bg-amber-500/15 text-[11px] text-warn" : "text-base text-medium"
          }`}
        >
          {e.isSafetyCar ? "SC" : e.position}
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
        {/* One fixed line, whatever the driver is doing. A running clock, "In
            pit" at 11px and the "Left" pill are three different type sizes, and
            left to themselves they settle into boxes a pixel apart, which is a
            pixel the whole row moves every time somebody pits. */}
        <span className="flex h-6 items-center justify-end">
          {e.onTrack ? (
            <CurrentLap
              lastLapAt={e.lastLapAt}
              inPits={e.inPits}
              outLap={e.outLap}
              startedAt={isRace && !e.lapCount ? raceStartedAt : null}
            />
          ) : (
            <span className="pill bg-surface2 font-mono text-light">Left</span>
          )}
        </span>
        {/* Outside a race this line is part of the row's shape, in all four
            states a driver can be in. A car in the pits or gone to the garage
            has nothing to show there and shows nothing, but it keeps the space:
            leftover splits under "In pit" would read as progress, and a line
            that disappears with them resizes the row. */}
        {!isRace && (
          <BuildingSectors
            sectors={e.onTrack && !e.inPits ? e.currentSectors : null}
            lastLapAt={e.lastLapAt}
            outLap={!e.onTrack || e.inPits || e.outLap}
          />
        )}
      </td>
      <td className="hidden py-3 pr-4 text-right sm:table-cell">
        {isRace ? (
          <span
            className={`font-mono text-sm tabular-nums ${e.lapsDown > 0 ? "text-light" : "text-medium"}`}
            title="Behind the leader"
          >
            {e.isSafetyCar ? NO_VALUE : formatRaceGap(e.gapToLeaderMs, e.lapsDown)}
          </span>
        ) : (
          <span className={`font-mono text-sm tabular-nums ${deltaCls}`}>{formatDelta(e.deltaSelfMs)}</span>
        )}
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
        <span className="font-mono text-sm text-light">{e.ping ?? NO_VALUE}</span>
      </td>
      {/* Reserved, exactly like the same column in the other table: an inactive
          badge is invisible rather than absent, so a driver hitting the pit lane
          neither grows the row nor widens this column into its neighbours. */}
      <td className="py-3 pr-5 text-right">
        <div className="flex justify-end gap-1.5">
          <span className={`pill ${BADGE_BOX} bg-sky-500/15 text-sky-600 ${e.drs ? "" : "invisible"}`}>DRS</span>
          {/* PIT and OUT share the slot: a car is either in the pit lane or
              out of it, never both, and the two words are the same width. */}
          {e.outLap && !e.inPits ? (
            <span className={`pill ${BADGE_BOX} bg-surface2 text-medium`} title="Out lap: not a timed lap">
              OUT
            </span>
          ) : (
            <span className={`pill ${BADGE_BOX} bg-amber-500/15 text-warn ${e.inPits ? "" : "invisible"}`}>PIT</span>
          )}
        </div>
      </td>
    </tr>
  );
}

// The fifth column answers a different question in a race. How your lap is
// going against your own best is a practice question; in a race what everyone
// looks for is how far up the road the leader is.
const ontrackCols = (isRace) => [
  // pl-3.5: with the card's 1px border and the 2px the fixed-width cell leaves
  // when it centres the 32px chip, that lands the chip ~17px from the card's
  // left edge — matching the ~16.5px it sits below the row's top edge.
  { label: "Pos", cls: "w-14 py-3 pl-3.5 text-center sm:pl-5" },
  { label: "Driver", cls: "py-3 pl-1" },
  { label: "Tyre", cls: "hidden py-3 pr-4 text-center sm:table-cell" },
  { label: "Current", cls: "py-3 pr-4 text-right" },
  { label: isRace ? "Gap" : "Δ PB", cls: "hidden py-3 pr-4 text-right sm:table-cell" },
  { label: "Last", cls: "hidden py-3 pr-4 text-right md:table-cell" },
  { label: "Best", cls: "py-3 pr-4 text-right" },
  { label: "Laps", cls: "hidden py-3 pr-4 text-center md:table-cell" },
  { label: "Pits", cls: "hidden py-3 pr-4 text-center lg:table-cell" },
  { label: "Ping", cls: "hidden py-3 pr-4 text-right lg:table-cell" },
  { label: "", cls: "py-3 pr-5" },
];

/* ===== Session Best Times: the columns ==================================== */
//
// One entry per column of the classification, in table order. Everything about a
// column lives in its entry — the header, how a cell renders, what sorting by it
// means — so the table itself is a loop and adding a column is one object here.
//
// The order is the reading order of a timing screen: who, how fast, how far
// behind — best lap and gap come first, then the sectors that explain them, then
// the last lap. It matters most on a phone, where the table scrolls sideways and
// only the first columns are on screen: the three wide sector chips used to sit
// in front of the lap time everyone came for. Somebody who picked their own
// columns gets this order too — the picker remembers WHICH columns, never their
// arrangement (hooks/useLiveTablePrefs.js).
//
//   bp      the width from which the column appears in AUTOMATIC mode ("" =
//           always). A phone gets the essentials, a wide monitor the lot.
//   optIn   not in the automatic set at all: only shows if someone ticks it in
//           the Table menu. Answers that are interesting to ask for and clutter
//           the rest of the time.
//   locked  can't be switched off (position, driver, best lap: without those
//           three the board isn't a classification).
//   sortValue / sortDir  makes the column sortable, and says which way round it
//           reads naturally (lap times low to high, speeds and laps high to low).
//
// See components/LiveTableMenu.jsx for the picker and hooks/useLiveTablePrefs.js
// for what gets remembered.
const TIMING_COLUMNS = [
  {
    key: "pos",
    label: "Pos",
    locked: true,
    bp: "",
    align: "center",
    extraCls: "w-14",
    padCls: "pl-3.5 pr-2 sm:pl-5",
    // Same treatment as the Driving-now table: the pace car holds no position,
    // and the two tables sit one above the other, so they had better agree.
    cell: (e) => (
      <span
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-display font-black tabular-nums ${
          e.isSafetyCar
            ? "bg-amber-500/15 text-[11px] text-warn"
            : e.position === 1
              ? "bg-brand text-base text-ink"
              : "text-base text-medium"
        }`}
      >
        {e.isSafetyCar ? "SC" : e.position}
      </span>
    ),
  },
  {
    key: "driver",
    label: "Driver",
    locked: true,
    bp: "",
    align: "left",
    padCls: "pl-1 pr-3",
    // The column that absorbs the slack. Everything else is numbers and sizes
    // itself to its digits; this one takes what is left, so a PIT badge popping
    // in beside a name on a phone (where the badges have no column of their
    // own) eats into the name's own width instead of shoving every number in
    // the row sideways. The name already truncates, so it has room to give.
    extraCls: "w-full",
    cell: (e, ctx) => (
      <DriverCell
        e={e}
        match={ctx.match(e.name)}
        showLiveDot
        mobileBadges={ctx.badges === "mobile"}
        badgesAlways={ctx.badges === "always"}
      />
    ),
  },
  {
    key: "number",
    label: "No.",
    sortLabel: "Race number",
    optIn: true,
    align: "center",
    hint: "The number on the car",
    sortValue: (e) => e.raceNumber ?? null,
    cell: (e) => (
      <span className="font-mono text-sm font-bold tabular-nums text-light">
        {e.raceNumber != null ? `#${e.raceNumber}` : NO_VALUE}
      </span>
    ),
  },
  {
    key: "car",
    label: "Car",
    optIn: true,
    align: "left",
    hint: "Which car they're driving",
    cell: (e) => (
      <span className="block max-w-[12rem] truncate text-xs text-light" title={e.carName || ""}>
        {carLabel(e.carName) || NO_VALUE}
      </span>
    ),
  },
  {
    key: "best",
    label: "Best",
    sortLabel: "Best lap",
    locked: true,
    bp: "",
    align: "right",
    sortValue: (e) => e.bestLapMs || null,
    sortDir: "asc",
    // The quickest lap of the session is written in the fastest-lap purple —
    // the shared --c-fl token the sector chips and the FL badge already use, so
    // the convention reads the same everywhere. It used to be brand pink on
    // whoever sat P1, which is the same driver in practice and qualifying (the
    // board is ranked by best lap there) but NOT in a race, where P1 is the
    // leader and the purple lap can be six rows down.
    cell: (e, ctx) => (
      <>
        <span
          className={`font-mono text-base font-bold tabular-nums ${
            e.bestLapMs && e.bestLapMs === ctx.fastestLapMs ? "text-fl" : "text-dark"
          }`}
        >
          {formatLap(e.bestLapMs)}
        </span>
        {/* When the gap has no column of its own it sits directly under the lap
            it refers to: on phones in automatic mode (where the Gap column is
            sm-and-up), and at any width for someone who switched that column
            off. Nothing for the leader (gap 0) or a driver without a time. */}
        {e.gapToBestMs && ctx.inlineGap !== "never" ? (
          <span
            className={`block font-mono text-xs tabular-nums text-light ${
              ctx.inlineGap === "mobile" ? "sm:hidden" : ""
            }`}
          >
            {formatGap(e.gapToBestMs)}
          </span>
        ) : null}
      </>
    ),
  },
  {
    key: "gap",
    label: "Gap",
    // Left deliberately plain: this column means two different things depending
    // on the session, and the menu row that shows this string has no way of
    // knowing which. The hint below spells both out.
    sortLabel: "Gap",
    bp: "sm",
    align: "right",
    // In a race this is distance up the road; anywhere else it is lap time. The
    // board only fills in the race numbers during a race, so the column can
    // simply prefer them wherever they exist — no session type to thread in.
    hint: "In a race: behind the leader. Otherwise: off the fastest lap.",
    sortValue: (e) => (e.gapToLeaderMs != null || e.lapsDown > 0 ? (e.lapsDown || 0) * 1e7 + (e.gapToLeaderMs ?? 0) : e.gapToBestMs ?? null),
    sortDir: "asc",
    cell: (e) =>
      e.gapToLeaderMs != null || e.lapsDown > 0 ? (
        <span className="font-mono text-sm tabular-nums text-light" title="Behind the leader">
          {formatRaceGap(e.gapToLeaderMs, e.lapsDown)}
        </span>
      ) : (
        <span className="font-mono text-sm tabular-nums text-light">{formatGap(e.gapToBestMs)}</span>
      ),
  },
  {
    key: "sectors",
    label: "Sectors",
    bp: "lg",
    align: "left",
    hint: "The three sectors of their best lap",
    cell: (e) => (
      <div className="flex gap-1">
        {e.sectors.map((s, i) => (
          <Sector key={i} s={s} />
        ))}
      </div>
    ),
  },
  {
    key: "last",
    label: "Last",
    sortLabel: "Last lap",
    bp: "sm",
    align: "right",
    hint: "Their most recent lap time",
    sortValue: (e) => e.lastLapMs || null,
    sortDir: "asc",
    cell: (e) => <span className="font-mono text-sm tabular-nums text-medium">{formatLap(e.lastLapMs)}</span>,
  },
  {
    key: "potential",
    label: "Potential",
    sortLabel: "Potential lap",
    bp: "md",
    align: "right",
    hint: "Their three best sectors added up",
    sortValue: (e) => e.potentialMs || null,
    sortDir: "asc",
    cell: (e) => (
      <span className="font-mono text-sm tabular-nums text-fl" title="Ideal lap (sum of best sectors)">
        {formatLap(e.potentialMs)}
      </span>
    ),
  },
  {
    key: "ideal",
    label: "Left",
    sortLabel: "Time left on the table",
    optIn: true,
    align: "right",
    hint: "Between their best lap and their potential one",
    sortValue: (e) => (e.bestLapMs && e.potentialMs ? e.bestLapMs - e.potentialMs : null),
    sortDir: "desc",
    cell: (e) => {
      const left = e.bestLapMs && e.potentialMs ? e.bestLapMs - e.potentialMs : null;
      return (
        <span
          className="font-mono text-sm tabular-nums text-light"
          title="How much quicker their potential lap is than their best one"
        >
          {left == null ? NO_VALUE : (left / 1000).toFixed(3)}
        </span>
      );
    },
  },
  {
    key: "interval",
    label: "Int.",
    sortLabel: "Interval",
    optIn: true,
    align: "right",
    hint: "To the car ahead: on the road in a race, on best lap otherwise",
    cell: (e, ctx) =>
      ctx.isRace ? (
        <span className="font-mono text-sm tabular-nums text-light" title="Gap to the car ahead on the road">
          {e.lapsDown > 0 && e.intervalMs == null ? NO_VALUE : formatGap(e.intervalMs)}
        </span>
      ) : (
        <span className="font-mono text-sm tabular-nums text-light" title="Gap to the car ahead on best lap">
          {formatGap(ctx.intervals.get(e.guid) ?? null)}
        </span>
      ),
  },
  {
    key: "delta",
    label: "Δ PB",
    sortLabel: "Delta to personal best",
    optIn: true,
    align: "right",
    hint: "How their current lap compares to their own best",
    sortValue: (e) => e.deltaSelfMs ?? null,
    sortDir: "asc",
    cell: (e) => (
      <span
        className={`font-mono text-sm tabular-nums ${
          e.deltaSelfMs == null ? "text-light" : e.deltaSelfMs < 0 ? "text-ok" : "text-warn"
        }`}
      >
        {formatDelta(e.deltaSelfMs)}
      </span>
    ),
  },
  {
    key: "laps",
    label: "Laps",
    sortLabel: "Laps done",
    bp: "md",
    align: "center",
    hint: "How many laps they've completed",
    sortValue: (e) => e.lapCount || 0,
    sortDir: "desc",
    cell: (e) => <span className="font-mono text-sm tabular-nums text-medium">{e.lapCount}</span>,
  },
  {
    key: "tyre",
    label: "Tyre",
    bp: "lg",
    align: "center",
    hint: "The compound their best lap was set on",
    cell: (e) =>
      e.tyre ? (
        <span className="inline-grid place-items-center align-middle" title={tyreCompound(e.tyre).name}>
          <TyreBadge t={tyreCompound(e.tyre)} size={22} />
        </span>
      ) : null,
  },
  {
    key: "top",
    label: "Top",
    sortLabel: "Top speed",
    bp: "xl",
    align: "right",
    hint: "Fastest they went on their best lap, in km/h",
    sortValue: (e) => e.topSpeed || null,
    sortDir: "desc",
    cell: (e) => (
      <span className="font-mono text-sm tabular-nums text-light" title="Top speed on their best lap (km/h)">
        {formatSpeed(e.topSpeed)}
      </span>
    ),
  },
  {
    key: "pits",
    label: "Pits",
    sortLabel: "Pit stops",
    bp: "xl",
    align: "center",
    hint: "Number of pit stops",
    sortValue: (e) => e.numPits || 0,
    sortDir: "desc",
    cell: (e) => <span className="font-mono text-sm tabular-nums text-light">{e.numPits}</span>,
  },
  {
    key: "ping",
    label: "Ping",
    bp: "xl",
    align: "right",
    hint: "Their connection to the server",
    sortValue: (e) => (e.onTrack ? e.ping ?? null : null),
    sortDir: "asc",
    cell: (e) => (
      <span className="font-mono text-sm tabular-nums text-light">
        {e.onTrack && e.ping != null ? e.ping : NO_VALUE}
      </span>
    ),
  },
  {
    key: "flags",
    label: "",
    sortLabel: "DRS / pit flags",
    bp: "sm",
    align: "right",
    hint: "The DRS and PIT badges",
    // Both badges are always in the row and an inactive one is invisible rather
    // than absent. A pill is taller AND wider than the digits it sits beside, so
    // one that comes and goes did two ugly things at once every time a driver
    // hit the pit lane: it grew the row by a pixel, and it widened this column,
    // which squeezed every other column and slid the numbers sideways.
    cell: (e) => (
      <div className="flex justify-end gap-1.5">
        <span className={`pill ${BADGE_BOX} bg-sky-500/15 text-sky-600 ${e.drs ? "" : "invisible"}`}>DRS</span>
        {/* PIT and OUT share the slot: a car is either in the pit lane or
            out of it, never both, and the two words are the same width. */}
        {e.outLap && !e.inPits ? (
          <span className={`pill ${BADGE_BOX} bg-surface2 text-medium`} title="Out lap: not a timed lap">
            OUT
          </span>
        ) : (
          <span className={`pill ${BADGE_BOX} bg-amber-500/15 text-warn ${e.inPits ? "" : "invisible"}`}>PIT</span>
        )}
      </div>
    ),
  },
];

// Written out in full rather than built from the breakpoint name: Tailwind reads
// the source as text to decide which classes to generate, and a class assembled
// at runtime (`hidden ${bp}:table-cell`) is one it never sees.
const BP_HIDE = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

// The <th>/<td> classes for one column: its alignment, the padding that depends
// on where in the row it sits, and — in automatic mode only — the breakpoint
// below which it stays out of the way. Once someone has picked their own
// columns there is nothing to hide: what they asked for shows at every width and
// the table scrolls sideways instead.
function cellClass(col, { first, last, auto }) {
  const align = col.align === "center" ? "text-center" : col.align === "left" ? "text-left" : "text-right";
  const pad = col.padCls || (first ? "pl-3.5 pr-2 sm:pl-5" : last ? "pr-5" : "pr-4");
  const hide = auto && col.bp ? BP_HIDE[col.bp] || "" : "";
  return `py-3 whitespace-nowrap ${align} ${pad} ${hide} ${col.extraCls || ""}`;
}

// Gap to the car AHEAD on best lap. Computed off the best-lap ranking rather
// than off the rows above it in the table, so the column keeps meaning the same
// thing when the board is sorted by top speed or laps.
function intervalMap(entries) {
  const ranked = entries.filter((e) => e.bestLapMs).sort((a, b) => a.bestLapMs - b.bestLapMs);
  const m = new Map();
  ranked.forEach((e, i) => m.set(e.guid, i === 0 ? 0 : e.bestLapMs - ranked[i - 1].bestLapMs));
  return m;
}

// Re-order the board for display. No sort key = the session's own order, exactly
// as the server ranked it (race running order, or fastest lap in a practice
// session). A driver with nothing in the sorted column always sits at the bottom,
// whichever way round it is, and ties fall back to that session order.
function sortEntries(entries, sort) {
  const col = sort?.key ? TIMING_COLUMNS.find((c) => c.key === sort.key) : null;
  if (!col?.sortValue) return entries;
  const dir = sort.dir === "desc" ? -1 : 1;
  return [...entries].sort((a, b) => {
    const va = col.sortValue(a);
    const vb = col.sortValue(b);
    if (va == null && vb == null) return a.position - b.position;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va === vb) return a.position - b.position;
    return (va - vb) * dir;
  });
}

function SortArrow({ dir }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden="true">
      {dir === "desc" ? <path d="M12 19L5 8h14z" /> : <path d="M12 5l7 11H5z" />}
    </svg>
  );
}

function TimingRow({ e, cols, ctx, index = 0 }) {
  const isP1 = e.position === 1;
  return (
    <tr
      // Whenever the order changes — someone sets a faster lap, or the sort key
      // switches to top speed — the row glides to its new slot instead of the
      // table snapping (useFlipList, keyed on this id).
      data-flip-id={e.guid}
      style={{ "--i": Math.min(index, 16) }}
      className={`group border-b border-border last:border-0 transition hover:bg-surface2 ${
        isP1 ? "bg-brand/5" : ""
      }`}
    >
      {cols.map((col, i) => (
        <td
          key={col.key}
          className={cellClass(col, { first: i === 0, last: i === cols.length - 1, auto: ctx.auto })}
        >
          {col.cell(e, ctx)}
        </td>
      ))}
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
//
// Two things the first version got wrong, both of which lit the whole field up
// at once on race night and were only visible on a full 38-car grid:
//
//   * It measured each row against the VIEWPORT, and only re-measured when the
//     order changed. Anything else that moved the table on the page in between
//     — the pit-lane card next door growing a row, the page scrolling — left
//     every stored position stale, and the next single overtake then looked
//     like all thirty-eight rows had moved. Offsets are taken inside the
//     container now, so only movement within the list counts.
//   * It flashed on any movement. A row that shifts because somebody above it
//     was inserted or removed has not gained or lost anything, so the flash is
//     a lie. The direction is decided by rank among the rows present BOTH times
//     now; rows still glide either way, they just don't claim an overtake.
function useFlipList(containerRef, dep) {
  const prev = useRef({ offsets: new Map(), order: [] });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const items = [...el.querySelectorAll("[data-flip-id]")];
    const base = el.getBoundingClientRect().top;
    const next = new Map(items.map((it) => [it.dataset.flipId, it.getBoundingClientRect().top - base]));
    const order = items.map((it) => it.dataset.flipId);
    const skip =
      document.documentElement.classList.contains("fx-lite") ||
      (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (!skip) {
      // Ranks among the rows that were here last time and are still here, so an
      // arrival or a departure elsewhere in the list doesn't read as a place
      // gained or lost.
      const wasHere = new Set(prev.current.order);
      const isHere = new Set(order);
      const rankNow = new Map(order.filter((id) => wasHere.has(id)).map((id, i) => [id, i]));
      const rankBefore = new Map(prev.current.order.filter((id) => isHere.has(id)).map((id, i) => [id, i]));

      for (const it of items) {
        const id = it.dataset.flipId;
        const before = prev.current.offsets.get(id);
        if (before == null) continue;
        const delta = before - next.get(id);
        if (Math.abs(delta) < 2) continue;
        const from = rankBefore.get(id);
        const to = rankNow.get(id);
        const overtook = from != null && to != null && from !== to;
        it.style.transition = "none";
        it.style.transform = `translateY(${delta}px)`;
        it.classList.remove("proj-flash-up", "proj-flash-down");
        void it.offsetHeight; // commit the start position before releasing
        // A position change is exactly the kind of thing the scale calls
        // --t-tell: long enough to be watched. The curve used to be a sixth,
        // hand-written one that differed from --e-out only in its second
        // control point, which is the sort of near-twin the scale exists to
        // stop. Both come from index.css now, so a row overtaking another moves
        // on the same beat as everything else on the site.
        it.style.transition = "transform var(--t-tell) var(--e-out)";
        it.style.transform = "";
        if (overtook) {
          it.classList.add(to < from ? "proj-flash-up" : "proj-flash-down");
          it.addEventListener(
            "animationend",
            () => it.classList.remove("proj-flash-up", "proj-flash-down"),
            { once: true }
          );
        }
        // Hand the row's transitions back once it has arrived. The inline
        // property above is transform-only, so leaving it in place would
        // permanently cancel the row's own hover fade — which used to be a
        // curiosity on a table that reorders a few times a race, and is not one
        // on the timing board, where every faster lap moves somebody.
        it.addEventListener("transitionend", () => { it.style.transition = ""; }, { once: true });
      }
    }
    prev.current = { offsets: next, order };
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
        up ? "bg-emerald-500/15 text-ok" : "bg-red-500/10 text-bad"
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
                  <span className="ml-2 font-mono text-xs font-bold tabular-nums text-ok">+{t.gained}</span>
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
  // (Declared BEFORE its first use: reading `rows` a line above its `const`
  // threw on every render, and the whole Standings view fell into the error
  // boundary the one day a year it is actually on screen.)
  const rows = data.drivers.filter((d) => d.livePosition != null || d.dnf || d.total > 0 || d.currentTotal > 0);
  const rowsIn = useOneShotCascade(rows.length > 0);
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
            {data.simulated && <span className="pill bg-amber-500/15 text-warn">Demo</span>}
            <span className="inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">
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
              <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-widest text-light">
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
            {/* One-shot only (see useOneShotCascade): a cascade left attached
                would REPLAY on every overtake, because reordering moves the DOM
                nodes, and the table would look like it was rebuilding itself.
                After the first fill the FLIP glide is the only movement. */}
            <tbody ref={bodyRef} className={rowsIn}>
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
                      <span className="pill bg-red-500/10 font-mono text-bad">DNF</span>
                    ) : (
                      <NoData className="font-mono text-xs" />
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
                      <span className="ml-2 font-mono text-xs font-bold tabular-nums text-ok">+{d.gained}</span>
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
          className={`transition ${base} bg-brand text-ink shadow-lg shadow-brand/25 hover:brightness-105`}
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
          className={`transition ${base} border border-border bg-card text-dark hover:bg-surface2`}
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
          className={`transition ${base} border border-[#FF424D]/40 bg-[#FF424D]/10 text-[#FF424D] hover:bg-[#FF424D]/20`}
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

// The race stream, when someone is broadcasting it: a YouTube or Twitch player
// sitting above the track map, from a single link in the admin's Social & Live
// tab. Nothing renders when no link is set (the normal state) or when the link
// isn't a platform we can embed, so a typo costs an empty card, not a broken
// one. The frame itself is only created once a visitor presses play — see
// VideoEmbed — so a race-night crowd doesn't all load Twitch's player for a
// stream most of them are watching in another tab anyway.
// "Twitch ↗" / "YouTube ↗" — out to the platform's own page, for anyone who
// would rather watch it there (chat, full screen, a second monitor).
function StreamLink({ url, stream }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="font-mono text-[11px] uppercase tracking-wider text-light transition hover:text-dark"
    >
      {stream.kind === "twitch" ? "Twitch" : "YouTube"} ↗
    </a>
  );
}

// Live track map card. Prefers the REAL overhead map with cars at their surveyed
// world positions (session.map calibration present); otherwise the stylised
// circuit outline with dots walked along the lap. Unknown circuits with no real
// map get a quiet, intentional fallback instead of a blank hole.
// Shares a row with the session card on lg+ (the map used to be its own
// full-width section, which was mostly empty margin), so the heading moved
// inside the card as a compact header strip.
function TrackMapSection({ session, entries, match, follow, onCarTelemetry, streamUrl, server, className = "" }) {
  const realMap = session.map || null;
  // Live sessions carry the mod's display name ("NABS Monza F1 2025") which the
  // tidy resolver can't place, so try the AC id (session.track) too.
  const stylised = circuitForLive(session.trackName, session.track);
  const hasMap = !!realMap || !!stylised;
  const cars = entries.filter((e) => e.onTrack || e.inPits);
  // With a stream configured, map and player SHARE this card and a switch picks
  // between them, rather than stacking two tall windows down a narrow column.
  // No stream link, no switch — the card is the map, exactly as before.
  const stream = useMemo(() => streamEmbed(streamUrl), [streamUrl]);
  const [view, setView] = useState("map");
  const showStream = !!stream && view === "stream";
  return (
    <section className={`reveal card flex flex-col overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
          {showStream ? "Stream" : "Track map"}
        </span>
        {showStream ? (
          <span className="ml-auto">
            <StreamLink url={streamUrl} stream={stream} />
          </span>
        ) : (
          <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-light">
            {cars.filter((c) => !c.inPits).length} on track
          </span>
        )}
        {stream && (
          <SlidingTabs
            className="w-full sm:w-auto"
            items={[
              { key: "map", label: "Map" },
              { key: "stream", label: "Stream" },
            ]}
            value={view}
            onChange={setView}
            btnClassName="flex-1 px-3 py-1 text-[11px] font-bold uppercase tracking-wider sm:flex-none"
          />
        )}
      </div>
      {showStream ? (
        <VideoEmbed embedUrl={stream.embedUrl} poster={false} title={stream.title} accent={stream.accent} />
      ) : (
      <div className="p-3 sm:p-4">
        {hasMap ? (
          <>
            <LiveTrackMap
              track={session.trackName || session.track}
              cars={cars}
              matchFn={match}
              map={realMap}
              follow={follow}
              onCarTelemetry={onCarTelemetry}
              server={server}
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
            <p className="font-mono text-[13px] uppercase tracking-wider">No map for this circuit yet</p>
            <p className="mt-1 text-sm">{session.trackName || session.track || "Unknown track"}</p>
          </div>
        )}
      </div>
      )}
    </section>
  );
}

// "Driving now" — the cars currently out on track, sat left of the map so the
// two share one row and read as a single "what's happening right now" block.
// The list scrolls INSIDE the card (capped height, sticky column header), so a
// packed server never turns the page into one endless table; the map column
// next door stays in proportion. Empty state (nobody out) keeps the panel
// instead of vanishing.
function DrivingNowSection({ onTrack, match, flip = false, isRace = false, raceStartedAt = null, className = "" }) {
  const cols = ontrackCols(isRace);
  // During a RACE an overtake FLIP-glides the two rows into their new slots
  // (green flash = gained, red = lost) instead of the order snapping — the
  // same useFlipList the championship projection uses, with the same lite-
  // graphics/reduced-motion opt-out. Practice/quali keep the plain re-sort:
  // there the order is a leaderboard, not on-track position.
  const bodyRef = useRef(null);
  const offRef = useRef(null);
  useFlipList(flip ? bodyRef : offRef, onTrack.map((e) => e.guid).join("|"));
  const rowsIn = useOneShotCascade(onTrack.length > 0);
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
              <tr className="text-left font-mono text-[11px] font-bold uppercase tracking-widest text-light">
                {cols.map((c, i) => (
                  // sticky per-cell (sticky thead still doesn't scroll along in
                  // every browser); shadow stands in for the border, which
                  // wouldn't travel with the sticky cells either
                  <th key={i} className={`${c.cls} sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--c-border)]`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            {/* One-shot only (see useOneShotCascade): a websocket hiccup or a
                reorder remounts rows, and a cascade still attached REPLAYED the
                entrance fade over the whole field mid-session. */}
            <tbody ref={bodyRef} className={rowsIn}>
              {onTrack.map((e, i) => (
                <OnTrackRow key={e.guid} e={e} match={match(e.name)} index={i} isRace={isRace} raceStartedAt={raceStartedAt} />
              ))}
            </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-12 text-center">
          <p className="font-mono text-[13px] uppercase tracking-wider text-light">No cars out on track</p>
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
                  <span className="block truncate text-[11px] text-light">{m?.teamName || NO_VALUE}</span>
                </span>
                {/* The same badge as everywhere else a compound is named — the
                    two timing tables, the strategy bars and their key. This one
                    used to draw its own square chip, so the one panel that says
                    what a car is sitting on had the odd shape out. */}
                {t && (
                  <span className="inline-grid shrink-0 place-items-center" title="Current compound">
                    <TyreBadge t={t} size={22} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Exactly as tall as one entry, so the FIRST car to pit swaps this line
           for a name without the card changing size. It used to be taller than
           an entry, which meant the panel jumped SMALLER the moment somebody
           pitted, and dragged the card beside it down with it. */
        <div className="flex min-h-[56.5px] flex-1 items-center justify-center px-4 py-4 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wider text-light">Pit lane is empty</p>
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

// An entrance for a live table's rows that plays once and then gets out of the
// way.
//
// The plain .cascade cannot stay on these tables and the comments at each of
// them say why: the rows are reordered constantly, every overtake and every
// faster lap moves the DOM nodes, and a cascade still attached REPLAYS over the
// whole field each time — the table appears to rebuild itself several times a
// minute. That is why it was taken out.
//
// But "never animates" and "animates on every overtake" are not the only two
// options. The class goes on for the first fill and comes off once that has
// played, so the rows arrive one after another exactly once and no reorder
// afterwards has anything left to trigger. Taking the class away is safe on its
// own: without it the rows are simply at their natural full opacity.
function useOneShotCascade(ready) {
  const [spent, setSpent] = useState(false);
  useEffect(() => {
    if (!ready || spent) return;
    // The stagger caps at 16 rows x 45ms and each row rises for 450ms, so the
    // last of them is done inside 1.2s; 1.6s leaves room for the reveal delay.
    const t = setTimeout(() => setSpent(true), 1600);
    return () => clearTimeout(t);
  }, [ready, spent]);
  return ready && !spent ? "cascade" : "";
}
// One thing this costs, and it is the right trade: while the entrance is
// playing, its keyframes animate transform, and a CSS animation outranks the
// inline transform useFlipList uses for its glide. So a reorder inside that
// first second and a half does not glide. Rows are still arriving then, and the
// alternative was no entrance at all.

// Nothing is running. The league races roughly once a week, so this is what
// the page looks like most of the time, and it used to be an endless spinner
// reading "Waiting for the server…" — which says "this is broken" far more than
// it says "come back on Friday". Say so plainly instead, and answer the
// question the visitor actually came with: when is the next one.
function OffAir({ nextRace }) {
  const kick = nextRace?.date ? raceKickoff(nextRace.date) : null;
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center sm:py-20">
      <svg viewBox="0 0 24 24" className="h-9 w-9 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12h8" />
      </svg>
      <h2 className="mt-4 font-display text-xl font-extrabold uppercase tracking-tight text-dark">
        No session running
      </h2>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-medium">
        Live timing comes to life when a race server is up. Nothing is on track right now.
      </p>

      {nextRace && (
        <div className="mt-6 w-full max-w-sm rounded-xl border border-border bg-surface2 p-4">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
            {nextRace.seasonName ? `Next up · ${nextRace.seasonName}` : "Next up"}
          </div>
          <div className="mt-1 font-display text-lg font-extrabold uppercase tracking-tight text-dark">
            {nextRace.track}
          </div>
          {/* Date AND time. fmtRaceTime deliberately returns the time alone
              (callers pair it with their own date), and on a page you might open
              a fortnight out, "19:00 CEST" on its own answers nothing. */}
          {kick && (
            <div className="mt-0.5 font-mono text-sm text-medium">
              {fmtRaceDate(nextRace.date)}
              {" · "}
              {fmtRaceTime(nextRace.date)}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="../races"
          relative="path"
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
        >
          Race calendar
        </Link>
        <Link
          to="../drivers"
          relative="path"
          className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-dark transition hover:bg-surface2"
        >
          Standings
        </Link>
      </div>
    </div>
  );
}

// How long a gap in the feed is treated as a hiccup rather than the end of the
// session. The relay's own reconnect backs off up to 15s and a quiet server can
// leave ~30s between snapshots, so anything under this is routine.
const LIVE_GRACE_MS = 40000;

// How long the page will wait for the relay's very first frame before it starts
// answering questions on its own. Long enough to cover a cold container and a
// phone on a bad connection; short enough that a genuinely unreachable relay
// does not leave someone watching a spinner and wondering.
const FIRST_FRAME_GRACE_MS = 5000;

// Hold on to the last board that carried a live session, and only let go of it
// once the feed has really been gone for a while.
//
// The page used to swap itself for the "No session running" card the instant one
// board arrived with the upstream marked closed — which happens routinely: the
// race server's socket gets dropped and reconnected, the API restarts, a
// snapshot is skipped. Every one of those blinks blanked the whole page for a
// second and then put it back. Nothing on screen was wrong in those moments, so
// the board simply stays; the "reconnecting" line under it carries the news, and
// only a real gap gives up on it.
function useHeldBoard(board) {
  const live = board?.session && board?.connected ? board : null;
  const [held, setHeld] = useState(null);
  useEffect(() => {
    if (live) {
      setHeld(live);
      return;
    }
    if (!held) return;
    const t = setTimeout(() => setHeld(null), LIVE_GRACE_MS);
    return () => clearTimeout(t);
  }, [live, held]);
  // `gap` = what's on screen is the last good board, not a current one.
  return { shown: live || held, gap: !live && !!held };
}

export default function Live() {
  const { board: feed, socketState, follow, onCarTelemetry, setServer, serverKey } = useLiveTiming();
  // Polled once here and handed to both pieces of the server switch: the
  // control in the header and the "cars are out over there" line under it.
  const liveServers = useLiveServers();
  const { shown: board, gap } = useHeldBoard(feed);
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const match = useMemo(() => makeDriverMatcher(teams), [teams]);
  // Admin-configured external buttons (server-manager live timing + CM join).
  const { data: extLinks } = useApi(useCallback(() => api.liveLinks(), []));
  // League social links — the Patreon button on the buttons row uses them.
  const social = useSocial();
  // Timing ⇄ Strategy switch (the track map sits above both).
  const [view, setView] = useState("timing");

  // The state of the feed RIGHT NOW (not of the board on screen, which may be a
  // held one): everything arriving, fresh, and our own socket up.
  const connected = feed?.connected && !feed?.stale && socketState === "open";
  const session = board?.session;

  // Has the relay said anything at all yet? `feed` is null only until the first
  // frame lands and never goes back to null, so this is precisely "we have been
  // told". Two ways out, and the page must not hang on either: a frame arrived,
  // or we have waited long enough that a spinner stops being honest.
  //
  // A closed socket deliberately does NOT count as an answer, tempting as it is.
  // The socket closes and reopens for ordinary reasons — the backend restarting
  // is the obvious one — and letting that count would put the wrong card on
  // screen for the second before the retry lands, which is the very flicker
  // this is here to remove. Waiting it out costs a few seconds in the rare case
  // where the relay really is gone, and the spinner is telling the truth the
  // whole time: it IS still trying.
  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    if (feed) return;
    const t = setTimeout(() => setWaitedOut(true), FIRST_FRAME_GRACE_MS);
    return () => clearTimeout(t);
  }, [feed]);
  const heardFromRelay = !!feed || waitedOut;
  // Off air = there is no session to show at all. Not "the upstream socket is
  // closed this second": that flaps (see useHeldBoard), and it used to blank the
  // page for a beat every time it did.
  //
  // The relay's `stale` flag ("no upstream data for 75 seconds") is deliberately
  // not part of this either. The league's servers sit in an open practice session
  // all week, and once nobody is driving the upstream goes quiet for far longer
  // than that — so the page answered "No session running" while a practice
  // session was up, with its entry list and everyone's best laps sitting in the
  // very snapshot it was hiding.
  //
  // A race server that really goes away still clears the page: the board it left
  // behind is dropped once the feed has been down for LIVE_GRACE_MS.
  //
  // …but only once the relay has actually told us something. "We have not been
  // told yet" is not "nothing is running", and treating them as the same thing
  // is what made this page flash "No session running" over a live race for the
  // first moment after it loaded.
  //
  // The old guard tried to cover this with `socketState !== "open"`, which
  // misses by exactly the window that matters: the socket reports itself OPEN
  // as soon as the handshake completes, and the relay only sends its first
  // snapshot AFTER a database read (which race server does this viewer's series
  // follow). So there is a stretch — a query plus a round trip, not a tick —
  // where the page is connected, knows nothing, and used to answer anyway.
  const offAir = heardFromRelay && !session;
  // A session that is there but has nothing happening in it. Perfectly normal on
  // any day that is not race day, and it must not be reported as a fault: the
  // board still holds what the session has produced so far.
  const idle = !offAir && !!board?.stale;
  // Only for the off-air card: what to point people at instead. The answer is
  // the whole reason someone opens this page on a non-race day.
  //
  // Two sources, because one is not enough at the moment it matters most. The
  // season's own calendar covers mid-season; between seasons every round is run
  // and it has nothing left to offer, which is exactly when the teaser (the
  // announced next season and its opener) has the answer. Both are public, so
  // this works for a logged-out visitor too.
  const racesApi = useApi(useCallback(() => api.races(), []));
  const teaserApi = useApi(useCallback(() => api.seasonTeaser(), []));
  const nextRace = useMemo(() => {
    const upcoming = (racesApi.data || [])
      .filter((r) => !r.isCompleted && r.date)
      .map((r) => ({ r, t: raceKickoff(r.date)?.getTime() ?? null }))
      .filter((x) => x.t != null && x.t > Date.now() - LIVE_WINDOW_MS)
      .sort((a, b) => a.t - b.t);
    if (upcoming[0]) return upcoming[0].r;
    const opener = teaserApi.data?.firstRace;
    return opener?.date ? { ...opener, seasonName: teaserApi.data?.name } : null;
  }, [racesApi.data, teaserApi.data]);
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
  // This poll is not the timing feed — that is the WebSocket in useLiveTiming,
  // which stays connected in a hidden tab so a viewer coming back has missed
  // nothing. Only this HTTP projection pauses, and it refetches on return
  // before anything is read off it (see useVisiblePoll).
  const [champ, setChamp] = useState(null);
  useVisiblePoll((alive) => {
    const demo = new URLSearchParams(window.location.search).has("demo");
    api
      // The projection has to be about the board on screen. Without the server
      // key a viewer who switched would be shown one server's running order
      // projected onto the standings, next to the other server's timing.
      .liveChampionship(demo, serverKey)
      .then((d) => alive() && setChamp(d))
      // A failed poll (server restart, hiccup) keeps the last table on
      // screen instead of tearing the whole section down and rebuilding it
      // on the next success; a real deactivation arrives as active:false.
      .catch(() => {});
    // serverKey in the dependency: switching servers has to refetch, or the
    // projection keeps describing the board that is no longer shown.
  }, 12000, true, serverKey); // matches the server-side 10s cache

  // The Standings view only exists while the projection is active (race day);
  // if it deactivates mid-visit the switch falls back to Timing.
  useEffect(() => {
    if (view === "standings" && champ && !champ.active) setView("timing");
  }, [champ, view]);

  // Which columns the classification shows and what it is sorted by. Remembered
  // per browser, so a reader who always wants top-speed order gets it without
  // asking twice (see hooks/useLiveTablePrefs.js).
  const tablePrefs = useLiveTablePrefs(TIMING_COLUMNS);
  const cols = tablePrefs.visible;
  const auto = !tablePrefs.custom;
  // Everything the cell renderers need beyond the entry itself. Two of them
  // depend on the chosen columns: the DRS/PIT badges and the gap under the best
  // lap only ride along with the driver's name while they have no column of
  // their own, otherwise the same fact would be on the row twice.
  const tableCtx = useMemo(
    () => ({
      match,
      auto,
      isRace: session?.type === "Race",
      intervals: intervalMap(entries),
      // The quickest lap on the board, so the Best column can put the
      // fastest-lap purple on the lap that actually earned it (see the "best"
      // column). Taken from the entries rather than session.bestLapMs: the two
      // arrive from different places and only the entries can be matched
      // against a row.
      fastestLapMs: entries.reduce((m, e) => (e.bestLapMs && (!m || e.bestLapMs < m) ? e.bestLapMs : m), null),
      badges: auto ? "mobile" : tablePrefs.enabled.has("flags") ? "none" : "always",
      inlineGap: auto ? "mobile" : tablePrefs.enabled.has("gap") ? "never" : "always",
    }),
    [match, auto, session?.type, entries, tablePrefs.enabled]
  );
  const ordered = useMemo(() => sortEntries(entries, tablePrefs.sort), [entries, tablePrefs.sort]);

  // Mobile: keep the classification to a single screenful, expandable on tap.
  const narrow = useIsNarrow();
  const [showAllTimes, setShowAllTimes] = useState(false);
  const TIMES_LIMIT = 10;
  const collapseTimes = narrow && !showAllTimes && ordered.length > TIMES_LIMIT;
  const shownEntries = collapseTimes ? ordered.slice(0, TIMES_LIMIT) : ordered;

  // Rows glide to their new slot whenever the order changes, with the short
  // green/red flash for the direction — a faster lap, or switching the sort to
  // top speed, moves the whole field visibly rather than redrawing it. Same
  // hook, dep shape and lite-graphics opt-out as the Driving Now table.
  //
  // The dep also carries the view and the mobile collapse: both move the table
  // on the page without reordering it, and re-measuring there keeps the next
  // real reorder from gliding out of a position the rows no longer have.
  const timesBodyRef = useRef(null);
  useFlipList(
    timesBodyRef,
    `${view}|${collapseTimes}|${shownEntries.map((e) => e.guid).join("|")}`
  );
  const rowsIn = useOneShotCascade(shownEntries.length > 0);

  // The best-times section renders in two spots — as the Timing view of the
  // full layout, and alone right under the header when the server is quiet —
  // so it lives in one place here.
  const bestTimes = (
    <>
      {/* ===== Full session-best leaderboard (all drivers) ===== */}
      <section className="reveal space-y-4">
        <SectionHeading
          eyebrow="Classification"
          // Same table, different question. In a race it arrives in running
          // order and the gap column reads as distance up the road, so calling
          // it a list of best times would be describing the wrong column.
          title={session?.type === "Race" ? "Race Order" : "Session Best Times"}
          // Sorting and the column picker sit on the heading's own row, right
          // above the table they change: two buttons, one question each.
          right={
            <div className="flex shrink-0 items-center gap-2">
              <LiveSortMenu columns={TIMING_COLUMNS} prefs={tablePrefs} />
              <LiveColumnsMenu columns={TIMING_COLUMNS} prefs={tablePrefs} />
            </div>
          }
        />
        {entries.length === 0 ? (
          <div className="card py-16 text-center text-light">
            Session is live, no times set yet.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="scrollbar-slim overflow-x-auto">
              {/* The min-width only applies in automatic mode, where it was
                  sized for the full desktop column set: it kicks in at md,
                  where those extra columns actually appear, so a phone
                  doesn't have to scroll sideways to reach Best. A chosen set
                  of columns takes whatever width it needs and scrolls. */}
              <table className={`w-full ${auto ? "md:min-w-[680px]" : ""}`}>
                <thead>
                  <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-widest text-light">
                    {cols.map((c, i) => {
                      const cls = cellClass(c, { first: i === 0, last: i === cols.length - 1, auto });
                      const active = tablePrefs.sort.key === c.key;
                      // A sortable header is a button: clicking it sorts by that
                      // column, clicking it again turns it round. Same thing the
                      // Table menu does, one tap closer.
                      return (
                        <th key={c.key} className={cls} aria-sort={active ? (tablePrefs.sort.dir === "desc" ? "descending" : "ascending") : "none"}>
                          {c.sortValue ? (
                            <button
                              type="button"
                              onClick={() => tablePrefs.setSort(c.key)}
                              title={`Sort by ${(c.sortLabel || c.label).toLowerCase()}`}
                              className={`inline-flex items-center gap-1 uppercase tracking-widest transition hover:text-dark ${
                                active ? "text-dark" : ""
                              }`}
                            >
                              {c.label}
                              {active && <SortArrow dir={tablePrefs.sort.dir} />}
                            </button>
                          ) : (
                            c.label
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                {/* One-shot only (see useOneShotCascade): reordering moves the
                    DOM nodes, and a cascade still attached REPLAYED the
                    entrance fade over the whole field on every faster lap. */}
                <tbody ref={timesBodyRef} className={rowsIn}>
                  {shownEntries.map((e, i) => (
                    <TimingRow key={e.guid} e={e} cols={cols} ctx={tableCtx} index={i} />
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
        {tablePrefs.enabled.has("sectors") && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-fl/40" /> Fastest sector
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-emerald-500/30" /> Personal best
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-red-500/25" /> Cut
            </span>
          </>
        )}
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> On track now
        </span>
        {tablePrefs.enabled.has("potential") && (
          <span className="text-faint">Potential = sum of best sectors</span>
        )}
        {tablePrefs.sort.key && (
          <span className="text-faint">
            Sorted by{" "}
            {(TIMING_COLUMNS.find((c) => c.key === tablePrefs.sort.key)?.sortLabel || "").toLowerCase()}
          </span>
        )}
      </div>
    </>
  );

  return (
    // content-in on the root, which is what every other page does. This one had
    // it on the inner board only, so the title and the buttons above simply
    // appeared while everything under them arrived.
    <div className="content-in">
      {/* No live/offline badge up here — the session card below already tells
          the story; only the admin-facing Demo pill remains. */}
      {/* The tour's stop for this page hangs on the header, not on the board:
          the board is only there while a session is running, which is one
          evening a week, and the tour has to have something to point at on the
          six days it isn't. */}
      <div data-tour="live-header">
      <PageHeader
        eyebrow="Real-time"
        title="Live Timing"
        // The external buttons share the title's row (right-aligned), so the
        // session card moves up to just under the header.
        right={
          <div className="flex w-full flex-col items-end gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
            {board?.demo && <span className="pill bg-amber-500/15 text-warn">Demo</span>}
            {/* The board names its own server, so the switch shows where the
                data actually comes from rather than what was last clicked. The
                two only diverge briefly — a click before the answer lands, a
                reconnect — but those are exactly the moments a wrong button
                would mislead. */}
            <LiveServerSwitch servers={liveServers} current={board?.serverKey || serverKey} onSwitch={setServer} />
            <ExternalButtons links={extLinks} patreonUrl={social.data?.patreon} />
          </div>
        }
      />
      </div>

      {!heardFromRelay && !board ? (
        // Still asking. This is the only case that gets a spinner, and it lasts
        // a moment — it used to be the ONLY state, which meant the page spun
        // forever on the six days a week when no session is running, and then
        // the fix for that overshot into asserting "No session running" before
        // anyone had checked. Waiting is its own answer and says so.
        //
        // Shaped like the card it may become, so the page does not jump when it
        // resolves either way.
        <div className="card flex flex-col items-center justify-center gap-3 px-6 py-14 text-center sm:py-20">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand" />
          <p className="font-mono text-[13px] uppercase tracking-wider text-light">Connecting to the server…</p>
        </div>
      ) : offAir ? (
        <OffAir nextRace={nextRace} />
      ) : (
        <div className="space-y-8">
          {/* ===== Session bar across the top ===== */}
          <SessionHeader session={session} receivedAt={receivedAt} />

          {quiet ? (
            // Empty server: the best-times board takes the "right now" slot,
            // everything else (driving now, map, pit lane, strategy) sits out —
            // and with the map goes the stream, which lives in that card as its
            // second view. A lone player floating over the best-times table was
            // the one thing on this page with nothing beside it.
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
              <TrackMapSection
                session={session}
                entries={entries}
                match={match}
                follow={follow}
                onCarTelemetry={onCarTelemetry}
                streamUrl={extLinks?.streamUrl}
                // The map image is fetched per server, so this has to travel
                // down with the rest: a map of the other circuit would be a
                // confident lie.
                server={board?.serverKey || serverKey}
              />
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
              isRace={session.type === "Race"}
              raceStartedAt={session.startedAt ?? null}
              className="lg:col-span-3 lg:col-start-1 lg:row-start-1"
            />
          </div>

          {/* ===== Timing / Strategy / Standings switch ===== */}
          <div className="reveal flex items-center justify-between gap-4">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
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

          {/* A quiet session and a broken connection both mean "these numbers
              are not moving", and they used to print the same alarming line.
              They are not the same thing: one is a Tuesday.
              A gap in the feed is the third case: the page is holding the last
              board it got (see useHeldBoard), and that is worth saying rather
              than tearing the page down over. */}
          {idle && !gap ? (
            <p className="text-center font-mono text-[11px] uppercase tracking-wider text-light">
              Nobody on track right now. Showing the session as it stands.
            </p>
          ) : gap || !connected ? (
            <p className="text-center font-mono text-[11px] uppercase tracking-wider text-warn">
              Connection lost. Showing last known data, reconnecting…
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
