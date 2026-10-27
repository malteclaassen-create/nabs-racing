import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowRight, Flag as FlagIcon, Timer, TrendingUp, Gauge } from "lucide-react";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import SeasonPicker from "./SeasonPicker.jsx";
import { DriverAvatar, MEDAL_TEXT, RollingNumber } from "./ui.jsx";
import { CategoryChip, CommentCount, NewsCover } from "../pages/News.jsx";
import { ColumnHeader, Headline } from "./HomeNews.jsx";
import { topTen, Gained } from "./LatestResultCard.jsx";
import { flagFor } from "../data/circuits.js";
import { tyreCompound } from "../data/liveTiming.js";
import { fmtRaceTime, raceKickoff, LIVE_WINDOW_MS } from "../utils/raceTime.js";
import { fmtDuration, fmtGap } from "../utils/raceDuration.js";
import { fmtDateLong, fmtLap, fmtStamp, NO_VALUE } from "../utils/format.js";
import { seasonGameLabel } from "../utils/seasonGame.js";
import { isDevHost } from "../preview.js";

// ---------------------------------------------------------------------------
// The top of the member home while a season runs: one strip with the season
// and the next race (countdown, sign-up), then the latest news and the latest
// result side by side, the same width and the same height.
//
// Preview only: the result card comes in a few styles, switched with the bar
// at the bottom of the screen on a local dev server (or ?result=<key>).
// ---------------------------------------------------------------------------

export const RESULT_STYLES = [
  { key: "liste", label: "1  Liste" },
  { key: "streifen", label: "2  Foto-Streifen" },
  { key: "zeiten", label: "3  Zeiten" },
  { key: "team", label: "4  Teamfarben" },
  { key: "foto", label: "5  Foto-Kopf" },
];
const STORE = "nabs_home_result";

function useResultStyle() {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return "liste";
    const q = new URLSearchParams(window.location.search).get("result");
    if (q && RESULT_STYLES.some((v) => v.key === q)) {
      try {
        localStorage.setItem(STORE, q);
      } catch {
        /* ignore */
      }
      return q;
    }
    try {
      const saved = localStorage.getItem(STORE);
      return RESULT_STYLES.some((v) => v.key === saved) ? saved : "liste";
    } catch {
      return "liste";
    }
  });
  const choose = (k) => {
    try {
      localStorage.setItem(STORE, k);
    } catch {
      /* ignore */
    }
    setValue(k);
  };
  return [value, choose];
}

