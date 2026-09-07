import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, telemetryTrackMapUrl } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { Field } from "./ui.jsx";
import { fmtLap } from "../utils/format.js";
import { ChannelChart, CursorReadout, LapSummary, lapColor } from "./TelemetryCharts.jsx";
import { fitTelemetryWindow } from "../utils/telemetryWindow.js";
import TelemetryTrackMap from "./TelemetryTrackMap.jsx";
import { sampleAtTime } from "../utils/telemetryGeometry.js";

// The card shell this was drawn in on the Tools page. Ten presentational lines,
// copied rather than imported: reaching into pages/Tools.jsx for it would pull
// the whole race-prep page into the admin bundle to borrow a border.
function ToolCard({ id, title, subtitle, children }) {
  return (
    <div id={id} className="card overflow-hidden">
      <div className="border-b border-border bg-surface2/50 px-5 py-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-light">{subtitle}</p>}
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </div>
  );
}

// The recorder samples channels by track position. Each driver's three fastest
// clean laps can be compared on that shared axis; resampleLap aligns older
// recordings with a different sample count before calculating differences.

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
      start: s0,
      end: e0,
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
      dst[i] = k === "gear" ? src[lo] : src[lo] + (src[hi] - src[lo]) * (p - lo);
    }
    out[k] = dst;
  }
  return out;
}

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
  const [motionA, setMotionA] = useState(null);
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
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [aError, setAError] = useState(null);
  const [bError, setBError] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [chartRange, setChartRange] = useState(null);
  const selections = useRef({ aId, bId });
  selections.current = { aId, bId };

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
    if (tracks.data && !list.some((t) => t.trackKey === trackKey)) setTrackKey(list[0]?.trackKey || "");
  }, [list, trackKey, tracks.data]);

  useEffect(() => {
    setLaps(null); setLapA(null); setLapB(null); setAId(""); setBId(""); setCursor(null);
    setLoadError(null);
    setZoom(1);
  }, [trackKey]);

  useEffect(() => {
    if (!trackKey) return;
    let alive = true;
    setLoadError(null);
    api.telemetryLaps(trackKey).then((d) => {
      if (!alive) return;
      setLaps(d.laps);
      if (!d.laps.length) { setAId(""); setBId(""); return; }
      const selected = selections.current;
      const a = d.laps.find((l) => pickOf(l) === selected.aId) || d.laps[0];
      if (a) setAId(pickOf(a));
      const b = d.laps.find((l) => pickOf(l) === selected.bId && pickOf(l) !== pickOf(a));
      const alternative = d.laps.find((l) => l.car === a?.car && l.steamId !== a?.steamId)
        || d.laps.find((l) => l.car === a?.car && pickOf(l) !== pickOf(a));
      // A manual refresh keeps an intentional single-lap selection.
      setBId(b ? pickOf(b) : selected.aId ? "" : alternative ? pickOf(alternative) : "");
    }).catch((e) => alive && setLoadError(e.message || "Could not load the laps."));
    return () => { alive = false; };
  }, [trackKey, revision]);

  useEffect(() => {
    setLapA(null);
    setAError(null);
    if (!trackKey || !aId) return;
    let alive = true;
    api.telemetryLap(trackKey, ...splitPick(aId)).then((d) => alive && setLapA(d)).catch((e) => alive && setAError(e.message || "Could not load lap A."));
    return () => { alive = false; };
  }, [trackKey, aId, revision]);
  useEffect(() => {
    setLapB(null);
    setBError(null);
    if (!trackKey || !bId) return;
    let alive = true;
    api.telemetryLap(trackKey, ...splitPick(bId)).then((d) => alive && setLapB(d)).catch((e) => alive && setBError(e.message || "Could not load lap B."));
    return () => { alive = false; };
  }, [trackKey, bId, revision]);

  // Lap A's grid is the grid; lap B is moved onto it when the two differ.
  const n = lapA?.n || 0;
  const lapB = useMemo(() => (lapBRaw && lapA ? resampleLap(lapBRaw, lapA.n) : lapBRaw), [lapBRaw, lapA]);
  const both = !!(lapA && lapB);
  const colorA=lapColor(lapA,'A'), colorB=lapColor(lapB,'B');
  const visibleRange = chartRange ? fitTelemetryWindow(...chartRange, n - 1) : [0, Math.max(1, n - 1)];
  const chartSpan = visibleRange[1] - visibleRange[0];
  const chartZoomed = chartSpan < n - 1;

  // Map picks, the position slider and playback keep the same magnification
  // when they take the cursor outside the currently visible section.
  useEffect(() => {
    if (!chartRange || cursor == null || n < 2) return;
    if (cursor < chartRange[0] || cursor > chartRange[1]) {
      const half = (chartRange[1] - chartRange[0]) / 2;
      setChartRange(fitTelemetryWindow(cursor - half, cursor + half, n - 1));
    }
  }, [cursor, chartRange, n]);

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
    return Math.ceil(Math.max(...all) / 50) * 50;
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

  const pickCursor = (index) => {
    setPlaying(false);
    setBIdx(null);
    setMotionA(null);
    setCursor(index);
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
      elapsed += (ts - last) * playbackRate;
      last = ts;
      if (elapsed >= end) {
        setPlaying(false);
        setCursor(n - 1);
        setBIdx(null);
        setMotionA(null);
        return;
      }
      hintA = indexAtTime(lapA, elapsed, n, hintA);
      setCursor(hintA);
      setMotionA(sampleAtTime(lapA.t, elapsed, hintA));
      if (both) {
        hintB = indexAtTime(lapB, elapsed, n, hintB);
        setBIdx(sampleAtTime(lapB.t, elapsed, hintB));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, lapA, lapB, both, n, playbackRate]);

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
        else if (href) URL.revokeObjectURL(href);
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
    setMotionA(null);
    setMapMode("gain");
    setZoom(1);
    setCursor(null);
    setChartRange(null);
  }, [aId, bId, trackKey]);

  const rows = lapRows(laps);
  const at = Math.max(0, Math.min(n - 1, cursor ?? 0));
  const gap = both ? (lapB.lapTimeMs - lapA.lapTimeMs) / 1000 : null;
  const applyChartRange = (next, index) => {
    setChartRange(next);
    pickCursor(Math.max(next[0], Math.min(next[1], index)));
  };
  const selectChartRange = (from, to) => {
    const next = fitTelemetryWindow(from, to, n - 1);
    applyChartRange(next, Math.round((next[0] + next[1]) / 2));
  };
  const zoomCharts = (factor) => {
    const focus = cursor == null ? Math.round((visibleRange[0] + visibleRange[1]) / 2) : at;
    const half = chartSpan / factor / 2;
    applyChartRange(fitTelemetryWindow(focus - half, focus + half, n - 1), focus);
  };
  const panCharts = (start) => applyChartRange([start, start + chartSpan], at + start - visibleRange[0]);
  const resetCharts = () => setChartRange(null);
  const chartProps = { cursor: at, onPick: pickCursor, range: visibleRange, onSelectRange: selectChartRange, onResetRange: resetCharts, colorA, colorB };
  const error = tracks.error || loadError || aError || bError;
  const refresh = () => { tracks.reload(); setRevision((v) => v + 1); };
  const changeA = (id) => {
    if (id === bId) setBId(aId);
    setAId(id);
  };
  const readable = (value) => String(value || '').replaceAll('_', ' ');

  return (
    <ToolCard id="telemetry" title="Lap comparison" subtitle={season ? `Season ${season}` : null}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-light">Both laps aligned by track position.</p>
        <button type="button" className="btn-secondary text-xs" onClick={refresh} disabled={tracks.loading}>Refresh laps</button>
      </div>
      {error && <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{error} <button type="button" className="ml-2 underline" onClick={refresh}>Try again</button></div>}
      {tracks.loading && !tracks.data ? <p role="status" className="py-6 text-sm text-light">Loading recorded tracks…</p>
        : !list.length && !error ? <p className="py-6 text-sm text-light">No laps recorded{season ? ` in Season ${season}` : ''} yet. Refresh after a driver completes a clean lap.</p>
        : list.length > 0 && <>
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <Field label="Track">
              <select aria-label="Track" className="input min-w-0 w-full" value={trackKey} onChange={(e) => setTrackKey(e.target.value)}>
                {list.map((t) => <option key={t.trackKey} value={t.trackKey}>{readable(t.track)}{t.layout ? ` · ${readable(t.layout)}` : ''} · {t.laps} laps</option>)}
              </select>
            </Field>
            <Field label="Lap A · reference">
              <select aria-label="Lap A" className="input min-w-0 w-full" value={aId} onChange={(e) => changeA(e.target.value)}>
                {!rows.length && <option value="">{laps === null ? 'Loading laps…' : 'No laps available'}</option>}
                {rows.map((l) => <option key={pickOf(l)} value={pickOf(l)}>{l.name} · {fmtLap(l.lapTimeMs)}{l.only ? '' : ` (${ORDINAL[l.rank] || l.rank + 1})`}</option>)}
              </select>
            </Field>
            <Field label="Lap B · comparison">
              <select aria-label="Lap B" className="input min-w-0 w-full" value={bId} onChange={(e) => setBId(e.target.value)}>
                <option value="">Single lap · no comparison</option>
                {rows.filter((l) => pickOf(l) !== aId).map((l) => <option key={pickOf(l)} value={pickOf(l)}>{l.name} · {fmtLap(l.lapTimeMs)}{l.only ? '' : ` (${ORDINAL[l.rank] || l.rank + 1})`}</option>)}
              </select>
            </Field>
          </div>
          {!error && (laps === null || (aId && !lapA) || (bId && !lapB)) && <p role="status" className="py-4 text-sm text-light">Loading lap channels…</p>}
          {!error && laps?.length === 0 && <p className="py-4 text-sm text-light">No laps are currently available for this track. Refresh or select another track.</p>}
          {lapA && <>
            <div className="grid grid-cols-2 gap-4 border-y border-border sm:grid-cols-3">
              <LapSummary lap={lapA} side="A" />
              <LapSummary lap={lapB} side="B" />
              <div className="col-span-2 flex flex-col justify-center py-3 sm:col-span-1">
                <p className="text-xs font-semibold text-light">Finish-line gap</p>
                <p className="mt-2 font-display text-3xl font-extrabold tabular-nums text-dark">{gap == null ? '—' : `${Math.abs(gap).toFixed(3)} s`}</p>
                <p className="mt-2 text-xs text-light">{gap == null ? 'Choose lap B to see the difference.' : gap === 0 ? 'Same recorded lap time' : `Lap ${gap > 0 ? 'A' : 'B'} is quicker`}</p>
                {both && <button type="button" className="mt-3 self-start text-xs font-semibold text-link hover:underline" onClick={() => { setAId(bId); setBId(aId); }}>Swap A / B ↔</button>}
              </div>
            </div>
            {both && lapA.car !== lapB.car && <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">Different cars selected. Vehicle performance also affects this comparison.</p>}
            <div className={`grid min-w-0 gap-4 ${hasMap ? 'md:grid-cols-[minmax(0,1.6fr)_minmax(220px,1fr)]' : ''}`}>
              {hasMap && <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface2/30">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <h3 className="text-xs font-semibold text-dark">Track position</h3>
                  {both && <div className="flex gap-1">{[['gain', 'Time gain'], ['lines', 'Racing lines']].map(([key, label]) => <button key={key} type="button" aria-pressed={mapMode === key}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${mapMode === key ? 'bg-brand/15 text-dark' : 'text-light hover:bg-surface2'}`}
                    onClick={() => { setMapMode(key); if (key === 'lines' && zoom < 20) { focusSomewhere(); setZoom(30); } }}>{label}</button>)}</div>}
                </div>
                <div className="relative h-[320px] sm:h-[360px]">
                  <TelemetryTrackMap lapA={lapA} lapB={lapB} n={n} cursor={at} cursorB={bIdx} motionA={motionA} onPick={pickCursor} onReset={()=>setZoom(1)} mode={mapMode} zoom={zoom} track={track} colorA={colorA} colorB={colorB}/>
                </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border px-3 py-2">
                    <button type="button" className={ZOOM_BTN + ' w-auto px-2 text-[10px]'} onClick={() => setZoom(1)} aria-label="Show whole track">Reset</button>
                    <button type="button" className={ZOOM_BTN + ' w-auto px-2 text-[10px]'} onClick={() => {focusSomewhere();setZoom(30);setMapMode('lines');}}>Corner</button>
                    <button type="button" className={ZOOM_BTN + ' w-auto px-2 text-[10px]'} onClick={() => {focusSomewhere();setZoom(120);setMapMode('lines');}}>Close-up</button>
                    <button type="button" className={ZOOM_BTN} aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
                    <button type="button" className={ZOOM_BTN} aria-label="Zoom in" onClick={() => { focusSomewhere(); setZoom((z) => Math.min(240, z * 1.5)); }}>+</button>
                  </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-light"><span><span style={{color:colorA}}>━ A</span> · {both&&mapMode==='gain'?'gains time':'solid'}</span>{both&&<span><span style={{color:colorB}}>{mapMode==='gain'?'━ B':'┄ B'}</span> · {mapMode==='gain'?'gains time':'dashed'}</span>}<span>{zoom>1?'Drag to pan · double-click to reset':'Select a point on the line'}</span></div>
              </div>}
              <CursorReadout lapA={lapA} lapB={lapB} cursor={at} />
            </div>
            <div className="border-y border-border px-1 py-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button type="button" className="btn-secondary text-xs" onClick={() => { setBIdx(null); setMotionA(null); if (!playing) setCursor(0); setPlaying((p) => !p); }}>{playing ? 'Stop playback' : '▶ Play lap'}</button>
                  <select aria-label="Playback speed" className="rounded-md border border-border bg-card px-2 py-1 text-xs text-dark" value={playbackRate} onChange={(e) => { setPlaying(false); setBIdx(null); setMotionA(null); setPlaybackRate(Number(e.target.value)); }}>
                    {[0.5, 1, 2, 4].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
                  </select>
                </div>
                <span className="font-mono text-xs tabular-nums text-light">{(at / (n - 1) * 100).toFixed(1)}% of lap{dist ? ` · ≈${Math.round(dist[at]).toLocaleString('en-GB')} m driven by A` : ''}</span>
              </div>
              <input type="range" aria-label="Position around the lap" aria-valuetext={`${(at / (n - 1) * 100).toFixed(1)} percent of lap`} min="0" max={n - 1} step="1" value={at} onChange={(e) => pickCursor(Number(e.target.value))} className="block w-full cursor-pointer accent-primary" />
              <div className="mt-1 flex justify-between text-[10px] text-light"><span>Start</span><span>Drag to inspect · arrow keys work too</span><span>Finish</span></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <h3 className="font-display text-lg font-bold text-dark">Lap traces</h3>
              <div className="flex gap-4 text-xs"><span className="flex items-center gap-2 text-light"><span className="w-5 border-t-2" style={{ borderColor: colorA }} />A · solid</span>{both && <span className="flex items-center gap-2 text-light"><span className="w-5 border-t-2 border-dashed" style={{ borderColor: colorB }} />B · dashed</span>}</div>
            </div>
            <div className="space-y-2 border-b border-border pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-2 text-xs font-semibold text-light">Zoom</span>
                  <button type="button" className="btn-secondary px-3 py-1 text-sm disabled:opacity-40" aria-label="Zoom out of graphs" disabled={!chartZoomed} onClick={() => zoomCharts(0.5)}>−</button>
                  <span className="w-10 text-center font-mono text-xs tabular-nums text-dark">{((n - 1) / chartSpan).toFixed(1)}×</span>
                  <button type="button" className="btn-secondary px-3 py-1 text-sm disabled:opacity-40" aria-label="Zoom in on graphs" disabled={chartSpan <= Math.min(n - 1, Math.max(8, Math.ceil((n - 1) / 20)))} onClick={() => zoomCharts(2)}>+</button>
                  <button type="button" className="ml-2 text-xs text-link disabled:text-faint" disabled={!chartZoomed} onClick={resetCharts}>Full lap</button>
                </div>
                <span className="font-mono text-xs tabular-nums text-light" aria-label="Visible graph section">{(visibleRange[0] / (n - 1) * 100).toFixed(1)}–{(visibleRange[1] / (n - 1) * 100).toFixed(1)}% of lap</span>
              </div>
              {chartZoomed && <div className="flex items-center gap-3">
                <button type="button" className="text-sm text-light disabled:opacity-30" aria-label="Earlier graph section" disabled={visibleRange[0] === 0} onClick={() => panCharts(Math.max(0, visibleRange[0] - Math.round(chartSpan / 2)))}>←</button>
                <input type="range" aria-label="Move graph section" aria-valuetext={`${(visibleRange[0] / (n - 1) * 100).toFixed(1)} to ${(visibleRange[1] / (n - 1) * 100).toFixed(1)} percent of lap`} min="0" max={n - 1 - chartSpan} step="1" value={visibleRange[0]} onChange={(e) => panCharts(Number(e.target.value))} className="min-w-0 flex-1 cursor-pointer accent-primary" />
                <button type="button" className="text-sm text-light disabled:opacity-30" aria-label="Later graph section" disabled={visibleRange[1] === n - 1} onClick={() => panCharts(Math.min(n - 1 - chartSpan, visibleRange[0] + Math.round(chartSpan / 2)))}>→</button>
              </div>}
              <p className="text-[11px] text-light">Drag across a graph to zoom. Double-click for the full lap.</p>
            </div>
            <div className="space-y-5">
              {both && delta && <div>
                <ChannelChart {...chartProps} title="Time delta" unit="s · B − A" a={delta.d} lo={-delta.maxAbs} hi={delta.maxAbs} delta height={110} />
                <p className="ml-12 mt-2 text-[11px] text-light">+ A ahead · − B ahead. Rising: B loses time.</p>
              </div>}
              <ChannelChart {...chartProps} title="Speed" unit="km/h" a={lapA.speed} b={lapB?.speed} lo={0} hi={speedHi} height={140} />
              <ChannelChart {...chartProps} title="Throttle" unit="%" pedal="gas" a={lapA.gas} b={lapB?.gas} lo={0} hi={100} height={116} />
              <ChannelChart {...chartProps} title="Brake" unit="%" pedal="brake" a={lapA.brake} b={lapB?.brake} lo={0} hi={100} height={116} />
              {showDetails && <>
                <ChannelChart {...chartProps} title="Steering" unit="°" a={lapA.steer} b={lapB?.steer} lo={-steerAbs} hi={steerAbs} format={(v) => (v / 10).toFixed(0)} />
                <ChannelChart {...chartProps} title="Gear" unit="" a={lapA.gear} b={lapB?.gear} lo={0} hi={Math.max(6, ...lapA.gear, ...(lapB?.gear || []))} height={90} />
              </>}
              <div className="ml-12 flex justify-between font-mono text-[10px] tabular-nums text-light" aria-label="Track position axis">{[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f}>{((visibleRange[0] + f * chartSpan) / (n - 1) * 100).toFixed(chartZoomed ? 1 : 0)}%</span>)}</div>
            </div>
            <button type="button" className="text-xs font-semibold text-link hover:underline" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>{showDetails ? 'Hide steering & gear' : '+ Show steering & gear'}</button>
            {insights.length > 0 && <details className="rounded-xl border border-border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-dark">Slow sections ({insights.length})</summary>
              <p className="px-4 pb-3 text-xs text-light">From A’s speed trace. Select a section to zoom in.</p>
              <div className="divide-y divide-border">{insights.map((c) => {
                const clauses = [];
                if (c.brakeDeltaM != null && Math.abs(c.brakeDeltaM) >= 3) clauses.push(`${c.brakeDeltaM > 0 ? 'B' : 'A'} brakes ≈${Math.abs(c.brakeDeltaM)} m later`);
                if (Math.abs(c.midDelta) >= 2) clauses.push(`${c.midDelta > 0 ? 'B' : 'A'} +${Math.abs(c.midDelta).toFixed(0)} km/h minimum speed`);
                if (Math.abs(c.exitDelta) >= 2) clauses.push(`${c.exitDelta > 0 ? 'B' : 'A'} +${Math.abs(c.exitDelta).toFixed(0)} km/h on exit`);
                return <button key={c.n} type="button" onClick={() => { selectChartRange(c.start, c.end); pickCursor(c.apex); }} className={`flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-left text-xs hover:bg-surface2 ${Math.abs(at - c.apex) < 12 ? 'bg-surface2' : ''}`}>
                  <span className="w-16 font-mono tabular-nums text-light">{c.atPct}% of lap</span>
                  <span className="font-mono font-semibold tabular-nums" style={{ color: c.gainMs >= 0 ? colorA : colorB }}>{Math.abs(c.gainMs) < 10 ? 'Similar pace' : `${c.gainMs >= 0 ? 'A' : 'B'} gains ${(Math.abs(c.gainMs) / 1000).toFixed(2)} s`}</span>
                  <span className="text-light">{clauses.join(' · ') || 'No large difference in these sampled inputs.'}</span>
                </button>;
              })}</div>
            </details>}
          </>}
        </>}
    </ToolCard>
  );
}

export default TelemetryCompare;
