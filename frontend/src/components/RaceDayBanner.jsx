import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Flag from "./Flag.jsx";
import RaceCountdown from "./RaceCountdown.jsx";
import { circuitFor } from "../data/circuits.js";
import { fmtRaceTime } from "../utils/raceTime.js";

// Race-day switch for the home page: invisible on ordinary days, and in the
// last 24h before lights-out it surfaces the countdown, the viewer's own
// sign-up state and who's already confirmed. From the start time it flips to
// a "live now" state that points at the live timing page.
const SHOW_BEFORE_MS = 24 * 60 * 60 * 1000;
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000; // treat the race as on track for 3h

// Date-only race entries land on UTC midnight; the league's real start for
// those is 18:00 GMT (same fallback RaceCountdown uses).
function startMs(date) {
  const d = new Date(date);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 18, 0, 0);
  }
  return d.getTime();
}

export default function RaceDayBanner({ race, event, myStatus }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!race?.date) return null;
  const start = startMs(race.date);
  const isLive = now >= start && now - start <= LIVE_WINDOW_MS;
  const isSoon = !isLive && start > now && start - now <= SHOW_BEFORE_MS;
  if (!isLive && !isSoon) return null;

  // Only trust the event data when it belongs to this race.
  const ev = event && (event.id === race.id || event.number === race.number) ? event : null;
  const confirmed = ev?.rsvps?.ACCEPTED || [];
  const circuit = circuitFor(race.track);
  const signedUp = myStatus === "ACCEPTED";

  return (
    <section
      className={`dark reveal relative overflow-hidden rounded-2xl bg-ink p-5 shadow-xl shadow-ink/20 ring-1 sm:p-6 ${
        isLive ? "ring-red-500/40" : "ring-white/10"
      }`}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        {/* race identity */}
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.25em]">
            <span
              className={`live-dot inline-block h-2 w-2 rounded-full ${isLive ? "bg-red-500" : "bg-brand"}`}
            />
            <span className={isLive ? "text-red-400" : "text-eyebrow"}>
              {isLive ? "Live now" : "Race day"}
            </span>
            <span className="text-white/40">Round {race.number}</span>
          </div>
          <div className="mt-2 flex min-w-0 items-center gap-3">
            {circuit && <Flag code={circuit.country} title={circuit.countryName} w={26} h={19} />}
            <span className="truncate font-display text-3xl font-black uppercase leading-none tracking-tight text-white sm:text-4xl">
              {race.track}
            </span>
          </div>
          <div className="mt-2 font-mono text-xs uppercase tracking-wider text-white/60">
            {isLive ? "On track" : "Today"} · {fmtRaceTime(race.date)}
            {ev && (
              <>
                {" "}· {confirmed.length}/{ev.capacity} on the grid
              </>
            )}
          </div>
          {/* who's in: a handful of confirmed names, team colour = meaning */}
          {confirmed.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {confirmed.slice(0, 6).map((d) => (
                <Link
                  key={d.driverId}
                  to={`/drivers/${d.driverId}`}
                  className="flex items-center gap-1.5 text-sm font-semibold text-white/80 transition hover:text-white"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: d.team?.color || "#64748b" }}
                  />
                  {d.name}
                </Link>
              ))}
              {confirmed.length > 6 && (
                <Link to={`/attendance?race=${race.id}`} className="text-sm text-white/50 transition hover:text-white">
                  +{confirmed.length - 6} more
                </Link>
              )}
            </div>
          )}
        </div>

        {/* action side: countdown + sign-up before the start, live CTA after */}
        <div className="w-full shrink-0 lg:w-80">
          {isLive ? (
            <Link
              to="/live"
              className="shine group flex w-full items-center justify-center gap-2.5 rounded-xl bg-red-500 px-5 py-4 font-display text-lg font-black uppercase tracking-wide text-white transition hover:brightness-110"
            >
              <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-white" />
              Live Timing
              <span className="transition group-hover:translate-x-0.5">→</span>
            </Link>
          ) : (
            <>
              <RaceCountdown date={race.date} />
              {signedUp ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    You're signed up
                  </span>
                  <Link to={`/attendance?race=${race.id}`} className="text-xs font-semibold uppercase tracking-wider text-white/50 transition hover:text-white">
                    Change
                  </Link>
                </div>
              ) : (
                <Link
                  to={`/attendance?race=${race.id}`}
                  className="shine group mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
                >
                  {myStatus ? "Change your response" : "Sign up"}
                  <span className="transition group-hover:translate-x-0.5">→</span>
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
