// ---------------------------------------------------------------------------
// The race replay: the round played back lap by lap, like the replay a
// broadcast runs after the flag. A timing tower of the front of the field
// (and you, in your team's colour) reshuffles lap by lap from the lap chart's
// positions, your line draws itself across the lap chart, the lap counter
// ticks, and what happened to you pops in as lower-thirds at its lap: the
// start, contacts, pit stops with the tyres, taking the lead, the fastest lap.
// At the flag the result lands.
//
// Only what the payload has: the positions per lap of every car (GET
// /api/races/:id/laps), the grid and the classification (results), and your
// own laps, stints and contacts (story, incidents). There are no gaps or lap
// times for the other cars, so the tower shows places and places gained.
//
// Motion ("Smooth premium"): one shared frame clock (capped to 60 fps, see
// spring.js) that runs while playing or while anything is still settling. The
// replay's time drives targets; what you see follows them on springs: the
// head of your trace and the curtain glide after the lap and ease into every
// hold, the tower's rows ride to their slots keeping their velocity from one
// lap to the next. Only transforms and opacity move; React re-renders when
// the lap changes.
// ---------------------------------------------------------------------------
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, SkipForward, ArrowRight } from "lucide-react";
import { motionOff } from "../../hooks/motion.js";
import { TyreBadge } from "../../components/TyreStrategy.jsx";
import { tyreCompound } from "../../data/liveTiming.js";
import Flag from "../../components/Flag.jsx";
import { flagFor } from "../../data/circuits.js";
import { countryFor } from "../../data/driverCountries.js";
import { fmtLap, fmtLapDelta } from "../../utils/format.js";
import { Spring, onFrame, countEase, useSpringRows } from "./spring.js";

