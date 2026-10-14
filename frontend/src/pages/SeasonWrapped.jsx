// ---------------------------------------------------------------------------
// Season Wrapped: one driver's season, told as cards (backend
// services/seasonWrappedService.js has where every number comes from).
//
// The race recap's sibling: the same cards that rise in as you scroll and the
// same numbers that tick up once their card is in (components/storyMotion.jsx),
// but about a whole season, and public. It is made to be passed around, so the
// page reads about the driver rather than to them ("best result", not "your
// best result"), and the last card is the share row: the link, and the
// picture Discord shows under it (backend lib/sharePictures.js).
//
// Only a finished season has one: a Wrapped is the end of the story, and a
// season still being raced answers that it comes when the season is over. A
// card whose data the season does not have (no grid slots in the archive, no
// team-mate for a reserve, no win) is simply not there.
//
// The same season also plays as a story, full screen, slide by slide, with 3D
// (components/WrappedStory.jsx). It starts by itself the first time a Wrapped
// is opened in a visit; closing it leaves these cards, and the cover's Play
// button runs it again.
// ---------------------------------------------------------------------------
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Crown, Medal, Timer, Rocket, ShieldCheck, Flag as FlagIcon, Sparkles, Trophy, Share2, Download, Link as LinkIcon, Play } from "lucide-react";
import { api, withApiBase } from "../api/client.js";
import { useSeries, useSeriesPath } from "../context/SeriesContext.jsx";
import { useSpecificTitle, prettyTrack } from "../utils/pageTitle.js";
import { copyText } from "../utils/copyText.js";
import { useStoryReveal, Tween } from "../components/storyMotion.jsx";
import { DriverAvatar, ErrorBox, EmptyState, PageHeaderSkeleton, CardsSkeleton, MEDAL, MEDAL_TEXT } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";
import { fmtLap } from "../utils/format.js";
import { useBoxWidth } from "../hooks/useBoxWidth.js";

// The story (Spotify Wrapped style, with its 3D) loads only when it is played.
const WrappedStory = lazy(() => import("../components/WrappedStory.jsx"));

// A Wrapped opens as its story once per visit; after that, and with ?cards=1,
// the page opens on the cards and the story is a button away.
const STORY_SEEN = "nabs_wrapped_story_seen";
function storyDue(driverId) {
  try {
    const seen = JSON.parse(sessionStorage.getItem(STORY_SEEN) || "[]");
    if (seen.includes(driverId)) return false;
    sessionStorage.setItem(STORY_SEEN, JSON.stringify([...seen, driverId].slice(-50)));
    return true;
  } catch {
    return true;
  }
}

