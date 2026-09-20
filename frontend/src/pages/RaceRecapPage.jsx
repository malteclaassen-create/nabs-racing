// ---------------------------------------------------------------------------
// The race recap: the round told from your seat, as one long page.
//
// It is set like a broadcast graphic, not like the rest of the site: a flat
// page, hairlines instead of cards, numbered chapters, very large numerals
// with a mono word under each, and the team's colour used for exactly two
// things, the bar under the big number and the driver's own line on the
// lap chart. No gradients, no glows.
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
import { CountUp, DriverAvatar, MEDAL_TEXT, ErrorBox, PageHeaderSkeleton } from "../components/ui.jsx";
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

  // The page runs edge to edge, past the site's own gutters. The body is told
  // not to grow a sideways scrollbar over the few pixels a 100vw strip
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

  // Chapter numbers count only what is on the page.
  let n = 1;
  const num = () => String(n++).padStart(2, "0");

  return (
    <div className="recap-bleed-strip bg-bg" style={{ "--recap-team": you?.team?.color || "var(--c-text)" }}>
      <Opening recap={recap} preview={seat != null} index={num()} />
      {you && <YouChapter recap={recap} laps={laps} index={num()} />}
      <PodiumChapter results={results} index={num()} />
      {standings?.after && <ChampionshipChapter recap={recap} index={num()} />}
      {(rating?.after || card) && <RatingChapter recap={recap} index={num()} />}
      {showPoints && <PointsChapter points={points} index={num()} />}
      <FactsChapter race={race} results={results} quali={quali} index={num()} />
      <section className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-6 py-12 sm:px-12">
          <div>
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-light">End of recap</div>
            <div className="mt-2 font-display text-2xl font-black uppercase tracking-tight text-dark">{race.track}, round {race.number}</div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to={resultsLink} className="btn-secondary px-6 py-3 text-base">
              Full results
            </Link>
            <button type="button" onClick={leave} className="btn-primary px-6 py-3 text-base">
              {pending ? "Carry on" : "Done"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// --- the shared pieces --------------------------------------------------------

// A chapter: a hairline across the page, a numbered mono header, the content.
function Chapter({ index, title, meta, children }) {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 sm:px-12">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-5 font-mono text-[11px] font-bold uppercase tracking-[0.25em]">
          <div className="flex items-baseline gap-4">
            <span className="text-faint">{index}</span>
            <span className="text-dark">{title}</span>
          </div>
          {meta && <div className="text-light">{meta}</div>}
        </header>
        <div className="reveal pb-20 pt-6 sm:pb-28 sm:pt-10">{children}</div>
      </div>
    </section>
  );
}

// The plate: cells separated by hairlines, one border around the lot. Each
// cell brings its own top and left line and pulls itself a pixel up and left
// over the previous one, so no line is ever doubled and a last row that does
// not fill up leaves plain page behind it, not a slab of line colour.
function Plate({ children, className = "", style }) {
  return (
    <div className={`grid overflow-hidden border border-border ${className}`} style={style}>
      {children}
    </div>
  );
}
function Cell({ children, className = "", style }) {
  return (
    <div className={`-ml-px -mt-px border-l border-t border-border bg-bg ${className}`} style={style}>
      {children}
    </div>
  );
}

function Label({ children, className = "" }) {
  return <div className={`font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-light ${className}`}>{children}</div>;
}

// A giant numeral with the team's colour as a bar under it.
function Giant({ children, bar = true, className = "" }) {
  return (
    <div className={className}>
      <div className="recap-pop font-display font-black leading-[0.82] tracking-tighter text-dark">{children}</div>
      {bar && <div className="bar-fill mt-4 h-1.5 w-full max-w-[9rem]" style={{ "--w": "100%", background: "var(--recap-team)" }} />}
    </div>
  );
}

// A number and its word, for the data plates.
function Stat({ value, label, note, tone = "text-dark", className = "" }) {
  return (
    <Cell className={`p-5 sm:p-6 ${className}`}>
      <Label>{label}</Label>
      <div className={`mt-3 break-words font-display text-2xl font-black tabular-nums leading-none tracking-tight sm:text-3xl ${tone}`}>{value ?? NO_VALUE}</div>
      {note && <div className="mt-2 font-mono text-[11px] text-faint">{note}</div>}
    </Cell>
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
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// --- 01 the round -----------------------------------------------------------

function Opening({ recap, preview, index }) {
  const { race, results, you } = recap;
  const flag = flagFor(race.track, race.country);
  const photo = heroFor({ number: race.seasonNumber, heroImageUrl: race.heroImageUrl });
  const img = useParallax(0.1);
  const finished = results.filter((r) => r.status === "FINISHED" && r.position != null).sort((a, b) => a.position - b.position);
  const winner = finished[0] || null;
  const fastest = results.filter((r) => r.bestLapMs != null).sort((a, b) => a.bestLapMs - b.bestLapMs)[0] || null;
  const pole = results.find((r) => r.grid === 1) || null;
  const line = !you
    ? null
    : !you.raced
      ? "You sat this one out."
      : !you.finished
        ? `${you.status} for you${you.grid != null ? `, from P${you.grid} on the grid` : ""}.`
        : you.gained > 0
          ? `You finished P${you.position}, up ${you.gained} from P${you.grid} on the grid.`
          : you.gained < 0
            ? `You finished P${you.position}, down ${-you.gained} from P${you.grid} on the grid.`
            : `You finished P${you.position}${you.grid != null ? ", where you started" : ""}.`;
  return (
    <section>
      {/* The photo, edge to edge, with nothing drawn over it but a corner label. */}
      <div className="relative h-[52svh] min-h-[300px] w-full overflow-hidden border-b border-border">
        <img ref={img} src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-ink/20" />
        <div className="absolute left-6 top-6 flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-white sm:left-12 sm:top-8">
          <span className="text-white/60">{index}</span>
          <span>Race recap</span>
          {preview && <span className="border border-white/50 px-2 py-0.5 text-[10px]">preview</span>}
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-6 sm:px-12">
        <div className="grid gap-10 py-10 lg:grid-cols-[1.35fr,1fr] lg:gap-16 lg:py-14">
          <div className="min-w-0">
            <div className="hero-anim flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[12px] font-bold uppercase tracking-[0.25em] text-eyebrow" style={{ animationDelay: "0.05s" }}>
              {[race.seriesName, race.seasonNumber != null ? `Season ${race.seasonNumber}` : null, race.number != null ? `Round ${race.number}` : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <h1 className="hero-anim mt-5 flex flex-wrap items-end gap-x-6 gap-y-3 font-display text-[clamp(3.25rem,10vw,9rem)] font-black uppercase leading-[0.85] tracking-tighter text-dark" style={{ animationDelay: "0.15s" }}>
              <span className="min-w-0 break-words">{race.track}</span>
              {flag && <Flag code={flag.country} w={56} h={42} className="mb-3 rounded-[3px]" />}
            </h1>
            {line && (
              <p className="hero-anim mt-8 max-w-2xl font-display text-2xl font-extrabold uppercase leading-tight tracking-tight text-medium sm:text-3xl" style={{ animationDelay: "0.3s" }}>
                {line}
              </p>
            )}
          </div>
          {/* The plate: the round's own numbers and the circuit, as a data card. */}
          <Plate className="hero-anim grid-cols-2" style={{ animationDelay: "0.25s" }}>
            <Cell className="col-span-2 flex items-center justify-center p-6">
              <CircuitMap track={race.track} animate className="h-36 w-full text-dark sm:h-44" strokeWidth={2.2} />
            </Cell>
            <Stat label="Date" value={race.date ? fmtRaceDateFull(race.date).replace(/^\w+,\s*/, "").replace(/\s\d{4}$/, "") : NO_VALUE} note={race.date ? new Date(race.date).getFullYear() : null} />
            <Stat label="Distance" value={race.raceLaps ? plural(race.raceLaps, "lap", "laps") : NO_VALUE} />
            <Stat label="Classified" value={`${race.finishers} of ${race.fieldSize}`} />
            <Stat label="Winner" value={winner?.name || NO_VALUE} />
            <Stat label="Pole" value={pole?.name || NO_VALUE} note={pole?.qualiTimeMs ? fmtLap(pole.qualiTimeMs) : null} />
            <Stat label="Fastest lap" value={fastest?.name || NO_VALUE} note={fastest ? fmtLap(fastest.bestLapMs) : null} />
          </Plate>
        </div>
      </div>
    </section>
  );
}

// --- 02 your race -----------------------------------------------------------

function YouChapter({ recap, laps, index }) {
  const y = recap.you;
  const photo = recap.card?.driver?.photoUrl || recap.results.find((r) => r.driverId === y.driverId)?.photoUrl || null;
  const fastest = y.finished && y.bestLapMs != null && y.lapGapMs === 0;
  const stats = [
    y.grid != null ? { label: "Grid", value: `P${y.grid}` } : null,
    y.finished && y.rawPosition != null && y.rawPosition !== y.position ? { label: "At the line", value: `P${y.rawPosition}`, note: "before penalties" } : null,
    { label: "Points", value: y.points > 0 ? `+${y.points}` : "0", tone: y.points > 0 ? "text-dark" : "text-light", note: y.fastestLapBonus > 0 ? `incl. ${y.fastestLapBonus} fastest lap` : recap.standings?.roundDropped ? "dropped round" : null },
    y.sprint ? { label: "Sprint", value: y.sprint.position != null ? `P${y.sprint.position}` : y.sprint.status, note: y.sprint.points > 0 ? `+${y.sprint.points} pts` : null } : null,
    fmtLap(y.bestLapMs) ? { label: "Best lap", value: fmtLap(y.bestLapMs), tone: fastest ? "text-fl" : "text-dark", note: fastest ? "fastest of the race" : y.lapGapMs != null ? `${fmtLapDelta(y.lapGapMs)} to fastest` : null } : null,
    y.laps != null ? { label: "Laps", value: String(y.laps) } : null,
    y.lapsLed != null ? { label: "Laps led", value: String(y.lapsLed) } : null,
    y.overtakes != null ? { label: "Overtakes", value: String(y.overtakes), note: "estimated" } : null,
    y.contacts != null ? { label: "Car contacts", value: String(y.contacts) } : null,
    y.consistencyPct > 0 ? { label: "Consistency", value: `${y.consistencyPct.toFixed(1)}%` } : null,
    y.raced
      ? y.penaltySeconds > 0
        ? { label: "Penalties", value: `+${y.penaltySeconds}s`, tone: "text-bad", note: "stewards" }
        : y.cleanRace
          ? { label: "Penalties", value: "None", tone: "text-ok", note: "clean race" }
          : y.gamePenalties > 0
            ? { label: "Penalties", value: String(y.gamePenalties), note: "in-game" }
            : null
      : null,
  ].filter(Boolean);
  const headline = !y.raced
    ? "Did not start"
    : !y.finished
      ? y.status === "DNF"
        ? "Did not finish"
        : y.status === "DSQ"
          ? "Disqualified"
          : y.status
      : y.position === 1
        ? "Race winner"
        : y.position <= 3
          ? "On the podium"
          : y.gained > 0
            ? `Up ${y.gained} from the grid`
            : y.gained < 0
              ? `Down ${-y.gained} from the grid`
              : "Held position";
  return (
    <Chapter index={index} title="Your race" meta={`${y.name}${y.team ? ` · ${y.team.name}` : ""}`}>
      <div className="grid gap-10 lg:grid-cols-[auto,1fr] lg:items-end lg:gap-16">
        <Giant className="text-[clamp(7rem,22vw,17rem)]">{y.finished ? `P${y.position}` : y.raced ? y.status : "DNS"}</Giant>
        <div className="flex items-center gap-4 lg:pb-6">
          <DriverAvatar name={y.name} photoUrl={photo} color={y.team?.color || "#232833"} size={64} />
          <div className="min-w-0">
            <div className="font-display text-2xl font-black uppercase tracking-tight sm:text-3xl" style={{ color: y.finished && y.position <= 3 ? MEDAL_TEXT[y.position - 1] : "var(--c-text)" }}>
              {headline}
            </div>
            <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">
              {y.finished ? `of ${y.fieldSize} classified` : y.grid != null ? `from P${y.grid} on the grid` : ""}
            </div>
          </div>
        </div>
      </div>
      <Plate className="mt-12 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Stat key={s.label} {...s} />
        ))}
      </Plate>
      {laps && <RaceTrace laps={laps} driverId={y.driverId} />}
    </Chapter>
  );
}

// The driver's position lap by lap, drawn over the rest of the field on a
// timing-screen grid. The line draws itself when it scrolls into view.
function RaceTrace({ laps, driverId }) {
  const W = 1000;
  const H = 300;
  const PAD = { l: 44, r: 64, t: 18, b: 30 };
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
  const posStep = maxPos > 24 ? 10 : maxPos > 10 ? 5 : 1;
  const posLines = [1, ...Array.from({ length: Math.floor(maxPos / posStep) }, (_, i) => (i + 1) * posStep)].filter((v, i, a) => a.indexOf(v) === i && v <= maxPos);
  const lapStep = maxLap > 40 ? 10 : maxLap > 15 ? 5 : 1;
  // Ticks keep clear of the two end labels.
  const lapTicks = Array.from({ length: Math.floor(maxLap / lapStep) }, (_, i) => (i + 1) * lapStep).filter(
    (l) => l > maxLap * 0.06 && l < maxLap * 0.93
  );
  return (
    <div className="reveal-chart mt-12 border-t border-border pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Lap by lap · position at the line</Label>
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
        <text x={PAD.l} y={H - 8} textAnchor="start" className="fill-light font-mono text-[10px] font-bold uppercase tracking-widest">
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
        <circle cx={x(last.lap)} cy={y(last.position)} r="7" fill="var(--recap-team)" className="stroke-bg" strokeWidth="3" />
        <text x={x(last.lap) + 12} y={y(last.position) + 5} className="fill-dark font-display text-[16px] font-black">
          P{last.position}
        </text>
      </svg>
    </div>
  );
}

// --- 03 the podium ----------------------------------------------------------

function PodiumChapter({ results, index }) {
  const finished = results.filter((r) => r.status === "FINISHED" && r.position != null).sort((a, b) => a.position - b.position);
  const top = finished.slice(0, 3);
  if (!top.length) return null;
  const adj = (r) => (r.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);
  const winMs = adj(top[0]);
  const gapOf = (r, i) => {
    if (i === 0) return null;
    const t = adj(r);
    if (!t || !winMs) return null;
    if (top[0].laps != null && r.laps != null && r.laps < top[0].laps) {
      const down = top[0].laps - r.laps;
      return `+${down} lap${down > 1 ? "s" : ""}`;
    }
    return fmtGap(t - winMs) || null;
  };
  // 2 | 1 | 3 across, the winner first on a phone.
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return (
    <Chapter index={index} title="The podium" meta={`${finished.length} classified`}>
      <Plate className="sm:grid-cols-3">
        {order.map((r) => {
          const i = r.position - 1;
          const team = teamOf(r);
          const win = i === 0;
          return (
            <Cell key={r.driverId} className={`flex flex-col p-6 sm:p-8 ${win ? "order-first sm:order-none" : ""}`}>
              <div className="flex items-baseline justify-between">
                <span className="font-display text-6xl font-black leading-none tabular-nums" style={{ color: MEDAL_TEXT[i] }}>
                  {i + 1}
                </span>
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">{win ? "Winner" : gapOf(r, i) || ""}</span>
              </div>
              <div className={`mt-8 flex flex-col items-center text-center ${win ? "sm:mt-6" : "sm:mt-12"}`}>
                <DriverAvatar name={r.name} photoUrl={r.photoUrl} color={team?.color || "#232833"} size={win ? 160 : 112} />
                <Link to={`/drivers/${r.driverId}`} className={`mt-6 flex items-center gap-2 font-display font-black uppercase tracking-tight text-dark transition hover:text-brand ${win ? "text-3xl" : "text-2xl"}`}>
                  {r.name}
                  <Flag code={countryFor(r.driverId, r.country)} w={win ? 22 : 18} h={win ? 16 : 13} />
                </Link>
                {team && <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={16} showName className="mt-2" nameClassName="text-sm text-light" />}
              </div>
              <div className="mt-auto flex items-baseline justify-between border-t border-border pt-4">
                <Label>Points</Label>
                <span className="font-display text-2xl font-black tabular-nums text-dark">{r.points > 0 ? `+${r.points}` : "0"}</span>
              </div>
            </Cell>
          );
        })}
      </Plate>
    </Chapter>
  );
}

// --- 04 the championship ----------------------------------------------------

function ChampionshipChapter({ recap, index }) {
  const s = recap.standings;
  const { you, team } = recap;
  const moved = s.before ? s.before.position - s.after.position : null;
  const arm = useCallback((el) => {
    if (el) playStandingsReplay(el, { holdMs: 900 });
  }, []);
  const gaps = [
    s.isLeader
      ? { label: "Lead", value: s.behind ? `${s.behind.gap} pts` : NO_VALUE, note: s.behind ? `over ${s.behind.name}` : null }
      : s.leader
        ? { label: "To the leader", value: `−${s.leader.total - s.after.total}`, note: s.leader.name }
        : null,
    !s.isLeader && s.ahead ? { label: "To the car ahead", value: `−${s.ahead.gap}`, note: s.ahead.name } : null,
    !s.isLeader && s.behind ? { label: "Over the car behind", value: `+${s.behind.gap}`, note: s.behind.name } : null,
    team?.after
      ? { label: `${team.name} · T${team.tier} constructors`, value: `P${team.after.position}`, note: `${team.after.total} pts${team.before && team.before.position !== team.after.position ? ` · ${team.before.position - team.after.position > 0 ? "up" : "down"} ${Math.abs(team.before.position - team.after.position)}` : ""}` }
      : null,
  ].filter(Boolean);
  return (
    <Chapter index={index} title="Championship" meta={s.before ? "after this round" : "after the season opener"}>
      <div className="grid gap-12 lg:grid-cols-[1fr,1.1fr] lg:gap-16">
        <div>
          <div className="flex items-end gap-6">
            {s.before && s.before.position !== s.after.position && (
              <div className="mb-3">
                <Label>Was</Label>
                <div className="mt-1 font-display text-[clamp(2.5rem,7vw,5rem)] font-black leading-none tabular-nums text-light line-through decoration-[5px]">P{s.before.position}</div>
              </div>
            )}
            <Giant className="text-[clamp(6rem,18vw,14rem)]">P{s.after.position}</Giant>
          </div>
          <div className="mt-6 flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <span className="font-display text-4xl font-black tabular-nums tracking-tight text-dark">
              <CountUp end={s.after.total} />
              <span className="ml-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">pts</span>
            </span>
            {you && you.points > 0 && !s.roundDropped && <Delta value={you.points} className="text-lg" />}
            {moved != null && <Delta value={moved} suffix={` place${Math.abs(moved) === 1 ? "" : "s"}`} className="text-lg" />}
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">of {s.fieldSize}</span>
          </div>
          <Plate className="mt-10 grid-cols-2">
            {gaps.map((g) => (
              <Stat key={g.label} {...g} />
            ))}
          </Plate>
        </div>
        <div>
          <div className="flex items-baseline justify-between border-b border-border pb-3">
            <Label>Around you</Label>
            <Label>Round · Total</Label>
          </div>
          <div ref={arm} className="divide-y divide-border">
            {s.window.map((r) => {
              const mine = r.driverId === you?.driverId;
              const d = r.prevPosition != null ? r.prevPosition - r.position : null;
              return (
                <div key={r.driverId} data-replay-prev={r.prevPosition ?? ""} className="flex items-center gap-3 bg-bg py-4 sm:gap-4">
                  <span className={`w-9 font-display text-3xl font-black tabular-nums leading-none sm:w-12 ${mine ? "text-dark" : "text-light"}`}>{r.position}</span>
                  {mine && <span className="h-8 w-1 shrink-0" style={{ background: "var(--recap-team)" }} />}
                  <Link to={`/drivers/${r.driverId}`} className={`min-w-0 flex-1 truncate font-display text-lg font-extrabold uppercase tracking-tight transition hover:text-brand sm:text-xl ${mine ? "text-dark" : "text-medium"}`}>
                    {r.name}
                  </Link>
                  <span className="hidden items-center gap-3 sm:flex">
                    <Flag code={countryFor(r.driverId, r.country)} w={16} h={12} />
                    {r.team && <TeamLogo id={r.team.id} name={r.team.name} color={r.team.color} logoUrl={r.team.logoUrl} size={16} />}
                  </span>
                  <span className="w-10 text-right font-mono text-xs font-bold tabular-nums text-light sm:w-12">{r.roundPoints > 0 ? `+${r.roundPoints}` : ""}</span>
                  <span className="w-12 text-right font-display text-2xl font-black tabular-nums text-dark sm:w-14">{r.total}</span>
                  <span className="w-8 text-right sm:w-9">{d != null && <Delta value={d} className="text-xs" />}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Chapter>
  );
}

// --- 05 the rating ----------------------------------------------------------

const RATING_PARTS = [
  { key: "exp", label: "EXP", name: "Experience" },
  { key: "pac", label: "PAC", name: "Pace" },
  { key: "rac", label: "RAC", name: "Racecraft" },
  { key: "aha", label: "AWA", name: "Awareness" },
];

function RatingChapter({ recap, index }) {
  const r = recap.rating;
  const card = recap.card;
  return (
    <Chapter index={index} title="Rating" meta="live form after this round">
      <div className="grid gap-12 lg:grid-cols-[auto,1fr] lg:items-start lg:gap-20">
        {card && (
          <div className="flex flex-col items-center gap-4 lg:items-start">
            <RatingCard driver={card.driver} rating={card.rating} />
            <p className="max-w-[16rem] text-center font-mono text-[11px] leading-relaxed text-light lg:text-left">
              {card.rating.card?.source === "live"
                ? "First season: the card moves with the form until the season ends."
                : `The card keeps its numbers all season, set at the end of season ${card.rating.card?.fromSeasonNumber ?? ""}.`}
            </p>
          </div>
        )}
        <div>
          {r?.after ? (
            <>
              <div className="flex items-end gap-6">
                <Giant className="text-[clamp(6rem,16vw,12rem)]">{Math.round(r.after.overall)}</Giant>
                <div className="mb-3">
                  {r.delta && (
                    <div>
                      <Label>This round</Label>
                      <Delta value={r.delta.overall} decimals={1} className="text-3xl" />
                    </div>
                  )}
                  {r.rank != null && r.fieldSize != null && (
                    <div className="mt-3">
                      <Label>Field</Label>
                      <div className="font-display text-2xl font-black tabular-nums text-dark">
                        #{r.rank} <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">of {r.fieldSize}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <Plate className="mt-10 grid-cols-2 sm:grid-cols-4">
                {RATING_PARTS.map((p) => {
                  const v = r.after[p.key];
                  const d = r.delta ? r.delta[p.key] : null;
                  if (v == null) return null;
                  return (
                    <Cell key={p.key} className="p-5 sm:p-6">
                      <Label>
                        {p.label} <span className="ml-1 text-faint">{p.name}</span>
                      </Label>
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="font-display text-4xl font-black tabular-nums leading-none text-dark">{Math.round(v)}</span>
                        {d != null && <Delta value={d} decimals={1} className="text-sm" />}
                      </div>
                      <div className="mt-4 h-1 w-full bg-border">
                        <div className="bar-fill h-1 bg-dark" style={{ "--w": `${Math.max(2, Math.min(100, v))}%` }} />
                      </div>
                    </Cell>
                  );
                })}
              </Plate>
              {r.provisional && <p className="mt-4 font-mono text-[11px] text-light">Still provisional: a few more starts and it settles.</p>}
            </>
          ) : (
            <p className="text-base text-light">No live rating for this round yet.</p>
          )}
        </div>
      </div>
    </Chapter>
  );
}

// --- 06 the points ----------------------------------------------------------

function PointsChapter({ points: p, index }) {
  return (
    <Chapter index={index} title="NABS Points" meta={p.rate > 1 ? `paid at ×${p.rate.toFixed(2)}` : "this round"}>
      <div className="grid gap-12 lg:grid-cols-[auto,1fr] lg:items-end lg:gap-20">
        <div className="flex items-end gap-6">
          <TokenIcon className="mb-3 h-16 w-16 sm:h-24 sm:w-24" />
          <Giant className="text-[clamp(6rem,18vw,14rem)]">
            <CountUp end={p.earned} prefix="+" />
          </Giant>
        </div>
        <div>
          <div className="divide-y divide-border border-y border-border">
            {p.entries.map((e, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 py-4">
                <span className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{e.title}</span>
                <span className="font-display text-2xl font-black tabular-nums text-dark">+{e.delta}</span>
              </div>
            ))}
            {p.pending && (
              <div className="flex items-baseline justify-between gap-4 py-4">
                <span className="font-display text-lg font-extrabold uppercase tracking-tight text-light">
                  {p.pending.title}
                  <span className="ml-3 font-mono text-[10px] tracking-[0.2em]">once the stewards are done</span>
                </span>
                <span className="font-display text-2xl font-black tabular-nums text-light">+{p.pending.delta}</span>
              </div>
            )}
            {p.balance != null && (
              <div className="flex items-baseline justify-between gap-4 py-4">
                <Label>Balance now</Label>
                <span className="flex items-center gap-2 font-display text-2xl font-black tabular-nums text-dark">
                  <TokenIcon className="h-5 w-5" />
                  <CountUp end={p.balance} />
                </span>
              </div>
            )}
          </div>
          {p.rate > 1 && <p className="mt-4 font-mono text-[11px] text-light">Your Discord week counted: every race point paid at ×{p.rate.toFixed(2)}.</p>}
        </div>
      </div>
    </Chapter>
  );
}

// --- 07 the facts -----------------------------------------------------------

function FactsChapter({ race, results, quali, index }) {
  const { facts, dotd, dotdRow, hasDotd } = buildRaceFacts(race, results, quali);
  if (!hasDotd && !facts.length) return null;
  const cells = [
    hasDotd
      ? {
          key: "dotd",
          label: dotd.pickedBy ? `${dotd.pickedBy}’s Driver of the Day` : "Driver of the Day",
          driverId: dotdRow?.driverId || null,
          name: dotd.name || dotdRow?.name || NO_VALUE,
          country: dotdRow ? countryFor(dotdRow.driverId, dotdRow.country) : null,
          value: dotdRow ? [dotdRow.position != null ? `P${dotdRow.position}` : null, teamOf(dotdRow)?.name].filter(Boolean).join(" · ") : null,
        }
      : null,
    ...facts,
  ].filter(Boolean);
  return (
    <Chapter index={index} title="The night in facts" meta={`${race.track} · round ${race.number}`}>
      <Plate className="sm:grid-cols-2 lg:grid-cols-3">
        {cells.map((f) => (
          <Cell key={f.key} className="p-6">
            <Label>{f.label}</Label>
            <div className="mt-3 flex items-center gap-2">
              {f.driverId ? (
                <Link to={`/drivers/${f.driverId}`} className="truncate font-display text-2xl font-black uppercase tracking-tight text-dark transition hover:text-brand">
                  {f.name}
                </Link>
              ) : (
                <span className="truncate font-display text-2xl font-black uppercase tracking-tight text-dark">{f.name}</span>
              )}
              {f.country && <Flag code={f.country} w={18} h={13} />}
            </div>
            {f.value && <div className="mt-2 font-mono text-sm font-bold tabular-nums text-medium">{f.value}</div>}
          </Cell>
        ))}
      </Plate>
    </Chapter>
  );
}