function StylePicker({ value, onChange }) {
  const show = isDevHost() || new URLSearchParams(window.location.search).has("result");
  if (!show) return null;
  // On body: the page wrapper animates with a transform, which would pin a
  // fixed bar to the page instead of the screen.
  return createPortal(
    <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-3">
      <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/15 bg-black/85 p-1 shadow-2xl backdrop-blur-md">
        <span className="hidden whitespace-nowrap px-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/50 sm:inline">
          Ergebnis-Karte
        </span>
        {RESULT_STYLES.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => onChange(v.key)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition ${
              value === v.key ? "bg-brand text-onbrand" : "text-white/75 hover:bg-white/10 hover:text-white"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}

// --------------------------------------------------------------- pieces ---

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const pad2 = (n) => String(n).padStart(2, "0");

function roundLabel(race) {
  if (race?.number != null) return `R${pad2(race.number)}`;
  return race?.type === "TRAINING" ? "Training" : "Event";
}

function dayLabel(date) {
  const k = raceKickoff(date);
  return k ? `${WEEKDAYS[k.getDay()]} ${pad2(k.getDate())} ${MONTHS[k.getMonth()]}` : "";
}

function useClock(race) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const kickoff = raceKickoff(race?.date);
  const remaining = kickoff ? kickoff.getTime() - now : null;
  const live = remaining != null && remaining <= 0 && remaining > -LIVE_WINDOW_MS;
  const over = remaining != null && remaining <= -LIVE_WINDOW_MS;
  const total = Math.max(0, Math.floor((remaining ?? 0) / 1000));
  const units = [
    { value: Math.floor(total / 86400), suffix: "D" },
    { value: Math.floor((total % 86400) / 3600), suffix: "H" },
    { value: Math.floor((total % 3600) / 60), suffix: "M" },
    { value: total % 60, suffix: "S" },
  ];
  return { kickoff, live, over, units };
}

// The countdown as one line of digits, or Live now / results soon.
function InlineCountdown({ race }) {
  const { kickoff, live, over, units } = useClock(race);
  if (live) {
    return (
      <Link to="/live" className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 font-mono text-xs font-bold uppercase tracking-widest text-onbrand">
        <span className="live-dot inline-block h-2 w-2 rounded-full bg-current" />
        Live now
      </Link>
    );
  }
  if (over) return <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-light">Race run · results soon</span>;
  if (!kickoff) return <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-light">Time TBA</span>;
  return (
    <div className="flex items-baseline gap-2 tabular-nums" role="timer" aria-label="Time to the start">
      {units.map((u) => (
        <span key={u.suffix} className="font-mono leading-none">
          <RollingNumber value={u.value} digits={2} className="font-display text-2xl font-black text-dark" />
          <span className="ml-0.5 text-[10px] font-bold text-light">{u.suffix}</span>
        </span>
      ))}
    </div>
  );
}

function SignUp({ race }) {
  const { live, over } = useClock(race);
  if (!race || live || over) return null;
  return (
    <Link
      to={`/attendance?race=${race.id}`}
      className="shine group inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-brand px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
    >
      Sign up
      <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" strokeWidth={2.5} />
    </Link>
  );
}

// The season and the next race in one strip.
function TopStrip({ d }) {
  const race = d.nextRace;
  const c = race ? flagFor(race.track, race.country) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-card">
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-light lg:w-auto">
        <SeasonPicker finished={false} />
        {d.season?.game && (
          <>
            <span className="hidden h-3 w-px bg-border sm:inline-block" />
            <span className="hidden sm:inline">{seasonGameLabel(d.season)}</span>
          </>
        )}
        <span className="hidden h-3 w-px bg-border sm:inline-block" />
        <span className="text-medium">
          Round {pad2(d.roundNo)} <span className="text-faint">/ {d.totalRounds || NO_VALUE}</span>
        </span>
      </div>
      {race && (
        <>
          <span className="hidden h-10 w-px bg-border lg:block" />
          <Link to={`/races?race=${race.id}`} className="group flex min-w-0 flex-1 items-center gap-3">
            {c && <Flag code={c.country} title={c.countryName} w={28} h={20} />}
            <span className="min-w-0">
              <span className="block truncate font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-eyebrow">
                Next race · {roundLabel(race)} · {dayLabel(race.date)} · {fmtRaceTime(race.date)}
              </span>
              <span className="block truncate font-display text-xl font-black uppercase leading-tight tracking-tight text-dark group-hover:text-brand">
                {race.track}
              </span>
            </span>
          </Link>
          <div className="flex w-full items-center justify-between gap-5 sm:w-auto">
            <InlineCountdown race={race} />
            <SignUp race={race} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- news ---

function LeadStory({ article, className = "" }) {
  return (
    <Link
      to={`/news/${article.slug}`}
      className={`group relative block overflow-hidden rounded-2xl bg-ink shadow-xl shadow-ink/10 ring-1 ring-black/10 dark:ring-white/10 ${className}`}
    >
      <div className="absolute inset-0">
        <NewsCover article={article} className="transition duration-500 group-hover:scale-[1.03]" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
        <CategoryChip category={article.category} label={article.categoryLabel} />
        <h3 className="mt-2 max-w-3xl font-display text-xl font-extrabold leading-tight tracking-tight text-white sm:text-2xl lg:text-[1.75rem]">
          {article.title}
        </h3>
        {article.summary && (
          <p className="mt-1.5 line-clamp-2 hidden max-w-2xl text-sm leading-relaxed text-white/75 sm:block">{article.summary}</p>
        )}
        <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-white/60">
          <span>{fmtStamp(article.publishedAt)}</span>
          {article.commentCount > 0 && <CommentCount count={article.commentCount} className="text-white/70" />}
        </div>
      </div>
    </Link>
  );
}

// The news column. The lead picture takes whatever height the result card
// beside it leaves over, so the two columns always end on the same line; on
// a phone it keeps a fixed 4:3.
function NewsColumn({ news }) {
  const articles = news?.data?.articles || [];
  const [lead, ...rest] = articles;
  if (news?.loading) {
    return (
      <section className="flex flex-col" aria-busy="true">
        <ColumnHeader title="Latest news" to="/news" cta="All news" />
        <div className="skeleton min-h-[340px] w-full flex-1 rounded-2xl" />
      </section>
    );
  }
  if (!lead) return null;
  return (
    <section className="flex min-w-0 flex-col">
      <ColumnHeader title="Latest news" to="/news" cta="All news" />
      <LeadStory article={lead} className="aspect-[4/3] sm:aspect-[16/10] lg:aspect-auto lg:min-h-[320px] lg:flex-1" />
      {rest.length > 0 && (
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          {rest.slice(0, 3).map((a) => (
            <Headline key={a.id} article={a} />
          ))}
        </div>
      )}
    </section>
  );
}

// -------------------------------------------------------------- result ---

// Gaps, tyres and the round's little stories, from the same payload the top
// ten comes from. A time penalty is part of the classified time.
function raceExtras(payload) {
  const all = payload?.results || [];
  const fin = all
    .filter((r) => r.status === "FINISHED" && r.position != null)
    .sort((a, b) => a.position - b.position);
  const winner = fin[0] || null;
  const timeOf = (r) => (r.totalTimeMs > 0 ? r.totalTimeMs + (r.penaltySeconds || 0) * 1000 : null);
  const gaps = {};
  for (const r of fin) {
    if (r === winner) gaps[r.driverId] = fmtDuration(timeOf(r)) || null;
    else if (winner?.laps != null && r.laps != null && r.laps < winner.laps) {
      const n = winner.laps - r.laps;
      gaps[r.driverId] = `+${n} lap${n === 1 ? "" : "s"}`;
    } else if (timeOf(r) && timeOf(winner)) gaps[r.driverId] = fmtGap(timeOf(r) - timeOf(winner)) || null;
  }
  const stints = Object.fromEntries(all.map((r) => [r.driverId, r.stints || []]));
  const laps = all.filter((r) => fmtLap(r.bestLapMs));
  const fastestId =
    payload?.race?.fastestLapDriverId || (laps.length ? laps.reduce((a, b) => (b.bestLapMs < a.bestLapMs ? b : a)).driverId : null);
  const fastest = all.find((r) => r.driverId === fastestId) || null;
  const gainer = fin.filter((r) => r.grid != null).reduce((a, b) => (!a || b.grid - b.position > a.grid - a.position ? b : a), null);
  const leader = all.reduce((a, b) => (!a || (b.lapsLed || 0) > (a.lapsLed || 0) ? b : a), null);
  return {
    gaps,
    stints,
    laps: winner?.laps ?? null,
    facts: [
      fastest && fmtLap(fastest.bestLapMs) && { key: "fl", icon: Timer, label: "Fastest lap", name: fastest.name, value: fmtLap(fastest.bestLapMs) },
      gainer && gainer.grid - gainer.position > 0 && { key: "gain", icon: TrendingUp, label: "Most gained", name: gainer.name, value: `▲${gainer.grid - gainer.position}` },
      leader && leader.lapsLed > 0 && { key: "led", icon: Gauge, label: "Most laps led", name: leader.name, value: `${leader.lapsLed}` },
    ].filter(Boolean),
  };
}

function useResult(d) {
  const [tab, setTab] = useState("feature");
  const tabs = [
    { key: "feature", label: "Feature", payload: d.feature },
    d.sprint && { key: "sprint", label: "Sprint", payload: d.sprint },
  ]
    .filter(Boolean)
    .map((t) => ({ ...t, result: topTen(t.payload), extras: raceExtras(t.payload) }))
    .filter((t) => t.result.rows.length > 0);
  const open = tabs.find((t) => t.key === tab) || tabs[0] || null;
  const result = open?.result || null;
  const resultsTo = result?.race?.id ? `/races?race=${result.race.id}` : d.lastRace?.id ? `/races?race=${d.lastRace.id}` : "/races";
  return { tabs, open, setTab, result, extras: open?.extras || null, resultsTo };
}

function RaceTabs({ r, onPhoto = false }) {
  if (r.tabs.length < 2) return null;
  return (
    <div
      className={`inline-flex shrink-0 rounded-lg border p-0.5 ${onPhoto ? "border-white/20 bg-black/40 backdrop-blur-md" : "border-border bg-surface2"}`}
      role="tablist"
      aria-label="Race"
    >
      {r.tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={r.open?.key === t.key}
          onClick={() => r.setTab(t.key)}
          className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition ${
            r.open?.key === t.key ? "bg-brand text-onbrand" : onPhoto ? "text-white/70 hover:text-white" : "text-light hover:text-dark"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Avatar({ r, size = 34, logo = 16, ring = false }) {
  return (
    <span className="relative shrink-0">
      <span
        className={ring ? "block rounded-full p-[3px]" : "block"}
        style={ring ? { background: `linear-gradient(135deg, ${r.team.color || "#888"}, transparent 80%)` } : undefined}
      >
        <DriverAvatar name={r.name} photoUrl={r.photoUrl} color={r.team.color} size={size} />
      </span>
      <TeamLogo
        id={r.team.id}
        name={r.team.name}
        color={r.team.color}
        logoUrl={r.team.logoUrl}
        size={logo}
        className="absolute -bottom-1 -right-1.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
      />
    </span>
  );
}

function FastestLap({ result, r }) {
  if (result.fastestId !== r.driverId) return null;
  return (
    <span title="Fastest lap" className="rounded bg-fl/15 px-1.5 py-px font-mono text-[9px] font-bold text-fl">
      FL
    </span>
  );
}

// The tyres a driver ran, one small disc per stint.
function Stints({ stints }) {
  if (!stints?.length) return null;
  return (
    <span className="flex items-center gap-0.5" title={stints.map((s) => `${tyreCompound(s.tyre).name} ${s.laps} laps`).join(" · ")}>
      {stints.map((s, i) => {
        const t = tyreCompound(s.tyre);
        return (
          <span
            key={i}
            className="flex h-4 w-4 items-center justify-center rounded-full border-2 font-mono text-[7px] font-black text-dark ring-1 ring-black/15 dark:ring-0"
            style={{ borderColor: t.color }}
          >
            {t.label}
          </span>
        );
      })}
    </span>
  );
}

function RoundTitle({ d }) {
  const c = d.lastCircuit;
  return (
    <div className="min-w-0">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-eyebrow">Round {d.lastRace?.number ?? NO_VALUE}</div>
      <div className="mt-1.5 flex min-w-0 items-center gap-2.5">
        {c && <Flag code={c.country} title={c.countryName} w={24} h={17} />}
        <span className="truncate font-display text-xl font-black uppercase leading-none tracking-tight text-dark sm:text-2xl">{d.lastRace?.track}</span>
      </div>
      {d.lastRace?.date && <div className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-light">{fmtDateLong(d.lastRace.date)}</div>}
    </div>
  );
}

function ResultPending({ d, rows = 6 }) {
  if (d.feature) return <p className="py-10 text-center text-sm text-light">The classification is on its way.</p>;
  return (
    <div className="flex flex-col gap-2 py-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className="skeleton h-9 w-full rounded-lg" />
      ))}
    </div>
  );
}

function ResultButtons({ r, d }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      <Link
        to={r.resultsTo}
        className="shine group inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:brightness-105 sm:flex-none"
      >
        Full results <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" strokeWidth={2.5} />
      </Link>
      <Link
        to="/drivers"
        className="inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-border px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-dark transition hover:bg-surface2 sm:flex-none"
      >
        Standings
      </Link>
      {d.reportTo && (
        <Link
          to={d.reportTo}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-red-700 transition hover:bg-red-500/25 dark:text-red-200 sm:w-auto"
        >
          <FlagIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
          Report an incident
        </Link>
      )}
    </div>
  );
}

// One line of the top ten. The podium lines are a size up, their place in
// medal colour. `style` adds what that card style shows: the timing columns
// ("zeiten") or the team's colour behind the line ("team").
function ResultRow({ r, i, result, extras, style }) {
  const podium = i < 3;
  const timing = style === "zeiten";
  const team = style === "team";
  const big = podium && !timing;
  const color = r.team.color || "#888888";
  return (
    <li className="flex">
      <Link
        to={`/drivers/${r.driverId}`}
        className={`group flex flex-1 items-center gap-3 rounded-lg px-2 transition ${team ? "" : "-mx-2 hover:bg-surface2"} ${
          big ? "py-2.5" : "py-1.5"
        }`}
        style={team ? { background: `linear-gradient(90deg, ${color}33 0%, ${color}0f 40%, transparent 75%)` } : undefined}
      >
        {timing ? (
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-display text-xs font-black ${podium ? "text-ink" : "bg-surface2 text-medium"}`}
            style={podium ? { backgroundColor: MEDAL_TEXT[i] } : undefined}
          >
            {r.position}
          </span>
        ) : (
          <span
            className={`w-6 shrink-0 text-center font-display font-black tabular-nums ${big ? "text-lg" : "text-sm text-light"}`}
            style={big ? { color: MEDAL_TEXT[i] } : undefined}
          >
            {r.position}
          </span>
        )}
        <Avatar r={r} size={big ? 36 : 28} logo={big ? 16 : 13} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-2">
            <span className={`truncate font-bold text-dark group-hover:text-brand ${big ? "text-[15px]" : "text-sm"}`}>{r.name}</span>
            <FastestLap result={result} r={r} />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-light">
            {team && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
            <span className="truncate">{r.team.name}</span>
          </span>
        </span>
        {timing && (
          <span className="hidden sm:block">
            <Stints stints={extras?.stints[r.driverId]} />
          </span>
        )}
        {timing && (
          <span className={`w-16 text-right font-mono text-[11px] tabular-nums sm:w-[4.5rem] ${i === 0 ? "font-bold text-dark" : "text-medium"}`}>
            {extras?.gaps[r.driverId] || ""}
          </span>
        )}
        {/* With the gap column on, a phone has no room for the grid change too. */}
        <span className={timing ? "hidden sm:contents" : "contents"}>
          <Gained value={r.gained} />
        </span>
        {result.scores && (
          <span className={`min-w-[1.75rem] text-right font-display font-black tabular-nums text-dark ${big ? "text-base" : "text-sm"}`}>
            {r.points ?? 0}
          </span>
        )}
      </Link>
    </li>
  );
}

// The column labels of a results sheet, over the timing style's list.
function TimingHead() {
  return (
    <div className="flex items-center gap-3 border-b border-border pb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-faint">
      <span className="w-6 text-center">Pos</span>
      <span className="flex-1 pl-10">Driver</span>
      <span className="hidden sm:block">Tyres</span>
      <span className="w-16 text-right sm:w-[4.5rem]">Gap</span>
      <span className="hidden w-8 text-right sm:block">Grid</span>
      <span className="min-w-[1.75rem] text-right">Pts</span>
    </div>
  );
}

// P1 to P10, top to bottom.
function ResultList({ r, style }) {
  const rows = r.result?.rows || [];
  return (
    <div>
      {style === "zeiten" && <TimingHead />}
      <ol className={style === "team" ? "space-y-1" : "divide-y divide-border/60"}>
        {rows.map((row, i) => (
          <ResultRow key={row.driverId} r={row} i={i} result={r.result} extras={r.extras} style={style} />
        ))}
      </ol>
    </div>
  );
}

// The round's stories in one line: fastest lap, most places gained, most laps led.
function FactsLine({ r }) {
  const facts = r.extras?.facts || [];
  if (!facts.length) return null;
  return (
    <div className="grid grid-cols-1 divide-y divide-border rounded-xl border border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {facts.map((f) => (
        <div key={f.key} className="flex min-w-0 items-center gap-2.5 px-3 py-2">
          <f.icon className="h-4 w-4 shrink-0 text-light" strokeWidth={2} />
          <span className="min-w-0 leading-tight">
            <span className="block font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-faint">{f.label}</span>
            <span className="flex items-baseline gap-1.5">
              <span className="truncate text-[13px] font-bold text-dark">{f.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-medium">{f.value}</span>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// The card's head. The photo style puts the round's picture behind it.
function CardHead({ d, r, photo = false }) {
  if (!photo) {
    return (
      <div className="flex items-start justify-between gap-3">
        <RoundTitle d={d} />
        <RaceTabs r={r} />
      </div>
    );
  }
  const c = d.lastCircuit;
  return (
    <div className="relative -mx-5 -mt-5 overflow-hidden rounded-t-2xl">
      <img src={d.photo} alt="" data-hero-fallback={d.photoFallback} onError={d.onPhotoError} className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/10" />
      <div className="relative flex min-h-[9.5rem] items-end justify-between gap-3 p-5">
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
            Round {d.lastRace?.number ?? NO_VALUE}
            {d.lastRace?.date && <span className="text-white/50"> · {fmtDateLong(d.lastRace.date)}</span>}
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-2.5">
            {c && <Flag code={c.country} title={c.countryName} w={28} h={20} />}
            <span className="truncate font-display text-3xl font-black uppercase leading-none tracking-tight text-white sm:text-4xl">
              {d.lastRace?.track}
            </span>
          </div>
        </div>
        <RaceTabs r={r} onPhoto />
      </div>
    </div>
  );
}

function ResultCard({ d, style }) {
  const r = useResult(d);
  const list = r.result ? <ResultList r={r} style={style} /> : <ResultPending d={d} />;

  // 2 — the live card's own build, refined: the round's photo as a strip with
  // the track written up it, the list beside it. On a phone the strip stands
  // down and the track moves into the line above the list.
  if (style === "streifen") {
    const c = d.lastCircuit;
    return (
      <section className="flex min-w-0 flex-col">
        <ColumnHeader title="Latest result" to="/races" cta="All rounds" />
        <div className="relative flex flex-1 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <div className="relative hidden w-[30%] shrink-0 overflow-hidden sm:block">
            <img src={d.photo} alt="" data-hero-fallback={d.photoFallback} onError={d.onPhotoError} className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/85" />
            <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-2">
              {c && <Flag code={c.country} title={c.countryName} w={28} h={20} />}
              <span className="rounded-md bg-black/45 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white/85 backdrop-blur-sm">
                R{pad2(d.lastRace?.number ?? 0)}
              </span>
            </div>
            <div className="absolute inset-x-0 bottom-5 flex justify-center">
              <span className="block rotate-180 whitespace-nowrap font-display text-6xl font-black uppercase leading-none tracking-tight text-white [writing-mode:vertical-rl]">
                {d.lastRace?.track}
              </span>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5 whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-eyebrow">
                {c && (
                  <span className="sm:hidden">
                    <Flag code={c.country} title={c.countryName} w={22} h={16} />
                  </span>
                )}
                <span className="truncate sm:hidden">{d.lastRace?.track} ·</span>
                <span>Round {d.lastRace?.number ?? NO_VALUE}</span>
                {d.lastRace?.date && <span className="hidden truncate text-light sm:inline">{fmtDateLong(d.lastRace.date)}</span>}
              </div>
              <RaceTabs r={r} />
            </div>
            {list}
            <div className="mt-auto pt-1">
              <ResultButtons r={r} d={d} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  const photo = style === "foto";
  return (
    <section className="flex min-w-0 flex-col">
      <ColumnHeader title="Latest result" to="/races" cta="All rounds" />
      <div className="flex flex-1 flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card">
        <CardHead d={d} r={r} photo={photo} />
        {photo && r.result && <FactsLine r={r} />}
        {list}
        <div className="mt-auto pt-1">
          <ResultButtons r={r} d={d} />
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- export ---

export default function HomeTop({ data }) {
  const [style, setStyle] = useResultStyle();
  const hasNews = data.news?.loading || (data.news?.data?.articles?.length || 0) > 0;
  return (
    <div className="-mt-2 space-y-8">
      <StylePicker value={style} onChange={setStyle} />
      <TopStrip d={data} />
      <div className={`grid grid-cols-1 items-stretch gap-6 lg:gap-8 ${hasNews ? "lg:grid-cols-2" : ""}`}>
        {hasNews && <NewsColumn news={data.news} />}
        <ResultCard d={data} style={style} />
      </div>
    </div>
  );
}
