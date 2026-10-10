import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Minus, Plus, X } from "lucide-react";
import { api } from "../api/client.js";
import { circuitForLive } from "../data/circuits.js";
import { aerialForTrack } from "../data/aerialMaps.js";
import SlidingTabs from "./SlidingTabs.jsx";

// Live track map. Two modes:
//
//  1. REAL map (preferred): when the session ships map calibration, we draw the
//     server manager's own overhead map.png (proxied at /api/live/map.png) and
//     place each car by its REAL world position (ET53 Pos), projected with the
//     map.ini calibration. These positions are exact, so no "approximate" caveat.
//  2. STYLISED fallback: no calibration -> the shared circuit outline with cars
//     walked along the SVG path by NormalisedSplinePos (indicative, not surveyed).
//
// SECTORS: once the circuit's sector lines are known (session.sectorLines,
// learned from laps on the backend) the lap is drawn in three colours with the
// start line and the two sector lines marked. On the real map the coloured
// line is the middle of the road from the track's AI line (/api/live/track-line),
// which starts where the lap starts; on the outline it is the outline itself,
// which is the same path the cars are walked along. No lines known, no colours:
// the map never guesses thirds.
//
// CARS are round markers in the team colour with the race number on them, and
// a short name tag beside the followed car and the first few of the running
// order. Tags take whichever corner of their car is free, and a leader whose
// tag would land on another tag or car goes without, so a bunched field reads
// as numbers instead of a pile of labels.
//
// MOTION: the board only updates every ~700ms (and per-car telemetry can be
// sparser), so a CSS transition made the cars surge-and-stall. Instead a
// requestAnimationFrame loop interpolates every car's position between its last
// two updates and drives the follow-camera from the same interpolated point.
// Lite graphics / reduced motion snap to the newest data instead.
//
// FOCUS MODE (both variants): clicking a car zooms onto it and follows; the
// +/- controls change how close (to read two cars side by side, zoom in).
// Clicking anywhere else zooms back out. The followed car's cockpit numbers
// (speed, gear, revs) sit in a panel bottom left, under the map on a phone.
//
// AC map.pngs draw the circuit on transparency: dark asphalt with white edges.
// That reads on a dark card as-is; the light theme inverts the image so the
// asphalt comes out pale and the edges black (see .live-map in index.css).

const ZOOM_DEFAULT = 3;
const ZOOM_MIN = 1.6;
const ZOOM_MAX = 7;

// Where a car is RIGHT NOW between its last two updates. Gliding starts when
// an update lands (from wherever the car was rendered at that moment) and
// takes as long as the gap between the two updates — so an irregular feed
// still reads as one continuous speed.
function interpNow(st, now) {
  const f = Math.min(1, Math.max(0, (now - st.next.t) / (st.dur || 700)));
  return {
    x: st.prev.x + (st.next.x - st.prev.x) * f,
    y: st.prev.y + (st.next.y - st.prev.y) * f,
  };
}

