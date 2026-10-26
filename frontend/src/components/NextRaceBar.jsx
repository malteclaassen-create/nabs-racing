import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Flag from "./Flag.jsx";
import { RollingNumber } from "./ui.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtRaceTime, raceKickoff, LIVE_WINDOW_MS } from "../utils/raceTime.js";

// ---------------------------------------------------------------------------
// The next round as one strip across the top of the home page, the way the
// F1 site runs it under its menu: round and date, the flag and the track, the
// start in the visitor's own time, a ticking countdown and the sign-up.
//
// It took over from the next-race card that used to sit inside the hero, so
// the space under it can go to the news and the latest result.
// ---------------------------------------------------------------------------

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function roundLabel(race) {
  if (race.number != null) return `R${String(race.number).padStart(2, "0")}`;
  return race.type === "TRAINING" ? "Training" : "Event";
}

export default function NextRaceBar({ race, className = "" }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!race) return null;
  const circuit = flagFor(race.track, race.country);
  const kickoff = raceKickoff(race.date);
  const remaining = kickoff ? kickoff.getTime() - now : null;
  const live = remaining != null && remaining <= 0 && remaining > -LIVE_WINDOW_MS;
  const over = remaining != null && remaining <= -LIVE_WINDOW_MS;
  const sprint = race.raceFormat === "SPRINT_FEATURE";

  const total = Math.max(0, Math.floor((remaining ?? 0) / 1000));
  const units = [
    { value: Math.floor(total / 86400), suffix: "D" },
    { value: Math.floor((total % 86400) / 3600), suffix: "H" },
    { value: Math.floor((total % 3600) / 60), suffix: "M" },
    { value: total % 60, suffix: "S" },
  ];

  return (
    <div
      className={`relative flex flex-wrap items-center gap-x-6 gap-y-3 overflow-hidden rounded-2xl border border-black/10 bg-white py-3 pl-5 pr-3 shadow-sm dark:border-white/10 dark:bg-ink sm:pr-4 ${className}`}
    >
      {/* brand rail down the left edge, as on the other broadcast pieces */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-brand" />

      {/* round · date, then the flag and the track: the way in to the round */}
      <Link to={`/races?race=${race.id}`} className="group w-full min-w-0 sm:w-auto sm:flex-1" title="Open the round">
        <div className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-light">
          <span className="text-eyebrow">Next race</span>
          <span className="h-3 w-px bg-border" />
          <span>{roundLabel(race)}</span>
          {kickoff && (
            <>
              <span className="h-3 w-px bg-border" />
              <span>
                {WEEKDAYS[kickoff.getDay()]} {String(kickoff.getDate()).padStart(2, "0")} {MONTHS[kickoff.getMonth()]}
              </span>
            </>
          )}
          {sprint && (
            <span className="hidden rounded bg-brand/15 px-1.5 py-px text-[9px] tracking-widest text-brand sm:inline">
              Sprint weekend
            </span>
          )}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          {circuit && <Flag code={circuit.country} title={circuit.countryName} w={22} h={16} />}
          <span className="truncate font-display text-lg font-black uppercase leading-tight tracking-tight text-dark sm:text-xl">
            {race.track || "TBA"}
          </span>
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0 text-light transition group-hover:translate-x-0.5 group-hover:text-dark"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </div>
      </Link>

      {/* On a phone this is the second line: countdown left, sign-up right. */}
      <div className="flex w-full items-center justify-between gap-x-5 sm:w-auto sm:justify-end">
        {/* the start in the visitor's own clock */}
        {kickoff && !live && !over && (
          <div className="hidden text-right font-mono uppercase md:block">
            <div className="text-[10px] font-bold tracking-[0.16em] text-light">Lights out</div>
            <div className="text-sm font-bold text-dark">{fmtRaceTime(race.date)}</div>
          </div>
        )}

        {live ? (
          <Link
            to="/live"
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 font-mono text-xs font-bold uppercase tracking-widest text-onbrand"
          >
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-current" />
            Live now
          </Link>
        ) : over ? (
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-light">
            Race run · results soon
          </span>
        ) : kickoff ? (
          <div className="flex items-baseline gap-2 tabular-nums" aria-label="Time to the start" role="timer">
            {units.map((u, i) => (
              <span key={u.suffix} className={`font-mono leading-none ${i === 3 ? "hidden sm:inline" : ""}`}>
                <RollingNumber value={u.value} digits={2} className="font-display text-xl font-black text-dark sm:text-2xl" />
                <span className="ml-0.5 text-[10px] font-bold text-light">{u.suffix}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-light">Time TBA</span>
        )}

        {!over && !live && (
          <Link
            to={`/attendance?race=${race.id}`}
            className="shine group inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
          >
            Sign up
            <span className="transition group-hover:translate-x-0.5">→</span>
          </Link>
        )}
      </div>
    </div>
  );
}
