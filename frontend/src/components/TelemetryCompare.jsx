import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ChartLine, ClipboardCopy, Download, FileDown, ImageDown, Link2, Map as MapIcon, Maximize2, Minimize2, RefreshCw, TriangleAlert,
} from "lucide-react";
import { api, getToken, telemetryTrackMapUrl } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { useSeries } from "../context/SeriesContext.jsx";
import { Field, Skeleton } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import { fmtLap } from "../utils/format.js";
import { ChannelChart, PedalChart, ChartAxis, lapColor } from "./TelemetryCharts.jsx";
import TelemetryDuel from "./TelemetryDuel.jsx";
import TelemetryPlayer from "./TelemetryPlayer.jsx";
import { Chip, Menu, MenuItem, Panel, Segmented, ToolButton } from "./TelemetryUI.jsx";
import TelemetryDashboard from "./TelemetryDashboard.jsx";
import { SectionsPanel } from "./TelemetrySections.jsx";
import TelemetryOverview from "./TelemetryOverview.jsx";
import TelemetryTips from "./TelemetryTips.jsx";
import { buildTips } from "../utils/drivingTips.js";
import TelemetryTrackMap from "./TelemetryTrackMap.jsx";
import { fitTelemetryWindow } from "../utils/telemetryWindow.js";
import { sampleAtTime } from "../utils/telemetryGeometry.js";
import {
  detectCorners, cumulativeDist, cornerInsights, sectionWindows, lapMarkers, sectorDeltas, gForces,
  resampleLap, indexAtTime, sectionAt, neighbourSection, formatLapTime, lapProfile,
} from "../utils/telemetryAnalysis.js";
import { comparisonCsv, comparisonSummary, downloadText, exportSvgPng } from "../utils/telemetryExport.js";