export default function SeasonWrapped() {
  // The series' own mark (an admin upload), for the story's corner.
  const { current: series } = useSeries();
  const { key } = useParams();
  const [params] = useSearchParams();
  const season = params.get("season");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [closed, setClosed] = useState(false);
  const [notFinished, setNotFinished] = useState(null);
  const [story, setStory] = useState(false);

  useEffect(() => {
    let gone = false;
    setData(null);
    setStory(false);
    setError(null);
    setClosed(false);
    setNotFinished(null);
    api
      .wrappedDriver(key, season)
      .then((d) => !gone && setData(d))
      .catch((e) => {
        if (gone) return;
        if (e.data?.closed) setClosed(true);
        else if (e.data?.notFinished) setNotFinished(e.data.season || {});
        else setError(e.message);
      });
    return () => {
      gone = true;
    };
  }, [key, season]);

  useEffect(() => {
    if (data && !data.empty && params.get("cards") !== "1" && storyDue(data.driver.id)) setStory(true);
    // Once per loaded Wrapped; the address's other parameters do not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useStoryReveal(data);
  useSpecificTitle(data?.driver ? `${data.driver.name}'s ${data.season.label} Wrapped` : "Season Wrapped");

  if (closed) {
    return <EmptyState title="Season Wrapped isn't open yet" hint="The league switches it on once it has been checked. Have a look again soon." />;
  }
  if (notFinished) {
    return (
      <EmptyState
        title={`${notFinished.label || "This season"} isn't over yet`}
        hint="Season Wrapped comes when the last round has been raced: every driver's season, told as a story."
      />
    );
  }
  if (error) return <ErrorBox message={error} />;
  if (!data) {
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeaderSkeleton />
        <CardsSkeleton count={4} cols="sm:grid-cols-2" />
      </div>
    );
  }
  if (data.empty) {
    return (
      <EmptyState
        title={`No ${data.season.label} to tell`}
        hint={`${data.driver.name} was on the roster but did not start a race that season.`}
      />
    );
  }

  const teamColor = data.driver.team?.color || "rgb(var(--c-brand))";
  return (
    <div className="mx-auto max-w-4xl space-y-5" style={{ "--wrap-team": teamColor }}>
      {story && (
        <Suspense fallback={<div className="fixed inset-0 z-overlay bg-black/90" aria-hidden="true" />}>
          <WrappedStory
            data={data}
            mine={!!data.mine}
            url={shareUrlOf(data)}
            logos={{ dark: series?.logoDarkUrl || "/logo-dark.png", light: "/logo-light.png" }}
            onClose={() => setStory(false)}
          />
        </Suspense>
      )}
      <Cover data={data} onPlay={() => setStory(true)} />
      {data.type && <TypeCard type={data.type} />}
      <NumbersCard data={data} />
      {(data.best || data.climb) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {data.best && <BestCard best={data.best} />}
          {data.climb && <ClimbCard climb={data.climb} />}
        </div>
      )}
      {data.championship.journey.length > 1 && <JourneyCard data={data} />}
      {data.wins.length > 0 && <WinsCard wins={data.wins} />}
      {data.teammates.filter((m) => m.races || m.qualiAhead || m.qualiBehind).map((m) => (
        <DuelCard key={m.driverId} title="Team-mate battle" other={m} me={data.driver} team={data.driver.team} />
      ))}
      {data.rival && !data.teammates.some((m) => m.driverId === data.rival.driverId) && <RivalCard rival={data.rival} me={data.driver} />}
      {data.honours.length > 0 && <HonoursCard honours={data.honours} />}
      <ShareCard data={data} />
    </div>
  );
}

// --- pieces -------------------------------------------------------------------

function Card({ children, className = "" }) {
  return <section className={`recap-reveal card p-5 sm:p-6 ${className}`}>{children}</section>;
}

