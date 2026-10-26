import { useEffect, useState } from "react";

export default function Countdown({ to }) {
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
    <div className="flex gap-2" aria-label="Time until the start">
      {parts.map(([n, label]) => (
        <div key={label} className="min-w-[64px] rounded-xl border border-line bg-bg px-3 py-2 text-center">
          <div className="text-2xl font-black tabular">{String(n).padStart(2, "0")}</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</div>
        </div>
      ))}
    </div>
  );
}
