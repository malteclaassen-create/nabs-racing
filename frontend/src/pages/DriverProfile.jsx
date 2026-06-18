import { useCallback, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import {
  ErrorBox, PageHeaderSkeleton, Skeleton, TierBadge, StatusPill, DriverAvatar, MEDAL,
} from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import { countryFor } from "../data/driverCountries.js";

// Circuit -> flag (the nine Season-7 rounds, by the track name stored in the DB).
const TRACK_FLAG = {
  Melbourne: "au", Mugello: "it", Most: "cz", Bahrain: "bh", Monza: "it",
  Jeddah: "sa", Nurburgring: "de", Spa: "be", Imola: "it",
};

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

// Season-form line chart: finishing position per round (P1 at the top).
function FormChart({ perRace, color }) {
  const W = 640, H = 150, padX = 22, padT = 16, padB = 16;
  const N = perRace.length;
  const finishes = perRace.filter((r) => r.status === "FINISHED" && r.position != null);
  const maxPos = Math.max(3, ...finishes.map((r) => r.position));
  const xFor = (i) => padX + (N > 1 ? (i / (N - 1)) * (W - 2 * padX) : 0);
  const yFor = (p) => padT + ((p - 1) / (maxPos - 1)) * (H - padT - padB);

  // split into connected segments (gaps at DNF/DNS rounds)
  const segments = [];
  let cur = [];
  perRace.forEach((r, i) => {
    if (r.status === "FINISHED" && r.position != null) cur.push({ i, p: r.position });
    else { if (cur.length) segments.push(cur); cur = []; }
  });
  if (cur.length) segments.push(cur);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="formFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* P1 guide line */}
      <line x1={padX} x2={W - padX} y1={yFor(1)} y2={yFor(1)} stroke="var(--c-border)" strokeWidth="1" strokeDasharray="3 4" />
      {segments.map((seg, si) => {
        const d = seg.map((pt, k) => `${k ? "L" : "M"}${xFor(pt.i).toFixed(1)},${yFor(pt.p).toFixed(1)}`).join(" ");
        const area = seg.length > 1
          ? `${d} L${xFor(seg[seg.length - 1].i).toFixed(1)},${H - padB} L${xFor(seg[0].i).toFixed(1)},${H - padB} Z`
          : null;
        return (
          <g key={si}>
            {area && <path d={area} fill="url(#formFill)" />}
            <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        );
      })}
      {perRace.map((r, i) => {
        const dnf = r.status !== "FINISHED" || r.position == null;
        const medal = !dnf && r.position <= 3 ? MEDAL[r.position - 1] : null;
        const cy = dnf ? H - padB : yFor(r.position);
        return (
          <circle key={i} cx={xFor(i)} cy={cy} r={medal ? 5 : 4}
            fill={dnf ? "var(--c-surface2)" : medal || color}
            stroke={dnf ? "var(--c-text3)" : "var(--c-card)"} strokeWidth="1.5">
            <title>{`R${r.number} ${r.track} — ${dnf ? r.status : "P" + r.position}`}</title>
          </circle>
        );
      })}
    </svg>
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
            <div className="truncate text-[11px] text-light">{me.driver.team.name}</div>
          </div>
          <span className="shrink-0 font-display text-xl font-black text-faint">VS</span>
          <Link to={`/drivers/${opp.driverId}`} className="group flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <DriverAvatar name={opp.name} photoUrl={opp.photoUrl} color={oppColor} size={60} />
            <div className="truncate font-display text-base font-extrabold uppercase tracking-tight text-dark group-hover:text-primary">{opp.name}</div>
            <div className="truncate text-[11px] text-light">{opp.team.name}</div>
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
          <span className="h-12 w-2 rounded-full" style={{ backgroundColor: c }} />
          <div>
            <div className="font-display text-2xl font-black uppercase tracking-tight text-dark">{driver.team.name}</div>
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
              <Flag code={countryFor(driver.id)} w={30} h={22} />
              <TierBadge tier={driver.tier} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-white/70">
              <span className="h-3.5 w-3.5 rounded-full ring-1 ring-white/20" style={{ backgroundColor: color }} />
              <span className="font-display text-base font-bold uppercase tracking-tight text-white/90">{driver.team.name}</span>
              <span className="text-white/30">·</span>
              <span className="text-sm">{driver.discordName}</span>
            </div>
          </div>
          <div className="flex gap-8 border-t border-white/10 pt-4 sm:flex-col sm:gap-3 sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0 sm:text-right">
            <div>
              <div className="font-display text-5xl font-black leading-none tabular-nums">P{championship.position}</div>
              <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white/50">of {championship.fieldSize}</div>
            </div>
            <div>
              <div className="font-display text-4xl font-black leading-none tabular-nums" style={{ color }}>{championship.points}</div>
              <div className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-white/50">points</div>
            </div>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon="trophy" label="Wins" value={stats.wins} sub={`${stats.winRate}% of starts`} accent={stats.wins ? MEDAL[0] : undefined} />
        <Stat icon="podium" label="Podiums" value={stats.podiums} sub={`${stats.podiumRate}% of starts`} />
        <Stat icon="flagChk" label="Best Finish" value={stats.bestFinish ? `P${stats.bestFinish}` : "–"} sub={`${stats.starts} starts`} />
        <Stat icon="chart" label="Avg Finish" value={stats.avgFinish != null ? `P${stats.avgFinish}` : "–"} sub={`${stats.pointsFinishes} in the points`} />
        <Stat icon="flag" label="Poles" value={stats.polePositions} sub={`best grid P${stats.bestGrid ?? "–"}`} />
        <Stat icon="trend" label="Places Gained"
          value={stats.positionsGained > 0 ? `+${stats.positionsGained}` : stats.positionsGained}
          sub="start → finish"
          accent={stats.positionsGained > 0 ? "#16a34a" : stats.positionsGained < 0 ? "#dc2626" : undefined} />
      </div>

      {/* Season form + Head to head */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex items-baseline gap-3 border-b border-border px-5 py-4 sm:px-6">
            <h2 className="font-display text-lg font-extrabold uppercase tracking-tight text-dark sm:text-xl">Season Form</h2>
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-light">last {perRace.length} races</span>
          </div>
          <div className="p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap gap-2.5">
              {perRace.map((r) => {
                const medal = r.position >= 1 && r.position <= 3 && r.status === "FINISHED" ? MEDAL[r.position - 1] : null;
                const dnf = r.status !== "FINISHED";
                return (
                  <div key={r.number} title={`R${r.number} ${r.track} — ${dnf ? r.status : "P" + r.position}`} className="flex flex-col items-center gap-1.5">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-xl font-display text-base font-black tabular-nums ${
                      medal ? "text-ink" : dnf ? "bg-surface2 text-light" : "bg-surface2 text-dark ring-1 ring-border"}`}
                      style={medal ? { backgroundColor: medal } : undefined}>
                      {dnf ? r.status[0] : r.position}
                    </span>
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-light">R{r.number}</span>
                  </div>
                );
              })}
            </div>
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
                  return (
                    <tr key={r.number} className="transition hover:bg-surface2">
                      <td className="px-5 py-3 font-mono font-bold tabular-nums text-light">{r.number}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2.5">
                          <Flag code={TRACK_FLAG[r.track]} w={22} h={16} />
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
                      <td className="px-2 py-3 text-right font-display text-base font-black tabular-nums text-dark">{r.points}</td>
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
        </div>

        <TeamPanel driver={driver} standings={standingsData.standings} />
      </div>

      <div>
        <Link to="/drivers" className="text-sm font-semibold text-primary hover:underline">← All drivers</Link>
      </div>
    </div>
  );
}
