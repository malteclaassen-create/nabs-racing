import { useEffect, useState } from "react";

export default function Countdown({ to, compact = false }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, new Date(to).getTime() - now);
  if (left === 0) return <div className="text-2xl font-black uppercase italic text-accent">Lights out</div>;
  const parts = [
    [Math.floor(left / 86400000), "days"],
    [Math.floor((left % 86400000) / 3600000), "hrs"],
    [Math.floor((left % 3600000) / 60000), "min"],
    [Math.floor((left % 60000) / 1000), "sec"],
  ];
  return (
    <div className={`flex gap-2 ${compact ? "max-w-sm" : ""}`} aria-label="Time until the start">
      {parts.map(([n, label]) => (
        <div
          key={label}
          className={`rounded-xl border border-line bg-bg text-center transition-colors hover:border-ink/30 ${compact ? "min-w-[56px] flex-1 px-2 py-1.5" : "min-w-[64px] px-3 py-2"}`}
        >
          {/* keyed on the value, so a digit that changes drops in */}
          <div className={`overflow-hidden font-black italic tabular ${compact ? "text-xl" : "text-2xl"}`}>
            <span key={n} className="tick">
              {String(n).padStart(2, "0")}
            </span>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</div>
        </div>
      ))}
    </div>
  );
}
