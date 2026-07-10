import { useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { ErrorBox, Skeleton, CountUp, DriverAvatar } from "../components/ui.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import { countryFor } from "../data/driverCountries.js";

// "Your season" recap: the driver's year retold as a short scroll story.
// Every card is computed from the same profile payload the driver page uses,
// so it works for any driver in any season with recorded positions. Cards
// with no data behind them simply don't render.

function fmtLap(ms) {
  if (!ms || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

// One full-width dark story card. The team colour is the single accent.
function Slide({ eyebrow, color, children, index = 0 }) {
  return (
    <section
      className="dark reveal relative overflow-hidden rounded-[1.75rem] bg-ink p-7 shadow-xl shadow-ink/20 ring-1 ring-white/10 sm:p-12"
      style={{ "--reveal-delay": `${index * 0.05}s` }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.16]"
        style={{ background: `radial-gradient(110% 130% at 88% 0%, ${color}, transparent 55%)` }}
      />
      <div className="relative">
        {eyebrow && (
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-white/50">{eyebrow}</div>
        )}
        {children}
      </div>
    </section>
  );
}

function BigNumber({ value, label, color }) {
  return (
    <div>
      <div className="font-display text-5xl font-black leading-none tabular-nums text-white sm:text-6xl" style={color ? { color } : undefined}>
        {typeof value === "number" ? <CountUp end={value} /> : value}
      </div>
      <div className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">{label}</div>
    </div>
  );
}

export default function SeasonRecap() {
  const { id } = useParams();
  const { data, loading, error } = useApi(useCallback(() => api.driverProfile(id), [id]));

  if (loading)
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full rounded-[1.75rem]" />
        ))}
      </div>
    );
  if (error) return <ErrorBox message={error} />;

  const { driver, championship, stats, perRace, career, season } = data;
  const color = driver.team.color;
  const seasonName = career?.seasons?.find((s) => s.driverId === driver.id)?.seasonName || "This season";

  const finished = (perRace || []).filter((r) => r.status === "FINISHED" && r.position != null);
  if (finished.length < 2)
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark">Not enough racing yet</h1>
        <p className="mt-3 text-light">
          The recap needs a couple of finished rounds with recorded positions. Come back once {driver.name} has been
          out on track more.
        </p>
        <Link to={`/drivers/${driver.id}`} className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink">
          Back to profile
        </Link>
      </div>
    );

  // The season's turning points, all from perRace.
  const bestRace = [...finished].sort((a, b) => a.position - b.position)[0];
  const withGrid = finished.filter((r) => r.grid != null);
  const comeback = withGrid.length
    ? [...withGrid].sort((a, b) => b.grid - b.position - (a.grid - a.position))[0]
    : null;
  const comebackGain = comeback ? comeback.grid - comeback.position : 0;
  const lap = stats?.fastestLap ? fmtLap(stats.fastestLap.bestLapMs) : null;

  // Closest rival: the nearest total in the final standings, above or below.
  const rows = season?.standings || [];
  const meIdx = rows.findIndex((s) => s.driverId === driver.id);
  const me = meIdx >= 0 ? rows[meIdx] : null;
  const neighbours = [rows[meIdx - 1], rows[meIdx + 1]].filter(Boolean);
  const rival = me && neighbours.length
    ? neighbours.sort((a, b) => Math.abs(a.total - me.total) - Math.abs(b.total - me.total))[0]
    : null;
  const rivalGap = rival && me ? Math.abs(me.total - rival.total) : 0;
  const rivalAhead = rival && me ? rival.position < me.position : false;

  // Position-by-round curve (finished rounds only), worst position = bottom.
  const worst = Math.max(...finished.map((r) => r.position));
  const curveW = 100;
  const curveH = 34;
  const pts = finished.map((r, i) => {
    const x = finished.length === 1 ? 50 : (i / (finished.length - 1)) * curveW;
    const y = 3 + ((r.position - 1) / Math.max(1, worst - 1)) * (curveH - 6);
    return `${x},${y}`;
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* cover */}
      <Slide eyebrow={`${seasonName} · Season recap`} color={color} index={0}>
        <div className="mt-5 flex items-center gap-5">
          <DriverAvatar name={driver.name} photoUrl={driver.photoUrl} color={color} size={72} className="ring-4 ring-white/10" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-4xl font-black uppercase leading-none tracking-tight text-white sm:text-6xl">
              {driver.name}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
              <Flag code={countryFor(driver.id, driver.country)} />
              <TeamLogo id={driver.team.id} name={driver.team.name} color={color} logoUrl={driver.team.logoUrl} size={20} showName nameClassName="font-display text-sm font-bold uppercase text-white/80" />
            </div>
          </div>
        </div>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/75">
          {championship.position === 1
            ? "Top of the pile. This is what your season looked like from the timing tower."
            : `P${championship.position} of ${championship.fieldSize} when the dust settled. This is what your season looked like from the timing tower.`}
        </p>
      </Slide>

      {/* the numbers */}
      <Slide eyebrow="The numbers" color={color} index={1}>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          <BigNumber value={championship.points} label="Points" color={color} />
          <BigNumber value={stats.starts} label="Starts" />
          <BigNumber value={stats.wins} label={stats.wins === 1 ? "Win" : "Wins"} />
          <BigNumber value={stats.podiums} label="Podiums" />
        </div>
        {(stats.polePositions > 0 || stats.overtakes > 0) && (
          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-white/10 pt-7 sm:grid-cols-4">
            {stats.polePositions > 0 && <BigNumber value={stats.polePositions} label={stats.polePositions === 1 ? "Pole" : "Poles"} />}
            {stats.overtakes > 0 && <BigNumber value={stats.overtakes} label="Overtakes" />}
            {stats.avgFinish != null && <BigNumber value={`P${stats.avgFinish}`} label="Avg finish" />}
            {lap && <BigNumber value={lap} label={`Best lap · ${stats.fastestLap.track}`} />}
          </div>
        )}
      </Slide>

      {/* best night */}
      <Slide eyebrow="The best night" color={color} index={2}>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="font-display text-7xl font-black leading-none text-white sm:text-8xl">
              P{bestRace.position}
            </div>
            <div className="mt-3 font-display text-xl font-extrabold uppercase tracking-tight text-white/85">
              {bestRace.track} <span className="text-white/40">· Round {bestRace.number}</span>
            </div>
          </div>
          {comeback && comebackGain > 0 && (
            <div className="max-w-[16rem]">
              <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">The charge</div>
              <div className="mt-2 text-lg leading-snug text-white/80">
                P{comeback.grid} to P{comeback.position} at {comeback.track}:{" "}
                <span className="font-bold text-emerald-400">{comebackGain} places gained</span> in one race.
              </div>
            </div>
          )}
        </div>
      </Slide>

      {/* season shape */}
      <Slide eyebrow="The shape of the season" color={color} index={3}>
        <div className="mt-6">
          <svg viewBox={`0 0 ${curveW} ${curveH}`} preserveAspectRatio="none" className="h-36 w-full" aria-hidden="true">
            <polyline
              points={pts.join(" ")}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pathLength="1"
              className="raceflow-line"
            />
          </svg>
          <div className="mt-2 flex justify-between font-mono text-[10px] font-bold uppercase tracking-wider text-white/45">
            <span>R{finished[0].number}</span>
            <span>Higher line = better finish</span>
            <span>R{finished[finished.length - 1].number}</span>
          </div>
        </div>
        <p className="mt-5 max-w-xl text-white/75">
          Best of P{stats.bestFinish}, worst of P{stats.worstFinish}, points in {stats.pointsFinishes} of{" "}
          {stats.starts} starts.
        </p>
      </Slide>

      {/* rival */}
      {rival && (
        <Slide eyebrow="The fight" color={color} index={4}>
          <div className="mt-6 flex items-center gap-5">
            <DriverAvatar name={rival.name} photoUrl={rival.photoUrl} color={rival.team?.color} size={56} className="ring-4 ring-white/10" />
            <div>
              <div className="font-display text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">{rival.name}</div>
              <div className="mt-1 font-mono text-xs uppercase tracking-wider text-white/55">
                P{rival.position} · {rival.team?.name}
              </div>
            </div>
          </div>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80">
            {rivalGap === 0 ? (
              <>Dead level on points. It doesn't get closer than that.</>
            ) : (
              <>
                {rivalAhead ? "Just ahead of you" : "Kept behind you"} in the table, separated by{" "}
                <span className="font-bold text-white">{rivalGap} {rivalGap === 1 ? "point" : "points"}</span> at the flag.
              </>
            )}
          </p>
          <Link
            to={`/drivers/${rival.driverId}`}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white/80 transition hover:bg-white/10"
          >
            Their season →
          </Link>
        </Slide>
      )}

      {/* outro */}
      <Slide eyebrow="That's a wrap" color={color} index={5}>
        <p className="mt-6 max-w-xl font-display text-2xl font-extrabold uppercase leading-tight tracking-tight text-white sm:text-3xl">
          Same grid, next season. See you at lights out.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            to={`/drivers/${driver.id}`}
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:brightness-105"
          >
            Full profile
          </Link>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(window.location.href)}
            className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white/80 transition hover:bg-white/10"
          >
            Copy link
          </button>
        </div>
      </Slide>
    </div>
  );
}
