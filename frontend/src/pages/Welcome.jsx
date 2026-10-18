import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Car,
  Check,
  Clock,
  Flag as FlagIcon,
  Layers,
  MessageCircleQuestion,
  Minus,
  Plus,
  Trophy,
  User,
  Users,
} from "lucide-react";
import { api } from "../api/client.js";
import { answerWords } from "../utils/signupAnswers.mjs";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeries, useSeriesPath } from "../context/SeriesContext.jsx";
import IdleFilm from "../components/IdleFilm.jsx";
import { useIdleFilm } from "../hooks/useIdleFilm.js";
import { Skeleton, CountUp, MEDAL, ErrorBox, DriverAvatar } from "../components/ui.jsx";
import { useParallax, useMagnetic, motionOff } from "../hooks/motion.js";
import Flag from "../components/Flag.jsx";
import CircuitMap from "../components/CircuitMap.jsx";
import { circuitMark } from "../components/NextRaceCard.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { useSocial } from "../components/SocialLinks.jsx";
import SocialFeed from "../components/SocialFeed.jsx";
import { flagFor } from "../data/circuits.js";
import { heroFor, carFor, heroOnError } from "../utils/heroImage.js";
import { nextUpcomingRace } from "../utils/raceFormat.js";
import { raceKickoff, racePhase } from "../utils/raceTime.js";
import { seasonGameParts } from "../utils/seasonGame.js";
import { disciplineOf } from "../utils/pageTitle.js";
import NextSeasonTeaser from "../components/NextSeasonTeaser.jsx";
import { useTour } from "../components/Tour.jsx";
import { singularOne } from "../utils/format.js";

// League default points per finishing position — only the fallback: seasons
// can override the table (Season.pointsTable), which /api/seasons delivers and
// the page prefers, so the copy below always matches the season being shown.
const DEFAULT_POINTS = [35, 30, 25, 22, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Discord's own blue (#5865F2) is the one colour on this page that is not a
// theme token, on purpose: it says "this is Discord" and nothing else does.

// How often the league races, read off the season's own calendar instead of
// asserted. The page says "run weekly" in two places, and that is exactly the
// kind of sentence nobody remembers to change: a season that moves to a round
// every other week would leave the newcomer page promising something the
// calendar contradicts. Returns null when the calendar has no clear rhythm, and
// then the claim is simply left out rather than guessed.
function raceCadence(races) {
  const dates = races
    .map((r) => (r.date ? new Date(r.date).getTime() : null))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (dates.length < 3) return null; // too few rounds to call it a rhythm
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(Math.round((dates[i] - dates[i - 1]) / 86400000));
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median >= 5 && median <= 10) return "weekly";
  if (median >= 11 && median <= 18) return "every other week";
  return null;
}

// Admin-edited FAQ answers are stored as plain strings; these two helpers turn
// them into JSX: fill() resolves {placeholders} from the season, rich() turns
// **spans** into a bold highlight (same convention as the Race Info page).
function fillFaq(s, tokens) {
  return singularOne(String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null && tokens[k] !== "" ? String(tokens[k]) : m)));
}
function richFaq(s) {
  const parts = String(s ?? "").split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return s;
  return parts.map((p, i) => (i % 2 ? <span key={i} className="font-semibold text-dark">{p}</span> : p));
}

// The sign-up answers in the colours the attendance page gives them, so the
// sentence already looks like the buttons a newcomer is about to press.
const ANSWER_TONE = { Accepted: "text-ok", Tentative: "text-warn", Declined: "text-bad" };
function answerSpans(statuses) {
  const parts = answerWords(statuses).split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 ? <b key={i} className={ANSWER_TONE[p] || "text-dark"}>{p}</b> : p));
}

// The community size is an approximation from Discord and moves by a few every
// week, so it is shown as "900+" rather than a precise 945 that is wrong an
// hour later.
const roundedMembers = (n) => (n >= 100 ? Math.floor(n / 100) * 100 : n);

function DiscordIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5a18.3 18.3 0 0 1 4.3 1.4 16.2 16.2 0 0 0-13 0A18.3 18.3 0 0 1 10.8 3.5L10.5 3A19.8 19.8 0 0 0 5.6 4.4 20.7 20.7 0 0 0 2 18.6 19.9 19.9 0 0 0 8 21l.5-1.7c-1-.3-1.9-.7-2.7-1.2l.6-.45a14.2 14.2 0 0 0 12.1 0l.6.45c-.85.5-1.75.9-2.7 1.2L17 21a19.9 19.9 0 0 0 6-2.4 20.7 20.7 0 0 0-2.7-14.2zM9 15.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z" />
    </svg>
  );
}

// Time to the next race in days, hours and minutes, for the two small
// countdowns on this page (the hero tile and the league pulse). Seconds would
// only make a small number flicker; a minute tick is plenty.
function useCountdown(date) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);
  const phase = racePhase(date, now);
  if (phase !== "upcoming") return { phase };
  const total = Math.max(0, Math.floor((raceKickoff(date).getTime() - now) / 60000));
  return { phase, d: Math.floor(total / 1440), h: Math.floor((total % 1440) / 60), m: total % 60 };
}

