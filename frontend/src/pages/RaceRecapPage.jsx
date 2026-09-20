// ---------------------------------------------------------------------------
// The race recap: the round told from your seat, as one long scroll.
//
// It does not look like the rest of the site on purpose. No cards, no
// tables: full-width chapters, each the height of the screen, a photo where
// there is one and otherwise the page's own dark with a wash of the team's
// colour, and a few very large numbers with a line of words under each.
//
// Opened three ways. The host at the app root sends a member here the first
// time they come back after the office saved a round (with the recap already
// in hand, in the location state, and `pending` set so arriving counts as
// seen). The Recap button on a race page links here for a second look. And
// the admin preview opens it with ?seat=<driverId> to see any driver's version
// of any round, which never counts as seen for anybody.
//
// Everything on the page comes from one payload (backend lib/raceRecap.js);
// the only extra request is the lap-by-lap order for the race trace.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useSeriesPath } from "../context/SeriesContext.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { useParallax } from "../hooks/motion.js";
import { CountUp, DriverAvatar, MEDAL, MEDAL_TEXT, ErrorBox, PageHeaderSkeleton } from "../components/ui.jsx";
import RatingCard from "../components/RatingCard.jsx";
import { buildRaceFacts } from "../components/RaceFacts.jsx";
import CircuitMap from "../components/CircuitMap.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import TokenIcon from "../components/TokenIcon.jsx";
import { countryFor } from "../data/driverCountries.js";
import { flagFor } from "../data/circuits.js";
import { heroFor } from "../utils/heroImage.js";
import { fmtLap, fmtLapDelta, fmtRaceDateFull, NO_VALUE } from "../utils/format.js";
import { fmtGap } from "../utils/raceDuration.js";
import { playStandingsReplay } from "../utils/standingsReplay.js";

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

  // The chapters run edge to edge, past the page's own gutters. The body is
  // told not to grow a sideways scrollbar over the few pixels a 100vw strip
  // reaches past a real scrollbar.
  useEffect(() => {
    document.body.classList.add("recap-bleed");
    return () => document.body.classList.remove("recap-bleed");
  }, []);

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
  if (!recap) return <PageHeaderSkeleton />;

  const { race, results, quali, you, standings, rating, points, card } = recap;
  const resultsLink = seriesPath(`/races?race=${race.id}`);
  const showPoints = points && (points.entries.length > 0 || points.pending);
  const leave = () => (pending ? navigate(-1) : navigate(resultsLink));
  const teamColor = you?.team?.color || null;

  return (
    <div className="recap-bleed-strip" style={{ "--recap-team": teamColor || "var(--c-eyebrow)" }}>
      <Opening recap={recap} preview={seat != null} />
      {you && <YouChapter recap={recap} laps={laps} />}
      <PodiumChapter results={results} />
      {standings?.after && <ChampionshipChapter recap={recap} />}
      {(rating?.after || card) && <RatingChapter recap={recap} />}
      {showPoints && <PointsChapter points={points} />}
      <FactsChapter race={race} results={results} quali={quali} />
      <Chapter className="min-h-[60svh]">
        <div className="reveal mx-auto flex max-w-3xl flex-col items-center text-center">
          <Eyebrow>That was {race.track}</Eyebrow>
          <p className="mt-4 max-w-xl text-lg text-medium">
            The full classification, every lap and the stewards' decisions are on the race page.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to={resultsLink} className="btn-secondary px-6 py-3 text-base">
              Full results
            </Link>
            <button type="button" onClick={leave} className="btn-primary px-6 py-3 text-base">
              {pending ? "Carry on" : "Done"}
            </button>
          </div>
        </div>
      </Chapter>
    </div>
  );
}

// --- the frame every chapter shares -----------------------------------------

