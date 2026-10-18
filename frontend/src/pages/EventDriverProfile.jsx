// ---------------------------------------------------------------------------
// A driver's page inside a special event (Series.kind "event").
//
// An event is one race, so the championship profile (standings, season form,
// drop rounds, a "Reserve" team) has nothing to say there. This page answers
// what a visitor of the event wants to know about a person instead:
//   - their number and whether they are on the grid (seat, waiting list, not
//     signed up), with the way in when it is your own page,
//   - once the flag has fallen, how their race went,
//   - who they are in the league's championships, with links back to them.
//
// Everything comes from three reads the site already has: the person's career
// (GET /api/career/<key>, every league in one go), the event's entry list
// (GET /api/events) and the event's race (useEventRace). A person who never
// signed up still gets the page: it simply says they are not entered.
// ---------------------------------------------------------------------------
import { useCallback, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, CircleCheck, CircleDashed, Clock, Flag as FlagIcon, Hourglass, Radio, Timer, Trophy } from "lucide-react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useEventRace } from "../hooks/useEventRace.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeries, useSeriesPath } from "../context/SeriesContext.jsx";
import { DriverAvatar, Skeleton } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import SocialLinks from "../components/SocialLinks.jsx";
import { raceKickoff } from "../utils/raceTime.js";
import { fmtLap, NO_VALUE } from "../utils/format.js";
import { useSpecificTitle } from "../utils/pageTitle.js";

const EYEBROW = "font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow sm:text-[11px]";

const ordinal = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The address form of a name, same rule as the server's driverHandle
// (backend/src/lib/driverHandles.js): "Max Mustermann" -> "max_mustermann".
const handleOf = (name) =>
  String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "driver";

// Where the person stands on the event's entry list. `rowIds` are the
// person's driver rows the career knows; the event row itself is only in
// there once it has a start (or its season is the active one), so a sign-up
// also counts when its name gives the person's handle.
export function entryStatus(ev, rowIds, handle) {
  if (!ev) return { kind: "none" };
  const at = (list) => (list || []).findIndex((r) => rowIds.has(r.driverId) || (handle && handleOf(r.name) === handle));
  const lists = ev.rsvps || {};
  const seat = at(lists.ACCEPTED);
  if (seat >= 0) return { kind: "in", seat: seat + 1, entry: lists.ACCEPTED[seat] };
  const queue = at(lists.WAITLIST);
  if (queue >= 0) return { kind: "waiting", place: queue + 1, entry: lists.WAITLIST[queue] };
  const maybe = at(lists.TENTATIVE);
  if (maybe >= 0) return { kind: "maybe", entry: lists.TENTATIVE[maybe] };
  const out = at(lists.DECLINED);
  if (out >= 0) return { kind: "out", entry: lists.DECLINED[out] };
  return { kind: "none" };
}

