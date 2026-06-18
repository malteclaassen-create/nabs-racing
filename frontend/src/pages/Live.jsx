import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useLiveTiming } from "../hooks/useLiveTiming.js";
import { PageHeader, SectionHeading } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import {
  makeDriverMatcher,
  formatLap,
  formatGap,
  formatSector,
  formatCountdown,
  formatRunning,
  formatDelta,
  countryCodeFromName,
} from "../data/liveTiming.js";

function prettyWeather(w) {
  if (!w) return null;
  return w.replace(/^\d+_/, "").replace(/_/g, " ");
}

function LiveBadge({ live }) {
  const color = live ? "#22c55e" : "#f59e0b";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider">
      <span className="relative flex h-2.5 w-2.5">
        {live && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      </span>
      <span style={{ color }}>{live ? "Live" : "Reconnecting"}</span>
    </span>
  );
}

// Live-ticking session countdown: re-syncs to the server value each board tick,
// then counts down locally between snapshots (which arrive only every ~30s).
function Countdown({ baseMs, receivedAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (baseMs == null) return <span className="font-mono tabular-nums text-dark">—</span>;
  const remaining = baseMs - (now - receivedAt);
  return <span className="font-mono tabular-nums text-dark">{formatCountdown(remaining)}</span>;
}

function Stat({ label, children }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-light">
        {label}
      </div>
      {children}
    </div>
  );
}

