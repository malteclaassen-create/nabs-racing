import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeriesPath } from "../context/SeriesContext.jsx";
import { Skeleton, CountUp, MEDAL, ErrorBox } from "../components/ui.jsx";
import { useParallax, useTilt, useMagnetic, motionOff } from "../hooks/motion.js";
import Flag from "../components/Flag.jsx";
import RaceCountdown from "../components/RaceCountdown.jsx";
import { useSocial } from "../components/SocialLinks.jsx";
import SocialFeed from "../components/SocialFeed.jsx";
import { flagFor } from "../data/circuits.js";
import { countryFor } from "../data/driverCountries.js";
import { fmtRaceTime } from "../utils/raceTime.js";
import { heroFor, heroOnError } from "../utils/heroImage.js";
import { seasonGameParts, seasonGameLabel } from "../utils/seasonGame.js";
import NextSeasonTeaser from "../components/NextSeasonTeaser.jsx";
import { useTour } from "../components/Tour.jsx";
import { fmtDateShort } from "../utils/format.js";

// League default points per finishing position — only the fallback: seasons
// can override the table (Season.pointsTable), which /api/seasons delivers and
// the page prefers, so the copy below always matches the season being shown.
const DEFAULT_POINTS = [35, 30, 25, 22, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1];

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
  return String(s ?? "").replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null && tokens[k] !== "" ? String(tokens[k]) : m));
}
function richFaq(s) {
  const parts = String(s ?? "").split(/\*\*(.+?)\*\*/g);
  if (parts.length === 1) return s;
  return parts.map((p, i) => (i % 2 ? <span key={i} className="font-semibold text-dark">{p}</span> : p));
}

function DiscordIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5a18.3 18.3 0 0 1 4.3 1.4 16.2 16.2 0 0 0-13 0A18.3 18.3 0 0 1 10.8 3.5L10.5 3A19.8 19.8 0 0 0 5.6 4.4 20.7 20.7 0 0 0 2 18.6 19.9 19.9 0 0 0 8 21l.5-1.7c-1-.3-1.9-.7-2.7-1.2l.6-.45a14.2 14.2 0 0 0 12.1 0l.6.45c-.85.5-1.75.9-2.7 1.2L17 21a19.9 19.9 0 0 0 6-2.4 20.7 20.7 0 0 0-2.7-14.2zM9 15.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z" />
    </svg>
  );
}

