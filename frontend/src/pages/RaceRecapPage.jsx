// ---------------------------------------------------------------------------
// The race recap: the round told from your seat, as one page of cards.
//
// Built to a mock-up Malte drew: a header with the track's name and your
// driver chip, then cards that each say one thing with one big number and a
// line of words under it (where you finished and what that meant, what it
// paid, your pace against the field, the tyres, your incidents, the lap chart,
// the rating, the season curve, the NABS Points, your team-mate, the night's
// honours). A sprint weekend is one round and one page: the feature race is
// the headline, and the sprint gets a chapter of its own (SprintCard) once
// the feature's story is told, with the round's points split between them.
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
import { useEffect, useRef, useState } from "react";
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
import { Timer, Gauge, Activity, ArrowLeftRight, ShieldCheck, Flag as FlagIcon, Hourglass, Rocket, Crown, ChevronRight } from "lucide-react";

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
  const [laps, setLaps] = useState(null);

  useEffect(() => {
    if (handed) return;
    let gone = false;
    const ask = seat != null ? api.adminRaceRecapPreview(raceId, seat || null) : api.myRaceRecapFor(raceId);
    ask.then((r) => !gone && setRecap(r.recap)).catch((e) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [raceId, seat, handed]);

  // Arriving is seeing: the member is on the page now, whatever they click next.
  useEffect(() => {
    if (pending) api.markRaceRecapSeen(raceId).catch(() => {});
  }, [pending, raceId]);

  useEffect(() => {
    if (!recap?.race?.hasLapChart || !recap.you?.raced) return;
    let gone = false;
    api
      .raceLaps(raceId)
      .then((d) => !gone && d?.available && setLaps(d))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [recap, raceId]);

  useRecapReveal(recap, laps);
  useSpecificTitle(recap ? `Race recap · ${recap.race.track}` : "Race recap");

  if (error) return <ErrorBox message={error} />;
  if (!recap) {
    return (
      <div className="space-y-5">
        <PageHeaderSkeleton />
        <CardsSkeleton count={3} cols="lg:grid-cols-[1.75fr,1fr]" />
        <CardsSkeleton count={4} cols="sm:grid-cols-2 lg:grid-cols-4" />
      </div>
    );
  }

  const { race, results, quali, you, sprint, story, incidents, career, season, teammates, standings, team, rating, points, card } = recap;
  const resultsLink = seriesPath(`/races?race=${race.id}`);
  const showPoints = points && (points.entries.length > 0 || points.pending);
  const leave = () => (pending ? navigate(-1) : navigate(resultsLink));
  // A sprint weekend: the feature race is the round's headline, and the
  // sprint has a chapter of its own once the feature's story is told.
  const weekend = !!sprint;

  return (
    <div className="space-y-5" style={{ "--recap-team": you?.team?.color || "var(--c-text)" }}>
      <Header recap={recap} preview={seat != null} />
      {you && (
        <div className="grid gap-5 lg:grid-cols-[1.75fr,1fr]">
          <FinishCard recap={recap} weekend={weekend} />
          <RoundCard recap={recap} weekend={weekend} />
        </div>
      )}
      {you?.raced && <StatCards you={you} story={story} race={race} results={results} />}
      {you?.raced && (story?.stints?.length > 0 || incidents) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {story?.stints?.length > 0 && <StintsCard stints={story.stints} />}
          {incidents && <IncidentsCard incidents={incidents} you={you} />}
        </div>
      )}
      {laps && you?.raced && (
        <Card>
          <RaceTrace laps={laps} driverId={you.driverId} lapsDriven={you.laps} />
        </Card>
      )}
      {sprint && <SprintCard sprint={sprint} feature={you} />}
      {rating?.after && <RatingCard rating={rating} card={card} />}
      {season && standings?.after && (
        <div className="grid gap-5 lg:grid-cols-[1.75fr,1fr]">
          <SeasonCurve season={season} you={you} />
          <ChampionshipCard standings={standings} team={team} season={season} />
        </div>
      )}
      {career && you && <CareerCard career={career} you={you} race={race} />}
      {showPoints && <PointsCard points={points} />}
      {teammates?.length > 0 && you && <TeammateCard you={you} mates={teammates} standings={standings} card={card} sprint={sprint?.you || null} />}
      <HonoursRow race={race} results={results} quali={quali} weekend={weekend} />
      <div className="recap-reveal flex flex-wrap items-center justify-between gap-3 pt-2">
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
    </div>
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
      due.forEach(({ el }, i) => {
        el.style.setProperty("--reveal-delay", `${Math.min(i, 6) * 110}ms`);
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

// Whether the card this element sits in has been let in yet. Numbers wait
// for that rather than for being on screen, or they would count up behind
// a card that is still invisible.
function useRevealed() {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const host = ref.current?.closest(".recap-reveal");
    if (!host) {
      setOn(true);
      return;
    }
    if (host.classList.contains("is-visible")) {
      setOn(true);
      return;
    }
    const mo = new MutationObserver(() => {
      if (host.classList.contains("is-visible")) {
        setOn(true);
        mo.disconnect();
      }
    });
    mo.observe(host, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return [ref, on];
}

// A number that ticks from what it was to what it is, once its card is in.
function Tween({ from = 0, to, decimals = 0, duration = 1400, delay = 350, prefix = "", suffix = "", className = "" }) {
  const [ref, on] = useRevealed();
  const start = from == null || !Number.isFinite(from) ? to : from;
  const [n, setN] = useState(start);
  useEffect(() => {
    if (!on || !Number.isFinite(to)) return;
    if (motionOff() || start === to) {
      setN(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (t) => {
      const p = Math.min(1, Math.max(0, (t - t0) / duration));
      const e = 1 - Math.pow(1 - p, 3);
      setN(start + (to - start) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, start, to, duration, delay]);
  const shown = decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString("en-US");
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}
      {shown}
      {suffix}
    </span>
  );
}

// --- the pieces every card shares --------------------------------------------

function Card({ children, className = "" }) {
  return <div className={`recap-reveal card p-5 sm:p-6 ${className}`}>{children}</div>;
}

function Label({ children, className = "", tone = "text-eyebrow" }) {
  return <div className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] ${tone} ${className}`}>{children}</div>;
}

// "+3" in green, "−1" in red. `goodWhen` says which way is the good one:
// "up" for places gained and points, "down" for lap time lost per lap.
function Delta({ value, decimals = 0, suffix = "", className = "", arrow = false, goodWhen = "up" }) {
  if (value == null || !Number.isFinite(value)) return null;
  const zero = Math.abs(value) < (decimals ? 0.005 : 0.5);
  const up = value > 0;
  const good = goodWhen === "up" ? up : !up;
  const text = zero ? `±0${suffix}` : `${up ? "+" : "−"}${Math.abs(value).toFixed(decimals)}${suffix}`;
  return (
    <span className={`font-mono font-bold tabular-nums ${zero ? "text-light" : good ? "text-ok" : "text-bad"} ${className}`}>
      {arrow && !zero && (up ? "▲ " : "▼ ")}
      {text}
    </span>
  );
}

// A label on the left, a mono value on the right.
function Row({ label, value, tone = "text-dark" }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <Label tone="text-light">{label}</Label>
      <span className={`font-mono text-sm font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

const teamOf = (row) => row?.effectiveTeam || row?.team || null;
const nth = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

// --- the header ---------------------------------------------------------------

function Header({ recap, preview }) {
  const { race, you, results, card } = recap;
  const flag = flagFor(race.track, race.country);
  const photo = card?.driver?.photoUrl || results.find((r) => r.driverId === you?.driverId)?.photoUrl || null;
  const tier = card?.driver?.tier ?? results.find((r) => r.driverId === you?.driverId)?.driverTier ?? null;
  const time = race.date ? fmtRaceTime(race.date) : "";
  // A sprint weekend names both races and their distances; a plain round
  // its one race's.
  const weekend = !!recap.sprint;
  const distance = weekend
    ? [recap.sprint.race.laps ? `${recap.sprint.race.laps} lap sprint` : "sprint", race.raceLaps ? `${race.raceLaps} lap feature race` : "feature race"].join(" + ")
    : race.raceLaps
      ? `${race.raceLaps} laps`
      : null;
  return (
    <div className="recap-reveal flex flex-wrap items-end justify-between gap-6 border-b border-border pb-6">
      <div className="min-w-0">
        <Label>
          {[you ? (weekend ? "Your race weekend summary" : "Your race summary") : weekend ? "Race weekend summary" : "Race summary", race.seasonNumber != null ? `Season ${race.seasonNumber}` : null, race.number != null ? `Round ${race.number}` : null, preview ? "preview" : null]
            .filter(Boolean)
            .join(" · ")}
        </Label>
        <h1 className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 font-display text-[clamp(2.25rem,9vw,3.75rem)] font-black uppercase leading-none tracking-tight text-dark">
          {flag && <Flag code={flag.country} w={40} h={30} className="rounded-sm" />}
          <span className="min-w-0">{race.track}</span>
        </h1>
        <div className="mt-3 text-sm text-medium">
          {[race.date ? fmtRaceDateFull(race.date) : null, time || null, distance, race.starters ? `${race.starters} starters` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      {you && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
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

// --- finishing position -------------------------------------------------------

// The whole grid as a track, back of the field on the left and P1 on the
// right, and the car sliding from where it started to where it finished,
// leaving its team colour behind it.
function GridToFlag({ grid, finish, field }) {
  const at = (p) => ((field - p) / Math.max(1, field - 1)) * 100;
  const from = at(grid);
  const to = at(finish);
  const lo = Math.min(from, to);
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
      <div className="recap-sweep-trail absolute top-[19px] h-[3px]" style={{ left: `${lo}%`, "--w": `${w}%`, background: "var(--recap-team)", opacity: 0.6 }} />
      <div className="absolute top-5 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-light bg-card" style={{ left: `${from}%` }} title={`Grid P${grid}`} />
      <div className="recap-sweep-dot absolute top-5 -translate-x-1/2 -translate-y-1/2" style={{ "--from": `${from}%`, "--to": `${to}%`, left: `${to}%` }}>
        <div className="h-4 w-4 rounded-full ring-4 ring-card" style={{ background: "var(--recap-team)" }} />
      </div>
    </div>
  );
}

// The sentence under the big number: the best climb of the season so far,
// the teams beaten whole, the team-mate. Only what the numbers support.
function finishStory(recap) {
  const { you, season, teammates } = recap;
  const bits = [];
  if (you.finished && you.gained > 0 && season) {
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
  const mate = teammates?.[0];
  if (you.finished && mate && teammates.length === 1 && (mate.position == null || mate.position > you.position)) ahead.push("your own team-mate");
  if (ahead.length) bits.push(`You finished ahead of ${ahead.join(" and ")}.`);
  return bits.join(" ");
}

// The words over the finishing position, from the driver's line of a race.
function finishHeadline(you, winnerWord = "Race winner") {
  if (!you.raced) return "Did not start";
  if (!you.finished) return you.status === "DNF" ? "Did not finish" : you.status === "DSQ" ? "Disqualified" : you.status;
  if (you.position === 1) return winnerWord;
  if (you.position <= 3) return `${nth(you.position)} place, on the podium`;
  if (you.gained > 0) return `Up ${you.gained} from the grid`;
  if (you.gained < 0) return `Down ${-you.gained} from the grid`;
  return "Held position from the grid";
}

function FinishCard({ recap, weekend = false }) {
  const { you, race } = recap;
  const story = finishStory(recap);
  const headline = finishHeadline(you, weekend ? "Feature race winner" : "Race winner");
  const field = race.starters || race.fieldSize;
  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Label>{weekend ? "Finishing position · feature race" : "Finishing position"}</Label>
        {you.finished && <Label tone="text-light">of {race.finishers} classified · {field} starters</Label>}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="recap-pop flex items-start font-display font-black leading-none tracking-tighter text-dark">
          <span className="mt-3 text-4xl text-light sm:mt-5 sm:text-5xl">P</span>
          <span className="text-[6.5rem] sm:text-[8.5rem]">{you.finished ? you.position : you.raced ? you.status : "DNS"}</span>
        </div>
        <div className="mb-3 min-w-0 flex-1">
          <div className="font-display text-2xl font-black uppercase tracking-tight sm:text-3xl" style={{ color: you.finished && you.position <= 3 ? "var(--medal-1)" : "var(--c-text)" }}>
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
        <div className="mt-2">
          <GridToFlag grid={you.grid} finish={you.position} field={field} />
        </div>
      )}
      {(story || (you.finished && you.rawPosition != null && you.rawPosition !== you.position)) && (
        <div className="recap-tag mt-auto border-t border-border pt-4" style={{ "--tag-delay": "1400ms" }}>
          {story && <p className="text-sm leading-relaxed text-medium">{story}</p>}
          {you.finished && you.rawPosition != null && you.rawPosition !== you.position && (
            <p className="mt-1 text-xs text-light">Crossed the line P{you.rawPosition}; the stewards made it P{you.position}.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function RoundCard({ recap, weekend = false }) {
  const { you, results, race, standings, sprint } = recap;
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
        <Label>Championship points</Label>
        <span className="font-display text-5xl font-black leading-none tabular-nums text-accent">
          <Tween to={you.points || 0} prefix={you.points > 0 ? "+" : ""} />
          <span className="ml-1 font-mono text-xs font-bold text-light">pts</span>
        </span>
      </div>
      <div className="mt-4 divide-y divide-border border-t border-border">
        {/* On a sprint weekend the big number is the whole round's pay, and
            these two rows say how the two races split it. */}
        {weekend && <Row label="Feature race" value={`${you.racePoints > 0 ? "+" : ""}${you.racePoints ?? 0} pts`} />}
        {weekend && <Row label="Sprint race" value={sprint?.you ? `${sprint.you.points > 0 ? "+" : ""}${sprint.you.points} pts` : "not started"} tone={sprint?.you ? "text-dark" : "text-light"} />}
        <Row label={weekend ? "Feature race time" : "Race time"} value={myMs ? fmtDuration(myMs) : null} />
        <Row label="Gap to winner" value={you.position === 1 ? "Winner" : lapsDown(mine) || gapTo(winMs)} />
        {ahead && <Row label={`Gap to P${ahead.position}`} value={gapTo(aheadMs) || (lapsDown(mine) && !lapsDown(ahead) ? lapsDown(mine) : null)} />}
        {you.finished && race.starters > 0 && <Row label="Starters beaten" value={`${race.starters - you.position} of ${race.starters}`} />}
        {you.fastestLapBonus > 0 && <Row label={weekend ? "Fastest lap bonus · feature" : "Fastest lap bonus"} value={`+${you.fastestLapBonus}`} tone="text-fl" />}
        {standings?.roundDropped && <Row label="Drop rule" value="this round does not count" tone="text-light" />}
      </div>
    </Card>
  );
}

// --- the sprint ---------------------------------------------------------------

// The sprint of a sprint+feature weekend, one card: where you finished it
// and what it paid on the left, its numbers on the right, the sprint's own
// honours along the bottom. A spectator, or a driver who sat the sprint
// out, gets the podium and the honours. The lap chart, the pace and the
// incidents stay with the feature race: the archived file is that race's.
function SprintCard({ sprint, feature }) {
  const { race, results, you } = sprint;
  const finished = results.filter((r) => r.status === "FINISHED" && r.position != null).sort((a, b) => a.position - b.position);
  const adj = (r) => (r?.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);
  const mine = you ? results.find((r) => r.driverId === you.driverId) : null;
  const myMs = adj(mine);
  const winMs = adj(finished[0]);
  const gapToWinner = you?.finished && you.position > 1 && myMs && winMs && myMs > winMs ? fmtGap(myMs - winMs) : null;
  const lapsDown = mine && finished[0]?.laps != null && mine.laps != null && mine.laps < finished[0].laps ? finished[0].laps - mine.laps : 0;
  const field = race.starters || race.fieldSize;
  const fastest = you?.bestLapMs != null && you.lapGapMs === 0;
  // The sprint's honours, by the same rules as the race page's facts.
  const { facts } = buildRaceFacts(race, results, null);
  const by = (key) => facts.find((f) => f.key === key) || null;
  const winner = finished[0] || null;
  const honours = [
    winner ? { key: "winner", label: "Sprint winner", name: winner.name, driverId: winner.driverId, country: countryFor(winner.driverId, winner.country), value: teamOf(winner)?.name || null } : null,
    by("fl") ? { ...by("fl"), tone: "text-fl" } : null,
    by("climb") ? { ...by("climb"), tone: "text-ok" } : null,
    by("margin") ? { ...by("margin") } : null,
  ]
    .filter(Boolean)
    .slice(0, 3);
  // Against the feature race, when both were driven to the flag.
  const swing = you?.finished && feature?.finished ? you.position - feature.position : null;
  const words = [];
  if (you?.finished) {
    const bt = you.beatTeams || [];
    if (bt.length === 1) words.push(`You finished the sprint ahead of both ${bt[0]} cars.`);
    else if (bt.length > 1) words.push(`You finished the sprint ahead of both cars of ${bt.length} teams.`);
    if (swing != null && swing !== 0) words.push(swing > 0 ? `${swing} place${swing === 1 ? "" : "s"} better in the feature race.` : `${-swing} place${swing === -1 ? "" : "s"} better than in the feature race.`);
    else if (swing === 0) words.push("The same finish in both races.");
  }
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Label>Sprint race</Label>
        <Label tone="text-light">{[race.laps ? `${race.laps} laps` : null, field ? `${field} starters` : null, race.finishers != null ? `${race.finishers} classified` : null].filter(Boolean).join(" · ")}</Label>
      </div>
      {you ? (
        <div className="mt-2 grid gap-6 lg:grid-cols-[1.6fr,1fr] lg:gap-12">
          <div className="flex flex-col">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="recap-pop flex items-start font-display font-black leading-none tracking-tighter text-dark">
                <span className="mt-2 text-3xl text-light sm:mt-3 sm:text-4xl">P</span>
                <span className="text-[5rem] sm:text-[6.5rem]">{you.finished ? you.position : you.raced ? you.status : "DNS"}</span>
              </div>
              <div className="mb-2 min-w-0 flex-1">
                <div className="font-display text-xl font-black uppercase tracking-tight sm:text-2xl" style={{ color: you.finished && you.position <= 3 ? "var(--medal-1)" : "var(--c-text)" }}>
                  {finishHeadline(you, "Sprint winner")}
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
                        <Delta value={you.gained} className="text-lg" />
                        <Label tone="text-light">{Math.abs(you.gained) === 1 ? "place" : "places"} {you.gained > 0 ? "gained" : "lost"}</Label>
                      </span>
                    )}
                  </div>
                )}
                {!you.finished && you.raced && you.grid != null && <div className="mt-2 font-mono text-xs text-light">from P{you.grid} on the grid</div>}
              </div>
            </div>
            {you.finished && you.grid != null && field > 1 && (
              <div className="mt-1">
                <GridToFlag grid={you.grid} finish={you.position} field={field} />
              </div>
            )}
            {(words.length > 0 || (you.finished && you.rawPosition != null && you.rawPosition !== you.position)) && (
              <div className="recap-tag mt-auto pt-3" style={{ "--tag-delay": "1400ms" }}>
                {words.length > 0 && <p className="text-sm leading-relaxed text-medium">{words.join(" ")}</p>}
                {you.finished && you.rawPosition != null && you.rawPosition !== you.position && (
                  <p className="mt-1 text-xs text-light">Crossed the line P{you.rawPosition}; the stewards made it P{you.position}.</p>
                )}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-start justify-between gap-4">
              <Label tone="text-light">Sprint points</Label>
              <span className="font-display text-4xl font-black leading-none tabular-nums text-accent">
                <Tween to={you.points || 0} prefix={you.points > 0 ? "+" : ""} />
                <span className="ml-1 font-mono text-xs font-bold text-light">pts</span>
              </span>
            </div>
            <div className="mt-3 divide-y divide-border border-t border-border">
              <Row label="Race time" value={myMs ? fmtDuration(myMs) : null} />
              {you.finished && <Row label="Gap to winner" value={you.position === 1 ? "Winner" : lapsDown > 0 ? `+${lapsDown} lap${lapsDown > 1 ? "s" : ""}` : gapToWinner} />}
              <Row
                label="Best lap"
                value={fmtLap(you.bestLapMs) ? `${fmtLap(you.bestLapMs)}${!fastest && you.lapGapMs != null ? ` (${fmtLapDelta(you.lapGapMs)})` : ""}` : null}
                tone={fastest ? "text-fl" : "text-dark"}
              />
              {you.fastestLapBonus > 0 && <Row label="Fastest lap bonus" value={`+${you.fastestLapBonus}`} tone="text-fl" />}
              {you.overtakes != null && <Row label="Overtakes" value={String(you.overtakes)} />}
              {you.consistencyPct > 0 && <Row label="Consistency" value={`${you.consistencyPct.toFixed(2)}%`} />}
              {you.raced && (you.penaltySeconds > 0 || you.contacts != null) && (
                <Row
                  label="Stewards"
                  value={you.penaltySeconds > 0 ? `+${you.penaltySeconds}s penalty` : `${you.contacts ?? 0} car contact${you.contacts === 1 ? "" : "s"} · no penalty`}
                  tone={you.penaltySeconds > 0 ? "text-bad" : "text-dark"}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        finished.length > 0 && (
          <div className="recap-cascade mt-4 flex flex-wrap gap-x-8 gap-y-3">
            {finished.slice(0, 3).map((r, i) => (
              <div key={r.driverId} className="flex items-center gap-3" style={{ "--i": i }}>
                <span className="font-display text-3xl font-black leading-none tracking-tighter text-light">P{r.position}</span>
                <div className="min-w-0">
                  <Link to={`/drivers/${r.driverId}`} className="block truncate font-display text-base font-black uppercase tracking-tight text-dark transition hover:text-brand">
                    {r.name}
                  </Link>
                  {teamOf(r) && <div className="font-mono text-[11px] text-light">{teamOf(r).name}</div>}
                </div>
              </div>
            ))}
          </div>
        )
      )}
      {honours.length > 0 && (
        <div className="recap-cascade mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
          {honours.map((c, i) => (
            <div key={c.key} className="min-w-0" style={{ "--i": i + 4 }}>
              <Label tone={c.tone || "text-light"}>{c.label}</Label>
              <div className="mt-1 flex items-center gap-2">
                {c.driverId ? (
                  <Link to={`/drivers/${c.driverId}`} className="truncate font-display text-base font-black uppercase tracking-tight text-dark transition hover:text-brand">
                    {c.name}
                  </Link>
                ) : (
                  <span className="truncate font-display text-base font-black uppercase tracking-tight text-dark">{c.name}</span>
                )}
                {c.country && <Flag code={c.country} w={16} h={12} />}
              </div>
              {c.value && <div className={`mt-0.5 truncate font-mono text-xs ${c.tone || "text-light"}`}>{c.value}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- the stat cards -----------------------------------------------------------

// One number, its word, an icon that says which kind of number, and where it
// has a place in the field, a thin bar for that.
// With `onOpen` the tile is a button and says so in its last line.
function Stat({ label, value, note, tone = "text-dark", icon: TileIcon = FlagIcon, bar = null, index = 0, onOpen = null, openLabel = "Compare with everyone" }) {
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      type={onOpen ? "button" : undefined}
      onClick={onOpen || undefined}
      className={`card flex flex-col p-5 text-left ${onOpen ? "cursor-pointer transition hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" : ""}`}
      style={{ "--i": index }}
    >
      <div className="flex items-start justify-between gap-3">
        <Label tone="text-light">{label}</Label>
        <TileIcon className={`-mt-0.5 h-4 w-4 shrink-0 ${tone === "text-dark" ? "text-faint" : tone}`} strokeWidth={2} aria-hidden="true" />
      </div>
      <div className={`mt-3 font-mono text-2xl font-bold tabular-nums leading-none sm:text-[1.7rem] ${tone}`}>{value ?? NO_VALUE}</div>
      {note && <div className="mt-2 text-xs text-light">{note}</div>}
      {bar && (
        <div className="mt-auto pt-3">
          <div className="h-1 w-full rounded-full bg-surface2">
            <div className={`bar-fill h-1 rounded-full ${bar.tone || "bg-light"}`} style={{ "--w": `${Math.max(3, Math.min(100, bar.pct))}%`, "--bar-delay": `${200 + index * 90}ms` }} />
          </div>
          {bar.text && <div className="mt-1 font-mono text-[10px] text-faint">{bar.text}</div>}
        </div>
      )}
      {onOpen && (
        <div className={`flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-accent ${bar ? "mt-2" : "mt-auto pt-3"}`}>
          {openLabel}
          <ChevronRight className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
        </div>
      )}
    </Tag>
  );
}

// One list for the whole field, the driver's own row marked: what the tile
// says, for everyone. `columns` are { key, label, align, wide, render }; a
// wide column stays off phones.
function CompareTable({ title, description, footnote, columns, rows, onClose }) {
  return (
    <Modal open onClose={onClose} title={title} size="lg" description={description}>
      <div className="scrollbar-slim -mx-1 max-h-[65vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.2em] text-light">
              {columns.map((c) => (
                <th key={c.key} className={`px-2 py-2 ${c.align === "left" ? "text-left" : "text-right"} ${c.wide ? "hidden sm:table-cell" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.driverId || r.name} className={`border-b border-border/60 ${r.you ? "bg-surface2 font-semibold text-accent" : "text-dark"}`}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-2 py-2 ${c.align === "left" ? "truncate" : "text-right font-mono tabular-nums"} ${c.wide ? "hidden sm:table-cell" : ""} ${c.muted && !r.you ? "text-light" : ""}`}
                  >
                    {c.render(r)}
                    {c.key === "name" && r.you && <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em]">you</span>}
                  </td>
                ))}
              </tr>
            ))}
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

// The four lists behind the tiles. Each one ranks the classified field by
// the tile's own number and marks the driver's row; `null` when the round
// has no such numbers, and then the tile is a plain tile.
function compareLists({ you, story, results }) {
  const raced = (results || []).filter((r) => r.status !== "DNS");
  const mark = (rows) => rows.map((r, i) => ({ ...r, rank: i + 1, you: r.driverId === you.driverId }));
  const lists = {};

  if (story?.paceTable?.rows?.length > 1) {
    const t = story.paceTable;
    lists.pace = {
      title: "Race pace",
      description: `Median of each driver's clean laps. Ranked across the ${t.field || t.rows.length} cars that ran at least 60% of the distance.`,
      footnote: "A clean lap is within 8% of the driver's own typical lap, so pit stops, safety car laps and spins stay out. Cars without a rank ran too little of the race.",
      rows: t.rows,
      columns: [
        COL.rank,
        COL.name,
        COL.finish,
        { key: "laps", label: "Laps", muted: true, wide: true, render: (r) => r.laps },
        { key: "pace", label: "Pace", render: (r) => fmtLap(r.paceMs) },
        { key: "gap", label: "Gap", muted: true, render: (r) => (r.gapMs == null ? NO_VALUE : r.gapMs === 0 ? "" : fmtLapDelta(r.gapMs)) },
      ],
    };
  }

  const lapRows = raced.filter((r) => r.bestLapMs > 0).sort((a, b) => a.bestLapMs - b.bestLapMs);
  if (lapRows.length > 1) {
    const best = lapRows[0].bestLapMs;
    lists.bestLap = {
      title: "Best lap",
      description: "Everyone's quickest lap of the race, fastest first.",
      rows: mark(lapRows),
      columns: [
        COL.rank,
        COL.name,
        COL.finish,
        { key: "best", label: "Best lap", render: (r) => fmtLap(r.bestLapMs) },
        { key: "gap", label: "Gap", muted: true, render: (r) => (r.bestLapMs === best ? "" : fmtLapDelta(r.bestLapMs - best)) },
      ],
    };
  }

  const consRows = raced.filter((r) => r.consistencyPct > 0).sort((a, b) => b.consistencyPct - a.consistencyPct);
  if (consRows.length > 1) {
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
  if (otRows.length > 1) {
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

function StatCards({ you, story, race, results }) {
  const [openList, setOpenList] = useState(null);
  const lists = compareLists({ you, story, results });
  const opener = (key) => (lists[key] ? () => setOpenList(key) : null);
  const fastest = you.bestLapMs != null && you.lapGapMs === 0;
  const field = race.starters || race.fieldSize || 1;
  const rankBar = (rank, of, text) => (rank && of ? { pct: ((of - rank + 1) / of) * 100, text: text || `P${rank} of ${of}` } : null);
  const cells = [
    fmtLap(you.bestLapMs)
      ? {
          label: "Best lap",
          icon: Timer,
          value: fmtLap(you.bestLapMs),
          tone: fastest ? "text-fl" : "text-dark",
          note: fastest ? "fastest lap of the race" : you.lapGapMs != null ? `${fmtLapDelta(you.lapGapMs)} to the fastest lap${story?.bestLapAt ? ` · set on lap ${story.bestLapAt}` : ""}` : null,
          onOpen: opener("bestLap"),
        }
      : null,
    story?.paceMs
      ? {
          label: "Race pace",
          icon: Gauge,
          value: fmtLap(story.paceMs),
          note: story.paceRank ? `pure race pace${story.gapToBestPaceMs > 0 ? ` · ${fmtLapDelta(story.gapToBestPaceMs)} a lap to the quickest` : " · the quickest car in the race"}` : "median of your real laps",
          bar: rankBar(story.paceRank, story.paceField, story.paceRank ? `P${story.paceRank} of ${story.paceField} on pace` : null),
          onOpen: opener("pace"),
        }
      : null,
    you.consistencyPct > 0
      ? { label: "Consistency", icon: Activity, value: `${you.consistencyPct.toFixed(2)}%`, tone: you.consistencyPct >= 96 ? "text-ok" : "text-dark", note: "how close your laps stayed to your best", bar: { pct: you.consistencyPct, tone: you.consistencyPct >= 96 ? "bg-ok" : "bg-light" }, onOpen: opener("consistency") }
      : null,
    you.overtakes != null
      ? { label: "Overtakes", icon: ArrowLeftRight, value: String(you.overtakes), note: you.grid != null && you.finished ? `estimated · net ${you.gained >= 0 ? "+" : ""}${you.gained} from the grid` : "estimated", onOpen: opener("overtakes") }
      : null,
    you.cleanLaps != null && you.laps != null
      ? {
          label: "Clean laps",
          icon: ShieldCheck,
          value: `${you.cleanLaps} / ${you.laps}`,
          tone: you.cleanLaps === you.laps ? "text-ok" : "text-dark",
          note: `${you.contacts ?? 0} car contact${you.contacts === 1 ? "" : "s"}${you.penaltySeconds > 0 ? ` · +${you.penaltySeconds}s penalty` : you.cleanRace ? " · no penalty" : ""}`,
          bar: { pct: (you.cleanLaps / you.laps) * 100, tone: you.cleanLaps === you.laps ? "bg-ok" : "bg-light" },
        }
      : you.laps != null
        ? { label: "Laps", icon: ShieldCheck, value: String(you.laps), note: `${you.contacts ?? 0} car contacts` }
        : null,
    story?.bestPosition
      ? {
          label: "Best position in race",
          icon: FlagIcon,
          value: `P${story.bestPosition}`,
          tone: story.bestPosition === 1 ? "text-fl" : "text-dark",
          note: story.bestRun ? (story.bestRun.from === story.bestRun.to ? `on lap ${story.bestRun.from}` : `held from lap ${story.bestRun.from} to lap ${story.bestRun.to}`) : null,
          bar: rankBar(story.bestPosition, field, `P${story.bestPosition} of ${field} at best`),
        }
      : you.lapsLed > 0
        ? { label: "Laps led", icon: Crown, value: String(you.lapsLed), note: "at the start/finish line" }
        : null,
    story?.lap1Pos
      ? {
          label: "After lap 1",
          icon: Rocket,
          value: `P${story.lap1Pos}`,
          tone: you.grid != null && story.lap1Pos < you.grid ? "text-ok" : you.grid != null && story.lap1Pos > you.grid ? "text-bad" : "text-dark",
          note: you.grid != null ? (story.lap1Pos < you.grid ? `${you.grid - story.lap1Pos} up at the start, from P${you.grid}` : story.lap1Pos > you.grid ? `${story.lap1Pos - you.grid} down at the start, from P${you.grid}` : `held P${you.grid} through the first lap`) : null,
        }
      : null,
    // Past a minute and a half it is a safety car or a red flag, not the
    // driver, and the number would only mislead.
    story?.offPaceMs != null && story.offPaceMs < 90_000
      ? { label: "Time lost off pace", icon: Hourglass, value: `${(story.offPaceMs / 1000).toFixed(1)} s`, tone: story.offPaceMs > 10_000 ? "text-warn" : "text-dark", note: "laps well off your own clean pace: pits, spins, traffic" }
      : you.lapsLed > 0 && story?.bestPosition
        ? { label: "Laps led", icon: Crown, value: String(you.lapsLed), note: "at the start/finish line" }
        : null,
  ].filter(Boolean);
  if (!cells.length) return null;
  return (
    <div className="recap-reveal">
      <div className="recap-cascade grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {cells.map((c, i) => (
          <Stat key={c.label} {...c} index={i} />
        ))}
      </div>
      {openList && lists[openList] && <CompareTable {...lists[openList]} onClose={() => setOpenList(null)} />}
    </div>
  );
}

// The driver's position lap by lap, drawn over the rest of the field on a
// timing-screen grid. The line draws itself when its card is let in.
function RaceTrace({ laps, driverId, lapsDriven = null }) {
  const W = 1000;
  const H = 280;
  const PAD = { l: 44, r: 64, t: 18, b: 30 };
  const drivers = (laps.drivers || []).filter((d) => (d.points || []).length > 1);
  const me = drivers.find((d) => d.driverId === driverId);
  if (!me) return null;
  if (lapsDriven != null && Math.abs(me.points.length - lapsDriven) > 2) return null;
  const maxLap = Math.max(1, laps.maxLap || 0, ...drivers.flatMap((d) => d.points.map((p) => p.lap)));
  const maxPos = Math.max(1, ...drivers.flatMap((d) => d.points.map((p) => p.position)));
  const x = (lap) => PAD.l + ((lap - 1) / Math.max(1, maxLap - 1)) * (W - PAD.l - PAD.r);
  const y = (pos) => PAD.t + ((pos - 1) / Math.max(1, maxPos - 1)) * (H - PAD.t - PAD.b);
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.lap).toFixed(1)} ${y(p.position).toFixed(1)}`).join(" ");
  const first = me.points[0];
  const last = me.points[me.points.length - 1];
  const posStep = maxPos > 24 ? 10 : maxPos > 10 ? 5 : 1;
  const posLines = [1, ...Array.from({ length: Math.floor(maxPos / posStep) }, (_, i) => (i + 1) * posStep)].filter((v, i, a) => a.indexOf(v) === i && v <= maxPos);
  const lapStep = maxLap > 40 ? 10 : maxLap > 15 ? 5 : 1;
  const lapTicks = Array.from({ length: Math.floor(maxLap / lapStep) }, (_, i) => (i + 1) * lapStep).filter((l) => l > maxLap * 0.06 && l < maxLap * 0.93);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Lap by lap · your position at the line</Label>
        <div className="flex items-center gap-4 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">
          <span className="flex items-center gap-2">
            <span className="h-0.5 w-6" style={{ background: "var(--recap-team)" }} />
            You
          </span>
          <span className="flex items-center gap-2">
            <span className="h-px w-6 bg-light opacity-60" />
            The field
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-auto w-full" role="img" aria-label="Your position lap by lap">
        {posLines.map((p) => (
          <g key={p}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} className="stroke-border" strokeWidth="1" />
            <text x={PAD.l - 12} y={y(p) + 4} textAnchor="end" className="fill-light font-mono text-[11px] font-bold">
              P{p}
            </text>
          </g>
        ))}
        {lapTicks.map((l) => (
          <g key={l}>
            <line x1={x(l)} x2={x(l)} y1={PAD.t} y2={H - PAD.b} className="stroke-border" strokeWidth="1" strokeDasharray="2 4" />
            <text x={x(l)} y={H - 8} textAnchor="middle" className="fill-faint font-mono text-[10px] font-bold">
              {l}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 8} className="fill-light font-mono text-[10px] font-bold uppercase tracking-widest">
          Lap 1
        </text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-light font-mono text-[10px] font-bold uppercase tracking-widest">
          Lap {maxLap}
        </text>
        {drivers
          .filter((d) => d !== me)
          .map((d) => (
            <path key={d.driverId || d.name} d={path(d.points)} fill="none" className="stroke-light opacity-30" strokeWidth="1" strokeLinejoin="round" />
          ))}
        <path d={path(me.points)} fill="none" stroke="var(--recap-team)" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" pathLength="1" className="chart-line" />
        <circle cx={x(first.lap)} cy={y(first.position)} r="5" fill="var(--recap-team)" />
        <circle cx={x(last.lap)} cy={y(last.position)} r="7" fill="var(--recap-team)" className="stroke-card" strokeWidth="3" />
        <text x={x(last.lap) + 12} y={y(last.position) + 5} className="fill-dark font-display text-[16px] font-black">
          P{last.position}
        </text>
      </svg>
    </div>
  );
}

// --- the rating ---------------------------------------------------------------

const RATING_PARTS = [
  { key: "exp", label: "Experience" },
  { key: "rac", label: "Racecraft" },
  { key: "aha", label: "Awareness" },
  { key: "pac", label: "Pace" },
];

// The big number ticks from last round's value; each of the four bars keeps
// last round's length in the brand colour and grows the piece this round
// added in green (or shows the piece it took in red), with the change
// landing as a tag once the bar has settled.
function RatingCard({ rating: r, card }) {
  const was = r.before?.overall;
  return (
    <Card>
      <div className="grid gap-8 lg:grid-cols-[minmax(15rem,auto),1fr] lg:items-center lg:gap-16">
        <div>
          <Label>Driver rating</Label>
          <div className="mt-2 flex items-end gap-4">
            <span className="recap-pop font-display text-[6rem] font-black leading-none tracking-tighter text-dark">
              <Tween from={was} to={r.after.overall} />
            </span>
            {r.delta && (
              <div className="recap-tag mb-3">
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 ${r.delta.overall > 0.05 ? "border-ok/40 bg-ok/10" : r.delta.overall < -0.05 ? "border-bad/40 bg-bad/10" : "border-border"}`}>
                  <Delta value={r.delta.overall} decimals={1} className="text-sm" arrow />
                </span>
                {was != null && <div className="mt-1.5 font-mono text-[11px] text-light">was {Math.round(was)}</div>}
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[11px] text-light">
            {r.rank != null && r.fieldSize != null && (
              <>
                <span className="rounded-md border border-border px-2 py-0.5 font-bold text-dark">#{r.rank}</span>
                <span>live form rank of {r.fieldSize}</span>
              </>
            )}
          </div>
          {card && <div className="mt-2 font-mono text-[11px] text-faint">Your card stays at {Math.round(card.rating.ratings.overall)} this season.</div>}
          {r.provisional && <div className="mt-1 font-mono text-[11px] text-faint">Still provisional: a few more starts and it settles.</div>}
        </div>
        <div className="grid gap-x-12 gap-y-6 sm:grid-cols-2">
          {RATING_PARTS.map((p, i) => {
            const v = r.after[p.key];
            const b = r.before?.[p.key];
            const d = r.delta ? r.delta[p.key] : null;
            if (v == null) return null;
            const base = Math.max(0, Math.min(100, b ?? v));
            const lo = Math.min(base, v);
            const change = Math.abs(v - base);
            const gained = v >= base;
            return (
              <div key={p.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <Label tone="text-light">{p.label}</Label>
                  <span className="flex items-baseline gap-2">
                    {d != null && Math.abs(d) >= 0.05 && (
                      <span className="recap-tag" style={{ "--tag-delay": `${1100 + i * 120}ms` }}>
                        <Delta value={d} decimals={0} className="text-xs" arrow />
                      </span>
                    )}
                    <span className="font-mono text-2xl font-bold tabular-nums leading-none text-dark">
                      <Tween from={b} to={v} />
                    </span>
                  </span>
                </div>
                <div className="relative mt-3 h-2 w-full rounded-full bg-surface2">
                  <div className="bar-fill absolute left-0 top-0 h-2 rounded-full bg-brand" style={{ "--w": `${Math.max(2, lo)}%`, "--bar-delay": `${i * 90}ms` }} />
                  {change >= 0.5 && (
                    <div
                      className="bar-fill absolute top-0 h-2 rounded-r-full"
                      style={{ left: `${lo}%`, "--w": `${change}%`, background: gained ? "rgb(var(--c-ok))" : "rgb(var(--c-bad))", "--bar-delay": `${800 + i * 90}ms` }}
                    />
                  )}
                  {/* the mark where it stood, when it moved */}
                  {change >= 0.5 && <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-dark opacity-60" style={{ left: `${base}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// --- the season -------------------------------------------------------------

// Cumulative championship points, round by round, the whole calendar on the
// axis so the rounds still to come stand there empty. Dropped rounds and
// no-shows are marked. The line draws itself into view.
function SeasonCurve({ season, you }) {
  const rounds = season.rounds;
  const run = rounds.filter((r) => r.run);
  if (!run.length) return null;
  const W = 720;
  const H = 260;
  const PAD = { l: 36, r: 24, t: 24, b: 34 };
  let cum = 0;
  const pts = run.map((r) => ({ ...r, cum: (cum += r.points || 0) }));
  const maxY = Math.max(10, ...pts.map((p) => p.cum));
  // A round top for the axis: 20, 40, 60, 100, 150, 200, 300 ...
  const step = maxY <= 40 ? 10 : maxY <= 100 ? 25 : maxY <= 200 ? 50 : 100;
  const yMax = Math.ceil(maxY / step) * step;
  const x = (num) => PAD.l + ((num - 1) / Math.max(1, rounds.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.number).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts[pts.length - 1].number).toFixed(1)} ${y(0).toFixed(1)} L${x(pts[0].number).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const last = pts[pts.length - 1];
  const gridY = Array.from({ length: yMax / step + 1 }, (_, i) => i * step).filter((v, i, a) => a.length <= 6 || i % 2 === 0);
  const kept = season.dropWorst > 0 ? `best ${rounds.length - season.dropWorst} of ${rounds.length} count` : null;
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Your championship points, round by round</Label>
        {kept && <span className="font-mono text-[11px] text-light">cumulative · {kept}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label="Championship points round by round">
        {gridY.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-faint font-mono text-[10px] font-bold">
              {v}
            </text>
          </g>
        ))}
        <path d={area} fill="var(--recap-team)" opacity="0.12" />
        <path d={line} fill="none" stroke="var(--recap-team)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" pathLength="1" className="chart-line" />
        {pts.map((p) => (
          <g key={p.number}>
            <circle cx={x(p.number)} cy={y(p.cum)} r={p.number === last.number ? 6 : 4} fill={p.status === "DNS" || p.dropped ? "var(--c-card)" : "var(--recap-team)"} stroke="var(--recap-team)" strokeWidth="2" />
            {(p.status === "DNS" || p.dropped) && (
              <text x={x(p.number)} y={y(p.cum) - 10} textAnchor="middle" className="fill-light font-mono text-[9px] font-bold uppercase">
                {p.status === "DNS" ? "DNS" : "dropped"}
              </text>
            )}
          </g>
        ))}
        <text x={x(last.number)} y={y(last.cum) - 12} textAnchor="middle" className="fill-dark font-display text-[15px] font-black">
          {last.cum}
        </text>
        {rounds.map((r) => (
          <text key={r.number} x={x(r.number)} y={H - 10} textAnchor="middle" className={`font-mono text-[10px] font-bold ${r.run ? (r.number === last.number ? "fill-eyebrow" : "fill-light") : "fill-faint"}`}>
            R{r.number}
          </text>
        ))}
      </svg>
      {you && <p className="mt-2 font-mono text-[11px] text-light">Filled marks scored, hollow ones did not count: a no-show, or a round the drop rule takes away.</p>}
    </Card>
  );
}

function ChampionshipCard({ standings: s, team, season }) {
  const moved = s.before ? s.before.position - s.after.position : null;
  return (
    <Card>
      <Label>In the championship</Label>
      <div className="mt-3 flex items-end gap-4">
        <div className="recap-pop flex items-start font-display font-black leading-none tracking-tighter text-dark">
          <span className="mt-2 text-2xl text-light">P</span>
          <span className="text-6xl">{s.after.position}</span>
        </div>
        <div className="mb-1">
          <div className="font-mono text-[11px] text-light">of {s.fieldSize} drivers</div>
          {moved != null && (
            <div className="recap-tag mt-1">
              {s.before && s.before.position !== s.after.position && <span className="mr-2 font-mono text-[11px] text-light line-through">P{s.before.position}</span>}
              <Delta value={moved} suffix={` place${Math.abs(moved) === 1 ? "" : "s"}`} className="text-xs" arrow />
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 divide-y divide-border border-t border-border">
        <Row label="Season points" value={<Tween from={s.before?.total} to={s.after.total} />} />
        {s.isLeader ? (
          s.behind && <Row label={`Lead over ${s.behind.name}`} value={<Tween from={s.behindGapBefore} to={s.behind.gap} prefix="+" suffix=" pts" />} tone="text-ok" />
        ) : (
          <>
            {s.ahead && (
              <Row
                label={`To P${s.after.position - 1} ahead`}
                value={
                  <>
                    <Tween from={s.aheadGapBefore} to={s.ahead.gap} prefix="−" suffix=" pts" />
                    {s.aheadGapBefore != null && s.aheadGapBefore !== s.ahead.gap && (
                      <span className="recap-tag ml-2 inline-block text-xs font-semibold text-light">was −{s.aheadGapBefore}</span>
                    )}
                  </>
                }
              />
            )}
            {s.leader && s.ahead?.name !== s.leader.name && <Row label={`To ${s.leader.name} (P1)`} value={`−${s.leader.total - s.after.total} pts`} />}
          </>
        )}
        {season?.bestFinish && <Row label="Best finish so far" value={`P${season.bestFinish.position} · ${season.bestFinish.track}`} />}
        {team?.after && (
          <Row
            label={`${team.name} · constructors`}
            value={
              <>
                P{team.after.position}
                {team.before && team.before.position !== team.after.position && (
                  <span className="recap-tag ml-2 inline-block">
                    <Delta value={team.before.position - team.after.position} className="text-xs" arrow />
                  </span>
                )}
              </>
            }
          />
        )}
      </div>
    </Card>
  );
}

// --- the points -------------------------------------------------------------

function PointsCard({ points: p }) {
  const before = p.balance != null ? p.balance - (p.hypothetical ? 0 : p.earned) : null;
  const next = p.nextCard;
  const pct = next && p.balance != null ? Math.max(0, Math.min(100, (p.balance / next.cost) * 100)) : null;
  return (
    <Card>
      <div className="grid gap-8 lg:grid-cols-[1fr,1.2fr] lg:gap-14">
        <div>
          <Label>{p.hypothetical ? "NABS Points this round would pay" : "NABS Points earned"}</Label>
          <div className="mt-2 flex items-end gap-3">
            <TokenIcon className="champ-chip mb-3 h-12 w-12 sm:h-14 sm:w-14" />
            <span className="recap-pop font-display text-[5.5rem] font-black leading-none tracking-tighter text-accent">
              <Tween to={p.earned} prefix="+" delay={500} />
            </span>
            <span className="mb-4 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">this race</span>
          </div>
          <div className="recap-cascade mt-3 flex flex-wrap gap-2">
            {p.entries.map((e, i) => (
              <span key={i} className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-medium" style={{ "--i": i + 6 }}>
                {e.title} <span className="font-bold text-dark">+{e.delta}</span>
              </span>
            ))}
            {p.pending && (
              <span className="rounded-md border border-dashed border-border px-2.5 py-1 font-mono text-[11px] text-light" style={{ "--i": p.entries.length + 6 }}>
                {p.pending.title} <span className="font-bold">+{p.pending.delta}</span> · once the stewards are done
              </span>
            )}
          </div>
          {p.rate > 1 && !p.hypothetical && <p className="mt-3 font-mono text-[11px] text-light">Paid at ×{p.rate.toFixed(2)}: your Discord week counted.</p>}
          {p.hypothetical && <p className="mt-3 font-mono text-[11px] text-light">Preview: nothing has been paid for this round yet. This is what the rules pay a finish like this.</p>}
        </div>
        {p.balance != null && (
          <div className="flex flex-col justify-center">
            <div className="flex items-baseline justify-between">
              <Label tone="text-light">Season total</Label>
              <span className="flex items-center gap-2 font-display text-3xl font-black tabular-nums text-dark">
                <TokenIcon className="h-5 w-5" />
                <Tween from={before} to={p.balance} delay={1500} />
              </span>
            </div>
            {next && (
              <>
                <div className="mt-3 h-2 w-full rounded-full bg-surface2">
                  <div className="bar-fill h-2 rounded-full bg-brand" style={{ "--w": `${pct}%`, "--bar-delay": "1500ms" }} />
                </div>
                <div className="recap-tag mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-light" style={{ "--tag-delay": "2400ms" }}>
                  <span>{p.balance >= next.cost ? `Enough for the next card design` : `${(next.cost - p.balance).toLocaleString("en-US")} to the next card design`}</span>
                  <span className="rounded-md border border-border px-2 py-0.5">
                    <span className="font-bold uppercase tracking-wider text-dark">{next.name}</span> {next.cost.toLocaleString("en-US")}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// --- the team-mate ------------------------------------------------------------

// `sprint` is the driver's own sprint line on a sprint weekend, so the two
// sprints stand beside the two feature races.
function TeammateCard({ you, mates, standings, card, sprint = null }) {
  const m = mates[0];
  const better = (a, b, lowerWins = true) => {
    if (a == null || b == null) return 0;
    if (a === b) return 0;
    return (lowerWins ? a < b : a > b) ? 1 : -1;
  };
  const weekend = !!sprint || !!m.sprint;
  const rows = [
    weekend
      ? {
          label: "Sprint",
          a: sprint ? (sprint.finished ? `P${sprint.position}` : sprint.status) : NO_VALUE,
          b: m.sprint ? (m.sprint.position != null ? `P${m.sprint.position}` : m.sprint.status || NO_VALUE) : NO_VALUE,
          win: better(sprint?.finished ? sprint.position : null, m.sprint?.position ?? null),
        }
      : null,
    { label: weekend ? "Feature race" : "Race", a: you.finished ? `P${you.position}` : you.status, b: m.position != null ? `P${m.position}` : m.status, win: better(you.finished ? you.position : null, m.position) },
    { label: "Grid", a: you.grid != null ? `P${you.grid}` : NO_VALUE, b: m.grid != null ? `P${m.grid}` : NO_VALUE, win: better(you.grid, m.grid) },
    { label: "Best lap", a: fmtLap(you.bestLapMs) || NO_VALUE, b: fmtLap(m.bestLapMs) || NO_VALUE, win: better(you.bestLapMs, m.bestLapMs) },
    { label: "Season points", a: standings?.after?.total ?? NO_VALUE, b: m.seasonPoints ?? NO_VALUE, win: better(standings?.after?.total, m.seasonPoints, false) },
  ].filter(Boolean);
  const tone = (w) => (w > 0 ? "text-ok" : w < 0 ? "text-bad" : "text-dark");
  const duel = m.duel && (m.duel.raceWins + m.duel.raceLosses > 0 || m.duel.qualiWins + m.duel.qualiLosses > 0) ? m.duel : null;
  const score = (w, l) => (w > l ? "text-ok" : w < l ? "text-bad" : "text-dark");
  return (
    <Card>
      <Label>Team-mate head to head</Label>
      {/* The two names on one line, the team between them. */}
      <div className="mt-4 grid grid-cols-[1fr,auto,1fr] items-center gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <DriverAvatar name={you.name} photoUrl={card?.driver?.photoUrl || null} color={you.team?.color || "#232833"} size={40} />
          <span className="truncate font-display text-base font-black uppercase tracking-tight text-dark sm:text-xl">{you.name}</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          {you.team && <TeamLogo id={you.team.id} name={you.team.name} color={you.team.color} logoUrl={you.team.logoUrl} size={26} />}
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">{you.team?.name || "vs"}</span>
        </div>
        <Link to={`/drivers/${m.driverId}`} className="flex min-w-0 items-center justify-end gap-3 transition hover:text-brand">
          <span className="truncate text-right font-display text-base font-black uppercase tracking-tight text-dark sm:text-xl">{m.name}</span>
          <DriverAvatar name={m.name} photoUrl={m.photoUrl} color={you.team?.color || "#232833"} size={40} />
        </Link>
      </div>
      <div className="recap-cascade mt-4 divide-y divide-border border-t border-border">
        {rows.map((r, i) => (
          <div key={r.label} className="grid grid-cols-[1fr,auto,1fr] items-baseline gap-4 py-3" style={{ "--i": i }}>
            <span className={`font-mono text-sm font-bold tabular-nums ${tone(r.win)}`}>{r.a}</span>
            <Label tone="text-light" className="text-center">
              {r.label}
            </Label>
            <span className={`text-right font-mono text-sm font-bold tabular-nums ${tone(-r.win)}`}>{r.b}</span>
          </div>
        ))}
        {duel && (
          <div className="grid grid-cols-[1fr,auto,1fr] items-baseline gap-4 py-3" style={{ "--i": rows.length }}>
            <span className="font-mono text-sm font-bold tabular-nums">
              {m.duel.raceWins + m.duel.raceLosses > 0 && (
                <span className={score(m.duel.raceWins, m.duel.raceLosses)}>
                  {m.duel.raceWins}:{m.duel.raceLosses}
                </span>
              )}
              {m.duel.qualiWins + m.duel.qualiLosses > 0 && (
                <span className={`ml-3 ${score(m.duel.qualiWins, m.duel.qualiLosses)}`}>
                  {m.duel.qualiWins}:{m.duel.qualiLosses}
                  <span className="ml-1 text-[10px] text-light">grid</span>
                </span>
              )}
            </span>
            <Label tone="text-light" className="text-center">
              Season duel
            </Label>
            <span className="text-right font-mono text-sm font-bold tabular-nums">
              {m.duel.raceWins + m.duel.raceLosses > 0 && (
                <span className={score(m.duel.raceLosses, m.duel.raceWins)}>
                  {m.duel.raceLosses}:{m.duel.raceWins}
                </span>
              )}
              {m.duel.qualiWins + m.duel.qualiLosses > 0 && (
                <span className={`ml-3 ${score(m.duel.qualiLosses, m.duel.qualiWins)}`}>
                  {m.duel.qualiLosses}:{m.duel.qualiWins}
                  <span className="ml-1 text-[10px] text-light">grid</span>
                </span>
              )}
            </span>
          </div>
        )}
      </div>
      {mates.length > 1 && <p className="mt-3 font-mono text-[11px] text-light">Also in your colours: {mates.slice(1).map((x) => `${x.name} (${x.position != null ? `P${x.position}` : x.status})`).join(", ")}.</p>}
    </Card>
  );
}

// --- tyres, incidents, the season and the career --------------------------------

// Each stint as a piece of the race on the live page's tyre strip, the
// compound's disc pinned where the stint began, and how the tyre behaved
// over it: the slope over its clean laps in seconds per lap. Positive is
// slower, so it reads "+0.14 s/lap" in red; a tyre that came to the driver
// reads "−0.07 s/lap" in green.
function StintsCard({ stints }) {
  const total = stints.reduce((n, st) => n + st.laps, 0) || 1;
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
        {segs.map((s, i) => (
          <div key={i}>
            <div
              className="bar-fill absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
              style={{ left: `${(s.start / total) * 100}%`, "--w": `${(s.laps / total) * 100}%`, backgroundColor: s.t.color, boxShadow: s.t.light ? "0 0 0 1px rgba(17,24,39,0.3)" : "none", "--bar-delay": `${i * 350}ms` }}
              title={`${s.t.name} · ${s.laps} laps`}
            />
            <span className="recap-tag absolute top-1/2 z-10 flex -translate-y-1/2" style={{ left: `max(0px, calc(${(s.start / total) * 100}% - 13px))`, "--tag-delay": `${i * 350}ms` }}>
              <TyreBadge t={s.t} size={26} />
            </span>
          </div>
        ))}
      </div>
      <div className="recap-cascade mt-3 divide-y divide-border border-t border-border">
        {segs.map((s, i) => {
          const perLap = s.degMsPerLap != null ? s.degMsPerLap / 1000 : null;
          const words =
            perLap == null
              ? "too short to read the tyre"
              : perLap > 0.05
                ? `fell away by ${perLap.toFixed(2)} s a lap`
                : perLap < -0.05
                  ? `came to you by ${(-perLap).toFixed(2)} s a lap`
                  : "held its pace to the end";
          return (
            <div key={i} className="flex items-center gap-4 py-3" style={{ "--i": i + 3 }}>
              <TyreBadge t={s.t} size={30} />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-bold text-dark">
                  Stint {i + 1} · {s.laps} laps on {s.t.name.toLowerCase()}
                </div>
                <div className="text-xs text-light">{words}</div>
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
        <div className="recap-cascade mt-3 divide-y divide-border border-t border-border">
          {list.map((c, i) => (
            <div key={i} className="flex items-center gap-4 py-3" style={{ "--i": i }}>
              <span className="w-14 shrink-0 font-mono text-[11px] font-bold uppercase tracking-wider text-light">Lap {c.lap ?? "?"}</span>
              <span className="min-w-0 flex-1 truncate font-display text-base font-extrabold uppercase tracking-tight text-dark">
                {c.driverId ? (
                  <Link to={`/drivers/${c.driverId}`} className="transition hover:text-brand">
                    {c.name}
                  </Link>
                ) : (
                  c.name
                )}
              </span>
              {c.kph != null && <span className={`font-mono text-sm font-bold tabular-nums ${hard(c.kph)}`}>{c.kph} km/h</span>}
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
      <div className="grid gap-6 lg:grid-cols-[1fr,auto] lg:gap-14">
        <div>
          <Label>Your season and career</Label>
          <div className="recap-cascade mt-3 divide-y divide-border border-t border-border">
            {lines.map((l, i) => (
              <div key={l.key} className={`py-3 text-sm leading-relaxed ${l.tone || "text-medium"}`} style={{ "--i": i }}>
                {l.text}
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-8 lg:flex-col lg:gap-4">
          {[
            { label: "Starts", value: c.starts },
            { label: "Wins", value: c.wins },
            { label: "Podiums", value: c.podiums },
          ].map((x, i) => (
            <div key={x.label}>
              <Label tone="text-light">{x.label}</Label>
              <div className="mt-1 font-display text-3xl font-black tabular-nums leading-none text-dark">
                <Tween to={x.value} delay={300 + i * 150} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// --- the honours row ------------------------------------------------------------

// `weekend` on a sprint weekend: these are the feature race's honours, and
// the winner's label says so (the sprint's are on its own card).
function HonoursRow({ race, results, quali, weekend = false }) {
  const { facts, dotd, dotdRow, hasDotd } = buildRaceFacts(race, results, quali);
  const winner = results.filter((r) => r.status === "FINISHED" && r.position != null).sort((a, b) => a.position - b.position)[0] || null;
  const by = (key) => facts.find((f) => f.key === key) || null;
  const cells = [
    winner ? { key: "winner", label: weekend ? "Feature race winner" : "Race winner", name: winner.name, driverId: winner.driverId, country: countryFor(winner.driverId, winner.country), value: [teamOf(winner)?.name, winner.totalTimeMs ? fmtDuration(winner.totalTimeMs + (winner.penaltySeconds || 0) * 1000) : null].filter(Boolean).join(" · ") } : null,
    by("fl") ? { ...by("fl"), label: "Fastest lap", tone: "text-fl" } : null,
    by("pole") ? { ...by("pole"), label: "Pole position" } : null,
    by("climb") ? { ...by("climb"), label: "Biggest climber", tone: "text-ok" } : null,
    hasDotd ? { key: "dotd", label: dotd.pickedBy ? `${dotd.pickedBy}’s Driver of the Day` : "Driver of the Day", name: dotd.name || dotdRow?.name, driverId: dotdRow?.driverId || null, country: dotdRow ? countryFor(dotdRow.driverId, dotdRow.country) : null, value: dotdRow ? `P${dotdRow.position} · ${teamOf(dotdRow)?.name || ""}` : null } : null,
    by("steady") ? { ...by("steady"), label: "Most consistent" } : null,
  ]
    .filter(Boolean)
    .slice(0, 4);
  if (!cells.length) return null;
  return (
    <div className="recap-reveal">
      <div className="recap-cascade grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {cells.map((c, i) => (
          <div key={c.key} className="card p-5" style={{ "--i": i }}>
            <Label tone={c.tone || "text-light"}>{c.label}</Label>
            <div className="mt-2 flex items-center gap-2">
              {c.driverId ? (
                <Link to={`/drivers/${c.driverId}`} className="truncate font-display text-xl font-black uppercase tracking-tight text-dark transition hover:text-brand">
                  {c.name}
                </Link>
              ) : (
                <span className="truncate font-display text-xl font-black uppercase tracking-tight text-dark">{c.name}</span>
              )}
              {c.country && <Flag code={c.country} w={16} h={12} />}
            </div>
            {c.value && <div className={`mt-1 font-mono text-xs ${c.tone || "text-light"}`}>{c.value}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
