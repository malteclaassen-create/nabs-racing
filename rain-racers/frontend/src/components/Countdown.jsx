import { useEffect, useState } from "react";

const pad = (n) => String(n).padStart(2, "0");

// The time to the start, as words in a sentence: "2 days 3 h" while it is
// days away, "3:20:33" on the day.
export default function Countdown({ to, className = "" }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, new Date(to).getTime() - now);
  if (left === 0) return <span className={`font-bold text-accent ${className}`}>racing now</span>;
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return <span className={`font-bold tabular ${className}`}>{d > 0 ? `${d} ${d === 1 ? "day" : "days"} ${h} h` : `${h}:${pad(m)}:${pad(s)}`}</span>;
}