// A chapter is the height of the screen and the width of the window; the
// content inside keeps to a readable column.
function Chapter({ children, className = "", photo = null, glow = false, id }) {
  const img = useParallax(0.12);
  return (
    <section id={id} className={`relative flex min-h-[100svh] w-full items-center overflow-hidden ${className}`}>
      {photo && (
        <>
          <img ref={img} src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="recap-scrim absolute inset-0" />
        </>
      )}
      {glow && <div className="recap-glow pointer-events-none absolute inset-0" aria-hidden="true" />}
      <div className="relative mx-auto w-full max-w-6xl px-6 py-20 sm:px-12 sm:py-24">{children}</div>
    </section>
  );
}

function Eyebrow({ children, className = "", style }) {
  return (
    <div className={`flex items-center gap-3 font-mono text-[12px] font-bold uppercase tracking-[0.25em] text-eyebrow sm:text-[13px] ${className}`} style={style}>
      <span className="h-px w-8 bg-current opacity-50" />
      <span>{children}</span>
    </div>
  );
}

// A giant number with a word under it. The whole page is made of these.
function Giant({ children, className = "" }) {
  return (
    <div className={`recap-pop font-display font-black leading-[0.85] tracking-tighter text-dark ${className}`}>{children}</div>
  );
}

// A value and its word, no box around it, for a row of a few of them.
function Stat({ value, label, note, tone = "text-dark" }) {
  if (value == null || value === "") return null;
  return (
    <div className="min-w-[7rem]">
      <div className={`font-display text-4xl font-black tabular-nums leading-none sm:text-5xl ${tone}`}>{value}</div>
      <div className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">{label}</div>
      {note && <div className="mt-0.5 text-xs text-faint">{note}</div>}
    </div>
  );
}

function Delta({ value, decimals = 0, suffix = "", className = "" }) {
  if (value == null || !Number.isFinite(value)) return null;
  const zero = Math.abs(value) < (decimals ? 0.05 : 0.5);
  const up = value > 0;
  const text = zero ? `±0${suffix}` : `${up ? "+" : "−"}${Math.abs(value).toFixed(decimals)}${suffix}`;
  return <span className={`font-mono font-bold tabular-nums ${zero ? "text-light" : up ? "text-ok" : "text-bad"} ${className}`}>{text}</span>;
}

const teamOf = (row) => row?.effectiveTeam || row?.team || null;

// --- 1. the opening ---------------------------------------------------------

function Opening({ recap, preview }) {
  const { race, you } = recap;
  const flag = flagFor(race.track, race.country);
  const photo = heroFor({ number: race.seasonNumber, heroImageUrl: race.heroImageUrl });
  return (
    <Chapter photo={photo} className="items-end">
      <CircuitMap
        track={race.track}
        animate
        className="pointer-events-none absolute right-0 top-1/2 h-[75vh] w-[60vw] -translate-y-1/2 text-dark opacity-[0.18]"
        strokeWidth={1.6}
      />
      <div className="relative">
        <Eyebrow className="hero-anim" style={{ animationDelay: "0.05s" }}>
          {["Race recap", race.number != null ? `Round ${race.number}` : null, race.seasonNumber != null ? `Season ${race.seasonNumber}` : null, preview ? "preview" : null]
            .filter(Boolean)
            .join(" · ")}
        </Eyebrow>
        <h1 className="hero-anim mt-6 font-display text-[clamp(3.5rem,12vw,11rem)] font-black uppercase leading-[0.85] tracking-tighter text-dark" style={{ animationDelay: "0.15s" }}>
          {race.track}
        </h1>
        <div className="hero-anim mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[13px] uppercase tracking-[0.2em] text-medium" style={{ animationDelay: "0.3s" }}>
          {flag && <Flag code={flag.country} w={34} h={25} className="rounded-sm" />}
          {race.date && <span>{fmtRaceDateFull(race.date)}</span>}
          <span>{race.finishers} of {race.fieldSize} classified</span>
          {race.raceLaps && <span>{race.raceLaps} laps</span>}
        </div>
        <div className="hero-anim mt-16 flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-light" style={{ animationDelay: "0.6s" }}>
          <svg viewBox="0 0 24 24" className="scroll-cue h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
          {you ? "Your race, from the top" : "The race, from the top"}
        </div>
      </div>
    </Chapter>
  );
}

// --- 2. you -----------------------------------------------------------------

