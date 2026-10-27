import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowRight, Flag as FlagIcon } from "lucide-react";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import CircuitMap from "./CircuitMap.jsx";
import SessionPlan from "./SessionPlan.jsx";
import RaceCountdown from "./RaceCountdown.jsx";
import SeasonPicker from "./SeasonPicker.jsx";
import { DriverAvatar, MEDAL_TEXT, RollingNumber } from "./ui.jsx";
import { CategoryChip, CommentCount, NewsCover } from "../pages/News.jsx";
import { ColumnHeader, Headline, Card } from "./HomeNews.jsx";
import { topTen, Gained } from "./LatestResultCard.jsx";
import { circuitMark } from "./NextRaceCard.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtRaceTime, raceKickoff, LIVE_WINDOW_MS } from "../utils/raceTime.js";
import { fmtDateLong, fmtStamp, NO_VALUE } from "../utils/format.js";
import { seasonGameLabel } from "../utils/seasonGame.js";
import { isDevHost } from "../preview.js";

// ---------------------------------------------------------------------------
// Layout variants for the top of the member home (a running season): the
// season line, the next race, the latest news and the latest result. Only a
// preview: the picker at the bottom of the screen switches between them on a
// local dev server (or with ?top=<key>), real visitors always get the page
// as it is.
// ---------------------------------------------------------------------------

export const TOP_VARIANTS = [
  { key: "now", label: "Jetzt" },
  { key: "a", label: "A  Eine Leiste" },
  { key: "b", label: "B  Ergebnis vorne" },
  { key: "c", label: "C  Zeitung" },
  { key: "d", label: "D  Wochenende" },
  { key: "e", label: "E  Titelstory" },
];
const STORE = "nabs_home_top";

