import { useCallback } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, SectionHeading, TableSkeleton, Skeleton } from "../components/ui.jsx";
import StandingsTable from "../components/StandingsTable.jsx";
import PointsChart from "../components/PointsChart.jsx";
import TeamLogo from "../components/TeamLogo.jsx";

// Rounds that actually have scores recorded (for the progression chart).
function completedRounds(data) {
  return data.raceNumbers.filter((n) => data.standings.some((t) => t.perRace[n] != null));
}

// One tier shown as a unit: championship table + progression chart + the
// line-ups of every team in that tier.
function TierBlock({ eyebrow, standings, teams, delay }) {
  return (
    <section className="reveal space-y-6" style={{ animationDelay: delay }}>
      <SectionHeading eyebrow={eyebrow} title="Constructors" />
      <StandingsTable variant="constructor" raceNumbers={standings.raceNumbers} rows={standings.standings} />
      <PointsChart standings={standings.standings} completed={completedRounds(standings)} />

      <div className="space-y-3 pt-2">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-light">Line-ups</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TeamCard({ team }) {
  return (
    <div className="card lift overflow-hidden">
      <div className="h-1.5 w-full" style={{ backgroundColor: team.color }} />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={36} />
          <h4 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">{team.name}</h4>
        </div>
        <ul className="mt-4 space-y-2.5">
          {team.drivers.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-display font-bold uppercase tracking-tight text-dark">{d.name}</span>
              <span className="truncate text-light">{d.discordName}</span>
            </li>
          ))}
          {team.drivers.length === 0 && <li className="text-sm text-light">No drivers assigned.</li>}
        </ul>
      </div>
    </div>
  );
}

export default function Constructors() {
  const t1 = useApi(useCallback(() => api.t1Standings(), []));
  const t2 = useApi(useCallback(() => api.t2Standings(), []));
  const teams = useApi(useCallback(() => api.teams(), []));

  if (t1.loading || t2.loading || teams.loading)
    return (
      <div className="space-y-14">
        <PageHeaderSkeleton />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-5">
            <Skeleton className="h-7 w-48" />
            <TableSkeleton rows={6} />
          </div>
        ))}
      </div>
    );
  if (t1.error || t2.error || teams.error) return <ErrorBox message={t1.error || t2.error || teams.error} />;

  const t1Teams = teams.data.filter((t) => t.tier === 1);
  const t2Teams = teams.data.filter((t) => t.tier === 2);

  return (
    <div className="space-y-16">
      <PageHeader
        eyebrow="Championship"
        title="Constructors"
        subtitle="Standings and line-ups. Tier 1 uses real finishing points; Tier 2 re-ranks the field after Tier-1 drivers are removed."
      />

      <TierBlock eyebrow="Tier 1" standings={t1.data} teams={t1Teams} delay="0.05s" />
      <TierBlock eyebrow="Tier 2" standings={t2.data} teams={t2Teams} delay="0.13s" />
    </div>
  );
}
