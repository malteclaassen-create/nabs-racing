import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { seasonLabelOf } from "../utils/pageTitle.js";
import { useSeasonParam } from "../hooks/useSeasonParam.js";
import { DriverAvatar, EmptyState, ErrorBox, PageHeader, PageHeaderSkeleton, SectionHeading, TableSkeleton } from "../components/ui.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import TeamHistoryGrid, { orderTeams, standingsMap } from "../components/TeamHistoryGrid.jsx";
import { useTransfersVisible } from "../hooks/useTransfersVisible.js";
import NotFound from "./NotFound.jsx";

// ---------------------------------------------------------------------------
// The public transfer market: who moved where this season, and every driver's
// team round by round. Read-only twin of the admin Transfers tab, off the
// same endpoint. Moves booked for rounds still ahead are shown as upcoming:
// once the league has entered one, it is announced.
// ---------------------------------------------------------------------------

function MoveCard({ move, driver, teamById }) {
  const from = teamById.get(move.fromTeamId);
  const to = teamById.get(move.toTeamId);
  return (
    <li className="card flex items-center gap-3 p-3">
      <Link to={`/drivers/${driver.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <DriverAvatar name={driver.name} photoUrl={driver.photoUrl} color={to?.color} size={40} />
        <span className="min-w-0">
          <span className="block truncate font-display text-base font-extrabold uppercase tracking-tight text-dark">{driver.name}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-medium">
            {from && (
              <>
                <TeamLogo id={from.id} name={from.name} color={from.color} logoUrl={from.logoUrl} size={16} />
                <span className="truncate">{from.name}</span>
                <span className="text-light">→</span>
              </>
            )}
            {to && <TeamLogo id={to.id} name={to.name} color={to.color} logoUrl={to.logoUrl} size={16} />}
            <span className="truncate font-semibold text-dark">{to?.name || move.toTeamId}</span>
          </span>
        </span>
      </Link>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-xs font-bold text-dark">from R{move.round}</span>
        {move.pending ? (
          <span className="pill bg-brand/15 text-brand">upcoming</span>
        ) : (
          <span className="pill bg-surface2 text-light">done</span>
        )}
      </span>
    </li>
  );
}

export default function Transfers() {
  const visible = useTransfersVisible();
  return visible ? <TransfersPage /> : <NotFound />;
}

function TransfersPage() {
  useSeasonParam();
  const { current: season } = useSeason();
  const { data, loading, error, reload } = useApi(useCallback(() => api.transferMarket(), []));
  // The championship order, so the grid can sort by points.
  const standings = useApi(useCallback(() => api.driverStandings(), []));
  const points = useMemo(() => standingsMap(standings.data), [standings.data]);
  const seasonName = seasonLabelOf(season);
  const heading = seasonName ? `${seasonName} Transfers` : "Transfers";

  const teamById = useMemo(() => new Map(orderTeams(data?.teams).map((t) => [t.id, t])), [data?.teams]);
  const driverById = useMemo(() => new Map((data?.drivers || []).map((d) => [d.id, d])), [data?.drivers]);
  // Newest first: the move everyone is talking about is the one ahead.
  const moves = useMemo(() => [...(data?.moves || [])].sort((a, b) => b.round - a.round), [data?.moves]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) {
    return (
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <TableSkeleton rows={10} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Transfer market"
        title={heading}
        subtitle="Who drives for whom, round by round — and the moves already announced for the rounds ahead."
      />

      <section className="reveal space-y-4">
        <SectionHeading eyebrow="Moves" title="Team changes this season" />
        {moves.length === 0 ? (
          <EmptyState title="No transfers yet" hint="Nobody has changed team this season. The line-ups below show who drives where." />
        ) : (
          <ul className="cascade grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {moves.map((m) => {
              const d = driverById.get(m.driverId);
              return d ? <MoveCard key={`${m.driverId}-${m.round}`} move={m} driver={d} teamById={teamById} /> : null;
            })}
          </ul>
        )}
      </section>

      <section className="reveal space-y-4">
        <SectionHeading eyebrow="Round by round" title="Driver team history" />
        <TeamHistoryGrid
          key={points ? "pts" : "plain"}
          data={data}
          standings={points}
          driverHref={(d) => `/drivers/${d.id}`}
          teamHref={(t) => `/teams/${t.id}`}
        />
      </section>
    </div>
  );
}
