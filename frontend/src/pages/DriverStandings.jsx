import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, PageHeader, PageHeaderSkeleton, TableSkeleton, Skeleton, TierBadge, Rank, MEDAL, DriverAvatar } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import { countryFor } from "../data/driverCountries.js";

function LeaderCard({ row, leaderTotal, rank }) {
  const gap = leaderTotal - row.total;
  return (
    <Link to={`/drivers/${row.driverId}`} className="card lift relative block overflow-hidden p-5">
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: row.team.color }} />
      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="flex items-center gap-3">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-xl font-display text-lg font-black text-ink"
            style={{ backgroundColor: MEDAL[rank] }}
          >
            {row.position}
          </span>
          <DriverAvatar name={row.name} photoUrl={row.photoUrl} color={row.team.color} size={40} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-extrabold uppercase tracking-tight text-dark">
                {row.name}
              </span>
              <Flag code={countryFor(row.driverId)} />
              <TierBadge tier={row.tier} />
            </div>
            <div className="text-sm text-light">{row.team.name}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl font-bold leading-none tabular-nums text-dark">{row.total}</div>
          <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
            {gap === 0 ? "Leader" : `−${gap} pts`}
          </div>
        </div>
      </div>
    </Link>
  );
}

function DriverRow({ d, leaderTotal }) {
  const isLeader = d.position === 1;
  const gap = leaderTotal - d.total;
  const pct = d.total > 0 && leaderTotal > 0 ? Math.max(4, (d.total / leaderTotal) * 100) : 0;
  return (
    <Link
      to={`/drivers/${d.driverId}`}
      className={`flex items-center gap-3 px-4 py-3 transition hover:bg-surface2 sm:gap-4 sm:px-5 ${
        isLeader ? "bg-brand/5" : ""
      }`}
    >
      <Rank position={d.position} />
      <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: d.team.color }} />
      <DriverAvatar name={d.name} photoUrl={d.photoUrl} color={d.team.color} size={36} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-base font-bold uppercase tracking-tight text-dark sm:text-lg">
            {d.name}
          </span>
          <Flag code={countryFor(d.driverId)} />
          <TierBadge tier={d.tier} />
          {!d.isActive && <span className="pill bg-surface2 text-light">inactive</span>}
        </div>
        <div className="truncate text-xs text-light sm:text-sm">{d.team.name}</div>
      </div>

      {/* points bar */}
      <div className="hidden w-28 shrink-0 md:block lg:w-40 xl:w-56">
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: d.team.color }} />
        </div>
      </div>

      <div className="w-14 shrink-0 text-right sm:w-20">
        <div className="font-mono text-lg font-bold tabular-nums text-dark sm:text-xl">{d.total}</div>
        <div className="font-mono text-[11px] tabular-nums text-light">
          {isLeader ? "leader" : `−${gap}`}
        </div>
      </div>
    </Link>
  );
}

export default function DriverStandings() {
  const { data, loading, error } = useApi(useCallback(() => api.driverStandings(), []));
  const [onlyScoring, setOnlyScoring] = useState(false);

  if (loading)
    return (
      <div>
        <PageHeaderSkeleton />
        <div className="mb-8 grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <TableSkeleton rows={12} />
      </div>
    );
  if (error) return <ErrorBox message={error} />;

  const all = data.standings;
  const leaderTotal = all[0]?.total ?? 0;
  const top3 = all.slice(0, 3);
  const withPoints = all.filter((r) => r.total > 0).length;

  const rows = onlyScoring ? all.filter((r) => r.total > 0) : all;

  return (
    <div>
      <PageHeader
        eyebrow="Championship"
        title="Driver Standings"
        subtitle="All drivers — Tier 1, Tier 2 and reserves — ranked by total points."
      />

      <div className="reveal mb-8 grid gap-4 md:grid-cols-3">
        {top3.map((row, i) => (
          <LeaderCard key={row.driverId} row={row} leaderTotal={leaderTotal} rank={i} />
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-6 text-sm">
          <span className="text-light">
            Drivers: <span className="font-mono font-bold tabular-nums text-dark">{all.length}</span>
          </span>
          <span className="text-light">
            Scored points: <span className="font-mono font-bold tabular-nums text-dark">{withPoints}</span>
          </span>
          <span className="text-light">
            Rounds: <span className="font-mono font-bold tabular-nums text-dark">{data.raceNumbers.length}</span>
          </span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-medium">
          <input
            type="checkbox"
            checked={onlyScoring}
            onChange={(e) => setOnlyScoring(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
          />
          Only drivers with points
        </label>
      </div>

      <div className="reveal card divide-y divide-border overflow-hidden">
        {rows.map((d) => (
          <DriverRow key={d.driverId} d={d} leaderTotal={leaderTotal} />
        ))}
      </div>
    </div>
  );
}
