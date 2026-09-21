// ---------------------------------------------------------------------------
// /career/<handle> — one person, everything they have ever done here.
//
// The driver pages belong to a season of a league. This one belongs to nobody:
// every league the person races in lines up on the same page, the totals add
// all of it together, and the sections underneath break it down by season, by
// circuit, by team, by team-mate and race by race.
//
// Everything comes from GET /api/career/<key> in one go, so the page renders
// top to bottom with no second wait. Sections with nothing in them (a rookie
// with no titles, an archive season with no telemetry) simply drop out.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { motionOff } from "../hooks/motion.js";
import {
  CountUp, DriverAvatar, ErrorBox, PageHeaderSkeleton, TableSkeleton, MEDAL, MEDAL_TEXT, NoData,
} from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
import { fmtLap, fmtStamp, NO_VALUE } from "../utils/format.js";
import {
  Trophy, Medal, Flag as FlagIcon, Gauge, Timer, Activity, ArrowLeftRight, Crown,
  ListOrdered, ChevronDown, Star, TrendingUp, ShieldAlert, Route as RouteIcon,
} from "lucide-react";

const pos = (n) => (n == null ? NO_VALUE : `P${n}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "S2, S3" for one league, "F1 Friday S2, S3 · Sunday GT S1" for several.
function seasonSpell(seasons, named) {
  const byLeague = new Map();
  for (const s of seasons) {
    if (!byLeague.has(s.seriesName)) byLeague.set(s.seriesName, []);
    byLeague.get(s.seriesName).push(s.seasonNumber);
  }
  return [...byLeague.entries()]
    .map(([name, nums]) => `${named ? `${name} ` : ""}${nums.sort((a, b) => a - b).map((n) => `S${n}`).join(", ")}`)
    .join(" · ");
}

// --- small building blocks --------------------------------------------------

function Section({ id, eyebrow, title, right, children }) {
  return (
    <section id={id} className="scroll-mt-[9rem]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow sm:text-[11px] sm:tracking-[0.2em]">
            {eyebrow}
          </div>
          <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight text-dark sm:text-2xl">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// A framed grid of hairline-ruled numbers, the same look the driver page uses.
function StatFrame({ tiles, cols = "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" }) {
  const defs = tiles.filter((t) => t && t.value !== null && t.value !== undefined);
  if (!defs.length) return null;
  return (
    <div className={`grid overflow-hidden rounded-xl border border-border bg-card ${cols}`}>
      {defs.map((t) => (
        <div key={t.label} className="-ml-px -mt-px border-l border-t border-border p-4">
          <div className="flex items-center gap-2 text-light">
            {t.icon}
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider">{t.label}</span>
          </div>
          <div
            className="mt-2 font-display text-3xl font-black leading-none tabular-nums text-dark"
            style={t.accent ? { color: t.accent } : undefined}
          >
            {typeof t.value === "number" ? <CountUp end={t.value} /> : t.value}
          </div>
          {t.sub && <div className="mt-1.5 text-xs font-medium text-light">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// The numbers that are worth having but not worth shouting: label on the left,
// value on the right, hairline between them. Six big tiles say what a career
// is; another ten big tiles say nothing at all.
function StatList({ groups }) {
  const rows = groups.flatMap((g) => g.rows).filter((r) => r && r.value !== null && r.value !== undefined);
  if (!rows.length) return null;
  return (
    <div className="grid gap-x-8 rounded-xl border border-border bg-card px-5 py-1.5 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-border/70 py-2.5 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+3)]:border-b-0">
          <span className="text-sm text-light">{r.label}</span>
          <span className="font-display text-base font-extrabold tabular-nums text-dark" style={r.accent ? { color: r.accent } : undefined}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

const ICON = "h-4 w-4";

// --- hero -------------------------------------------------------------------

function Hero({ person, span }) {
  const seats = person.current || [];
  // A real hex, not a css variable: the avatar works out its own readable ink
  // from this value, and it cannot do that with var(...). The current team's
  // colour if there is one, a neutral slate otherwise.
  const accent = seats[0]?.teamColor || "#64748b";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ background: "radial-gradient(120% 140% at 85% 0%, rgb(var(--c-brand)), transparent 55%)" }} />
      <div className="relative flex flex-wrap items-center gap-4 p-5 sm:gap-7 sm:p-8">
        <DriverAvatar
          name={person.name}
          photoUrl={person.photoUrl}
          fallbacks={person.photoFallbacks}
          color={accent}
          size={88}
          className="text-4xl"
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow sm:text-[11px] sm:tracking-[0.2em]">
            Career record
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Flag code={person.country} w={30} h={22} />
            <h1 className="font-display text-[28px] font-black uppercase leading-none tracking-tight text-dark sm:text-5xl">
              {person.name}
            </h1>
            {person.number != null && (
              <span className="font-display text-2xl font-black tabular-nums text-light sm:text-3xl">#{person.number}</span>
            )}
          </div>
          {person.formerName && (
            <div className="mt-1 text-xs font-medium text-light">raced as {person.formerName}</div>
          )}
          {/* The span, and nothing the numbers underneath already say. */}
          <div className="mt-3 text-sm text-medium">
            {span.firstSeason != null && (
              <>
                Season {span.firstSeason}
                {span.lastSeason !== span.firstSeason ? ` to ${span.lastSeason}` : ""} ·{" "}
              </>
            )}
            {plural(span.seasonsRaced, "season")} raced
            {span.leagues > 1 ? ` · ${plural(span.leagues, "league")}` : ""}
          </div>
          {seats.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {seats.map((s) => (
                <Link
                  key={s.seriesSlug}
                  to={`/s/${s.seriesSlug}/drivers/${s.handle || s.driverId}`}
                  className="group inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface2 px-3 py-1.5 text-xs font-semibold text-medium transition hover:border-brand hover:text-dark"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: s.teamColor || "rgb(var(--c-brand))" }} />
                  {s.seriesName}
                  <span className="text-light group-hover:text-medium">
                    · {s.teamName || "Reserve"} · S{s.seasonNumber}
                  </span>
                </Link>
              ))}
            </div>
          )}
          {person.bio && <p className="mt-4 max-w-2xl text-sm leading-relaxed text-medium">{person.bio}</p>}
        </div>
      </div>
    </div>
  );
}

// --- the shelf --------------------------------------------------------------

const TITLE_WORD = { champion: "Champion", vice: "Runner-up", third: "Third" };

function TrophyShelf({ titles }) {
  if (!titles.length) return null;
  const groups = [
    ["Drivers' championship", titles.filter((t) => t.kind !== "team")],
    ["Constructors' championship", titles.filter((t) => t.kind === "team")],
  ].filter(([, list]) => list.length);
  return (
    <div className="space-y-6">
      {groups.map(([label, list]) => (
        <div key={label}>
          <div className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">{label}</div>
          <ShelfRow titles={list} />
        </div>
      ))}
    </div>
  );
}

function ShelfRow({ titles }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {titles.map((t, i) => {
        const tint = MEDAL[t.position - 1];
        return (
          <div key={i} className="relative overflow-hidden rounded-xl border border-border bg-card p-5">
            <div className="pointer-events-none absolute inset-0 opacity-[0.12]"
              style={{ background: `radial-gradient(100% 140% at 100% 0%, ${tint}, transparent 60%)` }} />
            <div className="relative flex items-center gap-4">
              {t.position === 1 ? (
                <Crown className="h-8 w-8" style={{ color: MEDAL_TEXT[0] }} />
              ) : (
                <Medal className="h-8 w-8" style={{ color: MEDAL_TEXT[t.position - 1] }} />
              )}
              <div className="min-w-0">
                <div className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">
                  {TITLE_WORD[t.type]}
                </div>
                <div className="mt-0.5 truncate text-xs font-medium text-light">
                  {t.seriesName} · {t.seasonName || `Season ${t.seasonNumber}`}
                  {t.teamName ? ` · ${t.teamName}` : ""}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- rating cards -----------------------------------------------------------

// What each league's driver card currently says about this person. The card
// itself lives on the league's own driver page; here it is just the numbers.
const RATING_PARTS = [
  ["exp", "EXP", "Experience"],
  ["rac", "RAC", "Racecraft"],
  ["aha", "AWA", "Awareness"],
  ["pac", "PAC", "Pace"],
];

function RatingRow({ rating, showLeague }) {
  const accent = rating.teamColor || "rgb(var(--c-brand))";
  return (
    <div className="flex flex-wrap items-center gap-6 px-5 py-5">
      <div className="text-center">
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">RTG</div>
        <div className="font-display text-5xl font-black leading-none tabular-nums text-dark">
          <CountUp end={rating.overall} />
        </div>
      </div>
      <div className="grid min-w-[16rem] flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {RATING_PARTS.map(([k, short, long]) => (
          <div key={k} title={long}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{short}</span>
              <span className="font-display text-base font-black tabular-nums text-dark">{rating[k]}</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded bg-surface2">
              <div className="h-full rounded" style={{ width: `${rating[k]}%`, background: accent }} />
            </div>
          </div>
        ))}
      </div>
      {showLeague && (
        <div className="font-mono text-[11px] uppercase tracking-wider text-light">
          {rating.seriesName} · S{rating.seasonNumber}
        </div>
      )}
    </div>
  );
}

// --- one row per season -----------------------------------------------------

// A season as one line you can read at a glance: where it ended, what it paid,
// who it was driven for, and the round-by-round form of that year as a strip
// of squares. It replaced a seven-column table that made you count across
// headers to work out what a row was saying.

// What a single round is worth to the eye: the podium in its own colours,
// anything that scored in the accent, a finish outside the points quiet, and
// a night that ended early greyed out.
function roundTone(r) {
  // A round the person was entered for but did not take: an empty slot, so the
  // strip still shows the gap in the season rather than hiding it.
  if (r.status === "DNS") return null;
  if (r.status !== "FINISHED" || r.position == null) return "var(--c-faint)";
  if (r.position <= 3) return MEDAL[r.position - 1];
  // One colour, two strengths: a scoring finish reads solid, a finish that
  // paid nothing is the same square gone pale.
  if ((r.points ?? 0) > 0) return "rgb(var(--c-accent) / 0.7)";
  return "rgb(var(--c-accent) / 0.22)";
}

function FormStrip({ rounds }) {
  if (!rounds.length) return null;
  return (
    <div className="flex flex-wrap gap-[3px]">
      {rounds.map((r, i) => (
        <span
          key={`${r.raceId}-${r.sprint ? "s" : "f"}-${i}`}
          title={`${r.round != null ? `Round ${r.round}` : "Round"}${r.sprint ? " sprint" : ""} · ${r.track} · ${
            r.status === "FINISHED" && r.position != null ? `P${r.position}` : r.status
          }${(r.points ?? 0) > 0 ? ` · ${r.points} pts` : ""}`}
          className="h-4 w-2.5 rounded-[2px] sm:h-5 sm:w-3"
          style={
            roundTone(r)
              ? { background: roundTone(r) }
              : { background: "transparent", boxShadow: "inset 0 0 0 1px var(--c-border)" }
          }
        />
      ))}
    </div>
  );
}

function SeasonRow({ season: s, league, rounds }) {
  const colour = s.teamColor || "rgb(var(--c-brand))";
  const counts = [
    s.wins && plural(s.wins, "win"),
    s.podiums && plural(s.podiums, "podium"),
    s.poles && plural(s.poles, "pole"),
  ].filter(Boolean);
  return (
    <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3 py-4 pl-5 pr-5 transition hover:bg-surface2 sm:pl-6">
      {/* the team's colour as the line's own edge */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: colour }} />

      <div className="min-w-[9rem] flex-1">
        <Link
          to={`/s/${league.slug}/drivers/${s.handle || s.driverId}?season=${s.seasonNumber}`}
          className="font-display text-lg font-extrabold uppercase tracking-tight text-dark transition hover:text-brand"
        >
          Season {s.seasonNumber}
        </Link>
        {s.isActive && (
          <span className="ml-2 align-middle font-mono text-[10px] font-bold uppercase tracking-wider text-brand">running</span>
        )}
        <div className="mt-1 flex items-center gap-2 text-sm">
          <TeamLogo id={s.teamId} name={s.teamName} color={s.teamColor} logoUrl={s.teamLogoUrl} size={18} />
          <span className="truncate font-semibold text-medium">{s.teamName || NO_VALUE}</span>
        </div>
        {s.game && <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-light">{s.game}</div>}
      </div>

      {/* the year round by round */}
      <div className="order-last w-full sm:order-none sm:w-auto sm:flex-[2]">
        <FormStrip rounds={rounds} />
        <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-light">
          {plural(s.starts, "start")}
          {counts.length ? ` · ${counts.join(" · ")}` : ""}
        </div>
      </div>

      {/* where it ended, and what it paid */}
      <div className="flex items-center gap-5 text-right">
        <div className="w-16">
          {s.position ? (
            <>
              <div
                className="font-display text-2xl font-black leading-none tabular-nums"
                style={s.position <= 3 ? { color: MEDAL_TEXT[s.position - 1] } : undefined}
              >
                P{s.position}
              </div>
              {s.fieldSize > 0 && (
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-light">of {s.fieldSize}</div>
              )}
            </>
          ) : (
            <NoData label="no start" />
          )}
        </div>
        <div className="w-16">
          <div className="font-display text-2xl font-black leading-none tabular-nums text-dark">{s.points}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-light">points</div>
        </div>
      </div>
    </div>
  );
}

function LeagueBlock({ league, races }) {
  // The rounds of one season, oldest first, so the strip reads left to right.
  const roundsOf = (seasonNumber) =>
    races.filter((r) => r.seriesSlug === league.slug && r.seasonNumber === seasonNumber).slice().reverse();
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: league.accentColor || "rgb(var(--c-brand))" }} />
          <Link to={`/s/${league.slug}`} className="font-display text-base font-extrabold uppercase tracking-tight text-dark transition hover:text-brand">
            {league.name}
          </Link>
        </div>
        <div className="font-mono text-[11px] uppercase tracking-wider text-light">
          {plural(league.totals.seasons, "season")} · {plural(league.totals.starts, "start")} ·{" "}
          {plural(league.totals.wins, "win")} · {league.totals.points} pts
          {league.totals.best ? ` · best ${pos(league.totals.best)}` : ""}
        </div>
      </div>
      <div className="divide-y divide-border">
        {league.seasons.map((s) => (
          <SeasonRow key={`${s.seasonNumber}-${s.driverId}`} season={s} league={league} rounds={roundsOf(s.seasonNumber)} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border bg-surface2/40 px-5 py-2.5 sm:px-6">
        <span className="font-mono text-[10px] uppercase tracking-wider text-light">Each square is a race</span>
        {[
          ["Win", MEDAL[0]],
          ["Podium", MEDAL[2]],
          ["In the points", "rgb(var(--c-accent) / 0.7)"],
          ["No points", "rgb(var(--c-accent) / 0.22)"],
          ["Out", "var(--c-faint)"],
          ["Missed", null],
        ].map(([label, colour]) => (
          <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-light">
            <span
              className="h-3 w-2 rounded-[2px]"
              style={colour ? { background: colour } : { boxShadow: "inset 0 0 0 1px var(--c-border)" }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// --- where the results land -------------------------------------------------

// Every classification as one bar: how often this person finished P1, P2, P3
// and so on, with the retirements standing apart on the right. It answers the
// question the season tables don't — not "how did that year end" but "where do
// you usually come out". Needs a few races behind it before the shape means
// anything, so the page leaves it out under MIN_RACES.
// Every classification as one bar: how often this person finished P1, P2, P3
// and so on, with the retirements standing apart on the right. It answers the
// question the season tables do not: not "how did that year end" but "where do
// you usually come out".
import { MIN_RACES, TAIL_FROM, finishSpread } from "./finishSpread.mjs";

function FinishSpread({ races, leagues }) {
  const [league, setLeague] = useState("all");
  const rows = useMemo(
    () => (league === "all" ? races : races.filter((r) => r.seriesSlug === league)),
    [races, league]
  );
  const data = useMemo(() => finishSpread(rows), [rows]);
  if (!data || data.starts < MIN_RACES) return null;
  const all = [...data.bars, ...data.out];
  const peak = Math.max(1, ...all.map((b) => b.count));
  const tight = data.bars.length > 14;
  // The average sits between two bars as often as on one, so it is drawn as a
  // line across the chart rather than as a highlighted column.
  const avgLeft = data.avg != null ? ((Math.min(data.avg, data.bars.length) - 0.5) / data.bars.length) * 100 : null;
  const tone = (b) =>
    b.bad
      ? "var(--c-faint)"
      : b.position <= 3
        ? MEDAL[b.position - 1]
        : "rgb(var(--c-accent) / 0.55)";

  return (
    <div className="space-y-4">
      {leagues.length > 1 && (
        <SlidingTabs
          items={[{ key: "all", label: "Every league" }, ...leagues.map((l) => ({ key: l.slug, label: l.name }))]}
          value={league}
          onChange={setLeague}
          btnClassName="px-3 py-1.5 text-xs sm:text-sm"
        />
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="flex items-end gap-4">
          {/* the finishing positions */}
          <div className="relative min-w-0 flex-1">
            {avgLeft != null && (
              <div className="pointer-events-none absolute inset-y-0 z-10" style={{ left: `${avgLeft}%` }}>
                <div className="h-[160px] w-px border-l border-dashed border-light sm:h-[200px]" />
                <div className="absolute -top-1 left-1.5 whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                  avg P{data.avg}
                </div>
              </div>
            )}
            <div className="flex h-[160px] items-end gap-[2px] sm:h-[200px] sm:gap-1">
              {data.bars.map((b) => (
                <div
                  key={b.key}
                  className="group flex h-full min-w-0 flex-1 flex-col justify-end"
                  title={`P${b.label}: ${plural(b.count, "race")}`}
                >
                  {b.count > 0 && !tight && (
                    <span className="mb-1 text-center font-mono text-[10px] font-bold tabular-nums text-light">{b.count}</span>
                  )}
                  <span
                    className="w-full rounded-t-[3px] transition-[height] duration-slow"
                    style={{ height: `${(b.count / peak) * 100}%`, background: tone(b), minHeight: b.count ? 3 : 0 }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-[2px] sm:gap-1">
              {data.bars.map((b, i) => (
                <span key={b.key} className="min-w-0 flex-1 text-center font-mono text-[10px] tabular-nums text-light">
                  {/* first, last, and every fifth in between — a fifth that
                      would land on the last one's shoulder is dropped. */}
                  {i === 0 || i === data.bars.length - 1 || ((i + 1) % 5 === 0 && data.bars.length - 1 - i >= 2)
                    ? b.label
                    : ""}
                </span>
              ))}
            </div>
          </div>
          {/* the nights that ended early, set apart */}
          {data.out.length > 0 && (
            <div className="shrink-0 border-l border-border pl-4">
              <div className="flex h-[160px] items-end gap-2 sm:h-[200px]">
                {data.out.map((b) => (
                  <div key={b.key} className="flex h-full w-8 flex-col justify-end" title={`${b.label}: ${plural(b.count, "race")}`}>
                    <span className="mb-1 text-center font-mono text-[10px] font-bold tabular-nums text-light">{b.count}</span>
                    <span
                      className="w-full rounded-t-[3px]"
                      style={{ height: `${(b.count / peak) * 100}%`, background: tone(b), minHeight: 3 }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                {data.out.map((b) => (
                  <span key={b.key} className="w-8 text-center font-mono text-[10px] uppercase tracking-wider text-light">
                    {b.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-light">
          Every race, sorted by where it ended.{" "}
          {data.most && (
            <>
              Most often P{data.most.label} ({plural(data.most.count, "time")}).{" "}
            </>
          )}
          {data.median != null && <>Half the finishes are P{data.median} or better. </>}
          {plural(data.finishes, "finish", "finishes")} out of {plural(data.starts, "start")}.
        </p>
      </div>
    </div>
  );
}

// --- circuits ---------------------------------------------------------------

function CircuitTable({ tracks }) {
  const [all, setAll] = useState(false);
  const shown = all ? tracks : tracks.slice(0, 10);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-eyebrow">
              <th className="px-3 py-2.5 sm:px-5">Circuit</th>
              <th className="px-2 py-2.5 text-center sm:px-3">Starts</th>
              <th className="px-2 py-2.5 text-center sm:px-3">Wins</th>
              <th className="hidden px-3 py-2.5 text-center sm:table-cell">Podiums</th>
              <th className="px-2 py-2.5 text-center sm:px-3">Best</th>
              <th className="hidden px-3 py-2.5 text-center sm:table-cell">Average</th>
              <th className="px-3 py-2.5 text-right sm:px-5">Best lap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((t) => (
              <tr key={t.track} className="transition hover:bg-surface2">
                <td className="px-3 py-3 sm:px-5">
                  <span className="inline-flex items-center gap-2">
                    <Flag code={t.country} />
                    <span className="font-semibold text-dark">{t.track}</span>
                  </span>
                </td>
                <td className="px-2 py-3 text-center tabular-nums text-medium sm:px-3">{t.starts}</td>
                <td className="px-2 py-3 text-center tabular-nums font-semibold sm:px-3" style={t.wins ? { color: MEDAL_TEXT[0] } : undefined}>
                  {t.wins || NO_VALUE}
                </td>
                <td className="hidden px-3 py-3 text-center tabular-nums text-medium sm:table-cell">{t.podiums || NO_VALUE}</td>
                <td className="px-2 py-3 text-center tabular-nums text-dark sm:px-3">{pos(t.best)}</td>
                <td className="hidden px-3 py-3 text-center tabular-nums text-medium sm:table-cell">{t.avgFinish != null ? pos(t.avgFinish) : NO_VALUE}</td>
                <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-medium sm:px-5">
                  {t.bestLapMs ? fmtLap(t.bestLapMs) : NO_VALUE}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tracks.length > 10 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-5 py-3 text-xs font-semibold text-light transition hover:bg-surface2 hover:text-dark"
        >
          {all ? "Show the top ten" : `All ${tracks.length} circuits`}
          <ChevronDown className={`h-3.5 w-3.5 transition ${all ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}

// --- team-mate duels --------------------------------------------------------

function DuelList({ teammates }) {
  const [all, setAll] = useState(false);
  const shown = all ? teammates : teammates.slice(0, 6);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="divide-y divide-border">
        {shown.map((d) => {
          const decided = d.me + d.them;
          const mine = decided ? (d.me / decided) * 100 : 50;
          return (
            <div key={d.driverId} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-semibold text-dark">{d.name}</span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-light">
                  {d.races} races together
                  {d.seasons.length ? ` · S${d.seasons.join(", S")}` : ""}
                </span>
              </div>
              <div className="mt-2.5 flex items-center gap-3">
                <span className="w-10 text-right font-display text-lg font-black tabular-nums text-dark">{d.me}</span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface2">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${mine}%` }} />
                </span>
                <span className="w-10 font-display text-lg font-black tabular-nums text-light">{d.them}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium text-light">
                <span>finished ahead</span>
                {d.qualiMe + d.qualiThem > 0 && (
                  <span className="font-mono uppercase tracking-wider">
                    qualifying {d.qualiMe}:{d.qualiThem}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {teammates.length > 6 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-5 py-3 text-xs font-semibold text-light transition hover:bg-surface2 hover:text-dark"
        >
          {all ? "Show fewer" : `All ${teammates.length} team-mates`}
          <ChevronDown className={`h-3.5 w-3.5 transition ${all ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}

// --- milestones -------------------------------------------------------------

function Milestones({ milestones }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <ol className="divide-y divide-border">
        {milestones.map((m) => (
          <li key={m.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface2">
              {m.key === "firstWin" ? (
                <Trophy className="h-4 w-4" style={{ color: MEDAL_TEXT[0] }} />
              ) : m.key === "firstPodium" ? (
                <Medal className="h-4 w-4 text-light" />
              ) : m.key === "firstPole" ? (
                <FlagIcon className="h-4 w-4 text-light" />
              ) : (
                <Star className="h-4 w-4 text-light" />
              )}
            </span>
            <span className="font-semibold text-dark">{m.label}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-medium">
              {m.track}
              {m.round ? ` · Round ${m.round}` : ""} · {m.seriesName} Season {m.seasonNumber}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-wider text-light">
              {m.date ? fmtStamp(m.date) : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// --- all-time list placings -------------------------------------------------

function Rankings({ rankings }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rankings.map((r) => (
        <Link
          key={`${r.seriesSlug}-${r.key}`}
          to={`/s/${r.seriesSlug}/records`}
          className="group flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 transition hover:border-brand"
        >
          <span
            className="font-display text-3xl font-black tabular-nums leading-none"
            style={r.rank <= 3 ? { color: MEDAL_TEXT[r.rank - 1] } : { color: "var(--c-text3)" }}
          >
            {r.rank}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-dark">{r.label}</span>
            <span className="block truncate text-xs text-light">all-time list · {r.seriesName}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

// --- every race -------------------------------------------------------------

function RaceLog({ races, leagues }) {
  const [league, setLeague] = useState("all");
  const [all, setAll] = useState(false);
  const filtered = useMemo(
    () => (league === "all" ? races : races.filter((r) => r.seriesSlug === league)),
    [races, league]
  );
  const shown = all ? filtered : filtered.slice(0, 15);
  const tabs = [{ key: "all", label: "Every league" }, ...leagues.map((l) => ({ key: l.slug, label: l.name }))];
  return (
    <div className="space-y-4">
      {leagues.length > 1 && (
        <SlidingTabs items={tabs} value={league} onChange={setLeague} btnClassName="px-3 py-1.5 text-xs sm:text-sm" />
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Phones get the same rows as a list: seven columns do not belong on
            a 375px screen, and a sideways-scrolling table is worse. */}
        <ul className="divide-y divide-border sm:hidden">
          {shown.map((r, i) => (
            <li key={`m-${r.raceId}-${r.sprint ? "s" : "f"}-${i}`} className="flex items-center gap-3 px-4 py-3">
              <Flag code={r.country} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-dark">{r.track}</span>
                <span className="block font-mono text-[11px] uppercase tracking-wider text-light">
                  S{r.seasonNumber}
                  {r.round != null ? ` R${r.round}` : ""}
                  {r.sprint ? " · sprint" : ""}
                  {r.grid != null ? ` · from P${r.grid}` : ""}
                  {r.pole ? " · pole" : ""}
                  {r.fastestLap ? " · FL" : ""}
                </span>
              </span>
              <span className="text-right">
                {r.status === "FINISHED" && r.position != null ? (
                  <span
                    className="font-display text-xl font-black tabular-nums"
                    style={r.position <= 3 ? { color: MEDAL_TEXT[r.position - 1] } : { color: "var(--c-text)" }}
                  >
                    P{r.position}
                  </span>
                ) : (
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">{r.status}</span>
                )}
                <span className="block font-mono text-[11px] tabular-nums text-light">{r.points ?? 0} pts</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-eyebrow">
                <th className="px-5 py-2.5">Round</th>
                <th className="px-3 py-2.5">Circuit</th>
                <th className="px-3 py-2.5">Team</th>
                <th className="px-3 py-2.5 text-center">Grid</th>
                <th className="px-3 py-2.5 text-center">Finish</th>
                <th className="px-3 py-2.5 text-right">Points</th>
                <th className="px-5 py-2.5 text-right">Best lap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r, i) => (
                <tr key={`${r.raceId}-${r.sprint ? "s" : "f"}-${i}`} className="transition hover:bg-surface2">
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className="font-mono text-xs font-semibold text-medium">
                      S{r.seasonNumber}
                      {r.round != null ? ` R${r.round}` : ""}
                    </span>
                    {r.sprint && (
                      <span className="ml-2 rounded bg-surface2 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light">
                        sprint
                      </span>
                    )}
                    <div className="mt-0.5 text-[11px] text-light">{r.date ? fmtStamp(r.date) : r.seriesName}</div>
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      to={`/s/${r.seriesSlug}/races?season=${r.seasonNumber}&race=${r.raceId}`}
                      className="inline-flex items-center gap-2.5 font-semibold text-dark transition hover:text-brand"
                    >
                      <Flag code={r.country} />
                      {r.track}
                    </Link>
                    <span className="ml-2 inline-flex gap-1 align-middle">
                      {r.pole && (
                        <span title="Pole position" className="rounded bg-surface2 px-1 py-0.5 font-mono text-[10px] font-bold text-light">
                          POLE
                        </span>
                      )}
                      {r.fastestLap && (
                        <span title="Fastest lap of the race" className="rounded bg-surface2 px-1 py-0.5 font-mono text-[10px] font-bold text-light">
                          FL
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.teamColor || "var(--c-border)" }} />
                      <span className="truncate text-medium">{r.teamName || NO_VALUE}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center tabular-nums text-light">{r.grid ?? NO_VALUE}</td>
                  <td className="px-3 py-3 text-center">
                    {r.status === "FINISHED" && r.position != null ? (
                      <span
                        className="font-display text-base font-black tabular-nums"
                        style={r.position <= 3 ? { color: MEDAL_TEXT[r.position - 1] } : { color: "var(--c-text)" }}
                      >
                        {r.position}
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">{r.status}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-dark">{r.points ?? NO_VALUE}</td>
                  <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-medium">
                    {r.bestLapMs ? fmtLap(r.bestLapMs) : NO_VALUE}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 15 && (
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-border px-5 py-3 text-xs font-semibold text-light transition hover:bg-surface2 hover:text-dark"
          >
            {all ? "Show the last fifteen" : `All ${filtered.length} races`}
            <ChevronDown className={`h-3.5 w-3.5 transition ${all ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
    </div>
  );
}

// The spread and its heading travel together: with too few races behind it the
// chart says nothing, and an empty section with a title is worse than no
// section at all.
function FinishSpreadSection({ races, leagues }) {
  const data = finishSpread(races);
  if (!data || data.starts < MIN_RACES) return null;
  return (
    <Section id="spread" eyebrow="Where the races end" title="Finishing spread">
      <FinishSpread races={races} leagues={leagues} />
    </Section>
  );
}

// The page is long on purpose, so it carries a map that follows you: the pill
// sits on whichever chapter is under the header right now. Only the big
// chapters are listed — a link per section turned it into a wall of words.
function ChapterBar({ chapters }) {
  const ids = chapters.map(([id]) => id);
  const key = ids.join("|");
  const [here, setHere] = useState(ids[0]);
  const barRef = useRef(null);

  // Which chapter is under the header right now: the last one whose heading has
  // passed it. An IntersectionObserver was the obvious tool and the wrong one —
  // a tall chapter keeps intersecting long after you have scrolled past its
  // heading, so the pill stayed on whatever came first.
  useEffect(() => {
    const pick = () => {
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 170) current = id;
      }
      setHere(current);
    };
    pick();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        pick();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [key]);

  // On a phone the bar is wider than the screen, so the chapter you are in has
  // to be brought into it — sideways only, never by moving the page.
  useEffect(() => {
    const bar = barRef.current;
    const btn = bar?.querySelector('button[aria-pressed="true"]');
    if (!bar || !btn) return;
    const want = btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2;
    bar.scrollTo({ left: Math.max(0, want), behavior: motionOff() ? "auto" : "smooth" });
  }, [here]);

  const go = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: motionOff() ? "auto" : "smooth", block: "start" });
  };

  return (
    <nav
      ref={barRef}
      aria-label="On this page"
      className="sticky top-[84px] z-20 -mx-1 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <SlidingTabs
        items={chapters.map(([id, label]) => ({ key: id, label }))}
        value={here}
        onChange={go}
        wrapClassName="inline-flex rounded-full border border-border bg-card/95 p-1 shadow-sm backdrop-blur"
        btnClassName="whitespace-nowrap px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider sm:text-[11.5px]"
        pillClassName="rounded-full bg-surface2 ring-1 ring-border"
        activeClassName="text-dark"
        idleClassName="text-light hover:text-medium"
      />
    </nav>
  );
}

// --- the page ---------------------------------------------------------------

export default function DriverCareer() {
  const { key } = useParams();
  const load = useCallback(() => api.career(key), [key]);
  const { data, loading, error, reload } = useApi(load);
  useSpecificTitle(data ? `${data.person.name} · Career` : "Career");

  if (loading && !data) {
    return (
      <div className="space-y-8">
        <PageHeaderSkeleton />
        <TableSkeleton rows={10} />
      </div>
    );
  }
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const { person, span, totals, titles, ratings = [], leagues, teams, tracks, teammates, milestones, rankings, races } = data;
  const hasTelemetry = totals.overtakes != null || totals.lapsLed != null || totals.contacts != null;

  // The chapters, not every section: the smaller blocks (rating, teams,
  // firsts, lists) are found by reading on, which is what they are for.
  const nav = [
    ["record", "Record"],
    races.length >= MIN_RACES && ["spread", "Spread"],
    titles.length && ["honours", "Honours"],
    ["seasons", "Seasons"],
    tracks.length && ["circuits", "Circuits"],
    teammates.length && ["duels", "Duels"],
    races.length && ["races", "Races"],
  ].filter(Boolean);

  return (
    <div className="space-y-10 sm:space-y-12">
      <Hero person={person} span={span} />

      <ChapterBar chapters={nav} />

      <Section id="record" eyebrow="Everything added up" title="The record">
        <StatFrame
          tiles={[
            { icon: <FlagIcon className={ICON} />, label: "Starts", value: totals.starts, sub: plural(totals.finishes, "finish", "finishes") },
            { icon: <Trophy className={ICON} />, label: "Wins", value: totals.wins, sub: `${totals.winRate}% of starts`, accent: totals.wins ? MEDAL_TEXT[0] : undefined },
            { icon: <Medal className={ICON} />, label: "Podiums", value: totals.podiums, sub: `${totals.podiumRate}% of starts` },
            { icon: <Timer className={ICON} />, label: "Poles", value: totals.polePositions, sub: `best grid ${pos(totals.bestGrid)}` },
            { icon: <Gauge className={ICON} />, label: "Fastest laps", value: totals.fastestLaps ?? 0, sub: totals.fastestLap ? `best ${fmtLap(totals.fastestLap.bestLapMs)}` : "best lap of a race" },
            { icon: <Star className={ICON} />, label: "Points", value: totals.points, sub: "across every season" },
          ]}
        />
        {/* Everything else, kept quiet on purpose. */}
        <div className="mt-3">
          <StatList
            groups={[
              {
                rows: [
                  { label: "Best finish", value: pos(totals.bestFinish) },
                  { label: "Average finish", value: pos(totals.avgFinish) },
                  { label: "Average grid", value: pos(totals.avgGrid) },
                  { label: "Top fives", value: totals.top5 },
                  { label: "Top tens", value: totals.top10 },
                  { label: "In the points", value: totals.pointsFinishes },
                  {
                    label: "Places gained",
                    value: totals.positionsGained > 0 ? `+${totals.positionsGained}` : totals.positionsGained,
                    accent: totals.positionsGained > 0 ? "#16a34a" : totals.positionsGained < 0 ? "#dc2626" : undefined,
                  },
                  { label: "Retirements", value: totals.dsq ? `${totals.dnf} + ${totals.dsq} DSQ` : totals.dnf },
                  {
                    label: "Penalty time",
                    value: `${Math.round((totals.stewardPenaltySeconds || 0) + (totals.gamePenaltySeconds || 0))}s`,
                  },
                  ...(hasTelemetry
                    ? [
                        { label: "Overtakes", value: totals.overtakes },
                        { label: "Laps led", value: totals.lapsLed },
                        { label: "Contacts", value: totals.contacts },
                        {
                          label: "Consistency",
                          value: totals.avgConsistencyMs != null ? `±${(totals.avgConsistencyMs / 1000).toFixed(2)}s` : null,
                        },
                      ]
                    : []),
                ],
              },
            ]}
          />
        </div>
        {totals.sprint && (
          <p className="mt-3 text-xs text-light">
            Sprint races are counted in the numbers above. On their own they add up to {totals.sprint.starts} starts,{" "}
            {totals.sprint.wins} wins and {totals.sprint.podiums} podiums.
          </p>
        )}
      </Section>

      <FinishSpreadSection races={races} leagues={leagues} />

      {titles.length > 0 && (
        <Section id="honours" eyebrow="What it was worth" title="Honours">
          <TrophyShelf titles={titles} />
        </Section>
      )}

      {ratings.length > 0 && (
        <Section id="rating" eyebrow="What the card says" title={ratings.length > 1 ? "Driver ratings" : "Driver rating"}>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {ratings.map((r) => (
              <RatingRow key={r.seriesSlug} rating={r} showLeague />
            ))}
          </div>
        </Section>
      )}

      <Section
        id="seasons"
        eyebrow={leagues.length > 1 ? "Every league, every season" : "Season by season"}
        title="The seasons"
      >
        <div className="space-y-4">
          {leagues.map((l) => (
            <LeagueBlock key={l.slug} league={l} races={races} />
          ))}
        </div>
      </Section>

      {teams.length > 0 && (
        <Section id="teams" eyebrow="Who they drove for" title="Teams">
          <div className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
            {teams.map((t) => (
              <div key={t.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <TeamLogo id={t.teamId} name={t.name} color={t.color} logoUrl={t.logoUrl} size={32} />
                <span className="font-semibold text-dark">{t.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-light">{seasonSpell(t.seasons, leagues.length > 1)}</span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-light">
                  {plural(t.starts, "start")} · {plural(t.wins, "win")} · {plural(t.podiums, "podium")} · {t.points} pts
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {tracks.length > 0 && (
        <Section id="circuits" eyebrow="Where they are quick" title="Circuits" right={<span className="font-mono text-[11px] uppercase tracking-wider text-light">{tracks.length} tracks raced</span>}>
          <CircuitTable tracks={tracks} />
        </Section>
      )}

      {teammates.length > 0 && (
        <Section id="duels" eyebrow="Same car, same day" title="Team-mate duels">
          <DuelList teammates={teammates} />
        </Section>
      )}

      {milestones.length > 0 && (
        <Section id="firsts" eyebrow="The nights that counted" title="Firsts and milestones">
          <Milestones milestones={milestones} />
        </Section>
      )}

      {rankings.length > 0 && (
        <Section id="lists" eyebrow="Against everyone who has raced here" title="All-time list places">
          <Rankings rankings={rankings} />
        </Section>
      )}

      {races.length > 0 && (
        <Section id="races" eyebrow="Newest first" title="Every race">
          <RaceLog races={races} leagues={leagues} />
        </Section>
      )}
    </div>
  );
}
