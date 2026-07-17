import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import Flag from "./Flag.jsx";
import { RollingNumber } from "./ui.jsx";
import { flagFor } from "../data/circuits.js";
import { fmtRaceTime, raceKickoff, LIVE_WINDOW_MS } from "../utils/raceTime.js";

// Compact, broadcast-style next-race countdown chip.
// `compact` renders a slimmer single-line version for the nav bar.
export default function NextRaceTimer({ className = "", compact = false }) {
  const races = useApi(useCallback(() => api.races(), []));

  // A once-a-second heartbeat; drives both the countdown and the switch to the
  // following round once a race has clearly finished.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Next round: the first uncompleted championship race that hasn't clearly
  // finished yet. A race whose start is longer than the live window ago is
  // over (its results just aren't imported yet), so the chip moves on to the
  // following round instead of showing LIVE for days. Rounds without a date
  // stay in (they're still the next round — their time is simply TBA).
  const nextRace = (races.data || []).find((r) => {
    if (r.isCompleted || r.isSpecialEvent || r.number == null) return false;
    const kickoff = raceKickoff(r.date);
    return !kickoff || kickoff.getTime() + LIVE_WINDOW_MS > now;
  });

  const target = nextRace ? raceKickoff(nextRace.date) : null;

  if (!nextRace) return null;

  const circuit = flagFor(nextRace.track, nextRace.country);
  const remaining = target ? target.getTime() - now : null;
  const live = remaining != null && remaining <= 0;

  const total = Math.max(0, Math.floor((remaining ?? 0) / 1000));
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

  const title = `Next race: ${nextRace.track} · Round ${nextRace.number} · ${
    target ? fmtRaceTime(target) : "time TBA"
  }`;

  if (compact) {
    return (
      <Link
        to={`/races?race=${nextRace.id}`}
        title={title}
        className={`group inline-flex items-center gap-2 rounded-lg border border-border bg-surface2/80 py-1.5 pl-2 pr-2.5 shadow-sm backdrop-blur transition hover:border-brand/50 ${className}`}
      >
        {circuit && <Flag code={circuit.country} title={circuit.countryName} w={16} h={12} />}
        <span className="hidden max-w-[10rem] truncate font-display text-xs font-extrabold uppercase tracking-tight text-dark sm:inline">
          {nextRace.track}
        </span>
        <span className="hidden h-4 w-px bg-border sm:inline-block" />
        {live ? (
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-eyebrow">Live</span>
        ) : !target ? (
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">TBA</span>
        ) : (
          <span className="flex items-baseline gap-1 tabular-nums">
            {/* Calmer than the inline chip: drop seconds, and hide minutes on
                the narrowest screens so it stays compact next to the logo. */}
            {units.slice(0, 3).map((u, i) => (
              <span
                key={u.suffix}
                className={`font-mono leading-none ${i === 2 ? "hidden sm:inline" : ""}`}
              >
                <RollingNumber value={u.value} digits={2} className="text-xs font-bold text-dark" />
                <span className="text-[9px] font-semibold text-light">{u.suffix}</span>
              </span>
            ))}
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      to={`/races?race=${nextRace.id}`}
      title={title}
      className={`group inline-flex items-stretch overflow-hidden rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur transition hover:border-brand/50 hover:shadow-card ${className}`}
    >
      {/* brand accent rail */}
      <span className="w-1 shrink-0 bg-brand" />

      <span className="flex items-center gap-3 py-2 pl-3 pr-3.5">
        {/* label + circuit */}
        <span className="flex items-center gap-2">
          <span className="live-dot inline-block h-2 w-2 shrink-0 rounded-full bg-brand" />
          <span className="flex flex-col leading-none">
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-eyebrow">
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
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-eyebrow">
            Lights out
          </span>
        ) : !target ? (
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-light">
            Time TBA
          </span>
        ) : (
          <span className="flex items-baseline gap-1.5 tabular-nums">
            {units.map((u) => (
              <span key={u.suffix} className="font-mono leading-none">
                <RollingNumber value={u.value} digits={2} className="text-base font-bold text-dark" />
                <span className="ml-px text-[11px] font-semibold text-light">{u.suffix}</span>
              </span>
            ))}
          </span>
        )}
      </span>
    </Link>
  );
}
