// ---------------------------------------------------------------------------
// The race recap: the round told from your seat, as one page of cards.
//
// Built to a mock-up Malte drew: a header with the track's name and your
// driver chip, then cards that each say one thing with one big number and a
// line of words under it (where you finished and what that meant, what it
// paid, your pace against the field, where you stood in the race, the rating,
// the season curve, the NABS Points, your team-mate, the night's honours).
// Every card moves as it scrolls in: the car slides from grid to flag, the
// numbers count from what they were, the curves draw themselves.
//
// Opened three ways. The host at the app root sends a member here the first
// time they come back after the office saved a round (with the recap already
// in hand, in the location state, and `pending` set so arriving counts as
// seen). The Recap button on a race page links here for a second look. And
// the admin preview opens it with ?seat=<driverId> to see any driver's version
// of any round, which never counts as seen for anybody.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useSeriesPath } from "../context/SeriesContext.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { motionOff, useInView } from "../hooks/motion.js";
import { CountUp, DriverAvatar, TierBadge, ErrorBox, PageHeaderSkeleton, CardsSkeleton } from "../components/ui.jsx";
import { buildRaceFacts } from "../components/RaceFacts.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import TokenIcon from "../components/TokenIcon.jsx";
import { countryFor } from "../data/driverCountries.js";
import { flagFor } from "../data/circuits.js";
import { fmtLap, fmtLapDelta, fmtRaceDateFull, NO_VALUE } from "../utils/format.js";
import { fmtDuration, fmtGap } from "../utils/raceDuration.js";
import { fmtRaceTime } from "../utils/raceTime.js";

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

  const { race, results, quali, you, story, incidents, career, season, teammates, standings, team, rating, points, card } = recap;
  const resultsLink = seriesPath(`/races?race=${race.id}`);
  const showPoints = points && (points.entries.length > 0 || points.pending);
  const leave = () => (pending ? navigate(-1) : navigate(resultsLink));

  return (
    <div className="space-y-5" style={{ "--recap-team": you?.team?.color || "var(--c-text)" }}>
      <Header recap={recap} preview={seat != null} />
      {you && (
        <div className="grid gap-5 lg:grid-cols-[1.75fr,1fr]">
          <FinishCard recap={recap} />
          <RoundCard recap={recap} />
        </div>
      )}
      {you?.raced && <StatCards you={you} story={story} race={race} />}
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
      {rating?.after && <RatingCard rating={rating} card={card} />}
      {season && standings?.after && (
        <div className="grid gap-5 lg:grid-cols-[1.75fr,1fr]">
          <SeasonCurve season={season} you={you} />
          <ChampionshipCard standings={standings} team={team} season={season} />
        </div>
      )}
      {career && you && <CareerCard career={career} you={you} race={race} />}
      {showPoints && <PointsCard points={points} />}
      {teammates?.length > 0 && you && <TeammateCard you={you} mates={teammates} standings={standings} />}
      <HonoursRow race={race} results={results} quali={quali} />
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
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

// --- the pieces every card shares --------------------------------------------

function Card({ children, className = "" }) {
  return <div className={`reveal card p-5 sm:p-6 ${className}`}>{children}</div>;
}

function Label({ children, className = "", tone = "text-eyebrow" }) {
  return <div className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] ${tone} ${className}`}>{children}</div>;
}

function Delta({ value, decimals = 0, suffix = "", className = "", arrow = false }) {
  if (value == null || !Number.isFinite(value)) return null;
  const zero = Math.abs(value) < (decimals ? 0.05 : 0.5);
  const up = value > 0;
  const text = zero ? `±0${suffix}` : `${up ? "+" : "−"}${Math.abs(value).toFixed(decimals)}${suffix}`;
  return (
    <span className={`font-mono font-bold tabular-nums ${zero ? "text-light" : up ? "text-ok" : "text-bad"} ${className}`}>
      {arrow && !zero && (up ? "▲ " : "▼ ")}
      {text}
    </span>
  );
}

// A number that ticks from what it was to what it is once it is on screen.
function Tween({ from, to, decimals = 0, duration = 1400, delay = 350, className = "" }) {
  const [ref, inView] = useInView({ rootMargin: "0px 0px 10% 0px" });
  const start = from == null || !Number.isFinite(from) ? to : from;
  const [n, setN] = useState(start);
  useEffect(() => {
    if (!inView || !Number.isFinite(to)) return;
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
  }, [inView, start, to, duration, delay]);
  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {decimals ? n.toFixed(decimals) : Math.round(n)}
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
  return (
    <div className="reveal flex flex-wrap items-end justify-between gap-6 border-b border-border pb-6">
      <div className="min-w-0">
        <Label>
          {[you ? "Your race summary" : "Race summary", race.seasonNumber != null ? `Season ${race.seasonNumber}` : null, race.number != null ? `Round ${race.number}` : null, preview ? "preview" : null]
            .filter(Boolean)
            .join(" · ")}
        </Label>
        <h1 className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 font-display text-[clamp(2.25rem,9vw,3.75rem)] font-black uppercase leading-none tracking-tight text-dark">
          {flag && <Flag code={flag.country} w={40} h={30} className="rounded-sm" />}
          <span className="min-w-0">{race.track}</span>
        </h1>
        <div className="mt-3 text-sm text-medium">
          {[race.date ? fmtRaceDateFull(race.date) : null, time || null, race.raceLaps ? `${race.raceLaps} laps` : null, race.starters ? `${race.starters} starters` : null]
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

// The car slides along a short track from its grid slot to where it finished.
function GridToFlag({ grid, finish, field }) {
  const at = (p) => ((field - p) / Math.max(1, field - 1)) * 100;
  const from = at(grid);
  const to = at(finish);
  const lo = Math.min(from, to);
  const w = Math.abs(to - from);
  return (
    <div className="relative h-8 w-full">
      <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
      <div className="recap-sweep-trail absolute top-1/2 h-[3px] -translate-y-1/2" style={{ left: `${lo}%`, "--w": `${w}%`, background: "var(--recap-team)", opacity: 0.6 }} />
      <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-light bg-card" style={{ left: `${from}%` }} />
      <div className="recap-sweep-dot absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ "--from": `${from}%`, "--to": `${to}%`, left: `${to}%` }}>
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
  if (you.finished && you.position === 1) bits.unshift("Race winner.");
  else if (you.finished && you.position <= 3) bits.unshift(`${nth(you.position)} place, on the podium.`);
  return bits.join(" ");
}

function FinishCard({ recap }) {
  const { you, race } = recap;
  const story = finishStory(recap);
  return (
    <Card>
      <Label>Finishing position</Label>
      <div className="mt-4 flex flex-wrap items-center gap-8">
        <div className="recap-pop flex items-start font-display font-black leading-none tracking-tighter text-dark">
          <span className="mt-3 text-4xl text-light sm:mt-5 sm:text-5xl">P</span>
          <span className="text-[6.5rem] sm:text-[8.5rem]">{you.finished ? you.position : you.raced ? you.status : "DNS"}</span>
        </div>
        <div className="min-w-0 flex-1">
          {you.finished && you.grid != null && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-md border border-border px-2 py-0.5 font-mono text-xs font-bold text-light">P{you.grid}</span>
              <div className="min-w-[5rem] max-w-[12rem] flex-1">
                <GridToFlag grid={you.grid} finish={you.position} field={race.starters || race.fieldSize} />
              </div>
              <span className="rounded-md border px-2 py-0.5 font-mono text-xs font-bold text-dark" style={{ borderColor: "var(--recap-team)" }}>
                P{you.position}
              </span>
              {you.gained !== 0 && (
                <span className="flex items-baseline gap-1.5">
                  <Delta value={you.gained} className="text-2xl" />
                  <Label tone="text-light">{Math.abs(you.gained) === 1 ? "place" : "places"} {you.gained > 0 ? "gained" : "lost"}</Label>
                </span>
              )}
            </div>
          )}
          {!you.finished && (
            <div className="font-display text-xl font-extrabold uppercase tracking-tight text-medium">
              {!you.raced ? "Did not start" : you.status === "DNF" ? "Did not finish" : you.status === "DSQ" ? "Disqualified" : you.status}
              {you.grid != null && you.raced ? `, from P${you.grid} on the grid` : ""}
            </div>
          )}
          {story && <p className="mt-4 max-w-md text-sm leading-relaxed text-medium">{story}</p>}
          {you.finished && you.rawPosition != null && you.rawPosition !== you.position && (
            <p className="mt-2 text-xs text-light">Crossed the line P{you.rawPosition}; the stewards made it P{you.position}.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function RoundCard({ recap }) {
  const { you, results, race, standings } = recap;
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
          <CountUp end={you.points || 0} prefix={you.points > 0 ? "+" : ""} />
          <span className="ml-1 font-mono text-xs font-bold text-light">pts</span>
        </span>
      </div>
      <div className="mt-4 divide-y divide-border border-t border-border">
        <Row label="Race time" value={myMs ? fmtDuration(myMs) : null} />
        <Row label="Gap to winner" value={you.position === 1 ? "Winner" : lapsDown(mine) || gapTo(winMs)} />
        {ahead && <Row label={`Gap to P${ahead.position}`} value={gapTo(aheadMs) || (lapsDown(mine) && !lapsDown(ahead) ? lapsDown(mine) : null)} />}
        {you.finished && race.starters > 0 && <Row label="Starters beaten" value={`${race.starters - you.position} of ${race.starters}`} />}
        {you.fastestLapBonus > 0 && <Row label="Fastest lap bonus" value={`+${you.fastestLapBonus}`} tone="text-fl" />}
        {standings?.roundDropped && <Row label="Drop rule" value="this round does not count" tone="text-light" />}
      </div>
    </Card>
  );
}

// --- the stat cards -----------------------------------------------------------

function Stat({ label, value, note, tone = "text-dark", index = 0 }) {
  return (
    <div className="card p-5" style={{ "--i": index }}>
      <Label tone="text-light">{label}</Label>
      <div className={`mt-3 font-mono text-2xl font-bold tabular-nums leading-none sm:text-[1.7rem] ${tone}`}>{value ?? NO_VALUE}</div>
      {note && <div className="mt-2 text-xs text-light">{note}</div>}
    </div>
  );
}

function StatCards({ you, story, race }) {
  const fastest = you.bestLapMs != null && you.lapGapMs === 0;
  const consistencyRank = null; // the field's ranks come with the classification rows below
  const cells = [
    fmtLap(you.bestLapMs)
      ? { label: "Best lap", value: fmtLap(you.bestLapMs), tone: fastest ? "text-fl" : "text-dark", note: fastest ? "fastest lap of the race" : you.lapGapMs != null ? `${fmtLapDelta(you.lapGapMs)} to the fastest lap${story?.bestLapAt ? ` · lap ${story.bestLapAt}` : ""}` : null }
      : null,
    story?.paceMs
      ? { label: "Race pace", value: fmtLap(story.paceMs), note: story.paceRank ? `P${story.paceRank} of ${story.paceField} on pure race pace${story.gapToBestPaceMs > 0 ? ` · ${fmtLapDelta(story.gapToBestPaceMs)} a lap` : ""}` : "median of your real laps" }
      : null,
    you.consistencyPct > 0 ? { label: "Consistency", value: `${you.consistencyPct.toFixed(1)}%`, tone: you.consistencyPct >= 96 ? "text-ok" : "text-dark", note: consistencyRank || "how close your laps stayed to your best" } : null,
    you.overtakes != null ? { label: "Overtakes", value: String(you.overtakes), note: you.grid != null && you.finished ? `estimated · net ${you.gained >= 0 ? "+" : ""}${you.gained}` : "estimated" } : null,
    you.cleanLaps != null && you.laps != null
      ? { label: "Clean laps", value: `${you.cleanLaps} / ${you.laps}`, note: `${you.contacts ?? 0} car contact${you.contacts === 1 ? "" : "s"}${you.penaltySeconds > 0 ? ` · +${you.penaltySeconds}s penalty` : you.cleanRace ? " · no penalty" : ""}` }
      : you.laps != null
        ? { label: "Laps", value: String(you.laps), note: `${you.contacts ?? 0} car contacts` }
        : null,
    story?.bestPosition
      ? { label: "Best position in race", value: `P${story.bestPosition}`, note: story.bestRun ? (story.bestRun.from === story.bestRun.to ? `on lap ${story.bestRun.from}` : `held from lap ${story.bestRun.from} to lap ${story.bestRun.to}`) : null }
      : you.lapsLed > 0
        ? { label: "Laps led", value: String(you.lapsLed), note: "at the start/finish line" }
        : null,
    story?.stints?.length
      ? { label: "Stints", value: story.stints.map((s) => s.tyre).join(" · "), note: story.stints.map((s) => `${s.laps} on ${s.tyre}`).join(", ") }
      : story?.lap1Pos
        ? { label: "After lap 1", value: `P${story.lap1Pos}`, note: you.grid != null ? `from P${you.grid} on the grid` : null }
        : null,
    // Past a minute and a half it is a safety car or a red flag, not the
    // driver, and the number would only mislead.
    story?.offPaceMs != null && story.offPaceMs < 90_000
      ? { label: "Time lost off pace", value: `${(story.offPaceMs / 1000).toFixed(1)} s`, tone: story.offPaceMs > 10_000 ? "text-warn" : "text-dark", note: "laps well off your own clean pace: pits, spins, traffic" }
      : you.lapsLed > 0
        ? { label: "Laps led", value: String(you.lapsLed), note: "at the start/finish line" }
        : null,
  ].filter(Boolean);
  if (!cells.length) return null;
  return (
    <div className="cascade reveal grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {cells.map((c, i) => (
        <Stat key={c.label} {...c} index={i} />
      ))}
    </div>
  );
}

// The driver's position lap by lap, drawn over the rest of the field on a
// timing-screen grid. The line draws itself when it scrolls into view.
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
    <div className="reveal-chart">
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

function RatingCard({ rating: r, card }) {
  const was = r.before?.overall;
  return (
    <Card>
      <div className="grid gap-8 lg:grid-cols-[auto,1fr] lg:gap-14">
        <div>
          <Label>Driver rating</Label>
          <div className="mt-2 flex items-end gap-4">
            <span className="recap-pop font-display text-[6rem] font-black leading-none tracking-tighter text-dark">
              <Tween from={was} to={r.after.overall} />
            </span>
            {r.delta && (
              <div className="mb-3">
                <span className="rounded-md border border-border px-2 py-0.5">
                  <Delta value={r.delta.overall} decimals={1} className="text-sm" arrow />
                </span>
                {was != null && <div className="mt-1.5 font-mono text-[11px] text-light">was {Math.round(was)}</div>}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-light">
            {r.rank != null && r.fieldSize != null && (
              <>
                <span className="rounded-md border border-border px-2 py-0.5 font-bold text-dark">#{r.rank}</span>
                <span>live form rank of {r.fieldSize}</span>
              </>
            )}
            {card && <span className="text-faint">· your card stays at {Math.round(card.rating.ratings.overall)} this season</span>}
          </div>
        </div>
        <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {RATING_PARTS.map((p) => {
            const v = r.after[p.key];
            const b = r.before?.[p.key];
            const d = r.delta ? r.delta[p.key] : null;
            if (v == null) return null;
            const base = Math.max(0, Math.min(100, b ?? v));
            const lo = Math.min(base, v);
            const change = Math.abs(v - base);
            return (
              <div key={p.key}>
                <div className="flex items-baseline justify-between">
                  <Label tone="text-light">{p.label}</Label>
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-lg font-bold tabular-nums text-dark">
                      <Tween from={b} to={v} />
                    </span>
                    {d != null && <Delta value={d} decimals={0} className="text-xs" />}
                  </span>
                </div>
                <div className="relative mt-2 h-1.5 w-full rounded-full bg-surface2">
                  <div className="bar-fill absolute left-0 top-0 h-1.5 rounded-full bg-brand" style={{ "--w": `${Math.max(2, lo)}%` }} />
                  {change >= 0.5 && (
                    <div
                      className="bar-fill absolute top-0 h-1.5 rounded-full"
                      style={{ left: `${lo}%`, "--w": `${change}%`, background: v >= base ? "rgb(var(--c-ok))" : "rgb(var(--c-bad))", animationDelay: "calc(var(--reveal-delay, 0s) + 900ms)" }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {r.provisional && <p className="mt-4 font-mono text-[11px] text-light">Still provisional: a few more starts and it settles.</p>}
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
      <div className="reveal-chart">
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
      </div>
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
          {moved != null && <Delta value={moved} suffix={` place${Math.abs(moved) === 1 ? "" : "s"}`} className="text-xs" arrow />}
        </div>
      </div>
      <div className="mt-4 divide-y divide-border border-t border-border">
        <Row label="Season points" value={<Tween from={s.before?.total} to={s.after.total} />} />
        {s.isLeader ? (
          s.behind && <Row label={`Lead over ${s.behind.name}`} value={`+${s.behind.gap} pts`} tone="text-ok" />
        ) : (
          <>
            {s.ahead && (
              <Row
                label={`To P${s.after.position - 1} ahead`}
                value={
                  <>
                    −{s.ahead.gap} pts
                    {s.aheadGapBefore != null && s.aheadGapBefore !== s.ahead.gap && (
                      <span className="ml-2 text-xs font-semibold text-light">was −{s.aheadGapBefore}</span>
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
                {team.before && team.before.position !== team.after.position && <Delta value={team.before.position - team.after.position} className="ml-2 text-xs" arrow />}
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
            <span className="recap-pop font-display text-[5.5rem] font-black leading-none tracking-tighter text-accent">
              <CountUp end={p.earned} prefix="+" />
            </span>
            <span className="mb-4 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">this race</span>
          </div>
          <div className="cascade mt-3 flex flex-wrap gap-2">
            {p.entries.map((e, i) => (
              <span key={i} className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-medium" style={{ "--i": i }}>
                {e.title} <span className="font-bold text-dark">+{e.delta}</span>
              </span>
            ))}
            {p.pending && (
              <span className="rounded-md border border-dashed border-border px-2.5 py-1 font-mono text-[11px] text-light" style={{ "--i": p.entries.length }}>
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
                <Tween from={before} to={p.balance} delay={900} />
              </span>
            </div>
            {next && (
              <>
                <div className="mt-3 h-2 w-full rounded-full bg-surface2">
                  <div className="bar-fill h-2 rounded-full bg-brand" style={{ "--w": `${pct}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-light">
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

function TeammateCard({ you, mates, standings }) {
  const m = mates[0];
  const better = (a, b, lowerWins = true) => {
    if (a == null || b == null) return 0;
    if (a === b) return 0;
    return (lowerWins ? a < b : a > b) ? 1 : -1;
  };
  const rows = [
    { label: "Race", a: you.finished ? `P${you.position}` : you.status, b: m.position != null ? `P${m.position}` : m.status, win: better(you.finished ? you.position : null, m.position) },
    { label: "Grid", a: you.grid != null ? `P${you.grid}` : NO_VALUE, b: m.grid != null ? `P${m.grid}` : NO_VALUE, win: better(you.grid, m.grid) },
    { label: "Best lap", a: fmtLap(you.bestLapMs) || NO_VALUE, b: fmtLap(m.bestLapMs) || NO_VALUE, win: better(you.bestLapMs, m.bestLapMs) },
    { label: "Season points", a: standings?.after?.total ?? NO_VALUE, b: m.seasonPoints ?? NO_VALUE, win: better(standings?.after?.total, m.seasonPoints, false) },
  ];
  const tone = (w) => (w > 0 ? "text-ok" : w < 0 ? "text-bad" : "text-dark");
  return (
    <Card>
      <Label>Team-mate head to head{you.team ? ` · ${you.team.name}` : ""}</Label>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <DriverAvatar name={you.name} photoUrl={null} color={you.team?.color || "#232833"} size={36} />
          <span className="font-display text-base font-black uppercase tracking-tight text-dark sm:text-xl">{you.name}</span>
        </div>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-light">vs</span>
        <Link to={`/drivers/${m.driverId}`} className="flex items-center gap-3 text-right transition hover:text-brand">
          <span className="font-display text-base font-black uppercase tracking-tight text-dark sm:text-xl">{m.name}</span>
          <DriverAvatar name={m.name} photoUrl={m.photoUrl} color={you.team?.color || "#232833"} size={36} />
        </Link>
      </div>
      <div className="mt-4 divide-y divide-border border-t border-border">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[1fr,auto,1fr] items-baseline gap-4 py-3">
            <span className={`font-mono text-sm font-bold tabular-nums ${tone(r.win)}`}>{r.a}</span>
            <Label tone="text-light" className="text-center">
              {r.label}
            </Label>
            <span className={`text-right font-mono text-sm font-bold tabular-nums ${tone(-r.win)}`}>{r.b}</span>
          </div>
        ))}
      </div>
      {m.duel && (m.duel.raceWins + m.duel.raceLosses > 0 || m.duel.qualiWins + m.duel.qualiLosses > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4">
          <Label tone="text-light">Season duel</Label>
          {m.duel.raceWins + m.duel.raceLosses > 0 && (
            <span className="font-mono text-sm font-bold tabular-nums">
              <span className="text-light">Race </span>
              <span className={m.duel.raceWins > m.duel.raceLosses ? "text-ok" : m.duel.raceWins < m.duel.raceLosses ? "text-bad" : "text-dark"}>
                {m.duel.raceWins}:{m.duel.raceLosses}
              </span>
            </span>
          )}
          {m.duel.qualiWins + m.duel.qualiLosses > 0 && (
            <span className="font-mono text-sm font-bold tabular-nums">
              <span className="text-light">Grid </span>
              <span className={m.duel.qualiWins > m.duel.qualiLosses ? "text-ok" : m.duel.qualiWins < m.duel.qualiLosses ? "text-bad" : "text-dark"}>
                {m.duel.qualiWins}:{m.duel.qualiLosses}
              </span>
            </span>
          )}
        </div>
      )}
      {mates.length > 1 && <p className="mt-3 font-mono text-[11px] text-light">Also in your colours: {mates.slice(1).map((x) => `${x.name} (${x.position != null ? `P${x.position}` : x.status})`).join(", ")}.</p>}
    </Card>
  );
}

