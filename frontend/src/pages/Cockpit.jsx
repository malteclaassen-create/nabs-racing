import { useCallback, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import SlidingTabs from "../components/SlidingTabs.jsx";
import Flag from "../components/Flag.jsx";
import TeamLogo from "../components/TeamLogo.jsx";
import {
  DriverAvatar, EmptyState, ErrorBox, TableSkeleton, CountUp, MEDAL,
} from "../components/ui.jsx";

// ---------------------------------------------------------------------------
// The member's private area inside /profile. Three sections beside the profile
// editor: Insights (career truths only the raw lap archives know — true pace,
// starts, tyres, lost time, rivals), Race Analysis (one race, lap by lap) and
// Achievements. Editorial layout: big numbers and hairlines, not card grids.
// ---------------------------------------------------------------------------

function fmtLap(ms) {
  if (ms == null || !isFinite(ms) || ms <= 0) return "–";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(t).padStart(3, "0")}`;
}
function fmtDelta(ms) {
  if (ms == null || !isFinite(ms)) return "–";
  return `${ms >= 0 ? "+" : "-"}${(Math.abs(ms) / 1000).toFixed(3)}s`;
}
function fmtDuration(ms) {
  if (ms == null || !isFinite(ms) || ms <= 0) return "–";
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return mins > 0 ? `${mins}m ${String(secs).padStart(2, "0")}s` : `${secs}s`;
}
const ordinal = (p) => (p == null ? "–" : `P${p}`);

const TYRE_COLORS = { SS: "#dc2626", S: "#ef4444", M: "#eab308", H: "#94a3b8", HS: "#f97316", I: "#16a34a", W: "#2563eb" };
const tyreColor = (t) => TYRE_COLORS[String(t || "").toUpperCase()] || "#a78bfa";

// Result tint for the hero's form boxes.
function resultTint(f) {
  if (f.status === "DNF" || f.status === "DSQ") return { bg: "rgba(239,68,68,0.9)", fg: "#fff" };
  if (f.status !== "FINISHED" || f.position == null) return { bg: "rgba(255,255,255,0.14)", fg: "rgba(255,255,255,0.75)" };
  if (f.position <= 3) return { bg: MEDAL[f.position - 1], fg: "#0f172a" };
  if (f.points > 0) return { bg: "rgba(16,185,129,0.85)", fg: "#fff" };
  return { bg: "rgba(255,255,255,0.14)", fg: "rgba(255,255,255,0.75)" };
}

// ---------------------------------------------------------------------------
// Chart kit (line / area / step, clipped y-domain, tyre-coloured dots).
// ---------------------------------------------------------------------------
function Chart({ series, height = 180, yFlip = false, yDomain = null, yFmt = (v) => v, xFmt = (v) => v, yTicks = 4, zeroLine = false }) {
  const all = series.flatMap((s) => s.points).filter((p) => p.y != null);
  if (!all.length) return null;
  const xs = all.map((p) => p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let [y0, y1] = yDomain || [Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y))];
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const W = 640, H = height, PL = 50, PR = 12, PT = 10, PB = 24;
  const sx = (x) => PL + ((x - x0) / Math.max(1e-9, x1 - x0)) * (W - PL - PR);
  const sy = (y) => {
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
    return PT + (yFlip ? t : 1 - t) * (H - PT - PB);
  };
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => y0 + ((y1 - y0) * i) / yTicks);
  const path = (pts, step) =>
    pts
      .map((p, i) => {
        if (!i) return `M${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
        if (step) return `H${sx(p.x).toFixed(1)}V${sy(p.y).toFixed(1)}`;
        return `L${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
      })
      .join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={sy(t)} y2={sy(t)} stroke="rgba(100,116,139,0.16)" strokeWidth="1" />
          <text x={PL - 7} y={sy(t) + 3.5} textAnchor="end" fontSize="10" fill="rgba(100,116,139,0.85)" className="font-mono tabular-nums">
            {yFmt(Math.round(t * 100) / 100)}
          </text>
        </g>
      ))}
      {zeroLine && y0 < 0 && y1 > 0 && (
        <line x1={PL} x2={W - PR} y1={sy(0)} y2={sy(0)} stroke="rgba(100,116,139,0.5)" strokeWidth="1.5" strokeDasharray="4 3" />
      )}
      {series.map((s, si) => {
        const pts = s.points.filter((p) => p.y != null);
        if (!pts.length) return null;
        const d = path(pts, s.step);
        const base = sy(s.baseline ?? (yFlip ? y1 : y0));
        return (
          <g key={si}>
            {s.area && (
              <path d={`${d}L${sx(pts[pts.length - 1].x).toFixed(1)},${base}L${sx(pts[0].x).toFixed(1)},${base}Z`} fill={s.color} opacity={0.1} />
            )}
            <path d={d} fill="none" stroke={s.color} strokeWidth={s.width || 2.5} strokeLinejoin="round" strokeLinecap="round" opacity={s.opacity ?? 1} />
          </g>
        );
      })}
      {series.flatMap((s, si) =>
        (s.dots || []).map((p, i) => (
          <circle key={`${si}-${i}`} cx={sx(p.x)} cy={sy(p.y)} r={p.r ?? 3} fill={p.color || s.color} stroke="#fff" strokeWidth="1">
            {p.title && <title>{p.title}</title>}
          </circle>
        ))
      )}
      <text x={PL} y={H - 7} fontSize="10" fill="rgba(100,116,139,0.85)" className="font-mono">{xFmt(x0)}</text>
      <text x={W - PR} y={H - 7} textAnchor="end" fontSize="10" fill="rgba(100,116,139,0.85)" className="font-mono">{xFmt(x1)}</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Dark broadcast hero: who you are, where you stand, the last five rounds.
// ---------------------------------------------------------------------------
function Hero() {
  const q = useApi(useCallback(() => api.cockpitOverview(), []));
  const d = q.data;
  const color = d?.driver?.team?.color || "#e11d48";
  const ch = d?.championship;
  return (
    <section className="dark relative mb-10 overflow-hidden rounded-[1.75rem] bg-ink text-white shadow-xl shadow-ink/20 ring-1 ring-white/10">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full opacity-25 blur-3xl" style={{ backgroundColor: color }} />
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${color}, transparent 70%)` }} />
        {d?.driver?.number != null && (
          <div className="absolute -right-4 -top-10 select-none font-display text-[11rem] font-black leading-none text-white/[0.06] sm:text-[15rem]">
            {d.driver.number}
          </div>
        )}
      </div>
      <div className="relative px-5 py-6 sm:px-8 sm:py-7">
        {q.loading ? (
          <div className="h-24 animate-pulse rounded-xl bg-white/5" />
        ) : q.error ? (
          <div className="text-sm text-red-300">{q.error}</div>
        ) : (
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-center gap-4">
              <DriverAvatar name={d.driver.name} photoUrl={d.driver.photoUrl} color={color} size={64} className="ring-2 ring-white/20" />
              <div>
                <div className="font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-white/50">
                  Private cockpit · {d.driver.seasonName}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 className="font-display text-3xl font-black uppercase leading-none tracking-tight sm:text-4xl">{d.driver.name}</h1>
                  {d.driver.country && <Flag code={d.driver.country} className="h-4 rounded-[2px]" />}
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-sm text-white/70">
                  {d.driver.team && <TeamLogo team={d.driver.team} size={16} />}
                  <span className="font-semibold" style={{ color }}>{d.driver.team?.name}</span>
                  {d.driver.number != null && <span className="text-white/40">· #{d.driver.number}</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/50">Championship</div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span
                    className="font-display text-5xl font-black leading-none tabular-nums"
                    style={ch?.position >= 1 && ch.position <= 3 ? { color: MEDAL[ch.position - 1] } : undefined}
                  >
                    {ordinal(ch?.position)}
                  </span>
                  {ch?.trend ? (
                    <span className={`font-mono text-sm font-bold ${ch.trend > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {ch.trend > 0 ? "▲" : "▼"}{Math.abs(ch.trend)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 font-mono text-[11px] text-white/50">of {ch?.fieldSize} classified</div>
              </div>
              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/50">Points</div>
                <div className="mt-0.5 font-display text-5xl font-black leading-none tabular-nums"><CountUp end={ch?.points ?? 0} /></div>
                <div className="mt-1 font-mono text-[11px] text-white/50">
                  {ch?.gapToLeader > 0 ? `${ch.gapToLeader} behind P1` : "championship lead"}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/50">Form</div>
                <div className="mt-1.5 flex gap-1.5">
                  {(d.form || []).map((f) => {
                    const tint = resultTint(f);
                    return (
                      <span
                        key={f.number}
                        title={`Round ${f.number} · ${f.track}${f.dropped ? " · dropped result" : ""}`}
                        className={`flex h-9 w-9 items-center justify-center rounded-md font-display text-sm font-black tabular-nums ${f.dropped ? "opacity-45" : ""}`}
                        style={{ backgroundColor: tint.bg, color: tint.fg }}
                      >
                        {f.status === "FINISHED" && f.position != null ? f.position : f.status === "DNS" ? "·" : f.status[0]}
                      </span>
                    );
                  })}
                </div>
                <div className="mt-1 font-mono text-[11px] text-white/50">last five rounds</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Insights — the numbers nobody else on the site gets to see. One flowing
// editorial page: eyebrow, a huge headline number, honest sentences, and one
// chart per theme. Hairlines between sections, no card grid.
// ---------------------------------------------------------------------------

function Insight({ eyebrow, children }) {
  return (
    <section className="grid gap-x-12 gap-y-6 border-t border-border py-10 first:border-t-0 first:pt-0 lg:grid-cols-2">
      <span className="sr-only">{eyebrow}</span>
      {children}
    </section>
  );
}

function BigStat({ eyebrow, value, unit, tone, sub }) {
  return (
    <div>
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-eyebrow">{eyebrow}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`font-display text-6xl font-black leading-none tracking-tight sm:text-7xl ${tone || "text-dark"}`}>{value}</span>
        {unit && <span className="font-display text-xl font-bold text-faint">{unit}</span>}
      </div>
      {sub && <div className="mt-2 text-sm text-light">{sub}</div>}
    </div>
  );
}

function InsightsTab() {
  const q = useApi(useCallback(() => api.cockpitInsights(), []));
  const duels = useApi(useCallback(() => api.cockpitDuels(), []));
  if (q.loading) return <TableSkeleton rows={8} />;
  if (q.error) return <ErrorBox message={q.error} />;
  const d = q.data;
  if (!d.races.length) {
    return (
      <EmptyState
        title="Not enough lap data yet"
        hint="These insights are distilled from the raw lap files of your races (Season 5 onwards). Run a few rounds and this page writes itself."
      />
    );
  }

  const recent = d.races.slice(-12);
  const idx = (r) => d.races.indexOf(r);

  // --- pace vs result -----------------------------------------------------------
  const paceSeries = [
    {
      label: "True pace",
      color: "#ec4899",
      width: 3,
      area: true,
      points: recent.filter((r) => r.paceRank != null).map((r) => ({ x: idx(r), y: r.paceRank })),
      dots: recent.filter((r) => r.paceRank != null).map((r) => ({ x: idx(r), y: r.paceRank, title: `${r.track} S${r.seasonNumber}: pace P${r.paceRank}` })),
    },
    {
      label: "Result",
      color: "#94a3b8",
      width: 1.8,
      opacity: 0.65,
      points: recent.filter((r) => r.finishPos != null).map((r) => ({ x: idx(r), y: r.finishPos })),
      dots: recent.filter((r) => r.finishPos != null).map((r) => ({ x: idx(r), y: r.finishPos, r: 2.5, title: `${r.track} S${r.seasonNumber}: finished P${r.finishPos}` })),
    },
  ];
  const delta = d.pace?.deliveryDelta;
  const paceStory =
    delta == null
      ? null
      : delta > 0.5
        ? `You finish better than your raw speed: on average ${Math.abs(delta)} positions ahead of your pace rank. That's racecraft, consistency and staying out of trouble.`
        : delta < -0.5
          ? `Your raw speed is worth about ${Math.abs(delta)} positions more than you're scoring. The speed is there; the results leak away in traffic, incidents or strategy.`
          : `Your results land almost exactly where your raw speed says they should. You're converting your pace cleanly.`;

  // --- starts ------------------------------------------------------------------
  const startSeries = d.starts
    ? [{
        label: "Lap 1",
        color: "#38bdf8",
        width: 2.5,
        area: true,
        baseline: 0,
        points: recent.filter((r) => r.grid != null && r.lap1Pos != null).map((r) => ({ x: idx(r), y: r.grid - r.lap1Pos })),
        dots: recent
          .filter((r) => r.grid != null && r.lap1Pos != null)
          .map((r) => {
            const g = r.grid - r.lap1Pos;
            return { x: idx(r), y: g, color: g > 0 ? "#10b981" : g < 0 ? "#ef4444" : "#94a3b8", title: `${r.track} S${r.seasonNumber}: ${g > 0 ? "+" : ""}${g} on lap 1` };
          }),
      }]
    : [];
  const startMax = Math.max(2, ...startSeries.flatMap((s) => s.points.map((p) => Math.abs(p.y))));

  // --- tyres --------------------------------------------------------------------
  const tyres = d.tyres || [];
  const worstTyre = tyres.length ? [...tyres].sort((a, b) => b.degMsPerLap - a.degMsPerLap)[0] : null;
  const maxAbsDeg = Math.max(1, ...tyres.map((t) => Math.abs(t.degMsPerLap)));

  // --- rivals -------------------------------------------------------------------
  const duelList = duels.data?.duels || [];
  const nemesis = duelList.find((x) => x.key === duels.data?.nemesisKey);
  const favourite = duelList.find((x) => x.key === duels.data?.favouriteKey);
  const rivalRows = [
    ...(nemesis ? [{ ...nemesis, badge: "Nemesis", badgeTone: "text-red-500" }] : []),
    ...(favourite ? [{ ...favourite, badge: "Favourite rival", badgeTone: "text-emerald-600" }] : []),
    ...duelList.filter((x) => x !== nemesis && x !== favourite).slice(0, 3),
  ];

  return (
    <div>
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-light">
        Everything below is distilled from the raw lap files of your {d.races.length} archived races. None of it exists
        anywhere else on the site: this is how you actually drive, not just where you finished.
      </p>

      {/* 1 · true pace */}
      <Insight eyebrow="True pace">
        <div>
          <BigStat
            eyebrow="True pace, ranked each race"
            value={d.pace?.avgPaceRank != null ? `P${d.pace.avgPaceRank}` : "–"}
            sub={`average clean-lap pace rank · results average ${d.pace?.avgFinish != null ? `P${d.pace.avgFinish}` : "–"}`}
          />
          <div className="mt-5 max-w-md space-y-3 text-[15px] leading-relaxed text-medium">
            {paceStory && <p>{paceStory}</p>}
            <p>
              {d.pace?.topPaceRaces > 0
                ? `${d.pace.topPaceRaces} ${d.pace.topPaceRaces === 1 ? "race" : "races"} with a top-3 pace in the field`
                : "No top-3 pace race yet"}
              {d.pace?.avgGapToBestMs != null ? `, and on an average night you're ${fmtDelta(d.pace.avgGapToBestMs).replace("+", "")} a lap off the fastest car.` : "."}
            </p>
          </div>
        </div>
        <div className="self-center">
          <Chart series={paceSeries} height={220} yFlip yDomain={[1, Math.max(...paceSeries.flatMap((s) => s.points.map((p) => p.y))) + 1]} yFmt={(v) => `P${Math.round(v)}`} xFmt={() => ""} yTicks={3} />
          <div className="mt-2 flex gap-5 text-xs text-light">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#ec4899]" /> your pace rank</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#94a3b8]" /> your finishing position</span>
          </div>
          <p className="mt-1 text-xs text-faint">Last {recent.length} races, oldest to newest. When pink runs below grey, you were faster than your result shows.</p>
        </div>
      </Insight>

      {/* 2 · starts */}
      {d.starts && (
        <Insight eyebrow="Starts">
          <div className="lg:order-2">
            <BigStat
              eyebrow="Lap one, on average"
              value={`${d.starts.avgLap1Delta > 0 ? "+" : ""}${d.starts.avgLap1Delta ?? "–"}`}
              unit="places"
              tone={d.starts.avgLap1Delta > 0 ? "text-emerald-600" : d.starts.avgLap1Delta < 0 ? "text-red-500" : undefined}
              sub={`grid position vs position after lap 1, over ${d.starts.races} starts`}
            />
            <div className="mt-5 max-w-md space-y-3 text-[15px] leading-relaxed text-medium">
              <p>
                You came out of lap 1 ahead in {d.starts.gainedStarts} {d.starts.gainedStarts === 1 ? "race" : "races"} and behind in {d.starts.lostStarts}.
                {d.starts.avgLap1Delta < -1 ? " The first lap is where your races get harder than they need to be." : d.starts.avgLap1Delta > 1 ? " The first lap is one of your sharpest weapons." : ""}
              </p>
              {d.starts.bestStart && (
                <p>
                  Your best launch: <span className="font-bold text-dark">{d.starts.bestStart.track}</span> in Season {d.starts.bestStart.seasonNumber},
                  {" "}<span className="font-mono font-bold text-emerald-600">+{d.starts.bestStart.gained}</span> places before the field reached the line again.
                </p>
              )}
            </div>
          </div>
          <div className="self-center lg:order-1">
            <Chart series={startSeries} height={200} yDomain={[-startMax - 1, startMax + 1]} zeroLine yFmt={(v) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`)} xFmt={() => ""} yTicks={4} />
            <p className="mt-1 text-xs text-faint">Places gained (green) or lost (red) on the opening lap, race by race.</p>
          </div>
        </Insight>
      )}

      {/* 3 · tyres */}
      {tyres.length > 0 && (
        <Insight eyebrow="Tyres">
          <div>
            <BigStat
              eyebrow="Tyre management"
              value={worstTyre ? worstTyre.tyre : "–"}
              unit={worstTyre ? "wears fastest on you" : ""}
              sub={worstTyre ? `${worstTyre.degMsPerLap > 0 ? "+" : ""}${(worstTyre.degMsPerLap / 1000).toFixed(2)}s per lap trend across a stint` : null}
            />
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-medium">
              The trend mixes tyre wear against the fuel burning off: a falling number means you keep gaining time
              through a stint, a rising one means the tyre gives up faster than the car gets lighter.
            </p>
          </div>
          <div className="space-y-4 self-center">
            {tyres.map((t) => {
              const pct = Math.max(6, (Math.abs(t.degMsPerLap) / maxAbsDeg) * 100);
              const rising = t.degMsPerLap > 0;
              return (
                <div key={t.tyre}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="inline-flex items-center gap-2 font-bold text-dark">
                      <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ backgroundColor: tyreColor(t.tyre) }} />
                      {t.tyre}
                      <span className="font-mono text-[11px] font-normal text-faint">{t.laps} laps · longest stint {t.longestStint}</span>
                    </span>
                    <span className={`font-mono text-sm font-bold tabular-nums ${rising ? "text-red-500" : "text-emerald-600"}`}>
                      {rising ? "+" : "−"}{Math.abs(t.degMsPerLap / 1000).toFixed(2)}s/lap
                    </span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-border">
                    <span className={`h-full rounded-full ${rising ? "bg-red-400" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Insight>
      )}

      {/* 4 · time off your pace */}
      {d.lostTime && (
        <Insight eyebrow="Lost time">
          <div className="lg:order-2">
            <BigStat
              eyebrow="Time away from your pace"
              value={fmtDuration(d.lostTime.perRaceMs)}
              unit="per race"
              sub="pit stops, safety cars, spins and traffic, measured against your own clean laps"
            />
            <div className="mt-5 max-w-md space-y-3 text-[15px] leading-relaxed text-medium">
              <p>Across every archived race that adds up to {fmtDuration(d.lostTime.totalMs)} not spent at racing speed.</p>
              {d.lostTime.calmest && (
                <p>
                  Your cleanest afternoon: <span className="font-bold text-dark">{d.lostTime.calmest.track}</span> in Season {d.lostTime.calmest.seasonNumber},
                  only {fmtDuration(d.lostTime.calmest.offPaceMs)} off your rhythm all race.
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-6 self-center lg:order-1">
            <div>
              <div className="font-display text-4xl font-black tabular-nums text-dark">{fmtDuration(d.lostTime.totalMs)}</div>
              <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-eyebrow">career total</div>
            </div>
            <div>
              <div className="font-display text-4xl font-black tabular-nums text-dark">{d.races.length}</div>
              <div className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-eyebrow">races measured</div>
            </div>
          </div>
        </Insight>
      )}

      {/* 5 · rivals */}
      {rivalRows.length > 0 && (
        <Insight eyebrow="Rivals">
          <div>
            <BigStat eyebrow="Head to head, career-wide" value={rivalRows[0]?.name?.split(/\s/)[0] ?? "–"} unit={rivalRows[0]?.badge ? rivalRows[0].badge.toLowerCase() : "most raced"} />
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-medium">
              Counted across every race you've shared with them, in every season. The public profile shows one season
              against one driver; this is the whole history.
            </p>
          </div>
          <div className="space-y-5 self-center">
            {rivalRows.map((x) => {
              const total = x.raceWins + x.raceLosses;
              const pct = total ? (x.raceWins / total) * 100 : 50;
              return (
                <div key={x.key}>
                  <div className="mb-1.5 flex items-center gap-2.5">
                    <DriverAvatar name={x.name} photoUrl={x.photoUrl} color={x.teamColor} size={28} />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-dark">
                      {x.name}
                      {x.badge && <span className={`ml-2 font-mono text-[10px] font-bold uppercase tracking-wider ${x.badgeTone}`}>{x.badge}</span>}
                      {x.isTeammate && !x.badge && <span className="ml-2 font-mono text-[10px] font-bold uppercase tracking-wider text-sky-600">Teammate</span>}
                    </span>
                    <span className="font-display text-lg font-black tabular-nums leading-none">
                      <span className="text-emerald-600">{x.raceWins}</span>
                      <span className="mx-1 text-faint">:</span>
                      <span className="text-red-500">{x.raceLosses}</span>
                    </span>
                  </div>
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-red-400/60">
                    <span className="h-full rounded-r-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Insight>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Race analysis — pick a race, read its lap story. Flat sections, no boxes.
// ---------------------------------------------------------------------------
function RaceAnalysis({ raceId }) {
  // deps must ALSO go to useApi — its internal memo would otherwise never
  // refetch on a prop change (the bug that froze race switching once).
  const q = useApi(useCallback(() => api.cockpitRaceAnalysis(raceId), [raceId]), [raceId]);
  if (q.loading) return <TableSkeleton rows={4} />;
  if (q.error) return <ErrorBox message={q.error} />;
  const d = q.data;
  const a = d.analysis;

  let racing = [], excluded = 0, yDom = null, lapDots = [];
  if (a) {
    const real = a.laps.filter((l) => l.timeMs != null);
    const sorted = real.map((l) => l.timeMs).sort((x, y) => x - y);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    racing = median ? real.filter((l) => l.timeMs <= median * 1.08) : real;
    excluded = real.length - racing.length;
    if (racing.length) {
      const lo = Math.min(...racing.map((l) => l.timeMs));
      const hi = Math.max(...racing.map((l) => l.timeMs));
      const pad = Math.max(200, (hi - lo) * 0.08);
      yDom = [lo - pad, hi + pad];
    }
    lapDots = racing.map((l) => ({
      x: l.lap,
      y: l.timeMs,
      color: tyreColor(l.tyre),
      r: l.timeMs === a.bestLapMs ? 4.5 : 3,
      title: `Lap ${l.lap}: ${fmtLap(l.timeMs)}${l.tyre ? ` · ${l.tyre}` : ""}${l.timeMs === a.bestLapMs ? " · personal best" : ""}`,
    }));
  }
  const posPoints = a ? a.laps.filter((l) => l.position != null).map((l) => ({ x: l.lap, y: l.position })) : [];
  if (a && d.result.grid != null && posPoints.length) posPoints.unshift({ x: 0, y: d.result.grid });
  const posMax = posPoints.length ? Math.max(...posPoints.map((p) => p.y)) : 20;
  const gain = d.result.grid != null && d.result.position != null && d.result.status === "FINISHED" ? d.result.grid - d.result.position : null;

  return (
    <div>
      {/* headline strip */}
      <div className="flex flex-wrap items-center gap-x-10 gap-y-5 border-t border-border py-6">
        <div className="flex items-center gap-3.5">
          <span
            className="flex h-16 w-16 items-center justify-center rounded-2xl font-display text-3xl font-black tabular-nums"
            style={
              d.result.status === "FINISHED" && d.result.position <= 3
                ? { backgroundColor: MEDAL[d.result.position - 1], color: "#0f172a" }
                : { backgroundColor: "rgba(148,163,184,0.15)" }
            }
          >
            {d.result.status === "FINISHED" ? d.result.position : d.result.status}
          </span>
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-eyebrow">Finish</div>
            <div className="text-sm text-light">
              from {ordinal(d.result.grid)} on the grid
              {gain != null && gain !== 0 && (
                <span className={`ml-1.5 font-mono font-bold ${gain > 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {gain > 0 ? `▲${gain}` : `▼${Math.abs(gain)}`}
                </span>
              )}
            </div>
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-eyebrow">Best lap</div>
          <div className="font-display text-3xl font-black tabular-nums text-dark">{fmtLap(d.result.bestLapMs)}</div>
        </div>
        {a?.theoreticalMs && (
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-eyebrow">Ideal lap</div>
            <div className="font-display text-3xl font-black tabular-nums text-dark">{fmtLap(a.theoreticalMs)}</div>
            {d.result.bestLapMs && <div className="text-xs text-light">{fmtDelta(d.result.bestLapMs - a.theoreticalMs)} left on the table</div>}
          </div>
        )}
        {d.quali && (
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-eyebrow">Qualifying</div>
            <div className="font-display text-3xl font-black tabular-nums text-dark">{ordinal(d.quali.position)}</div>
            <div className="text-xs text-light">
              {fmtLap(d.quali.bestLapMs)}
              {d.quali.gapToPoleMs != null && d.quali.gapToPoleMs > 0 ? ` · ${fmtDelta(d.quali.gapToPoleMs)} to pole` : d.quali.gapToPoleMs === 0 ? " · pole position" : ""}
            </div>
          </div>
        )}
      </div>

      {a ? (
        <>
          {/* lap rhythm */}
          <div className="border-t border-border py-8">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark">Lap times</h3>
              <span className="text-xs text-light">
                {racing.length} racing laps{excluded > 0 ? ` · ${excluded} pit / SC / incident laps set aside` : ""}
              </span>
            </div>
            <Chart
              series={[{ color: "#ec4899", width: 2, opacity: 0.55, area: true, points: racing.map((l) => ({ x: l.lap, y: l.timeMs })), dots: lapDots }]}
              height={230}
              yDomain={yDom}
              yFmt={fmtLap}
              xFmt={(v) => `L${v}`}
            />
            {d.telemetry?.stints?.length > 0 && (
              <div className="mt-4 max-w-xl">
                <div className="flex h-3.5 w-full overflow-hidden rounded-full ring-1 ring-border">
                  {d.telemetry.stints.map((s, i) => (
                    <span key={i} className="h-full" style={{ width: `${(s.laps / Math.max(1, a.lapCount)) * 100}%`, backgroundColor: tyreColor(s.tyre) }} title={`${s.tyre}: ${s.laps} laps`} />
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-light">
                  {d.telemetry.stints.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: tyreColor(s.tyre) }} />
                      {s.tyre} · {s.laps} laps
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-x-12 border-t border-border py-8 lg:grid-cols-2">
            {posPoints.length > 1 && (
              <div>
                <h3 className="mb-4 font-display text-xl font-extrabold uppercase tracking-tight text-dark">Grid to flag</h3>
                <Chart
                  series={[{ color: "#38bdf8", width: 2.5, step: true, area: true, points: posPoints }]}
                  height={200}
                  yFlip
                  yDomain={[1, Math.max(posMax, (d.result.grid ?? 1) + 1)]}
                  yFmt={(v) => `P${Math.round(v)}`}
                  xFmt={(v) => (v === 0 ? "Grid" : `L${v}`)}
                  yTicks={3}
                />
              </div>
            )}
            {a.compareTo.length > 0 && a.ownPaceMs != null && (
              <div>
                <h3 className="mb-4 font-display text-xl font-extrabold uppercase tracking-tight text-dark">Race pace</h3>
                <ul className="space-y-4">
                  {a.compareTo.map((c) => {
                    const delta = a.ownPaceMs - c.paceMs;
                    const youFaster = delta < 0;
                    const width = Math.min(100, (Math.abs(delta) / 1500) * 100);
                    return (
                      <li key={c.label}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="font-semibold text-dark">
                            {c.name}
                            <span className="ml-2 font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
                              {c.label === "winner" ? "Winner" : c.label === "ahead" ? "Ahead of you" : "Behind you"}
                            </span>
                          </span>
                          <span className={`font-mono text-sm font-bold tabular-nums ${youFaster ? "text-emerald-600" : "text-red-500"}`}>
                            {youFaster ? "you" : "they"} {(Math.abs(delta) / 1000).toFixed(3)}s/lap faster
                          </span>
                        </div>
                        <div className="flex h-2 w-full overflow-hidden rounded-full bg-border">
                          <span className={`h-full rounded-full ${youFaster ? "bg-emerald-500" : "bg-red-400"}`} style={{ width: `${Math.max(4, width)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 text-xs text-faint">Median of clean racing laps, so pit stops and incidents don't blur the comparison.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <EmptyState title="No lap data for this race" hint="Lap-level analysis needs the archived AC result file, which exists from Season 5 onwards. The headline result above still counts." />
      )}
    </div>
  );
}

function RacesTab() {
  const q = useApi(useCallback(() => api.cockpitRaces(), []));
  const [seasonSel, setSeasonSel] = useState(null);
  const [selected, setSelected] = useState(null);
  if (q.loading) return <TableSkeleton rows={8} />;
  if (q.error) return <ErrorBox message={q.error} />;
  const races = q.data.races;
  if (!races.length) return <EmptyState title="No races yet" hint="Once you've raced, every round of yours can be dissected here lap by lap." />;

  const seasons = [...new Set(races.map((r) => r.seasonNumber))];
  const season = seasonSel ?? seasons[0];
  const seasonRaces = races.filter((r) => r.seasonNumber === season);
  const current = selected && seasonRaces.some((r) => r.raceId === selected) ? selected : seasonRaces[0].raceId;
  const meta = seasonRaces.find((r) => r.raceId === current);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">Pick a race</span>
        <SlidingTabs
          items={seasons.map((sn) => ({ key: String(sn), label: `Season ${sn}` }))}
          value={String(season)}
          onChange={(k) => { setSeasonSel(Number(k)); setSelected(null); }}
          btnClassName="px-3 py-1.5 text-[13px]"
        />
      </div>
      <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-3">
        {seasonRaces.map((r) => {
          const active = r.raceId === current;
          const podium = r.status === "FINISHED" && r.position != null && r.position <= 3;
          return (
            <button
              key={r.raceId}
              type="button"
              onClick={() => setSelected(r.raceId)}
              className={`w-28 shrink-0 rounded-xl border px-3 py-2.5 text-left transition ${
                active ? "border-brand bg-brand/10 shadow-sm" : "border-border bg-card hover:border-brand/40"
              }`}
            >
              <span className="flex items-center justify-between gap-1">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-faint">
                  {r.number != null ? `R${r.number}` : "Event"}
                </span>
                {r.country && <Flag code={r.country} className="h-3 rounded-[1px]" />}
              </span>
              <span className={`mt-0.5 block truncate text-[13px] font-bold ${active ? "text-dark" : "text-medium"}`}>{r.track}</span>
              <span
                className={`mt-1.5 inline-flex h-6 min-w-8 items-center justify-center rounded-md px-1.5 font-display text-[13px] font-black tabular-nums ${
                  podium ? "text-ink" : r.status === "DNF" || r.status === "DSQ" ? "bg-red-500/10 text-red-500" : "bg-surface2 text-medium"
                }`}
                style={podium ? { backgroundColor: MEDAL[r.position - 1] } : undefined}
              >
                {r.status === "FINISHED" && r.position != null ? ordinal(r.position) : r.status}
              </span>
            </button>
          );
        })}
      </div>
      {meta && (
        <div className="mb-2 flex items-center gap-2.5 pt-2">
          {meta.country && <Flag code={meta.country} className="h-4 rounded-[2px]" />}
          <span className="font-display text-2xl font-extrabold uppercase tracking-tight text-dark">{meta.track}</span>
          <span className="font-mono text-xs font-bold text-faint">
            S{meta.seasonNumber}{meta.number != null ? ` · Round ${meta.number}` : ""}{meta.special ? " · special event" : ""}
          </span>
        </div>
      )}
      {/* key forces a fresh mount per race — never stale data after a switch */}
      <RaceAnalysis key={current} raceId={current} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Achievements — unchanged in spirit, category-coloured trophies.
// ---------------------------------------------------------------------------
const ACH_CATS = [
  { key: "milestones", name: "Milestones", color: "#ec4899" },
  { key: "speed", name: "Speed", color: "#38bdf8" },
  { key: "racecraft", name: "Racecraft", color: "#a78bfa" },
  { key: "consistency", name: "Consistency", color: "#34d399" },
  { key: "special", name: "Special", color: "#f59e0b" },
];

function AchievementCard({ a, color, pinned, onPin, pinFull }) {
  if (a.masked) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-surface2/50 px-4 py-3.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-border/60 font-display text-lg font-black text-faint">?</span>
        <div>
          <div className="text-sm font-semibold text-faint">???</div>
          <div className="text-xs text-faint">A hidden achievement. Earn it to reveal it.</div>
        </div>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((a.value / a.target) * 100));
  return (
    <div
      className={`relative overflow-hidden rounded-xl border px-4 py-3.5 ${a.unlocked ? "" : "border-border bg-card"}`}
      style={a.unlocked ? { borderColor: `${color}55`, background: `linear-gradient(135deg, ${color}14, transparent 60%)` } : undefined}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${a.unlocked ? "text-white" : "bg-surface2 text-faint"}`}
          style={a.unlocked ? { backgroundColor: color } : undefined}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="9" r="5" />
            <path d="M9.5 13.5L8 21l4-2 4 2-1.5-7.5" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-bold ${a.unlocked ? "text-dark" : "text-medium"}`}>{a.name}</div>
          <div className="text-xs text-light">{a.tagline}</div>
          {!a.unlocked && a.target > 1 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.7 }} />
              </div>
              <span className="font-mono text-[10px] font-bold tabular-nums text-faint">{a.value}/{a.target}</span>
            </div>
          )}
        </div>
        {a.unlocked && (
          <button
            type="button"
            onClick={() => onPin(a.key)}
            disabled={!pinned && pinFull}
            title={pinned ? "Unpin from your public profile" : pinFull ? "Up to three pins" : "Pin to your public profile"}
            className={`shrink-0 rounded-md p-1.5 transition ${pinned ? "" : "text-faint hover:text-dark"} disabled:opacity-30`}
            style={pinned ? { color } : undefined}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 17v5M5 9l2-6h10l2 6-4 4v4H9v-4z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function AchievementsTab() {
  const q = useApi(useCallback(() => api.cockpitAchievements(), []));
  const [pinnedLocal, setPinnedLocal] = useState(null);
  if (q.loading) return <TableSkeleton rows={8} />;
  if (q.error) return <ErrorBox message={q.error} />;
  const d = q.data;
  const pinned = pinnedLocal ?? d.pinned;

  async function togglePin(key) {
    const next = pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key].slice(0, 3);
    setPinnedLocal(next);
    try {
      const res = await api.saveCockpitPins(next);
      setPinnedLocal(res.pinned);
    } catch {
      setPinnedLocal(pinned);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-5">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-5xl font-black tabular-nums text-dark"><CountUp end={d.unlockedCount} /></span>
          <span className="font-display text-xl font-black text-faint">/ {d.total}</span>
          <span className="ml-2 text-sm text-light">achievements unlocked</span>
        </div>
        <p className="text-xs text-light">Pin up to three onto your public profile with the trophy pin.</p>
      </div>
      {ACH_CATS.map((cat) => {
        const list = d.achievements.filter((a) => a.cat === cat.key);
        if (!list.length) return null;
        const done = list.filter((a) => a.unlocked).length;
        return (
          <div key={cat.key}>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-eyebrow">{cat.name}</span>
              <span className="font-mono text-[11px] tabular-nums text-faint">{done}/{list.length}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((a) => (
                <AchievementCard key={a.key} a={a} color={cat.color} pinned={pinned.includes(a.key)} pinFull={pinned.length >= 3} onPin={togglePin} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embeddable panels — rendered inside /profile behind its long tab bar.
// ---------------------------------------------------------------------------
// Only Achievements is a page section right now — Insights and Race Analysis
// were retired from the bar on the league's wish (their code and endpoints
// stay, ready to come back).
export const COCKPIT_TABS = [
  { key: "achievements", label: "Achievements" },
];

export function CockpitPanels({ tab }) {
  return <div>{tab === "achievements" && <AchievementsTab />}</div>;
}

// Old /cockpit links land on the profile page's Achievements section.
export default function Cockpit() {
  return <Navigate to="/profile?tab=achievements" replace />;
}
