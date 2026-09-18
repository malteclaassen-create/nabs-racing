import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useSeason } from "../context/SeasonContext.jsx";
import { seasonLabelOf } from "../utils/pageTitle.js";
import { useSeasonParam } from "../hooks/useSeasonParam.js";
import { DriverAvatar, EmptyState, ErrorBox, PageHeader, PageHeaderSkeleton, SectionHeading, TableSkeleton } from "../components/ui.jsx";
import SlidingTabs from "../components/SlidingTabs.jsx";
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

// ---------------------------------------------------------------------------
// The transfer centre: one row per move, newest round first, in the shape a
// football transfer page uses — From -> To, the player, and where a fee and a
// date would be, the tier of the seat and the round it happened in.
//
// Two kinds of row share the list, told apart by the icon between the clubs
// and by the filter: a TRANSFER (the driver's own seat changed) and a
// SUBSTITUTE drive (a reserve raced for a team that night and went back).
// ---------------------------------------------------------------------------
const TIER_LABEL = { 1: "T1", 2: "T2", 0: "RES" };

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
    </svg>
  );
}
function LoopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  );
}

function Club({ team, align = "left" }) {
  const mark = team ? <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={18} /> : null;
  const label = <span className="truncate text-xs font-semibold text-dark">{team?.name || "—"}</span>;
  const inner = align === "left" ? <>{mark}{label}</> : <>{label}{mark}</>;
  const cls = `flex min-w-0 flex-1 items-center gap-1.5 ${align === "right" ? "justify-end" : ""}`;
  return team ? (
    <Link to={`/teams/${team.id}`} className={`${cls} transition hover:text-brand`}>{inner}</Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

// Every row of the centre off the history payload: the recorded / detected
// moves, plus one row per substitute drive found in the grid.
function centreRows(data) {
  if (!data) return [];
  const rows = [];
  for (const m of data.moves || []) {
    rows.push({ key: `t-${m.driverId}-${m.round}`, kind: "transfer", driverId: m.driverId, fromTeamId: m.fromTeamId, toTeamId: m.toTeamId, round: m.round, pending: m.pending });
  }
  for (const d of data.drivers || []) {
    for (const [n, c] of Object.entries(d.cells || {})) {
      if (c.status !== "sub") continue;
      rows.push({ key: `s-${d.id}-${n}`, kind: "sub", driverId: d.id, fromTeamId: c.fromTeamId || null, toTeamId: c.teamId, round: Number(n), pending: false });
    }
  }
  return rows.sort((a, b) => b.round - a.round || a.kind.localeCompare(b.kind));
}

function TransferCentre({ data, teamById, driverById }) {
  const [kind, setKind] = useState("all"); // all | transfer | sub
  const all = useMemo(() => centreRows(data), [data]);
  const rows = kind === "all" ? all : all.filter((r) => r.kind === kind);
  const trackOf = (n) => data.rounds.find((r) => r.number === n)?.track || "";
  const counts = { transfer: all.filter((r) => r.kind === "transfer").length, sub: all.filter((r) => r.kind === "sub").length };

  return (
    <div className="space-y-3">
      <SlidingTabs
        items={[
          { key: "all", label: `All (${all.length})` },
          { key: "transfer", label: `Transfers (${counts.transfer})`, title: "A driver's own seat changed" },
          { key: "sub", label: `Substitutes (${counts.sub})`, title: "A reserve raced for a team that night" },
        ]}
        value={kind}
        onChange={setKind}
        btnClassName="px-3 py-1.5 text-xs"
      />
      {rows.length === 0 ? (
        <EmptyState title="Nothing here yet" hint={kind === "sub" ? "No reserve has filled in for a team this season." : "Nobody has changed team this season."} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,2fr)_4rem_7rem] gap-3 bg-surface2/60 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-light sm:grid">
            <span>From → To</span>
            <span>Driver</span>
            <span className="text-center">Tier</span>
            <span className="text-right">Round</span>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const d = driverById.get(r.driverId);
              const from = teamById.get(r.fromTeamId);
              const to = teamById.get(r.toTeamId);
              const tier = TIER_LABEL[to?.tier] || "—";
              return (
                <li
                  key={r.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] [grid-template-areas:'driver_tier_round'_'clubs_clubs_clubs'] gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_4rem_7rem] sm:[grid-template-areas:'clubs_driver_tier_round'] sm:items-center"
                >
                  {/* From -> To, the two clubs around the kind's icon */}
                  <div className="flex items-center gap-2 rounded-lg bg-surface2/60 px-2.5 py-1.5 [grid-area:clubs]">
                    <Club team={from} align="right" />
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${r.kind === "sub" ? "bg-card text-medium ring-1 ring-border" : "bg-brand text-onbrand"}`}
                      title={r.kind === "sub" ? "Substitute drive: raced for this team that night" : r.pending ? "Transfer, booked for a round still ahead" : "Transfer"}
                    >
                      {r.kind === "sub" ? <LoopIcon /> : <ArrowIcon />}
                    </span>
                    <Club team={to} />
                  </div>
                  {/* The driver */}
                  <Link to={`/drivers/${r.driverId}`} className="flex min-w-0 items-center gap-2.5 [grid-area:driver]">
                    <DriverAvatar name={d?.name} photoUrl={d?.photoUrl} color={to?.color} size={32} />
                    <span className="truncate font-display text-sm font-bold uppercase tracking-tight text-dark">{d?.name || r.driverId}</span>
                  </Link>
                  <span className="flex items-center justify-center [grid-area:tier]">
                    <span className={`pill ${to?.tier === 1 ? "bg-brand/15 text-brand" : to?.tier === 2 ? "bg-sky-500/15 text-sky-500" : "bg-surface2 text-light"}`}>{tier}</span>
                  </span>
                  <span className="text-right [grid-area:round]">
                    <span className="block font-mono text-xs font-bold text-dark">R{r.round}</span>
                    <span className="hidden truncate font-mono text-[10px] text-light sm:block">{r.pending ? "upcoming" : trackOf(r.round)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
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
        <SectionHeading eyebrow="Transfer centre" title="Team changes this season" />
        <TransferCentre data={data} teamById={teamById} driverById={driverById} />
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
