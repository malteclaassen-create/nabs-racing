import { useCallback, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import {
  ErrorBox, PageHeaderSkeleton, Skeleton, TierBadge, StatusPill, DriverAvatar, MEDAL, CountUp,
} from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";
import { circuitFor } from "../data/circuits.js";

const TIER_LABEL = { 1: "Tier 1", 2: "Tier 2", 0: "Reserve" };

// --- tiny inline icons (stroke = currentColor) ---------------------------
const I = {
  trophy: "M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4zM7 5H4v2a3 3 0 003 3M17 5h3v2a3 3 0 01-3 3",
  podium: "M4 21V11h5v10M9 21V5h6v16M15 21V9h5v12",
  flagChk: "M5 21V4M5 4h14l-3 4 3 4H5",
  chart: "M4 19h16M7 15l3-4 3 3 4-6",
  flag: "M5 21V4M5 4c3-1.5 6 1.5 9 0s4-1 4-1v9s-1 .5-4 1-6-1.5-9 0",
  trend: "M3 17l6-6 4 4 7-7M14 8h6v6",
};
function Icon({ name, className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={I[name]} />
    </svg>
  );
}

// Career stats derived from a standings row — keeps focal driver and any
// head-to-head opponent measured the same way.
function statsFromRow(row) {
  const fin = Object.values(row.perRace).filter((r) => r.status === "FINISHED" && r.position != null);
  const pos = fin.map((r) => r.position);
  return {
    points: row.total,
    wins: fin.filter((r) => r.position === 1).length,
    podiums: fin.filter((r) => r.position <= 3).length,
    bestFinish: pos.length ? Math.min(...pos) : null,
    avgFinish: pos.length ? Math.round((pos.reduce((a, b) => a + b, 0) / pos.length) * 10) / 10 : null,
  };
}

function Stat({ icon, label, value, sub, accent, index = 0 }) {
  return (
    <div className="card shine p-4" style={{ "--i": index }}>
      <div className="flex items-center gap-2 text-light">
        <Icon name={icon} className="h-4 w-4" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 font-display text-3xl font-black leading-none tabular-nums text-dark"
        style={accent ? { color: accent } : undefined}>
        {typeof value === "number" ? <CountUp end={value} /> : value}
      </div>
      {sub && <div className="mt-1.5 text-xs font-medium text-light">{sub}</div>}
    </div>
  );
}

// Season-form chart: finishing position per round (P1 at the top), with a
// y-axis (positions), an x-axis of rounds, the best/worst finishes ringed, and
// the per-round result chips sitting directly under each round. The line only
// connects rounds the driver actually finished — rounds they sat out (or
// retired from) leave a gap and the line simply carries on to the next finish.
function FormChart({ perRace, color }) {
  const N = perRace.length;
  if (!N) return <div className="text-sm text-light">No races yet.</div>;

  const finishes = perRace
    .map((r, i) => (r.status === "FINISHED" && r.position != null ? { i, p: r.position } : null))
    .filter(Boolean);
  const positions = finishes.map((f) => f.p);
  const best = positions.length ? Math.min(...positions) : null;
  const worst = positions.length ? Math.max(...positions) : null;
  const maxPos = Math.max(3, worst || 3);

  // Map a finishing position to a vertical %, inset into a band so P1 and the
  // worst position aren't flush against the chart edges.
  const yPct = (p) => 8 + (maxPos > 1 ? (p - 1) / (maxPos - 1) : 0) * 84;

  const step = maxPos <= 6 ? 1 : maxPos <= 12 ? 2 : 5;
  const ticks = [];
  for (let p = 1; p <= maxPos; p += step) ticks.push(p);
  if (ticks[ticks.length - 1] !== maxPos) ticks.push(maxPos);

  // The line passes through finished rounds only (skips DNS/DNF -> the gap).
  const linePts = finishes.map((f) => ({ x: f.i + 0.5, y: yPct(f.p) }));
  const d = linePts.map((pt, k) => `${k ? "L" : "M"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ");

  const CHART_H = 184;

  return (
    <div className="flex items-start gap-2">
      {/* y-axis: finishing positions */}
      <div className="relative w-7 shrink-0" style={{ height: CHART_H }}>
        {ticks.map((p) => (
          <span
            key={p}
            className="absolute right-0 -translate-y-1/2 font-mono text-[10px] font-bold tabular-nums text-faint"
            style={{ top: `${yPct(p)}%` }}
          >
            P{p}
          </span>
        ))}
      </div>

      {/* plot + chips share one horizontally-scrollable column model so the
          chips line up exactly under their round on the line */}
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div style={{ minWidth: Math.max(360, N * 46) }}>
          {/* plot */}
          <div className="relative" style={{ height: CHART_H }}>
            {/* gridlines */}
            {ticks.map((p) => (
              <span
                key={p}
                className="absolute inset-x-0 border-t border-dashed border-border"
                style={{ top: `${yPct(p)}%` }}
              />
            ))}
            {/* connecting line (stretched to fill; stroke kept crisp) */}
            <svg
              viewBox={`0 0 ${N} 100`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
              aria-hidden="true"
            >
              {finishes.length > 1 && (
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
            </svg>
            {/* dots — finished rounds only; best ringed green, worst ringed red */}
            <div className="absolute inset-0 flex">
              {perRace.map((r, i) => {
                const finished = r.status === "FINISHED" && r.position != null;
                if (!finished) return <div key={i} className="flex-1" />;
                const medal = r.position <= 3 ? MEDAL[r.position - 1] : null;
                const isBest = r.position === best;
                const isWorst = r.position === worst && worst !== best;
                const top = `${yPct(r.position)}%`;
                return (
                  <div key={i} className="relative flex-1">
                    {(isBest || isWorst) && (
                      <span
                        className="absolute h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{ left: "50%", top, boxShadow: `0 0 0 2px ${isBest ? "#16a34a" : "#dc2626"}` }}
                      />
                    )}
                    <span
                      className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                      style={{ left: "50%", top, backgroundColor: medal || color }}
                      title={`R${r.number} ${r.track} — P${r.position}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* per-round result chips (moved here from above), aligned to columns */}
          <div className="mt-3 flex">
            {perRace.map((r) => {
              const finished = r.status === "FINISHED" && r.position != null;
              const medal = finished && r.position <= 3 ? MEDAL[r.position - 1] : null;
              const isBest = finished && r.position === best;
              const isWorst = finished && r.position === worst && worst !== best;
              const ring = isBest
                ? "ring-2 ring-emerald-500"
                : isWorst
                ? "ring-2 ring-red-500"
                : medal
                ? ""
                : "ring-1 ring-border";
              return (
                <div
                  key={r.number}
                  className="flex flex-1 flex-col items-center gap-1.5"
                  title={`R${r.number} ${r.track} — ${finished ? "P" + r.position : r.status}`}
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-lg font-display font-black tabular-nums ${
                      finished ? "text-sm" : "text-[10px] tracking-tight"
                    } ${
                      medal ? "text-ink" : finished ? "bg-surface2 text-dark" : "bg-surface2 text-light"
                    } ${ring}`}
                    style={medal ? { backgroundColor: medal } : undefined}
                  >
                    {finished ? r.position : r.status}
                  </span>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-light">
                    R{r.number}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeadToHead({ me, meRow, standings }) {
  const others = useMemo(
    () => standings.filter((s) => s.driverId !== me.driver.id).sort((a, b) => a.position - b.position),
    [standings, me.driver.id]
  );
  const defaultOpp = useMemo(() => {
    const mate = others.find((o) => o.team.id === me.driver.team.id);
    if (mate) return mate.driverId;
    return others.sort((a, b) => Math.abs(a.position - meRow.position) - Math.abs(b.position - meRow.position))[0]?.driverId;
  }, [others, meRow, me.driver]);

  const [oppId, setOppId] = useState(defaultOpp);
  const opp = standings.find((s) => s.driverId === oppId) || others[0];
  if (!opp) return null;

  const meStats = statsFromRow(meRow);
  const oppStats = statsFromRow(opp);
  let meAhead = 0, oppAhead = 0, shared = 0;
  for (const num of Object.keys(meRow.perRace)) {
    const a = meRow.perRace[num], b = opp.perRace[num];
    if (!a || !b || a.status !== "FINISHED" || b.status !== "FINISHED" || a.position == null || b.position == null) continue;
    shared++;
    if (a.position < b.position) meAhead++;
    else if (b.position < a.position) oppAhead++;
  }
  const decided = meAhead + oppAhead;
  const mePct = decided ? Math.round((meAhead / decided) * 100) : 50;
  const oppPct = 100 - mePct;
  const meColor = me.driver.team.color;
  const oppColor = opp.team.color;

  const rows = [
    { label: "Points", a: meStats.points, b: oppStats.points, aWin: meStats.points > oppStats.points },
    { label: "Wins", a: meStats.wins, b: oppStats.wins, aWin: meStats.wins > oppStats.wins },
    { label: "Podiums", a: meStats.podiums, b: oppStats.podiums, aWin: meStats.podiums > oppStats.podiums },
    { label: "Best finish", a: meStats.bestFinish ? `P${meStats.bestFinish}` : "–", b: oppStats.bestFinish ? `P${oppStats.bestFinish}` : "–", aWin: (meStats.bestFinish ?? 99) < (oppStats.bestFinish ?? 99) },
    { label: "Avg finish", a: meStats.avgFinish ?? "–", b: oppStats.avgFinish ?? "–", aWin: (meStats.avgFinish ?? 99) < (oppStats.avgFinish ?? 99) },
  ];

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Head to Head</h2>
        <select value={opp.driverId} onChange={(e) => setOppId(e.target.value)}
          className="max-w-[11rem] rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-sm font-bold text-dark focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
          {others.map((o) => <option key={o.driverId} value={o.driverId}>P{o.position} · {o.name}</option>)}
        </select>
      </div>

      <div className="p-5">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <DriverAvatar name={me.driver.name} photoUrl={me.driver.photoUrl} color={meColor} size={60} />
            <div className="truncate font-display text-base font-extrabold uppercase tracking-tight text-dark">{me.driver.name}</div>
            <TeamLogo id={me.driver.team.id} name={me.driver.team.name} color={me.driver.team.color} logoUrl={me.driver.team.logoUrl} size={16} showName className="justify-center" nameClassName="truncate text-[11px] text-light" />
          </div>
          <span className="shrink-0 font-display text-xl font-black text-faint">VS</span>
          <Link to={`/drivers/${opp.driverId}`} className="group flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <DriverAvatar name={opp.name} photoUrl={opp.photoUrl} color={oppColor} size={60} />
            <div className="truncate font-display text-base font-extrabold uppercase tracking-tight text-dark group-hover:text-primary">{opp.name}</div>
            <TeamLogo id={opp.team.id} name={opp.team.name} color={opp.team.color} logoUrl={opp.team.logoUrl} size={16} showName className="justify-center" nameClassName="truncate text-[11px] text-light" />
          </Link>
        </div>

        {/* race-wins bar */}
        <div className="mb-1.5 flex h-7 overflow-hidden rounded-lg text-xs font-black text-white">
          <div className="flex items-center justify-start px-2.5 tabular-nums" style={{ width: `${mePct}%`, backgroundColor: meColor }}>{mePct}%</div>
          <div className="flex flex-1 items-center justify-end px-2.5 tabular-nums" style={{ backgroundColor: oppColor }}>{oppPct}%</div>
        </div>
        <div className="mb-5 grid grid-cols-3 items-center text-center">
          <span className="font-display text-xl font-black tabular-nums" style={{ color: meColor }}>{meAhead}</span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-light">{shared} shared races</span>
          <span className="font-display text-xl font-black tabular-nums" style={{ color: oppColor }}>{oppAhead}</span>
        </div>

        <div className="divide-y divide-border rounded-xl bg-surface2/60">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2">
              <span className="text-left font-display text-base font-black tabular-nums" style={{ color: r.aWin ? meColor : "var(--c-text3)" }}>{r.a}</span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-medium">{r.label}</span>
              <span className="text-right font-display text-base font-black tabular-nums" style={{ color: !r.aWin ? oppColor : "var(--c-text3)" }}>{r.b}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TeamPanel({ driver, standings }) {
  const mates = standings
    .filter((s) => s.team.id === driver.team.id && s.driverId !== driver.id)
    .sort((a, b) => a.position - b.position);
  const c = driver.team.color;
  return (
    <div className="card overflow-hidden">
      <h2 className="border-b border-border px-5 py-4 font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Team</h2>
      <div className="relative overflow-hidden p-5">
        <div className="absolute inset-0 opacity-[0.1]" style={{ background: `radial-gradient(circle at 85% 0%, ${c}, transparent 60%)` }} />
        <div className="relative flex items-center gap-3">
          <TeamLogo id={driver.team.id} name={driver.team.name} color={c} logoUrl={driver.team.logoUrl} size={48} />
          <div>
            <Link to={`/teams/${driver.team.id}`} className="font-display text-2xl font-black uppercase tracking-tight text-dark transition hover:text-brand">
              {driver.team.name}
            </Link>
            <div className="mt-0.5 flex items-center gap-2">
              <TierBadge tier={driver.tier} />
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-light">{TIER_LABEL[driver.team.tier] ?? "—"}</span>
            </div>
          </div>
        </div>

        <div className="relative mt-5">
          <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-light">Teammates</div>
          {mates.length === 0 && <div className="text-sm text-light">No teammates this season.</div>}
          <div className="space-y-1.5">
            {mates.map((m) => (
              <Link key={m.driverId} to={`/drivers/${m.driverId}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-surface2">
                <DriverAvatar name={m.name} photoUrl={m.photoUrl} color={m.team.color} size={34} />
                <span className="flex-1 font-display text-sm font-bold uppercase tracking-tight text-dark">{m.name}</span>
                <span className="font-mono text-xs font-semibold tabular-nums text-light">P{m.position}</span>
                <span className="font-display text-sm font-black tabular-nums text-dark">{m.total}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DriverProfile() {
  const { id } = useParams();
  const { data, loading, error } = useApi(
    useCallback(() => Promise.all([api.driverProfile(id), api.driverStandings()]), [id])
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

  const [p, standingsData] = data;
  const { driver, championship, stats, perRace } = p;
  const color = driver.team.color;
  const meRow = standingsData.standings.find((s) => s.driverId === driver.id);
  // Rounds dropped from this driver's total (3 lowest don't count).
  const droppedRounds = new Set(meRow?.droppedRounds || []);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-ink text-white shadow-lg">
        <span className="absolute inset-x-0 top-0 z-10 h-1.5" style={{ backgroundColor: color }} />
        {/* layered "speed" backdrop */}
        <div className="absolute inset-0" style={{ background: `radial-gradient(120% 140% at 88% 10%, ${color}55, transparent 55%)` }} />
        <div className="absolute inset-y-0 right-0 w-2/3" style={{ background: `repeating-linear-gradient(115deg, transparent 0 22px, ${color}14 22px 25px)` }} />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-transparent" />

        <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:gap-7 sm:p-8">
          <DriverAvatar name={driver.name} photoUrl={driver.photoUrl} color={color} size={112} className="text-4xl ring-4 ring-white/10" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-4xl font-black uppercase tracking-tight sm:text-6xl">{driver.name}</h1>
              <Flag code={countryFor(driver.id, driver.country)} w={30} h={22} />
              <TierBadge tier={driver.tier} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-white/70">
              <Link to={`/teams/${driver.team.id}`} className="group flex items-center gap-2">
                <TeamLogo id={driver.team.id} name={driver.team.name} color={color} logoUrl={driver.team.logoUrl} size={22} />
                <span className="font-display text-base font-bold uppercase tracking-tight text-white/90 transition group-hover:text-white">{driver.team.name}</span>
              </Link>
              <span className="text-white/30">·</span>
              <span className="text-sm">{driver.discordName}</span>
            </div>
          </div>
          <div className="flex gap-8 border-t border-white/10 pt-4 sm:flex-col sm:gap-3 sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0 sm:text-right">
            <div>
              <div className="font-display text-5xl font-black leading-none tabular-nums">
                <CountUp end={championship.position} prefix="P" />
              </div>
              <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white/50">of {championship.fieldSize}</div>
            </div>
            <div>
              <div className="font-display text-4xl font-black leading-none tabular-nums" style={{ color }}>
                <CountUp end={championship.points} />
              </div>
              <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white/50">points</div>
            </div>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="cascade grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat index={0} icon="trophy" label="Wins" value={stats.wins} sub={`${stats.winRate}% of starts`} accent={stats.wins ? MEDAL[0] : undefined} />
        <Stat index={1} icon="podium" label="Podiums" value={stats.podiums} sub={`${stats.podiumRate}% of starts`} />
        <Stat index={2} icon="flagChk" label="Best Finish" value={stats.bestFinish ? `P${stats.bestFinish}` : "–"} sub={`${stats.starts} starts`} />
        <Stat index={3} icon="chart" label="Avg Finish" value={stats.avgFinish != null ? `P${stats.avgFinish}` : "–"} sub={`${stats.pointsFinishes} in the points`} />
        <Stat index={4} icon="flag" label="Poles" value={stats.polePositions} sub={`best grid P${stats.bestGrid ?? "–"}`} />
        <Stat index={5} icon="trend" label="Places Gained"
          value={stats.positionsGained > 0 ? `+${stats.positionsGained}` : stats.positionsGained}
          sub="start → finish"
          accent={stats.positionsGained > 0 ? "#16a34a" : stats.positionsGained < 0 ? "#dc2626" : undefined} />
      </div>

      {/* Season form + Head to head */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-5 py-4 sm:px-6">
            <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Season Form</h2>
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">finishing position by round</span>
            {stats.bestFinish != null && (
              <span className="ml-auto flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-wider">
                <span className="flex items-center gap-1.5 text-emerald-600">
                  <span className="h-2 w-2 rounded-full ring-2 ring-emerald-500" /> Best P{stats.bestFinish}
                </span>
                {stats.worstFinish != null && stats.worstFinish !== stats.bestFinish && (
                  <span className="flex items-center gap-1.5 text-red-500">
                    <span className="h-2 w-2 rounded-full ring-2 ring-red-500" /> Worst P{stats.worstFinish}
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="p-5 sm:p-6">
            <FormChart perRace={perRace} color={color} />
          </div>
        </div>

        <HeadToHead me={p} meRow={meRow} standings={standingsData.standings} />
      </div>

      {/* Race by race + Team */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <h2 className="border-b border-border px-5 py-4 font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:px-6 sm:text-xl">Race by Race</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-light">
                  <th className="px-5 py-2.5">Rnd</th>
                  <th className="px-2 py-2.5">Circuit</th>
                  <th className="px-2 py-2.5 text-center">Grid</th>
                  <th className="px-2 py-2.5 text-center">Race</th>
                  <th className="px-2 py-2.5 text-right">Pts</th>
                  <th className="px-5 py-2.5 text-right">+/−</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {perRace.map((r) => {
                  const finished = r.status === "FINISHED" && r.position != null;
                  const medal = finished && r.position <= 3 ? MEDAL[r.position - 1] : null;
                  const delta = finished && r.grid != null ? r.grid - r.position : null;
                  const dropped = droppedRounds.has(r.number);
                  return (
                    <tr
                      key={r.number}
                      title={dropped ? "Dropped — one of the 3 lowest rounds, not counted toward the total" : undefined}
                      className="transition hover:bg-surface2"
                    >
                      <td className="px-5 py-3 font-mono font-bold tabular-nums text-light">{r.number}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2.5">
                          <Flag code={circuitFor(r.track)?.country} w={22} h={16} />
                          <span className="font-display font-bold uppercase tracking-tight text-dark">{r.track}</span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center font-mono tabular-nums text-medium">{r.grid ? `P${r.grid}` : "–"}</td>
                      <td className="px-2 py-3 text-center">
                        {finished ? (
                          <span className={`inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md px-1.5 font-display text-sm font-black tabular-nums ${
                            medal ? "text-ink" : "bg-surface2 text-dark ring-1 ring-border"}`}
                            style={medal ? { backgroundColor: medal } : undefined}>
                            P{r.position}
                          </span>
                        ) : <StatusPill status={r.status} />}
                      </td>
                      <td className="px-2 py-3 text-right font-display text-base font-black tabular-nums">
                        {dropped ? (
                          <span className="text-faint line-through decoration-2">{r.points}</span>
                        ) : (
                          <span className="text-dark">{r.points}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-sm font-bold tabular-nums">
                        {delta == null || delta === 0
                          ? <span className="text-faint">–</span>
                          : <span style={{ color: delta > 0 ? "#16a34a" : "#dc2626" }}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-5 py-2.5 font-mono text-[11px] leading-relaxed text-light sm:px-6">
            <span className="text-faint line-through decoration-2">Struck</span> points are dropped — a driver&rsquo;s 3
            lowest-scoring rounds don&rsquo;t count toward the total (best 9 of 12).
          </p>
        </div>

        <TeamPanel driver={driver} standings={standingsData.standings} />
      </div>

      <div>
        <Link to="/drivers" className="text-sm font-semibold text-primary hover:underline">← All drivers</Link>
      </div>
    </div>
  );
}