function Label({ children, className = "" }) {
  return <div className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow ${className}`}>{children}</div>;
}

// The medal colour a place is written in (the text shades, readable in both
// themes; MEDAL itself is for filled marks).
const medalOf = (pos) => (pos >= 1 && pos <= 3 ? MEDAL_TEXT[pos - 1] : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- the cover ------------------------------------------------------------------

function Cover({ data, onPlay }) {
  const { driver, season, championship: c, stats } = data;
  const code = countryFor(driver.id, driver.country);
  return (
    <section className="recap-reveal card relative overflow-hidden p-6 sm:p-8">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{ background: "radial-gradient(120% 140% at 100% 0%, var(--wrap-team), transparent 60%)" }}
      />
      <div className="relative">
        <Label>
          {season.label} Wrapped
        </Label>
        <div className="mt-4 flex items-center gap-4 sm:gap-5">
          <DriverAvatar name={driver.name} photoUrl={driver.photoUrl} color={driver.team?.color || "#888"} size={84} className="shrink-0 text-2xl" />
          <div className="min-w-0">
            <h1 className="flex items-center gap-3 font-display text-3xl font-black uppercase leading-none tracking-tight text-dark sm:text-6xl">
              <span className="truncate">{driver.name}</span>
              {code && <Flag code={code} w={30} h={22} />}
            </h1>
            {driver.team && (
              <div className="mt-2">
                <TeamLogo
                  id={driver.team.id}
                  name={driver.team.name}
                  color={driver.team.color}
                  logoUrl={driver.team.logoUrl}
                  size={20}
                  showName
                  nameClassName="text-sm font-semibold text-medium"
                />
              </div>
            )}
          </div>
        </div>
        <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-5">
          {c.position != null && (
            <div>
              <div className="flex items-start font-display font-black leading-none tracking-tighter text-dark" style={{ color: medalOf(c.position) || undefined }}>
                <span className="mt-2 text-2xl opacity-60">P</span>
                <span className="text-7xl">
                  <Tween from={c.fieldSize} to={c.position} />
                </span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-light">
                of {c.fieldSize} drivers
              </div>
            </div>
          )}
          <Big value={c.points} label="points" />
          <Big value={stats.starts} label={stats.starts === 1 ? "start" : "starts"} />
          {stats.wins > 0 && <Big value={stats.wins} label={stats.wins === 1 ? "win" : "wins"} />}
        </div>
        <button type="button" onClick={onPlay} className="btn-primary mt-6 inline-flex items-center gap-2">
          <Play className="h-4 w-4" aria-hidden="true" />
          {data.mine ? "Play your season" : "Play the season"}
        </button>
      </div>
    </section>
  );
}

// The address a Wrapped is shared under (what the share buttons hand out).
function shareUrlOf(data) {
  const slug = data.series?.slug;
  const path = `${slug ? `/s/${slug}` : ""}/wrapped/${encodeURIComponent(data.driver.id)}`;
  return typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
}

function Big({ value, label, decimals = 0 }) {
  return (
    <div>
      <div className="font-display text-4xl font-black leading-none tracking-tight text-dark sm:text-5xl">
        <Tween to={value} decimals={decimals} />
      </div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-light">{label}</div>
    </div>
  );
}

// --- what kind of driver ------------------------------------------------------------

function TypeCard({ type }) {
  return (
    <Card>
      <Label>The season in one line</Label>
      <div className="recap-pop mt-3 flex items-center gap-3">
        <Sparkles className="h-7 w-7 shrink-0 text-brand" aria-hidden="true" />
        <div className="font-display text-3xl font-black uppercase leading-none tracking-tight text-dark sm:text-5xl">{type.title}</div>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-medium">{type.line}</p>
    </Card>
  );
}

// --- the numbers ----------------------------------------------------------------------

function NumbersCard({ data }) {
  const s = data.stats;
  const tiles = [
    { label: "Finishes", value: s.finishes, sub: s.starts ? `${Math.round((s.finishes / s.starts) * 100)}% of starts` : null },
    s.bestFinish != null && { label: "Best finish", value: s.bestFinish, prefix: "P" },
    s.avgFinish != null && { label: "Average finish", value: s.avgFinish, decimals: 1, prefix: "P" },
    s.podiums > 0 && { label: "Podiums", value: s.podiums },
    s.top10 > 0 && { label: "Top tens", value: s.top10 },
    s.poles > 0 && { label: "Poles", value: s.poles },
    s.fastestLaps > 0 && { label: "Fastest laps", value: s.fastestLaps },
    s.positionsGained > 0 && { label: "Places gained", value: s.positionsGained, sub: "grid to flag" },
    s.overtakes > 0 && { label: "Overtakes", value: s.overtakes },
    s.lapsLed > 0 && { label: "Laps led", value: s.lapsLed },
    s.sprintWins > 0 && { label: "Sprint wins", value: s.sprintWins },
    s.dotd > 0 && { label: "Driver of the Day", value: s.dotd },
  ].filter(Boolean);
  return (
    <Card>
      <Label>The season in numbers</Label>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-surface2/50 px-4 py-3">
            <div className="font-display text-3xl font-black leading-none tracking-tight text-dark">
              <Tween to={t.value} decimals={t.decimals || 0} prefix={t.prefix || ""} />
            </div>
            <div className="mt-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light">{t.label}</div>
            {t.sub && <div className="mt-0.5 text-xs text-light">{t.sub}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}

// --- the nights that stood out ------------------------------------------------------------

function RaceLine({ race }) {
  return (
    <div className="mt-2 text-sm text-medium">
      <span className="font-semibold text-dark">{prettyTrack(race.track)}</span>
      <span className="text-light"> · Round {race.round}</span>
      {race.sprint && <span className="ml-2 rounded-md bg-surface2 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-medium">Sprint</span>}
    </div>
  );
}

function BestCard({ best }) {
  const medal = medalOf(best.position);
  return (
    <Card>
      <Label>Best result</Label>
      <div className="recap-pop mt-3 flex items-start font-display font-black leading-none tracking-tighter text-dark" style={{ color: medal || undefined }}>
        <span className="mt-2 text-2xl opacity-60">P</span>
        <span className="text-7xl">{best.position}</span>
      </div>
      <RaceLine race={best} />
      <div className="mt-1 text-xs text-light">
        {best.grid ? `From P${best.grid} on the grid` : "Grid slot not on file"}
        {best.points ? ` · ${plural(best.points, "point")}` : ""}
      </div>
    </Card>
  );
}

function ClimbCard({ climb }) {
  return (
    <Card>
      <Label>Biggest climb</Label>
      <div className="recap-pop mt-3 font-display text-7xl font-black leading-none tracking-tighter text-ok">+{climb.gained}</div>
      <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-light">places, P{climb.grid} to P{climb.position}</div>
      <RaceLine race={climb} />
    </Card>
  );
}

function WinsCard({ wins }) {
  return (
    <Card>
      <Label>{wins.length === 1 ? "The win" : `${wins.length} wins`}</Label>
      <div className="mt-3 flex flex-wrap gap-2">
        {wins.map((w) => (
          <span key={w.raceId} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface2/50 px-3 py-2 text-sm">
            <Trophy className="h-4 w-4 shrink-0" style={{ color: MEDAL[0] }} aria-hidden="true" />
            <span className="font-semibold text-dark">{prettyTrack(w.track)}</span>
            <span className="font-mono text-[11px] text-light">
              R{w.round}
              {w.sprint ? " · sprint" : ""}
            </span>
          </span>
        ))}
      </div>
    </Card>
  );
}

// --- the championship, round by round -------------------------------------------------------

// A "nice" bottom for the position axis: P5, P10, P15, P20, P30 ...
function niceFloor(max) {
  for (const n of [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100]) if (max <= n) return n;
  return Math.ceil(max / 20) * 20;
}

function JourneyCard({ data }) {
  const c = data.championship;
  const last = c.journey[c.journey.length - 1];
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>The championship, round by round</Label>
        <span className="font-mono text-[11px] text-light">place in the table after each round</span>
      </div>
      <JourneyChart journey={c.journey} roundsRun={data.season.roundsRun} />
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-medium">
        {c.peak && (
          <span>
            Highest: <b className="text-dark">P{c.peak.position}</b> after Round {c.peak.round}
            {c.peak.track ? ` (${prettyTrack(c.peak.track)})` : ""}
          </span>
        )}
        {c.roundsLed > 0 && (
          <span>
            Led the table after <b className="text-dark">{plural(c.roundsLed, "round")}</b>
          </span>
        )}
        <span>
          Finished <b className="text-dark">P{last.position}</b> with {plural(last.points, "point")}
        </span>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-light transition hover:text-dark">Round by round as a table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-light">
              <th className="py-1.5 pr-3 font-bold">Round</th>
              <th className="py-1.5 pr-3 font-bold">Circuit</th>
              <th className="py-1.5 pr-3 text-right font-bold">Place</th>
              <th className="py-1.5 text-right font-bold">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {c.journey.map((j) => (
              <tr key={j.round}>
                <td className="py-1.5 pr-3 font-mono tabular-nums text-medium">R{j.round}</td>
                <td className="py-1.5 pr-3 text-dark">{prettyTrack(j.track || "")}</td>
                <td className="py-1.5 pr-3 text-right font-mono font-bold tabular-nums text-dark">P{j.position}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-medium">{j.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

// One line, the place in the table after every round, P1 at the top. Hover or
// focus a round for its place and points: a crosshair finds the round, so
// nobody has to land on a dot.
function JourneyChart({ journey, roundsRun }) {
  const [active, setActive] = useState(null);
  // Drawn at the card's own width, so the axis type stays its real size.
  const [boxRef, W] = useBoxWidth(720);
  const H = W < 480 ? 200 : 240;
  const PAD = { l: 40, r: 22, t: 22, b: 30 };
  const first = journey[0].round;
  const lastRound = Math.max(roundsRun || 0, journey[journey.length - 1].round);
  const bottom = niceFloor(Math.max(...journey.map((j) => j.position)));
  const x = (round) => PAD.l + ((round - first) / Math.max(1, lastRound - first)) * (W - PAD.l - PAD.r);
  const y = (pos) => PAD.t + ((pos - 1) / Math.max(1, bottom - 1)) * (H - PAD.t - PAD.b);
  const line = journey.map((j, i) => `${i ? "L" : "M"}${x(j.round).toFixed(1)} ${y(j.position).toFixed(1)}`).join(" ");
  const ticks = [1, ...[5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100].filter((t) => t <= bottom)];
  const peak = journey.reduce((b, j) => (!b || j.position < b.position ? j : b), null);
  const end = journey[journey.length - 1];
  const step = journey.length > 1 ? (x(journey[1].round) - x(journey[0].round)) : W;
  // Every round's label while they fit, every other one when they would touch.
  const labelEvery = step < 30 ? 2 : 1;
  const a = active != null ? journey[active] : null;
  // Tooltip position as a share of the box, so it follows the responsive SVG.
  const tipLeft = a ? (x(a.round) / W) * 100 : 0;
  const tipTop = a ? (y(a.position) / H) * 100 : 0;

  return (
    <div ref={boxRef} className="relative mt-3" onPointerLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label="Place in the championship after each round">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth="1" />
            <text x={PAD.l - 10} y={y(t) + 4} textAnchor="end" className="fill-faint font-mono text-[10px] font-bold">
              P{t}
            </text>
          </g>
        ))}
        {journey.map((j, i) =>
          i % labelEvery === 0 || i === journey.length - 1 ? (
            <text key={`x${j.round}`} x={x(j.round)} y={H - 9} textAnchor="middle" className="fill-light font-mono text-[10px] font-bold">
              R{j.round}
            </text>
          ) : null
        )}
        {a && <line x1={x(a.round)} x2={x(a.round)} y1={PAD.t - 8} y2={H - PAD.b} className="stroke-border" strokeWidth="1" />}
        <path d={line} fill="none" className="chart-line text-brand" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" pathLength="1" />
        {journey.map((j, i) => {
          const big = j === peak || j === end || i === active;
          return (
            <circle
              key={j.round}
              cx={x(j.round)}
              cy={y(j.position)}
              r={big ? 6 : 4}
              className="text-brand"
              fill="currentColor"
              stroke="var(--c-card)"
              strokeWidth="2"
            />
          );
        })}
        {peak !== end && (
          <text x={x(peak.round)} y={y(peak.position) - 12} textAnchor="middle" className="fill-dark font-mono text-[11px] font-bold">
            P{peak.position}
          </text>
        )}
        <text x={x(end.round)} y={y(end.position) - 12} textAnchor="middle" className="fill-dark font-mono text-[12px] font-bold">
          P{end.position}
        </text>
        {/* The hit areas: a full-height band per round, wider than any dot. */}
        {journey.map((j, i) => (
          <rect
            key={`hit${j.round}`}
            x={x(j.round) - Math.max(12, step / 2)}
            y={0}
            width={Math.max(24, step)}
            height={H}
            fill="transparent"
            tabIndex={0}
            role="img"
            aria-label={`After round ${j.round}${j.track ? `, ${prettyTrack(j.track)}` : ""}: P${j.position}, ${j.points} points`}
            onPointerEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="cursor-crosshair outline-none"
          />
        ))}
      </svg>
      {a && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
          style={{ left: `${tipLeft}%`, top: `calc(${tipTop}% - 12px)` }}
        >
          <div className="font-mono text-sm font-bold tabular-nums text-dark">
            P{a.position} <span className="font-normal text-light">· {plural(a.points, "pt")}</span>
          </div>
          <div className="text-[11px] text-light">
            After R{a.round}
            {a.track ? ` · ${prettyTrack(a.track)}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

// --- side by side -------------------------------------------------------------------------

// Two people over the races both of them finished: the count each way as one
// bar, the driver's own share in the team colour, the other's in grey, with a
// surface gap between the two.
function SplitBar({ left, right, leftLabel, rightLabel }) {
  const total = left + right;
  if (!total) return null;
  const pct = (left / total) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-xs">
        <span className="font-bold text-dark">
          {left} <span className="font-normal text-light">{leftLabel}</span>
        </span>
        <span className="font-bold text-dark">
          <span className="font-normal text-light">{rightLabel}</span> {right}
        </span>
      </div>
      <div className="mt-1.5 flex h-2.5 gap-[2px] overflow-hidden rounded-full">
        {/* The width rides on --w, the site's growing-bar convention (index.css):
            it sweeps out when the card comes in and stands still without motion. */}
        {left > 0 && <div className="bar-fill h-full shrink-0 rounded-l-full" style={{ "--w": `${pct}%`, background: "var(--wrap-team)" }} />}
        {right > 0 && <div className="h-full flex-1 rounded-r-full bg-surface2" />}
      </div>
    </div>
  );
}