export default function EventDriverProfile() {
  const { id } = useParams();
  const { current: series, slug } = useSeries();
  const { seriesPath } = useSeriesPath();
  const { current: season } = useSeason();
  const { user } = useAuth();

  const career = useApi(useCallback(() => api.career(id), [id]));
  const events = useApi(useCallback(() => api.events(), []));
  const { race, phase, loading: raceLoading } = useEventRace(true);

  const data = career.data;
  const person = data?.person || null;
  useSpecificTitle(person ? `${person.name} · ${series?.name || "Special event"}` : null);

  // Every row of the person, plus the address itself (an old row-id link).
  const rowIds = useMemo(() => {
    const ids = new Set([id]);
    for (const l of data?.leagues || []) for (const s of l.seasons || []) ids.add(s.driverId);
    return ids;
  }, [data, id]);

  if (career.loading || raceLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-52 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }
  if (!person) {
    return (
      <div className="content-in card flex flex-col items-center gap-3 px-6 py-14 text-center">
        <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-dark">Driver not found</h1>
        <p className="text-sm text-medium">Nobody by that name has raced with us yet.</p>
        <Link to={seriesPath("/attendance")} className="text-sm font-semibold text-link hover:underline">
          Entry list of {series?.name || "the event"} →
        </Link>
      </div>
    );
  }

  const ev = (events.data || []).find((e) => e.id === race?.id) || null;
  const status = entryStatus(ev, rowIds, person.key);
  const capacity = ev?.capacity || 40;
  const number = status.entry?.number ?? person.number ?? null;
  const isMe = !!user?.driverId && rowIds.has(user.driverId);
  const hasSocials = Object.values(person.socials || {}).some(Boolean);

  // How their race went, once the result is in. The event's own row only.
  const result =
    phase === "after"
      ? (data.races || []).find((r) => r.seriesSlug === slug && !r.sprint && (!race || r.raceId === race.id)) || null
      : null;

  // The championships they race in, without the event itself.
  const leagues = (data.leagues || []).filter((l) => l.slug !== slug);
  const titles = (data.titles || []).filter((t) => t.kind === "driver" && t.position === 1 && t.seriesSlug !== slug);

  return (
    <div className="content-in space-y-5">
      <Hero
        person={person}
        number={number}
        series={series}
        status={status}
        capacity={capacity}
        phase={phase}
        result={result}
        isMe={isMe}
        signUpTo={race ? seriesPath(`/attendance?race=${race.id}`) : seriesPath("/attendance")}
        gridFull={!!ev?.gridFull}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RaceCard race={race} phase={phase} result={result} status={status} car={season?.game || series?.game || null} />
        <LeagueCard person={person} leagues={leagues} titles={titles} />
      </div>

      {(person.bio || hasSocials) && (
        <section className="card space-y-3 p-6">
          <div className={EYEBROW}>About</div>
          {person.bio && <p className="max-w-prose whitespace-pre-line text-[15px] leading-relaxed text-medium">{person.bio}</p>}
          <SocialLinks links={person.socials} />
        </section>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
        <Link to={seriesPath("/attendance")} className="text-link hover:underline">
          Full entry list →
        </Link>
        <Link to={seriesPath("")} className="text-link hover:underline">
          About {series?.name || "the event"} →
        </Link>
      </div>
    </div>
  );
}

// --- the top: who, which car, on the grid or not ------------------------------

function Hero({ person, number, series, status, capacity, phase, result, isMe, signUpTo, gridFull }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-ink text-white">
      {/* The number, huge and faint, behind everything: the car is the entry. */}
      {number != null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-4 -top-10 select-none font-display text-[180px] font-black leading-none tracking-tighter text-white/[0.06] sm:-top-16 sm:text-[300px]"
        >
          {number}
        </span>
      )}
      <div className="relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-5 p-5 sm:gap-x-7 sm:p-8">
        <DriverAvatar
          name={person.name}
          photoUrl={person.photoUrl}
          fallbacks={person.photoFallbacks}
          color="#334155"
          size={96}
          className="!h-16 !w-16 text-2xl !ring-white/15 sm:row-span-2 sm:!h-24 sm:!w-24 sm:text-4xl"
        />
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-brand sm:text-[11px]">
            {series?.name || "Special event"}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Flag code={person.country} w={30} h={22} />
            <h1 className="min-w-0 break-words font-display text-[28px] font-black uppercase leading-none tracking-tight sm:text-5xl">
              {person.name}
            </h1>
          </div>
          {person.formerName && <div className="mt-1 text-xs font-medium text-white/60">raced as {person.formerName}</div>}
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-1 sm:col-start-2">
          {number != null && (
            <span className="inline-flex items-baseline gap-1 rounded-lg bg-white/10 px-3 py-1.5 font-display font-black tabular-nums">
              <span className="text-sm text-white/60">#</span>
              <span className="text-2xl leading-none text-brand">{number}</span>
            </span>
          )}
          <StatusChip status={status} capacity={capacity} phase={phase} result={result} />
          {isMe && phase === "before" && (status.kind === "none" || status.kind === "maybe" || status.kind === "out") && (
            <Link
              to={signUpTo}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-brand px-4 text-sm font-extrabold uppercase tracking-wide text-ink transition hover:brightness-110"
            >
              {gridFull ? "Join the waiting list" : "Sign up"}
              <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusChip({ status, capacity, phase, result }) {
  let Icon = CircleDashed;
  let text = "Not entered";
  let tone = "bg-white/10 text-white/75";
  if (phase === "after" && result) {
    Icon = FlagIcon;
    text = result.status === "FINISHED" && result.position != null ? `Finished P${result.position}` : result.status === "DNS" ? "Did not start" : "Did not finish";
    tone = result.position === 1 && result.status === "FINISHED" ? "bg-brand text-ink" : "bg-white/10 text-white";
  } else if (phase === "after") {
    text = "Not in the result";
  } else if (status.kind === "in") {
    Icon = CircleCheck;
    text = `On the grid · seat ${status.seat} of ${capacity}`;
    tone = "bg-emerald-500/15 text-emerald-300";
  } else if (status.kind === "waiting") {
    Icon = Hourglass;
    text = `Waiting list · ${ordinal(status.place)} in line`;
    tone = "bg-amber-400/15 text-amber-200";
  } else if (status.kind === "maybe") {
    Icon = Clock;
    text = "Not sure yet";
  } else if (status.kind === "out") {
    text = "Sitting this one out";
  }
  return (
    <span className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 text-sm font-bold ${tone}`}>
      <Icon className="h-4 w-4 shrink-0" strokeWidth={2.25} />
      {text}
    </span>
  );
}

// --- race night: the facts before, the race after -----------------------------

function RaceCard({ race, phase, result, status, car }) {
  const { seriesPath } = useSeriesPath();
  const kickoff = race ? raceKickoff(race.date) : null;
  const days = kickoff ? Math.ceil((kickoff.getTime() - Date.now()) / 86400e3) : null;

  if (phase === "after") {
    return (
      <section className="card flex flex-col gap-5 p-6">
        <div className={EYEBROW}>Their race</div>
        {result ? (
          <>
            <div className="flex items-end gap-4">
              <div className="font-display text-6xl font-black leading-none tabular-nums text-dark">
                {result.status === "FINISHED" && result.position != null ? `P${result.position}` : result.status || NO_VALUE}
              </div>
              <div className="pb-1 text-sm text-medium">{race?.track || result.track}</div>
            </div>
            <dl className="grid grid-cols-3 divide-x divide-border border-y border-border">
              <Fact label="Started" value={result.grid != null ? `P${result.grid}` : NO_VALUE} />
              <Fact label="Best lap" value={result.bestLapMs ? fmtLap(result.bestLapMs) : NO_VALUE} />
              <Fact label="Places" value={gained(result)} />
            </dl>
            {(result.pole || result.fastestLap) && (
              <div className="flex flex-wrap gap-2 text-sm font-semibold text-medium">
                {result.pole && (
                  <span className="inline-flex items-center gap-1.5">
                    <Timer className="h-4 w-4 text-brand" strokeWidth={2.25} /> Pole position
                  </span>
                )}
                {result.fastestLap && (
                  <span className="inline-flex items-center gap-1.5">
                    <Timer className="h-4 w-4 text-brand" strokeWidth={2.25} /> Fastest lap of the race
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-medium">Not in the result of this race.</p>
        )}
        {race && (
          <Link to={seriesPath(`/races?race=${race.id}`)} className="mt-auto text-sm font-bold text-link hover:underline">
            Full result →
          </Link>
        )}
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-5 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <div className={EYEBROW}>Race night</div>
        {phase === "live" ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-red-500">
            <Radio className="h-3.5 w-3.5" strokeWidth={2.25} /> Live now
          </span>
        ) : (
          days != null &&
          days > 0 && <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">in {plural(days, "day")}</span>
        )}
      </div>
      <dl className="divide-y divide-border">
        <Row label="Circuit" value={race?.track || "TBA"} />
        <Row
          label="Lights out"
          value={kickoff ? `${kickoff.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${kickoff.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "TBA"}
          hint={kickoff ? "your time" : null}
        />
        <Row label="Car" value={car || "TBA"} />
        <Row label="Distance" value={race?.raceLaps ? plural(race.raceLaps, "lap") : "TBA"} />
      </dl>
      {phase === "live" || phase === "pending" ? (
        <Link to={seriesPath("/live")} className="mt-auto text-sm font-bold text-link hover:underline">
          Live timing →
        </Link>
      ) : status.kind === "in" ? (
        <Link to="/downloads" className="mt-auto text-sm font-bold text-link hover:underline">
          Get the files →
        </Link>
      ) : null}
    </section>
  );
}

function gained(r) {
  if (r.status !== "FINISHED" || r.grid == null || r.position == null) return NO_VALUE;
  const d = r.grid - r.position;
  return d > 0 ? `+${d}` : d < 0 ? `${d}` : "±0";
}

function Fact({ label, value }) {
  return (
    <div className="px-3 py-3 first:pl-0">
      <dt className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{label}</dt>
      <dd className="mt-1 font-display text-xl font-black tabular-nums text-dark">{value}</dd>
    </div>
  );
}

function Row({ label, value, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-light">{label}</dt>
      <dd className="min-w-0 text-right text-[15px] font-semibold text-dark">
        {value}
        {hint && <span className="ml-1.5 text-xs font-medium text-light">{hint}</span>}
      </dd>
    </div>
  );
}

// --- who they are in the championships ------------------------------------------

function LeagueCard({ person, leagues, titles }) {
  const sum = (k) => leagues.reduce((n, l) => n + l.seasons.reduce((m, s) => m + (s[k] || 0), 0), 0);
  const starts = sum("starts");
  const lines = leagues
    .map((l) => {
      const raced = l.seasons.filter((s) => s.starts > 0);
      const nums = raced.map((s) => s.seasonNumber).filter((n) => n != null);
      const best = raced.map((s) => s.position).filter((p) => p != null);
      const newest = [...l.seasons].sort((a, b) => (b.seasonNumber ?? 0) - (a.seasonNumber ?? 0))[0];
      return {
        slug: l.slug,
        name: l.name,
        handle: newest?.handle || person.key,
        seasons: raced.length,
        from: nums.length ? Math.min(...nums) : null,
        to: nums.length ? Math.max(...nums) : null,
        starts: raced.reduce((n, s) => n + s.starts, 0),
        wins: raced.reduce((n, s) => n + s.wins, 0),
        best: best.length ? Math.min(...best) : null,
      };
    })
    .filter((l) => l.starts > 0)
    .sort((a, b) => b.starts - a.starts);

  return (
    <section className="card flex flex-col gap-5 p-6">
      <div className={EYEBROW}>In the league</div>
      {lines.length === 0 ? (
        <p className="text-[15px] text-medium">First race with NABS. This event is their debut.</p>
      ) : (
        <>
          <dl className="grid grid-cols-4 divide-x divide-border border-y border-border">
            <Fact label="Starts" value={starts} />
            <Fact label="Wins" value={sum("wins")} />
            <Fact label="Podiums" value={sum("podiums")} />
            <Fact label="Titles" value={titles.length} />
          </dl>
          <ul className="divide-y divide-border">
            {lines.map((l) => (
              <li key={l.slug}>
                <Link
                  to={`/s/${l.slug}/drivers/${l.handle}`}
                  className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition hover:bg-surface2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold text-dark">{l.name}</div>
                    <div className="truncate text-sm text-light">
                      {l.from != null && (l.from === l.to ? `Season ${l.from}` : `Seasons ${l.from} to ${l.to}`)}
                      {` · ${plural(l.starts, "start")}`}
                      {l.wins > 0 ? ` · ${plural(l.wins, "win")}` : ""}
                      {l.best != null ? ` · best P${l.best}` : ""}
                    </div>
                  </div>
                  {titles.some((t) => t.seriesSlug === l.slug) && <Trophy className="h-4 w-4 shrink-0 text-brand" strokeWidth={2.25} />}
                  <ArrowRight className="h-4 w-4 shrink-0 text-light transition group-hover:translate-x-0.5" strokeWidth={2.25} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {lines.length > 0 && (
        <Link to={`/career/${person.key}`} className="mt-auto text-sm font-bold text-link hover:underline">
          Whole career →
        </Link>
      )}
    </section>
  );
}
