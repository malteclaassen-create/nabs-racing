import { useCallback } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, SectionHeading, TableSkeleton, Skeleton } from "../components/ui.jsx";
import StandingsTable from "../components/StandingsTable.jsx";
import PointsChart from "../components/PointsChart.jsx";

// Rounds that actually have scores recorded (for the progression chart).
function completedRounds(data) {
  return data.raceNumbers.filter((n) => data.standings.some((t) => t.perRace[n] != null));
}

export default function ConstructorStandings() {
  const t1 = useApi(useCallback(() => api.t1Standings(), []));
  const t2 = useApi(useCallback(() => api.t2Standings(), []));

  if (t1.loading || t2.loading)
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
  if (t1.error || t2.error) return <ErrorBox message={t1.error || t2.error} />;

  return (
    <div className="space-y-14">
      <PageHeader
        eyebrow="Championship"
        title="Constructor Standings"
        subtitle="Tier 1 uses real finishing points. Tier 2 re-ranks the field after Tier-1 drivers are removed."
      />

      <section className="reveal space-y-5" style={{ animationDelay: "0.05s" }}>
        <SectionHeading eyebrow="Tier 1" title="Constructors" />
        <StandingsTable variant="constructor" raceNumbers={t1.data.raceNumbers} rows={t1.data.standings} />
        <PointsChart standings={t1.data.standings} completed={completedRounds(t1.data)} />
      </section>

      <section className="reveal space-y-5" style={{ animationDelay: "0.13s" }}>
        <SectionHeading eyebrow="Tier 2" title="Constructors" />
        <StandingsTable variant="constructor" raceNumbers={t2.data.raceNumbers} rows={t2.data.standings} />
        <PointsChart standings={t2.data.standings} completed={completedRounds(t2.data)} />
      </section>
    </div>
  );
}