function YouChapter({ recap, laps }) {
  const y = recap.you;
  const photo = recap.card?.driver?.photoUrl || recap.results.find((r) => r.driverId === y.driverId)?.photoUrl || null;
  const fastest = y.finished && y.bestLapMs != null && y.lapGapMs === 0;
  const line = !y.raced
    ? "You sat this one out."
    : !y.finished
      ? `${y.status}${y.grid != null ? `, from P${y.grid} on the grid` : ""}.`
      : y.gained > 0
        ? `Up ${y.gained} from P${y.grid} on the grid.`
        : y.gained < 0
          ? `Down ${-y.gained} from P${y.grid} on the grid.`
          : y.grid != null
            ? "Held from lights to flag."
            : "";
  const stats = [
    y.points > 0 ? { value: `+${y.points}`, label: "points", note: y.fastestLapBonus > 0 ? `incl. ${y.fastestLapBonus} for the fastest lap` : recap.standings?.roundDropped ? "a dropped round" : null } : null,
    y.sprint ? { value: y.sprint.position != null ? `P${y.sprint.position}` : y.sprint.status, label: "sprint", note: y.sprint.points > 0 ? `+${y.sprint.points} pts` : null } : null,
    fmtLap(y.bestLapMs) ? { value: fmtLap(y.bestLapMs), label: "best lap", note: fastest ? "fastest of the race" : y.lapGapMs != null ? `${fmtLapDelta(y.lapGapMs)} to the fastest` : null, tone: fastest ? "text-fl" : "text-dark" } : null,
    y.lapsLed > 0 ? { value: String(y.lapsLed), label: y.lapsLed === 1 ? "lap led" : "laps led" } : null,
    y.overtakes != null ? { value: String(y.overtakes), label: "overtakes", note: "estimated" } : null,
    y.contacts != null ? { value: String(y.contacts), label: y.contacts === 1 ? "contact" : "contacts", tone: y.contacts === 0 ? "text-ok" : "text-dark" } : null,
    y.consistencyPct > 0 ? { value: `${y.consistencyPct.toFixed(1)}%`, label: "consistency" } : null,
    y.raced
      ? y.penaltySeconds > 0
        ? { value: `+${y.penaltySeconds}s`, label: "penalty", note: "from the stewards", tone: "text-bad" }
        : y.cleanRace
          ? { value: "Clean", label: "no penalties", tone: "text-ok" }
          : y.gamePenalties > 0
            ? { value: String(y.gamePenalties), label: "in-game penalties", tone: "text-warn" }
            : null
      : null,
  ].filter(Boolean);
  return (
    <Chapter glow>
      <div className="reveal flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-4">
            <DriverAvatar name={y.name} photoUrl={photo} color={y.team?.color || "#232833"} size={56} />
            <div>
              <div className="font-display text-xl font-black uppercase tracking-tight text-dark">{y.name}</div>
              {y.team && <TeamLogo id={y.team.id} name={y.team.name} color={y.team.color} logoUrl={y.team.logoUrl} size={14} showName nameClassName="text-sm text-light" />}
            </div>
          </div>
          <Eyebrow className="mt-10">{y.finished ? "You finished" : y.raced ? "Your race ended" : "Your race"}</Eyebrow>
          <Giant className="mt-4 text-[clamp(7rem,26vw,20rem)]">{y.finished ? `P${y.position}` : y.raced ? y.status : "DNS"}</Giant>
          <p className="mt-6 max-w-xl font-display text-2xl font-extrabold uppercase tracking-tight text-medium sm:text-3xl">
            {y.finished && y.position <= 3 && (
              <span className="mr-3" style={{ color: MEDAL_TEXT[y.position - 1] }}>
                {y.position === 1 ? "Winner." : "Podium."}
              </span>
            )}
            {line}
          </p>
          {y.finished && y.rawPosition != null && y.rawPosition !== y.position && (
            <p className="mt-2 text-sm text-light">Crossed the line P{y.rawPosition}; the stewards made it P{y.position}.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-3 lg:max-w-md lg:grid-cols-2">
          {stats.map((s) => (
            <Stat key={s.label} {...s} />
          ))}
        </div>
      </div>
      {laps && <RaceTrace laps={laps} driverId={y.driverId} color={y.team?.color} />}
    </Chapter>
  );
}

// The driver's position lap by lap over the faint traces of everyone else.
function RaceTrace({ laps, driverId, color }) {
  const W = 1000;
  const H = 260;
  const PAD = { l: 40, r: 60, t: 16, b: 28 };
  const drivers = (laps.drivers || []).filter((d) => (d.points || []).length > 1);
  const me = drivers.find((d) => d.driverId === driverId);
  if (!me) return null;
  const maxLap = Math.max(1, laps.maxLap || 0, ...drivers.flatMap((d) => d.points.map((p) => p.lap)));
  const maxPos = Math.max(1, ...drivers.flatMap((d) => d.points.map((p) => p.position)));
  const x = (lap) => PAD.l + ((lap - 1) / Math.max(1, maxLap - 1)) * (W - PAD.l - PAD.r);
  const y = (pos) => PAD.t + ((pos - 1) / Math.max(1, maxPos - 1)) * (H - PAD.t - PAD.b);
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.lap).toFixed(1)} ${y(p.position).toFixed(1)}`).join(" ");
  const first = me.points[0];
  const last = me.points[me.points.length - 1];
  const stroke = color || "var(--c-eyebrow)";
  return (
    <div className="reveal-chart mt-16">
      <div className="flex items-baseline justify-between font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">
        <span>Lap by lap</span>
        <span className="text-faint">position at the line</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full" role="img" aria-label="Your position lap by lap">
        {[1, maxPos].map((p) => (
          <text key={p} x={PAD.l - 10} y={y(p) + 4} textAnchor="end" className="fill-light font-mono text-[12px] font-bold">
            P{p}
          </text>
        ))}
        {drivers
          .filter((d) => d !== me)
          .map((d) => (
            <path key={d.driverId || d.name} d={path(d.points)} fill="none" stroke="currentColor" className="text-dark opacity-10" strokeWidth="1.2" strokeLinejoin="round" />
          ))}
        <path d={path(me.points)} fill="none" stroke={stroke} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" pathLength="1" className="chart-line" />
        <circle cx={x(first.lap)} cy={y(first.position)} r="5" fill={stroke} />
        <circle cx={x(last.lap)} cy={y(last.position)} r="7" fill={stroke} stroke="var(--c-bg)" strokeWidth="3" />
        <text x={x(last.lap) + 12} y={y(last.position) + 5} className="fill-dark font-display text-[16px] font-black">
          P{last.position}
        </text>
        <text x={PAD.l} y={H - 6} className="fill-light font-mono text-[11px] font-bold uppercase tracking-widest">
          Lap 1
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-light font-mono text-[11px] font-bold uppercase tracking-widest">
          Lap {maxLap}
        </text>
      </svg>
    </div>
  );
}

// --- 3. the podium ----------------------------------------------------------

function PodiumChapter({ results }) {
  const finished = results.filter((r) => r.status === "FINISHED" && r.position != null).sort((a, b) => a.position - b.position);
  const top = finished.slice(0, 3);
  if (!top.length) return null;
  const adj = (r) => (r.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);
  const winMs = adj(top[0]);
  const gapOf = (r, i) => {
    if (i === 0) return "Winner";
    const t = adj(r);
    if (!t || !winMs) return null;
    if (top[0].laps != null && r.laps != null && r.laps < top[0].laps) {
      const down = top[0].laps - r.laps;
      return `+${down} lap${down > 1 ? "s" : ""}`;
    }
    return fmtGap(t - winMs) || null;
  };
  // P2 | P1 | P3 on wide screens, the winner first on a phone.
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return (
    <Chapter>
      <Eyebrow className="reveal justify-center">The podium</Eyebrow>
      <div className="cascade mt-14 flex flex-col items-center gap-12 sm:flex-row sm:items-end sm:justify-center sm:gap-6 lg:gap-14">
        {order.map((r) => {
          const i = r.position - 1;
          const team = teamOf(r);
          const win = i === 0;
          return (
            <div key={r.driverId} className={`flex flex-col items-center text-center ${win ? "order-first sm:order-none sm:mb-10" : ""}`} style={{ "--i": win ? 2 : i === 1 ? 1 : 0 }}>
              <div className="relative">
                <DriverAvatar name={r.name} photoUrl={r.photoUrl} color={team?.color || "#232833"} size={win ? 168 : 124} className="ring-4 ring-bg shadow-2xl shadow-black/40" />
                <span
                  className="absolute -bottom-2 left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full font-display text-xl font-black text-ink shadow-lg ring-4 ring-bg"
                  style={{ backgroundColor: MEDAL[i] }}
                >
                  {i + 1}
                </span>
              </div>
              <Link to={`/drivers/${r.driverId}`} className={`mt-7 flex items-center gap-2 font-display font-black uppercase tracking-tight text-dark transition hover:text-brand ${win ? "text-3xl sm:text-4xl" : "text-2xl"}`}>
                {r.name}
                <Flag code={countryFor(r.driverId, r.country)} w={win ? 22 : 18} h={win ? 16 : 13} />
              </Link>
              {team && <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={16} showName className="mt-2" nameClassName="text-sm text-light" />}
              <div className="mt-3 font-mono text-sm font-bold tabular-nums" style={{ color: MEDAL_TEXT[i] }}>
                {gapOf(r, i) || NO_VALUE}
                <span className="ml-3 text-light">{r.points > 0 ? `+${r.points} pts` : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Chapter>
  );
}

// --- 4. the championship ----------------------------------------------------

function ChampionshipChapter({ recap }) {
  const s = recap.standings;
  const { you, team } = recap;
  const moved = s.before ? s.before.position - s.after.position : null;
  const arm = useCallback((el) => {
    if (el) playStandingsReplay(el, { holdMs: 900 });
  }, []);
  const sentence = s.isLeader
    ? s.behind
      ? `${s.after.total} points, ${s.behind.gap} clear of ${s.behind.name}.`
      : `${s.after.total} points, out in front.`
    : s.leader
      ? `${s.after.total} points, ${s.leader.total - s.after.total} behind ${s.leader.name}${s.ahead && s.ahead.name !== s.leader.name ? ` and ${s.ahead.gap} behind ${s.ahead.name}` : ""}.`
      : `${s.after.total} points.`;
  return (
    <Chapter glow>
      <div className="reveal grid gap-12 lg:grid-cols-[1.1fr,1fr] lg:items-center">
        <div>
          <Eyebrow>{s.before ? "Championship, after this round" : "Championship, after the opener"}</Eyebrow>
          <div className="mt-4 flex items-end gap-5">
            {s.before && s.before.position !== s.after.position && (
              <span className="mb-4 font-display text-[clamp(2.5rem,7vw,5rem)] font-black leading-none tabular-nums text-light line-through decoration-[6px] decoration-light">
                P{s.before.position}
              </span>
            )}
            <Giant className="text-[clamp(6rem,20vw,15rem)]">P{s.after.position}</Giant>
          </div>
          <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {moved != null && <Delta value={moved} suffix={` place${Math.abs(moved) === 1 ? "" : "s"}`} className="text-xl" />}
            <span className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-light">of {s.fieldSize} drivers</span>
          </div>
          <p className="mt-6 max-w-xl font-display text-2xl font-extrabold uppercase tracking-tight text-medium sm:text-3xl">
            <CountUp end={s.after.total} /> points
            {you && you.points > 0 && !s.roundDropped && <Delta value={you.points} className="ml-3 text-lg" />}
          </p>
          <p className="mt-2 max-w-xl text-base text-light">{sentence}</p>
          {team?.after && (
            <div className="mt-8 flex items-center gap-3">
              <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={28} />
              <span className="text-base text-medium">
                <span className="font-display font-extrabold uppercase tracking-tight text-dark">{team.name}</span> P{team.after.position} in the Tier {team.tier} constructors
                {team.before && team.before.position !== team.after.position ? (
                  <>
                    , <Delta value={team.before.position - team.after.position} />
                  </>
                ) : null}
                , {team.after.total} pts.
              </span>
            </div>
          )}
        </div>
        <div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">Around you</div>
          <div ref={arm} className="mt-3 divide-y divide-border border-y border-border">
            {s.window.map((r) => {
              const mine = r.driverId === you?.driverId;
              const d = r.prevPosition != null ? r.prevPosition - r.position : null;
              return (
                <div key={r.driverId} data-replay-prev={r.prevPosition ?? ""} className="flex items-center gap-4 bg-bg py-4">
                  <span className={`w-10 font-display text-3xl font-black tabular-nums leading-none ${mine ? "text-dark" : "text-light"}`}>{r.position}</span>
                  <Link to={`/drivers/${r.driverId}`} className={`min-w-0 flex-1 truncate font-display text-xl font-extrabold uppercase tracking-tight transition hover:text-brand ${mine ? "text-dark" : "text-medium"}`} style={mine && r.team?.color ? { color: r.team.color } : undefined}>
                    {r.name}
                  </Link>
                  <span className="w-12 text-right font-mono text-xs font-bold tabular-nums text-light">{r.roundPoints > 0 ? `+${r.roundPoints}` : ""}</span>
                  <span className="w-14 text-right font-display text-2xl font-black tabular-nums text-dark">{r.total}</span>
                  <span className="w-8 text-right">{d != null && <Delta value={d} className="text-xs" />}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Chapter>
  );
}

// --- 5. the rating ----------------------------------------------------------

const RATING_PARTS = [
  { key: "exp", label: "EXP", name: "Experience" },
  { key: "pac", label: "PAC", name: "Pace" },
  { key: "rac", label: "RAC", name: "Racecraft" },
  { key: "aha", label: "AWA", name: "Awareness" },
];

function RatingChapter({ recap }) {
  const r = recap.rating;
  const card = recap.card;
  return (
    <Chapter>
      <div className="reveal grid gap-14 lg:grid-cols-[auto,1fr] lg:items-center lg:gap-24">
        {card && (
          <div className="flex justify-center lg:justify-start">
            <div className="scale-110 sm:scale-125">
              <RatingCard driver={card.driver} rating={card.rating} />
            </div>
          </div>
        )}
        <div>
          <Eyebrow>Live form, after this round</Eyebrow>
          {r?.after ? (
            <>
              <div className="mt-4 flex items-end gap-5">
                <Giant className="text-[clamp(6rem,18vw,13rem)]">{Math.round(r.after.overall)}</Giant>
                <span className="mb-4 flex flex-col gap-1">
                  {r.delta && <Delta value={r.delta.overall} decimals={1} className="text-2xl" />}
                  {r.rank != null && r.fieldSize != null && (
                    <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">
                      #{r.rank} of {r.fieldSize}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-10 grid grid-cols-2 gap-x-10 gap-y-8 sm:grid-cols-4 lg:grid-cols-2">
                {RATING_PARTS.map((p) => {
                  const v = r.after[p.key];
                  const d = r.delta ? r.delta[p.key] : null;
                  if (v == null) return null;
                  return (
                    <div key={p.key}>
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-4xl font-black tabular-nums leading-none text-dark">{Math.round(v)}</span>
                        {d != null && <Delta value={d} decimals={1} className="text-sm" />}
                      </div>
                      <div className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">
                        {p.label} <span className="ml-1 text-faint">{p.name}</span>
                      </div>
                      <div className="mt-2 h-px w-full bg-border">
                        <div className="bar-fill h-px bg-dark" style={{ "--w": `${Math.max(2, Math.min(100, v))}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-10 max-w-md text-sm leading-relaxed text-light">
                {r.provisional ? "Still provisional: a few more starts and it settles. " : ""}
                {card
                  ? card.rating.card?.source === "live"
                    ? "Your first season's card moves with this until the season ends."
                    : `The card keeps the numbers it got at the end of season ${card.rating.card?.fromSeasonNumber ?? ""}; this is the form behind it, round by round.`
                  : "The form behind your card, round by round."}
              </p>
            </>
          ) : (
            <p className="mt-4 text-base text-light">No live rating for this round yet.</p>
          )}
        </div>
      </div>
    </Chapter>
  );
}