// The rAF driver shared by both map variants: feeds car updates into per-car
// interpolation states and writes transforms straight to the DOM every frame
// (no React re-render per frame). Also steers the follow-camera, and keeps the
// markers marker-sized while the camera is zoomed in: the marker group is
// scaled down by the square root of the zoom, written only when that changes.
function useSmoothCars({ dots, focusGuid, zoom, camInfo }) {
  const els = useRef(new Map()); // guid -> { el, car, k }
  const states = useRef(new Map()); // guid -> { prev, next }
  const camRef = useRef(null);
  const liveRef = useRef({ focusGuid, zoom, camInfo, zoomShown: 1, cameraX: null, cameraY: null });
  liveRef.current.focusGuid = focusGuid;
  liveRef.current.zoom = zoom;
  liveRef.current.camInfo = camInfo;

  const register = useCallback((guid) => (el) => {
    if (el) els.current.set(guid, { el, car: el.querySelector("[data-car]"), k: null });
    else els.current.delete(guid);
  }, []);

  // New board data: current rendered point becomes the glide's start.
  useEffect(() => {
    const now = performance.now();
    const seen = new Set();
    for (const d of dots) {
      seen.add(d.guid);
      const st = states.current.get(d.guid);
      if (!st) {
        states.current.set(d.guid, {
          prev: { x: d.x, y: d.y, t: now },
          next: { x: d.x, y: d.y, t: now },
          lastAt: now,
          dur: 700,
        });
      } else {
        // Only a real movement counts as an update. The upstream's per-car
        // telemetry is often sparser than the board tick, so the same position
        // arrives on several boards in a row — and re-stamping those made the
        // car sprint for one tick, then stand still until its next real fix
        // (the surge-and-stall rhythm race night made visible). Skipped, the
        // glide below spans the car's ACTUAL update gap instead: constant
        // speed, however irregular the feed.
        if (d.x === st.next.x && d.y === st.next.y) continue;
        const cur = interpNow(st, now);
        // Glide duration = the actual gap since the previous update, so the
        // car arrives exactly when the next update is due — constant speed
        // even on an irregular feed. (next.t - prev.t is useless here: both
        // are stamped right now.)
        st.dur = Math.min(2000, Math.max(120, now - st.lastAt));
        st.lastAt = now;
        st.prev = { ...cur, t: now };
        st.next = { x: d.x, y: d.y, t: now };
      }
    }
    for (const g of [...states.current.keys()]) if (!seen.has(g)) states.current.delete(g);
  }, [dots]);

  useEffect(() => {
    let raf;
    let lastFrame = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(now - lastFrame, 64);
      lastFrame = now;
      const { focusGuid: fg, zoom: zTarget, camInfo: ci } = liveRef.current;
      const instant =
        document.documentElement.classList.contains("fx-lite") ||
        (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      const k = 1 / Math.sqrt(liveRef.current.zoomShown);
      let focusPos = null;
      for (const [guid, st] of states.current) {
        const reg = els.current.get(guid);
        const p = instant ? { x: st.next.x, y: st.next.y } : interpNow(st, now);
        if (reg) {
          reg.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
          if (reg.car && reg.k !== k) {
            reg.k = k;
            reg.car.setAttribute("transform", `${reg.car.dataset.rot ? `rotate(${reg.car.dataset.rot}) ` : ""}scale(${k})`);
          }
        }
        if (guid === fg) focusPos = p;
      }
      const cam = camRef.current;
      if (cam && ci) {
        // Ease BOTH camera position and zoom from the currently displayed view.
        // Switching drivers or returning to overview can interrupt the flight.
        const target = focusPos ? zTarget : 1;
        const blend = instant ? 1 : 1 - Math.exp(-dt / 190);
        const z = liveRef.current.zoomShown + (target - liveRef.current.zoomShown) * blend;
        // Settle exactly on the target, so the marker scale above stops being
        // rewritten once the camera has arrived.
        liveRef.current.zoomShown = Math.abs(target - z) < 0.002 ? target : z;
        const cx = ci.w / 2, cy = ci.h / 2;
        const state = liveRef.current;
        state.cameraX ??= cx;
        state.cameraY ??= cy;
        state.cameraX += ((focusPos?.x ?? cx) - state.cameraX) * blend;
        state.cameraY += ((focusPos?.y ?? cy) - state.cameraY) * blend;
        cam.style.transform = `translate(${cx - z * state.cameraX}px, ${cy - z * state.cameraY}px) scale(${z})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return { register, camRef };
}

// How big one viewBox unit is on screen, from the svg's rendered box ("meet"
// scaling: the smaller of the two ratios). Measured once per resize, never
// per frame. Null until the first measurement.
function useFitScale(el, vbW, vbH) {
  const [box, setBox] = useState(null);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((b) => (b && Math.abs(b.w - width) < 1 && Math.abs(b.h - height) < 1 ? b : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  if (!box || !box.w || !box.h || !vbW || !vbH) return null;
  const s = Math.min(box.w / vbW, box.h / vbH);
  return { s, drawnW: vbW * s };
}

// Marker radius in viewBox units. Sized for the SCREEN rather than for the
// circuit: a share of the map's own size made the numbers unreadable on a
// phone and needlessly big on a wide one. Between 8.5 and 14 px, growing with
// the map; the circuit-relative size stands in until the map is measured.
function markerRadius(fit, fallback) {
  if (!fit) return fallback;
  const px = Math.min(14, Math.max(8.5, fit.drawnW * 0.017));
  return px / fit.s;
}

// Dark or white type on a team colour, whichever reads.
function inkOn(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || ""));
  if (!m) return "#ffffff";
  const hex = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#0f172a" : "#ffffff";
}

// Three letters for the name tag, F1 style: the first three of the name.
function tagCode(name) {
  const letters = String(name || "").replace(/[^\p{L}\p{N}]/gu, "");
  return (letters.slice(0, 3) || "?").toUpperCase();
}

// AC's raw gear: 0 = reverse, 1 = neutral, 2 = first.
function gearLabel(g) {
  return g === 0 ? "R" : g === 1 ? "N" : g - 1;
}

// One car as the map draws it, whichever of the two maps it is on.
function toDot(car, x, y, matchFn) {
  const m = matchFn ? matchFn(car.name) : null;
  const color = m?.teamColor || "#94a3b8";
  const title = m?.nabsName || car.name;
  // The disc carries the running position: on a map the question is who is
  // where in the race, and a race number answers it only for whoever knows
  // the numbers by heart. Without a position yet, the number, then initials.
  const label = car.isSafetyCar
    ? "SC"
    : car.racePosition != null
      ? String(car.racePosition)
      : car.raceNumber != null
        ? String(car.raceNumber)
        : (car.initials || car.name || "").slice(0, 3);
  return {
    guid: car.guid,
    x,
    y,
    color,
    ink: inkOn(color),
    label,
    title,
    code: tagCode(title),
    inPits: !!car.inPits,
    isSafetyCar: !!car.isSafetyCar,
  };
}

// ---- Name tags ---------------------------------------------------------------

// Tag size and the four corners it may sit in, in multiples of the marker
// radius, relative to the car (screen orientation: up is up).
const TAG_W = 3.5;
const TAG_H = 1.7;
const TAG_GAP = 0.85;
function tagSpots(r) {
  const w = r * TAG_W, h = r * TAG_H, g = r * TAG_GAP;
  return [
    { x: g, y: -g - h, w, h }, // up right
    { x: -g - w, y: -g - h, w, h }, // up left
    { x: g, y: g, w, h }, // down right
    { x: -g - w, y: g, w, h }, // down left
  ];
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Which cars get a tag, and in which corner. The followed car always has one;
// then the first `cap` cars of the running order (the board's own order), each
// in the first corner that is clear of the tags already placed and of every
// other car's marker, keeping last time's corner while it stays clear so tags
// do not hop around. A car with no clear corner simply goes without. Worked
// out once per board update, not per frame.
function placeTags({ dots, focusGuid, r, k, rotated, H, cap, last }) {
  // Tags are drawn upright, so the sums are done the way the map is SHOWN:
  // a portrait circuit is turned a quarter (see RealTrackMap).
  const screen = (d) => (rotated ? { x: H - d.y, y: d.x } : { x: d.x, y: d.y });
  const pts = dots.map((d) => ({ guid: d.guid, ...screen(d) }));
  const at = new Map(pts.map((p) => [p.guid, p]));
  const spots = tagSpots(r);
  const rr = r * k;
  const hitsCar = (rect, own) =>
    pts.some((p) => p.guid !== own && overlaps(rect, { x: p.x - rr, y: p.y - rr, w: rr * 2, h: rr * 2 }));
  const rectAt = (p, i) => ({ x: p.x + spots[i].x * k, y: p.y + spots[i].y * k, w: spots[i].w * k, h: spots[i].h * k });

  const want = [];
  const focus = dots.find((d) => d.guid === focusGuid);
  if (focus) want.push(focus);
  for (const d of dots) {
    if (want.length >= cap + (focus ? 1 : 0)) break;
    if (d.guid === focusGuid || d.inPits || d.isSafetyCar) continue;
    want.push(d);
  }

  const placed = [];
  const out = new Map();
  for (const d of want) {
    const p = at.get(d.guid);
    const prev = last.get(d.guid);
    const order = prev != null ? [prev, 0, 1, 2, 3] : [0, 1, 2, 3];
    let chosen = order.find((i) => {
      const rect = rectAt(p, i);
      return !placed.some((q) => overlaps(q, rect)) && !hitsCar(rect, d.guid);
    });
    // The followed car is first in line, so nothing has been placed yet: only
    // other cars can be in the way, and it gets its tag regardless.
    if (chosen == null && d.guid === focusGuid) chosen = prev ?? 0;
    if (chosen == null) continue;
    placed.push(rectAt(p, chosen));
    out.set(d.guid, chosen);
  }
  last.clear();
  for (const [g, i] of out) last.set(g, i);
  return out;
}

// One car marker: a disc in the team colour with the race number on it, the
// name tag when it has one, and a halo while it is the followed car. The disc,
// tag and halo sit in one group the rAF driver scales (see useSmoothCars), and
// that group turns back upright on a portrait map. Clickable to (un)follow.
function CarMarker({ d, r, spot, isFocusTarget, counterRotate, onFocus, registerRef, aerial = false }) {
  const tag = spot != null ? tagSpots(r)[spot] : null;
  const stripe = r * 0.34;
  const fs = d.label.length >= 3 ? r * 0.78 : r * 0.98;
  return (
    <g
      ref={registerRef}
      style={{ transform: `translate(${d.x}px, ${d.y}px)`, opacity: d.inPits ? (aerial ? 0.8 : 0.45) : 1, cursor: "pointer" }}
      onClick={(ev) => {
        ev.stopPropagation();
        onFocus(isFocusTarget ? null : d.guid);
      }}
    >
      <title>{d.title}</title>
      <g data-car data-rot={counterRotate ? "-90" : undefined} transform={counterRotate ? "rotate(-90) scale(1)" : "scale(1)"}>
        {isFocusTarget && (
          <>
            <circle r={r * 2.2} className="fill-brand/35" />
            <circle r={r * 1.55} fill="none" className="stroke-brand" strokeWidth={r * 0.28} />
          </>
        )}
        {/* generous invisible hit area, a small disc is fiddly to tap */}
        <circle r={r * 1.6} fill="transparent" stroke="none" />
        <circle r={r} fill={d.color} stroke="#ffffff" strokeWidth={r * 0.2} />
        <text
          y={r * 0.04}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fs}
          fontWeight="800"
          fill={d.ink}
          className="font-mono"
          style={{ pointerEvents: "none" }}
        >
          {d.label}
        </text>
        {tag && (
          <g transform={`translate(${tag.x} ${tag.y})`} style={{ pointerEvents: "none" }}>
            {/* The followed car's tag in the series colour; the rest in the
                text colour, so dark on the light map and light on the dark. */}
            <rect width={tag.w} height={tag.h} rx={r * 0.36} className={isFocusTarget ? "fill-brand" : "fill-dark"} />
            <rect width={stripe} height={tag.h} fill={d.color} />
            <text
              x={(tag.w + stripe) / 2}
              y={tag.h / 2 + r * 0.04}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={r * 1.05}
              fontWeight="800"
              className={`font-mono ${isFocusTarget ? "fill-onbrand" : "fill-card"}`}
            >
              {d.code}
            </text>
          </g>
        )}
      </g>
    </g>
  );
}

// The tags for a set of dots, recomputed per board update.
function useTags({ dots, focusGuid, zoom, r, rotated, H }) {
  const last = useRef(new Map());
  // Name tags for the top three only (plus the car being followed, which
  // placeTags always adds): more than that and a bunched field turns into a
  // pile of labels.
  const cap = 3;
  return useMemo(
    () => placeTags({ dots, focusGuid, r, k: focusGuid ? 1 / Math.sqrt(zoom) : 1, rotated, H, cap, last: last.current }),
    [dots, focusGuid, zoom, r, rotated, H, cap]
  );
}

// ---- Sectors -----------------------------------------------------------------

// The lap as a polyline (first point = start line), cut into its three
// sectors, with a way to find any point on it by share of the lap.
function sectorGeometry(points, lines) {
  if (!points || points.length < 3 || !lines) return null;
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  if (!total) return null;
  const at = (f) => {
    const want = Math.min(1, Math.max(0, f)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < want) i++;
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const span = cum[i] - cum[i - 1] || 1;
    const t = (want - cum[i - 1]) / span;
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI };
  };
  const slice = (f0, f1) => {
    const a = at(f0), b = at(f1);
    const mid = [];
    for (let i = 0; i < points.length; i++) {
      const s = cum[i] / total;
      if (s > f0 && s < f1) mid.push(points[i]);
    }
    return `M${[[a.x, a.y], ...mid, [b.x, b.y]].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")}`;
  };
  const [s1, s2] = lines.map((v) => v / 100);
  return { paths: [slice(0, s1), slice(s1, s2), slice(s2, 1)], at, cuts: [s1, s2] };
}

// The coloured lap plus its three markers: a bar across the start line and a
// labelled disc at each sector line. `width` is the coloured line's weight in
// viewBox units, or in screen pixels with `nonScaling`. `r` sizes the markers.
function SectorTrack({ geo, width, r, counterRotate, nonScaling = false }) {
  const upright = counterRotate ? " rotate(-90)" : "";
  const sf = geo.at(0);
  const barLen = r * 2.6;
  const rad = (sf.angle * Math.PI) / 180;
  // Along the bar (across the track), beyond its end: where the S/F label goes.
  const nx = -Math.sin(rad), ny = Math.cos(rad);
  const lab = barLen / 2 + r * 0.9;
  return (
    <g pointerEvents="none">
      {geo.paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={`var(--live-s${i + 1})`}
          strokeWidth={width}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect={nonScaling ? "non-scaling-stroke" : undefined}
        />
      ))}
      <g transform={`translate(${sf.x} ${sf.y}) rotate(${sf.angle})`}>
        <rect x={-r * 0.2} y={-barLen / 2} width={r * 0.4} height={barLen} className="fill-dark" />
      </g>
      <g transform={`translate(${sf.x + nx * lab} ${sf.y + ny * lab})${upright}`}>
        <text textAnchor="middle" dominantBaseline="central" fontSize={r * 0.8} fontWeight="700" className="fill-dark font-mono">
          S/F
        </text>
      </g>
      {geo.cuts.map((f, i) => {
        const p = geo.at(f);
        return (
          <g key={i} transform={`translate(${p.x} ${p.y})${upright}`}>
            <circle r={r * 0.78} className="fill-card stroke-dark" strokeWidth={r * 0.14} />
            <text y={r * 0.03} textAnchor="middle" dominantBaseline="central" fontSize={r * 0.66} fontWeight="800" className="fill-dark font-mono">
              S{i + 2}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// Sector lines as the board sends them, or null when they are not two sane
// shares of the lap in order.
function validLines(lines) {
  if (!Array.isArray(lines) || lines.length !== 2) return null;
  const [a, b] = lines.map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && a < b && b < 100 ? [a, b] : null;
}

// A contact on the map (TV board, race control only), for the few seconds
// after it happened: the same explosion the server manager's own map uses
// (its splosion.gif, MIT, see public/race-control/), and then nothing. Drawn
// under the cars, so the cars stay clickable.
const SPLOSION = "/race-control/splosion.gif";
function IncidentMark({ x, y, r, inc }) {
  const size = r * 6;
  return (
    <g transform={`translate(${x} ${y})`}>
      <title>{inc.title}</title>
      <image href={SPLOSION} x={-size / 2} y={-size / 2} width={size} height={size} className="rc-burst" />
    </g>
  );
}

// Project a world position onto the map.png's intrinsic pixel space. This is the
// server manager's own live-map formula, lifted from its client verbatim:
//   pixel = (world + offset) / scale_factor + padding
// No axis flips — validated against captured on-track telemetry, which lands
// exactly on the drawn band this way (an earlier Y-flip only grazed it by luck).
function projectXZ(x, z, map) {
  const pad = map.padding || 0;
  return map.affine
    ? [map.affine[0] * x + map.affine[2] * z + map.affine[4], map.affine[1] * x + map.affine[3] * z + map.affine[5]]
    : [(x + map.xOffset) / map.scaleFactor + pad, (z + map.zOffset) / map.scaleFactor + pad];
}

// The circuit's centre line for the real map, fetched once per track (the
// map version changes with the track). Null while loading or when the race
// server does not publish the track's AI line.
function useTrackLine(ver, server) {
  const [line, setLine] = useState(null);
  useEffect(() => {
    setLine(null);
    if (ver == null) return undefined;
    let live = true;
    api
      .liveTrackLine(server, ver)
      .then((res) => {
        if (live && Array.isArray(res?.line) && res.line.length >= 3) setLine(res.line);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ver, server]);
  return line;
}

// Tall maps lie down: like the server manager's own live map (which rotates
// anything with height/width > 1.07), a portrait circuit turns 90° so the panel
// stays a sensible landscape instead of a skyscraper of empty margin.
const ROTATE_RATIO = 1.07;

function RealTrackMap({ cars, map, matchFn, focusGuid, zoom, onFocus, server = null, className = "", onImageError, aerial = false, aerialLoaded = false, onAerialLoad, loadAerial = false, aerialMap, incidents = null, line = null, sectorLines = null }) {
  const W = map.width;
  const H = map.height;
  const rotated = H / W > ROTATE_RATIO;
  // Project the aerial into the existing map's coordinates. Cars and camera
  // never remount or change coordinate systems when switching backgrounds.
  const [a, b, c, d, e, f] = aerialMap?.affine || [1, 0, 0, 1, 0, 0];
  const det = a * d - b * c;
  const scale = map.scaleFactor;
  const pad = map.padding || 0;
  const aerialTransform = `matrix(${d / det / scale} ${-b / det / scale} ${-c / det / scale} ${a / det / scale} ${(c * f - d * e) / det / scale + map.xOffset / scale + pad} ${(b * e - a * f) / det / scale + map.zOffset / scale + pad})`;
  const showAerial = aerial && aerialLoaded;
  // The calibration as a value that only changes when the numbers do: the
  // board hands over a fresh `map` object every tick, and the sector line
  // below should not be re-projected for nothing.
  const affineKey = map.affine ? map.affine.join(",") : "";
  const cal = useMemo(
    () => ({
      scaleFactor: map.scaleFactor,
      xOffset: map.xOffset,
      zOffset: map.zOffset,
      padding: map.padding,
      affine: affineKey ? affineKey.split(",").map(Number) : null,
    }),
    [map.scaleFactor, map.xOffset, map.zOffset, map.padding, affineKey]
  );
  const dots = useMemo(
    () =>
      (cars || [])
        .filter((car) => car.pos)
        .map((car) => {
          const [x, y] = projectXZ(car.pos.x, car.pos.z, cal);
          return toDot(car, x, y, matchFn);
        }),
    [cars, cal, matchFn]
  );
  const { register, camRef } = useSmoothCars({ dots, focusGuid, zoom, camInfo: { w: W, h: H } });
  const [svgEl, setSvgEl] = useState(null);
  const fit = useFitScale(svgEl, rotated ? H : W, rotated ? W : H);
  // The circuit-relative size is what the markers had before the map is
  // measured, and what incidents keep.
  const rBase = Math.max(W, H) * 0.014;
  const r = markerRadius(fit, rBase);
  const tags = useTags({ dots, focusGuid, zoom, r, rotated, H });
  // The coloured lap: the AI line's middle, projected like the cars. About
  // four metres wide, a third of the band map.png paints for the road, and
  // never thinner than two and a half pixels on screen.
  const geo = useMemo(
    () => (line && sectorLines ? sectorGeometry([...line, line[0]].map(([x, z]) => projectXZ(x, z, cal)), sectorLines) : null),
    [line, sectorLines, cal]
  );
  const lineWidth = Math.max(4 / (scale || 1), fit ? 2.5 / fit.s : 0);
  return (
    <div className={`live-map overflow-hidden rounded-xl ${className}`}>
      {/* Width-driven: the SVG takes its height from the (rotated) aspect ratio,
          so the card hugs the map instead of stretching to a tall empty box.
          The max-height only caps a very wide column. */}
      <svg
        ref={setSvgEl}
        viewBox={rotated ? `0 0 ${H} ${W}` : `0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="mx-auto block h-auto max-h-[70vh] w-full"
        role="img"
        aria-label={`Live track map, ${dots.length} cars`}
        onClick={() => onFocus(null)}
      >
        {/* One group carries the rotation, so image and cars turn together. */}
        <g transform={rotated ? `translate(${H} 0) rotate(90)` : undefined}>
          {/* The camera group, driven per-frame by useSmoothCars. */}
          <g ref={camRef}>
            {/* Which server's circuit to draw. `server` is the Live page's
                switch and wins; without it the series' own assignment decides,
                exactly as before. Getting this wrong is not subtle: the cars
                would run around a different track from the one they are on. */}
            <image
              className="transition-opacity duration-500 ease-in-out motion-reduce:transition-none"
              style={{ opacity: showAerial ? 0 : 1 }}
              href={`/api/live/map.png?v=${map.ver || 0}${(() => {
                const slug = /^\/s\/([^/]+)/.exec(window.location.pathname)?.[1];
                const parts = [];
                if (slug) parts.push(`series=${encodeURIComponent(slug)}`);
                if (server) parts.push(`server=${encodeURIComponent(server)}`);
                return parts.length ? `&${parts.join("&")}` : "";
              })()}`}
              width={W}
              height={H}
            />
            {loadAerial && (
              <image
                href={aerialMap.image}
                width={aerialMap.width}
                height={aerialMap.height}
                transform={aerialTransform}
                style={{ filter: "none", opacity: showAerial ? 1 : 0, pointerEvents: "none" }}
                className="transition-opacity duration-500 ease-in-out motion-reduce:transition-none"
                onLoad={onAerialLoad}
                onError={onImageError}
              />
            )}
            <g opacity={showAerial ? 1 : 0} className="transition-opacity duration-500 motion-reduce:transition-none" pointerEvents="none">
              {(aerialMap?.gates || []).map(gate => {
                const point = ([x, z]) => [(x + map.xOffset) / scale + pad, (z + map.zOffset) / scale + pad];
                const left = point(gate.l), right = point(gate.r);
                const x = (left[0] + right[0]) / 2, y = (left[1] + right[1]) / 2;
                const label = gate.index === 0 ? "START / FINISH" : `S${gate.index}`;
                return <g key={gate.index} aria-label={label}>
                  <line x1={left[0]} y1={left[1]} x2={right[0]} y2={right[1]} stroke="#111827" strokeWidth={rBase * 0.5} />
                  <line x1={left[0]} y1={left[1]} x2={right[0]} y2={right[1]} stroke={gate.index === 0 ? "white" : "#ffcf73"} strokeWidth={rBase * 0.23} />
                  <g transform={`translate(${x} ${y})${rotated ? " rotate(-90)" : ""}`}>
                    <text y={rBase * 1.7} textAnchor="middle" fill="white" stroke="#111827" strokeWidth={rBase * 0.22} paintOrder="stroke" fontSize={rBase * 1.15} fontWeight="700">{label}</text>
                  </g>
                </g>;
              })}
            </g>
            {/* The satellite view has its own start line and sector gates
                (above), so the coloured lap steps aside for it. */}
            {geo && (
              <g opacity={showAerial ? 0 : 1} className="transition-opacity duration-500 motion-reduce:transition-none">
                <SectorTrack geo={geo} width={lineWidth} r={(r * 0.9) / (focusGuid ? Math.sqrt(zoom) : 1)} counterRotate={rotated} />
              </g>
            )}
            {(incidents || []).map((inc) => {
              if (inc.x == null || inc.z == null) return null;
              const [x, y] = projectXZ(inc.x, inc.z, cal);
              return <IncidentMark key={inc.id} x={x} y={y} r={rBase / (focusGuid ? Math.sqrt(zoom) : 1)} inc={inc} />;
            })}
            {dots.map((dot) => (
              <CarMarker
                key={dot.guid}
                d={dot}
                r={r}
                spot={tags.get(dot.guid)}
                isFocusTarget={dot.guid === focusGuid}
                counterRotate={rotated}
                onFocus={onFocus}
                registerRef={register(dot.guid)}
                aerial={showAerial}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

// How finely the outline is sampled for its sector colours. The outlines are
// smooth hand-drawn curves; a few hundred points is more than a screen shows.
const OUTLINE_SAMPLES = 360;

// The stylised circuit outline with cars placed by walking the SVG path.
// Known, accepted approximation: the stored path's start point and winding
// direction aren't guaranteed to match the real start/finish or driving
// direction, so the positions are indicative. Unknown tracks render nothing.
// The sector colours walk the same path by the same share of the lap, so they
// agree with where the cars are drawn, approximation and all.
function StylisedTrackMap({ track, trackId, cars, matchFn, focusGuid, zoom, onFocus, className = "", incidents = null, sectorLines = null }) {
  // The same resolver the card around this map uses to decide there IS an
  // outline to show. It used to be the plain lookup, which knows "Most" but
  // not "NABS Autodrom Most (no chicane)" — so the card promised a map and
  // this drew nothing, every time the real map was missing. (2026-09-04.)
  const circuit = circuitForLive(track, trackId);
  const pathRef = useRef(null);
  const [len, setLen] = useState(0);

  useEffect(() => {
    if (pathRef.current) setLen(pathRef.current.getTotalLength() || 0);
  }, [circuit?.path]);

  const dots = useMemo(() => {
    if (!len || !pathRef.current) return [];
    return (cars || []).map((car) => {
      const s = (((Number(car.spline) || 0) % 1) + 1) % 1;
      const pt = pathRef.current.getPointAtLength(s * len);
      return toDot(car, pt.x, pt.y, matchFn);
    });
  }, [cars, len, matchFn]);

  const geo = useMemo(() => {
    if (!len || !pathRef.current || !sectorLines) return null;
    const pts = [];
    for (let i = 0; i <= OUTLINE_SAMPLES; i++) {
      const p = pathRef.current.getPointAtLength((i / OUTLINE_SAMPLES) * len);
      pts.push([p.x, p.y]);
    }
    return sectorGeometry(pts, sectorLines);
  }, [len, sectorLines]);

  const [, , vwRaw, vhRaw] = (circuit?.box || "0 0 100 100").split(/\s+/).map(Number);
  const vw = vwRaw || 100;
  const vh = vhRaw || 100;
  const { register, camRef } = useSmoothCars({ dots, focusGuid, zoom, camInfo: { w: vw, h: vh } });
  const [svgEl, setSvgEl] = useState(null);
  const fit = useFitScale(svgEl, vw, vh);
  // Car size off the box's DIAGONAL, not its width, until the map is measured.
  // Off the width, a wide, flat circuit (Most's box is twice as wide as it is
  // tall) got cars twice the size of a tall one's relative to the track around
  // them. The diagonal treats both shapes alike.
  const diag = Math.hypot(vw, vh);
  const rBase = diag * 0.018;
  const r = markerRadius(fit, rBase);
  const tags = useTags({ dots, focusGuid, zoom, r, rotated: false, H: vh });

  if (!circuit) return null;

  return (
    <svg
      ref={setSvgEl}
      viewBox={circuit.box || "0 0 100 100"}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Live track map, ${dots.length} cars`}
      onClick={() => onFocus(null)}
    >
      <g ref={camRef}>
        {/* the outline itself — quiet, so the cars read as the foreground.
            Quiet is not invisible, though: drawn in the border colour it was a
            pale grey line on a white card in the light theme, and the cars
            looked scattered over nothing. The faint text tone is a mid grey in
            both themes, so the circuit reads on either ground. */}
        <path
          ref={pathRef}
          d={circuit.path}
          fill="none"
          stroke="currentColor"
          // Screen pixels (non-scaling stroke), so the road is the same
          // weight whatever the box or the zoom. Derived from the car size it
          // came out at 1.4px and vanished under the cars on a wide circuit.
          strokeWidth={geo ? 6 : 3.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-faint"
          vectorEffect="non-scaling-stroke"
          opacity={geo ? 0.35 : 0.6}
        />
        {geo && <SectorTrack geo={geo} width={2.5} r={(r * 0.9) / (focusGuid ? Math.sqrt(zoom) : 1)} counterRotate={false} nonScaling />}
        {len > 0 &&
          pathRef.current &&
          (incidents || []).map((inc) => {
            if (inc.spline == null) return null;
            const pt = pathRef.current.getPointAtLength((((inc.spline % 1) + 1) % 1) * len);
            return <IncidentMark key={inc.id} x={pt.x} y={pt.y} r={rBase / (focusGuid ? Math.sqrt(zoom) : 1)} inc={inc} />;
          })}
        {dots.map((d) => (
          <CarMarker
            key={d.guid}
            d={d}
            r={r}
            spot={tags.get(d.guid)}
            isFocusTarget={d.guid === focusGuid}
            counterRotate={false}
            onFocus={onFocus}
            registerRef={register(d.guid)}
          />
        ))}
      </g>
    </svg>
  );
}

// Cockpit panel for the followed car: who it is, speed (with a bar against the
// fastest speed anyone has done this session), gear and revs, DRS while it is
// open. Board values (700ms tick) paint the first numbers; the follow
// fast-lane (onCarTelemetry) then overwrites them with every telemetry message
// the race server sends — same immediacy as the server manager's own live map.
// Kept as its own component so those frames re-render this panel alone, not
// the whole map. A car in the garage carries no telemetry and shows the name
// alone rather than stale numbers.
function FollowHud({ car, name, color, vmax, onCarTelemetry, onClose, className = "" }) {
  const [tel, setTel] = useState(null);
  useEffect(() => {
    setTel(null); // switching cars: never show the previous car's numbers
    if (!onCarTelemetry) return undefined;
    return onCarTelemetry((t) => {
      if (t.guid === car.guid) setTel(t);
    });
  }, [car.guid, onCarTelemetry]);
  const speed = tel?.speedKmh ?? car.speedKmh;
  const gear = tel?.gear ?? car.gear;
  const rpm = tel?.rpm ?? car.rpm;
  const pct = speed != null && vmax > 0 ? Math.min(100, (speed / vmax) * 100) : null;
  const stat = "shrink-0 border-l border-white/15 pl-3";
  const unit = "font-mono text-[9px] font-normal uppercase text-white/50";
  return (
    <div className={`items-center gap-3 rounded-xl bg-ink/90 px-3 py-2 text-white shadow-lift backdrop-blur ${className}`}>
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">Following</div>
        <div className="truncate font-display text-sm font-extrabold uppercase leading-tight">{name}</div>
      </div>
      {speed != null && (
        <div className={stat}>
          <div className="font-mono text-lg font-bold leading-none tabular-nums">
            {speed}
            <span className={`ml-1 ${unit}`}>km/h</span>
          </div>
          {pct != null && (
            <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
      {gear != null && (
        <div className={`${stat} text-center`}>
          <div className="font-mono text-lg font-bold leading-none tabular-nums">{gearLabel(gear)}</div>
          <div className={`mt-1 ${unit}`}>gear</div>
        </div>
      )}
      {rpm != null && (
        <div className={`${stat} hidden text-center sm:block`}>
          <div className="font-mono text-lg font-bold leading-none tabular-nums">{rpm.toLocaleString("en-GB")}</div>
          <div className={`mt-1 ${unit}`}>rpm</div>
        </div>
      )}
      {car.drs && <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px] font-bold">DRS</span>}
      <button
        type="button"
        onClick={onClose}
        title="Stop following"
        aria-label="Stop following"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/10 transition hover:bg-white/20"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  );
}

// Picks the real map when calibration is present, else the stylised outline.
// Owns the focus + zoom state so they survive a map-mode change mid-session.
// `className` dresses the map itself; `wrapClassName` REPLACES the frame around
// it — the zoom buttons and the follow panel hang off the box inside it, so a
// caller that wants the map to fill a box has to say so HERE. It used to be the
// map alone that was told, and this wrapper sat between them with no height of
// its own: the map's `h-full` then had nothing to be a percentage OF (see the
// TV board). Replaced rather than added to, because the default `relative` and
// a caller's `absolute` are the same property and the stylesheet, not the class
// string, decides which of the two wins. Whatever a caller passes has to keep
// this element positioned.
export default function LiveTrackMap({ track, trackId = null, cars, matchFn, map, follow, onCarTelemetry, server = null, className = "", wrapClassName = "", incidents = null, sectorLines = null }) {
  const [focusGuid, setFocusGuid] = useState(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [mapMode, setMapMode] = useState("track");
  const [imageFailed, setImageFailed] = useState(false);
  const [aerialLoaded, setAerialLoaded] = useState(false);
  const [loadAerial, setLoadAerial] = useState(false);
  const aerialMap = aerialForTrack(trackId, track);
  const aerialAvailable = !!aerialMap && !!map?.scaleFactor;
  const aerial = aerialAvailable && mapMode === "aerial" && !imageFailed;
  useEffect(() => { setMapMode("track"); setImageFailed(false); setAerialLoaded(false); setLoadAerial(false); }, [trackId, track, server, map?.ver]);
  // The followed car left the server -> drop the focus rather than staring at
  // an empty patch of tarmac.
  const focusedCar = focusGuid ? (cars || []).find((c) => c.guid === focusGuid) : null;
  useEffect(() => {
    if (focusGuid && !focusedCar) setFocusGuid(null);
  }, [focusGuid, focusedCar]);
  // Tell the backend which car this viewer follows, so its cockpit numbers
  // arrive on the fast-lane instead of the 700ms tick. Cleared on unmount.
  useEffect(() => {
    follow?.(focusGuid);
    return () => follow?.(null);
  }, [focusGuid, follow]);

  const real = map && map.width && map.height && map.scaleFactor;
  // Kept as the same array while the two numbers stay put, so the outline is
  // not re-sampled on every board tick.
  const [lineA, lineB] = Array.isArray(sectorLines) ? sectorLines : [];
  const lines = useMemo(() => validLines([lineA, lineB]), [lineA, lineB]);
  const line = useTrackLine(real ? map.ver ?? 0 : null, server);
  // The legend only when the map actually shows the colours it explains.
  const showLegend = !!lines && (real ? !!line && !aerial : true);
  const focusMatch = focusedCar && matchFn ? matchFn(focusedCar.name) : null;
  const focusName = focusedCar ? focusMatch?.nabsName || focusedCar.name : null;
  const focusColor = focusMatch?.teamColor || "#94a3b8";
  // The speed bar's full scale: the fastest anyone has gone this session.
  const vmax = Math.max(0, ...(cars || []).map((c) => Number(c.topSpeed) || 0));
  const zoomStep = (dir) =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, dir > 0 ? z * 1.4 : z / 1.4)));
  const zoomBtn = "grid h-8 w-8 place-items-center text-medium transition hover:bg-surface2 hover:text-dark";
  const hud = (cls) => (
    <FollowHud
      car={focusedCar}
      name={focusName}
      color={focusColor}
      vmax={vmax}
      onCarTelemetry={onCarTelemetry}
      onClose={() => setFocusGuid(null)}
      className={cls}
    />
  );
  return (
    <div className={`${wrapClassName || "relative"} live-sectors flex flex-col`}>
      <div className="relative min-h-0 flex-1">
      {aerialAvailable && (
        <div className="absolute right-2 top-2 z-10" role="group" aria-label="Map background">
          <SlidingTabs
            wrapClassName="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-sm"
            btnClassName="px-3 py-1.5 text-xs uppercase tracking-wide"
            pillClassName="rounded-md bg-brand"
            items={[{ key: "track", label: "Track" }, { key: "aerial", label: "Satellite" }]}
            value={aerial ? "aerial" : "track"}
            onChange={(value) => { setImageFailed(false); setMapMode(value); if (value === "aerial") setLoadAerial(true); }}
          />
        </div>
      )}
      {showLegend && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-3 rounded-lg bg-card/90 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-medium shadow-sm">
          {[1, 2, 3].map((i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="h-1 w-3 rounded" style={{ background: `var(--live-s${i})` }} aria-hidden="true" />S{i}
            </span>
          ))}
        </div>
      )}
      {real ? (
        <RealTrackMap
          key={`${server || ""}:${map?.ver || ""}`}
          cars={cars}
          map={map}
          aerial={aerial}
          aerialMap={aerialMap}
          aerialLoaded={aerialLoaded}
          loadAerial={aerialAvailable && loadAerial}
          onAerialLoad={() => setAerialLoaded(true)}
          matchFn={matchFn}
          focusGuid={focusGuid}
          zoom={zoom}
          onFocus={setFocusGuid}
          server={server}
          className={className}
          incidents={incidents}
          line={line}
          sectorLines={lines}
          onImageError={() => { setImageFailed(true); setMapMode("track"); setAerialLoaded(false); setLoadAerial(false); }}
        />
      ) : (
        <StylisedTrackMap
          track={track}
          trackId={trackId}
          cars={cars}
          matchFn={matchFn}
          focusGuid={focusGuid}
          zoom={zoom}
          onFocus={setFocusGuid}
          className={className}
          incidents={incidents}
          sectorLines={lines}
        />
      )}
      {imageFailed && <p role="status" className="absolute bottom-2 left-2 rounded bg-black/80 px-2 py-1 text-xs text-white">Satellite image unavailable. Showing track map.</p>}
      {focusedCar && (
        <>
          {/* Floats over the map from sm up; a phone gets it under the map
              (below), where it does not cover the cars it is about. */}
          {hud("absolute bottom-3 left-3 z-10 hidden max-w-[calc(100%-4.5rem)] sm:flex")}
          {/* zoom controls — how close the follow-camera sits */}
          <div className="absolute bottom-3 right-3 z-10 flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <button type="button" className={`${zoomBtn} border-b border-border`} onClick={() => zoomStep(1)} title="Zoom in" aria-label="Zoom in">
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={zoomBtn} onClick={() => zoomStep(-1)} title="Zoom out" aria-label="Zoom out">
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </>
      )}
      </div>
      {focusedCar && hud("mt-2 flex shrink-0 sm:hidden")}
      {aerialAvailable && (
        <div className="shrink-0 px-1 pt-2 text-xs leading-relaxed text-light">
          <a href={aerialMap.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-dark">{aerialMap.source}</a>
          {" · "}<a href={aerialMap.licenseUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-dark">{aerialMap.license}</a>
          <span className="block">Cropped · positions approximate</span>
        </div>
      )}
    </div>
  );
}
