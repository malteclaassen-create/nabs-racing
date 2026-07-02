import { useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, SectionHeading, TableSkeleton, Skeleton } from "../components/ui.jsx";
import { useTilt } from "../hooks/motion.js";
import StandingsTable from "../components/StandingsTable.jsx";
import PointsChart from "../components/PointsChart.jsx";
import TeamLogo from "../components/TeamLogo.jsx";

// Rounds that actually have scores recorded (for the progression chart).
function completedRounds(data) {
  return data.raceNumbers.filter((n) => data.standings.some((t) => t.perRace[n] != null));
}

// One tier shown as a unit: championship table, progression chart and the
// line-ups of every team in that tier.
function TierBlock({ id, tier, standings, teams, delay }) {
  const rows = standings.standings;
  const done = completedRounds(standings);
  const lastRound = done[done.length - 1];

  return (
    <section id={id} className="reveal scroll-mt-28 space-y-6" style={{ animationDelay: delay }}>
      <SectionHeading
        eyebrow="Constructors' Championship"
        title={`Tier ${tier}`}
        right={
          lastRound != null && (
            <span className="hidden shrink-0 font-mono text-xs font-bold uppercase tracking-wider text-light sm:block">
              After R{lastRound} of {standings.raceNumbers.length}
            </span>
          )
        }
      />

      <StandingsTable variant="constructor" raceNumbers={standings.raceNumbers} rows={rows} />
      <PointsChart standings={rows} completed={done} allRounds={standings.raceNumbers} />

      <div className="space-y-3 pt-2">
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-light">Line-ups</h3>
        <div className="cascade grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {teams.map((team, i) => (
            <TeamCard key={team.id} team={team} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TeamCard({ team, index = 0 }) {
  const tiltRef = useTilt({ max: 5, lift: 5 });
  return (
    <div ref={tiltRef} className="card shine tilt group overflow-hidden hover:shadow-xl" style={{ "--i": index }}>
      <div className="h-1.5 w-full" style={{ backgroundColor: team.color }} />
      <div className="p-5">
        <Link to={`/teams/${team.id}`} className="flex items-center gap-3">
          <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={36} />
          <h4 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark transition group-hover:text-brand">
            {team.name}
          </h4>
        </Link>
        <ul className="mt-4 space-y-1">
          {team.drivers.map((d) => (
            <li key={d.id}>
              <Link
                to={`/drivers/${d.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition hover:bg-surface2"
              >
                <span className="font-display font-bold uppercase tracking-tight text-dark">{d.name}</span>
                <span className="truncate text-light">{d.discordName}</span>
              </Link>
            </li>
          ))}
          {team.drivers.length === 0 && <li className="px-2 text-sm text-light">No drivers assigned.</li>}
        </ul>
      </div>
    </div>
  );
}

// Quick anchor pills in the page header so Tier 2 is one tap away instead of a
// long scroll past the whole Tier-1 block.
function TierJump({ className = "" }) {
  const cls =
    "rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-medium transition hover:border-brand/50 hover:text-dark";
  return (
    <div className={`gap-2 ${className}`}>
      <a href="#tier-1" className={cls}>
        Tier 1
      </a>
      <a href="#tier-2" className={cls}>
        Tier 2
      </a>
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
      <div>
        {/* pills sit beside the title on desktop, on their own row on phones —
            side by side they push the header past the viewport */}
        <PageHeader eyebrow="Championship" title="Constructors" right={<TierJump className="hidden shrink-0 sm:flex" />} />
        <TierJump className="-mt-2 flex sm:hidden" />
      </div>

      <TierBlock id="tier-1" tier={1} standings={t1.data} teams={t1Teams} delay="0.05s" />
      <TierBlock id="tier-2" tier={2} standings={t2.data} teams={t2Teams} delay="0.13s" />
    </div>
  );
}
