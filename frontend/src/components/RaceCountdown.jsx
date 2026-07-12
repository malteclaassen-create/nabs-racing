import { useEffect, useState } from "react";
import { RollingNumber } from "./ui.jsx";
import { raceKickoff, LIVE_WINDOW_MS } from "../utils/raceTime.js";

// Big, broadcast-style live countdown to the next race.
// Renders four numerals (Days / Hrs / Min / Sec), flips to a pulsing
// "Lights Out" badge while the race is presumably running, and settles into a
// quiet "results coming soon" note once the race is clearly over but its
// results haven't been imported yet — instead of blinking LIVE for days.
export default function RaceCountdown({ date, className = "" }) {
  const target = raceKickoff(date);

  const [remaining, setRemaining] = useState(() => (target ? target.getTime() - Date.now() : 0));

  useEffect(() => {
    if (!target) return;
    setRemaining(target.getTime() - Date.now());
    const id = setInterval(() => setRemaining(target.getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target?.getTime()]);

  if (!target) return null;

  // Race over (past the live window), results not in yet: calm placeholder.
  if (remaining <= -LIVE_WINDOW_MS) {
    return (
      <div
        className={`flex items-center justify-center gap-2 rounded-xl bg-ink/[0.06] px-4 py-3 dark:bg-white/10 ${className}`}
      >
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink/60 dark:text-white/60">
          Race run · results coming soon
        </span>
      </div>
    );
  }

  if (remaining <= 0) {
    return (
      <div
        className={`flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-ink ${className}`}
      >
        <span className="live-dot inline-block h-2 w-2 rounded-full bg-ink" />
        <span className="font-display text-lg font-black uppercase tracking-[0.2em]">Lights Out</span>
      </div>
    );
  }

  const total = Math.max(0, Math.floor(remaining / 1000));
  const units = [
    { value: Math.floor(total / 86400), label: "Days" },
    { value: Math.floor((total % 86400) / 3600), label: "Hrs" },
    { value: Math.floor((total % 3600) / 60), label: "Min" },
    { value: total % 60, label: "Sec", live: true },
  ];

  return (
    <div className={`grid grid-cols-4 gap-1.5 ${className}`}>
      {units.map((u) => (
        <div
          key={u.label}
          className="flex flex-col items-center rounded-xl bg-ink/[0.06] py-2.5 dark:bg-white/10"
        >
          <span
            className={`font-mono text-2xl font-black leading-none tabular-nums sm:text-[1.7rem] ${
              u.live ? "text-eyebrow" : "text-ink dark:text-white"
            }`}
          >
            <RollingNumber value={u.value} digits={2} />
          </span>
          <span className="mt-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-ink/45 dark:text-white/55">
            {u.label}
          </span>
        </div>
      ))}
    </div>
  );
}
