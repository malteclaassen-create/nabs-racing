import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import Flag from "./Flag.jsx";
import { circuitFor } from "../data/circuits.js";

function pad2(n) {
  return String(n ?? 0).padStart(2, "0");
}

// Compact, broadcast-style next-race countdown chip.
export default function NextRaceTimer({ className = "" }) {
  const races = useApi(useCallback(() => api.races(), []));
  const nextRace = (races.data || []).find((r) => !r.isCompleted);

  const nextDate = nextRace?.date ? new Date(nextRace.date) : null;
  // Races start at 18:00 GMT on the race date.
  const target = nextDate
    ? new Date(Date.UTC(nextDate.getFullYear(), nextDate.getMonth(), nextDate.getDate(), 18, 0, 0))
    : null;

  const [remaining, setRemaining] = useState(() => (target ? target.getTime() - Date.now() : 0));

  useEffect(() => {
    if (!target) return;
    setRemaining(target.getTime() - Date.now());
    const id = setInterval(() => setRemaining(target.getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target?.getTime()]);

  if (!nextRace) return null;

  const circuit = circuitFor(nextRace.track);
  const live = remaining <= 0;

  const total = Math.max(0, Math.floor(remaining / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const units = [
    { value: days, suffix: "d" },
    { value: hours, suffix: "h" },
    { value: mins, suffix: "m" },
    { value: secs, suffix: "s" },
  ];

  return (
    <Link
      to="/races"
      title={`Next race: ${nextRace.track} · Round ${nextRace.number} · 18:00 GMT`}
      className={`group inline-flex items-stretch overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur transition hover:border-brand/50 hover:shadow-card ${className}`}
    >
      {/* brand accent rail */}
      <span className="w-1 shrink-0 bg-brand" />

      <span className="flex items-center gap-3 py-2 pl-3 pr-3.5">
        {/* label + circuit */}
        <span className="flex items-center gap-2">
          <span className="live-dot inline-block h-2 w-2 shrink-0 rounded-full bg-brand" />
          <span className="flex flex-col leading-none">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-brand">
              Next Race
            </span>
            <span className="mt-1 flex items-center gap-1.5">
              {circuit && <Flag code={circuit.country} title={circuit.countryName} w={16} h={12} />}
              <span className="font-display text-sm font-extrabold uppercase leading-none tracking-tight text-dark">
                {nextRace.track}
              </span>
            </span>
          </span>
        </span>

        <span className="h-7 w-px bg-border" />

        {/* countdown */}
        {live ? (
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-brand">
            Lights out
          </span>
        ) : (
          <span className="flex items-baseline gap-1.5 tabular-nums">
            {units.map((u) => (
              <span key={u.suffix} className="font-mono leading-none">
                <span className="text-base font-bold text-dark">{pad2(u.value)}</span>
                <span className="ml-px text-[11px] font-semibold text-light">{u.suffix}</span>
              </span>
            ))}
          </span>
        )}
      </span>
    </Link>
  );
}