// --- 6. the points ----------------------------------------------------------

function PointsChapter({ points: p }) {
  return (
    <Chapter glow>
      <div className="reveal flex flex-col items-center text-center">
        <Eyebrow>NABS Points, this round</Eyebrow>
        <div className="mt-8 flex items-center gap-6">
          <TokenIcon className="h-20 w-20 sm:h-28 sm:w-28" />
          <Giant className="text-[clamp(6rem,20vw,15rem)]">
            <CountUp end={p.earned} prefix="+" />
          </Giant>
        </div>
        <div className="mt-10 space-y-3">
          {p.entries.map((e, i) => (
            <div key={i} className="font-display text-xl font-extrabold uppercase tracking-tight text-medium sm:text-2xl">
              <span className="text-dark">+{e.delta}</span> {e.title}
            </div>
          ))}
          {p.pending && (
            <div className="font-display text-xl font-extrabold uppercase tracking-tight text-light sm:text-2xl">
              +{p.pending.delta} {p.pending.title}
              <span className="ml-3 font-mono text-[11px] tracking-[0.2em]">once the stewards are done</span>
            </div>
          )}
        </div>
        {p.rate > 1 && <p className="mt-6 text-sm text-light">Paid at ×{p.rate.toFixed(2)}: your Discord week counted.</p>}
        {p.balance != null && (
          <div className="mt-12 flex items-center gap-3 font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-light">
            Balance now
            <span className="flex items-center gap-1.5 font-display text-3xl font-black tabular-nums tracking-tight text-dark">
              <TokenIcon className="h-6 w-6" />
              <CountUp end={p.balance} />
            </span>
          </div>
        )}
      </div>
    </Chapter>
  );
}

