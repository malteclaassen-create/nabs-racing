import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, telemetryTrackMapUrl } from "../api/client.js";
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
// The SLOW PARTS of a lap: everywhere the car went below 80% of that lap's own
// top speed, merged across short gaps and trimmed of anything too brief.
//
// These are not the circuit's corners and this file cannot know those. A corner
// taken flat never drops below the line and is invisible here; a lift for
// traffic or a mistake looks exactly like one; a chicane counts once; and the
// threshold moves with the lap's own top speed, so a slipstreamed lap finds a
// different set. They used to be numbered T1, T2, … on the map and in the list,
// which read as the circuit's numbering and is a thing a steward could act on
// and be standing in the wrong place. Each one now says how far into the lap it
// is, which is measured rather than guessed.
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
      // Where this is in the lap, which is a fact — unlike a corner number,
      // which this file is in no position to know (see detectCorners).
      atM: dist ? Math.round(dist[c.apex]) : null,
      atPct: Math.round((c.apex / (n - 1)) * 100),
      gainMs,
      // + = B brakes later than A.
      brakeDeltaM: bA != null && bB != null && dist ? Math.round(dist[bB] - dist[bA]) : null,
      midDelta: minB - minA, // + = B carries more mid-corner speed
      exitDelta: lapB.speed[e0] - lapA.speed[e0], // + = B exits faster
    };
  });
}

