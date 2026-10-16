// ---------------------------------------------------------------------------
// The race recap: the round told from your seat, as one page of cards.
//
// Built to a mock-up Malte drew: a header with the track's name and your
// driver chip, then cards that each say one thing with one big number and a
// line of words under it (where you finished and what that meant, what it
// paid, your pace against the field, the tyres, your incidents, the lap chart,
// the rating, the season curve, the NABS Tokens, your team-mate, the night's
// honours).
//
// The page builds itself as you scroll. Each card is a .recap-reveal that the
// page watches for itself (a stricter line than the site's own reveal: a card
// has to be a good way into the screen), and everything inside a card waits
// for its card: the car slides from grid to flag, the numbers tick from what
// they were, the curves draw, the bars fill, the tags land last.
//
// Opened three ways. The host at the app root sends a member here the first
// time they come back after the office saved a round (with the recap already
// in hand, in the location state, and `pending` set so arriving counts as
// seen). The Recap button on a race page links here for a second look. And
// the admin preview opens it with ?seat=<driverId> to see any driver's version
// of any round, which never counts as seen for anybody.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useSeriesPath } from "../context/SeriesContext.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { motionOff } from "../hooks/motion.js";
import { DriverAvatar, TierBadge, ErrorBox, PageHeaderSkeleton, CardsSkeleton } from "../components/ui.jsx";
import { Modal } from "../components/overlay.jsx";
import { buildRaceFacts } from "../components/RaceFacts.jsx";
import { TyreBadge } from "../components/TyreStrategy.jsx";
import { tyreCompound } from "../data/liveTiming.js";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import TokenIcon from "../components/TokenIcon.jsx";
import { countryFor } from "../data/driverCountries.js";
import { flagFor } from "../data/circuits.js";
import { fmtLap, fmtLapDelta, fmtRaceDateFull, NO_VALUE } from "../utils/format.js";
import { fmtDuration, fmtGap } from "../utils/raceDuration.js";
import { fmtRaceTime } from "../utils/raceTime.js";
// The tile icons, all from Lucide, all the same size and stroke.
import RaceReplay, { buildReplay, ReplaySkeleton, inkFor } from "./recap/RaceReplay.jsx";
import { Card, Label, Delta, Row, Tween, Ticker, Bar, Chapter } from "./recap/parts.jsx";
import { RatingBreakdown, StandingsTower, SeasonCurve, TokensCard, TeammateSplit, HonoursBadges, Finale } from "./recap/cards.jsx";
import { sineInOutInverse } from "./recap/spring.js";
import { CmpProvider, TierSwitch, useCmp, useCmpValue, cmpLine, tierPlaces } from "./recap/cmp.jsx";
import "./recap/replay.css";
import "./recap/polish.css";
import "./recap/g3.css";
import "./recap/cmp.css";
import "./recap/desktop.css";
import { Timer, Gauge, Activity, ArrowLeftRight, ShieldCheck, Flag as FlagIcon, Hourglass, Rocket, Crown, ChevronRight } from "lucide-react";
import RaceRecapPageClassic from "./RaceRecapPageClassic.jsx";

// This page (with the race replay) is for rounds raced from 16 Oct 2026 on.
// Every round before that keeps the recap it was shown with, so a recap read
// again from a race page looks the way it did on the night.
const NEW_RECAP_FROM = new Date("2026-10-16T00:00:00+02:00");
const isClassicRecap = (recap) => !!recap?.race?.date && new Date(recap.race.date) < NEW_RECAP_FROM;

export default function RaceRecapPage() {
  const { raceId } = useParams();
  const [params] = useSearchParams();
  const seat = params.get("seat"); // admin preview: whose seat ("" = nobody's)
  const location = useLocation();
  const navigate = useNavigate();
  const { seriesPath } = useSeriesPath();
  const handed = location.state?.recap?.race?.id === raceId ? location.state.recap : null;
  const pending = !!location.state?.pending;
  const [recap, setRecap] = useState(handed);
  const [error, setError] = useState(null);
  // The lap chart of the race being shown, kept under its race id: a sprint
  // weekend has one per half and they must never be drawn over each other.
  const [laps, setLaps] = useState(null);
  // Which race's lap chart request has come back (with data or without), so
  // the player's frame can stand in while it is on its way and step aside
  // when there is nothing to replay.
  const [lapsDone, setLapsDone] = useState(null);
  // Which race of the weekend the detail cards are about. A plain round has
  // only one and never shows the switch; ?session=sprint is the Sprint tab's
  // own Recap button, and falls back to the feature race when the round ran
  // only the one.
  const [half, setHalf] = useState(params.get("session") === "sprint" ? "sprint" : "feature");
  // Who the numbers are set against: the whole field, or one tier. One choice
  // for the whole page (cmp.jsx); `live` once the reader has used it, so what
  // changes then moves at once instead of waiting for its card's entrance.
  const [cmpTier, setCmpTier] = useState("all");
  const [cmpLive, setCmpLive] = useState(false);
  const pickTier = useCallback((t) => {
    setCmpTier(t);
    setCmpLive(true);
  }, []);

  useEffect(() => {
    if (handed) return;
    let gone = false;
    const ask = seat != null ? api.adminRaceRecapPreview(raceId, seat || null) : api.myRaceRecapFor(raceId);
    ask.then((r) => !gone && setRecap(r.recap)).catch((e) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [raceId, seat, handed]);

  // Arriving is seeing: the member is on the page now, whatever they click
  // next. (An older round goes to the classic page, which marks it itself.)
  useEffect(() => {
    if (pending && recap && !isClassicRecap(recap)) api.markRaceRecapSeen(raceId).catch(() => {});
  }, [pending, raceId, recap]);

  // The race the detail cards are about: the feature race, or the sprint of a
  // sprint weekend. Both halves come back in the same shape, so everything
  // below reads the same field names either way; what belongs to the WEEKEND
  // rather than to one race (the championship, the rating, the season, the
  // NABS Tokens) keeps being read off `recap`.
  const shown = half === "sprint" && recap?.sprint ? { ...recap, ...recap.sprint, half: "sprint" } : recap && { ...recap, half: "feature" };
  const shownId = shown?.race?.id || null;
  const classic = isClassicRecap(recap);

  useEffect(() => {
    setLaps(null);
    if (classic || !shown?.race?.hasLapChart || !shown.you?.raced || !shownId) return;
    let gone = false;
    api
      .raceLaps(shownId)
      .then((d) => {
        if (gone) return;
        if (d?.available) setLaps({ raceId: shownId, ...d });
        setLapsDone(shownId);
      })
      .catch(() => !gone && setLapsDone(shownId));
    return () => {
      gone = true;
    };
  }, [classic, shown?.race?.hasLapChart, shown?.you?.raced, shownId]);

  // The replay of the race being shown, worked out once per lap chart.
  const shownChart = laps && laps.raceId === shownId ? laps : null;
  const replay = useMemo(() => (shownChart && shown?.you?.raced ? buildReplay(shownChart, shown) : null), [shownChart]); // eslint-disable-line react-hooks/exhaustive-deps
  const replayWaiting = !!(shown?.race?.hasLapChart && shown?.you?.raced && lapsDone !== shownId && !shownChart);

  const cmp = useCmpValue(shown?.results, shown?.you, cmpTier, pickTier, cmpLive);

  useRecapReveal(recap, laps, half, lapsDone);
  const rootRef = useCardDepth(recap, laps, half, lapsDone);
  useSpecificTitle(recap ? `NABS Race Recap · ${recap.race.track}` : "NABS Race Recap");

  if (error) return <ErrorBox message={error} />;
  if (classic) return <RaceRecapPageClassic initialRecap={recap} />;
  if (!recap) {
    return (
      <div className="space-y-5">
        <PageHeaderSkeleton />
        <CardsSkeleton count={3} cols="lg:grid-cols-[1.75fr,1fr]" />
        <CardsSkeleton count={4} cols="sm:grid-cols-2 lg:grid-cols-4" />
      </div>
    );
  }

  // Of the shown race; the rest is the weekend's and comes off `recap`.
  const { race, results, quali, you, story, incidents } = shown;
  const { career, season, teammates, standings, team, rating, points, card, sprint, weekend } = recap;
  const resultsLink = seriesPath(`/races?race=${recap.race.id}`);
  const showPoints = points && (points.entries.length > 0 || points.pending?.length > 0);
  const leave = () => (pending ? navigate(-1) : navigate(resultsLink));

  // The chapters, numbered as they come: only the ones this round has.
  let chapterNo = 0;
  const ch = () => String((chapterNo += 1)).padStart(2, "0");
  const teamColor = you?.team?.color || null;
  const actions = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        <Link to={resultsLink} className="btn-primary">
          Full race results
        </Link>
        {you && (
          <Link to={`/drivers/${you.driverId}`} className="btn-secondary">
            My driver page
          </Link>
        )}
      </div>
      <button type="button" onClick={leave} className="text-sm font-semibold text-light transition hover:text-dark">
        {pending ? "Carry on to the site" : "Done"}
      </button>
    </div>
  );
  const hasStrategy = you?.raced && (story?.stints?.length > 0 || incidents);
  const shownWord = shown.half === "sprint" ? "the sprint" : sprint ? "the feature race" : "the race";

  return (
    <CmpProvider value={cmp}>
    <div ref={rootRef} className={`rr space-y-4 sm:space-y-5 ${cmp.live ? "rr-live" : ""}`} style={{ "--recap-team": teamColor || "var(--c-text)", "--recap-ink": teamColor ? inkFor(teamColor) : "var(--c-card)" }}>
      <Header recap={recap} shown={shown} preview={seat != null} />
      {/* A sprint weekend is one round with two races. Both are shown here,
          each with what it finished and what it paid, and the round's total
          is the two of them added up where everybody can see it. Picking one
          turns the replay and the chapters below over to that race. */}
      {sprint && (recap.you || sprint.you) && <WeekendCard recap={recap} half={half} onHalf={setHalf} />}
      {/* The race played back, lap by lap, ending on the result. While the
          lap chart is on its way its frame holds the place; with no lap chart
          the finishing card tells the result the way it always has. */}
      {replay ? <RaceReplay key={`replay-${shownId}`} R={replay} recap={shown} /> : replayWaiting ? <ReplaySkeleton recap={shown} /> : null}

      {/* Below the replay the round is told in chapters, each called in like
          a broadcast segment. Keyed on the race being shown: switching halves
          rebuilds them, so each race arrives with the same motion. */}
      {you && (
        <section key={`result-${shownId}`} className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Result" sub={shownWord === "the race" ? "Finish and points" : `Finish and points, ${shownWord.replace("the ", "")}`} />
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1.75fr,1fr]">
            <FinishCard recap={shown} compact={!!replay} />
            <RoundCard recap={shown} weekend={weekend} />
          </div>
        </section>
      )}
      {(you?.raced || rating?.after) && (
        <section key={`pace-${shownId}`} className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Pace" sub="Laps, pace and rating" />
          {you?.raced && cmp.available && <CompareBar />}
          {you?.raced && <StatCards you={you} story={story} race={race} results={results} chart={shownChart} />}
          {rating?.after && <RatingBreakdown rating={rating} card={card} />}
        </section>
      )}
      {hasStrategy && (
        <section key={`strategy-${shownId}`} className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Strategy" sub="Tyres, stops, contact" />
          <div className={`grid gap-4 sm:gap-5 ${story?.stints?.length > 0 && incidents ? "lg:grid-cols-[1.2fr,1fr]" : ""}`}>
            {story?.stints?.length > 0 && (
              <StintsCard
                stints={story.stints}
                raceLaps={race.raceLaps}
                wide={!incidents}
                // Whether this round has the lap times a tyre reading is made
                // from at all. Without them every stint would read "too short",
                // which is not what happened, so the line is left out.
                wearKnown={story.stints.some((st) => st.degMsPerLap != null) || (story.laps || []).some((l) => l.timeMs > 0)}
              />
            )}
            {incidents && <IncidentsCard incidents={incidents} you={you} />}
          </div>
        </section>
      )}
      {season && standings?.after && (
        <section className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Championship" sub={recap.race.number != null ? `The table after round ${recap.race.number}` : "The table"} />
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1fr,1.45fr]">
            <StandingsTower standings={standings} team={team} season={season} you={you} />
            <SeasonCurve season={season} />
          </div>
          {career && you && <CareerCard career={career} you={you} race={recap.race} />}
        </section>
      )}
      {showPoints && (
        <section className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Rewards" sub="NABS Tokens" />
          <TokensCard points={points} />
        </section>
      )}
      {teammates?.length > 0 && you && (
        <section className="space-y-4 sm:space-y-5">
          <Chapter n={ch()} title="Team" sub={you.team?.name ? `Inside ${you.team.name}` : "Your team-mate"} />
          <TeammateSplit you={you} mates={teammates} standings={standings} card={card} field={recap.race.starters || recap.race.fieldSize} />
        </section>
      )}
      <section key={`flag-${shownId}`} className="space-y-4 sm:space-y-5">
        <Chapter n={ch()} title="The flag" sub="Honours and classification" />
        <HonoursBadges race={race} results={results} quali={quali} sprint={shown.half === "sprint"} youId={you?.driverId} />
        <Finale recap={recap} shown={shown} actions={actions} />
      </section>
    </div>
    </CmpProvider>
  );
}