function DuelCard({ title, other, me, team }) {
  const code = countryFor(other.driverId, other.country);
  const quali = other.qualiAhead + other.qualiBehind;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label>{title}</Label>
        {team && <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={18} showName nameClassName="text-xs font-semibold text-light" />}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="font-display text-lg font-black uppercase tracking-tight text-dark">{me.name}</span>
        <span className="font-mono text-xs text-light">vs</span>
        <DriverAvatar name={other.name} photoUrl={other.photoUrl} color={team?.color || "#888"} size={32} />
        <span className="font-display text-lg font-black uppercase tracking-tight text-dark">{other.name}</span>
        {code && <Flag code={code} w={20} h={15} />}
      </div>
      <div className="mt-4 space-y-4">
        {other.races > 0 && (
          <SplitBar left={other.ahead} right={other.behind} leftLabel="finished ahead" rightLabel="behind" />
        )}
        {quali > 0 && <SplitBar left={other.qualiAhead} right={other.qualiBehind} leftLabel="started ahead" rightLabel="behind" />}
        <div className="flex items-baseline justify-between border-t border-border pt-3 font-mono text-xs">
          <span className="text-light">Points</span>
          <span className="tabular-nums text-dark">
            <b>{other.myPoints}</b> <span className="text-light">to</span> <b>{other.points}</b>
          </span>
        </div>
      </div>
    </Card>
  );
}

