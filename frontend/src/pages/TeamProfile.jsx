import { useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeaderSkeleton, Skeleton, TierBadge, MEDAL, DriverAvatar } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import PointsChart from "../components/PointsChart.jsx";
import { circuitFor } from "../data/circuits.js";
import { countryFor } from "../data/driverCountries.js";

const TIER_LABEL = { 1: "Tier 1", 2: "Tier 2", 0: "Reserve" };

// --- tiny inline icons (stroke = currentColor) ---------------------------
const I = {
  trophy: "M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3",
  podium: "M4 21V11h5v10M9 21V5h6v16M15 21V9h5v12",
  flagChk: "M5 21V4M5 4h14l-3 4 3 4H5",
  chart: "M4 19h16M7 15l3-4 3 3 4-6",
  hash: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
};
function Icon({ name, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={I[name]} />
    </svg>
  );
}

function Stat({ icon, label, value, sub, accent }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-light">
        <Icon name={icon} className="h-4 w-4" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 font-display text-3xl font-black leading-none tabular-nums text-dark"
        style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs font-medium text-light">{sub}</div>}
    </div>
  );
}

// Per-round points as vertical bars in the team colour. Dropped rounds (one of
// the 3 lowest, not counted) are faded + struck; the best-scoring round is
// ringed. Upcoming rounds show an empty stub.
function RoundBars({ raceNumbers, perRace, droppedRounds, raceByNumber, color }) {
  const dropped = new Set(droppedRounds || []);
  const scored = raceNumbers.map((n) => perRace?.[n] ?? 0);
  const maxPts = Math.max(1, ...scored);
  const bestRound = raceNumbers.reduce(
    (best, n) => ((perRace?.[n] ?? 0) > (perRace?.[best] ?? -1) ? n : best),
    raceNumbers[0]
  );

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[460px] items-end gap-2" style={{ height: 168 }}>
        {raceNumbers.map((n) => {
          const race = raceByNumber.get(n);
          const done = race?.isCompleted;
          const pts = perRace?.[n] ?? 0;
          const isDropped = dropped.has(n);
          const isBest = n === bestRound && pts > 0;
          const circ = race ? circuitFor(race.track) : null;
          const h = done ? Math.max(4, Math.round((pts / maxPts) * 120)) : 0;
          return (
            <div key={n} className="flex flex-1 flex-col items-center justify-end gap-1.5">
              <span className={`font-mono text-[11px] font-bold tabular-nums ${isDropped ? "text-faint line-through" : "text-dark"}`}>
                {done ? pts : ""}
              </span>
              <div className="flex w-full items-end justify-center" style={{ height: 120 }}>
                {done ? (
                  <div
                    className="w-full max-w-[26px] rounded-t-md transition-all"
                    style={{
                      height: `${h}px`,
                      backgroundColor: color,
                      opacity: isDropped ? 0.3 : 1,
                      outline: isBest ? "2px solid var(--c-text)" : undefined,
                      outlineOffset: isBest ? "1px" : undefined,
                    }}
                    title={`R${n} ${race?.track || ""} — ${pts} pts${isDropped ? " (dropped)" : ""}`}
                  />
                ) : (
                  <div
                    className="w-full max-w-[26px] rounded-t-md border border-dashed border-border"
                    style={{ height: 12 }}
                    title={`R${n} ${race?.track || ""} — upcoming`}
                  />
                )}
              </div>
              {circ ? (
                <Flag code={circ.country} title={circ.countryName} />
              ) : (
                <span className="h-3 w-4" />
              )}
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-light">R{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TeamProfile() {
  const { id } = useParams();
  const { data, loading, error } = useApi(
    useCallback(
      () => Promise.all([api.teams(), api.t1Standings(), api.t2Standings(), api.driverStandings(), api.races()]),
      []
    )
  );

  if (loading)
    return (
      <div className="space-y-8">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <PageHeaderSkeleton />
      </div>
    );
  if (error) return <ErrorBox message={error} />;

  const [teams, t1, t2, driverStandings, races] = data;
  const team = teams.find((t) => t.id === id);
  if (!team) return <ErrorBox message="Team not found." />;

  const color = team.color;
  const standingsSet = team.tier === 1 ? t1 : team.tier === 2 ? t2 : null;
  const teamRow = standingsSet?.standings.find((r) => r.teamId === id) || null;
  const raceNumbers = standingsSet?.raceNumbers || [];
  const raceByNumber = new Map(
    races.filter((r) => !r.isSpecialEvent && r.number != null).map((r) => [r.number, r])
  );

  // The team's drivers, with their championship standings (clickable).
  const drivers = driverStandings.standings
    .filter((d) => d.team.id === id)
    .sort((a, b) => a.position - b.position);

  // Combined wins / podiums across the team's drivers.
  let wins = 0, podiums = 0;
  for (const d of drivers) {
    for (const num of Object.keys(d.perRace || {})) {
      const c = d.perRace[num];
      if (c.status === "FINISHED" && c.position != null) {
        if (c.position === 1) wins++;
        if (c.position <= 3) podiums++;
      }
    }
  }

  const roundsScored = raceNumbers.filter((n) => (teamRow?.perRace?.[n] ?? 0) > 0).length;
  const bestRoundPts = raceNumbers.reduce((m, n) => Math.max(m, teamRow?.perRace?.[n] ?? 0), 0);
  const completedNumbers = raceNumbers.filter((n) => teamRow?.perRace?.[n] != null);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-ink text-white shadow-lg">
        <span className="absolute inset-x-0 top-0 z-10 h-1.5" style={{ backgroundColor: color }} />
        <div className="absolute inset-0" style={{ background: `radial-gradient(120% 140% at 88% 10%, ${color}55, transparent 55%)` }} />
        <div className="absolute inset-y-0 right-0 w-2/3" style={{ background: `repeating-linear-gradient(115deg, transparent 0 22px, ${color}14 22px 25px)` }} />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-transparent" />

        <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:gap-7 sm:p-8">
          <span className="flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-4 ring-white/10">
            <TeamLogo id={team.id} name={team.name} color={color} logoUrl={team.logoUrl} size={84} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-4xl font-black uppercase tracking-tight sm:text-6xl">{team.name}</h1>
              <TierBadge tier={team.tier} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-white/70">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider">
                {TIER_LABEL[team.tier] ?? "—"} Constructor
              </span>
              <span className="text-white/30">·</span>
              <span className="text-sm">{drivers.length} {drivers.length === 1 ? "driver" : "drivers"}</span>
            </div>
          </div>
          {teamRow && (
            <div className="flex gap-8 border-t border-white/10 pt-4 sm:flex-col sm:gap-3 sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0 sm:text-right">
              <div>
                <div className="font-display text-5xl font-black leading-none tabular-nums">P{teamRow.position}</div>
                <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white/50">of {standingsSet.standings.length}</div>
              </div>
              <div>
                <div className="font-display text-4xl font-black leading-none tabular-nums" style={{ color }}>{teamRow.total}</div>
                <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white/50">points</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stat tiles */}
      {teamRow && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat icon="hash" label="Championship" value={`P${teamRow.position}`} sub={`of ${standingsSet.standings.length} teams`} />
          <Stat icon="chart" label="Points" value={teamRow.total} sub={`${TIER_LABEL[team.tier]} table`} accent={color} />
          <Stat icon="trophy" label="Race Wins" value={wins} sub="by team drivers" accent={wins ? MEDAL[0] : undefined} />
          <Stat icon="podium" label="Podiums" value={podiums} sub="P1–P3 finishes" />
          <Stat icon="flagChk" label="Best Round" value={bestRoundPts || "–"} sub="points in one race" />
          <Stat icon="hash" label="Rounds Scored" value={roundsScored} sub={`of ${raceNumbers.length}`} />
        </div>
      )}

      {/* Line-up + per-round points */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Drivers */}
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-5 py-4">
            <Icon name="users" className="h-4 w-4 text-light" />
            <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Line-up</h2>
          </div>
          <div className="space-y-1 p-4">
            {drivers.length === 0 && <div className="px-2 py-3 text-sm text-light">No drivers assigned.</div>}
            {drivers.map((d) => (
              <Link key={d.driverId} to={`/drivers/${d.driverId}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-surface2">
                <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={color} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-display text-sm font-bold uppercase tracking-tight text-dark">{d.name}</span>
                    <Flag code={countryFor(d.driverId, d.country)} />
                  </div>
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">P{d.position} overall</span>
                </div>
                <span className="font-display text-lg font-black tabular-nums text-dark">{d.total}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Per-round points */}
        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex items-baseline gap-3 border-b border-border px-5 py-4 sm:px-6">
            <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Points by Round</h2>
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">team score each race</span>
          </div>
          <div className="p-5 sm:p-6">
            {teamRow && raceNumbers.length > 0 ? (
              <RoundBars
                raceNumbers={raceNumbers}
                perRace={teamRow.perRace}
                droppedRounds={teamRow.droppedRounds}
                raceByNumber={raceByNumber}
                color={color}
              />
            ) : (
              <div className="py-6 text-sm text-light">No scored rounds yet.</div>
            )}
            <p className="mt-4 border-t border-border pt-3 font-mono text-[11px] leading-relaxed text-light">
              <span className="text-faint line-through decoration-2">Faded</span> bars are dropped rounds — each
              team&rsquo;s 3 lowest don&rsquo;t count toward the total (best 9 of 12).
            </p>
          </div>
        </div>
      </div>

      {/* Cumulative progression (reuses the championship chart for this team) */}
      {teamRow && completedNumbers.length > 0 && (
        <div>
          <h2 className="mb-4 font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">
            Championship Progression
          </h2>
          <PointsChart standings={[teamRow]} completed={completedNumbers} allRounds={raceNumbers} />
        </div>
      )}

      <div>
        <Link to="/constructors" className="text-sm font-semibold text-primary hover:underline">← All constructors</Link>
      </div>
    </div>
  );
}
