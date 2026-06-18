import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton, Skeleton } from "../components/ui.jsx";
import RaceResults from "../components/RaceResults.jsx";
import CircuitMap from "../components/CircuitMap.jsx";
import Flag from "../components/Flag.jsx";
import { circuitFor } from "../data/circuits.js";

// Full Season 7 schedule. SE = Special Event (not a championship round).
// Championship rounds are matched to DB races by `number` so completed rounds
// become clickable and reveal their results.
const SCHEDULE = [
  { type: "round", number: 1, track: "Melbourne", date: "2026-04-10T18:00:00Z" },
  { type: "round", number: 2, track: "Mugello", date: "2026-04-17T18:00:00Z" },
  { type: "se", track: "Watkins Glen 2.5", date: "2026-04-25T18:00:00Z" },
  { type: "round", number: 3, track: "Most", date: "2026-05-01T18:00:00Z" },
  { type: "round", number: 4, track: "Bahrain", date: "2026-05-08T18:00:00Z" },
  { type: "round", number: 5, track: "Monza", date: "2026-05-15T18:00:00Z" },
  { type: "round", number: 6, track: "Jeddah", date: "2026-05-22T18:00:00Z" },
  { type: "round", number: 7, track: "Nurburgring", date: "2026-05-29T18:00:00Z" },
  { type: "round", number: 8, track: "Spa", date: "2026-06-05T18:00:00Z" },
  { type: "se", track: "NASCAR Oval", date: "2026-06-06T18:00:00Z" },
  { type: "round", number: 9, track: "Imola", date: "2026-06-12T18:00:00Z" },
  { type: "round", number: 10, track: "Turkey", date: "2026-06-19T18:00:00Z" },
  { type: "se", track: "Le Mans 2.5", date: "2026-06-26T18:00:00Z" },
  { type: "round", number: 11, track: "COTA", date: "2026-07-03T18:00:00Z" },
  { type: "round", number: 12, track: "Interlagos", date: "2026-07-10T18:00:00Z" },
];

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
// Quick round-picker strip — a horizontal scrollable row of the DB rounds, for
// flipping between results fast without scrolling down to the calendar.
// ---------------------------------------------------------------------------
function RoundStrip({ races, selectedId, onSelect }) {
  return (
    <div className="scrollbar-slim -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
      {races.map((r) => {
        const c = circuitFor(r.track);
        const active = r.id === selectedId;
        const done = r.isCompleted;
        const border = active
          ? "border-brand ring-1 ring-brand bg-brand/10"
          : done
          ? "border-emerald-500/40 bg-emerald-500/[0.06] hover:bg-emerald-500/10"
          : "border-border bg-card hover:bg-surface2 opacity-70";
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            aria-pressed={active}
            className={`group flex shrink-0 items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition ${border}`}
          >
            <span className={`font-display text-lg font-black leading-none tabular-nums ${active ? "text-dark" : done ? "text-emerald-600" : "text-faint group-hover:text-light"}`}>
              {String(r.number).padStart(2, "0")}
            </span>
            {c && <Flag code={c.country} title={c.countryName} />}
            <span className="flex flex-col leading-tight">
              <span className="font-display text-sm font-bold uppercase tracking-tight text-dark">{r.track}</span>
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
// Calendar card — the circuit outline is the hero. Completed championship
// rounds are buttons that load results; SEs and upcoming rounds are static.
// ---------------------------------------------------------------------------
function RaceCard({ e, isNext, dbRace, selected, onSelect }) {
  const se = e.type === "se";
  const circuit = se ? null : circuitFor(e.track);
  const past = new Date(e.date).getTime() < Date.now();
  const done = !!dbRace?.isCompleted;
  const clickable = done && !!dbRace;

  // Top-right status pill.
  let pill = null;
  if (se) pill = <span className="pill bg-emerald-500/15 text-emerald-600">Special Event</span>;
  else if (done) pill = <span className="pill bg-emerald-500/15 text-emerald-600">View results</span>;
  else if (isNext) pill = <span className="pill bg-brand/20 text-dark">Next up</span>;
  else pill = <span className="pill bg-surface2 text-light">{past ? "Pending" : "Upcoming"}</span>;

  const accent = se ? "#10b981" : done ? "#10b981" : isNext ? "var(--brand, #ec4899)" : null;

  const inner = (
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card transition ${
        selected ? "border-brand ring-1 ring-brand" : isNext ? "border-brand/40" : "border-border"
      } ${clickable ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-lg" : ""}`}
    >
      {/* accent top line */}
      <div className="h-1 w-full" style={{ background: accent || "transparent" }} />

      {/* hero: circuit outline */}
      <div className="relative flex h-28 items-center justify-center bg-surface2/40">
        {circuit ? (
          <CircuitMap
            track={e.track}
            className="h-20 w-32"
            stroke="currentColor"
            strokeWidth={2.5}
            style={{ color: done ? "#10b981" : isNext ? "#ec4899" : "var(--light, #94a3b8)" }}
          />
        ) : (
          <span className="font-display text-3xl font-black uppercase tracking-widest text-emerald-600/70">
            {se ? "SE" : "—"}
          </span>
        )}
        {/* round badge */}
        <div className="absolute left-3 top-3 flex h-9 min-w-9 items-center justify-center rounded-lg bg-ink/90 px-2 font-display text-sm font-black tabular-nums text-white">
          {se ? "SE" : `R${e.number}`}
        </div>
        <div className="absolute right-3 top-3">{pill}</div>
      </div>

      {/* body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2.5">
          {circuit && <Flag code={circuit.country} title={circuit.countryName} />}
          <h4 className={`font-display text-lg font-extrabold uppercase tracking-tight ${se ? "text-emerald-600" : "text-dark"}`}>
            {e.track}
          </h4>
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div>
            <div className="font-mono text-sm font-semibold tabular-nums text-medium">{fmtDate(e.date)}</div>
            <div className="font-mono text-xs text-light">6:00 PM GMT</div>
          </div>
          {isNext && !done && <Countdown date={e.date} />}
        </div>
      </div>
    </div>
  );

  if (clickable) {
    return (
      <button type="button" onClick={() => onSelect(dbRace.id)} aria-pressed={selected} className="lift text-left">
        {inner}
      </button>
    );
  }
  return inner;
}

export default function Races() {
  const { data: races, loading, error } = useApi(useCallback(() => api.races(), []));
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const panelRef = useRef(null);

  const raceByNumber = new Map((races || []).map((r) => [r.number, r]));

  useEffect(() => {
    if (races && races.length && !selectedId) {
      const last = [...races].reverse().find((r) => r.isCompleted);
      if (last) setSelectedId(last.id);
    }
  }, [races, selectedId]);

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
  const nextIdx = SCHEDULE.findIndex((e) => new Date(e.date).getTime() >= now);
  const hasAnyResults = races.some((r) => r.isCompleted);

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Schedule & Results"
        title="Races"
        subtitle="The full Season 7 calendar. Pick a completed round to see its results; upcoming rounds and special events show the schedule."
      />

      {/* Quick round picker */}
      {hasAnyResults && <RoundStrip races={races} selectedId={selectedId} onSelect={selectRace} />}

      {/* Selected race results */}
      <div ref={panelRef} className="scroll-mt-24">
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
        {!detail && !detailLoading && !hasAnyResults && (
          <div className="card p-8 text-center text-medium">No results yet — the season hasn't started.</div>
        )}
      </div>

      {/* Full calendar */}
      <div className="space-y-4">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-light">Full calendar</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SCHEDULE.map((e, i) => {
            const dbRace = e.type === "round" ? raceByNumber.get(e.number) : null;
            return (
              <RaceCard
                key={i}
                e={e}
                isNext={i === nextIdx}
                dbRace={dbRace}
                selected={!!dbRace && dbRace.id === selectedId}
                onSelect={selectRace}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