// The track, drawn from the lap itself: the recorded positions ARE the racing
// line, so no track files, no calibration. Two ways to read it, because they
// answer different questions and cannot share a picture:
//
//   gain   one line — lap A's — coloured by who is quicker along it.
//   lines  both laps' own paths, for "where do they actually drive
//          differently". Only worth looking at ZOOMED IN: over a whole lap the
//          two are a metre or two apart on a map at roughly 3 m per pixel, so
//          they sit exactly on top of each other. Zoomed to a corner it is
//          centimetres per pixel and the difference is the whole point.
//
// The zoom follows the cursor, which is wherever the reader last pointed —
// hovering a chart, clicking a row in the list, or the playback clock.
function TrackMap({ lapA, lapB, n, cursor, cursorB, onPick, mode = "gain", zoom = 1, track = null }) {
  // One projection, shared: both laps are in the same world coordinates, so
  // lap B has to be drawn through lap A's transform or the two would be laid
  // out independently and every difference between them would be invented by
  // the scaling.
  const geo = useMemo(() => {
    if (!lapA?.x || !lapA?.z) return null;

    // THE REAL TRACK, when the league's server manager publishes one. Assetto
    // Corsa ships an overhead map with each track and a map.ini saying how to
    // place a world coordinate on it — the same two files the live page draws
    // its cars with — and the laps here record the same world coordinates. So
    // the lines land inside the actual kerbs rather than floating in white.
    //
    // Positions are stored in DECIMETRES (a tenth of the game's unit), hence
    // the /10 before the ini's own arithmetic.
    if (track?.calib?.scaleFactor) {
      const { width, height, scaleFactor, xOffset, zOffset, padding } = track.calib;
      const pad = padding || 0;
      const projX = (v) => (v / 10 + xOffset) / scaleFactor + pad;
      const projY = (v) => (v / 10 + zOffset) / scaleFactor + pad;
      return {
        W: width,
        H: height,
        projX,
        projY,
        px: lapA.x.slice(0, n).map(projX),
        py: lapA.z.slice(0, n).map(projY),
        mPerUnit: scaleFactor,
        image: track.href,
      };
    }

    const xs = lapA.x.slice(0, n).map((v) => v / 10);
    const zs = lapA.z.slice(0, n).map((v) => v / 10);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const spanX = Math.max(1, maxX - minX), spanZ = Math.max(1, maxZ - minZ);
    const W = 100, pad = 6;
    const inner = W - 2 * pad;
    const H = Math.max(30, (spanZ / spanX) * 100 * (inner / W) + 2 * pad);
    const projX = (v) => pad + ((v / 10 - minX) / spanX) * inner;
    const projY = (v) => pad + ((v / 10 - minZ) / spanZ) * ((spanZ / spanX) * 100 * (inner / W));
    return {
      W,
      H,
      projX,
      projY,
      // Metres per map unit — the same in both axes by construction above, and
      // what the scale bar is drawn from. Nothing here stretches one axis: two
      // laps a metre apart are drawn a metre apart, which at whole-lap zoom is
      // a fraction of a pixel and at corner zoom is plain.
      mPerUnit: spanX / inner,
      image: null,
      px: lapA.x.slice(0, n).map(projX),
      py: lapA.z.slice(0, n).map(projY),
    };
  }, [lapA, n, track]);

  // Lap B through the same transform, from ITS OWN positions. Drawing it from
  // lap A's would put the second car on the first car's line, which is exactly
  // the thing this mode exists to disprove.
  const bxy = useMemo(() => {
    if (!geo || !lapB?.x || !lapB?.z) return null;
    return { px: lapB.x.slice(0, n).map(geo.projX), py: lapB.z.slice(0, n).map(geo.projY) };
  }, [geo, lapB, n]);

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
  const lines = mode === "lines" && bxy;
  const pts = (px, py, from, to) => {
    let out = "";
    for (let i = from; i <= to; i++) out += `${px[i].toFixed(1)},${py[i].toFixed(1)} `;
    return out;
  };
  // The camera: centred on the cursor when zoomed, on the whole track at 1x.
  const fx = cursor != null && cursor < n ? geo.px[cursor] : geo.W / 2;
  const fy = cursor != null && cursor < n ? geo.py[cursor] : geo.H / 2;
  const cam = zoom > 1 ? `translate(${geo.W / 2 - zoom * fx} ${geo.H / 2 - zoom * fy}) scale(${zoom})` : undefined;

  const pick = (e) => {
    if (!onPick) return;
    const box = e.currentTarget.getBoundingClientRect();
    // Undo the camera, or a click while zoomed lands wherever that point would
    // have been at 1x — which is somewhere else entirely.
    let mx = ((e.clientX - box.left) / box.width) * geo.W;
    let my = ((e.clientY - box.top) / box.height) * geo.H;
    if (zoom > 1) {
      mx = (mx - (geo.W / 2 - zoom * fx)) / zoom;
      my = (my - (geo.H / 2 - zoom * fy)) / zoom;
    }
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (geo.px[i] - mx) ** 2 + (geo.py[i] - my) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    onPick(best);
  };

  // Everything drawn in map units below — the cursor dot, the scale bar, its
  // label — was sized for the 100-unit box this map used to invent for itself.
  // A real track map's box is its PNG's pixel size, 1680 wide for the Red Bull
  // Ring, and at that scale the same numbers are a seventeenth of the size they
  // were meant to be. So they are expressed against the frame instead.
  const u = geo.W / 100;

  // A round number of metres, sized to about a quarter of the frame, drawn
  // OUTSIDE the camera so it stays put and stays readable. Without it "the
  // lines are this far apart" is a feeling; with it, it is a measurement.
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const barM = nice.find((m) => (m / geo.mPerUnit) * zoom >= 18 * u) ?? nice[nice.length - 1];
  const barUnits = (barM / geo.mPerUnit) * zoom;

  return (
    <svg
      viewBox={`0 0 ${geo.W} ${geo.H}`}
      className="h-full w-full cursor-crosshair"
      onClick={pick}
      aria-label={lines ? "Track map, both racing lines" : "Track map, coloured by who gains where"}
    >
      <g transform={cam}>
        {/* The outline first, everything else over it. Slightly held back so
            two thin coloured lines stay the thing being read. */}
        {geo.image && (
          <image href={geo.image} x={0} y={0} width={geo.W} height={geo.H} opacity={0.5} preserveAspectRatio="none" />
        )}
        {lines ? (
          <>
            <polyline points={pts(geo.px, geo.py, 0, n - 1)} fill="none" stroke={COL_A} strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <polyline points={pts(bxy.px, bxy.py, 0, n - 1)} fill="none" stroke={COL_B} strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          segs.map((sg, i) => (
            <polyline key={i} points={pts(geo.px, geo.py, sg.from, sg.to)} fill="none" stroke={sg.color}
              strokeWidth={sg.cat && sg.cat !== "even" ? 2.4 : 1.6} strokeLinecap="round" strokeLinejoin="round"
              vectorEffect="non-scaling-stroke" opacity={sg.cat === "even" ? 0.55 : 1} />
          ))
        )}
        {/* One dot while a hand is on the chart — both laps are at the same
            place on the track there, because the charts are drawn by position.
            Two while it plays, each in its own colour and each on its OWN line:
            that gap IS the delta, and watching it open is the thing a number
            cannot show. */}
        {cursorB != null && cursorB < n && (
          <circle
            cx={(lines && bxy ? bxy.px : geo.px)[cursorB]}
            cy={(lines && bxy ? bxy.py : geo.py)[cursorB]}
            r={(1.8 * u) / zoom}
            fill={COL_B}
            stroke="var(--c-bg)"
            strokeWidth={(0.6 * u) / zoom}
          />
        )}
        {cursor != null && cursor < n && (
          <circle
            cx={geo.px[cursor]}
            cy={geo.py[cursor]}
            r={(1.8 * u) / zoom}
            fill={cursorB != null || lines ? COL_A : "var(--c-text)"}
            stroke="var(--c-bg)"
            strokeWidth={(0.6 * u) / zoom}
          />
        )}
      </g>
      {barUnits <= geo.W * 0.6 && (
        <g>
          <line
            x1={4 * u}
            y1={geo.H - 4 * u}
            x2={4 * u + barUnits}
            y2={geo.H - 4 * u}
            stroke="var(--c-text)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            opacity={0.5}
          />
          <text x={4 * u} y={geo.H - 5.5 * u} fontSize={3 * u} className="fill-current text-light" opacity={0.75}>
            {barM} m
          </text>
        </g>
      )}
    </svg>
  );
}

