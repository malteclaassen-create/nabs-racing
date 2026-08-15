import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { Field } from "./ui.jsx";
import { fmtLap } from "../utils/format.js";

// The card shell this was drawn in on the Tools page. Ten presentational lines,
// copied rather than imported: reaching into pages/Tools.jsx for it would pull
// the whole race-prep page into the admin bundle to borrow a border.
function ToolCard({ title, subtitle, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border bg-surface2/50 px-5 py-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-light">{subtitle}</p>}
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Two drivers' fastest laps at a track, pedal for pedal.
//
// Lived at the foot of the public /tools page until the league decided whether
// a driver's inputs are something everyone gets to study about everyone. Until
// that is answered it is an admin tool: the recording half runs as before, and
// this is the half that is held back (see routes/telemetryLaps.js, where the
// same decision is one line of middleware).
//
// Moved whole, not rewritten. It worked; the question was who may open it.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Telemetry comparison: two drivers' fastest laps at a track, pedal for pedal.
//
// The laps come from the in-game nabsTelemetry app (ac-apps/nabsTelemetry),
// which samples throttle/brake/steering/speed over the lap BY TRACK POSITION —
// every lap has the same 800 slices of the same spline, so two laps line up
// slice-for-slice and the delta chart is a plain subtraction. The site keeps
// one lap per driver per track: their fastest clean one.
// ---------------------------------------------------------------------------

// One channel as an SVG polyline, stretched to its box (the season-form
// chart's trick: viewBox in data space, non-scaling strokes).
function tracePoints(values, lo, hi) {
  const span = hi - lo || 1;
  return values
    .map((v, i) => `${i},${(100 - ((v - lo) / span) * 100).toFixed(2)}`)
    .join(" ");
}

function TracePanel({ title, unit, children, height = 96 }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{title}</span>
        {unit && <span className="font-mono text-[10px] text-faint">{unit}</span>}
      </div>
      <div className="relative overflow-hidden rounded-lg border border-border bg-surface2/30" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

function TraceSvg({ n, lines }) {
  return (
    <svg viewBox={`0 0 ${n - 1} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
      {lines.map((l, i) => (
        <polyline
          key={i}
          points={l.points}
          fill="none"
          stroke={l.color}
          strokeWidth={l.width || 1.8}
          strokeDasharray={l.dash}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          opacity={l.opacity ?? 1}
        />
      ))}
    </svg>
  );
}

// Centred moving average, for every signal that gets eyeballed or thresholded:
// raw 60fps samples wobble, and both the corner detector and the map colouring
// would flicker on the noise.
function smoothSeries(arr, w = 9) {
  const half = Math.floor(w / 2);
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) { sum += arr[j]; cnt++; }
    out[i] = sum / cnt;
  }
  return out;
}

// Corners, read off the speed trace: contiguous stretches clearly below the
// lap's fast pace, close ones merged, each with its apex (slowest slice).
// Good enough on purpose — this feeds labels and map markers, not scoring.
function detectCorners(speedRaw) {
  const speed = smoothSeries(speedRaw, 9);
  const vmax = Math.max(...speed);
  const thr = vmax * 0.8;
  const regions = [];
  let cur = null;
  for (let i = 0; i < speed.length; i++) {
    if (speed[i] < thr) {
      if (!cur) cur = { start: i, end: i };
      cur.end = i;
    } else if (cur) {
      regions.push(cur);
      cur = null;
    }
  }
  if (cur) regions.push(cur);
  const merged = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < 12) last.end = r.end;
    else merged.push({ ...r });
  }
  return merged
    .filter((r) => r.end - r.start >= 4)
    .slice(0, 15)
    .map((r) => {
      let apex = r.start;
      for (let i = r.start; i <= r.end; i++) if (speed[i] < speed[apex]) apex = i;
      return { ...r, apex };
    });
}

// Metres driven up to each slice, from the recorded world position (stored in
// decimetres). What turns "brakes 6 slices later" into "brakes 14 m later".
function cumulativeDist(x, z, n) {
  const d = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dx = (x[i] - x[i - 1]) / 10, dz = (z[i] - z[i - 1]) / 10;
    d[i] = d[i - 1] + Math.hypot(dx, dz);
  }
  return d;
}

// The per-corner story in numbers: who gains how much through the corner, who
// brakes later (metres, when positions were recorded), who carries more
// mid-corner speed, who exits faster. Numbers, deliberately not coaching prose
// — "brake earlier next time" would be the site guessing at causality.
function cornerInsights(lapA, lapB, corners, dist, n) {
  const brakePoint = (lap, from, to) => {
    for (let i = from; i <= to; i++) if (lap.brake[i] >= 30) return i;
    return null;
  };
  return corners.map((c, k) => {
    const s0 = Math.max(0, c.start - 30);
    const e0 = Math.min(n - 1, c.end + 12);
    // + = B lost time across the corner = A gained.
    const gainMs = (lapB.t[e0] - lapA.t[e0]) - (lapB.t[s0] - lapA.t[s0]);
    const bA = brakePoint(lapA, s0, c.apex);
    const bB = brakePoint(lapB, s0, c.apex);
    const minA = Math.min(...lapA.speed.slice(c.start, c.end + 1));
    const minB = Math.min(...lapB.speed.slice(c.start, c.end + 1));
    return {
      n: k + 1,
      apex: c.apex,
      gainMs,
      // + = B brakes later than A.
      brakeDeltaM: bA != null && bB != null && dist ? Math.round(dist[bB] - dist[bA]) : null,
      midDelta: minB - minA, // + = B carries more mid-corner speed
      exitDelta: lapB.speed[e0] - lapA.speed[e0], // + = B exits faster
    };
  });
}

// The track, drawn from the lap itself: the recorded positions ARE the racing
// line, so no track files, no calibration. Coloured by who gains where when
// two laps are up (smoothed per-slice time gain), with the corner numbers at
// their apexes and the shared cursor as a dot. Clicking jumps the cursor.
function TrackMap({ lapA, lapB, n, corners, cursor, onPick }) {
  const geo = useMemo(() => {
    if (!lapA?.x || !lapA?.z) return null;
    const xs = lapA.x.slice(0, n).map((v) => v / 10);
    const zs = lapA.z.slice(0, n).map((v) => v / 10);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
    const W = 100, H = (spanZ / spanX) * 100;
    const pad = 6;
    const px = xs.map((v) => pad + ((v - minX) / spanX) * (W - 2 * pad));
    const py = zs.map((v) => pad + ((v - minZ) / spanZ) * (H * ((W - 2 * pad) / W)) );
    return { px, py, W, H: Math.max(30, H * ((W - 2 * pad) / W) + 2 * pad) };
  }, [lapA, n]);

  const segs = useMemo(() => {
    if (!geo) return [];
    if (!lapB) return [{ color: "var(--c-faint)", from: 0, to: n - 1 }];
    const g = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) g[i] = (lapB.t[i + 1] - lapB.t[i]) - (lapA.t[i + 1] - lapA.t[i]);
    const sg = smoothSeries(g, 11);
    const thr = 1.2; // ms per slice; below it the stretch reads as even
    const catOf = (v) => (v > thr ? "a" : v < -thr ? "b" : "even");
    const out = [];
    let from = 0, cat = catOf(sg[0]);
    for (let i = 1; i < n - 1; i++) {
      const c = catOf(sg[i]);
      if (c !== cat) { out.push({ cat, from, to: i }); cat = c; from = i; }
    }
    out.push({ cat, from, to: n - 1 });
    const color = { a: COL_A, b: COL_B, even: "var(--c-faint)" };
    return out.map((s) => ({ ...s, color: color[s.cat] }));
  }, [geo, lapA, lapB, n]);

  if (!geo) return null;
  const pts = (from, to) => {
    let out = "";
    for (let i = from; i <= to; i++) out += `${geo.px[i].toFixed(1)},${geo.py[i].toFixed(1)} `;
    return out;
  };
  const pick = (e) => {
    if (!onPick) return;
    const box = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - box.left) / box.width) * geo.W;
    const my = ((e.clientY - box.top) / box.height) * geo.H;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (geo.px[i] - mx) ** 2 + (geo.py[i] - my) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    onPick(best);
  };
  return (
    <svg viewBox={`0 0 ${geo.W} ${geo.H}`} className="h-full w-full cursor-crosshair" onClick={pick} aria-label="Track map, coloured by who gains where">
      {segs.map((sg, i) => (
        <polyline key={i} points={pts(sg.from, sg.to)} fill="none" stroke={sg.color}
          strokeWidth={sg.cat && sg.cat !== "even" ? 2.4 : 1.6} strokeLinecap="round" strokeLinejoin="round"
          vectorEffect="non-scaling-stroke" opacity={sg.cat === "even" ? 0.55 : 1} />
      ))}
      {(corners || []).map((c) => (
        <text key={c.apex} x={geo.px[c.apex]} y={geo.py[c.apex] - 2.5}
          className="fill-current font-mono text-light" fontSize="3.4" textAnchor="middle">
          T{c.n ?? ""}
        </text>
      ))}
      {cursor != null && cursor < n && (
        <circle cx={geo.px[cursor]} cy={geo.py[cursor]} r="1.8" fill="var(--c-text)" stroke="var(--c-bg)" strokeWidth="0.6" />
      )}
    </svg>
  );
}

const COL_A = "#0ea5e9"; // sky — lap A
const COL_B = "#f43f5e"; // rose — lap B

function TelemetryCompare() {
  const tracks = useApi(useCallback(() => api.telemetryTracks(), []));
  const [trackKey, setTrackKey] = useState("");
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [laps, setLaps] = useState(null);   // meta list for the track
  const [lapA, setLapA] = useState(null);   // full channels
  const [lapB, setLapB] = useState(null);
  const [cursor, setCursor] = useState(null); // slice index under the mouse

  const list = tracks.data?.tracks || [];
  // First track with laps preselects itself — an empty dropdown helps nobody.
  useEffect(() => {
    if (!trackKey && list.length) setTrackKey(list[0].trackKey);
  }, [list, trackKey]);

  useEffect(() => {
    setLaps(null); setLapA(null); setLapB(null); setAId(""); setBId(""); setCursor(null);
    if (!trackKey) return;
    let alive = true;
    api.telemetryLaps(trackKey).then((d) => {
      if (!alive) return;
      setLaps(d.laps);
      // The two fastest preselect: the card shows a real comparison at first
      // sight instead of two empty dropdowns.
      if (d.laps[0]) setAId(d.laps[0].steamId);
      if (d.laps[1]) setBId(d.laps[1].steamId);
    }).catch(() => alive && setLaps([]));
    return () => { alive = false; };
  }, [trackKey]);

  useEffect(() => {
    setLapA(null);
    if (!trackKey || !aId) return;
    let alive = true;
    api.telemetryLap(trackKey, aId).then((d) => alive && setLapA(d)).catch(() => {});
    return () => { alive = false; };
  }, [trackKey, aId]);
  useEffect(() => {
    setLapB(null);
    if (!trackKey || !bId) return;
    let alive = true;
    api.telemetryLap(trackKey, bId).then((d) => alive && setLapB(d)).catch(() => {});
    return () => { alive = false; };
  }, [trackKey, bId]);

  // Everything below draws from these two; n comes from lap A (both laps of a
  // track share it — the app's constant — but clamp to the shorter to be safe).
  const n = lapA && lapB ? Math.min(lapA.n, lapB.n) : lapA ? lapA.n : 0;
  const both = !!(lapA && lapB);

  // Delta: how far behind lap A the other lap is at every point of the track.
  const delta = useMemo(() => {
    if (!both) return null;
    const d = new Array(n);
    for (let i = 0; i < n; i++) d[i] = (lapB.t[i] - lapA.t[i]) / 1000;
    const maxAbs = Math.max(0.05, ...d.map(Math.abs));
    return { d, maxAbs };
  }, [both, lapA, lapB, n]);

  const speedHi = useMemo(() => {
    if (!lapA) return 100;
    const all = both ? [...lapA.speed, ...lapB.speed] : lapA.speed;
    return Math.max(...all) + 10;
  }, [lapA, lapB, both]);

  const steerAbs = useMemo(() => {
    if (!lapA) return 900;
    const all = both ? [...lapA.steer, ...lapB.steer] : lapA.steer;
    return Math.max(300, ...all.map(Math.abs));
  }, [lapA, lapB, both]);

  // Corners off lap A's speed trace, numbered in lap order; distance from its
  // recorded positions (metres), for "brakes 14 m later". Older laps recorded
  // before positions existed simply have no map and no metre figures.
  const corners = useMemo(
    () => (lapA ? detectCorners(lapA.speed.slice(0, n || lapA.n)).map((c, k) => ({ ...c, n: k + 1 })) : []),
    [lapA, n]
  );
  const dist = useMemo(
    () => (lapA?.x && lapA?.z ? cumulativeDist(lapA.x, lapA.z, n || lapA.n) : null),
    [lapA, n]
  );
  const insights = useMemo(
    () => (both && corners.length ? cornerInsights(lapA, lapB, corners, dist, n) : []),
    [both, lapA, lapB, corners, dist, n]
  );
  const hasMap = !!(lapA?.x && lapA?.z);

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    setCursor(Math.min(n - 1, Math.round(frac * (n - 1))));
  };

  const cursorLeft = cursor != null && n > 1 ? `${(cursor / (n - 1)) * 100}%` : null;
  const lapLabel = (l) => l ? `${l.name} — ${fmtLap(l.lapTimeMs) ?? "?"}${l.car ? ` · ${l.car}` : ""}` : "";

  return (
    <ToolCard
      title="Telemetry comparison"
      subtitle="Two drivers' fastest recorded laps at a track, throttle, brake and steering laid over each other."
    >
      {list.length === 0 ? (
        <p className="text-sm text-light">
          No laps recorded yet. The in-game <span className="font-semibold">nabsTelemetry</span> app sends
          your fastest clean lap per track here — ask an admin for the URL, drive a clean lap, come back.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Track">
              <select className="input" value={trackKey} onChange={(e) => setTrackKey(e.target.value)}>
                {list.map((t) => (
                  <option key={t.trackKey} value={t.trackKey}>
                    {t.track}{t.layout ? ` (${t.layout})` : ""} · {t.laps} {t.laps === 1 ? "lap" : "laps"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lap A">
              <select className="input" value={aId} onChange={(e) => setAId(e.target.value)}>
                {(laps || []).map((l) => (
                  <option key={l.steamId} value={l.steamId}>{l.name} · {fmtLap(l.lapTimeMs) ?? "?"}</option>
                ))}
              </select>
            </Field>
            <Field label="Lap B">
              <select className="input" value={bId} onChange={(e) => setBId(e.target.value)}>
                <option value="">—</option>
                {(laps || []).filter((l) => l.steamId !== aId).map((l) => (
                  <option key={l.steamId} value={l.steamId}>{l.name} · {fmtLap(l.lapTimeMs) ?? "?"}</option>
                ))}
              </select>
            </Field>
          </div>

          {lapA && (
            <>
              {/* legend + the numbers under the cursor */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: COL_A }} />{lapLabel(lapA)}</span>
                {lapB && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: COL_B }} />{lapLabel(lapB)}</span>}
                {cursor != null && (
                  <span className="ml-auto font-mono tabular-nums text-light">
                    {Math.round((cursor / (n - 1)) * 100)}% · {lapA.speed[cursor]} km/h
                    {both ? ` vs ${lapB.speed[cursor]} km/h · Δ ${delta.d[cursor] >= 0 ? "+" : ""}${delta.d[cursor].toFixed(2)}s` : ""}
                  </span>
                )}
              </div>

              {/* The map and the per-corner numbers, when the lap recorded its
                  positions. The map IS the racing line — coloured by who gains
                  where — and clicking it drops the cursor there, so map,
                  charts and corner list all point at the same spot. */}
              {(hasMap || insights.length > 0) && (
                <div className={`grid gap-4 ${hasMap && insights.length ? "lg:grid-cols-2" : ""}`}>
                  {hasMap && (
                    <div className="relative overflow-hidden rounded-lg border border-border bg-surface2/30 p-2" style={{ minHeight: 180 }}>
                      <TrackMap lapA={lapA} lapB={both ? lapB : null} n={n} corners={corners} cursor={cursor} onPick={setCursor} />
                      {both && (
                        <div className="pointer-events-none absolute bottom-1.5 right-2 flex gap-3 font-mono text-[10px] text-light">
                          <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full" style={{ background: COL_A }} />{lapA.name} faster</span>
                          <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded-full" style={{ background: COL_B }} />{lapB.name} faster</span>
                        </div>
                      )}
                    </div>
                  )}
                  {insights.length > 0 && (
                    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                      {insights.map((c) => {
                        const aGains = c.gainMs >= 0;
                        const winner = aGains ? lapA.name : lapB.name;
                        const col = aGains ? COL_A : COL_B;
                        // Only the differences big enough to mean something —
                        // a 1 km/h delta is noise wearing a label.
                        const clauses = [];
                        if (c.brakeDeltaM != null && Math.abs(c.brakeDeltaM) >= 3)
                          clauses.push(`${c.brakeDeltaM > 0 ? lapB.name : lapA.name} brakes ${Math.abs(c.brakeDeltaM)} m later`);
                        if (Math.abs(c.midDelta) >= 2)
                          clauses.push(`${c.midDelta > 0 ? lapB.name : lapA.name} +${Math.abs(c.midDelta)} km/h mid-corner`);
                        if (Math.abs(c.exitDelta) >= 2)
                          clauses.push(`${c.exitDelta > 0 ? lapB.name : lapA.name} +${Math.abs(c.exitDelta)} km/h on exit`);
                        return (
                          <button
                            key={c.n}
                            type="button"
                            onClick={() => setCursor(c.apex)}
                            className={`flex w-full items-baseline gap-2.5 px-3 py-2 text-left text-xs transition hover:bg-surface2 ${cursor != null && Math.abs(cursor - c.apex) < 12 ? "bg-surface2" : ""}`}
                          >
                            <span className="font-mono text-[10px] font-bold text-light">T{c.n}</span>
                            <span className="font-mono font-bold tabular-nums" style={{ color: col }}>
                              {winner} {c.gainMs >= 0 ? "+" : "+"}{(Math.abs(c.gainMs) / 1000).toFixed(2)}s
                            </span>
                            <span className="min-w-0 flex-1 truncate text-light">{clauses.join(" · ") || "even on the numbers — the gain is in the line"}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* All panels share one mouse surface so the cursor line runs
                  through every chart at once — that is what makes "he brakes
                  THERE and that is where the tenth goes" readable. */}
              <div className="relative cursor-crosshair select-none" onMouseMove={onMove} onMouseLeave={() => setCursor(null)}>
                <div className="space-y-3">
                  {both && delta && (
                    <TracePanel title={`Delta — ${lapB.name} behind ${lapA.name}`} unit={`±${delta.maxAbs.toFixed(2)}s`} height={72}>
                      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
                      <TraceSvg n={n} lines={[{ points: tracePoints(delta.d, -delta.maxAbs, delta.maxAbs), color: COL_B, width: 2 }]} />
                    </TracePanel>
                  )}
                  <TracePanel title="Speed" unit="km/h" height={110}>
                    <TraceSvg n={n} lines={[
                      { points: tracePoints(lapA.speed.slice(0, n), 0, speedHi), color: COL_A, width: 2 },
                      ...(both ? [{ points: tracePoints(lapB.speed.slice(0, n), 0, speedHi), color: COL_B, width: 2 }] : []),
                    ]} />
                  </TracePanel>
                  <TracePanel title="Throttle & brake" unit="%" height={90}>
                    <TraceSvg n={n} lines={[
                      { points: tracePoints(lapA.gas.slice(0, n), 0, 100), color: "#22c55e" },
                      { points: tracePoints(lapA.brake.slice(0, n), 0, 100), color: "#ef4444" },
                      ...(both ? [
                        { points: tracePoints(lapB.gas.slice(0, n), 0, 100), color: "#22c55e", dash: "5 4", opacity: 0.75 },
                        { points: tracePoints(lapB.brake.slice(0, n), 0, 100), color: "#ef4444", dash: "5 4", opacity: 0.75 },
                      ] : []),
                    ]} />
                  </TracePanel>
                  <TracePanel title="Steering" unit="deg" height={80}>
                    <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
                    <TraceSvg n={n} lines={[
                      { points: tracePoints(lapA.steer.slice(0, n), -steerAbs, steerAbs), color: COL_A },
                      ...(both ? [{ points: tracePoints(lapB.steer.slice(0, n), -steerAbs, steerAbs), color: COL_B, dash: "5 4", opacity: 0.85 }] : []),
                    ]} />
                  </TracePanel>
                </div>
                {cursorLeft && <div className="pointer-events-none absolute inset-y-0 w-px bg-dark/40" style={{ left: cursorLeft }} />}
              </div>
              {both && (
                <p className="text-xs text-faint">
                  Solid lines are {lapA.name}, dashed {lapB.name}. The delta reads "how far behind {lapA.name}"
                  — rising means losing time there, falling means gaining it.
                </p>
              )}
            </>
          )}
        </>
      )}
    </ToolCard>
  );
}

export default TelemetryCompare;