// P2 and P3 of a finished round. The winner comes free with the calendar the
// page already loads (name, photo and team are on the race row), so the podium
// paints with the winner alone and the other two slot in when the round's own
// results land. The page never waits on them.
function usePodium(race) {
  const [podium, setPodium] = useState(null);
  useEffect(() => {
    if (!race?.id) return setPodium(null);
    let alive = true;
    api
      .raceResults(race.id)
      .then((d) => {
        if (!alive) return;
        const rows = (d?.results || []).filter((r) => r.position && r.position <= 3);
        setPodium(rows.length ? rows.sort((a, b) => a.position - b.position) : null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [race?.id]);
  if (!race?.winner) return null;
  return podium || [{ position: 1, driverId: race.winner.driverId, driverName: race.winner.name }];
}

// The visitor's own ticks on the rookie checklist. Nothing about a signed-out
// visitor is known to the site, so the list cannot know they have joined the
// Discord; it remembers what they ticked (or the step they followed a link
// from) in this browser only. Storage can be missing or blocked, in which case
// the list still works for the length of the visit.
const CHECKLIST_KEY = "nabs_rookie_checklist";
function useChecklist() {
  const [done, setDone] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(CHECKLIST_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  const save = (next) => {
    setDone(next);
    try {
      localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next));
    } catch {
      /* private mode: the ticks just last as long as the page */
    }
  };
  const toggle = (key) => save(done.includes(key) ? done.filter((k) => k !== key) : [...done, key]);
  const mark = (key) => !done.includes(key) && save([...done, key]);
  return { done, toggle, mark };
}

// The way in for one checklist step. Following it ticks the step, which is the
// closest the page can get to knowing the visitor did it.
function StepAction({ step, checklist, compact = false }) {
  const a = step.action;
  if (!a) return null;
  const done = checklist.done.includes(step.key);
  const base = `inline-flex max-w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wide transition ${compact ? "shrink-0" : ""}`;
  const tone = done
    ? "bg-ok/10 text-ok hover:bg-ok/15"
    : a.discord
      ? "bg-[#5865F2] text-white hover:brightness-110"
      : a.primary
        ? "bg-brand text-onbrand hover:brightness-105"
        : "border border-border text-dark hover:bg-surface2";
  const inner = (
    <>
      {a.discord && !done && <DiscordIcon className="h-4 w-4 shrink-0" />}
      <span className="truncate">{a.label}</span>
      {done ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <span aria-hidden="true">→</span>}
    </>
  );
  if (a.href)
    return (
      <a href={a.href} target="_blank" rel="noreferrer noopener" onClick={() => checklist.mark(step.key)} className={`${base} ${tone}`}>
        {inner}
      </a>
    );
  return (
    <Link to={a.to} onClick={() => checklist.mark(step.key)} className={`${base} ${tone}`}>
      {inner}
    </Link>
  );
}

function SectionHead({ eyebrow, title, sub, center, className = "mb-8" }) {
  return (
    <div className={`${className} ${center ? "mx-auto max-w-2xl text-center" : ""}`}>
      <div className="font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-eyebrow">{eyebrow}</div>
      <h2 className="mt-2 font-display text-3xl font-black uppercase tracking-tight text-dark sm:text-4xl">{title}</h2>
      {sub && <p className={`mt-3 text-[15px] leading-relaxed text-light ${center ? "" : "max-w-2xl"}`}>{sub}</p>}
    </div>
  );
}

function DiscordButton({ children = "Join the Discord", className = "", magnetic = false, onClick }) {
  const ref = useMagnetic({ strength: 0.25 });
  // Use the same admin-configured invite as the nav bar (no hardcoded link).
  const social = useSocial();
  const href = social.data?.discord;
  return (
    <a
      ref={magnetic ? ref : undefined}
      href={href || undefined}
      target="_blank"
      rel="noreferrer noopener"
      onClick={onClick}
      className={`shine group inline-flex items-center justify-center gap-2.5 rounded-xl bg-[#5865F2] px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-[#5865F2]/30 transition hover:brightness-110 ${className}`}
    >
      <DiscordIcon className="h-5 w-5" />
      {children}
      <span className="transition group-hover:translate-x-0.5">→</span>
    </a>
  );
}

// The next round as a dark tile of the hero: round, circuit outline, name, a
// days/hours/minutes countdown and the way in. The full four-box countdown
// lives on the Home hero; here it has to share a row with the title leader.
function NextRaceTile({ race, signUpTo, className = "", style }) {
  const circuit = flagFor(race.track, race.country);
  const mark = race.track ? circuitMark(race.track, { area: 9000, maxW: 170, maxH: 110 }) : null;
  const cd = useCountdown(race.date);
  return (
    <div className={`relative overflow-hidden rounded-[1.5rem] bg-ink p-5 text-white shadow-card ${className}`} style={style}>
      {mark && (
        <div className="pointer-events-none absolute -right-3 -top-1 text-white opacity-[0.15]" style={mark.style} aria-hidden="true">
          <CircuitMap track={race.track} rotate={mark.rotate} className="h-full w-full" stroke="currentColor" strokeWidth={2} />
        </div>
      )}
      <div className="relative font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-brand">
        Next · {race.number != null ? `Round ${race.number}` : race.type === "TRAINING" ? "Training" : "Event"}
      </div>
      <div className="relative mt-2 flex items-center gap-2">
        {circuit && <Flag code={circuit.country} title={circuit.countryName} w={20} h={14} />}
        <span className="min-w-0 break-words font-display text-2xl font-black uppercase leading-tight tracking-tight">{race.track}</span>
      </div>
      <div className="relative mt-4 font-mono tabular-nums">
        {cd.phase === "upcoming" ? (
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-black">{cd.d}</span>
            <span className="mr-2 text-xs text-white/55">d</span>
            <span className="text-3xl font-black">{cd.h}</span>
            <span className="mr-2 text-xs text-white/55">h</span>
            <span className="text-3xl font-black text-brand">{cd.m}</span>
            <span className="text-xs text-white/55">m</span>
          </div>
        ) : cd.phase === "live" ? (
          <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-brand">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-brand" />
            Lights out
          </div>
        ) : cd.phase === "finished" ? (
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">Race run · results coming soon</div>
        ) : (
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">Start time to be announced</div>
        )}
      </div>
      <Link
        to={signUpTo}
        className="shine group relative mt-4 flex items-center justify-between rounded-lg bg-brand px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-onbrand transition hover:brightness-105"
      >
        Sign up
        <span className="transition group-hover:translate-x-0.5">→</span>
      </Link>
    </div>
  );
}

// "One league, many eras" as a dark strip of season cards, newest first, that
// scrolls sideways. The arrows and the bar underneath only appear when the
// strip is actually wider than the screen; with a handful of seasons on a big
// monitor it is just a row.
function SeasonFilmstrip({ seasons, activeNumber, hasNextRace }) {
  const stripRef = useRef(null);
  const [scroll, setScroll] = useState({ start: 0, size: 1, atStart: true, atEnd: true });

  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setScroll({
      start: el.scrollWidth ? el.scrollLeft / el.scrollWidth : 0,
      size: el.scrollWidth ? Math.min(1, el.clientWidth / el.scrollWidth) : 1,
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= max - 1,
    });
  }, []);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, seasons.length]);

  const page = (dir) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: motionOff() ? "auto" : "smooth" });
  };

  const scrolls = scroll.size < 0.999;
  const ordered = [...seasons].sort((a, b) => b.number - a.number);

  return (
    <section className="reveal overflow-hidden rounded-[1.75rem] bg-ink py-10 text-white shadow-lift sm:py-12">
      <div className="flex flex-col gap-3 px-6 sm:flex-row sm:items-end sm:justify-between sm:px-10">
        <div>
          <div className="font-mono text-[12px] font-bold uppercase tracking-[0.22em] text-brand">Since day one</div>
          <h2 className="mt-2 font-display text-3xl font-black uppercase tracking-tight sm:text-5xl">One league, many eras</h2>
        </div>
        {scrolls && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => page(-1)}
              disabled={scroll.atStart}
              aria-label="Newer seasons"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => page(1)}
              disabled={scroll.atEnd}
              aria-label="Older seasons"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink transition hover:bg-white/85 disabled:opacity-35"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={stripRef}
        onScroll={measure}
        className="scrollbar-none mt-8 flex snap-x gap-3 overflow-x-auto scroll-px-6 px-6 pb-2 sm:scroll-px-10 sm:px-10"
      >
        {ordered.map((s) => {
          // "Live now" needs a race still to come, not just the isActive flag:
          // that flag stays set on the running season for weeks after its
          // finale, so the strip kept advertising a season whose last round was
          // long gone. The running season still gets the big card either way.
          const current = s.number === activeNumber;
          const status = s.isActive && hasNextRace ? "live" : s.number > activeNumber ? "next" : "done";
          const { era, platform } = seasonGameParts(s);
          const title = era || (/^\d+$/.test(String(s.name).trim()) ? `Season ${s.name}` : s.name);
          // A season still to come shows its car, which is what gets announced
          // first; the ones that ran show their photo.
          const src = status === "next" ? carFor(s) || heroFor(s) : heroFor(s);
          return (
            <div
              key={s.id}
              className={`relative h-64 shrink-0 snap-start overflow-hidden rounded-2xl bg-ink ${
                current ? "w-[280px] ring-2 ring-brand sm:w-[340px]" : status === "next" ? "w-[220px] ring-1 ring-white/10" : "w-[200px] ring-1 ring-white/10"
              }`}
            >
              <img
                src={src}
                alt=""
                loading="lazy"
                data-hero-fallback={heroFor(s)}
                onError={heroOnError}
                className={`absolute inset-0 h-full w-full object-cover ${
                  current ? "opacity-80" : status === "next" ? "opacity-70" : "opacity-35 grayscale"
                }`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
              <div className="absolute right-3 top-3">
                {status === "live" && (
                  <span className="flex items-center gap-1.5 rounded-md bg-brand px-2 py-1 font-mono text-[10px] font-black uppercase tracking-wider text-onbrand">
                    <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                    Live now
                  </span>
                )}
                {status === "next" && (
                  <span className="rounded-md bg-sky-400/20 px-2 py-1 font-mono text-[10px] font-black uppercase tracking-wider text-sky-300">
                    Coming up
                  </span>
                )}
                {status === "done" && (
                  <span className="rounded-md border border-white/20 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white/60">
                    Done
                  </span>
                )}
              </div>
              <div className="absolute inset-x-0 bottom-0 p-4">
                <div className="font-display text-6xl font-black leading-none text-white/90">S{s.number}</div>
                <div className="mt-2 truncate font-display text-base font-extrabold uppercase tracking-tight text-white">{title}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-white/55">
                  {s.game ? platform : "Era to be announced"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {scrolls && (
        <div className="relative mx-6 mt-6 h-1 rounded bg-white/10 sm:mx-10" aria-hidden="true">
          <div
            className="absolute inset-y-0 rounded bg-brand"
            style={{ left: `${scroll.start * 100}%`, width: `${scroll.size * 100}%` }}
          />
        </div>
      )}
    </section>
  );
}

// One FAQ entry. Still a real <details>/<summary>, so it works with a keyboard,
// with a screen reader and with the browser's own find-in-page, and so the
// answers are in the page whether or not anything is open.
//
// What the script adds is only the movement: <details> snaps open, and the panel
// is what a visitor is trying to read, so it slides and fades in instead of
// appearing at full height. Closing is animated too, which means holding the
// element open until the animation has finished. If the visitor has asked for
// less motion, or the graphics setting is on Lite, none of this runs and the
// native behaviour is left alone.
//
// `defaultOpen` is set once on mount rather than passed as `open`: as a prop
// React would own the attribute, and the visitor's own clicks are what should.
function FaqItem({ q, children, defaultOpen = false }) {
  const detailsRef = useRef(null);
  const panelRef = useRef(null);
  const running = useRef(null);

  useEffect(() => {
    if (defaultOpen && detailsRef.current) detailsRef.current.open = true;
  }, [defaultOpen]);

  function onSummaryClick(e) {
    const details = detailsRef.current;
    const panel = panelRef.current;
    if (!details || !panel || motionOff() || typeof panel.animate !== "function") return;
    e.preventDefault(); // we drive `open` ourselves for the length of the animation
    running.current?.cancel();
    const opening = !details.open;
    if (opening) details.open = true; // has to be open to be measurable
    const height = panel.scrollHeight;
    const anim = panel.animate(
      {
        height: opening ? ["0px", `${height}px`] : [`${height}px`, "0px"],
        opacity: opening ? [0, 1] : [1, 0],
      },
      { duration: 220, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
    );
    running.current = anim;
    // The `finished` promise, not the `finish` event: the event is queued on the
    // frame loop and is not delivered while the tab is in the background, which
    // would leave a panel that was closing stuck open. The promise resolves
    // either way. It REJECTS when a newer click cancels this animation, and that
    // is the right thing to ignore: whoever cancelled it now owns the state.
    anim.finished
      .then(() => {
        if (!opening) details.open = false;
        running.current = null;
      })
      .catch(() => {});
  }

  return (
    <details ref={detailsRef} className="group">
      <summary
        onClick={onSummaryClick}
        className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-display text-base font-extrabold uppercase tracking-tight text-dark transition hover:text-accent group-open:text-accent sm:text-lg"
      >
        {q}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-medium transition group-open:border-transparent group-open:bg-brand group-open:text-onbrand">
          <Plus className="h-4 w-4 group-open:hidden" aria-hidden="true" />
          <Minus className="hidden h-4 w-4 group-open:block" aria-hidden="true" />
        </span>
      </summary>
      {/* The animated element is this wrapper, not the padded box inside it:
          animating the height of a box with padding would squash the text
          against its own edges on the way. */}
      <div ref={panelRef} className="overflow-hidden">
        <div className="pb-5 pr-0 text-[15px] leading-relaxed text-light sm:pr-12">{children}</div>
      </div>
    </details>
  );
}

// Newcomer landing page (the "what is NABS / how to join" experience). Shown on
// the home route to logged-out visitors; logged-in members get the normal Home.
export default function Welcome() {
  // The newcomer landing always speaks about the RUNNING season, never an
  // archive one the switcher might be pointing at — so it reads the active
  // season explicitly instead of following the selected season.
  const { seasons, active: season } = useSeason();
  const { seriesPath } = useSeriesPath();
  const { startTour } = useTour();
  const social = useSocial();
  const discordHref = social.data?.discord || null;
  const activeNum = season?.number;
  const drivers = useApi(useCallback(() => api.driverStandings(activeNum), [activeNum]));
  const t1 = useApi(useCallback(() => api.t1Standings(activeNum), [activeNum]));
  const t2 = useApi(useCallback(() => api.t2Standings(activeNum), [activeNum]));
  const races = useApi(useCallback(() => api.races(activeNum), [activeNum]));
  // Admin-editable FAQ override (null = show the built-in season-aware defaults).
  const faq = useApi(useCallback(() => api.welcomeFaq(), []));
  // Discord size + starting year: the two headline figures the database has no
  // answer for (see backend lib/leagueStats.js).
  const stats = useApi(useCallback(() => api.leagueStats(), []));
  const checklist = useChecklist();

  const photoRef = useParallax(0.08);
  // The car tile plays the series' promo film while the page is left alone
  // (same as the member home's main card, see hooks/useIdleFilm.js).
  const filmSeries = useSeries().current;
  const film = useIdleFilm(filmSeries?.promoLoopUrl || filmSeries?.promoVideoUrl);

  const champRaces = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null);
  // Same rule as Home: trainings count as the next race (utils/raceFormat.js).
  const nextRace = nextUpcomingRace(races.data);
  // The most recent round that actually ran, for the league pulse.
  const lastRace = [...champRaces].reverse().find((r) => r.isCompleted && r.winner) || null;
  const podium = usePodium(lastRace);
  const totalRounds = champRaces.length;

  const standings = drivers.data?.standings || [];
  const top3 = standings.slice(0, 3);
  const leader = standings[0]?.total > 0 ? standings[0] : null;
  const runnerUp = standings[1] || null;
  const driverCount = standings.length;
  const teamRows = [...(t1.data?.standings || []), ...(t2.data?.standings || [])];
  const teamCount = teamRows.length;
  // How many constructor tables the grid runs, and whether anyone drives as a
  // reserve: the facts behind "split by pace" and "reserves can step in".
  const tiers = [t1, t2].filter((t) => t.data?.standings?.length).length;
  const hasReserves = standings.some((d) => d.tier !== 1 && d.tier !== 2);

  // Season-aware copy: everything below adapts to the season being shown, so
  // the page needs no edits when a new season (new game, new rules) starts.
  // During a season changeover the active season may already be the new one
  // while no round has run yet — in that gap the era copy keeps naming the
  // PREVIOUS season's cars, and only flips to the new era once the first round
  // of the new season is in the books.
  const hasRunThisSeason = champRaces.some((r) => r.isCompleted);
  const prevSeason = seasons.find((s) => s.number === (season?.number ?? 0) - 1);
  const eraSeason = hasRunThisSeason ? season : prevSeason || season;
  const { era, platform } = seasonGameParts(eraSeason);
  const carsLabel = era || "Formula 1";
  // seasonGameParts already guarantees a platform (falls back to "Assetto
  // Corsa"), so "on {platform}" never renders "on undefined". But when the
  // season's game names ONLY the sim (e.g. game = "Assetto Corsa", no distinct
  // car era) the era and platform collapse to the same word, and "Assetto Corsa
  // cars on Assetto Corsa" reads badly — so the "on {platform}" fragment drops
  // out whenever it would just echo the car label.
  const gnorm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const showPlatform = !!platform && gnorm(platform) !== gnorm(carsLabel);
  // The line under the headline, and the one place on this page that names what
  // the league is in the words somebody looking for a league would type.
  //
  // This is the page a signed-out visitor gets at "/" (App.jsx HomeRoute), so it
  // is also the page a search engine gets, and its headline — "Race
  // wheel-to-wheel on the NABS grid" — is a promise, not a description. The
  // server pre-renders this same string for crawlers, so the two must agree
  // (backend/src/lib/crawlEntities.js, leagueStrapline).
  //
  // Read off the season's own game rather than written here: the era changes
  // every season, and a season that is not recognisably Formula 1 must not
  // advertise itself as one.
  const discipline = disciplineOf(era);
  const strapline = `${discipline ? `${discipline} sim` : "Sim"} racing league on ${platform}`;
  // League-wide facts. Seasons are numbered from 1, so the highest PUBLIC
  // season number is how many seasons NABS spans — once the next season is
  // published (visible in the switcher, races scheduled), the landing page
  // counts it too instead of lagging one behind. Private drafts stay out.
  // The RUNNING season's number still marks the timeline (later ones = "next").
  const activeNumber =
    seasons.find((s) => s.isActive)?.number ?? seasons.reduce((max, s) => Math.max(max, s.number), 0);
  const seasonCount = seasons
    .filter((s) => s.isPublic !== false)
    .reduce((max, s) => Math.max(max, s.number), 0);
  const dropWorst = drivers.data?.dropWorst ?? season?.dropWorst ?? 3;
  const counted = dropWorst > 0 && totalRounds > dropWorst ? totalRounds - dropWorst : null;
  // Team-level drop rule (null = teams inherit the driver drops).
  const teamDrop = season?.teamDropWorst ?? null;
  const pointsTable =
    Array.isArray(season?.pointsTable) && season.pointsTable.length ? season.pointsTable : DEFAULT_POINTS;
  const pointsPairs = pointsTable.map((pts, i) => [String(i + 1), pts]);
  const maxPoints = Math.max(1, ...pointsTable);
  const cadence = raceCadence(champRaces);
  const members = Number(stats.data?.discordMembers) > 0 ? stats.data.discordMembers : null;
  const online = Number(stats.data?.discordOnline) > 0 ? stats.data.discordOnline : null;

  // Admin-edited FAQ (if any) + the live numbers its {placeholders} reference.
  const faqItems = faq.data?.content;
  const faqTokens = {
    platform: platform || "Assetto Corsa",
    era: carsLabel,
    rounds: totalRounds || "",
    counted: counted || totalRounds || "",
    drop: dropWorst || "",
    teamDrop: teamDrop != null && teamDrop > 0 ? teamDrop : "",
    seasons: seasonCount || "",
    pointsFirst: pointsPairs[0]?.[1] ?? "",
    pointsLast: pointsPairs[pointsPairs.length - 1]?.[1] ?? "",
    cadence: cadence || "",
  };

  const loading = drivers.loading || t1.loading || t2.loading || races.loading;

  if (loading)
    return (
      <div className="space-y-6 sm:space-y-12">
        <Skeleton className="h-[520px] w-full rounded-[1.75rem]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      </div>
    );

  // Same reason as the home page: an API outage would otherwise render a
  // complete-looking landing page with every number missing. Backbone only —
  // a single missing constructor table shouldn't hide everything else.
  const loadError = drivers.error || races.error;
  if (loadError)
    return (
      <div className="space-y-6">
        <ErrorBox message={loadError} />
      </div>
    );

  // ---- hero tiles ----
  // The bottom row of the bento is the next round and the title leader. Either
  // can be missing (between seasons, before round one), and the one left takes
  // the whole row rather than leaving a hole.
  const signUpTo = nextRace ? seriesPath(`/attendance?race=${nextRace.id}`) : null;
  const heroPhoto = carFor(eraSeason) || heroFor(eraSeason);
  const gridTile = teamCount > 0;

  // ---- headline figures ----
  // A figure the site cannot answer drops out rather than showing a zero.
  const figures = [
    { key: "years", Icon: Clock, value: stats.data?.years, label: "Years of racing", sub: stats.data?.since ? `Since ${stats.data.since}` : null },
    { key: "discord", Icon: Users, value: members, round: true, label: "Discord members", sub: online ? `${online} online` : null, discord: true },
    { key: "teams", Icon: FlagIcon, value: teamCount, label: "Teams", sub: tiers > 1 ? `Across ${tiers} tiers` : null },
    { key: "seasons", Icon: Trophy, value: seasonCount || 1, label: seasonCount === 1 ? "Season" : "Seasons", sub: seasonCount > 1 ? "And counting" : null },
  ].filter((f) => Number(f.value) > 0);
  const FIGURE_COLS = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };

  // ---- feature tags ----
  const tierTag =
    tiers > 1
      ? [...Array.from({ length: tiers }, (_, i) => `Tier ${i + 1}`), ...(hasReserves ? ["Reserves"] : [])].join(" · ")
      : null;
  const seasonTag =
    totalRounds > 0
      ? `${totalRounds} rounds${counted ? ` · best ${counted} count` : dropWorst === 0 ? " · every round counts" : ""}`
      : null;
  const features = [
    {
      Icon: Car,
      title: "A new era every season",
      body: (
        <>
          Each season we race a fresh grid of equally matched cars, right now {carsLabel}
          {showPlatform ? ` on ${platform}` : ""}, with proper physics and no driver aids holding your hand.
        </>
      ),
      tag: `Now: ${carsLabel}`,
    },
    {
      Icon: Layers,
      title: "Racing at every level",
      body: (
        <>
          Grids are split by pace so the racing stays close, whatever your speed. Reserves can step in for any
          team when a regular can&rsquo;t make a round, and it&rsquo;s a perfect way to get your first start.
        </>
      ),
      tag: tierTag,
    },
    {
      Icon: CalendarDays,
      title: "A real season",
      body: (
        <>
          {totalRounds > 0 ? `${totalRounds} rounds` : "A full season of rounds"} on iconic circuits
          {cadence ? `, run ${cadence}` : ""}.{" "}
          {dropWorst > 0
            ? counted
              ? `Your best ${counted} results count toward the title, so one bad night never ends your championship.`
              : `Your ${dropWorst === 1 ? "weakest round is" : `${dropWorst} weakest rounds are`} dropped, so one bad night never ends your championship.`
            : "Every round counts, so consistency is everything."}
        </>
      ),
      tag: seasonTag,
    },
    {
      Icon: Users,
      title: "Built on Discord",
      body: (
        <>
          Everything happens in our Discord: sign-ups, banter, stewarding and results. This site is the scoreboard
          that updates itself after every race.
        </>
      ),
      tag: members ? `${roundedMembers(members)}+ members` : null,
    },
  ];
  // The round photo only gets a caption when it really is that round's photo;
  // the season's general picture under "Round 10" would be a small lie.
  const featurePhoto = heroFor(season, lastRace);
  const featureCaption = lastRace?.heroImageUrl
    ? `${lastRace.number != null ? `Round ${lastRace.number} · ` : ""}${lastRace.track}`
    : null;

  // ---- leader's rounds (how the drop rule plays out on a real season) ----
  const completedNums = new Set(champRaces.filter((r) => r.isCompleted).map((r) => r.number));
  const droppedSet = new Set(leader?.droppedRounds || []);
  const roundChips = leader
    ? champRaces
        .map((r) => r.number)
        .sort((a, b) => a - b)
        .map((n) => ({
          n,
          run: completedNums.has(n),
          points: leader.perRace?.[n]?.points ?? 0,
          dropped: droppedSet.has(n) && completedNums.has(n),
        }))
    : [];

  // ---- rookie checklist ----
  const steps = [
    {
      key: "discord",
      title: "Join the Discord",
      body: <>That&rsquo;s the home base. Hop in, say hello in the intro channel and let us know you&rsquo;d like to race.</>,
      action: discordHref ? { label: "Join", href: discordHref, discord: true } : null,
    },
    {
      key: "setup",
      title: "Get set up",
      body: (
        <>
          Install the season&rsquo;s game and car mod (right now that&rsquo;s {carsLabel}
          {showPlatform ? ` on ${platform}` : ""}) and run a few laps. Everything you need is linked in the Discord and on
          the Race Info page.
        </>
      ),
      action: { label: "Race info", to: "/downloads" },
    },
    {
      key: "signup",
      title: "Sign up for a round",
      body: <>Each race you mark yourself {answerSpans(faq.data?.answers)}, right here on the site or in Discord.</>,
      action: nextRace
        ? { label: `Sign up for ${nextRace.track}`, to: signUpTo, primary: true }
        : { label: "Calendar", to: seriesPath("/races") },
    },
    {
      key: "race",
      title: "Go racing",
      body: <>Line up on the grid, race fair, and watch your name climb the standings after every round.</>,
      action: { label: "Standings", to: seriesPath("/drivers") },
    },
  ];
  const doneCount = steps.filter((s) => checklist.done.includes(s.key)).length;
  const nextStep = steps.find((s) => !checklist.done.includes(s.key)) || null;
  const hasPulse = !!nextRace || !!podium || top3.length > 0;

  return (
    <div className="content-in space-y-24">
      {/* ============================ HERO ============================ */}
      {/* A bento of tiles instead of one card with everything laid over a
          photo: the pitch, this season's car, the next round and who leads the
          title, each on its own surface. On a phone the pitch and the photo go
          full width and the two small figures share a row. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-12 lg:gap-4">
        <div
          className={`hero-anim col-span-2 flex flex-col justify-between gap-8 rounded-[1.5rem] bg-card p-6 shadow-card sm:p-10 lg:col-span-7 ${
            nextRace || leader ? "lg:row-span-2" : ""
          }`}
          style={{ animationDelay: "0.05s" }}
        >
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-eyebrow">
            {season ? season.name : "NABS Racing League"}
            {season?.game ? ` · ${season.game}` : ""}
          </div>
          <div>
            {/* fluid size below sm so "wheel-to-wheel" (one unbreakable word)
                never gets clipped on narrow phones */}
            <h1 className="font-display text-[clamp(1.7rem,8.2vw,3rem)] font-black uppercase leading-[0.9] tracking-tight text-dark sm:text-[3.6rem]">
              Race wheel&#8209;to&#8209;wheel <span className="text-accent">on the NABS grid</span>
            </h1>
            <div className="mt-4 max-w-xl text-[15px] leading-relaxed text-medium sm:text-base">
              {/* The strapline stays its own heading: it is the subtitle a search
                  engine reads under the promise, set in bold as the first words
                  of the pitch. */}
              <h2 className="inline font-bold text-dark">{strapline}.</h2>{" "}
              Community-run on Discord{seasonCount > 1 ? `, ${seasonCount} seasons and counting` : ""}, with grids split
              by pace so every driver has someone to race.
            </div>
          </div>
          <div data-tour="welcome-cta" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <DiscordButton magnetic className="flex-1 sm:flex-none">Join the Discord</DiscordButton>
            <div className="grid grid-cols-2 gap-3 sm:flex">
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-border px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-dark transition hover:bg-surface2"
              >
                How it works
              </a>
              {/* "How it works" explains the league in words on this page; this
                  walks the actual site. Offered rather than sprung on arrival: a
                  tour that takes the screen over before you have asked for
                  anything is the thing everybody clicks away. */}
              <button
                type="button"
                onClick={() => startTour("newcomer")}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-border px-5 py-3.5 text-sm font-bold uppercase tracking-wide text-dark transition hover:bg-surface2"
              >
                Site tour
              </button>
            </div>
          </div>
        </div>

        {/* This season's car. The showroom shot where there is one, the season
            photo where there is not. The drift is useParallax moving the crop
            inside the tile, so nothing ever sticks out past the corners; the
            scrim and the label carry a z-index because that image sits on a
            compositing layer of its own and would otherwise paint over them. */}
        <div
          ref={film.ref}
          data-film={film.showing ? "on" : undefined}
          className={`hero-anim relative col-span-2 h-48 overflow-hidden rounded-[1.5rem] bg-ink shadow-card sm:h-64 lg:col-span-5 ${
            nextRace || leader ? "" : "lg:h-auto"
          }`}
          style={{ animationDelay: "0.12s" }}
        >
          <img
            ref={photoRef}
            key={heroPhoto}
            src={heroPhoto}
            alt=""
            data-hero-fallback={heroFor(eraSeason)}
            onError={heroOnError}
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <IdleFilm film={film} className="z-[5]" />
          <div className="hero-hud absolute inset-0 z-10 bg-gradient-to-t from-ink/85 to-transparent" />
          <div className="hero-hud absolute inset-x-5 bottom-4 z-20 flex items-end justify-between gap-3 text-white">
            <div className="min-w-0">
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-brand">This season&rsquo;s cars</div>
              <div className="truncate font-display text-xl font-black uppercase tracking-tight">{carsLabel}</div>
            </div>
            {showPlatform && (
              <span className="shrink-0 rounded-md bg-white/15 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider backdrop-blur">
                {platform}
              </span>
            )}
          </div>
        </div>

        {nextRace && (
          <NextRaceTile
            race={nextRace}
            signUpTo={signUpTo}
            className={`hero-anim col-span-2 ${leader ? "lg:col-span-3" : "lg:col-span-5"}`}
            style={{ animationDelay: "0.2s" }}
          />
        )}

        {leader && (
          <Link
            to={seriesPath(`/drivers/${leader.driverId}`)}
            className={`hero-anim flex flex-col justify-between rounded-[1.5rem] bg-card p-5 shadow-card transition hover:shadow-lift ${
              gridTile ? "col-span-1" : "col-span-2"
            } ${nextRace ? "lg:col-span-2" : "lg:col-span-5"}`}
            style={{ animationDelay: "0.26s" }}
          >
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-faint">
              {nextRace ? "Title leader" : "Champion"}
            </div>
            <div className="mt-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-5 w-1 shrink-0 rounded" style={{ backgroundColor: leader.team?.color }} />
                <span className="truncate font-display text-lg font-black uppercase leading-none text-dark">{leader.name}</span>
              </div>
              <div className="mt-2 font-mono text-3xl font-black tabular-nums text-dark">{leader.total}</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-light">
                pts
                {runnerUp && leader.total > runnerUp.total ? ` · +${leader.total - runnerUp.total} ahead` : ""}
              </div>
            </div>
          </Link>
        )}

        {/* Phone only: on a wide screen the row is already full, on a phone the
            leader would otherwise sit alone in half a row. */}
        {gridTile && (
          <div
            className={`hero-anim flex flex-col justify-between rounded-[1.5rem] bg-brand p-5 text-onbrand lg:hidden ${
              leader ? "col-span-1" : "col-span-2"
            }`}
            style={{ animationDelay: "0.3s" }}
          >
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">On the grid</div>
            <div>
              <div className="mt-3 font-display text-4xl font-black leading-none">{teamCount}</div>
              <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-wider opacity-70">
                teams{tiers > 1 ? ` · ${tiers} tiers` : ""}
              </div>
              <div className="mt-3 flex -space-x-2">
                {teamRows.slice(0, 4).map((t) => (
                  <span key={t.teamId} className="flex h-7 w-7 items-center justify-center rounded-full bg-white ring-2 ring-brand">
                    <TeamLogo id={t.teamId} name={t.name} color={t.color} logoUrl={t.logoUrl} size={18} />
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ====================== BY THE NUMBERS ====================== */}
      {/* The four figures a newcomer actually wants: how long this has been
          running, how big the community is, how many teams, how many seasons.
          League-wide on purpose, not season counts: a visitor landing between
          seasons should not meet a page boasting about a calendar that already
          finished. The Discord size and the starting year come from
          /settings/league-stats; a figure that is missing simply drops out. */}
      {figures.length > 0 && (
        // The hairlines between the figures are the card showing through a
        // 1px gap, so the cells cannot fade in one by one (the gaps would show
        // as a solid block first); the card rises as one instead.
        <section className="reveal card -mt-12 overflow-hidden sm:-mt-14">
          <div className={`grid grid-cols-2 gap-px bg-border ${FIGURE_COLS[figures.length]}`}>
            {figures.map((f, i) => (
              <div
                key={f.key}
                className={`flex items-center gap-4 bg-card p-5 sm:p-7 ${
                  figures.length % 2 && i === figures.length - 1 ? "col-span-2 lg:col-span-1" : ""
                }`}
              >
                <span
                  className={`hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl sm:flex ${
                    f.discord ? "bg-[#5865F2]/10 text-[#5865F2]" : "bg-brand/15 text-accent"
                  }`}
                >
                  <f.Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="font-display text-3xl font-black leading-none tabular-nums text-dark sm:text-4xl">
                    <CountUp end={f.round ? roundedMembers(f.value) : f.value} />
                    {f.round && "+"}
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-dark">{f.label}</div>
                  {f.sub && <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{f.sub}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* =============== NEXT SEASON (transition period only) =============== */}
      <NextSeasonTeaser />

      {/* ====================== WHAT IS NABS ======================= */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr] lg:gap-14">
        <div>
          {/* The one heading on the page that answers the question a newcomer
              actually types into a search box, so it names the sim and the cars
              rather than leaving both to the paragraphs beside it. Both come
              from the season's own `game` field, so the sentence follows the
              league to whatever it races next. */}
          <SectionHead
            className=""
            eyebrow="New here?"
            title="What is the NABS Racing League?"
            sub={`A community-run online ${carsLabel} championship${
              showPlatform ? ` on ${platform}` : ""
            } for sim racers. Here's the short version.`}
          />
          <div className="relative mt-6 hidden h-56 overflow-hidden rounded-2xl bg-ink shadow-card lg:block">
            <img
              src={featurePhoto}
              alt=""
              loading="lazy"
              data-hero-fallback={heroFor(season)}
              onError={heroOnError}
              className="h-full w-full object-cover"
            />
            {featureCaption && (
              <>
                <div className="absolute inset-0 bg-gradient-to-t from-ink/70 to-transparent" />
                <div className="absolute bottom-3 left-4 right-4 truncate font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/85">
                  {featureCaption}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="card grid grid-cols-1 gap-x-10 divide-y divide-border px-5 sm:grid-cols-2 sm:divide-y-0 sm:px-8">
          {features.map((f, i) => (
            <div key={f.title} className={i < 2 ? "sm:border-b sm:border-border" : ""}>
              <div className="flex gap-4 py-6 sm:py-7">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-accent">
                  <f.Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-light">{f.body}</p>
                  {f.tag && (
                    <span className="mt-3 inline-block rounded-md border border-border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-medium">
                      {f.tag}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ====================== SEASON TIMELINE ======================= */}
      {/* League history straight from the DB: appears per season entered by the
          admin, so it grows on its own. Hidden while only one season exists. */}
      {seasons.length > 1 && (
        <SeasonFilmstrip seasons={seasons} activeNumber={activeNumber} hasNextRace={!!nextRace} />
      )}

      {/* ====================== HOW IT WORKS ======================= */}
      <section id="how-it-works" className="scroll-mt-24">
        <SectionHead
          eyebrow="The format"
          title="How the championship works"
          sub="Finish a race, earn points for your position, and climb the tables, as a driver and as a team."
        />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          {/* Points as bars: how steeply they fall away is the thing a table of
              numbers hides. Medal colours on the podium places, the series
              colour for the rest. */}
          <div className="reveal card flex flex-col overflow-hidden lg:col-span-3">
            <div className="flex items-center gap-2 border-b border-border px-5 py-4">
              <Trophy className="h-4 w-4 text-accent" aria-hidden="true" />
              <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Points per finish</h3>
              <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-light">P{pointsPairs.length + 1}+ &amp; DNF = 0</span>
            </div>
            {season?.fastestLapPoints > 0 && (
              <p className="border-b border-border px-5 py-2 text-xs leading-relaxed text-light">
                <span className="font-bold text-fl">Fastest lap:</span> +{season.fastestLapPoints} on top of your finishing
                points for the fastest race lap, as long as you finish the race.
              </p>
            )}
            <div className="grid grid-cols-1 gap-x-8 gap-y-2 p-5 sm:grid-cols-2">
              {[pointsPairs.slice(0, Math.ceil(pointsPairs.length / 2)), pointsPairs.slice(Math.ceil(pointsPairs.length / 2))].map(
                (half, h) => (
                  <div key={h} className="space-y-2">
                    {half.map(([pos, pts]) => {
                      const i = Number(pos) - 1;
                      const medal = i < 3 ? MEDAL[i] : null;
                      return (
                        <div key={pos} className="flex items-center gap-2">
                          <span
                            className={`flex h-6 w-9 shrink-0 items-center justify-center rounded font-display text-xs font-black ${
                              medal ? "text-ink" : "text-faint"
                            }`}
                            style={medal ? { backgroundColor: medal } : undefined}
                          >
                            P{pos}
                          </span>
                          <div className="h-5 flex-1 overflow-hidden rounded-r bg-surface2">
                            <div
                              className={`bar-fill h-5 rounded-r ${medal ? "" : "bg-brand"}`}
                              style={{ "--w": `${(pts / maxPoints) * 100}%`, ...(medal ? { backgroundColor: medal } : {}) }}
                            />
                          </div>
                          <span className="w-7 shrink-0 text-right font-mono text-sm font-bold tabular-nums text-dark">{pts}</span>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
            <div className="mt-auto flex items-center gap-2 border-t border-border px-5 py-3 text-xs text-light">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
              Calculated automatically after every round and shown live on this site.
            </div>
          </div>

          <div className="reveal flex flex-col gap-5 lg:col-span-2">
            {/* The drop rule shown on the current leader's own rounds rather
                than explained in a sentence: the struck-out chips are the
                rounds that do not count. */}
            <div className="card p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
                  {dropWorst > 0
                    ? counted
                      ? `Best ${counted} of ${totalRounds} count`
                      : `Your worst ${dropWorst} don't count`
                    : "Every round counts"}
                </h3>
                {leader && roundChips.length > 0 && (
                  <span className="min-w-0 truncate font-mono text-[11px] uppercase tracking-wider text-light">{leader.name}</span>
                )}
              </div>
              {leader && roundChips.length > 0 && (
                <>
                  <div className="mt-4 grid grid-cols-6 gap-1.5">
                    {roundChips.map((c) => (
                      <span
                        key={c.n}
                        title={`Round ${c.n}${c.run ? `: ${c.points} pts${c.dropped ? ", dropped" : ""}` : ", still to come"}`}
                        className={`flex h-9 items-center justify-center rounded-md font-mono text-[11px] font-bold tabular-nums ${
                          !c.run
                            ? "bg-surface2 text-faint"
                            : c.dropped
                              ? "border border-dashed border-border text-faint line-through"
                              : "bg-ok/10 text-ok"
                        }`}
                      >
                        {c.run ? c.points : `R${c.n}`}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-surface2 px-3 py-2">
                    <span className="text-sm text-medium">
                      {dropWorst > 0 ? `The worst ${dropWorst} drop out` : "All rounds added up"}
                    </span>
                    <span className="shrink-0 font-mono text-sm font-bold text-dark">= {leader.total} pts</span>
                  </div>
                </>
              )}
              <p className="mt-3 text-sm leading-relaxed text-light">
                {dropWorst > 0 ? (
                  <>
                    {teamDrop != null && teamDrop > 0
                      ? `Teams drop their own ${teamDrop === 1 ? "weakest single-driver round" : `${teamDrop} weakest single-driver rounds`}.`
                      : "Teams inherit the same drops."}{" "}
                    Consistency wins titles, not luck.
                  </>
                ) : (
                  <>No dropped results this season, so bring your A-game to every race.</>
                )}
              </p>
            </div>

            <div className="card p-5">
              <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Two ways to win</h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border p-3">
                  <User className="h-5 w-5 text-accent" aria-hidden="true" />
                  <div className="mt-2 font-display text-sm font-extrabold uppercase text-dark">Drivers</div>
                  <p className="mt-1 text-xs leading-relaxed text-light">Everyone in one table, ranked by points.</p>
                </div>
                <div className="rounded-xl border border-border p-3">
                  <Layers className="h-5 w-5 text-accent" aria-hidden="true" />
                  <div className="mt-2 font-display text-sm font-extrabold uppercase text-dark">Constructors</div>
                  <p className="mt-1 text-xs leading-relaxed text-light">
                    {tiers > 1 ? "A separate teams' table for each tier." : "Every team in one table, scored by its drivers."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================== GET STARTED ======================= */}
      <section>
        <SectionHead
          eyebrow="Get on the grid"
          title="Joining is easy"
          sub="No tryout, no pressure. If you can drive a clean race, there's a seat for you."
        />
        <div className={`grid grid-cols-1 gap-5 ${hasPulse ? "lg:grid-cols-[1.5fr_1fr]" : ""}`}>
          {/* The four steps as a checklist the visitor can tick off, each with
              its own way in. The ticks live in this browser only (useChecklist). */}
          <div className="card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Your rookie checklist</h3>
              <span className="ml-auto font-mono text-[11px] font-bold uppercase tracking-wider text-light">
                {doneCount} of {steps.length}
              </span>
            </div>
            <div className="h-1 bg-surface2">
              <div className="h-1 bg-ok" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
            <ol className="divide-y divide-border">
              {steps.map((s, i) => {
                const done = checklist.done.includes(s.key);
                return (
                  <li key={s.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <button
                        type="button"
                        onClick={() => checklist.toggle(s.key)}
                        aria-pressed={done}
                        aria-label={done ? `Mark "${s.title}" as not done` : `Mark "${s.title}" as done`}
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition ${
                          done ? "border-ok bg-ok/15 text-ok" : "border-border bg-card hover:border-accent"
                        }`}
                      >
                        {done && <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />}
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-bold text-faint">{String(i + 1).padStart(2, "0")}</span>
                          <h4
                            className={`font-display text-base font-extrabold uppercase tracking-tight ${
                              done ? "text-light line-through decoration-2" : "text-dark"
                            }`}
                          >
                            {s.title}
                          </h4>
                        </div>
                        <p className="mt-0.5 text-sm leading-relaxed text-light">{s.body}</p>
                      </div>
                    </div>
                    {s.action && (
                      <div className="min-w-0 pl-9 sm:pl-0">
                        <StepAction step={s} checklist={checklist} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Next round, last result and the title fight, folded into one
              card: on this page they back up the pitch, they are not the page. */}
          {hasPulse && (
            <div className="reveal card self-start overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border px-5 py-4">
                <span className="live-dot inline-block h-2 w-2 rounded-full bg-accent" />
                <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">League pulse</h3>
              </div>

              <div className="divide-y divide-border">
              {nextRace && <PulseNext race={nextRace} />}

              {podium && lastRace && (
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
                      Last time out · {lastRace.track}
                    </div>
                    <Link
                      to={seriesPath(`/races?race=${lastRace.id}`)}
                      className="-my-2 shrink-0 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light transition hover:text-dark"
                    >
                      Results →
                    </Link>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    {podium.map((r, i) => (
                      <Link
                        key={r.driverId || i}
                        to={seriesPath(`/drivers/${r.driverId}`)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-surface2 p-1.5 transition hover:bg-border"
                      >
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-display text-sm font-black text-ink"
                          style={{ backgroundColor: MEDAL[(r.position ?? i + 1) - 1] }}
                        >
                          {r.position ?? i + 1}
                        </span>
                        <span className="truncate font-display text-xs font-bold uppercase text-dark">{r.driverName || r.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {top3.length > 0 && (
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    {/* "right now" only while there IS a race on. With every
                        round run the same block was still promising a live
                        title fight over a table that had not moved in weeks. */}
                    <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
                      {nextRace ? "Title race right now" : "How the season finished"}
                    </div>
                    <Link
                      to={seriesPath("/drivers")}
                      className="-my-2 shrink-0 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light transition hover:text-dark"
                    >
                      Table →
                    </Link>
                  </div>
                  <table className="mt-2 w-full text-sm">
                    <tbody className="divide-y divide-border">
                      {top3.map((d, i) => (
                        <tr key={d.driverId}>
                          <td className="w-6 py-1.5 font-display font-black text-dark">{i + 1}</td>
                          <td className="max-w-0 py-1.5">
                            <Link to={seriesPath(`/drivers/${d.driverId}`)} className="flex min-w-0 items-center gap-2 transition hover:text-accent">
                              <span className="inline-block h-3 w-1 shrink-0 rounded" style={{ backgroundColor: d.team?.color }} />
                              <span className="truncate font-display font-bold uppercase text-dark">{d.name}</span>
                            </Link>
                          </td>
                          <td className="w-12 py-1.5 text-right font-mono font-bold tabular-nums text-dark">{d.total}</td>
                          <td className="w-14 py-1.5 text-right font-mono text-xs text-faint">
                            {i === 0 ? "leader" : `−${top3[0].total - d.total}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              </div>
            </div>
          )}
        </div>

        {/* Phone only: the next unticked step stays in reach while this section
            is on screen, just above the bottom navigation. Gone once every box
            is ticked. */}
        {nextStep && (
          <div className="sticky bottom-[calc(0.75rem+var(--bnav))] z-20 mt-5 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-lift backdrop-blur sm:hidden">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-sm font-black uppercase text-dark">Next step: {nextStep.title}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-light">
                  {doneCount} of {steps.length} done
                </div>
              </div>
              {nextStep.action && <StepAction step={nextStep} checklist={checklist} compact />}
            </div>
          </div>
        )}
      </section>

      {/* ====================== FAQ ======================= */}
      <section className="grid grid-cols-1 gap-8 lg:grid-cols-[340px_1fr] lg:gap-14">
        <div>
          <SectionHead
            className=""
            eyebrow="Good to know"
            title="Frequently asked"
            sub="The questions every new driver asks in their first week."
          />
          {discordHref && (
            <div className="card mt-6 hidden p-5 lg:block">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5865F2]/10 text-[#5865F2]">
                  <MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <div className="font-display text-sm font-extrabold uppercase text-dark">Still got a question?</div>
                  <div className="text-xs text-light">Ask in the Discord and someone will help you out.</div>
                </div>
              </div>
              <a
                href={discordHref}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 flex items-center justify-center rounded-lg border border-border py-2.5 text-sm font-bold uppercase tracking-wide text-dark transition hover:bg-surface2"
              >
                Ask on Discord →
              </a>
            </div>
          )}
        </div>
        <div className="card divide-y divide-border px-5 sm:px-7">
          {faqItems ? (
            // Admin-edited FAQ: whatever questions were saved, with live numbers
            // filled into the {placeholders}.
            faqItems.map((it, i) => (
              <FaqItem key={i} q={fillFaq(it.q, faqTokens)} defaultOpen={i === 0}>
                {richFaq(fillFaq(it.a, faqTokens))}
              </FaqItem>
            ))
          ) : (
            <>
              <FaqItem q="Do I need to be fast to join?" defaultOpen>
                Not at all. The grid is split by pace, and the reserve system exists too, so newer drivers can
                find their feet against similar competition. Clean, consistent racing matters far more than raw speed.
              </FaqItem>
              <FaqItem q="What do I need to race?">
                A PC copy of the season&rsquo;s game ({platform} right now), the current car mod, and a stable
                connection. A wheel helps but isn&rsquo;t required. Everything else (mods, server details, setup
                help) is in the Discord and on the Race Info page.
              </FaqItem>
              {seasonCount > 1 && (
                <FaqItem q="How long has NABS been around?">
                  We&rsquo;re {seasonCount} seasons in. Each season brings a new car era, a fresh calendar and a
                  reshuffled grid. The community and the rivalries carry over.
                </FaqItem>
              )}
              <FaqItem q="How often do you race?">
                {cadence === "every other week" ? "A round every other week" : "Roughly one round a week"}
                {totalRounds > 0 ? ` across a ${totalRounds}-race season` : ""}, plus the
                occasional special event like an endurance night. You sign up for each round, so you&rsquo;re
                never locked in.
              </FaqItem>
              <FaqItem q="What if I can't make a race?">
                Just mark yourself Declined for that round, no penalty. Teams can call on a reserve to fill the
                seat, which is often how new drivers get their first start.
              </FaqItem>
              <FaqItem q="How do the standings work?">
                You score points for your finishing position every round (P1 is {pointsPairs[0][1]} down to P
                {pointsPairs.length} is {pointsPairs[pointsPairs.length - 1][1]}).{" "}
                {dropWorst > 0
                  ? counted
                    ? `Your best ${counted} results of ${totalRounds} count toward the championship.`
                    : `Your ${dropWorst === 1 ? "lowest-scoring round is" : `${dropWorst} lowest-scoring rounds are`} dropped, so only your best races count.`
                  : "Every round counts toward the championship."}{" "}
                It&rsquo;s all calculated automatically and shown live on this site.
              </FaqItem>
            </>
          )}
        </div>
        {discordHref && (
          <a
            href={discordHref}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-bold uppercase tracking-wide text-[#5865F2] transition hover:bg-surface2 lg:hidden"
          >
            <DiscordIcon className="h-5 w-5" />
            Ask on Discord
          </a>
        )}
      </section>

      {/* ================= WHAT WE POST ================== */}
      {/* The same wall as the member home page. On a newcomer landing it does a
          different job: everything above is us describing ourselves, this is
          the racing itself. Renders nothing at all until there is something to
          show — see SocialFeed. */}
      <SocialFeed
        header={
          <SectionHead
            center
            eyebrow="Off the track"
            title="See us race"
            sub="Onboards, highlights and the odd disaster, straight from our channels."
          />
        }
      />

      {/* ====================== FINAL CTA ======================= */}
      {/* The last ask, dressed as what it is: an invite to a Discord server. The
          faces are the drivers at the top of the table right now, the people a
          newcomer would be lining up with. */}
      <section className="reveal relative overflow-hidden rounded-2xl bg-[#5865F2] text-white shadow-lift">
        <DiscordIcon className="pointer-events-none absolute -right-10 -top-10 h-64 w-64 text-white/10" />
        <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative h-16 w-16 shrink-0 rounded-2xl bg-white p-2.5">
              {/* The black mark: it sits on a white tile in both themes. */}
              <img src="/logo-light.png" alt="NABS Racing" className="h-full w-full object-contain" />
              {online && (
                <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-[#23a55a] ring-4 ring-[#5865F2]" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-black uppercase leading-none tracking-tight sm:text-3xl">Ready to line up?</h2>
              {(online || members) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] font-bold uppercase tracking-wider text-white/80">
                  {online && (
                    <span className="flex items-center gap-1.5">
                      {/* Discord's own "online" green */}
                      <span className="h-2 w-2 rounded-full bg-[#23a55a]" />
                      {online} online
                    </span>
                  )}
                  {members && <span>{roundedMembers(members)}+ members</span>}
                </div>
              )}
            </div>
          </div>
          {top3.length > 0 && (
            <div className="flex -space-x-2 lg:ml-auto" title={top3.map((d) => d.name).join(", ")}>
              {top3.map((d) => (
                <span key={d.driverId} className="rounded-full ring-2 ring-[#5865F2]">
                  <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={d.team?.color} size={36} />
                </span>
              ))}
              {driverCount > 3 && (
                <span
                  className="relative flex h-9 min-w-9 items-center justify-center rounded-full bg-brand px-2 font-display text-[11px] font-black text-onbrand ring-2 ring-[#5865F2]"
                >
                  +{driverCount - 3}
                </span>
              )}
            </div>
          )}
          <div className={`grid grid-cols-1 gap-2 sm:flex ${top3.length > 0 ? "" : "lg:ml-auto"}`}>
            <a
              href={discordHref || undefined}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-[#5865F2] transition hover:bg-white/90"
            >
              Accept invite →
            </a>
            {/* The series-prefixed address, not the flat /drivers: that one is
                a legacy path the server answers with a redirect, and an internal
                link should point where it is going. */}
            <Link
              to={seriesPath("/drivers")}
              className="inline-flex items-center justify-center rounded-xl bg-white/15 px-5 py-3.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-white/25"
            >
              Standings
            </Link>
          </div>
        </div>
        <div className="relative border-t border-white/15 bg-black/10 px-6 py-3 font-mono text-[11px] uppercase tracking-wider text-white/75 sm:px-8">
          {nextRace
            ? `Say hello in the Discord and we'll help you sign up for ${
                nextRace.number != null ? `Round ${nextRace.number} at ` : ""
              }${nextRace.track}.`
            : "Say hello in the Discord and we'll get you on track for the next round."}
        </div>
      </section>
    </div>
  );
}

// The next round inside the league pulse card: a calendar leaf, the circuit
// and how long until lights out.
function PulseNext({ race }) {
  const circuit = flagFor(race.track, race.country);
  const date = race.date ? raceKickoff(race.date) : null;
  const cd = useCountdown(race.date);
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-ink text-white">
        {date ? (
          <>
            <span className="font-mono text-[9px] font-bold text-brand">{MONTHS[date.getMonth()]}</span>
            <span className="font-display text-lg font-black leading-none">{date.getDate()}</span>
          </>
        ) : (
          <span className="font-mono text-[9px] font-bold text-brand">TBA</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-eyebrow">
          Next{race.number != null ? ` · R${race.number}` : race.type === "TRAINING" ? " · Training" : ""}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 font-display text-lg font-black uppercase text-dark">
          {circuit && <Flag code={circuit.country} title={circuit.countryName} w={16} h={12} />}
          <span className="truncate">{race.track}</span>
        </div>
      </div>
      {cd.phase === "upcoming" && (
        <div className="shrink-0 text-right font-mono">
          <div className="text-lg font-black tabular-nums text-dark">
            {cd.d > 0 ? `${cd.d}d ${cd.h}h` : `${cd.h}h ${cd.m}m`}
          </div>
          <div className="text-[10px] uppercase text-faint">to lights out</div>
        </div>
      )}
      {cd.phase === "live" && (
        <div className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">Lights out</div>
      )}
    </div>
  );
}
