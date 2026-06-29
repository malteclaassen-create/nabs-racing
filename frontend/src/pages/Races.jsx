import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton, Skeleton } from "../components/ui.jsx";
import RaceResults from "../components/RaceResults.jsx";
import RaceSignupCard from "../components/RaceSignupCard.jsx";
import CircuitMap from "../components/CircuitMap.jsx";
import Flag from "../components/Flag.jsx";
import { circuitFor } from "../data/circuits.js";
import { fmtRaceTime } from "../utils/raceTime.js";

// The calendar is built entirely from the season's races (DB), so it stays in
// sync with whatever the admin schedules. Championship rounds (number set) are
// clickable once completed; special events (isSpecialEvent) are info-only.

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

// Live ticking countdown to a future date. Renders nothing once the date passes.
function Countdown({ date }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = new Date(date).getTime() - now;
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
  return (
    <div className="scrollbar-slim flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pb-0">
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
            type="button"
            onClick={() => onSelect(r.id)}
            aria-pressed={active}
            className={`group flex shrink-0 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition lg:w-full lg:shrink ${border}`}
          >
            <span className={`font-display text-lg font-black leading-none tabular-nums ${active ? "text-dark" : done ? "text-emerald-600" : "text-faint group-hover:text-light"}`}>
              {String(r.number).padStart(2, "0")}
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
const BRAND = "#f4afc6"; // NABS pastel pink

function RaceCard({ r, isNext, selected, onSelect, index = 0 }) {
  const e = { type: r.isSpecialEvent ? "se" : "round", number: r.number, track: r.track, date: r.date };
  const se = r.isSpecialEvent;
  const circuit = se ? null : circuitFor(r.track);
  const done = !!r.isCompleted;
  const clickable = done && !se;
  const dbRace = r;

  const tone = se || done ? EMERALD : isNext ? BRAND : null;

  let pill;
  if (se) pill = <span className="pill bg-emerald-500/15 text-emerald-600">Special Event</span>;
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
          <span className="ghost-numeral select-none text-[7rem] leading-none text-emerald-500/10">SE</span>
        </div>
      )}

      {/* content */}
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between">
          <div className="flex h-10 min-w-10 items-center justify-center rounded-xl bg-ink px-2.5 font-display text-base font-black tabular-nums text-white shadow">
            {se ? "SE" : `R${e.number}`}
          </div>
          {pill}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            {circuit && <Flag code={circuit.country} title={circuit.countryName} />}
            <h4 className={`font-display text-xl font-extrabold uppercase tracking-tight ${se ? "text-emerald-600" : "text-dark"}`}>
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
  // the "next race" sign-up links on the home card and the nav chip).
  const [searchParams] = useSearchParams();
  const wantRaceId = searchParams.get("race");

  // Sign-Up + Driver Market for the upcoming rounds (moved here from the old
  // Sign-Up page). Identity comes from the Discord login.
  const { user, isLoggedIn } = useAuth();
  const events = useApi(useCallback(() => api.events(), []));
  const market = useApi(useCallback(() => api.market(), []));
  const marketByRace = useMemo(
    () => new Map((market.data?.races || []).map((r) => [r.id, r])),
    [market.data]
  );
  const driverId = isLoggedIn ? user?.driverId : null;
  const canSignUp = isLoggedIn && !!driverId;
  const [signupBusy, setSignupBusy] = useState(null);
  const [signupError, setSignupError] = useState(null);

  async function setStatus(raceId, status) {
    setSignupError(null);
    setSignupBusy(`${raceId}:${status}`);
    try {
      await api.rsvp(raceId, driverId, status);
      await events.reload();
    } catch (e) {
      setSignupError(e.message);
    } finally {
      setSignupBusy(null);
    }
  }

  async function clearStatus(raceId) {
    setSignupBusy(`${raceId}:clear`);
    try {
      await api.removeRsvp(raceId, driverId);
      await events.reload();
    } finally {
      setSignupBusy(null);
    }
  }

  // Explicit deep link (?race=<id>): always honour it and bring the explorer
  // into view. Keyed only on the id/races so a later manual pick isn't reverted.
  useEffect(() => {
    if (!wantRaceId || !races) return;
    const target = races.find((r) => r.id === wantRaceId);
    if (target) {
      setSelectedId(target.id);
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }, [wantRaceId, races]);

  useEffect(() => {
    if (races && races.length && !selectedId) {
      // A valid ?race=<id> is handled above; otherwise default to the most recent
      // completed round, falling back to the next upcoming round before any
      // results exist so its sign-up is shown.
      const wanted = wantRaceId ? races.find((r) => r.id === wantRaceId) : null;
      if (wanted) return;
      const last = [...races].reverse().find((r) => r.isCompleted && !r.isSpecialEvent);
      const nextUp = races.find((r) => !r.isCompleted && !r.isSpecialEvent && r.number != null);
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
  const withDate = (r) => (r.date ? new Date(r.date).getTime() : Infinity);
  // Championship rounds (have a number) and special events, each in calendar order.
  const rounds = races
    .filter((r) => !r.isSpecialEvent && r.number != null)
    .sort((a, b) => a.number - b.number);
  const specials = races.filter((r) => r.isSpecialEvent).sort((a, b) => withDate(a) - withDate(b));
  const championRounds = rounds; // RoundStrip only flips between scored rounds

  // "Next up" = earliest not-yet-completed entry with a future date.
  const nextEntry = [...races]
    .filter((r) => !r.isCompleted && r.date && new Date(r.date).getTime() >= now)
    .sort((a, b) => withDate(a) - withDate(b))[0];

  const shown = tab === "rounds" ? rounds : specials;
  // The race currently open in the explorer, and its sign-up event (only
  // upcoming rounds have one). Completed -> results; upcoming -> sign up + market.
  const selectedRace = (races || []).find((r) => r.id === selectedId);
  const selectedEvent = (events.data || []).find((e) => e.id === selectedId);
  const tabCls = (active) =>
    `rounded-lg px-4 py-2 text-sm font-bold transition ${active ? "bg-brand text-ink shadow" : "text-light hover:text-dark"}`;

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Schedule & Results"
        title="Races"
        subtitle="Pick a round to see its results, or sign up for one that hasn't run yet. The calendar below lists the whole season."
      />

      {/* Results explorer: round list (left), and on the right the selected
          round's results (completed) or sign-up + driver market (upcoming). */}
      <div ref={panelRef} className="scroll-mt-24">
        {championRounds.length > 0 ? (
          <div className="grid gap-5 lg:grid-cols-[15rem_1fr] xl:grid-cols-[17rem_1fr]">
            {/* round list — horizontal on phones, vertical sidebar from lg up */}
            <aside className="lg:sticky lg:top-28 lg:self-start">
              <h3 className="mb-2.5 hidden font-mono text-xs font-bold uppercase tracking-widest text-light lg:block">
                Rounds
              </h3>
              <RoundRail races={championRounds} selectedId={selectedId} onSelect={selectRace} />
            </aside>

            {/* selected race: results for completed rounds, sign-up + driver
                market for rounds that haven't been run yet. */}
            <div className="min-w-0">
              {selectedRace && !selectedRace.isCompleted ? (
                <>
                  {signupError && <div className="mb-4"><ErrorBox message={signupError} /></div>}
                  {!selectedEvent ? (
                    events.loading ? (
                      <TableSkeleton rows={6} />
                    ) : (
                      <div className="card p-8 text-center text-medium">
                        Sign-up opens once this round is scheduled.
                      </div>
                    )
                  ) : (
                    <RaceSignupCard
                      ev={selectedEvent}
                      marketRace={marketByRace.get(selectedEvent.id)}
                      me={market.data?.me}
                      reloadMarket={market.reload}
                      driverId={driverId}
                      canSignUp={canSignUp}
                      busy={signupBusy}
                      onSetStatus={setStatus}
                      onClear={clearStatus}
                    />
                  )}
                </>
              ) : (
                <>
                  {detailLoading && <TableSkeleton rows={10} />}
                  {detailError && <ErrorBox message={detailError} />}
                  {detail && !detailLoading && (
                    <div>
                      <div className="mb-4">
                        <div className="flex items-center gap-3">
                          {circuitFor(detail.race.track) && (
                            <Flag code={circuitFor(detail.race.track).country} title={circuitFor(detail.race.track).countryName} w={26} h={19} />
                          )}
                          <h2 className="font-display text-2xl font-extrabold uppercase tracking-tight text-dark">
                            <span className="text-light">R{detail.race.number}</span> {detail.race.track}
                          </h2>
                        </div>
                        {!detail.race.hasPositions && (
                          <p className="mt-1 text-sm text-light">
                            Historical round — points only (finishing positions not recorded).
                          </p>
                        )}
                      </div>
                      <RaceResults race={detail.race} results={detail.results} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="card p-8 text-center text-medium">No championship rounds scheduled yet.</div>
        )}
      </div>

      {/* Full calendar */}
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="section-title">Calendar</h3>
          <div className="inline-flex rounded-xl border border-border bg-card p-1">
            <button type="button" onClick={() => setTab("rounds")} className={tabCls(tab === "rounds")}>
              Championship
              <span className="ml-1.5 opacity-70">{rounds.length}</span>
            </button>
            <button type="button" onClick={() => setTab("se")} className={tabCls(tab === "se")}>
              Special Events
              <span className="ml-1.5 opacity-70">{specials.length}</span>
            </button>
          </div>
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
              {tab === "rounds" ? "No championship rounds scheduled yet." : "No special events scheduled."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