// Small line icons for the feature cards.
const ICONS = {
  wheel: "M12 3a9 9 0 100 18 9 9 0 000-18zm0 5.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM12 3v5.5M5.6 19l3.6-4M18.4 19l-3.6-4",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  calendar: "M4 6a2 2 0 012-2h12a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM4 9h16M8 3v4M16 3v4",
  community: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
  trophy: "M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3",
  flag: "M5 21V4M5 4h14l-3 4 3 4H5",
};
function Icon({ name, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

// What the league actually did last Friday.
//
// The newcomer page talked about racing at length and never once showed a
// result — the one thing that proves any of it happens. The winner comes free
// with the calendar the page already loads (name, photo and team are on the
// race row), so the card paints immediately; P2 and P3 need the round's own
// results, which are fetched separately and simply slot in when they land. The
// page never waits on them.
function LastRaceCard({ race }) {
  const [podium, setPodium] = useState(null);
  useEffect(() => {
    if (!race?.id) return setPodium(null);
    let alive = true;
    api
      .raceResults(race.id)
      .then((d) => {
        if (!alive) return;
        const rows = (d?.results || []).filter((r) => r.position && r.position <= 3);
        setPodium(rows.length ? rows : null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [race?.id]);

  if (!race?.winner) return null;
  const circuit = flagFor(race.track, race.country);
  const rows = podium || [{ position: 1, driverId: race.winner.driverId, driverName: race.winner.name, photoUrl: race.winner.photoUrl, team: race.winner.team }];

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Last time out</h3>
        <Link to="/races" className="font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:text-dark">
          All results →
        </Link>
      </div>
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
        {circuit && <Flag code={circuit.country} title={circuit.countryName} w={22} h={16} />}
        <span className="min-w-0 flex-1 truncate font-display text-lg font-extrabold uppercase tracking-tight text-dark">
          {race.track}
        </span>
        {race.date && (
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-light">
            {fmtDateShort(race.date)}
          </span>
        )}
      </div>
      <div className="divide-y divide-border">
        {rows.map((r, i) => (
          <Link
            key={r.driverId || i}
            to={`/drivers/${r.driverId}`}
            className="flex items-center gap-3 px-5 py-3 transition hover:bg-surface2"
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-display text-sm font-black text-ink"
              style={{ backgroundColor: MEDAL[i] }}
            >
              {r.position ?? i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-base font-bold uppercase tracking-tight text-dark">
                {r.driverName || r.name}
              </span>
              {r.team?.name && <span className="block truncate text-xs text-light">{r.team.name}</span>}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SectionHead({ eyebrow, title, sub, center }) {
  return (
    <div className={`mb-8 ${center ? "mx-auto max-w-2xl text-center" : ""}`}>
      <div className="font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-eyebrow">{eyebrow}</div>
      <h2 className="mt-2 font-display text-3xl font-black uppercase tracking-tight text-dark sm:text-4xl">{title}</h2>
      {sub && <p className={`mt-3 text-[15px] leading-relaxed text-light ${center ? "" : "max-w-2xl"}`}>{sub}</p>}
    </div>
  );
}

function DiscordButton({ children = "Join the Discord", className = "", magnetic = false }) {
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
      className={`shine group inline-flex items-center justify-center gap-2.5 rounded-xl bg-[#5865F2] px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-[#5865F2]/30 transition hover:brightness-110 ${className}`}
    >
      <DiscordIcon className="h-5 w-5" />
      {children}
      <span className="transition group-hover:translate-x-0.5">→</span>
    </a>
  );
}

function FeatureCard({ icon, title, children, index }) {
  const ref = useTilt({ max: 5, lift: 5 });
  return (
    <div ref={ref} className="transition card shine tilt relative overflow-hidden p-6 hover:shadow-xl" style={{ "--i": index }}>
      {/* one shared accent, not a rainbow: the colour carries no meaning here,
          so all four cards wear the brand tone */}
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand/15 text-brand">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <h3 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-light">{children}</p>
    </div>
  );
}

function Step({ n, title, children, last }) {
  return (
    <li className="relative flex gap-4 pb-8 last:pb-0">
      {!last && <span className="absolute left-[19px] top-11 bottom-0 w-px bg-border" aria-hidden="true" />}
      <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand font-display text-lg font-black text-ink ring-4 ring-card">
        {n}
      </span>
      <div className="pt-1">
        <h4 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">{title}</h4>
        <p className="mt-1 text-sm leading-relaxed text-light">{children}</p>
      </div>
    </li>
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
function FaqItem({ q, children }) {
  const detailsRef = useRef(null);
  const panelRef = useRef(null);
  const running = useRef(null);

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
    <details ref={detailsRef} className="group card overflow-hidden">
      <summary
        onClick={onSummaryClick}
        className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-display text-base font-bold uppercase tracking-tight text-dark transition hover:bg-surface2"
      >
        {q}
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-brand transition-transform duration-base group-open:rotate-45" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </summary>
      {/* The animated element is this wrapper, not the padded box inside it:
          animating the height of a box with padding would squash the text
          against its own edges on the way. */}
      <div ref={panelRef} className="overflow-hidden">
        <div className="border-t border-border px-5 py-4 text-sm leading-relaxed text-light">{children}</div>
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

  const heroImgRef = useParallax(0.08);

  const champRaces = (races.data || []).filter((r) => !r.isSpecialEvent && r.number != null);
  const nextRace = champRaces.find((r) => !r.isCompleted);
  // The most recent round that actually ran, for the "Last time out" card.
  const lastRace = [...champRaces].reverse().find((r) => r.isCompleted && r.winner) || null;
  const totalRounds = champRaces.length;

  const standings = drivers.data?.standings || [];
  const top3 = standings.slice(0, 3);
  const driverCount = standings.length;
  const teamCount = (t1.data?.standings?.length || 0) + (t2.data?.standings?.length || 0);
  const nextCircuit = flagFor(nextRace?.track, nextRace?.country);

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
  const timeline = [...seasons].sort((a, b) => a.number - b.number);
  const dropWorst = drivers.data?.dropWorst ?? season?.dropWorst ?? 3;
  const counted = dropWorst > 0 && totalRounds > dropWorst ? totalRounds - dropWorst : null;
  // Team-level drop rule (null = teams inherit the driver drops).
  const teamDrop = season?.teamDropWorst ?? null;
  const pointsTable =
    Array.isArray(season?.pointsTable) && season.pointsTable.length ? season.pointsTable : DEFAULT_POINTS;
  const pointsPairs = pointsTable.map((pts, i) => [String(i + 1), pts]);
  const cadence = raceCadence(champRaces);

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
        <div className="grid gap-4 sm:grid-cols-3">
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

  return (
    <div className="content-in space-y-24">
      {/* ============================ HERO ============================ */}
      <section className="relative overflow-hidden rounded-[1.75rem] bg-card shadow-xl shadow-ink/20 ring-1 ring-black/5 dark:bg-ink dark:shadow-card dark:ring-white/10">
        <img
          ref={heroImgRef}
          key={heroFor(season)}
          src={heroFor(season)}
          alt=""
          onError={heroOnError}
          // Exactly the size of the card: no scale, no transform, nothing
          // sticking out past the corners. The drift is object-position now
          // (see useParallax), which moves the crop inside this box instead of
          // moving the box. object-center is where it rests when motion is off.
          className="absolute inset-0 h-full w-full object-cover object-center opacity-[0.55] dark:opacity-90"
        />
        {/* EVERYTHING BELOW THIS LINE HAS A z-INDEX FOR ONE REASON: the photo
            above is on its own compositing layer, and without one it wins.
            useParallax writes translate3d to it and the class asks for
            will-change: transform, which is two separate instructions to give
            it a layer of its own. Its siblings here had no z-index at all, so
            they were merely "later in the document" — and later in the document
            does not beat a promoted layer. The scrims painted underneath the
            photo instead of over it, which left the hero as the bare
            photograph: dark on the left where the trees are, and a bright strip
            of grass along the bottom. It looked like the background image was
            leaking out from under the card. It was the card.

            The content keeps a higher one again, or the scrims would cover the
            words they exist to make readable. */}
        {/* Light mode: white wash from the left so the copy sits on a clean card
            and the photo reads as a soft accent on the right. Dark mode keeps the
            original cinematic dark gradients.

            BOTH RAMPS ARE FLAT ON A PHONE, and that is the whole fix for a card
            that looked broken there. The card is portrait (343x588) and the
            season photo is landscape (1221x687), so object-cover keeps a narrow
            vertical strip of it — and a strip of a photograph is not a
            photograph. Measured on season 8's: brightness top to bottom runs
            41, 8, 9, 42, 26, 44, which is patches of light and near-black.
            A ramp that then goes from barely-there at the top to solid at the
            bottom lands unevenly on that, and what you see is some of the photo
            in some places and none of it in others.

            Flat and fairly strong, the same strip reads as texture behind the
            words, which is all a background can honestly be at this width. From
            sm up the card is wide, the crop is close to the photo's own shape,
            and the cinematic ramps come back untouched. */}
        {/* Phones get the flat wash; sm and up get the two original ramps,
            untouched. Three elements rather than one with responsive prefixes,
            because a background COLOUR and a background IMAGE are different
            properties: the flat wash written as a base class went on applying
            at every width, underneath the desktop ramps, and quietly darkened
            the hero on a big screen until the photo was barely there. */}
        <div className="absolute inset-0 z-10 bg-card/55 dark:bg-ink/75 sm:hidden" />
        <div className="absolute inset-0 z-10 hidden bg-gradient-to-t from-card/70 via-card/20 to-transparent dark:from-ink dark:via-ink/85 dark:to-ink/40 sm:block" />
        <div className="absolute inset-0 z-10 hidden bg-gradient-to-r from-card from-[8%] via-card/55 via-[52%] to-transparent to-[88%] dark:from-ink/90 dark:from-0% dark:via-ink/40 dark:via-50% dark:to-transparent dark:to-100% sm:block" />
        <div
          className="speed-hatch absolute inset-y-0 right-0 z-10 hidden w-[22%] dark:block"
          style={{ WebkitMaskImage: "linear-gradient(to left,#000 35%,transparent)", maskImage: "linear-gradient(to left,#000 35%,transparent)" }}
        />

        <div className="relative z-20 flex min-h-[520px] flex-col justify-center gap-6 p-7 sm:p-12 lg:max-w-3xl">
          <div className="hero-anim flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow" style={{ animationDelay: "0.05s" }}>
            <span>{season ? season.name : "NABS Racing League"}{season?.game ? ` · ${season.game}` : ""}</span>
          </div>

          {/* fluid size below sm so "wheel-to-wheel" (one unbreakable word)
              never gets clipped on narrow phones */}
          <h1 className="hero-anim font-display text-[clamp(1.5rem,7.6vw,3rem)] font-black uppercase leading-[0.92] tracking-tight text-ink dark:text-white sm:text-7xl" style={{ animationDelay: "0.12s" }}>
            Race wheel&#8209;to&#8209;wheel<br />
            <span className="text-brand">on the NABS grid</span>
          </h1>

          {/* Short on phones, full paragraph from sm up (the long copy reads as a
              wall of text on a narrow screen). */}
          <p className="hero-anim max-w-xl text-lg leading-relaxed text-ink/70 dark:text-white/80" style={{ animationDelay: "0.2s" }}>
            <span className="sm:hidden">
              A community-run racing league on Discord. Right now we race{" "}
              <span className="font-semibold text-ink dark:text-white">{carsLabel}</span>
              {showPlatform ? <> on {platform}</> : ""}. New drivers are welcome every season.
            </span>
            <span className="hidden sm:inline">
              A community-run racing league on Discord{seasonCount > 1 ? `, ${seasonCount} seasons and counting` : ""}.
              Every season we race a new era of motorsport; right now the grid runs{" "}
              <span className="font-semibold text-ink dark:text-white">{carsLabel}</span> cars
              {showPlatform ? <> on {platform}</> : ""}. A
              full championship and a friendly grid that welcomes new drivers every season, whether
              you&rsquo;re chasing wins or just learning the lines.
            </span>
          </p>

          <div data-tour="welcome-cta" className="hero-anim flex flex-wrap items-center gap-3" style={{ animationDelay: "0.3s" }}>
            <DiscordButton magnetic>Join the Discord</DiscordButton>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-xl border border-ink/15 bg-ink/5 px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-ink backdrop-blur-sm transition hover:bg-ink/10 dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/15"
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
              className="inline-flex items-center gap-2 rounded-xl px-2 py-3.5 text-sm font-bold uppercase tracking-wide text-ink/70 underline decoration-ink/25 decoration-2 underline-offset-4 transition hover:text-ink hover:decoration-brand dark:text-white/70 dark:decoration-white/25 dark:hover:text-white"
            >
              Show me around
            </button>
          </div>

          {nextRace && (
            <div className="hero-anim mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-ink/55 dark:text-white/60" style={{ animationDelay: "0.38s" }}>
              <span className="text-ink/40 dark:text-white/40">Next race</span>
              {nextCircuit && <Flag code={nextCircuit.country} title={nextCircuit.countryName} w={18} h={13} />}
              <span className="font-bold text-ink/90 dark:text-white/90">{nextRace.track}</span>
              <span className="hidden sm:inline text-ink/30 dark:text-white/30">·</span>
              <span className="hidden sm:inline">{fmtRaceTime(nextRace.date)}</span>
            </div>
          )}
        </div>
      </section>

      {/* ====================== BY THE NUMBERS ====================== */}
      {/* The four figures a newcomer actually wants: how long this has been
          running, how big the community is, how many teams, how many seasons.
          They used to be season-scoped counts ("drivers this season", "rounds
          this season"), which measure the current calendar rather than the
          league — a visitor landing between seasons met a page boasting about
          twelve rounds and ninety-nine drivers of something already finished.
          Both numbers the database cannot answer (the Discord size and the
          starting year) come from /settings/league-stats; a tile whose figure is
          missing simply drops out rather than showing a zero. */}
      {/* No boxes. Four equal cards each holding one big number is the stat row
          every product page on the internet has, which is exactly why it read as
          generic no matter what went inside them — a scattered-artwork version
          was tried and thrown out for the same reason. This is the language the
          rest of the site already speaks: figures in the display face, mono
          labels underneath, separated by hairlines and sitting straight on the
          page. Closer to a timing board than to marketing. */}
      {/* The vertical rules only from sm up. On a phone the 2x2 grid with both
          rules drew a cross through a bordered block, which turns the band back
          into the boxed card this was meant to get away from. Two figures side
          by side with one rule between the rows is enough separation there. */}
      <section className="cascade -mt-6 border-y border-border sm:-mt-8">
        <div className="grid grid-cols-2 divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {[
            { label: "years of racing", value: stats.data?.years },
            { label: "Discord members", value: stats.data?.discordMembers, round: true },
            { label: "teams", value: teamCount },
            { label: "seasons and counting", value: seasonCount || 1 },
          ]
            .filter((s) => Number(s.value) > 0)
            .map((s, i) => (
              <div key={s.label} className="px-4 py-6 text-center sm:px-6 sm:py-8" style={{ "--i": i }}>
                <div className="font-display text-4xl font-black leading-none tabular-nums text-dark sm:text-5xl">
                  {/* The community size is an approximation from Discord and
                      moves by a few every week, so it is shown as "900+" rather
                      than a precise 945 that is wrong an hour later. */}
                  <CountUp end={s.round ? Math.floor(s.value / 100) * 100 : s.value} />
                  {s.round && "+"}
                </div>
                <div className="mt-2 font-mono text-[11px] font-bold uppercase tracking-widest text-light">
                  {s.label}
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* =============== NEXT SEASON (transition period only) =============== */}
      <NextSeasonTeaser />

      {/* ====================== WHAT IS NABS ======================= */}
      <section>
        {/* The one heading on the page that answers the question a newcomer
            actually types into a search box, so it names the sim and the cars
            rather than leaving both to the paragraphs below. Both come from the
            season's own `game` field, so the sentence follows the league to
            whatever it races next. */}
        <SectionHead
          center
          eyebrow="New here?"
          title="What is the NABS Racing League?"
          sub={`A community-run online ${carsLabel} championship${
            showPlatform ? ` on ${platform}` : ""
          } for sim racers. Here's the short version.`}
        />
        <div className="cascade grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard index={0} icon="wheel" title="A new era every season">
            Each season we race a fresh grid of equally matched cars, right now {carsLabel}
            {showPlatform ? ` on ${platform}` : ""}, with proper physics and no driver aids holding your hand.
          </FeatureCard>
          <FeatureCard index={1} icon="layers" title="Racing at every level">
            Grids are split by pace so the racing stays close, whatever your speed. Reserves can step in for
            any team when a regular can&rsquo;t make a round, and a perfect way to get your first start.
          </FeatureCard>
          <FeatureCard index={2} icon="calendar" title="A real season">
            {totalRounds > 0 ? `${totalRounds} rounds` : "A full season of rounds"} on iconic circuits
            {cadence ? `, run ${cadence}` : ""}.{" "}
            {dropWorst > 0
              ? counted
                ? `Your best ${counted} results count toward the title, so one bad night never ends your championship.`
                : `Your ${dropWorst} weakest rounds are dropped, so one bad night never ends your championship.`
              : "Every round counts, so consistency is everything."}
          </FeatureCard>
          <FeatureCard index={3} icon="community" title="Built on Discord">
            Everything happens in our Discord: sign-ups, banter, stewarding and results. This site is just
            the scoreboard that updates itself after every race.
          </FeatureCard>
        </div>
      </section>

      {/* ====================== SEASON TIMELINE ======================= */}
      {/* League history straight from the DB: appears per season entered by the
          admin, so it grows on its own. Hidden while only one season exists. */}
      {timeline.length > 1 && (
        <section>
          <SectionHead
            center
            eyebrow="Since day one"
            title="One league, many eras"
            sub="Same community, same rivalries. But every season NABS reinvents itself with a new car era."
          />
          {/* Centered flex (not a grid): looks right with the 2 seasons in the DB
              today and still wraps into tidy rows once all 8 are entered. */}
          <div className="cascade flex flex-wrap justify-center gap-3">
            {timeline.map((s, i) => {
              // "Live now" needs a race still to come, not just the isActive
              // flag: that flag stays set on the running season for weeks after
              // its finale, so the strip kept advertising a season whose last
              // round was long gone. `nextRace` is the same signal the rest of
              // this page uses (null once every round is run).
              const status =
                s.isActive && nextRace ? "live" : s.number > activeNumber ? "next" : "done";
              return (
                <div key={s.id} className="card shine relative w-full overflow-hidden p-5 sm:w-64" style={{ "--i": i }}>
                  {/* the season's own hero photo (admin upload or the static
                      /heroes/s<n>.jpg), washed back behind the card content; a
                      season without one just stays a plain card */}
                  <img
                    src={heroFor(s)}
                    alt=""
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                    className="absolute inset-0 h-full w-full object-cover opacity-30 dark:opacity-25"
                  />
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-t from-card via-card/75 to-card/20"
                  />
                  <span
                    className={`absolute inset-x-0 top-0 h-1 ${
                      status === "live" ? "bg-brand" : status === "next" ? "bg-sky-400" : "bg-border"
                    }`}
                  />
                  <div className="relative flex items-start justify-between gap-3">
                    <span className="font-display text-3xl font-black leading-none text-faint">
                      S{s.number}
                    </span>
                    {status === "live" && (
                      <span className="flex items-center gap-1.5 rounded-md bg-brand px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-ink">
                        <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-ink/70" />
                        Live now
                      </span>
                    )}
                    {status === "next" && (
                      <span className="rounded-md bg-sky-400/15 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-sky-500 dark:text-sky-300">
                        Coming up
                      </span>
                    )}
                    {status === "done" && (
                      <span className="rounded-md border border-border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                        Completed
                      </span>
                    )}
                  </div>
                  <div className="relative mt-3 font-display text-lg font-extrabold uppercase tracking-tight text-dark">
                    {/^\d+$/.test(String(s.name).trim()) ? `Season ${s.name}` : s.name}
                  </div>
                  <div className="relative mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
                    {seasonGameLabel(s) || "Era to be announced"}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ====================== HOW IT WORKS ======================= */}
      <section id="how-it-works" className="scroll-mt-24">
        <SectionHead
          eyebrow="The format"
          title="How the championship works"
          sub="Finish a race, earn points for your position, and climb the tables, as a driver and as a team."
        />
        <div className="grid gap-6 lg:grid-cols-5">
          {/* points table */}
          <div className="reveal card overflow-hidden lg:col-span-3">
            <div className="flex items-center gap-2 border-b border-border px-5 py-4">
              <Icon name="trophy" className="h-4 w-4 text-brand" />
              <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Points per finish</h3>
              <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-light">P{pointsPairs.length + 1}+ &amp; DNF = 0</span>
            </div>
            <div className="grid grid-cols-3 gap-px bg-border sm:grid-cols-6">
              {pointsPairs.map(([pos, pts], i) => {
                const medal = i < 3 ? MEDAL[i] : null;
                return (
                  <div key={pos} className="flex flex-col items-center justify-center bg-card py-3">
                    <span
                      className="flex h-6 min-w-6 items-center justify-center rounded px-1 font-display text-xs font-black"
                      style={{ backgroundColor: medal || "transparent", color: medal ? "#0F172A" : "var(--c-text3)" }}
                    >
                      P{pos}
                    </span>
                    <span className="mt-1 font-mono text-lg font-bold tabular-nums text-dark">{pts}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* drivers/constructors explainer */}
          <div className="reveal space-y-4 lg:col-span-2">
            <div className="card p-5">
              <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">Drivers &amp; constructors</h3>
              <ul className="mt-3 space-y-3 text-sm leading-relaxed text-light">
                <li><span className="font-bold text-dark">Drivers:</span> everyone in the field, ranked in one table by points scored.</li>
                <li><span className="font-bold text-dark">Constructors:</span> each level of the grid runs its own separate teams&rsquo; table, so there&rsquo;s a title to fight for wherever you race.</li>
              </ul>
            </div>
            <div className="card flex items-start gap-3 p-5">
              <Icon name="flag" className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
              <p className="text-sm leading-relaxed text-light">
                {dropWorst > 0 ? (
                  <>
                    <span className="font-bold text-dark">
                      {counted ? `Best ${counted} of ${totalRounds}.` : `Your worst ${dropWorst} don't count.`}
                    </span>{" "}
                    Every driver&rsquo;s {dropWorst} lowest-scoring rounds are dropped.{" "}
                    {teamDrop != null && teamDrop > 0
                      ? `Teams drop their own ${teamDrop} weakest single-driver rounds too.`
                      : "The team standings inherit those drops too."}{" "}
                    Consistency wins titles, not luck.
                  </>
                ) : (
                  <>
                    <span className="font-bold text-dark">Every round counts.</span> No dropped results this
                    season, so bring your A-game to every race.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ====================== GET STARTED ======================= */}
      <section className="grid gap-10 lg:grid-cols-2 lg:items-center">
        <div>
          <SectionHead
            eyebrow="Get on the grid"
            title="Joining is easy"
            sub="No tryout, no pressure. If you can drive a clean race, there's a seat for you."
          />
          <ol className="mt-2">
            <Step n="1" title="Join the Discord">
              That&rsquo;s the home base. Hop in, say hello in the intro channel and let us know you&rsquo;d like to race.
            </Step>
            <Step n="2" title="Get set up">
              Install the season&rsquo;s game and car mod (right now that&rsquo;s {carsLabel}
              {showPlatform ? ` on ${platform}` : ""}) and run a few laps. Everything you need is linked in the
              Discord and on the Race Info page.
            </Step>
            <Step n="3" title="Sign up for a round">
              Each race you mark yourself Accepted, Tentative or Declined, right here on the site or in Discord.
            </Step>
            <Step n="4" title="Go racing" last>
              Line up on the grid, race fair, and watch your name climb the standings after every round.
            </Step>
          </ol>
          <DiscordButton className="mt-2" magnetic>Join the Discord</DiscordButton>
        </div>

        {/* live teaser */}
        <div className="reveal space-y-4">
          {nextRace && (
            <div className="card relative overflow-hidden p-6">
              <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand to-primary" />
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Next race in</div>
                <Link to="/races" className="font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:text-dark">
                  Calendar →
                </Link>
              </div>
              <div className="mt-1 flex items-center gap-2.5">
                {nextCircuit && <Flag code={nextCircuit.country} title={nextCircuit.countryName} w={24} h={18} />}
                <span className="font-display text-2xl font-black uppercase tracking-tight text-dark">{nextRace.track}</span>
              </div>
              <RaceCountdown date={nextRace.date} className="mt-4" />
            </div>
          )}

          <LastRaceCard race={lastRace} />

          {top3.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                {/* "right now" only while there IS a race on. With every round
                    run the same card was still promising a live title fight
                    over a table that had not moved in weeks. */}
                <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-dark">
                  {nextRace ? "Title race right now" : "How the season finished"}
                </h3>
                <Link to="/drivers" className="font-mono text-[11px] font-bold uppercase tracking-wider text-light transition hover:text-dark">
                  Full table →
                </Link>
              </div>
              <div className="divide-y divide-border">
                {top3.map((d, i) => (
                  <Link key={d.driverId} to={`/drivers/${d.driverId}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-surface2">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-display text-sm font-black text-ink"
                      style={{ backgroundColor: MEDAL[i] }}
                    >
                      {i + 1}
                    </span>
                    <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: d.team.color }} />
                    <span className="min-w-0 flex-1 truncate font-display text-base font-bold uppercase tracking-tight text-dark">{d.name}</span>
                    <Flag code={countryFor(d.driverId, d.country)} />
                    <span className="font-mono text-base font-bold tabular-nums text-dark">{d.total}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ====================== FAQ ======================= */}
      <section>
        <SectionHead center eyebrow="Good to know" title="Frequently asked" />
        <div className="mx-auto grid max-w-3xl gap-3">
          {faqItems ? (
            // Admin-edited FAQ: whatever questions were saved, with live numbers
            // filled into the {placeholders}.
            faqItems.map((it, i) => (
              <FaqItem key={i} q={fillFaq(it.q, faqTokens)}>
                {richFaq(fillFaq(it.a, faqTokens))}
              </FaqItem>
            ))
          ) : (
          <>
          <FaqItem q="Do I need to be fast to join?">
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
                : `Your ${dropWorst} lowest-scoring rounds are dropped, so only your best races count.`
              : "Every round counts toward the championship."}{" "}
            It&rsquo;s all calculated automatically and shown live on this site.
          </FaqItem>
          </>
          )}
        </div>
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
      <section className="reveal relative overflow-hidden rounded-[1.75rem] bg-ink p-10 text-center shadow-xl shadow-ink/20 sm:p-14">
        <div className="absolute inset-0 opacity-60" style={{ background: "radial-gradient(120% 120% at 50% 0%, rgb(var(--c-brand) / 0.25), transparent 60%)" }} />
        <div className="speed-hatch absolute inset-0 opacity-30" />
        <div className="relative">
          <h2 className="font-display text-3xl font-black uppercase tracking-tight text-white sm:text-5xl">
            Ready to line up?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/75">
            The next grid is forming now. Jump into the Discord, introduce yourself, and we&rsquo;ll get you on
            track for the next round.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <DiscordButton magnetic>Join the Discord</DiscordButton>
            {/* The series-prefixed address, not the flat /drivers: that one is
                a legacy path the server answers with a redirect, and an internal
                link should point where it is going. */}
            <Link
              to={seriesPath("/drivers")}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3.5 text-sm font-bold uppercase tracking-wide text-white backdrop-blur-sm transition hover:bg-white/15"
            >
              Browse the standings
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