// The live map's zoom buttons, to the pixel: the same control in two places on
// the site should not be two different controls.
const ZOOM_BTN =
  "flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 font-mono text-sm font-bold text-white backdrop-blur transition hover:bg-black/75";

// Put a lap on another lap's grid.
//
// Every channel is sampled at i/(n-1) of the way round the track, so two laps
// only line up slice-for-slice while they share n. The store deliberately
// accepts 50 to 1500 samples so the in-game script can be tweaked without a
// lockstep deploy — which means the day that number changes, one lap in a
// comparison has 800 slices and the other 1000, and index 400 is a different
// CORNER in each. Nothing would have said so: the delta, the corner list and
// the map colours would all have been quietly wrong.
//
// Linear interpolation between the neighbouring slices, which is exact enough
// for channels already smoothed over a car length.
function resampleLap(lap, n) {
  if (!lap || lap.n === n) return lap;
  const keys = ["t", "speed", "gas", "brake", "steer", "gear", "x", "z"];
  const out = { ...lap, n, resampledFrom: lap.n };
  for (const k of keys) {
    const src = lap[k];
    if (!Array.isArray(src) || src.length < 2) continue;
    const dst = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = (i / (n - 1)) * (src.length - 1);
      const lo = Math.floor(p);
      const hi = Math.min(src.length - 1, lo + 1);
      dst[i] = src[lo] + (src[hi] - src[lo]) * (p - lo);
    }
    out[k] = dst;
  }
  return out;
}

const COL_A = "#0ea5e9"; // sky — lap A
const COL_B = "#f43f5e"; // rose — lap B

// Where a lap had got to after `ms`. The channels are sampled by track
// POSITION, so this is the one place that has to think in time: it walks the
// lap's own time channel, from a hint index, because playback only ever moves
// forward and rescanning 800 slices sixty times a second for two laps is work
// nobody needs.
function indexAtTime(lap, ms, n, hint = 0) {
  let i = Math.max(0, Math.min(hint, n - 1));
  while (i < n - 1 && lap.t[i] < ms) i++;
  return i;
}

// One dropdown value naming one lap: driver, then which of their laps.
const pickOf = (l) => `${l.steamId}:${l.lapId}`;
const splitPick = (v) => {
  const cut = String(v || "").indexOf(":");
  return cut === -1 ? [v, null] : [v.slice(0, cut), v.slice(cut + 1)];
};

// "Neesh · 1:31.010" when it is their only lap here, "Neesh · 1:31.010 (2nd)"
// when it is not — otherwise a driver appears three times in the list with
// nothing to tell the rows apart but a time nobody has memorised.
const ORDINAL = ["best", "2nd", "3rd"];
function lapRows(laps) {
  const seen = new Map();
  return (laps || []).map((l) => {
    const n = seen.get(l.steamId) || 0;
    seen.set(l.steamId, n + 1);
    return { ...l, rank: n, only: (laps || []).filter((x) => x.steamId === l.steamId).length === 1 };
  });
}