const teamOf = (row) => row?.effectiveTeam || row?.team || null;
// 1st, 2nd, 3rd, 11th, 12th, 13th, 21st, 32nd ...
const nth = (n) => (n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`);

export function rgba(hex, a) {
  const h = String(hex || "").replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(f, 16);
  if (f.length !== 6 || Number.isNaN(n)) return `rgba(148,163,184,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export function inkFor(hex) {
  const h = String(hex || "").replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(f, 16);
  if (f.length !== 6 || Number.isNaN(n)) return "#fff";
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.35 ? "#0b1220" : "#ffffff";
}

// --- the data -------------------------------------------------------------------

// Everything the player needs, worked out once: the running order at the end
// of every lap (lap 0 is the grid), your line, your tyres and lap times per
// lap, the moments worth a graphic, and the clock that plays it all back.
export function buildReplay(laps, shown) {
  if (!laps || !shown?.you) return null;
  const { race, results = [], you, story, incidents } = shown;
  const byId = new Map(results.map((r) => [r.driverId, r]));
  const drivers = (laps.drivers || [])
    .filter((d) => (d.points || []).length > 0)
    .map((d) => {
      const r = byId.get(d.driverId);
      const at = new Map(d.points.map((p) => [p.lap, p.position]));
      const team = teamOf(r);
      return {
        id: d.driverId || d.name,
        name: d.name || r?.name || "?",
        country: countryFor(d.driverId, r?.country) || null,
        color: d.color || team?.color || "#64748b",
        team,
        grid: r?.grid ?? null,
        status: r?.status || "FINISHED",
        final: r?.position ?? null,
        at,
        lastLap: Math.max(...d.points.map((p) => p.lap)),
        points: d.points,
      };
    });
  const me = drivers.find((d) => d.id === you.driverId);
  if (!me || me.points.length < 2) return null;
  const maxLap = Math.max(1, laps.maxLap || 0, ...drivers.map((d) => d.lastLap));
  const hasGrid = drivers.some((d) => d.grid != null);

  // The running order lap by lap. A lapped car keeps its place behind the
  // lead lap once it has no more laps; a car that retired leaves the tower.
  const orders = [];
  for (let L = 0; L <= maxLap; L += 1) {
    const rows = [];
    for (const d of drivers) {
      let key;
      if (L === 0) key = d.grid ?? (d.at.get(1) ?? 99) + 0.5;
      else if (d.at.has(L)) key = d.at.get(L);
      else if (L > d.lastLap) {
        if (d.status !== "FINISHED") continue;
        key = d.at.get(d.lastLap) + 0.5;
      } else {
        let k = L;
        while (k > 0 && !d.at.has(k)) k -= 1;
        key = k ? d.at.get(k) : d.grid ?? 99;
      }
      rows.push({ id: d.id, key, tie: d.final ?? 99 });
    }
    rows.sort((a, b) => a.key - b.key || a.tie - b.tie);
    orders.push(rows.map((r) => r.id));
  }

  // Your position at the line, lap by lap (lap 0 = your grid slot).
  const myPos = new Map(me.points.map((p) => [p.lap, p.position]));
  if (you.grid != null) myPos.set(0, you.grid);
  const myLaps = [...myPos.keys()].sort((a, b) => a - b);
  const maxPos = Math.max(2, drivers.length, ...drivers.flatMap((d) => d.points.map((p) => p.position)));

  // Your laps and tyres.
  const lapTime = new Map((story?.laps || []).map((l) => [l.lap, l.timeMs]));
  const stints = story?.stints || [];
  const stintAt = [];
  const pitLaps = new Map();
  let acc = 0;
  stints.forEach((st, i) => {
    const t = tyreCompound(st.tyre);
    for (let l = acc + 1; l <= acc + st.laps; l += 1) stintAt[l] = { t, age: l - acc, index: i };
    acc += st.laps;
    if (i < stints.length - 1 && acc < maxLap) pitLaps.set(acc, { from: t, to: tyreCompound(stints[i + 1].tyre), laps: st.laps });
  });
  if (stints.length) stintAt[0] = { t: tyreCompound(stints[0].tyre), age: 0, index: 0 };
  const fastest = you.bestLapMs != null && you.lapGapMs === 0;
  const bestLapAt = story?.bestLapAt ?? null;

  // The moments, in the order they would have been called on air.
  const events = [];
  const posAt = (L) => myPos.get(L);
  const starters = race.starters || race.fieldSize || drivers.length;
  events.push({
    id: "start",
    lap: 0,
    tone: "brand",
    label: "Lights out",
    title: you.grid != null ? `From P${you.grid} on the grid` : "Lights out",
    sub: [race.track, race.raceLaps ? `${race.raceLaps} laps` : null, starters ? `${starters} starters` : null].filter(Boolean).join(" · "),
  });
  const lap1 = story?.lap1Pos ?? posAt(1);
  if (lap1 != null && you.grid != null) {
    const d = you.grid - lap1;
    events.push({
      id: "lap1",
      lap: 1,
      tone: d > 0 ? "ok" : d < 0 ? "bad" : "light",
      label: "Lap 1",
      title: lap1 === 1 && you.grid === 1 ? "Leads from pole" : d > 0 ? `Up to P${lap1}` : d < 0 ? `Down to P${lap1}` : `Holds P${lap1}`,
      sub: d > 0 ? `${d} place${d === 1 ? "" : "s"} made at the start` : d < 0 ? `${-d} place${d === -1 ? "" : "s"} lost at the start` : "through the first lap",
    });
  }
  (incidents?.contacts || [])
    .filter((c) => c.lap >= 1 && c.lap <= maxLap)
    .forEach((c, i) => {
      events.push({
        id: `contact${i}`,
        lap: c.lap,
        tone: c.kph >= 60 ? "bad" : c.kph >= 25 ? "warn" : "light",
        label: `Lap ${c.lap} · Contact`,
        title: c.name || "Car contact",
        sub: c.kph != null ? `${c.kph} km/h` : "car contact",
      });
    });
  for (const [lap, p] of pitLaps) {
    const after = posAt(lap);
    events.push({
      id: `pit${lap}`,
      lap,
      tone: "tyre",
      tyreColor: p.to.color,
      label: `Lap ${lap} · Pit stop`,
      tyres: [p.from, p.to],
      title: `${p.from.name} to ${p.to.name.toLowerCase()}`,
      sub: [`${p.laps} laps on ${p.from.name.toLowerCase()}`, after != null ? `P${after} after the stop` : null].filter(Boolean).join(" · "),
    });
  }
  let leads = 0;
  for (let L = 2; L <= maxLap && leads < 3; L += 1) {
    if (posAt(L) === 1 && posAt(L - 1) != null && posAt(L - 1) !== 1) {
      let to = L;
      while (posAt(to + 1) === 1) to += 1;
      leads += 1;
      events.push({
        id: `lead${L}`,
        lap: L,
        tone: "gold",
        label: `Lap ${L}`,
        title: leads > 1 ? "Back in the lead" : "Into the lead",
        sub: to >= maxLap ? `P1 from lap ${L} to the flag` : to === L ? `P1 on lap ${L}` : `P1 from lap ${L} to lap ${to}`,
      });
    }
  }
  if (bestLapAt && fmtLap(you.bestLapMs)) {
    events.push({
      id: "fl",
      lap: bestLapAt,
      tone: "fl",
      label: `Lap ${bestLapAt} · ${fastest ? "Fastest lap" : "Your best lap"}`,
      title: fmtLap(you.bestLapMs),
      sub: fastest ? "fastest lap of the race" : you.lapGapMs != null ? `${fmtLapDelta(you.lapGapMs)} to the fastest lap` : "your quickest lap",
    });
  }
  const rank = { start: 0, lap1: 1, contact: 2, pit: 3, lead: 4, fl: 5 };
  const kind = (e) => e.id.replace(/\d+$/, "");
  events.sort((a, b) => a.lap - b.lap || rank[kind(a)] - rank[kind(b)]);

  // The clock: a lap is a short beat, a moment holds the clock a little
  // longer so its graphic can be read. ~12-15 s for a 30-lap race.
  const lapMs = Math.max(260, Math.min(650, 10200 / maxLap));
  const holdMs = 640;
  const segs = [];
  let t = 0;
  const holdsAt = (lap) => events.filter((e) => e.lap === lap);
  for (const e of holdsAt(0)) {
    segs.push({ kind: "hold", lap: 0, event: e, t0: t, t1: t + 900 });
    t += 900;
  }
  for (let L = 1; L <= maxLap; L += 1) {
    segs.push({ kind: "lap", lap: L, t0: t, t1: t + lapMs });
    t += lapMs;
    for (const e of holdsAt(L)) {
      segs.push({ kind: "hold", lap: L, event: e, t0: t, t1: t + holdMs });
      t += holdMs;
    }
  }
  const T = t;
  const linger = Math.max(1500, lapMs * 3);
  const holds = segs.filter((s) => s.kind === "hold");

  return { drivers, byIdDriver: new Map(drivers.map((d) => [d.id, d])), me, maxLap, maxPos, hasGrid, orders, myPos, myLaps, lapTime, stintAt, pitLaps, fastest, bestLapAt, events, segs, holds, T, lapMs, linger };
}

// Where the replay stands at time t.
function sample(R, t) {
  if (t >= R.T) return { lapF: R.maxLap, tower: R.maxLap, counter: R.maxLap, event: null, next: null, finished: true };
  let seg = R.segs[0];
  for (const s of R.segs) {
    if (t < s.t1) {
      seg = s;
      break;
    }
  }
  let lapF;
  let tower;
  if (seg.kind === "lap") {
    const p = Math.max(0, Math.min(1, (t - seg.t0) / (seg.t1 - seg.t0)));
    lapF = seg.lap - 1 + p;
    tower = p >= 0.45 ? seg.lap : seg.lap - 1;
  } else {
    lapF = seg.lap;
    tower = seg.lap;
  }
  let event = null;
  for (const h of R.holds) {
    if (h.t0 <= t) event = h;
    else break;
  }
  if (event && event.kind === "hold" && t > event.t1 + R.linger) event = null;
  const next = R.holds.find((h) => h.t0 > t && h.event !== event?.event)?.event || null;
  return { lapF, tower, counter: seg.lap, event: event?.event || null, next, finished: false };
}

function myYAt(R, lapF) {
  const lo = Math.floor(lapF);
  const hi = Math.ceil(lapF);
  const find = (l, dir) => {
    let k = l;
    while (k >= 0 && k <= R.maxLap && !R.myPos.has(k)) k += dir;
    return R.myPos.has(k) ? R.myPos.get(k) : null;
  };
  const a = find(lo, -1) ?? find(lo, 1);
  const b = find(hi, 1) ?? a;
  return a + (b - a) * (lapF - lo);
}

function useWide() {
  const q = "(min-width: 1024px)";
  const get = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(q).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, []);
  return wide;
}

// The item that was shown until a moment ago, for as long as its exit runs.
function useOutgoing(item, ms) {
  const [out, setOut] = useState(null);
  const prev = useRef(item);
  useEffect(() => {
    const was = prev.current;
    prev.current = item;
    if (!was || was === item || motionOff()) return undefined;
    setOut(was);
    const id = setTimeout(() => setOut(null), ms);
    return () => clearTimeout(id);
  }, [item, ms]);
  return out;
}

// --- the player -------------------------------------------------------------------

const TONE = {
  brand: "rgb(var(--c-brand))",
  ok: "rgb(var(--c-ok))",
  bad: "rgb(var(--c-bad))",
  warn: "rgb(var(--c-warn))",
  light: "var(--c-text3)",
  gold: "var(--medal-1)",
  fl: "rgb(var(--c-fl))",
};
const KIND = { start: "Start", lap1: "Opening lap", contact: "Contact", pit: "Pit stop", lead: "Lead" };
const kindOf = (e) => (e.id === "fl" ? (e.label.includes("Fastest") ? "Fastest lap" : "Best lap") : KIND[e.id === "lap1" ? "lap1" : e.id.replace(/\d+$/, "")] || "Moment");
const toneOf = (e) => (e.tone === "tyre" ? e.tyreColor : TONE[e.tone] || TONE.brand);

export default function RaceReplay({ R, recap }) {
  const { race, you } = recap;
  const wide = useWide();
  const N = wide ? 10 : 6;
  const rowH = wide ? 34 : 29;
  const W = wide ? 760 : 360;
  const H = wide ? 300 : 184;
  const PAD = wide ? { l: 40, r: 40, t: 16, b: 26 } : { l: 30, r: 30, t: 12, b: 22 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (lap) => PAD.l + (lap / R.maxLap) * plotW;
  const y = (pos) => PAD.t + ((pos - 1) / Math.max(1, R.maxPos - 1)) * plotH;
  const pct = (v, of) => `${(v / of) * 100}%`;

  const tRef = useRef(0);
  const dragRef = useRef(false);
  const playingRef = useRef(false);
  const [playing, setPlayingState] = useState(false);
  const setPlaying = (v) => {
    playingRef.current = v;
    setPlayingState(v);
    if (v) kick();
  };
  const [view, setView] = useState(() => sample(R, 0));
  const [landKey, setLandKey] = useState(0);
  // The opening (the player rising out of depth, its parts gliding in) and
  // the flag's light sweep leave the page once they have run.
  const [intro, setIntro] = useState(() => !motionOff());
  const [sting, setSting] = useState(false);
  const rootRef = useRef(null);
  const curtainRef = useRef(null);
  const dotXRef = useRef(null);
  const dotYRef = useRef(null);
  const fillRef = useRef(null);
  const rangeRef = useRef(null);
  const reduced = useRef(motionOff()).current;
  // The head of the trace: x (0..1 of the laps) and y (0..1 of the places)
  // on springs that trail the replay's clock by a breath.
  const head = useRef(null);
  if (!head.current) head.current = { x: new Spring(0, { omega: 15, zeta: 1, eps: 0.0002 }), y: new Spring(0, { omega: 17, zeta: 0.9, eps: 0.0002 }) };
  const geom = useRef({});
  geom.current = { plotW, W, PAD };

  const writeHead = () => {
    const { x: hx, y: hy } = head.current;
    const g = geom.current;
    if (curtainRef.current) curtainRef.current.style.transform = `translate3d(${((hx.x * g.plotW * 100) / (g.W - g.PAD.l)).toFixed(3)}%,0,0)`;
    if (dotXRef.current) dotXRef.current.style.transform = `translate3d(${(hx.x * 100).toFixed(3)}%,0,0)`;
    if (dotYRef.current) dotYRef.current.style.transform = `translate3d(0,${(hy.x * 100).toFixed(3)}%,0)`;
  };

  const paint = (t, snap = false) => {
    const s = sample(R, t);
    const { x: hx, y: hy } = head.current;
    hx.target = s.lapF / R.maxLap;
    hy.target = (myYAt(R, s.lapF) - 1) / Math.max(1, R.maxPos - 1);
    if (snap || reduced) {
      hx.snap();
      hy.snap();
      writeHead();
    } else kick();
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${t / R.T})`;
    if (rangeRef.current && !dragRef.current) rangeRef.current.value = String(Math.round((t / R.T) * 1000));
    setView((v) => (v.tower === s.tower && v.counter === s.counter && v.event === s.event && v.next === s.next && v.finished === s.finished ? v : s));
  };

  // The clock. Advances the replay while playing and lets the head settle
  // after it stops; unsubscribes itself when both are done.
  const frameRef = useRef(null);
  frameRef.current = (dt) => {
    if (playingRef.current && !dragRef.current) {
      tRef.current = Math.min(R.T, tRef.current + dt * 1000);
      paint(tRef.current);
      if (tRef.current >= R.T) setPlaying(false);
    }
    const a = head.current.x.step(dt);
    const b = head.current.y.step(dt);
    writeHead();
    return playingRef.current || !a || !b;
  };
  const stopRef = useRef(null);
  function kick() {
    if (stopRef.current) return;
    stopRef.current = onFrame((dt) => {
      const more = frameRef.current(dt);
      if (!more) stopRef.current = null;
      return more;
    });
  }
  useEffect(
    () => () => {
      if (stopRef.current) stopRef.current();
      stopRef.current = null;
      playingRef.current = false;
    },
    []
  );

  // Starts itself once it is on screen, after the opening has settled. With
  // reduced motion it opens on the result, and plays only when asked.
  useEffect(() => {
    if (reduced) {
      tRef.current = R.T;
      paint(R.T, true);
      return undefined;
    }
    let timer = 0;
    let io = null;
    const go = () => {
      timer = setTimeout(() => setPlaying(true), 1500);
    };
    const el = rootRef.current;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            io = null;
            go();
          }
        },
        { threshold: 0.3 }
      );
      io.observe(el);
    } else go();
    return () => {
      clearTimeout(timer);
      if (io) io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [R]);

  useLayoutEffect(() => {
    paint(tRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, R]);

  useEffect(() => {
    if (!intro) return undefined;
    const id = setTimeout(() => setIntro(false), 2900);
    return () => clearTimeout(id);
  }, [intro]);
  useEffect(() => {
    if (!view.finished) return undefined;
    setLandKey((k) => k + 1);
    if (reduced) return undefined;
    setSting(true);
    const id = setTimeout(() => setSting(false), 1900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.finished]);

  const toggle = () => {
    if (playing) return setPlaying(false);
    if (tRef.current >= R.T) {
      tRef.current = 0;
      paint(0);
    }
    setPlaying(true);
  };
  // Skipping glides the head the whole way to the flag on its spring.
  const skip = () => {
    setPlaying(false);
    tRef.current = R.T;
    paint(R.T);
  };
  const onScrub = (e) => {
    tRef.current = (Number(e.target.value) / 1000) * R.T;
    paint(tRef.current);
  };

  const flag = flagFor(race.track, race.country);
  const team = you.team?.color || "#94a3b8";
  const L = view.tower;
  const st = R.stintAt[Math.max(0, Math.min(L, R.maxLap))] || null;
  const myOrderPos = R.orders[L].indexOf(R.me.id) + 1 || R.myPos.get(L) || null;
  const lt = L > 0 ? R.lapTime.get(L) : null;
  const ltFastest = R.fastest && L === R.bestLapAt;
  const pit = R.pitLaps.get(L);
  const gainedNow = you.grid != null && myOrderPos ? you.grid - myOrderPos : null;

  // Field lines (static) and your line, the grid slot first where known.
  const linePath = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.lap).toFixed(1)} ${y(p.position).toFixed(1)}`).join(" ");
  const field = useMemo(
    () =>
      R.drivers
        .filter((d) => d !== R.me)
        .map((d) => ({ id: d.id, d: linePath([...(d.grid != null ? [{ lap: 0, position: d.grid }] : []), ...d.points]) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [R, wide]
  );
  const mine = linePath(R.myLaps.map((l) => ({ lap: l, position: R.myPos.get(l) })));
  const posStep = R.maxPos > 24 ? 10 : R.maxPos > 10 ? 5 : 2;
  const posLines = [1, ...Array.from({ length: Math.floor(R.maxPos / posStep) }, (_, i) => (i + 1) * posStep)].filter((v, i, a) => a.indexOf(v) === i && v <= R.maxPos);
  const lapStep = R.maxLap > 40 ? 10 : R.maxLap > 15 ? 5 : 2;
  // A tick too close to the last lap would print on top of its "Lap N" label
  // (the label is wider on a phone, against a narrower axis).
  const lapTicks = Array.from({ length: Math.floor(R.maxLap / lapStep) }, (_, i) => (i + 1) * lapStep).filter((l) => l < R.maxLap && R.maxLap - l >= lapStep * (wide ? 0.5 : 0.8));

  const counter = view.finished ? (
    <span className="flex items-baseline gap-1.5">
      <span className="rr-chequer h-3 w-5 self-center rounded-[2px]" aria-hidden="true" />
      <span className="font-display text-2xl font-black uppercase leading-none tracking-tight text-dark sm:text-3xl">Finish</span>
    </span>
  ) : view.counter === 0 ? (
    <span className="font-display text-2xl font-black uppercase leading-none tracking-tight text-dark sm:text-3xl">Grid</span>
  ) : (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">Lap</span>
      <span key={view.counter} className="rr-tick font-display text-2xl font-black tabular-nums leading-none text-dark sm:text-3xl">
        {view.counter}
      </span>
      <span className="font-mono text-sm font-bold tabular-nums text-light">/{R.maxLap}</span>
    </span>
  );

  const readout = (
    <div className={`grid ${wide ? "grid-cols-4" : "grid-cols-3"} divide-x divide-border border-b border-border`}>
      <div className="px-3 py-2 sm:px-4">
        <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-light">Position</div>
        <div key={`p${myOrderPos}`} className="rr-tick mt-0.5 font-display text-xl font-black leading-none tabular-nums sm:text-2xl" style={{ color: team }}>
          {myOrderPos ? `P${myOrderPos}` : "–"}
        </div>
      </div>
      <div className="px-3 py-2 sm:px-4">
        <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-light">{L > 0 ? `Lap ${L} time` : "Lap time"}</div>
        <div className={`mt-1 font-mono text-sm font-bold tabular-nums leading-none sm:text-lg ${ltFastest ? "text-fl" : pit ? "text-warn" : "text-dark"}`}>
          {L === 0 ? "–" : pit ? "PIT" : fmtLap(lt) || "–"}
        </div>
      </div>
      <div className="px-3 py-2 sm:px-4">
        <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-light">Tyre</div>
        {st ? (
          <div className="mt-0.5 flex items-center gap-1.5">
            <span key={st.index} className="rr-tyre-in">
              <TyreBadge t={st.t} size={wide ? 20 : 17} />
            </span>
            <span className="truncate font-mono text-[11px] font-bold text-medium">{L > 0 ? `lap ${st.age}` : st.t.name.toLowerCase()}</span>
          </div>
        ) : (
          <div className="mt-1 font-mono text-sm text-light">–</div>
        )}
      </div>
      {wide && (
        <div className="px-4 py-2">
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-light">From the grid</div>
          <div className={`mt-1 font-mono text-lg font-bold tabular-nums leading-none ${gainedNow > 0 ? "text-ok" : gainedNow < 0 ? "text-bad" : "text-dark"}`}>
            {gainedNow == null ? "–" : gainedNow > 0 ? `▲ ${gainedNow}` : gainedNow < 0 ? `▼ ${-gainedNow}` : "±0"}
          </div>
        </div>
      )}
    </div>
  );

  const chart = (
    <div className="relative">
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
          <g className="rr-field">
            {field.map((f) => (
              <path key={f.id} d={f.d} fill="none" className="stroke-light" strokeOpacity="0.22" strokeWidth="1" strokeLinejoin="round" />
            ))}
          </g>
          <path d={mine} fill="none" stroke={team} strokeOpacity="0.18" strokeWidth={wide ? 10 : 8} strokeLinejoin="round" strokeLinecap="round" />
          <path d={mine} fill="none" stroke={team} strokeWidth={wide ? 3.5 : 3} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {/* The curtain over the laps still to come: moved, never redrawn. Its
            leading edge is feathered, so the trace fades into view just ahead
            of its head. */}
        <div
          ref={curtainRef}
          className="rr-curtain rr-feather absolute bg-card"
          style={{ left: pct(PAD.l, W), width: pct(W - PAD.l, W), top: 0, bottom: pct(PAD.b - 4, H) }}
          aria-hidden="true"
        />
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label="Your position lap by lap">
          {posLines.map((p) => (
            <g key={p}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} className="stroke-border" strokeWidth="1" strokeOpacity="0.7" />
              <text x={PAD.l - 8} y={y(p) + 3.5} textAnchor="end" className="fill-light font-mono text-[10px] font-bold">
                P{p}
              </text>
            </g>
          ))}
          {lapTicks.map((l) => (
            <g key={l}>
              <line x1={x(l)} x2={x(l)} y1={PAD.t} y2={H - PAD.b} className="stroke-border" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.7" />
              <text x={x(l)} y={H - 7} textAnchor="middle" className="fill-faint font-mono text-[9px] font-bold">
                {l}
              </text>
            </g>
          ))}
          <text x={x(0)} y={H - 7} textAnchor="start" className="fill-light font-mono text-[9px] font-bold uppercase tracking-widest">
            {R.myPos.has(0) ? "Grid" : ""}
          </text>
          <text x={x(R.maxLap)} y={H - 7} textAnchor="end" className="fill-light font-mono text-[9px] font-bold uppercase tracking-widest">
            Lap {R.maxLap}
          </text>
          {/* A mark on the line for each moment, once the replay reaches it. */}
          {R.events
            .filter((e) => e.lap > 0)
            .map((e) => {
              const py = R.myPos.get(e.lap);
              if (py == null) return null;
              const on = view.finished || e.lap <= L;
              return (
                <g key={e.id} className="rr-mark" style={{ opacity: on ? 1 : 0, transformOrigin: `${x(e.lap)}px ${y(py)}px`, transform: on ? "none" : "scale(0.4)" }}>
                  <rect x={x(e.lap) - 4.5} y={y(py) - 4.5} width="9" height="9" transform={`rotate(45 ${x(e.lap)} ${y(py)})`} fill={toneOf(e)} className="stroke-card" strokeWidth="2" />
                </g>
              );
            })}
          {view.finished && wide && (
            <text x={x(R.maxLap) + 8} y={y(R.myPos.get(R.maxLap) ?? 1) + 5} className="rr-fade fill-dark font-display text-[15px] font-black">
              P{you.position ?? R.myPos.get(R.maxLap)}
            </text>
          )}
        </svg>
        {/* The cursor and your car on it: two full-size layers moved by
            translate, so the percentages are of the plot itself. */}
        <div className="pointer-events-none absolute" style={{ left: pct(PAD.l, W), width: pct(plotW, W), top: pct(PAD.t, H), height: pct(plotH, H) }} aria-hidden="true">
          <div ref={dotXRef} className="absolute inset-0" style={{ willChange: "transform" }}>
            <div className="absolute -top-3 bottom-[-6px] left-0 w-px" style={{ background: rgba(team, 0.45) }} />
            <div ref={dotYRef} className="absolute inset-0" style={{ willChange: "transform" }}>
              <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
                {/* The head's soft glow: a static radial halo that rides along. */}
                <div className="rr-halo pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: `radial-gradient(circle, ${rgba(team, 0.42)} 0%, ${rgba(team, 0.16)} 38%, ${rgba(team, 0)} 70%)` }} />
                <div className="relative h-3.5 w-3.5 rounded-full ring-[3px] ring-card" style={{ background: team }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const ev = view.event && !view.finished ? view.event : null;
  // The graphic that was on before this one glides off while the new one
  // settles in.
  const leaving = useOutgoing(ev, 200);
  const third = (e, out) => (
    <div
      key={`${e.id}${out ? "-out" : ""}`}
      className={`${out ? "rr-l3-out" : "rr-l3"} pointer-events-none ${wide ? "absolute bottom-14 left-[3.25rem] z-10 w-[min(20rem,calc(100%-4.5rem))]" : "absolute inset-x-2 top-0"}`}
      role={out ? undefined : "status"}
      aria-live={out ? undefined : "polite"}
      aria-hidden={out || undefined}
    >
      <div className="rr-ev rounded-lg border border-border px-3 py-2 shadow-card">
        <div className="rr-l3-line1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-light">
          <span style={{ color: toneOf(e) }}>{kindOf(e)}</span> · {e.lap === 0 ? "Grid" : `Lap ${e.lap}`}
        </div>
        <div className="rr-l3-line2 mt-1 flex min-w-0 items-center gap-2 font-display text-base font-black uppercase leading-tight tracking-tight" style={{ color: e.tone === "fl" ? "rgb(var(--c-fl))" : "var(--c-text)" }}>
          {e.tyres && (
            <span className="flex shrink-0 items-center gap-1">
              <TyreBadge t={e.tyres[0]} size={16} />
              <ArrowRight className="h-3 w-3 text-light" strokeWidth={2.5} aria-hidden="true" />
              <TyreBadge t={e.tyres[1]} size={16} />
            </span>
          )}
          <span className="truncate">{e.title}</span>
        </div>
        {e.sub && <div className="rr-l3-line3 mt-0.5 truncate font-mono text-[11px] text-light">{e.sub}</div>}
      </div>
    </div>
  );
  const lowerThird = (
    <>
      {leaving && leaving !== ev && third(leaving, true)}
      {ev && third(ev, false)}
    </>
  );

  return (
    <section ref={rootRef} className={`rr-player page-in-steady card relative overflow-hidden ${intro ? "rr-open" : ""}`} aria-label="Race replay" style={{ "--rh": `${rowH}px` }}>
      {intro && (
        <div className="rr-sheen-wrap rr-sheen-open pointer-events-none absolute inset-0 z-30" aria-hidden="true">
          <span className="rr-sheen" style={{ "--sheen-tint": rgba(team, 0.1) }} />
        </div>
      )}
      {/* The broadcast bar: the race on the left, the lap counter on the right,
          the three sector colours underneath. */}
      <div className="flex items-center justify-between gap-3 bg-surface2/70 px-4 py-3 sm:px-5">
        <div className="rr-bar-l flex min-w-0 items-center gap-3">
          {flag && <Flag code={flag.country} w={24} h={18} className="rounded-[2px]" />}
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">Race replay</div>
            <div className="truncate font-display text-base font-black uppercase leading-tight tracking-tight text-dark sm:text-lg">
              {race.track}
              {race.number != null && <span className="ml-2 font-mono text-[11px] font-bold tracking-normal text-light">R{race.number}</span>}
            </div>
          </div>
        </div>
        <div className="rr-bar-r">{counter}</div>
      </div>
      <div className="rr-stripe flex h-[3px]" aria-hidden="true">
        <span className="flex-1 bg-fl" />
        <span className="flex-1 bg-ok" />
        <span className="flex-1 bg-warn" />
      </div>

      <div className={wide ? "grid grid-cols-[minmax(300px,340px),1fr]" : ""}>
        <div className={wide ? "border-r border-border p-4" : "px-3 pb-2 pt-3"}>
          {wide && (
            <div className="mb-2 flex items-baseline justify-between">
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">Running order</div>
              <div className="font-mono text-[10px] text-faint">at the line</div>
            </div>
          )}
          <Tower R={R} lap={L} N={N} rowH={rowH} team={team} you={you} pit={pit} lt={lt} ltFastest={ltFastest} st={st} finished={view.finished} />
        </div>
        <div className="relative min-w-0">
          <div className="rr-readout">{readout}</div>
          <div className={`rr-chart ${wide ? "relative px-3 pb-2 pt-3" : "relative px-1 pb-1 pt-2"}`}>
            {chart}
            {wide && lowerThird}
            {view.finished && <Landing key={landKey} recap={recap} R={R} wide={wide} team={team} />}
          </div>
          {/* On a phone the lower-thirds get a lane of their own under the
              chart, so they never sit on the lines; between moments it says
              what is coming up. */}
          {!wide && (
            <div className="rr-lane relative h-[80px] px-2 pb-1.5">
              {lowerThird}
              {!ev && (
                <div key={view.finished ? "fin" : view.next?.id || "none"} className="rr-lane-note absolute inset-x-2 top-0 flex h-[70px] items-center gap-2 rounded-lg border border-dashed border-border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-faint">
                  {view.finished ? (
                    "Drag the bar to look back at any lap"
                  ) : view.next ? (
                    <>
                      <span className="h-2 w-2 shrink-0 rotate-45" style={{ background: toneOf(view.next) }} />
                      <span className="truncate">Coming up · {view.next.label}</span>
                    </>
                  ) : (
                    "On to the flag"
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {view.finished && sting && (
        <div key={`s${landKey}`} className="rr-sheen-wrap rr-sheen-flag pointer-events-none absolute inset-0 z-20" aria-hidden="true">
          <span className="rr-sheen" style={{ "--sheen-tint": rgba(team, 0.16) }} />
        </div>
      )}

      {/* Transport: play/pause, the scrubber with a tick at every moment, skip. */}
      <div className="rr-transport flex items-center gap-3 border-t border-border px-3 py-2.5 sm:px-5">
        <button
          type="button"
          onClick={toggle}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-onbrand transition hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={playing ? "Pause the replay" : view.finished ? "Play the replay again" : "Play the replay"}
        >
          {playing ? <Pause className="h-4 w-4" strokeWidth={2.5} /> : view.finished ? <RotateCcw className="h-4 w-4" strokeWidth={2.5} /> : <Play className="ml-0.5 h-4 w-4" strokeWidth={2.5} />}
        </button>
        <div className="relative h-9 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface2">
            <div ref={fillRef} className="h-1 w-full origin-left rounded-full" style={{ background: team, transform: "scaleX(0)" }} />
          </div>
          {R.holds
            .filter((h) => h.lap > 0)
            .map((h) => (
              <span
                key={h.event.id}
                className="pointer-events-none absolute top-1/2 h-2.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: `${(h.t0 / R.T) * 100}%`, background: toneOf(h.event) }}
                title={`${h.event.label}: ${h.event.title}`}
              />
            ))}
          <input
            ref={rangeRef}
            type="range"
            min="0"
            max="1000"
            step="1"
            defaultValue="0"
            onInput={onScrub}
            onChange={onScrub}
            onPointerDown={() => (dragRef.current = true)}
            onPointerUp={() => (dragRef.current = false)}
            onPointerCancel={() => (dragRef.current = false)}
            onBlur={() => (dragRef.current = false)}
            className="rr-range absolute inset-0 h-full w-full"
            style={{ "--thumb": team }}
            aria-label="Scrub through the race"
            aria-valuetext={view.finished ? "Finish" : view.counter === 0 ? "Grid" : `Lap ${view.counter} of ${R.maxLap}`}
          />
        </div>
        <button
          type="button"
          onClick={skip}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light transition hover:border-light hover:text-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Skip to the flag"
        >
          <SkipForward className="h-3.5 w-3.5" strokeWidth={2.5} />
          <span className="hidden sm:inline">To the flag</span>
        </button>
      </div>
    </section>
  );
}

// --- the timing tower ---------------------------------------------------------------

function Tower({ R, lap, N, rowH, team, you, pit, lt, ltFastest, st, finished }) {
  const order = R.orders[lap];
  const prev = R.orders[Math.max(0, lap - 1)];
  const meId = R.me.id;
  const myIdx = order.indexOf(meId);
  const pinned = myIdx >= N;
  const slot = (id) => {
    const i = order.indexOf(id);
    if (i < 0) return { s: N, hide: true, pos: null };
    if (pinned) {
      if (id === meId) return { s: N - 1, pos: i + 1 };
      if (i < N - 1) return { s: i, pos: i + 1 };
      return { s: N, hide: true, pos: i + 1 };
    }
    return i < N ? { s: i, pos: i + 1 } : { s: N, hide: true, pos: i + 1 };
  };
  const ink = inkFor(team);
  // Every row rides to its slot on its own spring.
  const node = useSpringRows(
    R.drivers.map((d) => [d.id, slot(d.id).s * rowH]),
    { omega: 13, zeta: 0.84 }
  );
  return (
    <ol className="relative overflow-hidden" style={{ height: N * rowH }} aria-label={lap === 0 ? "The grid" : `Running order after lap ${lap}`}>
      <div className="rr-pin pointer-events-none absolute inset-x-0 border-t border-dashed border-light/50" style={{ top: (N - 1) * rowH - 1, opacity: pinned ? 1 : 0, zIndex: 5 }} aria-hidden="true" />
      {R.drivers.map((d, di) => {
        const { s, hide, pos } = slot(d.id);
        const isMe = d.id === meId;
        const was = prev.indexOf(d.id);
        const now = order.indexOf(d.id);
        const moved = lap > 0 && was >= 0 && now >= 0 ? was - now : 0;
        const gridIdx = R.orders[0].indexOf(d.id);
        return (
          <li
            key={d.id}
            ref={node(d.id)}
            className="rr-row absolute inset-x-0 top-0 bg-card"
            style={{ height: rowH, opacity: hide ? 0 : 1, zIndex: isMe ? 4 : hide ? 1 : moved > 0 ? 3 : 2 }}
            aria-hidden={hide || undefined}
          >
            <div className="rr-row-in flex h-full items-center gap-2 pr-1" style={{ "--i": Math.min(gridIdx < 0 ? N : gridIdx, N) }}>
              <span
                className={`flex h-[calc(100%-6px)] w-7 shrink-0 items-center justify-center rounded-[5px] font-mono text-xs font-bold tabular-nums ${isMe ? "" : pos === 1 ? "bg-dark text-[var(--c-card)]" : "bg-surface2 text-medium"}`}
                style={isMe ? { background: team, color: ink } : undefined}
              >
                {pos ?? ""}
              </span>
              <span
                className={`relative flex h-[calc(100%-6px)] min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-[5px] pl-2 ${isMe ? "" : ""}`}
                style={isMe ? { background: rgba(team, 0.16), boxShadow: `inset 0 0 0 1px ${rgba(team, 0.55)}` } : undefined}
              >
                {/* At the flag a soft light passes along your row. */}
                {isMe && finished && <span className="rr-row-sheen pointer-events-none absolute inset-y-0 left-0 w-full" aria-hidden="true" />}
                <span className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ background: d.color }} />
                {d.country && <Flag code={d.country} w={18} h={13} className="shrink-0 rounded-[2px]" />}
                <span className={`min-w-0 flex-1 truncate font-display text-[13px] font-black uppercase tracking-tight sm:text-sm ${isMe ? "text-dark" : "text-medium"}`}>{d.name}</span>
                {isMe ? (
                  <span className="flex shrink-0 items-center gap-1.5 pr-1.5">
                    {pit && !finished ? (
                      <span className="rounded-[3px] bg-warn px-1 font-mono text-[9px] font-black uppercase leading-[14px] text-[#111827]">Pit</span>
                    ) : lap > 0 && fmtLap(lt) ? (
                      <span className={`font-mono text-[11px] font-bold tabular-nums ${ltFastest ? "text-fl" : "text-medium"}`}>{fmtLap(lt)}</span>
                    ) : (
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-light">{lap === 0 ? "grid" : ""}</span>
                    )}
                    {st && <TyreBadge t={st.t} size={15} />}
                  </span>
                ) : moved !== 0 ? (
                  <span key={`${lap}`} className={`rr-moved shrink-0 pr-1.5 font-mono text-[10px] font-bold tabular-nums ${moved > 0 ? "text-ok" : "text-bad"}`}>
                    {moved > 0 ? `▲${moved}` : `▼${-moved}`}
                  </span>
                ) : null}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// --- the flag -------------------------------------------------------------------------

function useCount(to, delay = 450, duration = 1500) {
  const [n, setN] = useState(motionOff() ? to : 0);
  useEffect(() => {
    if (motionOff() || !Number.isFinite(to)) {
      setN(to);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = () => {
      const p = Math.min(1, Math.max(0, (performance.now() - t0) / duration));
      setN(Math.round(to * countEase(p)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, delay, duration]);
  return n;
}

function Landing({ recap, R, wide, team }) {
  const { you, race } = recap;
  const pts = useCount(you.points || 0, 900);
  const big = !you.raced ? "DNS" : you.finished ? String(you.position) : you.status || "DNF";
  const headline = !you.finished
    ? you.status === "DNF"
      ? "Did not finish"
      : you.status === "DSQ"
        ? "Disqualified"
        : you.status
    : you.position === 1
      ? "Race winner"
      : you.position <= 3
        ? `${nth(you.position)} place, on the podium`
        : you.gained > 0
          ? `Up ${you.gained} from the grid`
          : you.gained < 0
            ? `Down ${-you.gained} from the grid`
            : "Held position from the grid";
  const podium = you.finished && you.position <= 3;
  return (
    <div className="rr-land absolute inset-0 z-10 flex items-center justify-center bg-card/70 p-3 sm:p-4 lg:items-end lg:justify-end lg:bg-transparent lg:pb-10 lg:pr-[4.5rem]">
      <div className="rr-land-card w-full max-w-[30rem] overflow-hidden rounded-xl border border-border bg-card shadow-lift">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface2/70 px-4 py-2">
          <span className="flex items-center gap-2">
            <span className="rr-chequer h-3 w-6 rounded-[2px]" aria-hidden="true" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">Chequered flag</span>
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-light">
            {you.laps ?? R.maxLap} / {R.maxLap} laps
          </span>
        </div>
        <div className="grid grid-cols-[auto,1fr] items-center gap-x-4 gap-y-2.5 px-4 py-3 sm:gap-x-6 sm:px-5 sm:py-4 lg:gap-y-2">
          {/* The result rises out of its mask, then a soft light sweeps across
              the figure: a bright copy of it seen through a feathered window
              that glides over while the copy glides back, so only the light
              appears to move. */}
          <div className="rr-land-p rr-mask flex items-start font-display font-black leading-none tracking-tighter text-dark lg:row-span-2">
            {you.finished && <span className={`rr-land-pp text-light ${wide ? "mt-3 text-4xl" : "mt-2 text-2xl"}`}>P</span>}
            <span className={`rr-land-num relative ${wide ? "text-[6.5rem]" : "text-[4.25rem]"}`} style={{ color: you.finished ? undefined : "rgb(var(--c-bad))", "--glint": podium ? "var(--medal-1)" : team }}>
              {big}
              <span className="rr-glint pointer-events-none absolute inset-0" aria-hidden="true">
                <span className="rr-glint-in absolute inset-0">{big}</span>
              </span>
            </span>
          </div>
          <div className="min-w-0 lg:self-end">
            <div className="rr-land-1 font-display text-lg font-black uppercase leading-tight tracking-tight min-[400px]:text-xl sm:text-2xl" style={{ color: podium ? "var(--medal-1)" : "var(--c-text)" }}>
              {headline}
            </div>
            <div className="rr-land-2 mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-3xl font-black leading-none tabular-nums text-accent sm:text-4xl">
                {you.points > 0 ? `+${pts}` : "0"}
                <span className="ml-1 font-mono text-[10px] font-bold text-light">pts</span>
              </span>
              {you.finished && you.grid != null && (
                <span className="font-mono text-[11px] font-bold text-light">
                  from P{you.grid}
                  {you.gained !== 0 && <span className={you.gained > 0 ? "text-ok" : "text-bad"}> · {you.gained > 0 ? `+${you.gained}` : `−${-you.gained}`}</span>}
                </span>
              )}
            </div>
          </div>
          <div className="rr-land-3 col-span-2 flex flex-wrap gap-1.5 lg:col-span-1 lg:col-start-2 lg:self-start">
              {R.fastest && <span className="rounded-md border border-fl/40 bg-fl/10 px-1.5 py-0.5 sm:px-2 font-mono text-[10px] font-bold uppercase tracking-wide sm:tracking-wider text-fl">Fastest lap</span>}
              {you.lapsLed > 0 && (
                <span className="rounded-md border px-1.5 py-0.5 sm:px-2 font-mono text-[10px] font-bold uppercase tracking-wide sm:tracking-wider text-dark" style={{ borderColor: rgba(team, 0.6) }}>
                  Led {you.lapsLed} lap{you.lapsLed === 1 ? "" : "s"}
                </span>
              )}
              {race.finishers ? <span className="rounded-md border border-border px-1.5 py-0.5 sm:px-2 font-mono text-[10px] font-bold uppercase tracking-wide sm:tracking-wider text-light">of {race.finishers} classified</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// The frame the player sits in while the lap chart is on its way.
export function ReplaySkeleton({ recap }) {
  const { race } = recap;
  const flag = flagFor(race.track, race.country);
  return (
    <section className="rr-player card relative overflow-hidden" aria-label="Race replay" aria-busy="true">
      <div className="flex items-center justify-between gap-3 bg-surface2/70 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {flag && <Flag code={flag.country} w={24} h={18} className="rounded-[2px]" />}
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-eyebrow">Race replay</div>
            <div className="font-display text-base font-black uppercase leading-tight tracking-tight text-dark sm:text-lg">{race.track}</div>
          </div>
        </div>
        <span className="font-display text-2xl font-black uppercase leading-none tracking-tight text-faint sm:text-3xl">Grid</span>
      </div>
      <div className="flex h-[3px]" aria-hidden="true">
        <span className="flex-1 bg-fl" />
        <span className="flex-1 bg-ok" />
        <span className="flex-1 bg-warn" />
      </div>
      <div className="h-[460px] animate-pulse bg-surface2/30 lg:h-[420px]" />
    </section>
  );
}
