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
import Flag from "../components/Flag.jsx";
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

// One half of the From -> To pill: the club mark and its name, the mark on
// the outside so the two halves mirror each other around the icon.
function Club({ team, side }) {
  const mark = team ? (
    <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={20} />
  ) : (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-card font-mono text-[10px] font-bold text-light ring-1 ring-border">?</span>
  );
  const name = <span className="truncate text-xs font-semibold text-dark">{team?.name || "Free agent"}</span>;
  const inner = side === "from" ? <>{mark}{name}</> : <>{name}{mark}</>;
  const cls = `flex min-w-0 flex-1 items-center gap-2 px-2.5 ${side === "to" ? "justify-end" : ""}`;
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
  // Newest round first; within a round the transfers before the fill-ins.
  return rows.sort((a, b) => b.round - a.round || a.kind.localeCompare(b.kind));
}

// Where a football page prints the fee: what kind of move this is.
function kindLabel(r) {
  if (r.kind === "sub") return "Substitute";
  if (r.pending) return "Announced";
  return "Transfer";
}

function KindMark({ kind, pending }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${
        kind === "sub" ? "bg-card text-medium ring-border" : pending ? "bg-card text-brand ring-brand" : "bg-brand text-onbrand ring-brand"
      }`}
      aria-hidden="true"
    >
      {kind === "sub" ? <LoopIcon /> : <ArrowIcon />}
    </span>
  );
}

function TransferCentre({ data, teamById, driverById }) {
  const [kind, setKind] = useState("all"); // all | transfer | sub
  const [help, setHelp] = useState(false);
  const all = useMemo(() => centreRows(data), [data]);
  const rows = kind === "all" ? all : all.filter((r) => r.kind === kind);
  const roundOf = (n) => data.rounds.find((r) => r.number === n);
  const trackOf = (n) => roundOf(n)?.track || "";
  const counts = { transfer: all.filter((r) => r.kind === "transfer").length, sub: all.filter((r) => r.kind === "sub").length };
  // One section per round, newest first, so the list reads by race night.
  const groups = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.round === r.round) last.rows.push(r);
    else groups.push({ round: r.round, rows: [r] });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
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
        <button
          type="button"
          onClick={() => setHelp((h) => !h)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-medium transition hover:border-brand/50 hover:text-dark"
          aria-expanded={help}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5" /><path d="M12 17h.01" />
          </svg>
          How to read this
        </button>
      </div>

      {help && (
        <div className="card grid gap-4 p-4 text-sm sm:grid-cols-3">
          <div className="flex gap-3">
            <KindMark kind="transfer" />
            <p className="text-medium">
              <span className="font-semibold text-dark">Transfer</span>: the driver's own seat changed. From that round on they race for the new team, and the rounds since count for it in the constructors' table.
            </p>
          </div>
          <div className="flex gap-3">
            <KindMark kind="sub" />
            <p className="text-medium">
              <span className="font-semibold text-dark">Substitute</span>: a reserve raced for a team that was short a driver. Their points go to that team for the night; their own seat does not change.
            </p>
          </div>
          <div className="flex gap-3">
            <KindMark kind="transfer" pending />
            <p className="text-medium">
              <span className="font-semibold text-dark">Announced</span>: booked for a round still ahead. It applies by itself when that round comes.
            </p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Nothing here yet" hint={kind === "sub" ? "No reserve has filled in for a team this season." : "Nobody has changed team this season."} />
      ) : (
        <div className="card overflow-hidden">
          {/* Column heads, as a transfer page prints them */}
          <div className="hidden grid-cols-[minmax(0,21rem)_minmax(0,1fr)_8rem_9rem] gap-4 px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-light sm:grid">
            <div className="grid grid-cols-[1fr_1.75rem_1fr] gap-2"><span className="pl-2.5">From</span><span /><span className="pl-2.5">To</span></div>
            <span>Player</span>
            <span>Type</span>
            <span className="text-right">Round</span>
          </div>
          {groups.map((g) => {
            const round = roundOf(g.round);
            const upcoming = round && !round.isCompleted;
            return (
          <section key={g.round}>
            {/* The round's own strip: number, track, flag, how many moves */}
            <div className={`flex items-center gap-2.5 border-y border-border px-4 py-2 ${upcoming ? "bg-brand/5" : "bg-surface2/60"}`}>
              <span className={`font-display text-sm font-extrabold uppercase tracking-tight ${upcoming ? "text-brand" : "text-dark"}`}>
                Round {g.round}
              </span>
              {round?.country && <Flag code={round.country} />}
              <span className="font-mono text-[11px] uppercase tracking-wider text-light">
                {round?.track || ""}{upcoming ? " · upcoming" : ""}
              </span>
              <span className="ml-auto font-mono text-[10px] text-light">{g.rows.length} {g.rows.length === 1 ? "move" : "moves"}</span>
            </div>
          <ul className="divide-y divide-border">
            {g.rows.map((r) => {
              const d = driverById.get(r.driverId);
              const from = teamById.get(r.fromTeamId);
              const to = teamById.get(r.toTeamId);
              const tier = TIER_LABEL[to?.tier] || "—";
              return (
                <li
                  key={r.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2.5 px-4 py-3 transition hover:bg-surface2/40 sm:grid-cols-[minmax(0,21rem)_minmax(0,1fr)_8rem_9rem] sm:items-center sm:gap-4"
                >
                  {/* Player: the avatar wears the tier of the seat, where a
                      football page puts the position */}
                  <Link to={`/drivers/${r.driverId}`} className="order-1 flex min-w-0 items-center gap-3 sm:order-2">
                    <span className="relative shrink-0">
                      <DriverAvatar name={d?.name} photoUrl={d?.photoUrl} color={to?.color} size={40} />
                      <span
                        className={`absolute -bottom-1 -right-1 rounded-full px-1.5 font-mono text-[9px] font-bold leading-4 ring-2 ring-card ${
                          to?.tier === 1 ? "bg-brand text-onbrand" : to?.tier === 2 ? "bg-sky-500 text-white" : "bg-surface2 text-medium"
                        }`}
                        title={to?.tier === 0 ? "Reserve pool" : `Tier ${to?.tier} seat`}
                      >
                        {tier}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-display text-base font-extrabold uppercase tracking-tight text-dark transition hover:text-brand">
                        {d?.name || r.driverId}
                      </span>
                      {/* On a phone the type sits under the name; on a desk it has a column */}
                      <span className={`block text-[11px] font-semibold sm:hidden ${r.pending ? "text-brand" : "text-medium"}`}>{kindLabel(r)}</span>
                    </span>
                  </Link>
                  {/* Round, where a football page prints the date */}
                  <span className="order-1 text-right sm:order-4">
                    <span className="block font-mono text-sm font-bold text-dark">R{r.round}</span>
                    <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-light">{r.pending ? "upcoming" : trackOf(r.round)}</span>
                  </span>
                  {/* From -> To pill */}
                  <div className="order-2 col-span-2 flex h-11 items-center rounded-xl bg-surface2 sm:order-1 sm:col-span-1">
                    <Club team={from} side="from" />
                    <KindMark kind={r.kind} pending={r.pending} />
                    <Club team={to} side="to" />
                  </div>
                  {/* Type, where a football page prints the fee */}
                  <span className={`order-3 hidden text-sm font-semibold sm:block ${r.pending ? "text-brand" : "text-medium"}`}>
                    {kindLabel(r)}
                  </span>
                </li>
              );
            })}
          </ul>
          </section>
            );
          })}
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