function TelemetryCompare() {
  const tracks = useApi(useCallback(() => api.telemetryTracks(), []));
  const [trackKey, setTrackKey] = useState("");
  // A driver has up to three laps here, so the dropdowns are keyed on the LAP:
  // "<steamId>:<lapId>". Keyed on the driver, as they were when everybody had
  // exactly one, React drew three <option>s with the same value and the
  // selection jumped to whichever came first.
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [laps, setLaps] = useState(null);   // meta list for the track
  const [lapA, setLapA] = useState(null);   // full channels
  const [lapBRaw, setLapB] = useState(null);
  const [cursor, setCursor] = useState(null); // slice index under the mouse
  // Playback. `bIdx` is where the OTHER lap is at the same moment in time —
  // which is not the same place on the track, and that is the whole point: the
  // two dots pull apart exactly as much as the delta says.
  const [playing, setPlaying] = useState(false);
  const [bIdx, setBIdx] = useState(null);
  // "gain" = one line, coloured by who is quicker. "lines" = both paths, which
  // only says anything zoomed in (see TrackMap). Switching to it zooms, because
  // at 1x the answer is "they are identical" and that is an artefact of the
  // scale rather than a fact about the driving.
  // The track's real outline, when there is one. `null` means "asked and there
  // is none", which is a normal answer for anything raced off the league's own
  // servers — the map then draws the lap's own shape, as it always did.
  const [track, setTrack] = useState(null); // { calib, href }
  const [mapMode, setMapMode] = useState("gain");
  const [zoom, setZoom] = useState(1);

  // Zooming needs somewhere to point. The camera centres on the cursor, and
  // with no cursor it centred on the middle of the bounding box — which on a
  // closed circuit is the infield, so the first zoom showed an empty white
  // square.
  //
  // Where it points when nobody has chosen: the place the two laps differ MOST,
  // which is the reason somebody pressed the button. Failing that the first
  // slow part of the lap, and failing that the line itself.
  const focusSomewhere = useCallback(() => {
    setCursor((c) => {
      if (c != null) return c;
      const worst = [...insightsRef.current].sort((x, y) => Math.abs(y.gainMs) - Math.abs(x.gainMs))[0];
      return worst?.apex ?? cornersRef.current[0]?.apex ?? 0;
    });
  }, []);

  const list = tracks.data?.tracks || [];
  // Which season these laps are from. The endpoint answers with it rather than
  // the page assuming: a reader who has not touched the season switcher is
  // looking at the season running now, and should be told which that is —
  // otherwise an empty list after a season change looks like a broken feature
  // rather than a fresh start.
  const season = tracks.data?.season;
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
      if (d.laps[0]) setAId(pickOf(d.laps[0]));
      if (d.laps[1]) setBId(pickOf(d.laps[1]));
    }).catch(() => alive && setLaps([]));
    return () => { alive = false; };
  }, [trackKey]);

  useEffect(() => {
    setLapA(null);
    if (!trackKey || !aId) return;
    let alive = true;
    api.telemetryLap(trackKey, ...splitPick(aId)).then((d) => alive && setLapA(d)).catch(() => {});
    return () => { alive = false; };
  }, [trackKey, aId]);
  useEffect(() => {
    setLapB(null);
    if (!trackKey || !bId) return;
    let alive = true;
    api.telemetryLap(trackKey, ...splitPick(bId)).then((d) => alive && setLapB(d)).catch(() => {});
    return () => { alive = false; };
  }, [trackKey, bId]);

  // Everything below draws from these two; n comes from lap A (both laps of a
  // track share it — the app's constant — but clamp to the shorter to be safe).
  // Lap A's grid is the grid; lap B is moved onto it when the two differ.
  const n = lapA?.n || 0;
  const lapB = useMemo(() => (lapBRaw && lapA ? resampleLap(lapBRaw, lapA.n) : lapBRaw), [lapBRaw, lapA]);
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
  const cornersRef = useRef([]);
  const insightsRef = useRef([]);
  const corners = useMemo(
    () => (lapA ? detectCorners(lapA.speed.slice(0, n || lapA.n)).map((c, k) => ({ ...c, n: k + 1 })) : []),
    [lapA, n]
  );
  cornersRef.current = corners;
  const dist = useMemo(
    () => (lapA?.x && lapA?.z ? cumulativeDist(lapA.x, lapA.z, n || lapA.n) : null),
    [lapA, n]
  );
  const insights = useMemo(
    () => (both && corners.length ? cornerInsights(lapA, lapB, corners, dist, n) : []),
    [both, lapA, lapB, corners, dist, n]
  );
  insightsRef.current = insights;
  const hasMap = !!(lapA?.x && lapA?.z);

  const onMove = (e) => {
    // A hand on the chart wins over the clock — otherwise the two fight over
    // the cursor and it stutters between them.
    if (playing) {
      setPlaying(false);
      setBIdx(null);
    }
    const box = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    setCursor(Math.min(n - 1, Math.round(frac * (n - 1))));
  };

  // Real time, not frames: a slow machine plays the lap slower, it does not
  // play a different lap. Stops itself at the flag.
  useEffect(() => {
    if (!playing || !lapA) return undefined;
    const end = Math.max(lapA.lapTimeMs, both ? lapB.lapTimeMs : 0);
    let raf = 0;
    let last = null;
    let elapsed = 0;
    let hintA = 0;
    let hintB = 0;
    const step = (ts) => {
      if (last == null) last = ts;
      elapsed += ts - last;
      last = ts;
      if (elapsed >= end) {
        setPlaying(false);
        return;
      }
      hintA = indexAtTime(lapA, elapsed, n, hintA);
      setCursor(hintA);
      if (both) {
        hintB = indexAtTime(lapB, elapsed, n, hintB);
        setBIdx(hintB);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, lapA, lapB, both, n]);

  useEffect(() => {
    let alive = true;
    let href = null;
    setTrack(null);
    if (!trackKey) return undefined;
    api
      .telemetryTrackMap(trackKey)
      .then(async (calib) => {
        href = await telemetryTrackMapUrl(calib.url);
        if (alive && href) setTrack({ calib, href });
      })
      .catch(() => {});
    return () => {
      alive = false;
      // The blob is this component's; nothing else can reach it once the track
      // changes, and an unreleased one is a leak per switch.
      if (href) URL.revokeObjectURL(href);
    };
  }, [trackKey]);

  // Changing either lap ends the run: the cursor it left behind belongs to a
  // lap that is no longer on screen. The camera goes back out too — a corner
  // of one lap is not a corner of the next.
  useEffect(() => {
    setPlaying(false);
    setBIdx(null);
    setMapMode("gain");
    setZoom(1);
  }, [aId, bId, trackKey]);

  const rows = lapRows(laps);
  // Comparing a driver against themselves is half of what three laps are for,
  // and it made the delta read "Maltegoat behind Maltegoat". When both laps
  // belong to one person, their times do the naming instead.
  const sameDriver = lapA && lapB && lapA.steamId === lapB.steamId;
  const sideName = (l) => (sameDriver ? fmtLap(l.lapTimeMs) ?? "?" : l.name);
  const cursorLeft = cursor != null && n > 1 ? `${(cursor / (n - 1)) * 100}%` : null;
  const lapLabel = (l) => l ? `${l.name} · ${fmtLap(l.lapTimeMs) ?? "?"}${l.car ? ` · ${l.car}` : ""}` : "";

  return (
    <ToolCard
      title="Telemetry comparison"
      subtitle={`Two laps laid over each other${season ? ` · Season ${season}` : ""}`}
    >
      {list.length === 0 ? (
        <p className="text-sm text-light">
          Nothing recorded{season ? ` in Season ${season}` : ""} yet. Laps arrive from the race server as
          drivers set them. Every season starts empty, because the cars change with it.
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
                {rows.map((l) => (
                  <option key={pickOf(l)} value={pickOf(l)}>
                    {l.name} · {fmtLap(l.lapTimeMs) ?? "?"}{l.only ? "" : ` (${ORDINAL[l.rank] || l.rank + 1})`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lap B">
              <select className="input" value={bId} onChange={(e) => setBId(e.target.value)}>
                <option value="">No second lap</option>
                {/* Only the lap already chosen as A is excluded, not the rest
                    of that driver's — comparing your own two laps against each
                    other is half of what three laps are for. */}
                {rows.filter((l) => pickOf(l) !== aId).map((l) => (
                  <option key={pickOf(l)} value={pickOf(l)}>
                    {l.name} · {fmtLap(l.lapTimeMs) ?? "?"}{l.only ? "" : ` (${ORDINAL[l.rank] || l.rank + 1})`}
                  </option>
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
                <button
                  type="button"
                  className="font-mono text-[11px] font-bold uppercase tracking-wider text-link transition hover:text-dark"
                  onClick={() => {
                    setBIdx(null);
                    setCursor(0);
                    setPlaying((p) => !p);
                  }}
                >
                  {playing ? "Stop" : "Play lap"}
                </button>
                {cursor != null && (
                  <span className="ml-auto font-mono tabular-nums text-light">
                    {Math.round((cursor / (n - 1)) * 100)}% · {lapA.speed[cursor]} km/h
                    {both ? ` vs ${lapB.speed[cursor]} km/h · Δ ${delta.d[cursor] >= 0 ? "+" : ""}${delta.d[cursor].toFixed(2)}s` : ""}
                  </span>
                )}
              </div>

              {/* The map and the slow parts of the lap, when it recorded its
                  positions. The map IS the racing line — coloured by who gains
                  where — and clicking it drops the cursor there; clicking a row
                  in the list does the same, which is what ties the two together
                  now that nothing is numbered. */}
              {(hasMap || insights.length > 0) && (
                <div className={`grid gap-4 ${hasMap && insights.length ? "lg:grid-cols-2" : ""}`}>
                  {hasMap && (
                    <div className="relative overflow-hidden rounded-lg border border-border bg-surface2/30 p-2" style={{ minHeight: 180 }}>
                      <TrackMap
                        lapA={lapA}
                        lapB={both ? lapB : null}
                        n={n}
                        cursor={cursor}
                        cursorB={bIdx}
                        onPick={setCursor}
                        mode={both ? mapMode : "gain"}
                        zoom={zoom}
                        track={track}
                      />
                      {/* What the map is answering. Two questions, one picture
                          each: they cannot share one, because the lines only
                          separate under a zoom the gain colours do not need. */}
                      {both && (
                        <div className="absolute left-2 top-2 flex overflow-hidden rounded-lg border border-border bg-card/90 text-[10px] font-bold uppercase tracking-wider backdrop-blur">
                          {[
                            ["gain", "Who gains"],
                            ["lines", "Racing lines"],
                          ].map(([key, label]) => (
                            <button
                              key={key}
                              type="button"
                              className={`px-2 py-1 font-mono transition ${
                                mapMode === key ? "bg-brand/15 text-dark" : "text-light hover:text-dark"
                              }`}
                              onClick={() => {
                                setMapMode(key);
                                // Straight to a useful magnification: at 1x the
                                // two lines are sub-pixel apart and the mode
                                // looks broken.
                                if (key === "lines" && zoom < 4) {
                                  focusSomewhere();
                                  setZoom(5);
                                }
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                      {/* Same controls as the live map, same place, same feel. */}
                      <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                        <button
                          type="button"
                          className={ZOOM_BTN}
                          title="Zoom out"
                          onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
                        >
                          &minus;
                        </button>
                        <button
                          type="button"
                          className={ZOOM_BTN}
                          title="Zoom in"
                          onClick={() => {
                            focusSomewhere();
                            setZoom((z) => Math.min(20, z * 1.5));
                          }}
                        >
                          +
                        </button>
                      </div>
                      {/* Only in the mode it describes. In "racing lines" the
                          colours are the drivers, not who is quicker, so this
                          would have been a legend for a thing not on screen —
                          and it sat under the zoom buttons besides. */}
                      {both && mapMode === "gain" && (
                        <div className="pointer-events-none absolute right-2 top-2 flex gap-3 font-mono text-[10px] text-light">
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
                            <span className="font-mono text-[10px] font-bold tabular-nums text-light">
                              {c.atM != null ? `${c.atM.toLocaleString("en-GB")} m` : `${c.atPct}%`}
                            </span>
                            <span className="font-mono font-bold tabular-nums" style={{ color: col }}>
                              {winner} {c.gainMs >= 0 ? "+" : "+"}{(Math.abs(c.gainMs) / 1000).toFixed(2)}s
                            </span>
                            <span className="min-w-0 flex-1 truncate text-light">{clauses.join(" · ") || "even on the numbers, so the gain is in the line"}</span>
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
                    <TracePanel title={`Delta · ${sideName(lapB)} behind ${sideName(lapA)}`} unit={`±${delta.maxAbs.toFixed(2)}s`} height={72}>
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
                  Solid {sideName(lapA)}, dashed {sideName(lapB)}. The delta is how far behind{" "}
                  {sideName(lapA)} the other lap is. Rising means losing time there, falling means
                  gaining it.
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