// The card shell this was drawn in on the Tools page. Copied rather than
// imported: reaching into pages/Tools.jsx for it would pull the whole
// race-prep page into the admin bundle to borrow a border. In full screen the
// card is the page: it scrolls itself and its header stays put.
//
// `--tel-top` is where the pinned player bar sits: under the site's own bar
// (84px, NavBar.jsx) on the page, under this card's header in full screen.
// overflow-clip rather than hidden: hidden would make the card the player's
// scroll container, and it would never pin.
function ToolCard({ id, title, subtitle, actions, cardRef, full, children }) {
  const headRef = useRef(null);
  const [headHeight, setHeadHeight] = useState(0);
  useEffect(() => {
    const el = headRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setHeadHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div id={id} ref={cardRef} className={`card ${full ? "overflow-y-auto" : "overflow-clip"}`} style={{ "--tel-top": full ? `${headHeight}px` : "84px" }}>
      <div ref={headRef} className={`flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-5 ${full ? "sticky top-0 z-30" : ""}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-dark" aria-hidden="true"><Activity className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-eyebrow">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-light">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </div>
      <div className={`bg-surface2/50 p-3 sm:p-5 ${full ? "min-h-full" : ""}`}>
        <div className={`space-y-3 sm:space-y-4 ${full ? "mx-auto max-w-[1400px]" : ""}`}>{children}</div>
      </div>
    </div>
  );
}

// The map's zoom buttons, laid over the map the way the live map's are: the
// same control in two places on the site should not be two different
// controls.
const ZOOM_BTN =
  "flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg bg-black/60 px-1.5 font-mono text-[11px] font-bold text-white backdrop-blur transition hover:bg-black/75";

// Which optional traces are drawn, remembered per browser: somebody who always
// reads the steering wants it there next time. Storage can be missing or
// throw (private windows); the page works the same without it.
const CHANNELS_KEY = "nabs_tel_channels";
const OPTIONAL_CHANNELS = [
  { key: "steer", label: "Steering" },
  { key: "gear", label: "Gear" },
  { key: "lat", label: "Lateral g" },
  { key: "long", label: "Longitudinal g" },
];
function readChannels() {
  try {
    const v = JSON.parse(localStorage.getItem(CHANNELS_KEY) || "[]");
    return Array.isArray(v) ? v.filter((k) => OPTIONAL_CHANNELS.some((c) => c.key === k)) : [];
  } catch {
    return [];
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
// Which league the link is about, beside it. Every series has its own laps,
// and a link pasted into Discord is opened by people viewing the other one.
const SERIES_PARAM = "series";
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

function TelemetryCompare({ series: fixedSeries = null }) {
  // Which league's laps. Every series has its own recorder key and its own
  // store (backend: lib/telemetryKeys.js), so this is the first choice the
  // card makes. On the members' page it is a dropdown among the visible
  // series, starting on the one being viewed; the admin card pins it to the
  // series in the admin bar (`fixedSeries`), so the setup below the
  // comparison and the laps inside it are always about the same league. A
  // shared link names its series, so it opens on the right laps for everybody.
  const { seriesList, slug: viewedSlug, active: activeSeries } = useSeries();
  const linkParams = useRef(new URLSearchParams(window.location.search));
  const [pickedSeries, setPickedSeries] = useState(fixedSeries || linkParams.current.get(SERIES_PARAM) || null);
  const seriesSlug = fixedSeries || pickedSeries;
  const tracks = useApi(useCallback(() => api.telemetryTracks(seriesSlug), [seriesSlug]));
  // What a shared link asked for, consumed by the first laps load and then
  // forgotten, so a later track switch behaves like any other.
  const wanted = useRef(fromLink(linkParams.current.get(LINK_PARAM)));
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
  const [channels, setChannels] = useState(readChannels);
  const toggleChannel = (key) => setChannels((list) => {
    const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
    try { localStorage.setItem(CHANNELS_KEY, JSON.stringify(next)); } catch { /* per-browser nicety only */ }
    return next;
  });
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
  // Who may take a lap OUT. The two ways the site knows an admin (pages/
  // Admin.jsx): the PIN session, or a Discord account the league made admin.
  // The backend checks again on the call; this only decides whether to draw
  // the control, and a member never sees it.
  const admin = !!user?.isAdmin || !!getToken();
  const ask = useAsk();
  const [removing, setRemoving] = useState(false);

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
  // The league the endpoint answered for, by name and slug: the card says
  // whose laps these are the same way it says which season, and a link or an
  // empty list should name the league too.
  const seriesName = tracks.data?.seriesName;
  const effectiveSeries = tracks.data?.series || seriesSlug || viewedSlug || activeSeries?.slug || null;
  // The first track preselects itself — an empty dropdown helps nobody — and
  // the backend puts the track with the NEWEST lap first, which is the one the
  // practice server is on now. It used to be the first by name, which on a
  // night with two layouts of the same circuit in the list opened the card on
  // a two-lap variant and left the fifty real laps one entry down, unseen.
  useEffect(() => {
    if (tracks.data && !list.some((t) => t.trackKey === trackKey)) setTrackKey(list[0]?.trackKey || "");
  }, [list, trackKey, tracks.data]);

  useEffect(() => {
    setLaps(null); setLapA(null); setLapB(null); setAId(""); setBId(""); setCursor(null);
    setLoadError(null);
    setZoom(1);
  }, [trackKey]);

  // A different league is a different list: the picks go, the track stays
  // (the new list decides above whether it is still there). Nothing to undo
  // on first mount, where everything is empty already.
  useEffect(() => {
    setLaps(null); setLapA(null); setLapB(null); setAId(""); setBId(""); setCursor(null);
  }, [seriesSlug]);

  useEffect(() => {
    if (!trackKey) return;
    let alive = true;
    setLoadError(null);
    const selected = wanted.current || selections.current;
    wanted.current = null;
    api.telemetryLaps(trackKey, seriesSlug).then((d) => {
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
  }, [trackKey, revision, seriesSlug]);

  // The two laps follow the LIST, not the refresh counter: a new list (a new
  // track, a new league, a refresh) is a new array, and while it is being
  // replaced there is nothing to fetch a lap against — asking the new league
  // for the old league's pick would only flash a 404 before the list answers.
  useEffect(() => {
    setLapA(null);
    setAError(null);
    if (!trackKey || !aId || !laps) return;
    let alive = true;
    api.telemetryLap(trackKey, ...splitPick(aId), seriesSlug).then((d) => alive && setLapA(d)).catch((e) => alive && setAError(e.message || "Could not load lap A."));
    return () => { alive = false; };
  }, [trackKey, aId, laps, seriesSlug]);
  useEffect(() => {
    setLapB(null);
    setBError(null);
    if (!trackKey || !bId || !laps) return;
    let alive = true;
    api.telemetryLap(trackKey, ...splitPick(bId), seriesSlug).then((d) => alive && setLapB(d)).catch((e) => alive && setBError(e.message || "Could not load lap B."));
    return () => { alive = false; };
  }, [trackKey, bId, laps, seriesSlug]);

  // The address follows the selection, so the link in the bar is always the
  // link to what is on screen. replaceState rather than the router: this is a
  // bookmark, not a navigation, and the page must not scroll or re-render for
  // it.
  useEffect(() => {
    if (!trackKey || !aId) return;
    const url = new URL(window.location.href);
    const code = toLink(trackKey, aId, bId);
    const league = effectiveSeries || "";
    if (url.searchParams.get(LINK_PARAM) === code && (url.searchParams.get(SERIES_PARAM) || "") === league) return;
    url.searchParams.set(LINK_PARAM, code);
    if (league) url.searchParams.set(SERIES_PARAM, league);
    else url.searchParams.delete(SERIES_PARAM);
    window.history.replaceState(window.history.state, "", url);
  }, [trackKey, aId, bId, effectiveSeries]);

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

  // The speed axis spans what was driven, in steps of 50: starting it at 0
  // spent a third of the chart on speeds no car on the track ever dropped to,
  // and squashed the corner minimums the comparison is about.
  const [speedLo, speedHi] = useMemo(() => {
    if (!lapA) return [0, 100];
    const all = both ? [...lapA.speed, ...lapB.speed] : lapA.speed;
    return [Math.max(0, Math.floor(Math.min(...all) / 50) * 50), Math.ceil(Math.max(...all) / 50) * 50];
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
  // The circuit's named corners (admin Tracks tab), so a tip can say "T4
  // Roggia" rather than "section 3". Asked by the AC folder name the laps
  // carry; the backend resolves it to the circuit. None is a normal answer.
  const rawTrack = list.find((t) => t.trackKey === trackKey)?.track || "";
  const [namedCorners, setNamedCorners] = useState([]);
  useEffect(() => {
    setNamedCorners([]);
    if (!rawTrack) return undefined;
    let alive = true;
    api.trackProfile(rawTrack).then((d) => alive && setNamedCorners(d?.corners || [])).catch(() => {});
    return () => { alive = false; };
  }, [rawTrack]);
  const tips = useMemo(
    () => (both && insights.length ? buildTips(insights, lapA, lapB, { corners: namedCorners, dist, n }) : null),
    [both, insights, lapA, lapB, namedCorners, dist, n]
  );
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
  const profileA = useMemo(() => (lapA ? lapProfile(lapA, n, gA) : null), [lapA, n, gA]);
  const profileB = useMemo(() => (both ? lapProfile(lapB, n, gB) : null), [both, lapB, n, gB]);
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
    // Two things, each optional: the road edges from the track's AI line (what
    // the laps are drawn on) and the published map with its calibration (the
    // frame, and the fallback drawing when there is no AI line).
    const road = api.telemetryTrackRoad(trackKey, seriesSlug).catch(() => null);
    const map = api
      .telemetryTrackMap(trackKey, seriesSlug)
      .then(async (calib) => {
        const url = await telemetryTrackMapUrl(calib.url);
        if (!alive && url) URL.revokeObjectURL(url);
        return url ? { calib, href: url } : null;
      })
      .catch(() => null);
    Promise.all([road, map]).then(([edges, image]) => {
      if (!alive) return;
      if (image) href = image.href;
      if (edges || image) setTrack({ calib: image?.calib ?? null, href: image?.href ?? null, road: edges });
    });
    return () => {
      alive = false;
      // The blob is this component's; nothing else can reach it once the track
      // changes, and an unreleased one is a leak per switch.
      if (href) URL.revokeObjectURL(href);
    };
  }, [trackKey, seriesSlug]);

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
  // An admin taking a lap out of the store: a modded-car time, a lap from a
  // layout the server ran for ten minutes, a driver who should not be in the
  // list. Asked first, because a stored lap cannot be put back — the car that
  // recorded it has moved on. Afterwards the list is re-read rather than
  // patched: a track whose last lap went is a track that no longer exists
  // here, and the endpoint is the one that knows. The lap's id is its time in
  // milliseconds, which is how the store names it.
  const removeLap = async (lap) => {
    if (!lap || removing) return;
    const ok = await ask({
      title: `Remove ${lap.name}'s ${formatLapTime(lap.lapTimeMs)}?`,
      body: "The lap is deleted from the site's store and cannot be brought back. The driver keeps whatever else they have recorded here, and the recorder carries on as before.",
      danger: true,
      confirmLabel: "Remove lap",
    });
    if (!ok) return;
    setRemoving(true);
    try {
      await api.deleteTelemetryLap(trackKey, lap.steamId, lap.lapTimeMs, seriesSlug);
      refresh();
    } catch (e) {
      setLoadError(e.message || "Could not remove the lap.");
    } finally {
      setRemoving(false);
    }
  };
  const removeButton = (lap) => admin && lap ? (
    <button type="button" className="text-xs font-semibold text-bad hover:underline disabled:text-faint" disabled={removing} title="Delete this lap from the site's store (admins only)" onClick={() => removeLap(lap)}>
      {removing ? "Removing…" : "Remove lap"}
    </button>
  ) : null;
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

  const shareUrl = () => `${window.location.origin}/tools?${LINK_PARAM}=${encodeURIComponent(toLink(trackKey, aId, bId))}${effectiveSeries ? `&${SERIES_PARAM}=${encodeURIComponent(effectiveSeries)}` : ""}#telemetry`;
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

  // The series picker, when there is more than one league to choose from.
  const picksSeries = !fixedSeries && seriesList.length > 1;
  // Its label says the league out loud, so the subtitle beside it stops saying
  // the same thing a second time. Without the picker the subtitle is the only
  // place that carries it, and keeps it.
  const said = [picksSeries ? null : seriesName, season ? `Season ${season}` : null].filter(Boolean);
  const subtitle = [...said, `${said.length ? "b" : "B"}oth laps aligned by track position`].join(" · ");

  const lapOption = (l) => <option key={pickOf(l)} value={pickOf(l)}>{l.name} · {fmtLap(l.lapTimeMs)}{l.only ? '' : ` (${ORDINAL[l.rank] || l.rank + 1})`}</option>;
  const pickerA = (
    <select aria-label="Lap A · reference" className="input min-w-0 w-full py-1.5 font-semibold" value={aId} onChange={(e) => changeA(e.target.value)}>
      {!rows.length && <option value="">{laps === null ? 'Loading laps…' : 'No laps available'}</option>}
      {rows.map(lapOption)}
    </select>
  );
  const pickerB = (
    <select aria-label="Lap B · comparison" className="input min-w-0 w-full py-1.5 font-semibold" value={bId} onChange={(e) => setBId(e.target.value)}>
      <option value="">Single lap · no comparison</option>
      {rows.filter((l) => pickOf(l) !== aId).map(lapOption)}
    </select>
  );
  const loadingChannels = !error && (laps === null || (aId && !lapA) || (bId && !lapB));
  const playLabel = playing ? 'Pause' : cursor != null && cursor > 0 && cursor < n - 1 ? 'Resume' : 'Play lap';
  const minSpan = Math.min(n - 1, Math.max(8, Math.ceil((n - 1) / 20)));
  const shows = (key) => channels.includes(key);

  return (
    <ToolCard id="telemetry" cardRef={cardRef} full={full} title="Lap comparison" subtitle={subtitle}
      // One row on a phone: the league picker takes what the four icon buttons
      // leave, and its word is for screen readers only there. From sm up the
      // row sits beside the title and may wrap.
      actions={<div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-wrap">
        {/* The league, when there is more than one to choose from. Up here
            rather than beside the track dropdown so it is there when the list
            is empty — which is exactly when somebody wants to look at the
            other league's laps instead. The eyebrow says it picks the LEAGUE,
            the choice that decides which laps exist at all, and the accent
            border tells it apart from the track dropdown at a glance. A real
            <label>, so the visible word is the accessible name too. */}
        {picksSeries && (
          <label className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
            <span className="sr-only font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow sm:not-sr-only">Series</span>
            <select className="input h-8 min-w-0 border-accent/60 py-0 text-xs font-bold sm:w-auto" value={effectiveSeries || ""} onChange={(e) => setPickedSeries(e.target.value || null)}>
              {seriesList.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
            </select>
          </label>
        )}
        {picksSeries && <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />}
        {/* Which laps you are looking at, then what you can do with them. */}
        {lapA && <ToolButton icon={Link2} label={copied === "link" ? "Link copied" : "Copy link"} title="Copy a link that opens exactly this comparison" onClick={copyLink} />}
        {lapA && (
          <Menu icon={Download} label="Export" summary={<span className="hidden sm:inline">{copied === "summary" ? "Summary copied" : "Export"}</span>}>
            <MenuItem icon={ClipboardCopy} onClick={copySummary}>Copy summary as text</MenuItem>
            <MenuItem icon={FileDown} onClick={downloadCsv}>Download CSV</MenuItem>
            {hasMap && <MenuItem icon={ImageDown} onClick={saveMap}>Save map as PNG</MenuItem>}
          </Menu>
        )}
        {lapA && <ToolButton icon={full ? Minimize2 : Maximize2} label={full ? "Exit full screen" : "Full screen"} title="Full screen (F)" aria-pressed={full} onClick={toggleFull} />}
        <ToolButton icon={RefreshCw} label="Refresh laps" onClick={refresh} disabled={tracks.loading} />
      </div>}>
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad"><TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{error}<button type="button" className="ml-auto font-semibold underline" onClick={refresh}>Try again</button></div>}
      {tracks.loading && !tracks.data ? <TelemetrySkeleton label="Loading recorded tracks…" />
        : !list.length && !error ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
            <Activity className="h-8 w-8 text-faint" aria-hidden="true" />
            <p className="text-sm font-semibold text-dark">No laps recorded{seriesName ? ` for ${seriesName}` : ''}{season ? ` in Season ${season}` : ''} yet</p>
            <p className="max-w-sm text-xs text-light">Laps appear here once a driver completes a clean lap with the in-game telemetry app running. Refresh after that.</p>
          </div>
        )
        : list.length > 0 && <>
          <Field label="Track" className="sm:max-w-md">
            <select aria-label="Track" className="input min-w-0 w-full" value={trackKey} onChange={(e) => setTrackKey(e.target.value)}>
              {list.map((t) => <option key={t.trackKey} value={t.trackKey}>{readable(t.track)}{t.layout ? ` · ${readable(t.layout)}` : ''} · {t.laps} laps</option>)}
            </select>
          </Field>
          {!error && laps?.length === 0 && <p className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-light">No laps are currently available for this track. Refresh or select another track.</p>}
          {laps?.length > 0 && (
            <TelemetryDuel lapA={lapA} lapB={lapB} colorA={colorA} colorB={colorB} pickerA={pickerA} pickerB={pickerB}
              actionA={removeButton(lapA)} actionB={removeButton(lapB)} idealMs={idealMs} onSwap={() => { setAId(bId); setBId(aId); }}
              placeholderA={aError ? 'Could not load this lap.' : 'Loading lap…'}
              placeholderB={bId ? (bError ? 'Could not load this lap.' : 'Loading lap…') : 'Compare another driver or one of your own laps.'} />
          )}
          {loadingChannels && <TelemetrySkeleton label="Loading lap channels…" compact={laps?.length > 0} />}
          {lapA && !loadingChannels && <>
            {both && lapA.car !== lapB.car && <p className="flex items-center gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn"><TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />Different cars selected. Vehicle performance also affects this comparison.</p>}
            {profileA && <TelemetryOverview sectors={sectors} insights={insights} profileA={profileA} profileB={profileB} colorA={colorA} colorB={colorB} dist={dist} n={n}
              onSector={(s) => { selectChartRange(s.from, s.to); pickCursor(s.from); }} onSection={selectSection} />}
            {tips && <TelemetryTips tips={tips} lapA={lapA} lapB={lapB} colorA={colorA} colorB={colorB}
              onSection={(s) => { selectSection(s); document.getElementById("telemetry-traces")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />}
            {/* Player, replay, traces and sections share one wrapper: the
                player bar pins itself for as long as this block is on screen,
                and lets go once the page has scrolled past it. From sm up it
                sits above the map it drives and pins to the top; on a phone it
                goes last (order-last) and floats on the bottom edge. */}
            <div className="flex flex-col gap-3 sm:gap-4">
              <TelemetryPlayer playing={playing} onToggle={togglePlay} playLabel={playLabel} at={at} n={n} sections={sections} activeN={active?.n ?? null}
                onPick={pickCursor} onJump={jumpSection} hasPrev={!!neighbourSection(sections, at, -1)} hasNext={!!neighbourSection(sections, at, 1)}
                rate={playbackRate} onRate={(r) => { startAtRef.current = at; setPlaybackRate(r); }}
                position={`${position(at)} of lap${active ? ` · §${active.n}` : ''}`} gapAt={delta ? delta.d[at] : null} colorA={colorA} colorB={colorB} />
              <Panel title="Replay" icon={MapIcon} note={hasMap ? null : "This lap was recorded before positions were, so there is no map."}
                actions={hasMap && both && <Segmented label="Map view" value={mapMode} items={[{ key: 'gain', label: 'Time gain' }, { key: 'lines', label: 'Racing lines' }]}
                  onChange={(key) => { setMapMode(key); if (key === 'lines' && zoom < 20) { focusSomewhere(); setZoom(30); } }} />}>
                <div className={`grid min-w-0 gap-4 ${hasMap ? 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start' : ''}`}>
                  {hasMap && <div className="min-w-0">
                    {/* Square on a phone: a circuit that runs taller than wide
                        gets the height it needs; a fixed box from a desktop
                        layout squashed it. */}
                    <div className="relative aspect-square max-h-[460px] w-full overflow-hidden rounded-lg border border-border sm:aspect-auto sm:h-[400px]">
                      <TelemetryTrackMap lapA={lapA} lapB={lapB} n={n} cursor={at} cursorB={bIdx} motionA={motionA} onPick={pickCursor} onReset={()=>setZoom(1)} mode={mapMode} zoom={zoom} track={track} colorA={colorA} colorB={colorB}
                        sections={sections} sectors={sectors || []} activeSection={active?.n ?? null} onSection={selectSection} markers={markers} focusRange={chartZoomed ? visibleRange : null} exportRef={mapSvg}/>
                      {/* Top left on a phone, where the scale bar (bottom left) and the
                          zoom readout (top right) leave room; bottom right from sm up. */}
                      <div className="absolute left-3 top-3 flex flex-wrap gap-1 sm:left-auto sm:top-auto sm:bottom-3 sm:right-3 sm:justify-end">
                        <button type="button" className={ZOOM_BTN} onClick={() => setZoom(1)} aria-label="Show whole track" title="Whole track">Reset</button>
                        <button type="button" className={ZOOM_BTN} onClick={() => {focusSomewhere();setZoom(30);setMapMode('lines');}} title="Zoom to a corner, both lines">Corner</button>
                        <button type="button" className={ZOOM_BTN} onClick={() => {focusSomewhere();setZoom(120);setMapMode('lines');}} title="Close up on the cars">Close-up</button>
                        <button type="button" className={ZOOM_BTN} aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
                        <button type="button" className={ZOOM_BTN} aria-label="Zoom in" onClick={() => { focusSomewhere(); setZoom((z) => Math.min(240, z * 1.5)); }}>+</button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-light">
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
              </Panel>
              <Panel id="telemetry-traces" title="Lap traces" icon={ChartLine} style={{ scrollMarginTop: "var(--tel-top, 84px)" }}
                note={<span className="inline-flex flex-wrap items-center gap-x-3"><span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2" style={{ borderColor: colorA }} />A solid</span>{both && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: colorB }} />B dashed</span>}</span>}
                actions={<Segmented label="Position axis" value={dist ? axisMode : 'pct'} onChange={setAxisMode} items={[{ key: 'pct', label: '% of lap' }, ...(dist ? [{ key: 'dist', label: 'metres' }] : [])]} />}>
                {/* The toolbar: zoom on the left, which stretch is showing and
                    the optional channels on the right. */}
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="inline-flex items-center rounded-lg border border-border bg-surface2 p-0.5">
                      <button type="button" className="h-7 w-7 rounded-md text-sm font-bold text-medium transition hover:bg-card disabled:opacity-30" aria-label="Zoom out of graphs" disabled={!chartZoomed} onClick={() => zoomCharts(0.5)}>−</button>
                      <span className="w-12 text-center font-mono text-xs tabular-nums text-dark">{((n - 1) / chartSpan).toFixed(1)}×</span>
                      <button type="button" className="h-7 w-7 rounded-md text-sm font-bold text-medium transition hover:bg-card disabled:opacity-30" aria-label="Zoom in on graphs" disabled={chartSpan <= minSpan} onClick={() => zoomCharts(2)}>+</button>
                    </div>
                    <button type="button" className="rounded-md px-2 py-1 text-xs font-semibold text-link transition hover:bg-surface2 disabled:text-faint disabled:hover:bg-transparent" disabled={!chartZoomed} onClick={resetCharts}>Full lap</button>
                    <span className="font-mono text-[11px] tabular-nums text-light" aria-label="Visible graph section">{position(visibleRange[0])} – {position(visibleRange[1])}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Optional traces">
                    {OPTIONAL_CHANNELS.filter((c) => c.key !== 'lat' || gA?.lat).map((c) => <Chip key={c.key} on={shows(c.key)} onClick={() => toggleChannel(c.key)}>{c.label}</Chip>)}
                  </div>
                </div>
                {chartZoomed && <div className="flex items-center gap-3 pt-3">
                  <button type="button" className="text-sm text-light disabled:opacity-30" aria-label="Earlier graph section" disabled={visibleRange[0] === 0} onClick={() => panCharts(Math.max(0, visibleRange[0] - Math.round(chartSpan / 2)))}>←</button>
                  <input type="range" aria-label="Move graph section" aria-valuetext={`${(visibleRange[0] / (n - 1) * 100).toFixed(1)} to ${(visibleRange[1] / (n - 1) * 100).toFixed(1)} percent of lap`} min="0" max={n - 1 - chartSpan} step="1" value={visibleRange[0]} onChange={(e) => panCharts(Number(e.target.value))} className="min-w-0 flex-1 cursor-pointer accent-primary" />
                  <button type="button" className="text-sm text-light disabled:opacity-30" aria-label="Later graph section" disabled={visibleRange[1] === n - 1} onClick={() => panCharts(Math.min(n - 1 - chartSpan, visibleRange[0] + Math.round(chartSpan / 2)))}>→</button>
                </div>}
                <div className="space-y-5 pt-4">
                  {both && delta && <div>
                    <ChannelChart {...chartProps} title="Time delta" unit="s · B − A" a={delta.d} lo={-delta.maxAbs} hi={delta.maxAbs} delta height={120} />
                    <p className="ml-12 mt-2 text-[11px] text-light">+ A ahead · − B ahead. Rising: B loses time.</p>
                  </div>}
                  <ChannelChart {...chartProps} title="Speed" unit="km/h" a={lapA.speed} b={lapB?.speed} lo={speedLo} hi={speedHi} height={150} />
                  <PedalChart {...chartProps} a={pedalsA} b={pedalsB} height={160} />
                  {shows('steer') && <ChannelChart {...chartProps} title="Steering" unit="°" a={lapA.steer} b={lapB?.steer} lo={-steerAbs} hi={steerAbs} format={(v) => (v / 10).toFixed(0)} />}
                  {shows('gear') && <ChannelChart {...chartProps} title="Gear" unit="" a={lapA.gear} b={lapB?.gear} lo={0} hi={Math.max(6, ...lapA.gear, ...(lapB?.gear || []))} height={90} />}
                  {shows('lat') && gA?.lat && <ChannelChart {...chartProps} title="Lateral g" unit="g · from the recorded line" a={gA.lat} b={gB?.lat || null} lo={-gRange.lat} hi={gRange.lat} format={(v) => v.toFixed(1)} height={100} />}
                  {shows('long') && gA && <ChannelChart {...chartProps} title="Longitudinal g" unit="g · + accelerating, − braking" a={gA.long} b={gB?.long || null} lo={-gRange.long} hi={gRange.long} format={(v) => v.toFixed(1)} height={100} />}
                  <ChartAxis visibleRange={visibleRange} n={n} dist={dist} mode={axisMode} zoomed={chartZoomed} />
                </div>
                <p className="mt-3 border-t border-border pt-2 text-[11px] text-light">Drag across a graph to zoom into that stretch. Double-click for the full lap. The shaded bands are the slow sections; their numbers zoom to them.</p>
              </Panel>
              {insights.length > 0 && <SectionsPanel insights={insights} activeN={active?.n ?? null} colorA={colorA} colorB={colorB} onSelect={selectSection} />}
            </div>
          </>}
        </>}
    </ToolCard>
  );
}

// Grey shapes where the comparison is about to be, so the page does not jump
// from one line of text to a full dashboard. `compact` when the duel above is
// already drawn and only the channels are on their way.
function TelemetrySkeleton({ label, compact = false }) {
  return (
    <div role="status" aria-label={label} className="space-y-3 sm:space-y-4">
      {!compact && <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_12rem_1fr]">
        <Skeleton className="h-36 rounded-xl" /><Skeleton className="hidden h-36 rounded-xl sm:block" /><Skeleton className="h-36 rounded-xl" />
      </div>}
      <Skeleton className="h-28 rounded-xl" />
      <div className="grid gap-3 lg:grid-cols-2"><Skeleton className="h-72 rounded-xl" /><Skeleton className="hidden h-72 rounded-xl lg:block" /></div>
      <p className="text-center text-xs text-light">{label}</p>
    </div>
  );
}

export default TelemetryCompare;
