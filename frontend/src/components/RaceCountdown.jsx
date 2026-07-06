import { useEffect, useState } from "react";

function pad2(n) {
  return String(n ?? 0).padStart(2, "0");
}

// Big, broadcast-style live countdown to the next race.
// Renders four numerals (Days / Hrs / Min / Sec) and flips to a pulsing
// "Lights Out" badge the moment the lights go green.
export default function RaceCountdown({ date, className = "" }) {
  const nextDate = date ? new Date(date) : null;
  // The stored date is the real kickoff instant. Older/date-only entries land
  // on UTC midnight, so fall back to the league's 18:00 GMT start for those.
  const target = nextDate
    ? nextDate.getUTCHours() === 0 && nextDate.getUTCMinutes() === 0
      ? new Date(Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth(), nextDate.getUTCDate(), 18, 0, 0))
      : nextDate
    : null;

  const [remaining, setRemaining] = useState(() => (target ? target.getTime() - Date.now() : 0));

  useEffect(() => {
    if (!target) return;
    setRemaining(target.getTime() - Date.now());
    const id = setInterval(() => setRemaining(target.getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target?.getTime()]);

  if (!target) return null;

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
            {pad2(u.value)}
          </span>
          <span className="mt-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-ink/45 dark:text-white/55">
            {u.label}
          </span>
        </div>
      ))}
    </div>
  );
}