function SessionHeader({ session, receivedAt }) {
  const code = countryCodeFromName(session.country);
  const weather = prettyWeather(session.weather);
  return (
    <div className="reveal card relative overflow-hidden">
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-amber-500 to-sky-600" />
      <div className="grid gap-5 p-6 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-brand">
            <span>{session.type}</span>
            {session.sessionCount > 1 && (
              <span className="text-faint">
                {session.sessionIndex + 1}/{session.sessionCount}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2.5">
            {code && <Flag code={code} title={session.country} w={26} h={19} />}
            <span className="font-display text-xl font-extrabold uppercase tracking-tight text-dark">
              {session.trackName}
            </span>
          </div>
          {session.serverName && (
            <div className="mt-1 truncate text-xs text-light">{session.serverName}</div>
          )}
        </div>

        <Stat label="Session Best">
          <span className="font-mono text-2xl font-bold tabular-nums text-dark">
            {formatLap(session.bestLapMs)}
          </span>
        </Stat>

        <Stat label="Time Left">
          <span className="text-2xl font-bold">
            <Countdown baseMs={session.remainingMs} receivedAt={receivedAt} />
          </span>
        </Stat>

        <Stat label="Drivers">
          <span className="font-mono text-2xl font-bold tabular-nums text-dark">
            {session.driverCount}
          </span>
          <span className="ml-2 font-mono text-xs text-light">{session.onTrackCount} on track</span>
        </Stat>

        <Stat label="Conditions">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            {session.ambientTemp != null && (
              <span className="text-medium">
                Air <span className="font-mono font-bold text-dark">{session.ambientTemp}°</span>
              </span>
            )}
            {session.roadTemp != null && (
              <span className="text-medium">
                Track <span className="font-mono font-bold text-dark">{session.roadTemp}°</span>
              </span>
            )}
            {weather && <span className="capitalize text-light">{weather}</span>}
          </div>
        </Stat>
      </div>
    </div>
  );
}

// One best-lap sector chip, coloured purple (overall best) / green (personal
// best) / amber (other), matching sim-racing timing convention.
function Sector({ s }) {
  if (!s) return <span className="inline-block w-[52px] text-center font-mono text-xs text-faint">—</span>;
  const cls = s.best
    ? "bg-violet-500/20 text-violet-500"
    : s.driversBest
    ? "bg-emerald-500/15 text-emerald-600"
    : "bg-amber-500/10 text-amber-600";
  return (
    <span className={`inline-block w-[52px] rounded text-center font-mono text-xs font-semibold tabular-nums ${cls}`}>
      {formatSector(s.ms)}
    </span>
  );
}

// Live-ticking current-lap clock for an on-track driver (now - lastLapAt).
function CurrentLap({ lastLapAt, inPits }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  if (inPits) return <span className="font-mono text-xs font-bold uppercase text-amber-600">In pit</span>;
  if (!lastLapAt) return <span className="font-mono tabular-nums text-light">—</span>;
  const ms = now - lastLapAt;
  if (ms < 0 || ms > 15 * 60 * 1000) return <span className="font-mono tabular-nums text-light">—</span>;
  return <span className="font-mono font-bold tabular-nums text-dark">{formatRunning(ms)}</span>;
}

// Shared driver identity cell (team colour bar, flag, name, team).
function DriverCell({ e, match, showLiveDot }) {
  const name = match?.nabsName || e.name;
  const color = match?.teamColor || "var(--c-border)";
  return (
    <div className="flex items-center gap-3">
      <span className="relative flex h-8 w-1.5 shrink-0 items-center">
        <span className="h-full w-full rounded-full" style={{ backgroundColor: color }} />
        {showLiveDot && e.onTrack && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" title="On track" />
        )}
      </span>
      {match?.country ? (
        <Flag code={match.country} title={match.teamName} />
      ) : (
        <span className="h-[15px] w-5 shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block truncate font-display text-base font-bold uppercase tracking-tight text-dark" title={e.name}>
          {name}
        </span>
        <span className="block truncate text-xs text-light">{match?.teamName || e.carName || "—"}</span>
      </span>
      {e.raceNumber != null && (
        <span className="ml-1 hidden font-mono text-xs font-bold text-faint xl:inline">#{e.raceNumber}</span>
      )}
    </div>
  );
}

// A row in the "On Track Now" table — live current lap + delta to personal best.
function OnTrackRow({ e, match }) {
  const deltaCls = e.deltaSelfMs == null ? "text-light" : e.deltaSelfMs < 0 ? "text-emerald-600" : "text-amber-600";
  return (
    <tr className="border-b border-border last:border-0 transition hover:bg-surface2">
      <td className="py-3 pl-5 pr-2 text-center">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-base font-black tabular-nums text-medium">
          {e.position}
        </span>
      </td>
      <td className="py-3 pl-1 pr-3">
        <DriverCell e={e} match={match} />
      </td>
      <td className="hidden py-3 pr-4 text-center sm:table-cell">
        {e.tyre && <span className="pill bg-surface2 text-medium">{e.tyre}</span>}
      </td>
      <td className="py-3 pr-4 text-right text-base">
        <CurrentLap lastLapAt={e.lastLapAt} inPits={e.inPits} />
      </td>
      <td className="hidden py-3 pr-4 text-right sm:table-cell">
        <span className={`font-mono text-sm tabular-nums ${deltaCls}`}>{formatDelta(e.deltaSelfMs)}</span>
      </td>
      <td className="hidden py-3 pr-4 text-right md:table-cell">
        <span className="font-mono text-sm tabular-nums text-medium">{formatLap(e.lastLapMs)}</span>
      </td>
      <td className="py-3 pr-4 text-right">
        <span className="font-mono text-base font-bold tabular-nums text-dark">{formatLap(e.bestLapMs)}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center tabular-nums md:table-cell">
        <span className="font-mono text-sm text-medium">{e.lapCount}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center tabular-nums lg:table-cell">
        <span className="font-mono text-sm text-light">{e.numPits}</span>
      </td>
      <td className="hidden py-3 pr-4 text-right tabular-nums lg:table-cell">
        <span className="font-mono text-sm text-light">{e.ping ?? "—"}</span>
      </td>
      <td className="py-3 pr-5 text-right">
        <div className="flex justify-end gap-1.5">
          {e.drs && <span className="pill bg-sky-500/15 text-sky-600">DRS</span>}
          {e.inPits && <span className="pill bg-amber-500/15 text-amber-600">PIT</span>}
        </div>
      </td>
    </tr>
  );
}

const ONTRACK_COLS = [
  { label: "Pos", cls: "w-14 py-3 pl-5 text-center" },
  { label: "Driver", cls: "py-3 pl-1" },
  { label: "Tyre", cls: "hidden py-3 pr-4 text-center sm:table-cell" },
  { label: "Current", cls: "py-3 pr-4 text-right" },
  { label: "Δ PB", cls: "hidden py-3 pr-4 text-right sm:table-cell" },
  { label: "Last", cls: "hidden py-3 pr-4 text-right md:table-cell" },
  { label: "Best", cls: "py-3 pr-4 text-right" },
  { label: "Laps", cls: "hidden py-3 pr-4 text-center md:table-cell" },
  { label: "Pits", cls: "hidden py-3 pr-4 text-center lg:table-cell" },
  { label: "Ping", cls: "hidden py-3 pr-4 text-right lg:table-cell" },
  { label: "", cls: "py-3 pr-5" },
];

function Row({ e, match }) {
  const isP1 = e.position === 1;
  return (
    <tr
      className={`group border-b border-border last:border-0 transition hover:bg-surface2 ${
        isP1 ? "bg-brand/5" : ""
      }`}
    >
      <td className="py-3 pl-5 pr-2 text-center">
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md font-display text-base font-black tabular-nums ${
            isP1 ? "bg-brand text-ink" : "text-medium"
          }`}
        >
          {e.position}
        </span>
      </td>
      <td className="py-3 pl-1 pr-3">
        <DriverCell e={e} match={match} showLiveDot />
      </td>
      {/* sectors */}
      <td className="hidden py-3 pr-4 lg:table-cell">
        <div className="flex gap-1">
          {e.sectors.map((s, i) => (
            <Sector key={i} s={s} />
          ))}
        </div>
      </td>
      <td className="py-3 pr-4 text-right">
        <span className={`font-mono text-base font-bold tabular-nums ${isP1 ? "text-brand" : "text-dark"}`}>
          {formatLap(e.bestLapMs)}
        </span>
      </td>
      <td className="hidden py-3 pr-4 text-right md:table-cell">
        <span className="font-mono text-sm tabular-nums text-violet-500" title="Ideal lap (sum of best sectors)">
          {formatLap(e.potentialMs)}
        </span>
      </td>
      <td className="py-3 pr-4 text-right">
        <span className="font-mono text-sm tabular-nums text-light">{formatGap(e.gapToBestMs)}</span>
      </td>
      <td className="hidden py-3 pr-4 text-right sm:table-cell">
        <span className="font-mono text-sm tabular-nums text-medium">{formatLap(e.lastLapMs)}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center tabular-nums md:table-cell">
        <span className="font-mono text-sm text-medium">{e.lapCount}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center lg:table-cell">
        {e.tyre && <span className="pill bg-surface2 text-medium">{e.tyre}</span>}
      </td>
      <td className="hidden py-3 pr-4 text-right xl:table-cell">
        <span className="font-mono text-sm tabular-nums text-light">{e.topSpeed || "—"}</span>
      </td>
      <td className="hidden py-3 pr-4 text-center tabular-nums xl:table-cell">
        <span className="font-mono text-sm text-light">{e.numPits}</span>
      </td>
      <td className="hidden py-3 pr-4 text-right xl:table-cell">
        <span className="font-mono text-sm tabular-nums text-light">{e.onTrack && e.ping != null ? e.ping : "—"}</span>
      </td>
      <td className="py-3 pr-5 text-right">
        <div className="flex justify-end gap-1.5">
          {e.drs && <span className="pill bg-sky-500/15 text-sky-600">DRS</span>}
          {e.inPits && <span className="pill bg-amber-500/15 text-amber-600">PIT</span>}
        </div>
      </td>
    </tr>
  );
}

const COLS = [
  { label: "Pos", cls: "w-14 py-3 pl-5 text-center" },
  { label: "Driver", cls: "py-3 pl-1" },
  { label: "Sectors", cls: "hidden py-3 pr-4 lg:table-cell" },
  { label: "Best", cls: "py-3 pr-4 text-right" },
  { label: "Potential", cls: "hidden py-3 pr-4 text-right md:table-cell" },
  { label: "Gap", cls: "py-3 pr-4 text-right" },
  { label: "Last", cls: "hidden py-3 pr-4 text-right sm:table-cell" },
  { label: "Laps", cls: "hidden py-3 pr-4 text-center md:table-cell" },
  { label: "Tyre", cls: "hidden py-3 pr-4 text-center lg:table-cell" },
  { label: "Top", cls: "hidden py-3 pr-4 text-right xl:table-cell" },
  { label: "Pits", cls: "hidden py-3 pr-4 text-center xl:table-cell" },
  { label: "Ping", cls: "hidden py-3 pr-4 text-right xl:table-cell" },
  { label: "", cls: "py-3 pr-5" },
];

export default function Live() {
  const { board, socketState } = useLiveTiming();
  const { data: teams } = useApi(useCallback(() => api.teams(), []));
  const match = useMemo(() => makeDriverMatcher(teams), [teams]);

  const connected = board?.connected && !board?.stale && socketState === "open";
  const session = board?.session;
  const entries = board?.entries || [];
  const onTrack = entries.filter((e) => e.onTrack);
  const receivedAt = useMemo(() => Date.now(), [board?.updatedAt]);

  return (
    <div>
      <PageHeader
        eyebrow="Real-time"
        title="Live Timing"
        subtitle="Direct from the NABS Assetto Corsa server — sectors, potential lap, gaps and pit data, updating live."
        right={<LiveBadge live={connected} />}
      />

      {!session ? (
        <div className="card flex flex-col items-center justify-center gap-3 py-20 text-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-brand" />
          <p className="font-mono text-sm uppercase tracking-wider text-light">
            {socketState === "open" ? "Waiting for the server…" : "Connecting to the server…"}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <SessionHeader session={session} receivedAt={receivedAt} />

          {/* ===== On track now — live current lap, separate from the table ===== */}
          {onTrack.length > 0 && (
            <section className="space-y-4">
              <SectionHeading
                eyebrow="Out on track"
                title="Driving Now"
                right={
                  <span className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-emerald-600">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    </span>
                    {onTrack.length} live
                  </span>
                }
              />
              <div className="card overflow-hidden ring-1 ring-emerald-500/20">
                <div className="scrollbar-slim overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-light">
                        {ONTRACK_COLS.map((c, i) => (
                          <th key={i} className={c.cls}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {onTrack.map((e) => (
                        <OnTrackRow key={e.guid} e={e} match={match(e.name)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* ===== Full session-best leaderboard (all drivers) ===== */}
          <section className="space-y-4">
            <SectionHeading eyebrow="Classification" title="Session Best Times" />
            {entries.length === 0 ? (
              <div className="card py-16 text-center text-light">
                Session is live — no times set yet.
              </div>
            ) : (
              <div className="reveal card overflow-hidden">
                <div className="scrollbar-slim overflow-x-auto">
                  <table className="w-full min-w-[680px]">
                    <thead>
                      <tr className="border-b border-border text-left font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-light">
                        {COLS.map((c, i) => (
                          <th key={i} className={c.cls}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <Row key={e.guid} e={e} match={match(e.name)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* legend */}
          <div className="flex flex-wrap items-center gap-4 px-1 font-mono text-[11px] uppercase tracking-wider text-light">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-violet-500/40" /> Fastest sector
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-emerald-500/30" /> Personal best
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> On track now
            </span>
            <span className="text-faint">Potential = sum of best sectors</span>
          </div>

          {!connected && (
            <p className="text-center font-mono text-xs uppercase tracking-wider text-amber-600">
              Connection lost — showing last known data, reconnecting…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
