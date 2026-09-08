import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, telemetryTrackMapUrl } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { Field } from "./ui.jsx";
import { fmtLap } from "../utils/format.js";
import { ChannelChart, PedalChart, ChartAxis, LapSummary, lapColor } from "./TelemetryCharts.jsx";
import TelemetryDashboard from "./TelemetryDashboard.jsx";
import { SectorStrip, SectionsPanel } from "./TelemetrySections.jsx";
import TelemetryTrackMap from "./TelemetryTrackMap.jsx";
import { fitTelemetryWindow } from "../utils/telemetryWindow.js";
import { sampleAtTime } from "../utils/telemetryGeometry.js";
import {
  detectCorners, cumulativeDist, cornerInsights, sectionWindows, lapMarkers, sectorDeltas, gForces,
  resampleLap, indexAtTime, sectionAt, neighbourSection, formatLapTime,
} from "../utils/telemetryAnalysis.js";
import { comparisonCsv, comparisonSummary, downloadText, exportSvgPng } from "../utils/telemetryExport.js";

// The card shell this was drawn in on the Tools page. Copied rather than
// imported: reaching into pages/Tools.jsx for it would pull the whole
// race-prep page into the admin bundle to borrow a border. In full screen the
// card is the page: it scrolls itself and its header stays put.
function ToolCard({ id, title, subtitle, actions, cardRef, full, children }) {
  return (
    <div id={id} ref={cardRef} className={`card ${full ? "overflow-y-auto" : "overflow-hidden"}`}>
      <div className={`flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface2/50 px-5 py-3 ${full ? "sticky top-0 z-10 backdrop-blur" : ""}`}>
        <div>
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-light">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-light">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className={`space-y-4 p-5 ${full ? "mx-auto max-w-[1400px]" : ""}`}>{children}</div>
    </div>
  );
}

// The live map's zoom buttons, to the pixel: the same control in two places on
// the site should not be two different controls.
const ZOOM_BTN =
  "flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 font-mono text-sm font-bold text-white backdrop-blur transition hover:bg-black/75";
const SMALL_BTN = "btn-secondary px-2.5 py-1 text-xs";
const LINK_BTN = "text-link hover:underline disabled:text-faint";
const ICON_BTN = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-medium transition hover:bg-surface2 disabled:opacity-30";

// The transport's glyphs: the shapes every player uses, drawn rather than
// typed so they look the same on every phone.
function Icon({ name }) {
  const common = { viewBox: "0 0 16 16", className: "h-3.5 w-3.5", fill: "currentColor", "aria-hidden": true };
  switch (name) {
    case "play": return <svg {...common}><path d="M4 2.5v11l9-5.5z" /></svg>;
    case "pause": return <svg {...common}><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" /></svg>;
    case "prev": return <svg {...common}><path d="M3 2.5h2v11H3zM13 2.5v11L6 8z" /></svg>;
    case "next": return <svg {...common}><path d="M11 2.5h2v11h-2zM3 2.5v11l7-5.5z" /></svg>;
    default: return null;
  }
}

// One dropdown value naming one lap: driver, then which of their laps.
const pickOf = (l) => `${l.steamId}:${l.lapId}`;
const splitPick = (v) => {
  const cut = String(v || "").indexOf(":");
  return cut === -1 ? [v, null] : [v.slice(0, cut), v.slice(cut + 1)];
};