export function useHomeTopVariant() {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search).get("top");
    if (q && TOP_VARIANTS.some((v) => v.key === q)) {
      try {
        localStorage.setItem(STORE, q);
      } catch {
        /* ignore */
      }
      return q;
    }
    if (!isDevHost()) return null;
    try {
      return localStorage.getItem(STORE) || "now";
    } catch {
      return "now";
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

export function HomeTopPicker({ value, onChange }) {
  if (!value) return null;
  // On body: the page wrapper animates with a transform, which would pin a
  // fixed bar to the page instead of the screen.
  return createPortal(
    <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-3">
      <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/15 bg-black/85 p-1 shadow-2xl backdrop-blur-md">
        <span className="hidden whitespace-nowrap px-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/50 sm:inline">
          Home oben
        </span>
        {TOP_VARIANTS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => {
              onChange(v.key);
              window.scrollTo({ top: 0 });
            }}
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

// The countdown as one line of digits, with the sign-up (or Live now) beside it.
function InlineCountdown({ race, size = "text-2xl", showSeconds = true }) {
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
      {units.map((u, i) => (
        <span key={u.suffix} className={`font-mono leading-none ${i === 3 && !showSeconds ? "hidden" : ""}`}>
          <RollingNumber value={u.value} digits={2} className={`font-display font-black text-dark ${size}`} />
          <span className="ml-0.5 text-[10px] font-bold text-light">{u.suffix}</span>
        </span>
      ))}
    </div>
  );
}

function SignUp({ race, className = "", block = false }) {
  const { live, over } = useClock(race);
  if (!race || live || over) return null;
  return (
    <Link
      to={`/attendance?race=${race.id}`}
      className={`shine group inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-brand px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:brightness-105 ${
        block ? "w-full" : ""
      } ${className}`}
    >
      Sign up
      <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" strokeWidth={2.5} />
    </Link>
  );
}

function SeasonLine({ d, className = "" }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-light ${className}`}>
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
  );
}

function useResult(d) {
  const [tab, setTab] = useState("feature");
  const tabs = [
    { key: "feature", label: "Feature", result: topTen(d.feature) },
    d.sprint && { key: "sprint", label: "Sprint", result: topTen(d.sprint) },
  ].filter((t) => t && t.result.rows.length > 0);
  const open = tabs.find((t) => t.key === tab) || tabs[0] || null;
  const result = open?.result || null;
  const resultsTo = result?.race?.id ? `/races?race=${result.race.id}` : d.lastRace?.id ? `/races?race=${d.lastRace.id}` : "/races";
  return { tabs, open, setTab, result, resultsTo };
}

function RaceTabs({ r }) {
  if (r.tabs.length < 2) return null;
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-border bg-surface2 p-0.5" role="tablist" aria-label="Race">
      {r.tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={r.open?.key === t.key}
          onClick={() => r.setTab(t.key)}
          className={`rounded-md px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition ${
            r.open?.key === t.key ? "bg-brand text-onbrand" : "text-light hover:text-dark"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Avatar({ r, size = 34, logo = 16 }) {
  return (
    <span className="relative shrink-0">
      <DriverAvatar name={r.name} photoUrl={r.photoUrl} color={r.team.color} size={size} />
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

// P1 to P3 as three cards side by side, the winner first.
function PodiumTrio({ result, glass = false }) {
  const rows = result?.rows?.slice(0, 3) || [];
  if (!rows.length) return null;
  return (
    <ol className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3">
      {rows.map((r, i) => (
        <li key={r.driverId}>
          <Link
            to={`/drivers/${r.driverId}`}
            className={`group flex h-full flex-col items-center gap-2 rounded-xl border px-2 py-3 text-center transition sm:px-3 sm:py-4 ${
              glass
                ? "border-black/10 bg-white/70 backdrop-blur-md hover:bg-white/90 dark:border-white/10 dark:bg-white/[0.07] dark:hover:bg-white/[0.12]"
                : "border-border bg-surface2/60 hover:border-brand/40"
            }`}
          >
            <span className="font-display text-lg font-black leading-none tabular-nums" style={{ color: MEDAL_TEXT[i] }}>
              P{r.position}
            </span>
            <Avatar r={r} size={i === 0 ? 52 : 44} logo={18} />
            <span className="w-full min-w-0 leading-tight">
              <span className="flex items-center justify-center gap-1.5">
                <span className="truncate text-sm font-bold text-dark group-hover:text-brand">{r.name}</span>
                <FastestLap result={result} r={r} />
              </span>
              <span className="block truncate text-[11px] text-light">{r.team.name}</span>
            </span>
            {result.scores && (
              <span className="font-mono text-[11px] font-bold text-medium">
                <span className="font-display text-base font-black text-dark">{r.points ?? 0}</span> pts
              </span>
            )}
          </Link>
        </li>
      ))}
    </ol>
  );
}

function ResultRow({ r, result, dense = false }) {
  return (
    <li>
      <Link to={`/drivers/${r.driverId}`} className={`group flex items-center gap-3 ${dense ? "py-1.5" : "py-2"}`}>
        <span className="w-6 text-center font-display text-sm font-black tabular-nums text-light">{r.position}</span>
        <Avatar r={r} size={dense ? 26 : 30} logo={dense ? 12 : 14} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-bold text-dark group-hover:text-brand">{r.name}</span>
            <FastestLap result={result} r={r} />
          </span>
          {!dense && <span className="block truncate text-[11px] text-light">{r.team.name}</span>}
        </span>
        <Gained value={r.gained} />
        {result.scores && (
          <span className="min-w-[1.75rem] text-right font-display text-sm font-black tabular-nums text-dark">{r.points ?? 0}</span>
        )}
      </Link>
    </li>
  );
}

function ResultRows({ result, from = 3, to = 10, dense = false, columns = false }) {
  const rows = result?.rows?.slice(from, to) || [];
  if (!rows.length) return null;
  return (
    // Two columns read down, then across (4 5 6 7 | 8 9 10), like a results sheet.
    <ol
      className={columns ? "grid gap-x-8 sm:grid-flow-col sm:grid-cols-2 [&>li]:border-b [&>li]:border-border/60" : "divide-y divide-border/60"}
      style={columns ? { gridTemplateRows: `repeat(${Math.ceil(rows.length / 2)}, auto)` } : undefined}
    >
      {rows.map((r) => (
        <ResultRow key={r.driverId} r={r} result={result} dense={dense} />
      ))}
    </ol>
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

function ResultButtons({ r, d, small = false }) {
  const pad = small ? "px-4 py-2.5 text-xs" : "px-5 py-3 text-sm";
  return (
    <div className="flex flex-wrap gap-2.5">
      <Link
        to={r.resultsTo}
        className={`shine group inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand font-bold uppercase tracking-wide text-ink transition hover:brightness-105 sm:flex-none ${pad}`}
      >
        Full results <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" strokeWidth={2.5} />
      </Link>
      <Link
        to="/drivers"
        className={`inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-border font-bold uppercase tracking-wide text-dark transition hover:bg-surface2 sm:flex-none ${pad}`}
      >
        Standings
      </Link>
      {d.reportTo && (
        <Link
          to={d.reportTo}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/15 font-bold uppercase tracking-wide text-red-700 transition hover:bg-red-500/25 dark:text-red-200 sm:w-auto ${pad}`}
        >
          <FlagIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
          Report an incident
        </Link>
      )}
    </div>
  );
}

// The lead story as a picture with the headline on it. `className` sets the
// height (an aspect ratio or flex-1 with a minimum).
function LeadStory({ article, className = "", size = "md" }) {
  const title =
    size === "lg"
      ? "text-2xl sm:text-4xl lg:text-5xl"
      : size === "sm"
        ? "text-lg sm:text-xl"
        : "text-xl sm:text-2xl lg:text-[1.75rem]";
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
        <h3 className={`mt-2 max-w-3xl font-display font-extrabold leading-tight tracking-tight text-white ${title}`}>{article.title}</h3>
        {article.summary && size !== "sm" && (
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

function Headlines({ articles, className = "" }) {
  if (!articles.length) return null;
  return (
    <div className={`divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-card ${className}`}>
      {articles.map((a) => (
        <Headline key={a.id} article={a} />
      ))}
    </div>
  );
}

// Several headlines side by side in one box; a single one takes the width.
function HeadlineStrip({ articles, max = 4, className = "" }) {
  const list = articles.slice(0, max);
  if (!list.length) return null;
  const cols = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[list.length];
  return (
    <div
      className={`grid grid-cols-1 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-card sm:divide-y-0 sm:[&>*+*]:border-l sm:[&>*+*]:border-border ${cols} ${className}`}
    >
      {list.map((a) => (
        <Headline key={a.id} article={a} />
      ))}
    </div>
  );
}

// The news as a row under a full-width hero: picture cards from three
// articles on, a wider picture-beside-text card when there are only one or two.
function NewsRow({ articles }) {
  if (!articles.length) return null;
  const list = articles.slice(0, 4);
  return (
    <section>
      <ColumnHeader title="Latest news" to="/news" cta="All news" />
      {list.length >= 3 ? (
        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${list.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
          {list.map((a) => (
            <Card key={a.id} article={a} />
          ))}
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-4 ${list.length === 2 ? "lg:grid-cols-2" : ""}`}>
          {list.map((a) => (
            <Link
              key={a.id}
              to={`/news/${a.slug}`}
              className="card group flex overflow-hidden transition hover:-translate-y-0.5 hover:border-brand/50"
            >
              <div className="relative aspect-[16/10] w-2/5 shrink-0 overflow-hidden bg-surface2">
                <NewsCover article={a} className="transition duration-300 group-hover:scale-[1.03]" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-4 sm:p-5">
                <CategoryChip category={a.category} label={a.categoryLabel} className="self-start" />
                <h3 className="line-clamp-3 font-display text-base font-extrabold leading-tight tracking-tight text-dark sm:text-lg">{a.title}</h3>
                <div className="flex items-center gap-3 font-mono text-[11px] text-light">
                  <span>{fmtStamp(a.publishedAt)}</span>
                  {a.commentCount > 0 && <CommentCount count={a.commentCount} />}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function newsOf(d) {
  return d.news?.data?.articles || [];
}

function NewsLoading({ className = "" }) {
  return <div className={`skeleton w-full rounded-2xl ${className}`} />;
}

// The round's line: flag, track, round and date.
function RoundTitle({ d, big = false, label = true }) {
  const c = d.lastCircuit;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-eyebrow">
        {label && (
          <>
            <span>Latest result</span>
            <span className="h-3 w-px bg-border" />
          </>
        )}
        <span className={label ? "text-light" : ""}>Round {d.lastRace?.number ?? NO_VALUE}</span>
      </div>
      <div className="mt-1.5 flex min-w-0 items-center gap-2.5">
        {c && <Flag code={c.country} title={c.countryName} w={big ? 30 : 24} h={big ? 22 : 17} />}
        <span className={`truncate font-display font-black uppercase leading-none tracking-tight text-dark ${big ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"}`}>
          {d.lastRace?.track}
        </span>
      </div>
      {d.lastRace?.date && <div className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-light">{fmtDateLong(d.lastRace.date)}</div>}
    </div>
  );
}

// The next race as a compact panel: flag, track, outline, session plan,
// countdown and sign-up.
function NextRacePanel({ race, outline = true, bigClock = true, className = "" }) {
  if (!race) return null;
  const c = flagFor(race.track, race.country);
  const mark = outline && race.track ? circuitMark(race.track, { area: 9000, maxW: 150, maxH: 90, rotateBelow: 1 }) : null;
  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-4">
        <Link to={`/races?race=${race.id}`} className="group min-w-0">
          <div className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-light">
            <span className="text-eyebrow">Next race</span>
            <span className="h-3 w-px bg-border" />
            <span>{roundLabel(race)}</span>
            <span className="h-3 w-px bg-border" />
            <span>{dayLabel(race.date)}</span>
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            {c && <Flag code={c.country} title={c.countryName} w={24} h={17} />}
            <span className="truncate font-display text-2xl font-black uppercase leading-none tracking-tight text-dark group-hover:text-brand">
              {race.track || "TBA"}
            </span>
          </div>
          <SessionPlan race={race} className="mt-2 font-mono text-[11px] uppercase tracking-wider text-medium" />
        </Link>
        {mark && (
          <div className="pointer-events-none hidden shrink-0 text-dark opacity-25 sm:block" style={mark.style} aria-hidden="true">
            <CircuitMap track={race.track} animate rotate={mark.rotate} className="h-full w-full" strokeWidth={2.2} />
          </div>
        )}
      </div>
      {bigClock ? (
        <>
          <RaceCountdown date={race.date} className="mt-4" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-light">
              Lights out <span className="text-dark">{fmtRaceTime(race.date)}</span>
            </span>
            <SignUp race={race} />
          </div>
        </>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3">
          <InlineCountdown race={race} size="text-xl" />
          <SignUp race={race} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- variants ---

// A — One strip. The season line and the next race share one bar, and the
// two columns below get the same height: the news picture grows to meet the
// result, the result drops its photo strip and leads with the podium.
function VariantA({ d }) {
  const r = useResult(d);
  const articles = newsOf(d);
  const [lead, ...rest] = articles;
  const race = d.nextRace;
  const c = race ? flagFor(race.track, race.country) : null;
  return (
    <div className="-mt-2 space-y-8">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-card">
        <SeasonLine d={d} className="w-full lg:w-auto" />
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

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
        {d.news?.loading ? (
          <NewsLoading className="min-h-[420px]" />
        ) : (
          lead && (
            <section className="flex flex-col">
              <ColumnHeader title="Latest news" to="/news" cta="All news" />
              <LeadStory article={lead} className="aspect-[4/3] sm:aspect-auto sm:min-h-[340px] sm:flex-1" />
              <Headlines articles={rest.slice(0, 2)} className="mt-3" />
            </section>
          )
        )}
        <section className={`flex flex-col ${lead || d.news?.loading ? "" : "lg:col-span-2"}`}>
          <ColumnHeader title="Latest result" to="/races" cta="All rounds" />
          <div className="flex flex-1 flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <RoundTitle d={d} label={false} />
              <RaceTabs r={r} />
            </div>
            {r.result ? (
              <>
                <PodiumTrio result={r.result} />
                <ResultRows result={r.result} dense />
              </>
            ) : (
              <ResultPending d={d} />
            )}
            <div className="mt-auto pt-1">
              <ResultButtons r={r} d={d} small />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// B — The result leads. The round's photo carries a full-width result hero
// (podium big, the rest of the top ten beside it), the next race is the
// hero's bottom band, and the news runs as a row of cards under it.
function VariantB({ d }) {
  const r = useResult(d);
  const articles = newsOf(d);
  const race = d.nextRace;
  const c = race ? flagFor(race.track, race.country) : null;
  return (
    <div className="-mt-2 space-y-8">
      <SeasonLine d={d} />
      <section className="relative overflow-hidden rounded-[1.75rem] bg-white shadow-xl shadow-ink/20 ring-1 ring-black/10 dark:bg-ink dark:ring-white/10">
        <img src={d.photo} alt="" data-hero-fallback={d.photoFallback} onError={d.onPhotoError} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/85 to-white/30 dark:from-ink dark:via-ink/80 dark:to-ink/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-white/90 via-transparent to-transparent dark:from-ink/90" />

        <div className="relative grid grid-cols-1 gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
          <div className="flex flex-col justify-end gap-6">
            <div>
              <div className="flex items-center gap-3 font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                {d.lastCircuit && <Flag code={d.lastCircuit.country} title={d.lastCircuit.countryName} w={26} h={19} />}
                <span>Latest result</span>
                <span className="h-px w-8 bg-accent/50" />
                <span className="text-ink/55 dark:text-white/70">Round {d.lastRace?.number}</span>
              </div>
              <h1 className="mt-3 break-words font-display text-[clamp(2rem,9vw,4.5rem)] font-black uppercase leading-[0.92] tracking-tight text-ink dark:text-white">
                {d.lastRace?.track}
              </h1>
              {d.lastRace?.date && (
                <p className="mt-2 font-mono text-[12px] uppercase tracking-wider text-ink/65 dark:text-white/65">{fmtDateLong(d.lastRace.date)}</p>
              )}
            </div>
            <RaceTabs r={r} />
            {r.result ? <PodiumTrio result={r.result} glass /> : <ResultPending d={d} rows={3} />}
            <ResultButtons r={r} d={d} />
          </div>
          <div className="self-end rounded-2xl border border-black/10 bg-white/70 px-4 py-2 backdrop-blur-md dark:border-white/10 dark:bg-black/35">
            {r.result ? <ResultRows result={r.result} /> : <ResultPending d={d} rows={7} />}
          </div>
        </div>

        {race && (
          <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-black/10 bg-white/80 px-6 py-4 backdrop-blur-md dark:border-white/10 dark:bg-black/45 sm:px-10">
            <Link to={`/races?race=${race.id}`} className="group flex min-w-0 flex-1 items-center gap-3">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-eyebrow">Next</span>
              {c && <Flag code={c.country} title={c.countryName} w={24} h={17} />}
              <span className="truncate font-display text-lg font-black uppercase tracking-tight text-dark group-hover:text-brand">{race.track}</span>
              <span className="hidden whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-light md:inline">
                {roundLabel(race)} · {dayLabel(race.date)} · {fmtRaceTime(race.date)}
              </span>
            </Link>
            <div className="flex w-full items-center justify-between gap-5 sm:w-auto">
              <InlineCountdown race={race} size="text-xl" />
              <SignUp race={race} />
            </div>
          </div>
        )}
      </section>

      <NewsRow articles={articles} />
    </div>
  );
}

// C — Front page. The news gets the wide column like a newspaper's front;
// a sidebar stacks the next race (with its outline and the big clock) over a
// short top five of the latest round.
function VariantC({ d }) {
  const r = useResult(d);
  const articles = newsOf(d);
  const [lead, ...rest] = articles;
  return (
    <div className="-mt-2 space-y-6">
      <SeasonLine d={d} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
        <section className="flex flex-col lg:col-span-7">
          <ColumnHeader title="Latest news" to="/news" cta="All news" />
          {d.news?.loading ? (
            <NewsLoading className="aspect-[16/10]" />
          ) : lead ? (
            <>
              <LeadStory article={lead} size="lg" className="aspect-[4/3] sm:aspect-[16/10]" />
              <HeadlineStrip articles={rest} max={2} className="mt-3" />
            </>
          ) : (
            <p className="text-sm text-light">No news yet.</p>
          )}
        </section>

        <aside className="flex flex-col gap-6 lg:col-span-5">
          {d.nextRace && <NextRacePanel race={d.nextRace} className="rounded-2xl border border-border bg-card p-5 shadow-card" />}
          <div className="flex flex-1 flex-col rounded-2xl border border-border bg-card p-5 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <RoundTitle d={d} />
              <RaceTabs r={r} />
            </div>
            <div className="mt-3 flex-1">
              {r.result ? <ResultRows result={r.result} from={0} to={5} /> : <ResultPending d={d} rows={5} />}
            </div>
            <Link to={r.resultsTo} className="group mt-3 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-link">
              Full results <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

// D — Race weekend. One card tells the round from both sides: the race just
// run on the left (podium, then P4 to P10 in two columns), the next one on
// the right with its outline and clock. The news follows as a row of cards.
function VariantD({ d }) {
  const r = useResult(d);
  const articles = newsOf(d);
  const race = d.nextRace;
  const c = race ? flagFor(race.track, race.country) : null;
  const mark = race?.track ? circuitMark(race.track, { area: 32000, maxW: 360, maxH: 190, rotateBelow: 1 }) : null;
  return (
    <div className="-mt-2 space-y-8">
      <SeasonLine d={d} />
      <section className="grid grid-cols-1 overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-card lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5 p-5 sm:p-7">
          <div className="flex items-start justify-between gap-3">
            <RoundTitle d={d} big />
            <RaceTabs r={r} />
          </div>
          {r.result ? (
            <>
              <PodiumTrio result={r.result} />
              <ResultRows result={r.result} dense columns />
            </>
          ) : (
            <ResultPending d={d} />
          )}
          <div className="mt-auto">
            <ResultButtons r={r} d={d} small />
          </div>
        </div>

        {race && (
          <div className="flex flex-col border-t border-border bg-surface2/50 p-5 sm:p-7 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-light">
              <span className="text-eyebrow">Next race</span>
              <span className="h-3 w-px bg-border" />
              <span>{roundLabel(race)}</span>
              <span className="h-3 w-px bg-border" />
              <span>{dayLabel(race.date)}</span>
            </div>
            {mark && (
              <div className="my-6 flex flex-1 items-center justify-center" aria-hidden="true">
                <div className="text-dark opacity-40" style={mark.style}>
                  <CircuitMap track={race.track} animate rotate={mark.rotate} className="h-full w-full" strokeWidth={2} />
                </div>
              </div>
            )}
            <Link to={`/races?race=${race.id}`} className="group mt-auto flex min-w-0 items-center gap-2.5">
              {c && <Flag code={c.country} title={c.countryName} w={28} h={20} />}
              <span className="truncate font-display text-3xl font-black uppercase leading-none tracking-tight text-dark group-hover:text-brand">
                {race.track}
              </span>
            </Link>
            {c?.circuit && c.circuit.toLowerCase() !== race.track?.toLowerCase() && (
              <div className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-light">{c.circuit}</div>
            )}
            <SessionPlan race={race} className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-medium" />
            <RaceCountdown date={race.date} className="mt-5" />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-light">
                Lights out <span className="text-dark">{fmtRaceTime(race.date)}</span>
              </span>
              <SignUp race={race} />
            </div>
          </div>
        )}
      </section>

      <NewsRow articles={articles} />
    </div>
  );
}

// E — Cover story. The newest article runs across the whole width like a
// magazine cover, with the next race on a glass panel in its corner. Under
// it the other headlines in one strip, then the latest result across the
// page: podium on the left, P4 to P10 on the right.
function VariantE({ d }) {
  const r = useResult(d);
  const articles = newsOf(d);
  const [lead, ...rest] = articles;
  const race = d.nextRace;
  return (
    <div className="-mt-2 space-y-8">
      <SeasonLine d={d} />
      {d.news?.loading ? (
        <NewsLoading className="h-[420px]" />
      ) : lead ? (
        <section className="relative overflow-hidden rounded-[1.75rem] bg-ink shadow-xl shadow-ink/20 ring-1 ring-black/10 dark:ring-white/10">
          <div className="relative aspect-[4/3] sm:aspect-[16/9] lg:aspect-auto lg:h-[500px]">
            <div className="absolute inset-0">
              <NewsCover article={lead} />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
            <div className="absolute inset-0 hidden bg-gradient-to-r from-black/55 to-transparent sm:block" />
            <Link to={`/news/${lead.slug}`} className="absolute inset-0" aria-label={lead.title} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5 sm:p-10 lg:pr-[24rem]">
              <CategoryChip category={lead.category} label={lead.categoryLabel} />
              <h2 className="mt-3 max-w-3xl font-display text-2xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-4xl lg:text-5xl">
                {lead.title}
              </h2>
              {lead.summary && <p className="mt-2 line-clamp-2 hidden max-w-2xl text-sm leading-relaxed text-white/75 sm:block">{lead.summary}</p>}
              <div className="mt-3 flex items-center gap-3 font-mono text-[11px] text-white/60">
                <span>{fmtStamp(lead.publishedAt)}</span>
                {lead.commentCount > 0 && <CommentCount count={lead.commentCount} className="text-white/70" />}
              </div>
            </div>
          </div>
          {race && (
            // Under the picture on a phone, in its corner from lg up.
            <div className="dark relative border-t border-white/10 bg-ink p-5 lg:absolute lg:bottom-8 lg:right-8 lg:w-[21rem] lg:rounded-2xl lg:border lg:bg-black/55 lg:backdrop-blur-md">
              <NextRacePanel race={race} outline={false} bigClock={false} />
            </div>
          )}
        </section>
      ) : null}

      <HeadlineStrip articles={rest} />

      <section>
        <ColumnHeader title="Latest result" to="/races" cta="All rounds" />
        <div className="grid grid-cols-1 gap-6 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
          <div className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-3">
              <RoundTitle d={d} label={false} big />
              <RaceTabs r={r} />
            </div>
            {r.result ? <PodiumTrio result={r.result} /> : <ResultPending d={d} rows={3} />}
            <div className="mt-auto">
              <ResultButtons r={r} d={d} small />
            </div>
          </div>
          <div className="self-center">{r.result ? <ResultRows result={r.result} /> : <ResultPending d={d} rows={7} />}</div>
        </div>
      </section>
    </div>
  );
}

const VARIANTS = { a: VariantA, b: VariantB, c: VariantC, d: VariantD, e: VariantE };

export default function HomeTopVariant({ variant, data }) {
  const V = VARIANTS[variant];
  return V ? <V d={data} /> : null;
}