// --- 7. the facts -----------------------------------------------------------

function FactsChapter({ race, results, quali }) {
  const { facts, dotd, dotdRow, hasDotd } = buildRaceFacts(race, results, quali);
  if (!hasDotd && !facts.length) return null;
  return (
    <Chapter className="min-h-0 py-10">
      <div className="reveal">
        <Eyebrow>The night in facts</Eyebrow>
        {hasDotd && (
          <div className="mt-8">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">{dotd.pickedBy ? `${dotd.pickedBy}’s Driver of the Day` : "Driver of the Day"}</div>
            <div className="mt-2 flex items-center gap-3">
              {dotdRow ? (
                <Link to={`/drivers/${dotdRow.driverId}`} className="font-display text-4xl font-black uppercase tracking-tight text-dark transition hover:text-brand sm:text-5xl">
                  {dotd.name || dotdRow.name}
                </Link>
              ) : (
                <span className="font-display text-4xl font-black uppercase tracking-tight text-dark sm:text-5xl">{dotd.name || NO_VALUE}</span>
              )}
              {dotdRow && <Flag code={countryFor(dotdRow.driverId, dotdRow.country)} w={24} h={18} />}
            </div>
          </div>
        )}
        <div className="cascade mt-10 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((f, i) => (
            <div key={f.key} style={{ "--i": i }}>
              <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">{f.label}</div>
              <div className="mt-2 flex items-center gap-2">
                {f.driverId ? (
                  <Link to={`/drivers/${f.driverId}`} className="font-display text-2xl font-black uppercase tracking-tight text-dark transition hover:text-brand">
                    {f.name}
                  </Link>
                ) : (
                  <span className="font-display text-2xl font-black uppercase tracking-tight text-dark">{f.name}</span>
                )}
                {f.country && <Flag code={f.country} w={18} h={13} />}
              </div>
              {f.value && <div className="mt-1 font-mono text-sm font-bold tabular-nums text-medium">{f.value}</div>}
            </div>
          ))}
        </div>
      </div>
    </Chapter>
  );
}