function RivalCard({ rival, me }) {
  const code = countryFor(rival.driverId, rival.country);
  const ahead = rival.gap > 0;
  return (
    <Card>
      <Label>The rival</Label>
      <div className="mt-3 flex items-center gap-3">
        <DriverAvatar name={rival.name} photoUrl={rival.photoUrl} color={rival.team?.color || "#888"} size={44} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-xl font-black uppercase tracking-tight text-dark">{rival.name}</span>
            {code && <Flag code={code} w={20} h={15} />}
          </div>
          <div className="text-sm text-light">
            P{rival.position} in the table,{" "}
            {rival.gap === 0 ? "level on points" : `${plural(Math.abs(rival.gap), "point")} ${ahead ? "ahead of" : "behind"} ${me.name}`}
          </div>
        </div>
      </div>
      {rival.races > 0 && (
        <div className="mt-4">
          <SplitBar left={rival.ahead} right={rival.behind} leftLabel="finished ahead" rightLabel="behind" />
        </div>
      )}
    </Card>
  );
}

// --- what they won ------------------------------------------------------------------------

const HONOUR_ICONS = {
  champion: Crown,
  vice: Medal,
  third: Medal,
  team: Trophy,
  newcomer: Rocket,
  "fastest-lap": Timer,
  overtakes: Rocket,
  "laps-led": FlagIcon,
  cleanest: ShieldCheck,
  dotd: Sparkles,
};