// --- tyres, incidents, the season and the career --------------------------------

const TYRE_COLOUR = { S: "#ef4444", M: "#eab308", H: "#e5e7eb", I: "#22c55e", W: "#3b82f6" };

// Each stint as a piece of the race, and how the tyre behaved over it: the
// slope over its clean laps, in seconds per lap. Positive means it fell away.
function StintsCard({ stints }) {
  const total = stints.reduce((n, st) => n + st.laps, 0) || 1;
  return (
    <Card>
      <Label>Tyres and stints</Label>
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-surface2">
        {stints.map((st, i) => (
          <div key={i} className="bar-fill h-full" style={{ "--w": `${(st.laps / total) * 100}%`, background: TYRE_COLOUR[st.tyre] || "var(--c-text3)", animationDelay: `calc(var(--reveal-delay, 0s) + ${i * 250}ms)` }} title={`${st.laps} laps on ${st.tyre}`} />
        ))}
      </div>
      <div className="mt-3 divide-y divide-border border-t border-border">
        {stints.map((st, i) => {
          const perLap = st.degMsPerLap != null ? st.degMsPerLap / 1000 : null;
          const words =
            perLap == null
              ? "too short to read the tyre"
              : perLap > 0.05
                ? `fell away by ${perLap.toFixed(2)} s a lap`
                : perLap < -0.05
                  ? `got faster by ${(-perLap).toFixed(2)} s a lap`
                  : "held its pace to the end";
          return (
            <div key={i} className="flex items-center gap-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] font-display text-sm font-black text-dark" style={{ borderColor: TYRE_COLOUR[st.tyre] || "var(--c-border)" }}>
                {st.tyre}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-bold text-dark">
                  Stint {i + 1} · {st.laps} laps
                </div>
                <div className="text-xs text-light">{words}</div>
              </div>
              {perLap != null && <Delta value={-perLap} decimals={2} suffix=" s/lap" className="text-sm" />}
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
        <p className="mt-4 font-display text-xl font-extrabold uppercase tracking-tight text-ok">A clean race. No contact with another car.</p>
      ) : (
        <div className="mt-3 divide-y divide-border border-t border-border">
          {list.map((c, i) => (
            <div key={i} className="flex items-center gap-4 py-3">
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
      <p className="mt-3 text-xs text-light">
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
          <div className="cascade mt-3 divide-y divide-border border-t border-border">
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
          ].map((x) => (
            <div key={x.label}>
              <Label tone="text-light">{x.label}</Label>
              <div className="mt-1 font-display text-3xl font-black tabular-nums leading-none text-dark">
                <CountUp end={x.value} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// --- the honours row ------------------------------------------------------------

function HonoursRow({ race, results, quali }) {
  const { facts, dotd, dotdRow, hasDotd } = buildRaceFacts(race, results, quali);
  const winner = results.filter((r) => r.status === "FINISHED" && r.position != null).sort((a, b) => a.position - b.position)[0] || null;
  const by = (key) => facts.find((f) => f.key === key) || null;
  const cells = [
    winner ? { key: "winner", label: "Race winner", name: winner.name, driverId: winner.driverId, country: countryFor(winner.driverId, winner.country), value: [teamOf(winner)?.name, winner.totalTimeMs ? fmtDuration(winner.totalTimeMs + (winner.penaltySeconds || 0) * 1000) : null].filter(Boolean).join(" · ") } : null,
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
    <div className="cascade reveal grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
  );
}
