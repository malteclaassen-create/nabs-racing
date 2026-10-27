import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Flag as FlagIcon } from "lucide-react";
import Flag from "./Flag.jsx";
import TeamLogo from "./TeamLogo.jsx";
import SeasonPicker from "./SeasonPicker.jsx";
import { DriverAvatar, MEDAL_TEXT, RollingNumber } from "./ui.jsx";
import { CategoryChip, CommentCount, NewsCover } from "../pages/News.jsx";
import { ColumnHeader, Headline } from "./HomeNews.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtRaceTime, raceKickoff, LIVE_WINDOW_MS } from "../utils/raceTime.js";
import { fmtDateLong, fmtStamp, isLapTime, NO_VALUE } from "../utils/format.js";
import { seasonGameLabel } from "../utils/seasonGame.js";

// ---------------------------------------------------------------------------
// The top of the member home while a season runs: one strip with the season
// and the next race (countdown, sign-up), then the latest news and the latest
// result side by side, the same width and the same height.
// ---------------------------------------------------------------------------

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
// a phone it keeps a fixed 4:3. The lead is the article the news desk chose
// as the main story, else the newest; the headlines are the rest, newest first.
function NewsColumn({ news }) {
  const articles = news?.data?.articles || [];
  const lead = news?.data?.lead || articles[0] || null;
  const rest = articles.filter((a) => a.id !== lead?.id);
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

const MEDAL = MEDAL_TEXT;

// A results payload's classified top ten, in finishing order. A DSQ/DNF row
// keeps the raw place it crossed the line in and must not stand in the list.
// The fastest lap is the admin-recorded one when there is one, else the
// quickest stored lap, the same rule the results table applies.
function topTen(payload) {
  const race = payload?.race || null;
  const all = payload?.results || [];
  const rows = all
    .filter((r) => r.position != null && (!r.status || r.status === "FINISHED"))
    .sort((a, b) => a.position - b.position)
    .slice(0, 10)
    .map((r) => ({
      ...r,
      team: (r.isSub && r.subForTeam) || r.effectiveTeam || r.team || {},
      gained: r.grid != null ? r.grid - r.position : null,
    }));
  const laps = all.filter((r) => isLapTime(r.bestLapMs));
  const fastestMs = laps.length ? Math.min(...laps.map((r) => r.bestLapMs)) : null;
  const fastestId = race?.fastestLapDriverId || laps.find((r) => r.bestLapMs === fastestMs)?.driverId || null;
  return {
    race,
    rows,
    fastestId,
    scores: race?.scores ?? (race?.type || "CHAMPIONSHIP") === "CHAMPIONSHIP",
  };
}

// How long ago the round was run, while that still reads as news.
function agoLabel(date) {
  const k = raceKickoff(date);
  if (!k) return null;
  const day = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(k)) / 86400000);
  if (days < 0) return null;
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return days < 14 ? `${days} days ago` : null;
}

// A sprint weekend gets a switcher between its two races, feature first, the
// one the championship is decided on.
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

function Gained({ value }) {
  if (value == null) return <span className="w-8" />;
  const title = value === 0 ? "Finished where they started" : `${Math.abs(value)} place${Math.abs(value) === 1 ? "" : "s"} ${value > 0 ? "gained" : "lost"} from the grid`;
  return (
    <span title={title} className={`w-8 text-right font-mono text-[11px] font-bold ${value > 0 ? "text-ok" : value < 0 ? "text-bad" : "text-faint"}`}>
      {value > 0 ? `▲${value}` : value < 0 ? `▼${-value}` : "–"}
    </span>
  );
}

// One line of the top ten: the podium a size up, its places in medal colour.
function ResultRow({ r, i, result }) {
  const big = i < 3;
  return (
    <li className="flex">
      <Link
        to={`/drivers/${r.driverId}`}
        className={`group -mx-2 flex flex-1 items-center gap-3 rounded-lg px-2 transition hover:bg-surface2 ${big ? "py-2.5" : "py-1.5"}`}
      >
        <span
          className={`w-6 shrink-0 text-center font-display font-black tabular-nums ${big ? "text-lg" : "text-sm text-light"}`}
          style={big ? { color: MEDAL[i] } : undefined}
        >
          {r.position}
        </span>
        <span className="relative shrink-0">
          <DriverAvatar name={r.name} photoUrl={r.photoUrl} color={r.team.color} size={big ? 36 : 28} />
          <TeamLogo
            id={r.team.id}
            name={r.team.name}
            color={r.team.color}
            logoUrl={r.team.logoUrl}
            size={big ? 16 : 13}
            className="absolute -bottom-1 -right-1.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
          />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-2">
            <span className={`truncate font-bold text-dark group-hover:text-brand ${big ? "text-[15px]" : "text-sm"}`}>{r.name}</span>
            {result.fastestId === r.driverId && (
              <span title="Fastest lap" className="rounded bg-fl/15 px-1.5 py-px font-mono text-[9px] font-bold text-fl">
                FL
              </span>
            )}
          </span>
          <span className="block truncate text-[11px] text-light">{r.team.name}</span>
        </span>
        <Gained value={r.gained} />
        {result.scores && (
          <span className={`min-w-[1.75rem] text-right font-display font-black tabular-nums text-dark ${big ? "text-base" : "text-sm"}`}>
            {r.points ?? 0}
          </span>
        )}
      </Link>
    </li>
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
      {/* Stewarding, for members, only while the report window is open. */}
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

// The latest result: the round's photo as a strip with the track written up
// it, and beside it a "Race result" heading over the top ten, so nobody has to
// work out which race the list belongs to. On a phone the strip stands down
// and the track moves into the line above the heading.
function ResultCard({ d }) {
  const r = useResult(d);
  const c = d.lastCircuit;
  const ago = agoLabel(d.lastRace?.date);
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
          <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-light">
                {c && (
                  <span className="sm:hidden">
                    <Flag code={c.country} title={c.countryName} w={22} h={16} />
                  </span>
                )}
                <span className="truncate">
                  <span className="sm:hidden">{d.lastRace?.track} · </span>
                  Round {d.lastRace?.number ?? NO_VALUE}
                  {ago ? ` · ${ago}` : d.lastRace?.date ? ` · ${fmtDateLong(d.lastRace.date)}` : ""}
                </span>
              </div>
              <div className="mt-1 font-display text-2xl font-black uppercase leading-none tracking-tight text-dark">Race result</div>
            </div>
            <RaceTabs r={r} />
          </div>
          {r.result ? (
            <ol className="divide-y divide-border/60">
              {r.result.rows.map((row, i) => (
                <ResultRow key={row.driverId} r={row} i={i} result={r.result} />
              ))}
            </ol>
          ) : d.feature ? (
            <p className="py-10 text-center text-sm text-light">The classification is on its way.</p>
          ) : (
            // Still loading: hold the rows' place so the buttons do not jump.
            <div className="flex flex-col gap-2 py-2" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, i) => (
                <span key={i} className="skeleton h-9 w-full rounded-lg" />
              ))}
            </div>
          )}
          <div className="mt-auto pt-1">
            <ResultButtons r={r} d={d} />
          </div>
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- export ---

export default function HomeTop({ data }) {
  const hasNews = data.news?.loading || (data.news?.data?.articles?.length || 0) > 0;
  return (
    <div className="-mt-2 space-y-8">
      <TopStrip d={data} />
      <div className={`grid grid-cols-1 items-stretch gap-6 lg:gap-8 ${hasNews ? "lg:grid-cols-2" : ""}`}>
        {hasNews && <NewsColumn news={data.news} />}
        <ResultCard d={data} />
      </div>
    </div>
  );
}
