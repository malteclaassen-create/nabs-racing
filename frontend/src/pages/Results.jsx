import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton, Skeleton } from "../components/ui.jsx";
import RaceResults from "../components/RaceResults.jsx";
import Flag from "../components/Flag.jsx";
import { circuitFor } from "../data/circuits.js";

// Horizontal strip of every round — replaces the old <select>. Each chip shows
// the round number, the circuit's flag and name, and its state: completed rounds
// are tinted green (with a check), the active round is ringed in brand pink, and
// upcoming rounds are dimmed.
function RoundStrip({ races, selectedId, onSelect }) {
  return (
    <div className="scrollbar-slim -mx-1 mb-7 flex gap-2 overflow-x-auto px-1 pb-2">
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
            <span
              className={`font-display text-lg font-black leading-none tabular-nums ${
                active ? "text-dark" : done ? "text-emerald-600" : "text-faint group-hover:text-light"
              }`}
            >
              {String(r.number).padStart(2, "0")}
            </span>
            {c && <Flag code={c.country} title={c.countryName} />}
            <span className="flex flex-col leading-tight">
              <span className="font-display text-sm font-bold uppercase tracking-tight text-dark">
                {r.track}
              </span>
              <span
                className={`flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider ${
                  done ? "text-emerald-600" : "text-light"
                }`}
              >
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

export default function Results() {
  const { data: races, loading, error } = useApi(useCallback(() => api.races(), []));
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // default to the latest completed race
  useEffect(() => {
    if (races && races.length && !selectedId) {
      const last = [...races].reverse().find((r) => r.isCompleted) || races[races.length - 1];
      setSelectedId(last.id);
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

  return (
    <div>
      <PageHeader eyebrow="Results" title="Race Results" subtitle="Browse the results of every round of Season 7." />

      <RoundStrip races={races} selectedId={selectedId} onSelect={setSelectedId} />

      {detailLoading && <TableSkeleton rows={10} />}
      {detailError && <ErrorBox message={detailError} />}
      {detail && !detailLoading && (
        <div>
          <div className="mb-4">
            <div className="flex items-center gap-3">
              {circuitFor(detail.race.track) && (
                <Flag
                  code={circuitFor(detail.race.track).country}
                  title={circuitFor(detail.race.track).countryName}
                  w={26}
                  h={19}
                />
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
    </div>
  );
}