// A comparison as one query-string value, so a driver can paste it into
// Discord: "<track>_<steamA>.<lapA>_<steamB>.<lapB>". Every piece is digits or
// [a-z0-9-], so the underscore can never be mistaken for part of one. A link
// that names a driver without a lap opens their fastest, and one that names
// only lap A opens that lap on its own.
const LINK_PARAM = "tel";
const toLink = (trackKey, aId, bId) => [trackKey, aId.replace(":", "."), bId ? bId.replace(":", ".") : ""].filter(Boolean).join("_");
function fromLink(raw) {
  const [trackKey, a, b] = String(raw || "").split("_");
  if (!trackKey || !/^[a-z0-9-]+$/.test(trackKey)) return null;
  const pick = (v) => {
    const m = /^(\d{10,20})(?:\.(\d{4,8}))?$/.exec(v || "");
    return m ? (m[2] ? `${m[1]}:${m[2]}` : m[1]) : "";
  };
  return { trackKey, aId: pick(a), bId: pick(b) };
}
const findPick = (laps, id) => (id ? laps.find((l) => pickOf(l) === id) || laps.find((l) => l.steamId === splitPick(id)[0]) || null : null);

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
  // What a shared link asked for, consumed by the first laps load and then
  // forgotten, so a later track switch behaves like any other.
  const wanted = useRef(fromLink(new URLSearchParams(window.location.search).get(LINK_PARAM)));
  const [trackKey, setTrackKey] = useState(wanted.current?.trackKey || "");
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
  // Where the next run starts. Play resumes from the cursor rather than the
  // line: pause, drag to a corner, play — and it plays from that corner. Held
  // in a ref because the run's effect must not depend on the cursor, which it
  // moves itself sixty times a second.
  const startAtRef = useRef(0);
  const [chartRange, setChartRange] = useState(null);
  // The x axis in percent of lap, or in metres driven by A when the lap has
  // positions: "brake at 2,310 m" is something a driver can take to the track.
  const [axisMode, setAxisMode] = useState("pct");
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef(null);
  const mapSvg = useRef(null);
  const onScreen = useRef(true);
  const selections = useRef({ aId, bId });
  selections.current = { aId, bId };
  // Who is looking. A member who has a lap at this track opens on their own
  // lap against the quickest other one — the comparison they came for.
  const { user } = useAuth();
  const me = useRef(null);
  me.current = user?.driverId || null;

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
    const selected = wanted.current || selections.current;
    wanted.current = null;
    api.telemetryLaps(trackKey).then((d) => {
      if (!alive) return;
      setLaps(d.laps);
      if (!d.laps.length) { setAId(""); setBId(""); return; }
      const mine = !selected.aId && me.current ? d.laps.find((l) => l.driverId && l.driverId === me.current) : null;
      const a = findPick(d.laps, selected.aId) || mine || d.laps[0];
      setAId(pickOf(a));
      const bFound = findPick(d.laps, selected.bId);
      const b = bFound && pickOf(bFound) !== pickOf(a) ? bFound : null;
      const alternative = d.laps.find((l) => l.car === a?.car && l.steamId !== a?.steamId)
        || d.laps.find((l) => l.car === a?.car && pickOf(l) !== pickOf(a));
      // A manual refresh keeps an intentional single-lap selection, and so
      // does a link that names lap A alone.
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

  // The address follows the selection, so the link in the bar is always the
  // link to what is on screen. replaceState rather than the router: this is a
  // bookmark, not a navigation, and the page must not scroll or re-render for
  // it.
  useEffect(() => {
    if (!trackKey || !aId) return;
    const url = new URL(window.location.href);
    const code = toLink(trackKey, aId, bId);
    if (url.searchParams.get(LINK_PARAM) === code) return;
    url.searchParams.set(LINK_PARAM, code);
    window.history.replaceState(window.history.state, "", url);
  }, [trackKey, aId, bId]);

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
  // The sections everything points at: the insights when there are two laps,
  // the bare windows when there is one.
  const sections = useMemo(() => (insights.length ? insights : sectionWindows(corners, dist, n)), [insights, corners, dist, n]);
  const markers = useMemo(
    () => (lapA && corners.length ? { a: lapMarkers(lapA, corners, n), b: both ? lapMarkers(lapB, corners, n) : null } : null),
    [lapA, lapB, both, corners, n]
  );
  const sectors = useMemo(() => (both ? sectorDeltas(lapA, lapB, dist, n) : null), [both, lapA, lapB, dist, n]);
  // The lap neither of them drove: the quicker of the two through each
  // sector, added up. What the pair could do together — and, for one driver
  // comparing their own laps, what they could do on a clean one.
  const idealMs = useMemo(() => {
    if (!sectors || !lapA) return null;
    const tail = lapA.lapTimeMs - lapA.t[n - 1];
    return Math.round(sectors.reduce((s, x) => s + Math.min(x.timeA, x.timeB), 0) + Math.max(0, tail));
  }, [sectors, lapA, n]);
  const gA = useMemo(() => (lapA ? gForces(lapA, n) : null), [lapA, n]);
  const gB = useMemo(() => (both ? gForces(lapB, n) : null), [both, lapB, n]);
  const gRange = useMemo(() => {
    if (!gA) return { lat: 1, long: 1 };
    const abs = (arr) => Math.max(0.5, ...arr.map(Math.abs));
    return {
      lat: Math.ceil(Math.max(gA.lat ? abs(gA.lat) : 0, gB?.lat ? abs(gB.lat) : 0) * 2) / 2,
      long: Math.ceil(Math.max(abs(gA.long), gB ? abs(gB.long) : 0) * 2) / 2,
    };
  }, [gA, gB]);
  const pedalsA = useMemo(() => (lapA ? { gas: lapA.gas, brake: lapA.brake } : null), [lapA]);
  const pedalsB = useMemo(() => (lapB ? { gas: lapB.gas, brake: lapB.brake } : null), [lapB]);
  const hasMap = !!(lapA?.x && lapA?.z);

  const pickCursor = (index) => {
    setPlaying(false);
    setBIdx(null);
    setMotionA(null);
    setCursor(index);
  };

  // Real time, not frames: a slow machine plays the lap slower, it does not
  // play a different lap. Stops itself at the flag. Picks up the clock at the
  // start index's own time, so resuming and a speed change mid-lap both carry
  // on from where the dot is instead of from the line.
  useEffect(() => {
    if (!playing || !lapA) return undefined;
    const end = Math.max(lapA.lapTimeMs, both ? lapB.lapTimeMs : 0);
    let raf = 0;
    let last = null;
    let hintA = Math.max(0, Math.min(startAtRef.current, n - 1));
    let elapsed = lapA.t[hintA] ?? 0;
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

  // Full screen: the card becomes the page. Tracked from the document, so
  // Escape (which the browser handles itself) is reflected too.
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement && document.fullscreenElement === cardRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFull = () => {
    const el = cardRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  };

  // Keys only work while the comparison is actually on screen: on a long page
  // the space bar should scroll, not start a replay nobody is looking at.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([entry]) => { onScreen.current = entry.isIntersecting; }, { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const rows = lapRows(laps);
  const at = Math.max(0, Math.min(n - 1, cursor ?? 0));
  const gap = both ? (lapB.lapTimeMs - lapA.lapTimeMs) / 1000 : null;
  const active = sectionAt(sections, at);
  const bands = useMemo(() => sections.map((s) => ({ n: s.n, start: s.start, end: s.end, active: s.n === active?.n })), [sections, active?.n]);
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
  const selectSection = (s) => { selectChartRange(s.start, s.end); pickCursor(s.apex); };
  const jumpSection = (dir) => { const s = neighbourSection(sections, at, dir); if (s) pickCursor(s.apex); };
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    const from = cursor == null || cursor >= n - 1 ? 0 : cursor;
    startAtRef.current = from;
    setBIdx(null); setMotionA(null); setCursor(from);
    setPlaying(true);
  };
  const chartProps = { cursor: at, onPick: pickCursor, range: visibleRange, onSelectRange: selectChartRange, onResetRange: resetCharts, colorA, colorB, bands, onBand: selectSection };
  const error = tracks.error || loadError || aError || bError;
  const refresh = () => { tracks.reload(); setRevision((v) => v + 1); };
  const changeA = (id) => {
    if (id === bId) setBId(aId);
    setAId(id);
  };
  const readable = (value) => String(value || '').replaceAll('_', ' ');
  const position = (index) => (axisMode === "dist" && dist ? `${Math.round(dist[index]).toLocaleString("en-GB")} m` : `${((index / (n - 1)) * 100).toFixed(1)}%`);

  // Space, arrows, brackets, Home/End, F — the keys a replay is expected to
  // answer to. Bound once; the handler reads the latest state through a ref
  // so the listener is not re-attached sixty times a second during playback.
  const keys = useRef(null);
  keys.current = (e) => {
    const tag = e.target?.tagName;
    if (!lapA || !onScreen.current || e.metaKey || e.ctrlKey || e.altKey) return;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case " ": e.preventDefault(); togglePlay(); break;
      case "ArrowLeft": e.preventDefault(); pickCursor(Math.max(0, at - step)); break;
      case "ArrowRight": e.preventDefault(); pickCursor(Math.min(n - 1, at + step)); break;
      case "[": jumpSection(-1); break;
      case "]": jumpSection(1); break;
      case "Home": e.preventDefault(); pickCursor(0); break;
      case "End": e.preventDefault(); pickCursor(n - 1); break;
      case "f": case "F": toggleFull(); break;
      default:
    }
  };
  useEffect(() => {
    const onKey = (e) => keys.current?.(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shareUrl = () => `${window.location.origin}/tools?${LINK_PARAM}=${encodeURIComponent(toLink(trackKey, aId, bId))}#telemetry`;
  const trackName = (() => { const t = list.find((x) => x.trackKey === trackKey); return t ? `${readable(t.track)}${t.layout ? ` · ${readable(t.layout)}` : ""}` : trackKey; })();
  const fileStem = `${trackKey || "lap"}-${(lapA?.name || "A").replace(/[^\w-]+/g, "_")}${lapB ? `-vs-${lapB.name.replace(/[^\w-]+/g, "_")}` : ""}`;
  const copyText = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(`Copy this ${what}`, text);
    }
  };
  const copyLink = () => copyText(shareUrl(), "link");
  const copySummary = () => copyText(comparisonSummary({ trackName, season, lapA, lapB, gapMs: both ? lapB.lapTimeMs - lapA.lapTimeMs : 0, sectors, insights, idealMs, link: shareUrl() }), "summary");
  const downloadCsv = () => downloadText(comparisonCsv({ lapA, lapB, dist, n, gA, gB }), `${fileStem}.csv`, "text/csv");
  const saveMap = () => exportSvgPng(mapSvg.current, { fileName: `${fileStem}-map.png`, background: getComputedStyle(document.documentElement).getPropertyValue("--c-card").trim() || "#fff" }).catch(() => {});

  return (
    <ToolCard id="telemetry" cardRef={cardRef} full={full} title="Lap comparison" subtitle={season ? `Season ${season} · both laps aligned by track position` : "Both laps aligned by track position"}
      actions={<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
        {lapA && <button type="button" className={LINK_BTN} onClick={copyLink} title="Copy a link that opens exactly this comparison">{copied === "link" ? "Link copied" : "Copy link"}</button>}
        {lapA && <details className="relative">
          <summary className={`${LINK_BTN} cursor-pointer list-none`}>{copied === "summary" ? "Summary copied" : "Export"}</summary>
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-border bg-card py-1 font-normal shadow-lift">
            <button type="button" className="block w-full px-3 py-1.5 text-left text-dark hover:bg-surface2" onClick={copySummary}>Copy summary as text</button>
            <button type="button" className="block w-full px-3 py-1.5 text-left text-dark hover:bg-surface2" onClick={downloadCsv}>Download CSV</button>
            {hasMap && <button type="button" className="block w-full px-3 py-1.5 text-left text-dark hover:bg-surface2" onClick={saveMap}>Save map as PNG</button>}
          </div>
        </details>}
        {lapA && <button type="button" className={LINK_BTN} onClick={toggleFull} aria-pressed={full} title="Full screen (F)">{full ? "Exit full screen" : "Full screen"}</button>}
        <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={refresh} disabled={tracks.loading}>Refresh laps</button>
      </div>}>
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
              <div className="col-span-2 flex flex-col justify-center gap-2 py-3 sm:col-span-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-light">Finish-line gap</p>
                  {both && <button type="button" className="text-xs font-semibold text-link hover:underline" onClick={() => { setAId(bId); setBId(aId); }}>Swap A / B ↔</button>}
                </div>
                <p className="font-display text-3xl font-extrabold tabular-nums text-dark">{gap == null ? '—' : `${Math.abs(gap).toFixed(3)} s`}</p>
                <p className="text-xs text-light">{gap == null ? 'Choose lap B to see the difference.' : gap === 0 ? 'Same recorded lap time' : `Lap ${gap > 0 ? 'A' : 'B'} is quicker`}</p>
                {idealMs != null && idealMs < Math.min(lapA.lapTimeMs, lapB.lapTimeMs) - 1 && (
                  <p className="text-xs text-light" title="The quicker of the two through each sector, added up">Best of both sectors: <span className="font-mono font-semibold tabular-nums text-dark">{formatLapTime(idealMs)}</span> <span className="font-mono tabular-nums">(−{((Math.min(lapA.lapTimeMs, lapB.lapTimeMs) - idealMs) / 1000).toFixed(3)} s)</span></p>
                )}
                {sectors && <SectorStrip sectors={sectors} colorA={colorA} colorB={colorB} onSelect={(s) => { selectChartRange(s.from, s.to); pickCursor(s.from); }} />}
              </div>
            </div>
            {both && lapA.car !== lapB.car && <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">Different cars selected. Vehicle performance also affects this comparison.</p>}
            <div className={`grid min-w-0 gap-4 ${hasMap ? 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start' : ''}`}>
              {hasMap && <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface2/30">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <h3 className="text-xs font-semibold text-dark">Track position</h3>
                  {both && <div className="flex gap-1">{[['gain', 'Time gain'], ['lines', 'Racing lines']].map(([key, label]) => <button key={key} type="button" aria-pressed={mapMode === key}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${mapMode === key ? 'bg-brand/15 text-dark' : 'text-light hover:bg-surface2'}`}
                    onClick={() => { setMapMode(key); if (key === 'lines' && zoom < 20) { focusSomewhere(); setZoom(30); } }}>{label}</button>)}</div>}
                </div>
                {/* Square on a phone: a circuit that runs taller than wide
                    gets the height it needs; a fixed box from a desktop
                    layout squashed it. */}
                <div className="relative aspect-square max-h-[460px] w-full sm:aspect-auto sm:h-[380px]">
                  <TelemetryTrackMap lapA={lapA} lapB={lapB} n={n} cursor={at} cursorB={bIdx} motionA={motionA} onPick={pickCursor} onReset={()=>setZoom(1)} mode={mapMode} zoom={zoom} track={track} colorA={colorA} colorB={colorB}
                    sections={sections} sectors={sectors || []} activeSection={active?.n ?? null} onSection={selectSection} markers={markers} focusRange={chartZoomed ? visibleRange : null} exportRef={mapSvg}/>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border px-3 py-2">
                  <button type="button" className={ZOOM_BTN + ' w-auto px-2 text-[10px]'} onClick={() => setZoom(1)} aria-label="Show whole track">Reset</button>
                  <button type="button" className={ZOOM_BTN + ' w-auto px-2 text-[10px]'} onClick={() => {focusSomewhere();setZoom(30);setMapMode('lines');}}>Corner</button>
                  <button type="button" className={ZOOM_BTN + ' w-auto px-2 text-[10px]'} onClick={() => {focusSomewhere();setZoom(120);setMapMode('lines');}}>Close-up</button>
                  <button type="button" className={ZOOM_BTN} aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
                  <button type="button" className={ZOOM_BTN} aria-label="Zoom in" onClick={() => { focusSomewhere(); setZoom((z) => Math.min(240, z * 1.5)); }}>+</button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-light">
                  <span className="flex items-center gap-1.5"><span className="w-4 border-t-2" style={{borderColor:colorA}} />A{both && mapMode === 'gain' ? ' gains' : ''}</span>
                  {both && <span className="flex items-center gap-1.5"><span className={`w-4 border-t-2 ${mapMode === 'gain' ? '' : 'border-dashed'}`} style={{borderColor:colorB}} />B{mapMode === 'gain' ? ' gains, thicker for more' : ''}</span>}
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-medium" />brake point</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-medium" />full throttle</span>
                  <span>numbers: slow sections</span>
                  <span className="ml-auto">{zoom>1?'Drag to pan, double-click to reset':'Select a point on the line'}</span>
                </div>
              </div>}
              <TelemetryDashboard lapA={lapA} lapB={lapB} at={at} atB={playing && bIdx != null ? bIdx : at} colorA={colorA} colorB={colorB} gA={gA} gB={gB} dist={dist} n={n} section={active?.n ?? null} />
            </div>
            {/* The transport, laid out like a player: play on the left, the
                lap as a slider, a section skip at either end of it, and the
                speed on the right. On a phone the slider takes its own line. */}
            <div className="border-y border-border py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* Pause keeps the cursor where it is; Play resumes from
                    there. Only a lap that has run to the flag (or has no
                    cursor yet) starts over from the line. */}
                <button type="button" className="btn-primary min-w-[6.5rem] gap-2 px-3 py-1.5 text-xs" onClick={togglePlay} title="Space bar plays and pauses" aria-pressed={playing}>
                  <Icon name={playing ? 'pause' : 'play'} />{playing ? 'Pause' : cursor != null && cursor > 0 && cursor < n - 1 ? 'Resume' : 'Play lap'}
                </button>
                <div className="order-last flex basis-full items-center gap-2 sm:order-none sm:basis-auto sm:flex-1">
                  <button type="button" className={ICON_BTN} onClick={() => jumpSection(-1)} disabled={!neighbourSection(sections, at, -1)} aria-label="Previous slow section" title="Previous slow section, or press ["><Icon name="prev" /></button>
                  <div className="relative min-w-0 flex-1">
                    <input type="range" aria-label="Position around the lap" aria-valuetext={`${(at / (n - 1) * 100).toFixed(1)} percent of lap`} min="0" max={n - 1} step="1" value={at} onChange={(e) => pickCursor(Number(e.target.value))} className="block w-full cursor-pointer accent-primary" />
                    <div className="pointer-events-none absolute inset-x-2 top-full h-1.5" aria-hidden="true">
                      {sections.map((s) => <span key={s.n} className="absolute top-0 h-1.5 w-px" style={{ left: `${(s.apex / (n - 1)) * 100}%`, background: s.n === active?.n ? 'rgb(var(--c-accent))' : 'var(--c-text3)' }} />)}
                    </div>
                  </div>
                  <button type="button" className={ICON_BTN} onClick={() => jumpSection(1)} disabled={!neighbourSection(sections, at, 1)} aria-label="Next slow section" title="Next slow section, or press ]"><Icon name="next" /></button>
                </div>
                {/* A speed change restarts the run's effect; handing it the
                    current cursor keeps the dot in place instead of sending
                    it back to the line. */}
                <select aria-label="Playback speed" className="rounded-md border border-border bg-card px-2 py-1 text-xs text-dark" value={playbackRate} onChange={(e) => { startAtRef.current = at; setPlaybackRate(Number(e.target.value)); }}>
                  {[0.25, 0.5, 1, 2, 4].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
                </select>
                {/* Fixed width and no section suffix (the readout above names
                    it): text that changes length here reflows the whole row
                    on a phone with every step of playback. */}
                <span className="ml-auto min-w-[8.5rem] whitespace-nowrap text-right font-mono text-xs tabular-nums text-light">{position(at)} of lap</span>
              </div>
              <p className="mt-3 text-[10px] text-light">Drag the slider or a point on the map to inspect. The ticks are the slow sections.<span className="hidden sm:inline"> Arrow keys step, space plays, [ and ] jump between sections.</span></p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <h3 className="font-display text-lg font-bold text-dark">Lap traces</h3>
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span className="flex items-center gap-2 text-light"><span className="w-5 border-t-2" style={{ borderColor: colorA }} />A · solid</span>
                {both && <span className="flex items-center gap-2 text-light"><span className="w-5 border-t-2 border-dashed" style={{ borderColor: colorB }} />B · dashed</span>}
                <div role="group" aria-label="Position axis" className="flex rounded-md border border-border p-0.5 text-[11px]">
                  {[['pct', '% of lap'], ['dist', 'metres']].map(([key, label]) => <button key={key} type="button" aria-pressed={axisMode === key} disabled={key === 'dist' && !dist}
                    className={`rounded px-2 py-0.5 font-semibold transition disabled:opacity-40 ${axisMode === key ? 'bg-brand/15 text-dark' : 'text-light hover:bg-surface2'}`} onClick={() => setAxisMode(key)}>{label}</button>)}
                </div>
              </div>
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
                <span className="font-mono text-xs tabular-nums text-light" aria-label="Visible graph section">{position(visibleRange[0])} – {position(visibleRange[1])}</span>
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
                <ChannelChart {...chartProps} title="Time delta" unit="s · B − A" a={delta.d} lo={-delta.maxAbs} hi={delta.maxAbs} delta height={120} />
                <p className="ml-12 mt-2 text-[11px] text-light">+ A ahead · − B ahead. Rising: B loses time.</p>
              </div>}
              <ChannelChart {...chartProps} title="Speed" unit="km/h" a={lapA.speed} b={lapB?.speed} lo={0} hi={speedHi} height={150} />
              <PedalChart {...chartProps} a={pedalsA} b={pedalsB} height={160} />
              {showDetails && <>
                <ChannelChart {...chartProps} title="Steering" unit="°" a={lapA.steer} b={lapB?.steer} lo={-steerAbs} hi={steerAbs} format={(v) => (v / 10).toFixed(0)} />
                <ChannelChart {...chartProps} title="Gear" unit="" a={lapA.gear} b={lapB?.gear} lo={0} hi={Math.max(6, ...lapA.gear, ...(lapB?.gear || []))} height={90} />
                {gA?.lat && <ChannelChart {...chartProps} title="Lateral g" unit="g · from the recorded line" a={gA.lat} b={gB?.lat || null} lo={-gRange.lat} hi={gRange.lat} format={(v) => v.toFixed(1)} height={100} />}
                {gA && <ChannelChart {...chartProps} title="Longitudinal g" unit="g · + accelerating, − braking" a={gA.long} b={gB?.long || null} lo={-gRange.long} hi={gRange.long} format={(v) => v.toFixed(1)} height={100} />}
              </>}
              <ChartAxis visibleRange={visibleRange} n={n} dist={dist} mode={axisMode} zoomed={chartZoomed} />
            </div>
            <button type="button" className="text-xs font-semibold text-link hover:underline" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>{showDetails ? 'Hide steering, gear & g-forces' : '+ Show steering, gear & g-forces'}</button>
            {insights.length > 0 && <SectionsPanel insights={insights} activeN={active?.n ?? null} colorA={colorA} colorB={colorB} onSelect={selectSection} />}
          </>}
        </>}
    </ToolCard>
  );
}

export default TelemetryCompare;
