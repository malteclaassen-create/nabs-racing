import { useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { useSeries, useSeriesPath } from "../context/SeriesContext.jsx";
import { useEventRace } from "../hooks/useEventRace.js";
import { useLiveTiming } from "../hooks/useLiveTiming.js";
import EventFilm from "../components/EventFilm.jsx";
import Flag from "../components/Flag.jsx";
import NextRaceCard from "../components/NextRaceCard.jsx";
import { Skeleton } from "../components/ui.jsx";
import { flagFor } from "../data/circuits.js";
import { raceKickoff } from "../utils/raceTime.js";
import { fmtDuration, fmtGap } from "../utils/raceDuration.js";
import { fmtLap, fmtRaceDate } from "../utils/format.js";

// ---------------------------------------------------------------------------
// The home page of a special event (Series.kind "event"): one race in a series
// of its own, so instead of a season's home it shows that race, and changes
// with where it stands (utils/eventPhase.js):
//
//   before   the promo film as the main card (its last frame carries the
//            facts), the race card (circuit, countdown, sign-up), the four
//            things a driver needs to know, and every seat of the grid, taken
//            or free.
//   live     the running order straight from the live timing, lap count and
//            the way into the full live page. "pending" (run, result not in
//            yet) is the same page saying so.
//   after    the winner on the race's own picture, the podium, the ways back
//            into the race (replay, photos, highlights) and the top ten.
//
// Members and visitors get the same page: an event is one evening, and what a
// newcomer needs (when, what, how to get in) is what a member needs too.
// ---------------------------------------------------------------------------

const EYEBROW = "font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow";

export default function EventHome() {
  const { current: series } = useSeries();
  const { race, phase, loading } = useEventRace(true);

  if (loading) {
    return (
      <div className="content-in space-y-5">
        <Skeleton className="aspect-video w-full rounded-[1.75rem] lg:w-2/3" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }
  if (phase === "after") return <EventAfter series={series} race={race} />;
  if (phase === "live" || phase === "pending") return <EventLive series={series} race={race} pending={phase === "pending"} />;
  return <EventBefore series={series} race={race} />;
}

// The season's own pictures, for a card without a film to show.
function useStill() {
  const { current: season } = useSeason();
  return season?.heroImageUrl || season?.carImageUrl || null;
}

// The film card (16:9, so nothing of the facts in its last frame is cropped)
// with the event's name over a still when there is no film.
function FilmCard({ series, race, children }) {
  const still = useStill();
  return (
    <section
      aria-label="Promo film"
      className="relative aspect-video min-w-0 flex-[999_1_640px] overflow-hidden rounded-[1.75rem] bg-ink shadow-xl shadow-ink/20 ring-1 ring-black/10 dark:ring-white/10"
    >
      <EventFilm
        src={series?.promoVideoUrl}
        loop={series?.promoLoopUrl}
        fallback={still}
        alt={`${series?.name || "Special event"}${race?.track ? `, ${race.track}` : ""}`}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-7 text-white sm:p-10">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-brand">★ Special event</div>
          <h1 className="mt-2 font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">
            {series?.name}
          </h1>
          {race?.track && <div className="mt-2 font-display text-lg font-bold">{race.track}</div>}
        </div>
      </EventFilm>
      {children}
    </section>
  );
}

// --- BEFORE ------------------------------------------------------------------

function EventBefore({ series, race }) {
  const { seriesPath } = useSeriesPath();
  const { current: season } = useSeason();
  const events = useApi(useCallback(() => api.events(), []));
  const ev = (events.data || []).find((e) => e.id === race?.id) || null;
  const kickoff = race ? raceKickoff(race.date) : null;

  const capacity = ev?.capacity || 40;
  const taken = ev?.rsvps?.ACCEPTED || [];
  const car = season?.game || series?.game || null;

  // What the button can honestly offer right now.
  let signUp = "Sign up";
  if (ev?.gridFull) signUp = "Grid full · join the waiting list";
  else if (ev && !ev.attendanceOpen && ev.attendanceOpensAt) signUp = `Sign-up opens ${fmtRaceDate(ev.attendanceOpensAt)}`;

  return (
    <div className="content-in space-y-5">
      <div className="flex flex-wrap items-stretch gap-5">
        <FilmCard series={series} race={race} />

        {/* The race card: the same card as the next race on a championship's
            home (circuit, countdown, date, the way in), with how full the grid
            is above the button. */}
        {race ? (
          <NextRaceCard
            race={race}
            corner="Special event"
            to={seriesPath(`/attendance?race=${race.id}`)}
            cta={signUp}
            className="flex min-w-0 flex-[1_1_320px] flex-col"
          >
            <div className="mt-5">
              <div className="flex justify-between font-mono text-[11px] font-bold uppercase tracking-wider text-ink/60 dark:text-white/65">
                <span>Seats taken</span>
                <span>
                  {taken.length} / {capacity}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10 dark:bg-white/15">
                <div className="h-full bg-brand" style={{ width: `${Math.min(100, (taken.length / capacity) * 100)}%` }} />
              </div>
            </div>
          </NextRaceCard>
        ) : (
          <aside aria-label="Race card" className="card flex flex-[1_1_320px] flex-col justify-center gap-2 p-5">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Next Race</div>
            <div className="font-display text-2xl font-black uppercase tracking-tight text-dark">Date to be announced</div>
          </aside>
        )}
      </div>

      {/* Four tiles: what a driver needs to know. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Your time">
          <div className="font-display text-2xl font-black text-dark sm:text-3xl">
            {kickoff ? kickoff.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "TBA"}
          </div>
          {kickoff && (
            <div className="text-sm text-light">
              {kickoff.toLocaleDateString(undefined, { weekday: "long" })} · your time zone
            </div>
          )}
        </Tile>
        <Tile label="Distance">
          <div className="font-display text-2xl font-black text-dark sm:text-3xl">{race?.raceLaps ? `${race.raceLaps} laps` : "TBA"}</div>
          {race?.qualiMinutes ? <div className="text-sm text-light">Qualifying {race.qualiMinutes} min</div> : null}
        </Tile>
        <Tile label="The car">
          <div className="font-display text-2xl font-black leading-tight text-dark">{car || "TBA"}</div>
          <Link to="/downloads" className="text-sm font-bold text-link hover:underline">
            Get the files
          </Link>
        </Tile>
        <Tile label="Grid">
          <div className="font-display text-2xl font-black text-dark sm:text-3xl">{capacity} cars</div>
          <div className="text-sm text-light">{Math.max(0, capacity - taken.length)} seats still free</div>
        </Tile>
      </div>

      {/* Every seat of the grid at once, taken and free. */}
      <section aria-labelledby="seats-h" className="card space-y-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="seats-h" className="font-display text-2xl font-black uppercase tracking-tight text-dark">
            {capacity} seats
          </h2>
          <span className="flex gap-4 text-sm text-light">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[3px] bg-ink dark:bg-white" />
              taken
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[3px] border-[1.5px] border-dashed border-slate-400" />
              free
            </span>
          </span>
        </div>
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-10">
          {Array.from({ length: capacity }, (_, i) => {
            const d = taken[i];
            return d ? (
              <li
                key={d.driverId}
                title={d.name}
                className="flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl bg-ink px-1 text-white dark:bg-white dark:text-ink"
              >
                <span className="font-mono text-base font-bold text-brand dark:text-ink">{d.number != null ? `#${d.number}` : "·"}</span>
                <span className="max-w-full truncate text-[11px] font-semibold">{d.name}</span>
              </li>
            ) : (
              <li
                key={`free-${i}`}
                className="flex h-16 items-center justify-center rounded-xl border-[1.5px] border-dashed border-slate-400 font-mono text-xs text-light"
              >
                P{i + 1}
              </li>
            );
          })}
        </ul>
        <Link to={seriesPath("/attendance")} className="inline-block text-sm font-bold text-link hover:underline">
          Full entry list →
        </Link>
      </section>
    </div>
  );
}

function Tile({ label, children }) {
  return (
    <div className="card p-5">
      <div className={EYEBROW}>{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

// --- LIVE ----------------------------------------------------------------------

function EventLive({ series, race, pending }) {
  const { seriesPath } = useSeriesPath();
  const { board } = useLiveTiming();
  const session = board?.session || null;
  const racing = !pending && board?.connected && session?.type === "Race";
  const order = racing ? [...(board.entries || [])].filter((e) => !e.isSafetyCar).sort((a, b) => (a.position ?? 999) - (b.position ?? 999)) : [];
  const lap = order[0]?.lapCount ?? null;
  const fastest = order.reduce((best, e) => (e.bestLapMs > 0 && (!best || e.bestLapMs < best.bestLapMs) ? e : best), null);

  return (
    <div className="content-in space-y-5">
      <div className="flex flex-wrap items-stretch gap-5">
        <FilmCard series={series} race={race}>
          <div className="pointer-events-none absolute left-5 top-5 z-10 inline-flex items-center gap-2 rounded-full bg-red-600 px-3.5 py-2 font-mono text-xs font-bold uppercase tracking-widest text-white">
            {pending ? (
              "Race run · results coming soon"
            ) : (
              <>
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                Live{lap != null && session?.raceLaps ? ` · lap ${lap} / ${session.raceLaps}` : session?.name ? ` · ${session.name}` : ""}
              </>
            )}
          </div>
        </FilmCard>

        <aside aria-label="Running order" className="flex flex-[1_1_320px] flex-col gap-4 rounded-[1.75rem] bg-ink p-6 text-white">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-brand">
            {racing ? "Running order" : pending ? "Chequered flag" : session?.name || "Race night"}
          </div>
          {order.length > 0 ? (
            <ol className="space-y-1.5">
              {order.slice(0, 5).map((e, i) => (
                <li key={e.guid || e.name} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${i === 0 ? "bg-white/10" : ""}`}>
                  <span className={`w-6 font-mono font-bold ${i === 0 ? "text-brand" : ""}`}>{e.position ?? i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{e.name}</span>
                  <span className="font-mono text-xs text-slate-300">
                    {i === 0 ? "Leader" : e.lapsDown > 0 ? `+${e.lapsDown} lap${e.lapsDown === 1 ? "" : "s"}` : fmtGap(e.gapToLeaderMs) || ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-300">
              {pending
                ? "The race has been run. The result lands here as soon as the league office has saved it."
                : "The running order shows here once the race session is on."}
            </p>
          )}
          <Link
            to={seriesPath("/live")}
            className="mt-auto flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-red-600 text-[15px] font-extrabold uppercase tracking-wide text-white transition hover:bg-red-700"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path d="M7 5l12 7-12 7z" />
            </svg>
            Full live timing
          </Link>
        </aside>
      </div>

      {!racing && (
        // Before the green flag (practice, qualifying) and after the flag:
        // the facts of the race, and the way to who is in it.
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label="Lights out, your time">
            <div className="font-display text-2xl font-black text-dark sm:text-3xl">
              {raceKickoff(race?.date)?.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) || "–"}
            </div>
          </Tile>
          <Tile label="Distance">
            <div className="font-display text-2xl font-black text-dark sm:text-3xl">{race?.raceLaps ? `${race.raceLaps} laps` : "TBA"}</div>
          </Tile>
          <Tile label="The car">
            <div className="font-display text-2xl font-black leading-tight text-dark">{series?.game || "TBA"}</div>
          </Tile>
          <Tile label="Who is racing">
            <Link to={seriesPath("/attendance")} className="font-display text-xl font-black uppercase text-link hover:underline">
              Entry list →
            </Link>
          </Tile>
        </div>
      )}

      {racing && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label="Laps to go">
            <div className="font-display text-2xl font-black text-dark sm:text-3xl">{session.lapsLeft ?? "–"}</div>
          </Tile>
          <Tile label="Leader">
            <div className="truncate font-display text-2xl font-black text-dark">{order[0]?.name || "–"}</div>
          </Tile>
          <Tile label="Fastest lap">
            <div className="font-display text-2xl font-black text-dark sm:text-3xl">{fastest ? fmtLap(fastest.bestLapMs) : "–"}</div>
            {fastest && <div className="truncate text-sm text-light">{fastest.name}</div>}
          </Tile>
          <Tile label="On track">
            <div className="font-display text-2xl font-black text-dark sm:text-3xl">
              {session.onTrackCount ?? "–"}
              {session.driverCount ? <span className="text-light"> / {session.driverCount}</span> : null}
            </div>
          </Tile>
        </div>
      )}
    </div>
  );
}

// --- AFTER ---------------------------------------------------------------------

function EventAfter({ series, race }) {
  const { seriesPath } = useSeriesPath();
  const { seriesList } = useSeries();
  const { current: season } = useSeason();
  const detail = useApi(useCallback(() => api.raceResults(race.id), [race.id]));
  const results = detail.data?.results || [];
  const info = detail.data?.race || {};
  const photos = detail.data?.photos || [];

  const classified = results
    .filter((r) => r.status === "FINISHED" && r.position != null)
    .sort((a, b) => a.position - b.position);
  const winner = classified[0] || null;
  const margin = winner && classified[1] && classified[1].laps === winner.laps ? classified[1].totalTimeMs - winner.totalTimeMs : null;
  const flId = info.fastestLapDriverId || results.reduce((b, r) => (r.bestLapMs > 0 && (!b || r.bestLapMs < b.bestLapMs) ? r : b), null)?.driverId;
  const fastest = results.find((r) => r.driverId === flId) || null;
  const dotd = info.driverOfTheDay?.name || null;
  const picture = race.heroImageUrl || photos[0]?.url || season?.heroImageUrl || season?.carImageUrl || null;
  const flag = flagFor(race.track, race.country);
  const highlights = info.highlightsUrl || race.highlightsUrl || null;
  const resultPath = seriesPath(`/races?race=${race.id}`);

  // Somewhere to go once the night is over: the next special event, else the
  // league's main series.
  const now = Date.now();
  const nextEvent = seriesList
    .filter((s) => s.kind === "event" && s.id !== series?.id && s.eventAt && new Date(s.eventAt).getTime() > now)
    .sort((a, b) => new Date(a.eventAt) - new Date(b.eventAt))[0];
  const primary = seriesList.find((s) => s.isActive) || seriesList.find((s) => s.kind !== "event");

  if (detail.loading && !detail.data) {
    return (
      <div className="content-in space-y-5">
        <Skeleton className="aspect-video w-full rounded-[1.75rem] lg:w-2/3" />
      </div>
    );
  }

  return (
    <div className="content-in space-y-5">
      <div className="flex flex-wrap items-stretch gap-5">
        {/* The winner, on the race's own picture. */}
        <section
          aria-label="Winner"
          className="relative aspect-video min-w-0 flex-[999_1_640px] overflow-hidden rounded-[1.75rem] bg-ink shadow-xl shadow-ink/20 ring-1 ring-black/10 dark:ring-white/10"
        >
          {picture ? (
            <img src={picture} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            // No photo from race night (yet): the film's last frame instead,
            // softened, so its own lettering does not fight the winner's name.
            <div className="absolute inset-0 scale-110 opacity-60 blur-md">
              <EventFilm src={series?.promoVideoUrl} still />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/60 to-ink/10" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2.5 p-7 text-white sm:p-10">
            <span className="inline-flex self-start rounded-full bg-brand px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-onbrand">
              Final{race.date ? ` · ${fmtRaceDate(race.date)}` : ""}
            </span>
            <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-200">
              {flag && <Flag code={flag.country} title={flag.countryName} />}
              Winner · {race.track}
            </span>
            <span className="font-display text-5xl font-black uppercase leading-[0.9] tracking-tight sm:text-7xl lg:text-8xl">
              {winner?.name || "Result to come"}
            </span>
            {winner && (
              <span className="text-base text-slate-200">
                {[
                  winner.laps ? `${winner.laps} laps` : null,
                  margin > 0 ? `won by ${fmtGap(margin).replace("+", "")} s` : null,
                  winner.lapsLed ? `led ${winner.lapsLed} lap${winner.lapsLed === 1 ? "" : "s"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
        </section>

        <aside aria-label="Podium" className="flex flex-[1_1_320px] flex-col gap-4 rounded-[1.75rem] bg-ink p-6 text-white">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-brand">★ Podium</div>
          <ol className="space-y-2">
            {classified.slice(0, 3).map((r, i) => (
              <li
                key={r.driverId}
                className={`flex items-center gap-3.5 rounded-xl px-3.5 py-3 ${i === 0 ? "bg-brand text-onbrand" : "bg-white/10"}`}
              >
                <span className="w-7 font-display text-2xl font-black">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-bold">{r.name}</span>
                <span className={`font-mono text-xs ${i === 0 ? "" : "text-slate-300"}`}>
                  {i === 0 ? fmtDuration(r.totalTimeMs) : r.laps === winner?.laps ? fmtGap(r.totalTimeMs - winner.totalTimeMs) : ""}
                </span>
              </li>
            ))}
          </ol>
          <dl className="grid grid-cols-2 gap-3.5 border-t border-white/10 pt-3.5 text-sm">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">Fastest lap</dt>
              <dd className="mt-1 font-bold">{fastest ? `${fastest.name} · ${fmtLap(fastest.bestLapMs)}` : "–"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">Driver of the day</dt>
              <dd className="mt-1 font-bold">{dotd || "–"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">Finished</dt>
              <dd className="mt-1 font-bold">
                {classified.length} of {results.filter((r) => r.status !== "DNS").length}
              </dd>
            </div>
          </dl>
          <Link
            to={resultPath}
            className="mt-auto flex min-h-[52px] items-center justify-center rounded-xl bg-white text-[15px] font-extrabold uppercase tracking-wide text-ink transition hover:bg-slate-100"
          >
            Full result
          </Link>
        </aside>
      </div>

      {/* The ways back into the race: only the ones this race has. */}
      <div className={`grid gap-4 ${RELIVE_COLS[2 + (photos.length > 0) + !!highlights]}`}>
        <RelivedTile to={seriesPath(`/recap/${race.id}`)} title="Race replay" sub="Every lap, position by position." icon="replay" />
        {photos.length > 0 && (
          <RelivedTile to={resultPath} title="Photos" sub={`${photos.length} shot${photos.length === 1 ? "" : "s"} from race night.`} icon="photo" />
        )}
        {highlights && <RelivedTile href={highlights} title="Highlights" sub="The race in a few minutes." icon="video" />}
        <RelivedTile to={resultPath} title="Full result" sub="Every car, every lap time." icon="flag" />
      </div>

      {classified.length > 0 && (
        <section aria-labelledby="top-h" className="card space-y-3 p-6">
          <div className="flex items-baseline justify-between">
            <h2 id="top-h" className="font-display text-2xl font-black uppercase tracking-tight text-dark">
              Top 10
            </h2>
            <Link to={resultPath} className="text-sm font-bold text-link hover:underline">
              All {results.length} →
            </Link>
          </div>
          <ol className="grid gap-x-7 sm:grid-cols-2">
            {classified.slice(0, 10).map((r) => (
              <li key={r.driverId} className="flex items-center gap-3.5 border-b border-border py-2.5">
                <span className="w-6 font-mono font-bold text-dark">{r.position}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-dark">{r.name}</span>
                <span className="font-mono text-sm text-light">
                  {r === winner ? fmtDuration(r.totalTimeMs) : r.laps === winner?.laps ? fmtGap(r.totalTimeMs - winner.totalTimeMs) : `${r.laps} laps`}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[1.4rem] bg-ink px-6 py-5 text-white">
        <div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-brand">★ Next special event</div>
          <div className="mt-1 font-display text-xl font-black uppercase">
            {nextEvent ? `${nextEvent.name} · ${fmtRaceDate(nextEvent.eventAt)}` : "To be announced"}
          </div>
        </div>
        {nextEvent ? (
          <Link to={`/s/${nextEvent.slug}`} className="inline-flex min-h-[44px] items-center rounded-xl bg-brand px-5 text-sm font-bold text-onbrand">
            See the next one
          </Link>
        ) : (
          primary && (
            <Link to={`/s/${primary.slug}`} className="inline-flex min-h-[44px] items-center rounded-xl border border-white/30 px-5 text-sm font-bold text-white hover:bg-white/10">
              Back to {primary.name}
            </Link>
          )
        )}
      </section>
    </div>
  );
}

// Literal class names, so the stylesheet build keeps them.
const RELIVE_COLS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };

const ICONS = {
  flag: (
    <>
      <path d="M4 22V4" />
      <path d="M4 4h13l-2 4 2 4H4" />
    </>
  ),
  replay: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M10 9l5 3-5 3z" />
    </>
  ),
};

function RelivedTile({ to, href, title, sub, icon }) {
  const body = (
    <>
      <svg viewBox="0 0 24 24" className="h-7 w-7 text-dark" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[icon]}
      </svg>
      <span className="font-display text-xl font-black uppercase tracking-tight text-dark">{title}</span>
      <span className="text-sm text-light">{sub}</span>
    </>
  );
  const cls = "card flex flex-col gap-2.5 p-6 transition hover:-translate-y-0.5";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <Link to={to} className={cls}>
      {body}
    </Link>
  );
}