// --- the motion ---------------------------------------------------------------

// Lets every .recap-reveal on the page in once it is a good way into the
// screen (its top past the lower fifth of the viewport); several arriving in
// one pass fan out top to bottom. A scroll check rather than an
// IntersectionObserver, like the site's own reveal: it never leaves a card
// stuck invisible, whatever the browser is doing with its frames. Re-armed
// whenever the page grows (the lap chart card lands a beat later).
function useRecapReveal(...deps) {
  useEffect(() => {
    const pending = () => [...document.querySelectorAll(".recap-reveal:not(.is-visible)")];
    if (!pending().length) return;
    if (motionOff()) {
      pending().forEach((el) => el.classList.add("is-visible"));
      return;
    }
    // A short timer rather than an animation frame: frames stop when the tab
    // is not painting, timers do not, and the site's own reveal learned the
    // same lesson (hooks/useScrollReveal.js).
    let timer = 0;
    const check = () => {
      timer = 0;
      const line = window.innerHeight * 0.82;
      const due = pending()
        .map((el) => ({ el, top: el.getBoundingClientRect().top }))
        .filter((x) => x.top < line)
        .sort((a, b) => a.top - b.top);
      // Calm steps: cards arriving together follow one another 140 ms apart.
      due.forEach(({ el }, i) => {
        el.style.setProperty("--reveal-delay", `${Math.min(i, 6) * 140}ms`);
        el.classList.add("is-visible");
      });
    };
    const onScroll = () => {
      if (!timer) timer = setTimeout(check, 40);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// Scroll-linked depth: a card still low on the screen sits a little further
// down, and glides up into its place as it is scrolled towards the reading
// line (35% down the screen), where it comes to rest. Chapter headers sit on
// a nearer layer and travel a touch more. It writes the `translate` property
// only, which composes with the entrance's `transform` and never touches
// layout; positions are read from the layout (offsetTop), never from the
// moved boxes, so it cannot feed back on itself. Off with reduced motion.
function useCardDepth(...deps) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || motionOff()) return undefined;
    let items = [];
    let raf = 0;
    const docTop = (el) => {
      let y = 0;
      for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
      return y;
    };
    const measure = () => {
      items = [...root.querySelectorAll(".recap-reveal")].slice(1).map((el) => ({
        el,
        top: docTop(el),
        k: el.classList.contains("rr-chapter") ? 0.075 : 0.06,
        max: el.classList.contains("rr-chapter") ? 44 : 36,
        last: null,
      }));
    };
    const update = () => {
      raf = 0;
      if (motionOff()) {
        items.forEach((it) => it.el.style.removeProperty("translate"));
        return;
      }
      const vh = window.innerHeight;
      const line = vh * 0.35;
      const sy = window.scrollY;
      for (const it of items) {
        const top = it.top - sy;
        if (top > vh * 1.4 || top < -vh) continue;
        const off = Math.max(0, Math.min(it.max, (top - line) * it.k));
        const r = Math.round(off * 10) / 10;
        if (r !== it.last) {
          it.last = r;
          it.el.style.translate = r ? `0 ${r}px` : "";
        }
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const remeasure = () => {
      measure();
      onScroll();
    };
    measure();
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(remeasure) : null;
    ro?.observe(root);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", remeasure);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

const teamOf = (row) => row?.effectiveTeam || row?.team || null;
// 1st, 2nd, 3rd, 11th, 12th, 13th, 21st, 32nd ...
const nth = (n) => (n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`);

// --- the header ---------------------------------------------------------------

// `shown` is the race the cards below are about (the feature race, or the
// sprint of a sprint weekend); the eyebrow and the title stay the weekend's,
// because one round is one round however many races it ran.
function Header({ recap, shown, preview }) {
  const { race, you, results, card } = recap;
  const seen = shown?.race || race;
  const flag = flagFor(race.track, race.country);
  const photo = card?.driver?.photoUrl || results.find((r) => r.driverId === you?.driverId)?.photoUrl || null;
  const tier = card?.driver?.tier ?? results.find((r) => r.driverId === you?.driverId)?.driverTier ?? null;
  const time = race.date ? fmtRaceTime(race.date) : "";
  const weekend = !!recap.sprint;
  return (
    <div className="recap-reveal rr-head-block flex flex-wrap items-end justify-between gap-6 border-b border-border pb-6">
      <div className="min-w-0">
        {/* Each line slides up out of its own mask, one after another. */}
        <div className="rr-mask rr-hl rr-hl-1">
          <div className="rr-mask-in">
        <Label>
          {[
            you ? "Your race summary" : "Race summary",
            race.seasonNumber != null ? `Season ${race.seasonNumber}` : null,
            race.number != null ? `Round ${race.number}` : null,
            weekend ? "Sprint weekend" : null,
            preview ? "preview" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Label>
          </div>
        </div>
        <div className="rr-mask rr-hl rr-hl-2 mt-2">
        <h1 className="rr-mask-in flex flex-wrap items-center gap-x-4 gap-y-2 font-display text-[clamp(2.25rem,9vw,3.75rem)] font-black uppercase leading-none tracking-tight text-dark">
          {flag && <Flag code={flag.country} w={40} h={30} className="rounded-sm" />}
          <span className="min-w-0">{race.track}</span>
        </h1>
        </div>
        <div className="rr-mask rr-hl rr-hl-3 mt-3">
        <div className="rr-mask-in text-sm text-medium">
          {[
            race.date ? fmtRaceDateFull(race.date) : null,
            time || null,
            // On a sprint weekend the distances are the night's, both of them;
            // on a plain round it is the one race's.
            weekend
              ? [recap.sprint.race.raceLaps ? `${recap.sprint.race.raceLaps} lap sprint` : "sprint", race.raceLaps ? `${race.raceLaps} lap feature race` : "feature race"].join(" + ")
              : race.raceLaps
                ? `${race.raceLaps} laps`
                : null,
            seen.starters ? `${seen.starters} starters` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        </div>
      </div>
      {you && (
        <div className="rr-chip flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <DriverAvatar name={you.name} photoUrl={photo} color={you.team?.color || "#232833"} size={44} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-black uppercase tracking-tight text-dark">{you.name}</span>
              {tier != null && <TierBadge tier={tier} />}
            </div>
            {you.team && <TeamLogo id={you.team.id} name={you.team.name} color={you.team.color} logoUrl={you.team.logoUrl} size={14} showName nameClassName="text-xs text-light" />}
          </div>
        </div>
      )}
    </div>
  );
}

// --- the weekend --------------------------------------------------------------

// What one race of the weekend did, in a box small enough to sit beside the
// other: where it finished, what it moved from the grid, what it paid. The box
// is also the switch — picking it turns the cards below over to that race —
// so both results are readable at a glance and either can be opened.
function WeekendRace({ label, race, you, active, onPick }) {
  const outcome = !you ? NO_VALUE : !you.raced ? "DNS" : you.finished ? `P${you.position}` : you.status || NO_VALUE;
  const moved = you?.finished && you.grid != null ? you.grid - you.position : null;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`flex-1 rounded-xl border p-4 text-left transition ${active ? "bg-surface2/70" : "border-border bg-card hover:border-light"}`}
      style={active ? { borderColor: "var(--recap-team)" } : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <Label tone={active ? "text-dark" : "text-light"}>{label}</Label>
        {race?.raceLaps > 0 && <span className="font-mono text-[11px] text-faint">{race.raceLaps} laps</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-display text-4xl font-black leading-none tracking-tight text-dark">{outcome}</span>
        <span className="font-display text-2xl font-black leading-none tabular-nums text-accent">
          {you && you.points > 0 ? `+${you.points}` : "0"}
          <span className="ml-1 font-mono text-[10px] font-bold text-light">pts</span>
        </span>
      </div>
      <div className="mt-2 font-mono text-[11px] text-light">
        {you?.finished && you.grid != null
          ? `from P${you.grid} · ${moved > 0 ? `+${moved}` : moved < 0 ? `−${-moved}` : "±0"} places`
          : you?.raced && you.grid != null
            ? `from P${you.grid}`
            : "\u00a0"}
      </div>
    </button>
  );
}

// The round as the two races it was run as. The total is the sum, and it is
// written as a sum: a driver who sees "+47" on a sprint weekend should be able
// to see which race paid what without opening anything.
function WeekendCard({ recap, half, onHalf }) {
  const w = recap.weekend || {};
  const sprintPts = w.sprint ?? recap.sprint?.you?.points ?? 0;
  const featurePts = w.feature ?? recap.you?.points ?? 0;
  const total = w.total ?? sprintPts + featurePts;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Label>The weekend, race by race</Label>
        <Label tone="text-light">Tap a race to read it below</Label>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[2fr,1fr]">
        <div className="flex flex-col gap-3 sm:flex-row">
          {/* The order the weekend was run and is spelled out everywhere else
              on the site: the sprint, then the feature race. */}
          <WeekendRace label="Sprint" race={recap.sprint.race} you={recap.sprint.you} active={half === "sprint"} onPick={() => onHalf("sprint")} />
          <WeekendRace label="Feature race" race={recap.race} you={recap.you} active={half !== "sprint"} onPick={() => onHalf("feature")} />
        </div>
        <div className="flex flex-col justify-center rounded-xl border border-border bg-surface2/40 p-4">
          <Label tone="text-light">Round total</Label>
          <div className="mt-1 font-display text-5xl font-black leading-none tabular-nums text-accent">
            <Tween to={total} prefix={total > 0 ? "+" : ""} />
            <span className="ml-1 font-mono text-xs font-bold text-light">pts</span>
          </div>
          <div className="recap-tag mt-2 font-mono text-[11px] text-light" style={{ "--tag-delay": "1200ms" }}>
            {sprintPts} from the sprint + {featurePts} from the feature race
          </div>
        </div>
      </div>
    </Card>
  );
}

// --- finishing position -------------------------------------------------------

// The whole grid as a track, back of the field on the left and P1 on the
// right, and the car sliding from where it started to where it finished,
// leaving its team colour behind it.
function GridToFlag({ grid, finish, field }) {
  const at = (p) => ((field - p) / Math.max(1, field - 1)) * 100;
  const from = at(grid);
  const to = at(finish);
  const w = Math.abs(to - from);
  const step = field > 30 ? 10 : field > 12 ? 5 : 1;
  const ticks = [];
  for (let p = field; p >= 1; p -= 1) if (p === 1 || p === field || p % step === 0) ticks.push(p);
  return (
    <div className="relative h-14 w-full">
      <div className="absolute inset-x-0 top-5 h-px bg-border" />
      {ticks.map((p) => (
        <div key={p} className="absolute top-5 -translate-x-1/2" style={{ left: `${at(p)}%` }}>
          <div className="mx-auto h-2 w-px bg-border" />
          <div className="mt-1 font-mono text-[10px] font-bold tabular-nums text-faint">P{p}</div>
        </div>
      ))}
      {/* The trail is pinned to the GRID slot and grows towards the finish:
          from the left when places were gained, from the right when they
          were lost, so it follows the car instead of filling in backwards. */}
      <div
        className={`rr-sweep-trail absolute top-[19px] h-[3px] ${to >= from ? "" : "rr-from-right"}`}
        style={{
          ...(to >= from ? { left: `${from}%` } : { right: `${100 - from}%` }),
          width: `${w}%`,
          background: "var(--recap-team)",
          opacity: 0.6,
        }}
      />
      <div className="absolute top-5 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-light bg-card" style={{ left: `${from}%` }} title={`Grid P${grid}`} />
      <div className="rr-sweep-layer pointer-events-none absolute inset-x-0 top-5" style={{ "--from": `${from}%`, "--to": `${to}%` }}>
        <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
          <div className="h-4 w-4 rounded-full ring-4 ring-card" style={{ background: "var(--recap-team)" }} />
        </div>
      </div>
    </div>
  );
}

// The sentence under the big number: the best climb of the season so far,
// the teams beaten whole, the team-mate. Only what the numbers support.
function finishStory(recap) {
  const { you, season, teammates } = recap;
  const bits = [];
  // The season's climbs are a list of ROUNDS, so the comparison belongs to the
  // feature race; a sprint's climb over a third of the distance is not the
  // same measurement and would quietly claim a record it did not set.
  if (recap.half !== "sprint" && you.finished && you.gained > 0 && season) {
    const earlier = season.rounds.filter((r) => r.number < recap.race.number && r.grid != null && r.position != null).map((r) => ({ ...r, gained: r.grid - r.position }));
    const better = earlier.filter((r) => r.gained >= you.gained);
    if (earlier.length && !better.length) bits.push(`Your best start-to-finish climb of the season so far.`);
    else if (better.length) {
      const last = better[better.length - 1];
      bits.push(`Your best start-to-finish climb since ${last.track}.`);
    }
  }
  const ahead = [];
  const bt = you.beatTeams || [];
  if (bt.length === 1) ahead.push(`both ${bt[0]} cars`);
  else if (bt.length === 2) ahead.push(`both ${bt[0]} and both ${bt[1]} cars`);
  else if (bt.length > 2) ahead.push(`both cars of ${bt.length} teams, ${bt[0]} and ${bt[1]} among them`);
  // teammates carry their FEATURE race, so the team-mate line is the feature
  // race's to make.
  const mate = recap.half === "sprint" ? null : teammates?.[0];
  if (you.finished && mate && teammates.length === 1 && (mate.position == null || mate.position > you.position)) ahead.push("your own team-mate");
  if (ahead.length) bits.push(`You finished ahead of ${ahead.join(" and ")}.`);
  return bits.join(" ");
}

function FinishCard({ recap, compact = false }) {
  const { you, race } = recap;
  const c = useCmp();
  const story = finishStory(recap);
  // Picked one tier: the track below is drawn on that tier's places, the big
  // number stays the race's own classification.
  const tp = tierPlaces({ c, you, results: recap.results, chart: null });
  const onTier = !!(tp && you.finished && tp.place != null && tp.grid != null && tp.field > 1);
  const headline = !you.raced
    ? "Did not start"
    : !you.finished
      ? you.status === "DNF"
        ? "Did not finish"
        : you.status === "DSQ"
          ? "Disqualified"
          : you.status
      : you.position === 1
        ? "Race winner"
        : you.position <= 3
          ? `${nth(you.position)} place, on the podium`
          : you.gained > 0
            ? `Up ${you.gained} from the grid`
            : you.gained < 0
              ? `Down ${-you.gained} from the grid`
              : "Held position from the grid";
  const field = race.starters || race.fieldSize;
  // On a sprint weekend the card has to say which of the night's two races it
  // is showing, or the big number means nothing.
  const which = recap.sprint ? (recap.half === "sprint" ? "Sprint · finishing position" : "Feature race · finishing position") : "Finishing position";
  return (
    <Card bodyClassName="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Label>{which}</Label>
        {you.finished && (
          <Label tone="text-light">
            <span key={`${c.tier}`} className="rr-cmp-in inline-block">
              {c.tier === "all" ? `of ${race.finishers} classified · ${field} starters` : onTier ? `P${tp.place} of ${tp.field} in ${c.label}` : `Not in ${c.label}`}
            </span>
          </Label>
        )}
      </div>
      <div className={`mt-2 flex flex-wrap items-end gap-x-8 gap-y-3 ${compact ? "gap-x-5" : ""}`}>
        {/* Next to the replay, which has just landed the big number, the card
            keeps it smaller and lets the words carry it. */}
        <div className="recap-pop flex items-start font-display font-black leading-none tracking-tighter text-dark">
          <span className={compact ? "mt-1.5 text-2xl text-light sm:mt-2 sm:text-3xl" : "mt-3 text-4xl text-light sm:mt-5 sm:text-5xl"}>P</span>
          <span className={compact ? "text-[4rem] sm:text-[5rem]" : "text-[6.5rem] sm:text-[8.5rem]"}>{you.finished ? you.position : you.raced ? you.status : "DNS"}</span>
        </div>
        <div className="mb-3 min-w-0 flex-1">
          <div className="font-display text-[1.3rem] font-black uppercase leading-[1.12] tracking-tight sm:text-3xl sm:leading-tight" style={{ color: you.finished && you.position <= 3 ? "var(--medal-1)" : "var(--c-text)" }}>
            {headline}
          </div>
          {you.finished && you.grid != null && (
            <div className="recap-tag mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-border px-2 py-0.5 font-mono text-xs font-bold text-light">P{you.grid}</span>
              <span className="text-light">→</span>
              <span className="rounded-md border px-2 py-0.5 font-mono text-xs font-bold text-dark" style={{ borderColor: "var(--recap-team)" }}>
                P{you.position}
              </span>
              {you.gained !== 0 && (
                <span className="ml-2 flex items-baseline gap-1.5">
                  <Delta value={you.gained} className="text-xl" />
                  <Label tone="text-light">{Math.abs(you.gained) === 1 ? "place" : "places"} {you.gained > 0 ? "gained" : "lost"}</Label>
                </span>
              )}
            </div>
          )}
          {!you.finished && you.raced && you.grid != null && <div className="mt-2 font-mono text-xs text-light">from P{you.grid} on the grid</div>}
        </div>
      </div>
      {you.finished && you.grid != null && field > 1 && (
        <div className={`mt-2 ${c.live ? "rr-cmp-roll" : ""}`}>
          {/* Keyed on the field: a switch runs the car from the grid again,
              on the new scale. */}
          {onTier ? <GridToFlag key={`t${c.tier}`} grid={tp.grid} finish={tp.place} field={tp.field} /> : <GridToFlag key="all" grid={you.grid} finish={you.position} field={field} />}
          {c.tier !== "all" && (
            <div key={`n${c.tier}`} className="rr-cmp-in -mt-1 font-mono text-[10px] leading-snug text-faint">
              {onTier
                ? `Places among the ${tp.field} ${c.label} starters: P${tp.grid} on the grid, P${tp.place} at the flag.`
                : `You're not in ${c.label}: the track shows your places in the whole field.`}
            </div>
          )}
        </div>
      )}
      {(story || (you.finished && you.rawPosition != null && you.rawPosition !== you.position)) && (
        <div className="recap-tag mt-auto border-t border-border pt-4" style={{ "--tag-delay": "1400ms" }}>
          {story && <p className="text-sm leading-relaxed text-medium">{story}</p>}
          {you.finished && you.rawPosition != null && you.rawPosition !== you.position && (
            <p className="mt-1.5 text-xs text-light">
              {/* Places won back off other drivers' penalties are not the
                  stewards ruling on you: say where it came from. */}
              {!(you.penaltySeconds > 0) && you.rawPosition > you.position
                ? `Crossed the line P${you.rawPosition}; classified P${you.position} after penalties to cars ahead.`
                : `Crossed the line P${you.rawPosition}; the stewards made it P${you.position}.`}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function RoundCard({ recap, weekend }) {
  const { you, results, race, standings } = recap;
  const c = useCmp();
  const tp = tierPlaces({ c, you, results, chart: null });
  const swap = (k, v) => (
    <span key={k} className="rr-cmp-in inline-block">
      {v}
    </span>
  );
  const twoRaces = !!weekend?.isSprintWeekend;
  const mine = results.find((r) => r.driverId === you.driverId);
  const finished = results.filter((r) => r.status === "FINISHED" && r.position != null).sort((a, b) => a.position - b.position);
  const adj = (r) => (r?.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);
  const myMs = adj(mine);
  const winMs = adj(finished[0]);
  const ahead = you.finished && you.position > 1 ? finished.find((r) => r.position === you.position - 1) : null;
  const aheadMs = adj(ahead);
  const gapTo = (ms) => (myMs && ms && myMs > ms ? fmtGap(myMs - ms) : null);
  const lapsDown = (r) => (r && finished[0]?.laps != null && r.laps != null && r.laps < finished[0].laps ? `+${finished[0].laps - r.laps} lap${finished[0].laps - r.laps > 1 ? "s" : ""}` : null);
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        {/* On a sprint weekend this is what THIS race paid; the round's total
            is on the weekend card above, written as its two halves. */}
        <Label>{twoRaces ? (recap.half === "sprint" ? "Points from the sprint" : "Points from the feature race") : "Championship points"}</Label>
        <span className="font-display text-5xl font-black leading-none tabular-nums text-accent">
          <Tween to={you.points || 0} prefix={you.points > 0 ? "+" : ""} />
          <span className="ml-1 font-mono text-xs font-bold text-light">pts</span>
        </span>
      </div>
      <div className="mt-4 divide-y divide-border border-t border-border">
        <Row label="Race time" value={myMs ? fmtDuration(myMs) : null} />
        <Row label="Gap to winner" value={you.position === 1 ? "Winner" : lapsDown(mine) || gapTo(winMs)} />
        {ahead && <Row label={`Gap to P${ahead.position}`} value={gapTo(aheadMs) || (lapsDown(mine) && !lapsDown(ahead) ? lapsDown(mine) : null)} />}
        {you.finished && race.starters > 0 && (
          <Row
            label={c.tier === "all" ? "Starters beaten" : `Starters beaten · ${c.label}`}
            value={swap(c.tier, c.tier === "all" ? `${race.starters - you.position} of ${race.starters}` : tp?.place != null ? `${tp.field - tp.place} of ${tp.field}` : `not in ${c.label}`)}
            tone={c.tier !== "all" && !tp ? "text-light" : "text-dark"}
          />
        )}
        {you.fastestLapBonus > 0 && <Row label="Fastest lap bonus" value={`+${you.fastestLapBonus}`} tone="text-fl" />}
        {twoRaces && <Row label="Round total, both races" value={`${weekend.total > 0 ? "+" : ""}${weekend.total}`} tone="text-accent" />}
        {standings?.roundDropped && <Row label="Drop rule" value="this round does not count" tone="text-light" />}
      </div>
    </Card>
  );
}

// --- the stat cards -----------------------------------------------------------

// One number, its word, an icon that says which kind of number, and where
// that number stands in the field. Every tile is the same five parts: the
// label and icon, the value, the note, a slim graphic of the field (or of the
// race, where the number has no field to stand in), and a foot with the rank
// and a small Compare link that opens the whole list.
// The graphics all read the same way: further right is further forward.
// The field is the one picked with the tier switch (cmp.jsx): `out` is the
// tier's name when the driver is not in it, and the foot says so instead of
// giving a rank. What changes when the switch is used rolls in on its own
// short beat (`live`), not on the card's entrance.
function Stat({ label, value, note, tone = "text-dark", icon: TileIcon = FlagIcon, graphic = null, rank = null, caption = null, out = null, index = 0, onOpen = null, span = "" }) {
  const { live } = useCmp();
  const gd = 420 + index * 90; // the graphic's own beat, after the value has rolled in
  const chip = rank || out;
  const footKey = rank ? `r${rank.rank}/${rank.of}` : out ? `o${out}` : caption ? `c${caption}` : "-";
  return (
    <div className={`rr-ftile card flex min-w-0 flex-col p-3 text-left sm:p-4 ${span}`} style={{ "--i": index }}>
      <div className="flex items-start justify-between gap-3">
        <Label tone="text-light" className="leading-[1.45]">{label}</Label>
        <span className="rr-tile-icon -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
          <TileIcon className={`h-3.5 w-3.5 ${tone === "text-dark" ? "text-light" : tone}`} strokeWidth={2.25} aria-hidden="true" />
        </span>
      </div>
      {/* The value settles like a timing screen: the digits roll, then lock. */}
      <div className={`mt-1.5 font-mono text-xl font-bold leading-none tracking-tight sm:mt-2 sm:text-[1.7rem] ${tone}`}>
        <Ticker key={String(value)} value={value ?? NO_VALUE} delay={live ? 40 : 260 + index * 90} className={live ? "rr-cmp-roll" : ""} />
      </div>
      {note && (
        <div className="mt-1.5 text-[11px] leading-snug text-light sm:text-xs">
          <span key={note} className="rr-cmp-in block">
            {note}
          </span>
        </div>
      )}
      {graphic && <div className="mt-auto pt-3">{graphic(gd)}</div>}
      {/* The foot is always there, empty or not, so graphics and feet sit level across a row. */}
      <div className={`flex min-h-[22px] items-center justify-between gap-2 ${graphic ? "mt-2.5" : "mt-auto pt-3"}`}>
        {chip || caption ? (
          <span
            className={
              chip
                ? "rr-g3-badge inline-flex min-w-0 shrink items-center overflow-hidden whitespace-nowrap rounded-md px-1.5 py-[3px] font-mono text-[10px] font-bold leading-none tabular-nums"
                : "rr-g3-badge min-w-0 truncate font-mono text-[10px] font-medium leading-none text-light"
            }
            style={{ "--gd": `${gd + 650}ms`, color: rank && rank.rank <= 3 ? `var(--medal-${rank.rank})` : undefined }}
          >
            <span key={footKey} className={`rr-cmp-in ${chip ? "inline-flex items-center gap-1" : "block truncate"}`}>
              {rank ? (
                <>
                  {rank.rank <= 3 && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} aria-hidden="true" />}
                  <span className={rank.rank <= 3 ? "" : "text-dark"}>{nth(rank.rank)}</span>
                  <span className="font-medium text-light">of {rank.of}</span>
                </>
              ) : out ? (
                <span className="font-medium text-light">Not in {out.replace("Tier ", "T")}</span>
              ) : (
                caption
              )}
            </span>
          </span>
        ) : (
          <span />
        )}
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Compare ${label.toLowerCase()} with everyone`}
            className="rr-g3-badge -my-1 -mr-1.5 inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1.5 font-mono text-[10px] font-bold uppercase leading-none tracking-[0.16em] text-accent transition-colors hover:bg-surface2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ "--gd": `${gd + 750}ms` }}
          >
            {/* On a phone the tile is narrow: the arrow alone, the rank keeps its room. */}
            <span className="max-sm:sr-only">Compare</span>
            <ChevronRight className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

// The two faint words under a graphic, one at each end.
function Ends({ left, right, children }) {
  return (
    <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[9px] font-medium uppercase leading-none tracking-[0.14em] text-faint">
      <span>{left}</span>
      {children}
      <span>{right}</span>
    </div>
  );
}

const pctOf = (x) => `${(Math.max(0, Math.min(1, x)) * 100).toFixed(2)}%`;

// Everything on a strip rides a full-width lane moved by transform alone
// (translateX of N% is N% of the strip), so when the field changes each mark
// glides to its new place, and a car that leaves the field fades where it is.
function Lane({ x, on = true, className = "", children }) {
  return (
    <span className={`rr-xlane ${on ? "" : "is-off"} ${className}`} style={{ "--x": pctOf(x) }} aria-hidden="true">
      {children}
    </span>
  );
}

// The driver's own mark: a dot in the team colour that slides in from the
// back of the field (or from `x0`) and settles at `x` (0..1, 1 = in front).
// The entrance is the inner layer's; the outer one glides when `x` moves.
function YouDot({ x, x0 = 0, delay, on = true }) {
  return (
    <div className={`rr-fs-run ${on ? "" : "is-off"}`} style={{ "--x": pctOf(x), "--x0": pctOf(x0), "--gd": `${delay}ms` }} aria-hidden="true">
      <div className="rr-fs-run-in">
        <span className="rr-fs-dot" />
      </div>
    </div>
  );
}

// One tick per car at its number, the driver's dot among them. `lanes` is
// every car of the whole field ({ id, x, on }): the ones outside the chosen
// tier are faded out, so switching back brings them back to their places.
function FieldStrip({ lanes, you, youOn = true, ends, delay, label }) {
  return (
    <div role="img" aria-label={label}>
      <div className="relative mx-1 h-3">
        <div className="rr-fs-base" aria-hidden="true" />
        {lanes.map((l, i) => (
          <Lane key={l.id} x={l.x} on={l.on}>
            <span className="rr-fs-tick" style={{ "--t": i, "--gd": `${delay - 200}ms` }} />
          </Lane>
        ))}
        {you != null && <YouDot x={you} on={youOn} delay={delay} />}
      </div>
      <Ends left={ends[0]} right={ends[1]} />
    </div>
  );
}

// Places on the field's own scale, from the back on the left to P1 on the
// right: a tick per place, the driver's dot at the place in question. With
// `from` the dot starts at that place and slides to `at`, the place it
// started from left as a ring. `maxField` is the whole field: its places are
// all kept on the strip, the ones outside the scale faded, so a smaller field
// (one tier) is the same ticks gliding apart.
function PlaceScale({ at, from = null, field, delay, label, window = null, maxField = field }) {
  const [lo, hi] = window || [1, field];
  const n = hi - lo + 1;
  const xOf = (p) => (n <= 1 ? 1 : (hi - p) / (hi - lo));
  const total = Math.max(maxField, hi);
  const slots = Array.from({ length: total }, (_, i) => total - i);
  const labelled = n <= 10;
  const ring = from != null && from !== at;
  return (
    <div role="img" aria-label={label}>
      <div className="relative mx-1 h-3">
        <div className="rr-fs-base" aria-hidden="true" />
        {slots.map((p) => (
          <Lane key={p} x={xOf(p)} on={p >= lo && p <= hi}>
            <span className={`rr-fs-tick ${labelled ? "rr-fs-tick-slot" : ""}`} style={{ "--t": Math.max(0, hi - p), "--gd": `${delay - 200}ms` }} />
          </Lane>
        ))}
        <Lane x={xOf(from ?? at)} on={ring}>
          <span className="rr-fs-ring" style={{ "--gd": `${delay - 100}ms` }} />
        </Lane>
        <YouDot x={xOf(at)} x0={from != null ? xOf(from) : 0} delay={delay} />
      </div>
      {labelled ? (
        <div className="relative mx-1 mt-1.5 h-[9px] font-mono text-[9px] font-medium uppercase leading-none tracking-[0.06em] text-faint" aria-hidden="true">
          {slots
            .filter((p) => p >= lo && p <= hi)
            .map((p) => (
              <Lane key={p} x={xOf(p)} className="rr-cmp-fade">
                <span className={`absolute left-0 top-0 -translate-x-1/2 ${p === at ? "font-bold text-dark" : ""}`}>P{p}</span>
              </Lane>
            ))}
        </div>
      ) : (
        <Ends left={`P${hi}`} right={`P${lo}`} />
      )}
    </div>
  );
}

// The race lap by lap, the laps the driver led filled in.
function LapStrip({ led, delay, label }) {
  const n = led.length;
  return (
    <div role="img" aria-label={label}>
      <div className="flex h-3 items-stretch gap-[2px]">
        {led.map((on, i) => (
          <span key={i} className={`rr-g3-lap flex-1 rounded-[1px] ${on ? "rr-g3-lap-on" : "bg-surface2"}`} style={{ "--t": i, "--gd": `${delay - 100}ms` }} aria-hidden="true" />
        ))}
      </div>
      <Ends left="Lap 1" right={`Lap ${n}`} />
    </div>
  );
}

// The driver's share as a bar, the field's average as a mark across it; the
// mark glides when the field changes.
function AvgBar({ pct, avg, tone, delay, label, ends }) {
  return (
    <div role="img" aria-label={label}>
      <div className="flex h-3 items-center">
        <Bar pct={Math.max(3, Math.min(100, pct))} h="h-1.5" fill={tone} delay={delay - 260} cursor={false}>
          <Lane x={avg / 100}>
            <span className="rr-g3-avg" style={{ left: 0, "--gd": `${delay + 500}ms` }} />
          </Lane>
        </Bar>
      </div>
      <Ends left={ends[0]} right={ends[1]} />
    </div>
  );
}

// An odd tile out at the end of the grid takes the rest of its row, so no
// row is left with a hole in it: on a phone (two across) and on a wide
// screen (four across) separately.
function tileSpans(n) {
  const out = Array.from({ length: n }, () => []);
  if (n % 2 === 1) {
    out[n - 1].push("col-span-2", n % 4 === 3 ? "lg:col-span-2" : "lg:col-span-4");
  } else if (n % 4 === 2) {
    out[n - 2].push("lg:col-span-2");
    out[n - 1].push("lg:col-span-2");
  }
  return out.map((c) => c.join(" "));
}

// One list for the field, the driver's own row marked: what the tile says,
// for everyone (or for one tier: the switch sits at the head of the list and
// is the page's own, so the tiles behind follow it). `columns` are
// { key, label, align, wide, render }; a wide column stays off phones.
// Its rows rise in softly one after another, again on every switch. The
// modal lives outside the page, so it is handed the team colour.
function CompareTable({ title, description, footnote, columns, rows, onClose, team }) {
  const c = useCmp();
  // A `sub` column (a gap, a net change) is its own column from sm up; on a
  // phone it sits small under the number it qualifies, so the table fits the
  // screen instead of running off its right edge.
  const subOf = (i) => (columns[i + 1]?.sub ? columns[i + 1] : null);
  const hide = (col) => (col.wide || col.sub ? "hidden sm:table-cell" : "");
  const count = rows.length === 1 ? "1 driver" : `${rows.length} drivers`;
  return (
    <Modal open onClose={onClose} title={c.tier === "all" ? title : `${title} · ${c.label}`} size="lg" description={description}>
      {c.available && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2" style={{ "--recap-team": team || "rgb(var(--c-brand))" }}>
          <div className="min-w-0 font-mono text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-light">
            <span key={`${c.tier}-${rows.length}`} className="rr-trow block">
              {c.tier === "all" ? `${count}, whole field` : c.youIn ? `${count} in ${c.label}, you among them` : `${rows.length} in ${c.label} · you're not in this tier`}
            </span>
          </div>
          <TierSwitch className="w-full sm:w-auto" />
        </div>
      )}
      <div className="rr-modal scrollbar-slim relative -mx-1 max-h-[65vh] overflow-auto" style={{ "--recap-team": team || "rgb(var(--c-brand))" }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-card">
            <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.12em] text-light sm:tracking-[0.18em]">
              {columns.map((col) => (
                <th key={col.key} className={`whitespace-nowrap px-2 py-2.5 font-bold ${col.align === "left" ? "text-left" : "text-right"} ${hide(col)}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          {/* Keyed on the field shown: a switch lets the new list rise in. */}
          <tbody key={String(c.tier)}>
            {rows.map((r, ri) => (
              <tr key={r.driverId || r.name} className={`rr-trow rr-crow border-b border-border/60 ${r.you ? "rr-crow-you font-semibold text-accent" : "text-dark"}`} style={{ "--i": Math.min(ri, 18) }}>
                {columns.map((col, ci) => {
                  const sub = subOf(ci);
                  const subValue = sub ? sub.render(r) : null;
                  const medal = col.key === "rank" && r.rank >= 1 && r.rank <= 3 ? `var(--medal-${r.rank})` : null;
                  return (
                    <td
                      key={col.key}
                      className={`px-2 py-2.5 align-middle ${col.align === "left" ? "max-w-[9.5rem] truncate sm:max-w-none" : "whitespace-nowrap text-right font-mono tabular-nums"} ${hide(col)} ${col.muted && !r.you && !medal ? "text-light" : ""}`}
                      style={medal ? { color: medal, fontWeight: 800 } : undefined}
                    >
                      {col.render(r)}
                      {col.key === "name" && r.you && <span className="rr-you-tag ml-2 align-middle font-mono text-[9px] uppercase tracking-[0.18em]">you</span>}
                      {subValue ? <div className="mt-0.5 font-mono text-[11px] font-medium leading-none text-light sm:hidden">{subValue}</div> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-2 py-6 text-center text-sm text-light">
                  Nobody in {c.label} has this number for this race.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {footnote && <p className="mt-3 text-xs text-light">{footnote}</p>}
    </Modal>
  );
}

const finishOf = (r) => (r.status && r.status !== "FINISHED" ? r.status : r.position != null ? `P${r.position}` : NO_VALUE);
const COL = {
  rank: { key: "rank", label: "#", muted: true, render: (r) => r.rank ?? NO_VALUE },
  name: { key: "name", label: "Driver", align: "left", render: (r) => r.name },
  finish: { key: "finish", label: "Finish", muted: true, render: (r) => finishOf(r) },
};

// The four lists behind the tiles. Each one ranks the classified field (or
// the cars of one tier, `keep`) by the tile's own number and marks the
// driver's row. A list is left out when the round has no such numbers, and
// then the tile is a plain tile; within a tier it is kept even when short.
function compareLists({ you, story, results, keep = null }) {
  const tiered = !!keep;
  const ok = keep || (() => true);
  const min = tiered ? 0 : 1;
  const raced = (results || []).filter((r) => r.status !== "DNS" && ok(r));
  const mark = (rows) => rows.map((r, i) => ({ ...r, rank: i + 1, you: r.driverId === you.driverId }));
  const lists = {};

  if (story?.paceTable?.rows?.length > 1) {
    const t = story.paceTable;
    // Within a tier the ranked cars are numbered again among themselves, and
    // the gap is to the quickest of them.
    let rows = t.rows.map((r) => ({ ...r, you: r.you ?? r.driverId === you.driverId }));
    if (tiered) {
      rows = rows.filter(ok);
      const ranked = rows.filter((r) => r.rank != null && r.paceMs > 0);
      const best = ranked.length ? Math.min(...ranked.map((r) => r.paceMs)) : null;
      let k = 0;
      rows = rows.map((r) => (r.rank != null ? { ...r, rank: (k += 1), gapMs: best != null && r.paceMs > 0 ? r.paceMs - best : r.gapMs } : r));
    }
    const field = tiered ? rows.filter((r) => r.rank != null).length : t.field || t.rows.length;
    if (rows.length > min)
      lists.pace = {
        title: "Race pace",
        description: `Median of each driver's clean laps. Ranked across the ${field} cars that ran at least 60% of the distance.`,
        footnote: "A clean lap is within 8% of the driver's own typical lap, so pit stops, safety car laps and spins stay out. Cars without a rank ran too little of the race.",
        rows,
        columns: [
          COL.rank,
          COL.name,
          COL.finish,
          { key: "laps", label: "Laps", muted: true, wide: true, render: (r) => r.laps },
          { key: "pace", label: "Pace", render: (r) => fmtLap(r.paceMs) },
          { key: "gap", label: "Gap", muted: true, sub: true, render: (r) => (r.gapMs == null ? NO_VALUE : r.gapMs === 0 ? "" : fmtLapDelta(r.gapMs)) },
        ],
      };
  }

  const lapRows = raced.filter((r) => r.bestLapMs > 0).sort((a, b) => a.bestLapMs - b.bestLapMs);
  if (lapRows.length > min) {
    const best = lapRows[0]?.bestLapMs;
    lists.bestLap = {
      title: "Best lap",
      description: tiered ? "Each driver's quickest lap of the race, fastest first. The gap is to the quickest of the tier." : "Everyone's quickest lap of the race, fastest first.",
      rows: mark(lapRows),
      columns: [
        COL.rank,
        COL.name,
        COL.finish,
        { key: "best", label: "Best lap", render: (r) => fmtLap(r.bestLapMs) },
        { key: "gap", label: "Gap", muted: true, sub: true, render: (r) => (r.bestLapMs === best ? "" : fmtLapDelta(r.bestLapMs - best)) },
      ],
    };
  }

  const consRows = raced.filter((r) => r.consistencyPct > 0).sort((a, b) => b.consistencyPct - a.consistencyPct);
  if (consRows.length > min) {
    lists.consistency = {
      title: "Consistency",
      description: "How close each driver's laps stayed to their own best, steadiest first.",
      footnote: "100% would be every lap on your best time. Pit laps and laps far off your pace are left out.",
      rows: mark(consRows),
      columns: [
        COL.rank,
        COL.name,
        COL.finish,
        { key: "laps", label: "Laps", muted: true, wide: true, render: (r) => r.laps ?? NO_VALUE },
        { key: "cons", label: "Consistency", render: (r) => `${r.consistencyPct.toFixed(2)}%` },
      ],
    };
  }

  const otRows = raced.filter((r) => r.overtakes != null).sort((a, b) => b.overtakes - a.overtakes || (a.position ?? 99) - (b.position ?? 99));
  if (otRows.length > min) {
    lists.overtakes = {
      title: "Overtakes",
      description: "Estimated on-track passes per driver, most first.",
      footnote: "Counted from the running order lap by lap, so a pass and a re-pass both count. Net is the places gained from the grid to the flag.",
      rows: mark(otRows),
      columns: [
        COL.rank,
        COL.name,
        { key: "grid", label: "Grid", muted: true, wide: true, render: (r) => (r.grid != null ? `P${r.grid}` : NO_VALUE) },
        COL.finish,
        { key: "ot", label: "Overtakes", render: (r) => r.overtakes },
        {
          key: "net",
          label: "Net",
          muted: true,
          sub: true,
          render: (r) => {
            if (r.grid == null || r.position == null || r.status !== "FINISHED") return NO_VALUE;
            const n = r.grid - r.position;
            return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0";
          },
        },
      ],
    };
  }

  return lists;
}

// Where a number sits on the field's spread, 0 at the back, 1 in front. The
// back end is cut at the tenth car from the back, so one car that barely got
// going does not squash the whole field into a corner; anyone past the cut
// sits at the end of the strip.
function spread(values, lowIsGood) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return () => 1;
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  const good = lowIsGood ? v[0] : v[v.length - 1];
  const bad = lowIsGood ? q(0.9) : q(0.1);
  return (x) => (good === bad ? 1 : Math.max(0, Math.min(1, (x - bad) / (good - bad))));
}

// The rank and the field strip a tile gets from its compare lists: `full` is
// the whole field's list, `list` the one for the field picked (the same list
// for the whole field). Every car of the whole field keeps a lane on the
// strip; the spread is the picked field's, the others are faded out.
function fromList(full, list, valueOf, lowIsGood, keep) {
  if (!full) return {};
  const all = full.rows.filter((r) => Number.isFinite(valueOf(r)));
  const mineAll = all.find((r) => r.you);
  if (!mineAll) return {};
  const pool = all.filter(keep);
  const at = spread((pool.length ? pool : all).map(valueOf), lowIsGood);
  const mine = list?.rows.find((r) => r.you && Number.isFinite(valueOf(r))) || null;
  return {
    rank: mine?.rank != null ? { rank: mine.rank, of: list.rows.filter((r) => r.rank != null).length } : null,
    lanes: all.filter((r) => !r.you).map((r) => ({ id: r.driverId || r.name, x: at(valueOf(r)), on: keep(r) })),
    you: at(valueOf(mineAll)),
    youOn: !!mine,
  };
}

function StatCards({ you, story, race, results, chart }) {
  const c = useCmp();
  const [openList, setOpenList] = useState(null);
  const full = compareLists({ you, story, results });
  const lists = c.tier === "all" ? full : compareLists({ you, story, results, keep: c.keep });
  const opener = (key) => (full[key] ? () => setOpenList(key) : null);
  const fastest = you.bestLapMs != null && you.lapGapMs === 0;
  const field = race.starters || race.fieldSize || 1;
  // Not in the tier picked: the tiles that rank say so instead of ranking.
  const out = c.youIn ? null : c.label;
  const strip = (f, ends, label) => (f.lanes ? (d) => <FieldStrip lanes={f.lanes} you={f.you} youOn={f.youOn} ends={ends} delay={d} label={label} /> : null);
  const rankText = (f, what) => (f.rank ? `${what} ${nth(f.rank.rank)} of ${f.rank.of}${c.tier === "all" ? "" : ` in ${c.label}`}` : `${what} across the ${c.tier === "all" ? "field" : c.label}`);

  const lapF = fromList(full.bestLap, lists.bestLap, (r) => r.bestLapMs, true, c.keep);
  const paceF = fromList(full.pace, lists.pace, (r) => r.paceMs, true, c.keep);
  const consF = fromList(full.consistency, lists.consistency, (r) => r.consistencyPct, false, c.keep);
  const otF = fromList(full.overtakes, lists.overtakes, (r) => r.overtakes, false, c.keep);
  // The field's clean laps, as a share of each car's own laps.
  const cleanShares = (results || []).filter((r) => r.status !== "DNS" && r.laps > 0 && r.cleanLaps != null && c.keep(r)).map((r) => (r.cleanLaps / r.laps) * 100);
  const cleanAvg = cleanShares.length > 1 ? cleanShares.reduce((a, b) => a + b, 0) / cleanShares.length : null;
  // The driver's places within the tier picked (null for the whole field, or
  // a tier the driver is not in): the race as places among those cars only.
  const tp = tierPlaces({ c, you, results, chart });
  // The laps led, lap by lap, where the lap list agrees with the count.
  const ledLaps = (story?.laps || []).map((l) => l.position === 1);
  const ledKnown = ledLaps.length > 1 && ledLaps.filter(Boolean).length === you.lapsLed;
  const lapsLedCell = {
    label: "Laps led",
    icon: Crown,
    value: String(you.lapsLed),
    note: "at the start/finish line",
    graphic: ledKnown
      ? (d) => <LapStrip led={ledLaps} delay={d} label={`Led ${you.lapsLed} of ${ledLaps.length} laps`} />
      : race.raceLaps > 0
        ? (d) => (
            <div>
              <div className="flex h-3 items-center">
                <Bar pct={Math.max(3, (you.lapsLed / race.raceLaps) * 100)} h="h-1.5" fill="rr-g3-lead-fill" delay={d - 260} cursor={false} />
              </div>
              <Ends left="Lap 1" right={`Lap ${race.raceLaps}`} />
            </div>
          )
        : null,
    caption: ledKnown ? `${you.lapsLed} of ${ledLaps.length} laps` : race.raceLaps > 0 ? `${you.lapsLed} of ${race.raceLaps} laps` : null,
  };
  // A short stretch of the order around the grid slot and the lap-1 place.
  const lap1Window = (g, l, n) => {
    const a = Math.min(g ?? l, l);
    const b = Math.max(g ?? l, l);
    const size = Math.max(b - a + 1, Math.min(n, Math.max(6, b - a + 3)));
    let lo = Math.max(1, a - Math.floor((size - (b - a + 1)) / 2));
    let hi = lo + size - 1;
    if (hi > n && n >= size) {
      hi = n;
      lo = hi - size + 1;
    }
    return [lo, hi];
  };
  // Best place and lap 1: the tier's places when the driver is in the tier
  // picked and the lap chart can tell them; the race's otherwise.
  const tierBest = tp?.best != null;
  const best = tierBest ? { at: tp.best, run: tp.bestRun, n: tp.field } : { at: story?.bestPosition, run: story?.bestRun, n: field };
  const tierLap1 = tp?.lap1 != null && (tp.grid != null || you.grid == null);
  const l1 = tierLap1 ? { at: tp.lap1, from: tp.grid, n: tp.field } : { at: story?.lap1Pos, from: you.grid, n: field };
  const inWord = tierBest || tierLap1 ? ` in ${c.label}` : "";

  const cells = [
    fmtLap(you.bestLapMs)
      ? {
          label: "Best lap",
          icon: Timer,
          value: fmtLap(you.bestLapMs),
          tone: fastest ? "text-fl" : "text-dark",
          note: fastest ? "fastest lap of the race" : you.lapGapMs != null ? `${fmtLapDelta(you.lapGapMs)} to the fastest lap${story?.bestLapAt ? ` · set on lap ${story.bestLapAt}` : ""}` : null,
          graphic: strip(lapF, ["Slower", "Faster"], rankText(lapF, "Best lap")),
          rank: lapF.rank,
          out,
          onOpen: opener("bestLap"),
        }
      : null,
    story?.paceMs
      ? {
          label: "Race pace",
          icon: Gauge,
          value: fmtLap(story.paceMs),
          note: story.paceRank ? `pure race pace${story.gapToBestPaceMs > 0 ? ` · ${fmtLapDelta(story.gapToBestPaceMs)} a lap to the quickest` : " · the quickest car in the race"}` : "median of your real laps",
          graphic: paceF.lanes
            ? strip(paceF, ["Slower", "Faster"], c.tier === "all" ? `P${story.paceRank} of ${story.paceField} on pace` : rankText(paceF, "Race pace"))
            : story.paceRank && story.paceField && c.tier === "all"
              ? (d) => <PlaceScale at={story.paceRank} field={story.paceField} delay={d} label={`P${story.paceRank} of ${story.paceField} on pace`} />
              : null,
          rank: c.tier === "all" ? (story.paceRank && story.paceField && lists.pace ? { rank: story.paceRank, of: story.paceField } : null) : paceF.rank,
          caption: story.paceRank && !full.pace && c.tier === "all" ? `P${story.paceRank} of ${story.paceField} on pace` : null,
          out: full.pace ? out : null,
          onOpen: opener("pace"),
        }
      : null,
    you.consistencyPct > 0
      ? {
          label: "Consistency",
          icon: Activity,
          value: `${you.consistencyPct.toFixed(2)}%`,
          tone: you.consistencyPct >= 96 ? "text-ok" : "text-dark",
          note: "how close your laps stayed to your best",
          graphic: consF.lanes
            ? strip(consF, ["Looser", "Steadier"], rankText(consF, "Consistency"))
            : (d) => (
                <div className="flex h-3 items-center">
                  <Bar pct={you.consistencyPct} h="h-1.5" fill={you.consistencyPct >= 96 ? "bg-ok" : "bg-light"} delay={d - 260} />
                </div>
              ),
          rank: consF.rank,
          out: consF.lanes ? out : null,
          onOpen: opener("consistency"),
        }
      : null,
    you.overtakes != null
      ? {
          label: "Overtakes",
          icon: ArrowLeftRight,
          value: String(you.overtakes),
          note: you.grid != null && you.finished ? `estimated · net ${you.gained >= 0 ? "+" : ""}${you.gained} from the grid` : "estimated",
          graphic: strip(otF, ["Fewer", "More"], rankText(otF, "Overtakes")),
          rank: otF.rank,
          out: otF.lanes ? out : null,
          onOpen: opener("overtakes"),
        }
      : null,
    you.cleanLaps != null && you.laps != null
      ? {
          label: "Clean laps",
          icon: ShieldCheck,
          value: `${you.cleanLaps} / ${you.laps}`,
          tone: you.cleanLaps === you.laps ? "text-ok" : "text-dark",
          note: `${you.contacts ?? 0} car contact${you.contacts === 1 ? "" : "s"}${you.penaltySeconds > 0 ? ` · +${you.penaltySeconds}s penalty` : you.cleanRace ? " · no penalty" : ""}`,
          graphic: (d) =>
            cleanAvg != null ? (
              <AvgBar
                pct={(you.cleanLaps / you.laps) * 100}
                avg={cleanAvg}
                tone={you.cleanLaps === you.laps ? "bg-ok" : "bg-light"}
                delay={d}
                ends={["0", `${you.laps} laps`]}
                label={`${Math.round((you.cleanLaps / you.laps) * 100)}% of your laps clean, ${c.tier === "all" ? "field" : c.label} average ${Math.round(cleanAvg)}%`}
              />
            ) : (
              <div className="flex h-3 items-center">
                <Bar pct={(you.cleanLaps / you.laps) * 100} h="h-1.5" fill={you.cleanLaps === you.laps ? "bg-ok" : "bg-light"} delay={d - 260} />
              </div>
            ),
          caption: cleanAvg != null ? (c.youIn ? `${c.word} avg ${Math.round(cleanAvg)}% · you ${Math.round((you.cleanLaps / you.laps) * 100)}%` : `${c.word} avg ${Math.round(cleanAvg)}%`) : null,
        }
      : you.laps != null
        ? { label: "Laps", icon: ShieldCheck, value: String(you.laps), note: `${you.contacts ?? 0} car contacts` }
        : null,
    best.at
      ? {
          label: "Best position in race",
          icon: FlagIcon,
          value: `P${best.at}`,
          tone: best.at === 1 ? "text-fl" : "text-dark",
          note: best.run ? `${best.run.from === best.run.to ? `on lap ${best.run.from}` : `held from lap ${best.run.from} to lap ${best.run.to}`}${tierBest ? ` · ${c.label} cars only` : ""}` : null,
          graphic: best.n > 1 ? (d) => <PlaceScale at={best.at} field={best.n} maxField={field} delay={d} label={`P${best.at} of ${best.n}${tierBest ? ` in ${c.label}` : ""} at best`} /> : null,
          caption: tierBest ? `P${best.at} of ${best.n} in ${c.label}` : `P${best.at} of ${best.n} at best`,
          out,
        }
      : you.lapsLed > 0
        ? lapsLedCell
        : null,
    l1.at
      ? {
          label: "After lap 1",
          icon: Rocket,
          value: `P${l1.at}`,
          tone: l1.from != null && l1.at < l1.from ? "text-ok" : l1.from != null && l1.at > l1.from ? "text-bad" : "text-dark",
          note:
            l1.from != null
              ? l1.at < l1.from
                ? `${l1.from - l1.at} up at the start${inWord && tierLap1 ? inWord : ""}, from P${l1.from}`
                : l1.at > l1.from
                  ? `${l1.at - l1.from} down at the start${inWord && tierLap1 ? inWord : ""}, from P${l1.from}`
                  : `held P${l1.from} through the first lap${tierLap1 ? inWord : ""}`
              : null,
          graphic: (d) => (
            <PlaceScale
              at={l1.at}
              from={l1.from}
              field={l1.n}
              maxField={field}
              window={lap1Window(l1.from, l1.at, l1.n)}
              delay={d}
              label={l1.from != null ? `From P${l1.from} on the grid to P${l1.at} after lap 1${tierLap1 ? inWord : ""}` : `P${l1.at} after lap 1`}
            />
          ),
          caption: l1.from != null ? `${tierLap1 ? `${c.label} grid` : "Grid"} P${l1.from} → P${l1.at}` : null,
          out,
        }
      : null,
    // Past a minute and a half it is a safety car or a red flag, not the
    // driver, and the number would only mislead.
    story?.offPaceMs != null && story.offPaceMs < 90_000
      ? { label: "Time lost off pace", icon: Hourglass, value: `${(story.offPaceMs / 1000).toFixed(1)} s`, tone: story.offPaceMs > 10_000 ? "text-warn" : "text-dark", note: "laps well off your own clean pace: pits, spins, traffic" }
      : you.lapsLed > 0 && best.at
        ? lapsLedCell
        : null,
  ].filter(Boolean);
  if (!cells.length) return null;
  const spans = tileSpans(cells.length);
  // The rows of tiles share one height (the tallest tile's); a lone tile that
  // takes a whole row on a phone keeps its own, so it carries no empty space.
  const n = cells.length;
  const rowVars = { "--rows-sm": Math.floor(n / 2), "--rows-lg": Math.ceil(n / 4) };
  const openRows = openList ? lists[openList] || { ...full[openList], rows: [] } : null;
  return (
    <div className="recap-reveal">
      <div className="rr-ftiles recap-cascade grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4" style={rowVars}>
        {cells.map((cell, i) => (
          <Stat key={cell.label} {...cell} index={i} span={spans[i]} />
        ))}
      </div>
      {openRows && <CompareTable {...openRows} team={you.team?.color} onClose={() => setOpenList(null)} />}
    </div>
  );
}

// The bar at the head of the Pace chapter: who the numbers below (and the
// finishing card above, and the classification at the end) are set against.
function CompareBar() {
  const c = useCmp();
  return (
    <div className="recap-reveal rr-cmp-bar flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5">
      <div className="min-w-0">
        <Label>Compare against</Label>
        <p className="mt-1 text-xs leading-snug text-light">
          <span key={`${c.tier}`} className="rr-cmp-in block">
            {cmpLine(c)}
          </span>
        </p>
      </div>
      <TierSwitch className="w-full sm:w-[19rem]" />
    </div>
  );
}

// --- tyres, incidents, the season and the career --------------------------------

// Each stint as a piece of the race on the live page's tyre strip, the
// compound's disc pinned where the stint began, and how the tyre behaved
// over it: the slope over its clean laps in seconds per lap. Positive is
// slower, so it reads "+0.14 s/lap" in red; a tyre that came to the driver
// reads "−0.07 s/lap" in green.
// The strip is uncovered left to right by a curtain with a feathered edge on
// an ease-in-out, the race's laps going by, and each tyre settles in as the
// edge reaches the lap it went on.
const STINT_DRAW = 1700;
// `wearKnown` false: the round has no lap times to read a tyre from, so the
// stints say only where they ran. `wide`: the card has the row to itself, and
// on a wide screen the stints sit side by side under the strip.
const STINT_COLS = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };
function StintsCard({ stints, wearKnown = true, wide = false }) {
  const total = stints.reduce((n, st) => n + st.laps, 0) || 1;
  const cols = wide ? STINT_COLS[stints.length] || "" : "";
  let acc = 0;
  const segs = stints.map((st) => {
    const seg = { ...st, start: acc, t: tyreCompound(st.tyre) };
    acc += st.laps;
    return seg;
  });
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Tyres and stints</Label>
        <span className="font-mono text-[11px] text-light">
          {stints.length === 1 ? "no stop" : `${stints.length - 1} stop${stints.length === 2 ? "" : "s"}`} · {total} laps
        </span>
      </div>
      <div className="relative mt-5 h-10 w-full">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        <div className="absolute inset-x-0 top-1/2 h-4 -translate-y-1/2 overflow-hidden">
          {segs.map((s, i) => (
            <div
              key={i}
              className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
              style={{ left: `${(s.start / total) * 100}%`, width: `${(s.laps / total) * 100}%`, backgroundColor: s.t.color, boxShadow: s.t.light ? "0 0 0 1px rgba(17,24,39,0.3)" : "none" }}
              title={`${s.t.name} · ${s.laps} laps`}
            />
          ))}
          <div className="rr-draw-curtain rr-feather absolute inset-0 bg-card" style={{ "--draw": `${STINT_DRAW}ms` }} aria-hidden="true" />
        </div>
        {segs.map((s, i) => (
          <span key={i} className="rr-stint-tyre absolute top-1/2 z-10 flex -translate-y-1/2" style={{ left: `max(0px, calc(${(s.start / total) * 100}% - 13px))`, "--d": `${Math.round(sineInOutInverse(s.start / total) * STINT_DRAW)}ms` }}>
            <span className="rr-stint-tyre-in flex">
              <TyreBadge t={s.t} size={26} />
            </span>
          </span>
        ))}
      </div>
      <div className="relative h-4 w-full font-mono text-[10px] font-bold text-faint" aria-hidden="true">
        {segs.map((s, i) => (
          <span key={i} className="absolute" style={{ left: `max(0px, calc(${(s.start / total) * 100}% - 8px))` }}>
            L{s.start + 1}
          </span>
        ))}
        <span className="absolute right-0">L{total}</span>
      </div>
      <div className={`recap-cascade mt-3 divide-y divide-border border-t border-border ${cols ? `${cols} lg:grid lg:divide-x lg:divide-y-0` : ""}`}>
        {segs.map((s, i) => {
          const perLap = s.degMsPerLap != null ? s.degMsPerLap / 1000 : null;
          const words =
            perLap == null
              ? wearKnown
                ? "too short to read the tyre"
                : null
              : perLap > 0.05
                ? `fell away by ${perLap.toFixed(2)} s a lap`
                : perLap < -0.05
                  ? `came to you by ${(-perLap).toFixed(2)} s a lap`
                  : "held its pace to the end";
          return (
            <div key={i} className={`flex items-center gap-4 py-3.5 ${cols ? "lg:px-6 lg:first:pl-0 lg:last:pr-0" : ""}`} style={{ "--i": i + 3 }}>
              <TyreBadge t={s.t} size={30} />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-bold text-dark">
                  Stint {i + 1} · {s.laps} laps on {s.t.name.toLowerCase()}
                </div>
                {words ? (
                  <div className="mt-0.5 text-xs text-light">{words}</div>
                ) : (
                  <div className="mt-0.5 font-mono text-[11px] tabular-nums text-faint">
                    laps {s.start + 1}–{s.start + s.laps}
                  </div>
                )}
              </div>
              {perLap != null && <Delta value={perLap} decimals={2} suffix=" s/lap" goodWhen="down" className="text-sm" />}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// The contacts from the driver's side: the lap, who with, how hard.
function IncidentsCard({ incidents, you }) {
  const list = incidents.contacts || [];
  const hard = (kph) => (kph >= 60 ? "text-bad" : kph >= 25 ? "text-warn" : "text-light");
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Your incidents</Label>
        <span className="font-mono text-[11px] text-light">
          {list.length} car contact{list.length === 1 ? "" : "s"}
          {incidents.envContacts > 0 ? ` · ${incidents.envContacts} with the scenery` : ""}
        </span>
      </div>
      {list.length === 0 ? (
        <p className="recap-pop mt-4 font-display text-xl font-extrabold uppercase tracking-tight text-ok">A clean race. No contact with another car.</p>
      ) : (
        <div className="recap-cascade mt-4 space-y-2">
          {list.map((c, i) => (
            <div key={i} className="flex items-stretch overflow-hidden rounded-lg border border-border bg-surface2/60" style={{ "--i": i }}>
              <span className={`flex w-14 shrink-0 flex-col items-center justify-center py-2 ${c.kph >= 60 ? "bg-bad/15" : c.kph >= 25 ? "bg-warn/15" : "bg-surface2"}`}>
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-light">Lap</span>
                <span className={`font-display text-lg font-black leading-none tabular-nums ${hard(c.kph ?? 0)}`}>{c.lap ?? "?"}</span>
              </span>
              <span className="flex min-w-0 flex-1 items-center px-3 font-display text-base font-extrabold uppercase tracking-tight text-dark">
                {c.driverId ? (
                  <Link to={`/drivers/${c.driverId}`} className="transition hover:text-brand">
                    {c.name}
                  </Link>
                ) : (
                  c.name
                )}
              </span>
              {c.kph != null && <span className={`flex items-center pr-3 font-mono text-sm font-bold tabular-nums ${hard(c.kph)}`}>{c.kph} km/h</span>}
            </div>
          ))}
        </div>
      )}
      <p className="recap-tag mt-3 text-xs text-light">
        {you.penaltySeconds > 0 ? `The stewards gave you +${you.penaltySeconds}s.` : list.length > 0 ? "No penalty from the stewards." : you.gamePenalties > 0 ? `${you.gamePenalties} in-game penalt${you.gamePenalties === 1 ? "y" : "ies"} for track limits.` : "Nothing for the stewards to look at."}
      </p>
    </Card>
  );
}

// The race set against the season and the career: the firsts, the record
// at this track, the run, where the season points at this rate.
function CareerCard({ career: c, you, race }) {
  const lines = [];
  for (const f of c.firsts) lines.push({ key: f.key, text: f.text, tone: "text-ok" });
  const t = c.track;
  if (you.bestLapMs && t.recordBeforeMs) {
    const d = you.bestLapMs - t.recordBeforeMs;
    lines.push(
      t.newRecord
        ? { key: "rec", text: `New personal best at ${race.track}: ${fmtLap(you.bestLapMs)}, ${fmtLapDelta(d)} on your record from season ${t.recordSeason}.`, tone: "text-fl" }
        : { key: "rec", text: `${fmtLapDelta(d)} off your own ${race.track} record, ${fmtLap(t.recordBeforeMs)} from season ${t.recordSeason}.` }
    );
  } else if (you.bestLapMs && t.visits === 0) {
    lines.push({ key: "rec", text: `Your first race at ${race.track}. ${fmtLap(you.bestLapMs)} is now the mark to beat.` });
  }
  if (you.finished && t.bestFinishBefore != null) {
    lines.push(
      you.position < t.bestFinishBefore
        ? { key: "here", text: `Your best result here, P${t.bestFinishBefore} before this.`, tone: "text-ok" }
        : { key: "here", text: `Best result here so far: P${t.bestFinishBefore}.` }
    );
  }
  if (c.pointsRun >= 2) lines.push({ key: "run", text: `${c.pointsRun} points finishes in a row.` });
  else if (c.finishRun >= 3) lines.push({ key: "run", text: `${c.finishRun} finishes in a row.` });
  if (c.projection) {
    lines.push({ key: "proj", text: `At this rate: about ${c.projection.total} points by the end of the season, ${c.projection.perRound} a round with ${c.projection.roundsLeft} to go.` });
  }
  if (!lines.length && !c.starts) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Label>Your season and career</Label>
        {/* The career in three numbers, ticking up to tonight's. */}
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {[
            { label: "Starts", value: c.starts },
            { label: "Wins", value: c.wins },
            { label: "Podiums", value: c.podiums },
          ].map((x, i) => (
            <div key={x.label} className="bg-card px-3 py-2 text-center sm:px-4">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-light">{x.label}</div>
              <div className="mt-0.5 font-display text-2xl font-black tabular-nums leading-none text-dark">
                <Tween to={x.value} delay={300 + i * 150} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="recap-cascade mt-3 divide-y divide-border border-t border-border">
        {lines.map((l, i) => (
          <div key={l.key} className={`flex gap-3 py-2.5 text-sm leading-relaxed ${l.tone || "text-medium"}`} style={{ "--i": i }}>
            <span className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rotate-45" style={{ background: l.tone ? "currentColor" : "var(--recap-team)" }} aria-hidden="true" />
            <span>{l.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

