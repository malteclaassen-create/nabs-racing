import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton } from "../components/ui.jsx";
import RaceResults from "../components/RaceResults.jsx";
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

function fmt(d) {
  return new Date(d).toLocaleDateString("en-GB", {
    weekday: "short", day: "2-digit", month: "long", year: "numeric",
  });
}

// One schedule entry. Completed championship rounds (those with a DB race) are
// buttons that load their results; special events and upcoming rounds are static.
function ScheduleRow({ e, isNext, dbRace, selected, onSelect }) {
  const past = new Date(e.date).getTime() < Date.now();
  const se = e.type === "se";
  const circuit = se ? null : circuitFor(e.track);
  const done = !!dbRace?.isCompleted;
  const clickable = done && !!dbRace;

  const badge = (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-display text-lg font-black tabular-nums ${
        se ? "bg-emerald-500/15 text-emerald-600" : done ? "bg-emerald-500/15 text-emerald-600" : past ? "bg-surface2 text-light" : "bg-brand/20 text-dark"
      }`}
    >
      {se ? "SE" : e.number}
    </div>
  );

  const body = (
    <>
      {badge}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {circuit && <Flag code={circuit.country} title={circuit.countryName} />}
          <span className={`font-display text-lg font-extrabold uppercase tracking-tight ${se ? "text-emerald-600" : "text-dark"}`}>
            {e.track}
          </span>
          {se && <span className="pill bg-emerald-500/15 text-emerald-600">Special Event</span>}
          {isNext && !done && <span className="pill bg-brand/20 text-dark">Next up</span>}
          {done && <span className="pill bg-emerald-500/15 text-emerald-600">Results</span>}
          {past && !done && !se && <span className="pill bg-surface2 text-light">Done</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-sm font-semibold tabular-nums text-medium">{fmt(e.date)}</div>
        <div className="font-mono text-xs text-light">6:00 PM GMT</div>
      </div>
    </>
  );

  const base = "flex w-full items-center gap-4 border-b border-border px-5 py-4 text-left last:border-0 transition";
  if (clickable) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onSelect(dbRace.id)}
          aria-pressed={selected}
          className={`${base} ${selected ? "bg-brand/10" : "hover:bg-surface2"}`}
        >
          {body}
        </button>
      </li>
    );
  }
  return <li className={`${base} ${isNext ? "bg-brand/5" : ""}`}>{body}</li>;
}

export default function Races() {
  const { data: races, loading, error } = useApi(useCallback(() => api.races(), []));
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const panelRef = useRef(null);

  // Map round number -> DB race, so schedule rows can find their results.
  const raceByNumber = new Map((races || []).map((r) => [r.number, r]));

  // Default to the latest completed race.
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
        <TableSkeleton rows={10} />
      </div>
    );
  if (error) return <ErrorBox message={error} />;

  // first event still in the future = "next"
  const now = Date.now();
  const nextIdx = SCHEDULE.findIndex((e) => new Date(e.date).getTime() >= now);
  const half = Math.ceil(SCHEDULE.length / 2);
  const hasAnyResults = races.some((r) => r.isCompleted);

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Schedule & Results"
        title="Races"
        subtitle="The full Season 7 calendar. Pick a completed round to see its results; upcoming rounds and special events show the schedule."
      />

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

      {/* Full schedule */}
      <div className="space-y-3">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-light">Full calendar</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          {[SCHEDULE.slice(0, half), SCHEDULE.slice(half)].map((chunk, col) => (
            <div key={col} className="card overflow-hidden self-start">
              <ul>
                {chunk.map((e, j) => {
                  const i = col * half + j;
                  const dbRace = e.type === "round" ? raceByNumber.get(e.number) : null;
                  return (
                    <ScheduleRow
                      key={i}
                      e={e}
                      isNext={i === nextIdx}
                      dbRace={dbRace}
                      selected={!!dbRace && dbRace.id === selectedId}
                      onSelect={selectRace}
                    />
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
