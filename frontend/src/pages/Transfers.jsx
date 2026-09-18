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

function Club({ team, size = 18, className = "" }) {
  const mark = team ? <TeamLogo id={team.id} name={team.name} color={team.color} logoUrl={team.logoUrl} size={size} /> : null;
  const inner = (
    <>
      {mark}
      <span className="truncate font-display text-xs font-bold uppercase tracking-tight text-dark">{team?.name || "—"}</span>
    </>
  );
  const cls = `flex min-w-0 items-center gap-1.5 ${className}`;
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

// What the row means, in one sentence. The list is the league's news feed,
// and a news item says what happened rather than making the reader decode
// an icon.
function sentence(r, from, to, track) {
  const f = from?.name || "the reserves";
  const t = to?.name || "their new team";
  if (r.kind === "sub") return `Filled in for ${t} at ${track || `round ${r.round}`}, still a ${from?.tier === 0 ? "reserve" : `${f} driver`}.`;
  if (r.pending) return `Announced: leaves ${f} for ${t} from round ${r.round}.`;
  if (!from) return `Joined ${t} from round ${r.round}.`;
  if (to?.tier === 0) return `Left ${f} for the reserve pool from round ${r.round}.`;
  return `Left ${f} for ${t} from round ${r.round}.`;
}

function KindPill({ kind, pending }) {
  if (kind === "sub") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface2 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-medium ring-1 ring-border">
        <LoopIcon /> Substitute
      </span>
    );
  }
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand">
        <ArrowIcon /> Upcoming
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-onbrand">
      <ArrowIcon /> Transfer
    </span>
  );
}

function StatTile({ value, label, hint }) {
  return (
    <div className="card px-4 py-3" title={hint}>
      <div className="font-display text-2xl font-extrabold tabular-nums tracking-tight text-dark">{value}</div>
      <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{label}</div>
    </div>
  );
}

function TransferCentre({ data, teamById, driverById }) {
  const [kind, setKind] = useState("all"); // all | transfer | sub
  const [help, setHelp] = useState(false);
  const all = useMemo(() => centreRows(data), [data]);
  const rows = kind === "all" ? all : all.filter((r) => r.kind === kind);
  const roundOf = (n) => data.rounds.find((r) => r.number === n);
  const counts = {
    transfer: all.filter((r) => r.kind === "transfer" && !r.pending).length,
    upcoming: all.filter((r) => r.kind === "transfer" && r.pending).length,
    sub: all.filter((r) => r.kind === "sub").length,
    subDrivers: new Set(all.filter((r) => r.kind === "sub").map((r) => r.driverId)).size,
  };

  // Grouped by round, newest first, so the list reads as a timeline.
  const groups = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.round === r.round) last.rows.push(r);
    else groups.push({ round: r.round, rows: [r] });
  }

  return (
    <div className="space-y-5">
      {/* The season in four numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={counts.transfer} label="Transfers" hint="Drivers whose own seat changed in a round already driven" />
        <StatTile value={counts.upcoming} label="Announced" hint="Moves booked for a round still ahead" />
        <StatTile value={counts.sub} label="Substitute drives" hint="Nights a reserve raced for a team" />
        <StatTile value={counts.subDrivers} label="Reserves used" hint="How many different reserves filled in" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SlidingTabs
          items={[
            { key: "all", label: `All (${all.length})` },
            { key: "transfer", label: `Transfers (${counts.transfer + counts.upcoming})`, title: "A driver's own seat changed" },
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
          <div className="space-y-1.5">
            <KindPill kind="transfer" />
            <p className="text-medium">
              A driver's <span className="font-semibold text-dark">own seat changed</span>: from that round on they race for the new team, and the rounds since count for it in the constructors' table.
            </p>
          </div>
          <div className="space-y-1.5">
            <KindPill kind="sub" />
            <p className="text-medium">
              A <span className="font-semibold text-dark">one-night stand-in</span>: a reserve raced for a team that was short a driver. Their points go to that team for the night; their own seat does not change.
            </p>
          </div>
          <div className="space-y-1.5">
            <KindPill kind="transfer" pending />
            <p className="text-medium">
              <span className="font-semibold text-dark">Announced</span>, not driven yet: the move is booked and applies by itself when that round comes.
            </p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Nothing here yet" hint={kind === "sub" ? "No reserve has filled in for a team this season." : "Nobody has changed team this season."} />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const round = roundOf(g.round);
            const upcoming = round && !round.isCompleted;
            return (
              <section key={g.round} className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className={`font-display text-sm font-extrabold uppercase tracking-tight ${upcoming ? "text-brand" : "text-dark"}`}>
                    Round {g.round}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-light">
                    {round?.track || ""}{upcoming ? " · upcoming" : ""}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                  <span className="font-mono text-[10px] text-light">{g.rows.length}</span>
                </div>
                <ul className="cascade space-y-2">
                  {g.rows.map((r, i) => {
                    const d = driverById.get(r.driverId);
                    const from = teamById.get(r.fromTeamId);
                    const to = teamById.get(r.toTeamId);
                    const tier = TIER_LABEL[to?.tier] || "—";
                    return (
                      <li key={r.key} style={{ "--i": i }} className="card lift relative overflow-hidden">
                        {/* The destination team's colour down the edge */}
                        <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: to?.color || "var(--c-border)" }} aria-hidden="true" />
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 pl-4 pr-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,21rem)] sm:items-center sm:gap-x-4">
                          <Link to={`/drivers/${r.driverId}`} className="row-span-2 sm:row-span-1">
                            <DriverAvatar name={d?.name} photoUrl={d?.photoUrl} color={to?.color} size={40} />
                          </Link>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <Link to={`/drivers/${r.driverId}`} className="truncate font-display text-base font-extrabold uppercase tracking-tight text-dark transition hover:text-brand">
                                {d?.name || r.driverId}
                              </Link>
                              <KindPill kind={r.kind} pending={r.pending} />
                            </div>
                            <p className="mt-0.5 text-xs text-medium">{sentence(r, from, to, round?.track)}</p>
                          </div>
                          {/* From -> To */}
                          <div className="col-start-2 flex items-center gap-2 rounded-lg bg-surface2/60 px-2.5 py-1.5 sm:col-start-3">
                            <Club team={from} className="flex-1 justify-end text-right" />
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${r.kind === "sub" ? "bg-card text-medium ring-1 ring-border" : r.pending ? "border border-dashed border-brand text-brand" : "bg-brand text-onbrand"}`} aria-hidden="true">
                              {r.kind === "sub" ? <LoopIcon /> : <ArrowIcon />}
                            </span>
                            <Club team={to} className="flex-1" />
                            <span className={`pill shrink-0 ${to?.tier === 1 ? "bg-brand/15 text-brand" : to?.tier === 2 ? "bg-sky-500/15 text-sky-500" : "bg-surface2 text-light"}`} title={to?.tier === 0 ? "Reserve pool" : `Tier ${to?.tier} seat`}>
                              {tier}
                            </span>
                          </div>
                        </div>
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
