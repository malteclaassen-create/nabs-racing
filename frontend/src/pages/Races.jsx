import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSeason } from "../context/SeasonContext.jsx";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton, Skeleton } from "../components/ui.jsx";
import RaceResults from "../components/RaceResults.jsx";
import RaceFacts from "../components/RaceFacts.jsx";
import UpcomingRacePanel from "../components/UpcomingRacePanel.jsx";
import CircuitMap from "../components/CircuitMap.jsx";
import Flag from "../components/Flag.jsx";
import { circuitFor } from "../data/circuits.js";
import { fmtRaceTime, raceKickoff, LIVE_WINDOW_MS } from "../utils/raceTime.js";

// The calendar is built entirely from the season's races (DB), so it stays in
// sync with whatever the admin schedules. Championship rounds (number set) are
// clickable once completed; special events (isSpecialEvent) are info-only.

// Pure + used both in early effects (deep-link handling, before any early
// return) and in the render body, so it lives at module scope rather than
// being redefined in two places.
function kindOf(r) {
  return r.type || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

// Live ticking countdown to a future kickoff. Renders nothing once it passes.
function Countdown({ date }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const target = raceKickoff(date);
  if (!target) return null;
  const diff = target.getTime() - now;
  if (diff <= 0) return null;
  const days = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000) % 24;
  const m = Math.floor(diff / 60000) % 60;
  const s = Math.floor(diff / 1000) % 60;
  const parts = days > 0 ? [`${days}d`, `${h}h`, `${m}m`] : [`${h}h`, `${m}m`, `${s}s`];
  return (
    <span className="flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums text-dark">
      {parts.map((p) => (
        <span key={p} className="rounded-md bg-brand/15 px-1.5 py-0.5">{p}</span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Round rail — the list of championship rounds for flipping between results.
// Scrolls horizontally on phones; becomes a vertical sidebar next to the
// results table from `lg` up.
// ---------------------------------------------------------------------------
function RoundRail({ races, selectedId, onSelect }) {
  const scrollerRef = useRef(null);
  const activeRef = useRef(null);

  // On phones the rail is a horizontal strip. Centre the selected round so the
  // latest races are in view straight away, instead of forcing a long scroll
  // from round 1. No-op when the rail is the vertical sidebar (lg+), where the
  // strip doesn't overflow horizontally.
  useEffect(() => {
    const c = scrollerRef.current;
    const a = activeRef.current;
    if (!c || !a) return;
    if (c.scrollWidth <= c.clientWidth) return; // vertical sidebar / fits
    const cRect = c.getBoundingClientRect();
    const aRect = a.getBoundingClientRect();
    const delta = aRect.left - cRect.left - (c.clientWidth / 2 - a.clientWidth / 2);
    c.scrollTo({ left: c.scrollLeft + delta, behavior: "auto" });
  }, [selectedId, races]);

  return (
    <div
      ref={scrollerRef}
      className="scrollbar-slim flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pb-0"
    >
      {races.map((r) => {
        const c = circuitFor(r.track);
        const active = r.id === selectedId;
        const done = r.isCompleted;
        const border = active
          ? "border-brand ring-1 ring-brand bg-brand/10"
          : done
          ? "border-emerald-500/40 bg-emerald-500/[0.06] hover:bg-emerald-500/10"
          : "border-border bg-card hover:bg-surface2";
        return (
          <button
            key={r.id}
            ref={active ? activeRef : undefined}
            type="button"
            onClick={() => onSelect(r.id)}
            aria-pressed={active}
            className={`group flex shrink-0 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition lg:w-full lg:shrink ${border}`}
          >
            <span className={`font-display text-lg font-black leading-none tabular-nums ${active ? "text-dark" : done ? "text-emerald-600" : "text-faint group-hover:text-light"}`}>
              {r.number != null ? String(r.number).padStart(2, "0") : kindOf(r) === "TRAINING" ? "TR" : "SE"}
            </span>
            {c && <Flag code={c.country} title={c.countryName} />}
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-display text-sm font-bold uppercase tracking-tight text-dark">{r.track}</span>
              <span className={`flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider ${done ? "text-emerald-600" : "text-light"}`}>
                {done && (
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
                    <path d="M6.2 11.3 3 8.1l1.1-1.1 2.1 2.1 5-5L12.3 5z" />
                  </svg>
                )}
                {done ? "Done" : "Upcoming"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar card — the circuit outline is a full-card watermark. Completed
// championship rounds are buttons that load results; SEs and upcoming rounds
// are static info cards.
// ---------------------------------------------------------------------------
const EMERALD = "#10b981";
// Reads the live brand accent (--c-brand, series-overridable — see index.css)
// rather than a fixed hex, so a series' recoloured accent reaches this inline
// style too.
const BRAND = "rgb(var(--c-brand))";
const SKY = "#0ea5e9"; // training sessions

function RaceCard({ r, isNext, selected, onSelect, index = 0 }) {
  const kind = r.type || (r.isSpecialEvent ? "SPECIAL" : "CHAMPIONSHIP");
  const se = kind === "SPECIAL";
  const training = kind === "TRAINING";
  const e = { number: r.number, track: r.track, date: r.date };
  // Training sessions run on real circuits, so their outline still draws.
  const circuit = se ? null : circuitFor(r.track);
  const done = !!r.isCompleted;
  const clickable = done && kind === "CHAMPIONSHIP";
  const dbRace = r;

  const tone = training ? SKY : se || done ? EMERALD : isNext ? BRAND : null;

  let pill;
  if (training) pill = <span className="pill bg-sky-500/15 text-sky-600">Training</span>;
  else if (se) pill = <span className="pill bg-emerald-500/15 text-emerald-600">Special Event</span>;
  else if (done) pill = <span className="pill bg-emerald-500/15 text-emerald-600">View results</span>;
  else if (isNext) pill = <span className="pill bg-brand/30 text-dark">Next up</span>;
  else pill = <span className="pill bg-surface2 text-light">Upcoming</span>;

  const inner = (
    <div
      className={`shine relative h-44 overflow-hidden rounded-2xl border bg-card transition ${
        selected ? "border-emerald-500 ring-2 ring-emerald-500/50" : isNext ? "border-brand/50" : "border-border"
      }`}
    >
      {/* accent edge */}
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: tone || "transparent" }} />

      {/* watermark: circuit outline, or a ghost "SE" for special events */}
      {circuit ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-7"
          style={{ color: tone || "var(--c-faint)" }}
        >
          <CircuitMap track={e.track} animate={isNext} className="h-full w-full opacity-[0.18]" strokeWidth={2} />
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className={`ghost-numeral select-none text-[7rem] leading-none ${training ? "text-sky-500/10" : "text-emerald-500/10"}`}>
            {training ? "TR" : "SE"}
          </span>
        </div>
      )}

      {/* content */}
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between">
          <div className="flex h-10 min-w-10 items-center justify-center rounded-xl bg-ink px-2.5 font-display text-base font-black tabular-nums text-white shadow">
            {training ? "TR" : se ? "SE" : `R${e.number}`}
          </div>
          {pill}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            {circuit && <Flag code={circuit.country} title={circuit.countryName} />}
            <h4 className={`font-display text-xl font-extrabold uppercase tracking-tight ${training ? "text-sky-600" : se ? "text-emerald-600" : "text-dark"}`}>
              {e.track}
            </h4>
          </div>
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="font-mono text-sm font-semibold tabular-nums text-medium">{fmtDate(e.date)}</div>
              <div className="font-mono text-xs text-light">{e.date ? fmtRaceTime(e.date) : "Time TBA"}</div>
            </div>
            {isNext && !done && <Countdown date={e.date} />}
          </div>
        </div>
      </div>
    </div>
  );

  if (clickable) {
    return (
      <button
        type="button"
        onClick={() => onSelect(dbRace.id)}
        aria-pressed={selected}
        style={{ "--i": index }}
        className="lift block w-full text-left"
      >
        {inner}
      </button>
    );
  }
  return (
    <div style={{ "--i": index }}>{inner}</div>
  );
}

export default function Races() {
  const { data: races, loading, error } = useApi(useCallback(() => api.races(), []));
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [tab, setTab] = useState("rounds"); // "rounds" | "se"
  const panelRef = useRef(null);
  // Deep link: /races?race=<id> opens the explorer on a specific round (used by
  // the "next race" sign-up links on the home card and the driver profiles).
  // An optional &season=<number> first steers the site to that season — driver
  // profiles of archived seasons link here while the visitor may be viewing a
  // different one. The param is consumed immediately so the season switcher
  // isn't overridden afterwards.
  const [searchParams, setSearchParams] = useSearchParams();
  const wantRaceId = searchParams.get("race");
  const wantSeason = searchParams.get("season");
  const { season, setSeason } = useSeason();
  useEffect(() => {
    if (!wantSeason || season == null) return;
    const n = Number(wantSeason);
    const next = new URLSearchParams(searchParams);
    next.delete("season");
    setSearchParams(next, { replace: true });
    if (Number.isFinite(n) && n !== season) setSeason(n);
  }, [wantSeason, season, setSeason, searchParams, setSearchParams]);

  // Sign-up + attendance for upcoming rounds now lives on the /attendance page;
  // the Races page shows the UpcomingRacePanel (countdown, circuit, track record).

  // Explicit deep link (?race=<id>): always honour it and bring the explorer
  // into view. Keyed only on the id/races so a later manual pick isn't reverted.
  useEffect(() => {
    if (!wantRaceId || !races) return;
    const target = races.find((r) => r.id === wantRaceId);
    if (target) {
      setSelectedId(target.id);
      // The explorer only lists ONE session type at a time — switch to the
      // linked race's own tab so it's actually visible (and highlighted) in
      // the rail, not just selected behind the scenes.
      const k = kindOf(target);
      setTab(k === "TRAINING" ? "training" : k === "SPECIAL" ? "se" : "rounds");
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [wantRaceId, races]);

  useEffect(() => {
    if (races && races.length && !selectedId) {
      // A valid ?race=<id> is handled above; otherwise default to the most
      // recent completed CHAMPIONSHIP round (the "rounds" tab is the initial
      // tab), falling back to the next upcoming one before any results exist
      // so its sign-up is shown.
      const wanted = wantRaceId ? races.find((r) => r.id === wantRaceId) : null;
      if (wanted) return;
      const last = [...races].reverse().find((r) => r.isCompleted && kindOf(r) === "CHAMPIONSHIP");
      const nextUp = races.find((r) => !r.isCompleted && kindOf(r) === "CHAMPIONSHIP" && r.number != null);
      const target = last || nextUp;
      if (target) setSelectedId(target.id);
    }
  }, [races, selectedId, wantRaceId]);

  useEffect(() => {
    if (!selectedId) return;
    setDetailLoading(true);
    setDetailError(null);
    api
      .raceResults(selectedId)
      .then(setDetail)
      .catch((e) => setDetailError(e.message))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  function selectRace(id) {
    setSelectedId(id);
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (loading)
    return (
      <div>
        <PageHeaderSkeleton />
        <div className="mb-7 flex gap-2 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[52px] w-44 shrink-0 rounded-xl" />
          ))}
        </div>
        <TableSkeleton rows={10} />
      </div>
    );
  if (error) return <ErrorBox message={error} />;

  const now = Date.now();
  // Sort/compare by the resolved kickoff (date-only entries fall back to the
  // league's usual start time instead of midnight).
  const withDate = (r) => raceKickoff(r.date)?.getTime() ?? Infinity;
  // Championship rounds (have a number), training sessions and special events,
  // each group in calendar order.
  const rounds = races
    .filter((r) => kindOf(r) === "CHAMPIONSHIP" && r.number != null)
    .sort((a, b) => a.number - b.number);
  const trainings = races.filter((r) => kindOf(r) === "TRAINING").sort((a, b) => withDate(a) - withDate(b));
  const specials = races.filter((r) => kindOf(r) === "SPECIAL").sort((a, b) => withDate(a) - withDate(b));

  // "Next up" = earliest not-yet-completed entry that hasn't clearly finished
  // yet. The live window keeps a running race listed as next up (rather than
  // dropping it the second the lights go out) without pinning an old race
  // whose results simply aren't imported yet.
  const nextEntry = [...races]
    .filter((r) => !r.isCompleted && r.date && withDate(r) + LIVE_WINDOW_MS > now)
    .sort((a, b) => withDate(a) - withDate(b))[0];

  // The ONE list driving both the explorer (rail + detail) above and the
  // calendar grid below — switching tabs changes what both show, together.
  const shown = tab === "rounds" ? rounds : tab === "training" ? trainings : specials;
  const tabLabel = tab === "rounds" ? "Championship rounds" : tab === "training" ? "Training sessions" : "Special events";
  const railLabel = tab === "rounds" ? "Rounds" : tab === "training" ? "Sessions" : "Events";
  // The race currently open in the explorer. Completed -> results table;
  // upcoming -> the UpcomingRacePanel (countdown, circuit map, track record).
  const selectedRace = (races || []).find((r) => r.id === selectedId);
  const tabCls = (active) =>
    `rounded-lg px-4 py-2 text-sm font-bold transition ${active ? "bg-brand text-ink shadow" : "text-light hover:text-dark"}`;

  // Switching tabs re-points the explorer at a sensible race of the NEW type —
  // same heuristic as the initial pick (most recent completed, else next
  // upcoming, else just the first one) — so the rail and detail panel always
  // land on something relevant instead of staying on the old tab's selection.
  function selectTab(next) {
    setTab(next);
    const list = next === "rounds" ? rounds : next === "training" ? trainings : specials;
    const last = [...list].reverse().find((r) => r.isCompleted);
    const nextUp = list.find((r) => !r.isCompleted);
    setSelectedId((last || nextUp || list[0])?.id ?? null);
  }

  return (
    <div className="space-y-12">
      <PageHeader eyebrow="Schedule & Results" title="Races" />

      {/* Session-type switcher: drives BOTH the explorer below (rail + detail)
          and the calendar grid further down, so picking a type shows every
          view of it — not just the calendar cards. */}
      <div className="reveal inline-flex rounded-xl border border-border bg-card p-1">
        <button type="button" onClick={() => selectTab("rounds")} className={tabCls(tab === "rounds")}>
          Championship
          <span className="ml-1.5 opacity-70">{rounds.length}</span>
        </button>
        {/* Training sessions get their own clearly-labelled group — the tab
            only appears once a session is scheduled, so a league without
            trainings keeps today's two-tab page. */}
        {trainings.length > 0 && (
          <button type="button" onClick={() => selectTab("training")} className={tabCls(tab === "training")}>
            Training / Sessions
            <span className="ml-1.5 opacity-70">{trainings.length}</span>
          </button>
        )}
        <button type="button" onClick={() => selectTab("se")} className={tabCls(tab === "se")}>
          Special Events
          <span className="ml-1.5 opacity-70">{specials.length}</span>
        </button>
      </div>

      {/* Results explorer: race list (left), and on the right the selected
          race's results (completed) or sign-up + info (upcoming) — for
          whichever session type is picked above. */}
      <div ref={panelRef} className="reveal scroll-mt-24">
        {shown.length > 0 ? (
          // minmax(0,…) keeps the wide results table from stretching the
          // column (and the whole page) past the viewport on phones
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
            {/* race list — horizontal on phones, vertical sidebar from lg up */}
            <aside className="lg:sticky lg:top-28 lg:self-start">
              {/* The label row shares the exact height of the round header on
                  the right (h-8 title line + mb-4), so the first round button
                  and the results table start flush on one line. */}
              <h3 className="mb-4 hidden h-8 items-center font-mono text-xs font-bold uppercase tracking-widest text-light lg:flex">
                {railLabel}
              </h3>
              <RoundRail races={shown} selectedId={selectedId} onSelect={selectRace} />
            </aside>

            {/* selected race: results for completed rounds, sign-up + driver
                market for rounds that haven't been run yet. */}
            <div className="min-w-0">
              {selectedRace && !selectedRace.isCompleted ? (
                <UpcomingRacePanel race={selectedRace} />
              ) : (
                <>
                  {detailLoading && <TableSkeleton rows={10} />}
                  {detailError && <ErrorBox message={detailError} />}
                  {detail && !detailLoading && (
                    <div>
                      <div className="mb-4">
                        <div className="flex h-8 items-center gap-3">
                          {circuitFor(detail.race.track) && (
                            <Flag code={circuitFor(detail.race.track).country} title={circuitFor(detail.race.track).countryName} w={26} h={19} />
                          )}
                          <h2 className="truncate font-display text-2xl font-extrabold uppercase tracking-tight text-dark">
                            {detail.race.number != null && <span className="text-light">R{detail.race.number}</span>} {detail.race.track}
                          </h2>
                          <span className="ml-auto flex shrink-0 items-center gap-3">
                            {/* replay of this round, registered in the admin Downloads tab */}
                            {detail.race.replayDownloadId && (
                              <Link
                                to={`/downloads?dl=${detail.race.replayDownloadId}`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-medium transition hover:border-brand/60 hover:text-dark"
                                title="Rewatch this race: opens the replay in the downloads"
                              >
                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-brand" fill="currentColor" aria-hidden="true">
                                  <path d="M8 5.5v13l11-6.5-11-6.5z" />
                                </svg>
                                Replay
                              </Link>
                            )}
                            {detail.race.date && (
                              <span
                                className="text-right font-mono text-xs font-semibold tabular-nums text-light sm:text-sm"
                                title={fmtRaceTime(detail.race.date)}
                              >
                                {fmtDate(detail.race.date)}
                              </span>
                            )}
                          </span>
                        </div>
                        {!detail.race.hasPositions && (
                          <p className="mt-1 text-sm text-light">
                            Historical round: points only, the finishing positions were not recorded.
                          </p>
                        )}
                      </div>
                      <RaceResults race={detail.race} results={detail.results} />
                      {detail.race.hasPositions && <RaceFacts race={detail.race} results={detail.results} />}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="card p-8 text-center text-medium">
            {tab === "rounds"
              ? "No championship rounds scheduled yet."
              : tab === "training"
                ? "No training sessions scheduled."
                : "No special events scheduled."}
          </div>
        )}
      </div>

      {/* Full calendar — same session type as the explorer above (one shared
          switcher drives both), just as an at-a-glance grid instead of one
          race at a time. */}
      <div className="reveal space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="section-title">Calendar · {tabLabel}</h3>
        </div>
        <div className="cascade grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r, i) => (
            <RaceCard
              key={r.id}
              r={r}
              index={Math.min(i, 14)}
              isNext={nextEntry && r.id === nextEntry.id}
              selected={r.id === selectedId}
              onSelect={selectRace}
            />
          ))}
          {shown.length === 0 && (
            <div className="card col-span-full p-8 text-center text-medium">
              {tab === "rounds"
                ? "No championship rounds scheduled yet."
                : tab === "training"
                  ? "No training sessions scheduled."
                  : "No special events scheduled."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
