import { useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import CircuitMap from "./CircuitMap.jsx";
import Flag from "./Flag.jsx";
import { circuitFor } from "../data/circuits.js";
import { exportSvgToPng } from "../utils/svgExport.js";

const MAX_LAP_MS = 1_800_000;
function fmtLap(ms) {
  if (!ms || ms <= 0 || ms > MAX_LAP_MS) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

function countdown(date) {
  if (!date) return "Date to be confirmed";
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
  if (days <= 0) return "Race day";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

const RECORD_ICONS = {
  trophy: "M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3",
  stopwatch: "M12 13V9M9 2h6M19 6l-1.5 1.5M12 21a8 8 0 100-16 8 8 0 000 16z",
  flag: "M5 21V4M5 4c3-1.5 6 1.5 9 0s4-1 4-1v9s-1 .5-4 1-6-1.5-9 0",
  burst: "M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19",
  cut: "M6 6l12 12M6 18L18 6",
  info: "M12 8h.01M11 12h1v4h1",
};

function RecordRow({ icon, label, name, driverId, value }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-2.5 last:border-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2 text-light">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={RECORD_ICONS[icon] || RECORD_ICONS.info} />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{label}</div>
        {driverId ? (
          <Link to={`/drivers/${driverId}`} className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark hover:text-brand">
            {name}
          </Link>
        ) : (
          <div className="truncate font-display text-sm font-extrabold uppercase tracking-tight text-dark">{name}</div>
        )}
      </div>
      <div className="shrink-0 font-mono text-xs font-bold tabular-nums text-medium">{value}</div>
    </div>
  );
}

export default function UpcomingRacePanel({ race }) {
  const mapRef = useRef(null);
  const { data: history, loading } = useApi(useCallback(() => api.trackHistory(race.track), [race.track]));
  const circuit = circuitFor(race.track);

  function downloadPng() {
    const svg = mapRef.current?.querySelector("svg");
    exportSvgToPng(svg, { fileName: `nabs-${(history?.key || race.track).toLowerCase()}.png` });
  }

  const s = history?.stats || {};
  const records = [];
  if (s.mostWins) records.push({ icon: "trophy", label: "Most wins here", ...s.mostWins, value: `${s.mostWins.count}` });
  if (s.fastestLap) records.push({ icon: "stopwatch", label: `Fastest race lap · S${s.fastestLap.seasonNumber}`, ...s.fastestLap, value: fmtLap(s.fastestLap.ms) });
  if (s.mostPoles) records.push({ icon: "flag", label: "Most poles here", ...s.mostPoles, value: `${s.mostPoles.count}` });
  if (s.mostCrashes) records.push({ icon: "burst", label: "Most crashes here", ...s.mostCrashes, value: `${s.mostCrashes.count}` });
  if (s.mostCuts) records.push({ icon: "cut", label: "Most cuts here", ...s.mostCuts, value: `${s.mostCuts.count}` });
  const customFacts = history?.customFacts || [];

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div className="card relative overflow-hidden p-5 sm:p-6">
        <span className="absolute inset-x-0 top-0 h-1.5 bg-brand" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              {circuit && <Flag code={circuit.country} w={26} h={19} />}
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">
                Round {race.number} · Up next
              </span>
            </div>
            <h2 className="mt-1 font-display text-3xl font-black uppercase tracking-tight text-dark sm:text-4xl">
              {race.track}
            </h2>
            <div className="mt-1 font-mono text-sm font-bold uppercase tracking-wide text-medium">
              {countdown(race.date)}
              {race.date && (
                <span className="ml-2 text-light">
                  {new Date(race.date).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
                </span>
              )}
            </div>
          </div>
          <Link to={`/attendance?race=${race.id}`} className="btn-primary shrink-0">
            Sign up now
          </Link>
        </div>
      </div>

      {/* Infographic: circuit map (left) + track record (right) */}
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="card flex flex-col p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-light">Circuit</h3>
            {circuit && (
              <button className="btn-secondary px-3 py-1 text-xs" onClick={downloadPng}>
                Download PNG
              </button>
            )}
          </div>
          <div ref={mapRef} className="flex flex-1 items-center justify-center py-4">
            {circuit ? (
              <CircuitMap track={race.track} animate stroke="var(--c-text)" strokeWidth={2} className="h-56 w-full text-dark sm:h-72" />
            ) : (
              <div className="py-10 text-center text-sm text-light">No outline for this track yet.</div>
            )}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="mb-1 font-mono text-xs font-bold uppercase tracking-widest text-light">Track record</h3>
          {loading ? (
            <div className="py-8 text-center text-sm text-light">Loading history…</div>
          ) : records.length === 0 && customFacts.length === 0 ? (
            <div className="py-8 text-center text-sm text-light">First time here. No history at this track yet.</div>
          ) : (
            <div>
              {records.map((r) => (
                <RecordRow key={r.label} {...r} />
              ))}
              {customFacts.map((f, i) => (
                <RecordRow key={`c${i}`} icon="info" label={f.label} name={f.value} value="" />
              ))}
            </div>
          )}
          {history?.mapImageUrl && (
            <img src={history.mapImageUrl} alt="Track map" className="mt-4 w-full rounded-lg border border-border" />
          )}
        </div>
      </div>
    </div>
  );
}