function HonoursCard({ honours }) {
  return (
    <Card>
      <Label>Honours</Label>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {honours.map((h) => {
          const Icon = HONOUR_ICONS[h.key] || Trophy;
          const tint = h.key === "champion" ? MEDAL[0] : h.key === "vice" ? MEDAL[1] : h.key === "third" ? MEDAL[2] : null;
          return (
            <li key={h.key} className="flex items-start gap-3 rounded-xl border border-border bg-surface2/50 px-4 py-3">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" style={tint ? { color: tint } : undefined} aria-hidden="true" />
              <div className="min-w-0">
                <div className="font-semibold text-dark">{h.title}</div>
                {(h.detail || h.ms) && (
                  <div className="text-xs text-light">
                    {h.ms ? `${fmtLap(h.ms)}${h.detail ? ` at ${prettyTrack(h.detail)}` : ""}` : h.detail}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// --- passing it around --------------------------------------------------------------------

function ShareCard({ data }) {
  const { seriesPath } = useSeriesPath();
  const [msg, setMsg] = useState(null);
  const path = seriesPath(`/wrapped/${encodeURIComponent(data.driver.id)}`);
  const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  const picture = withApiBase(`/api/share/picture.jpg?path=${encodeURIComponent(path)}`);
  const title = `${data.driver.name}'s ${data.season.label} Wrapped`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function share() {
    setMsg(null);
    if (canShare) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        if (e?.name === "AbortError") return;
      }
    }
    setMsg((await copyText(url)) ? "Link copied." : url);
  }

  async function copy() {
    setMsg((await copyText(url)) ? "Link copied." : url);
  }

  return (
    <Card>
      <Label>Pass it on</Label>
      <p className="mt-2 text-sm leading-relaxed text-medium">
        The link shows this season's picture when it is posted in Discord or WhatsApp.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={share} className="btn-primary inline-flex items-center gap-2">
          <Share2 className="h-4 w-4" aria-hidden="true" />
          Share
        </button>
        {canShare && (
          <button type="button" onClick={copy} className="btn-secondary inline-flex items-center gap-2">
            <LinkIcon className="h-4 w-4" aria-hidden="true" />
            Copy link
          </button>
        )}
        <a href={picture} download={`${data.driver.name}-${data.season.label}-wrapped.jpg`} className="btn-secondary inline-flex items-center gap-2">
          <Download className="h-4 w-4" aria-hidden="true" />
          Save the picture
        </a>
      </div>
      {msg && (
        <p role="status" className="mt-3 break-all text-sm text-medium">
          {msg}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-sm font-semibold">
        <Link to={seriesPath(`/drivers/${encodeURIComponent(data.driver.id)}`)} className="text-brand hover:underline">
          {data.driver.name}'s driver page
        </Link>
        <Link to={seriesPath(`/wrapped?season=${data.season.number}`)} className="text-brand hover:underline">
          Every driver's {data.season.label} Wrapped
        </Link>
      </div>
    </Card>
  );
}
