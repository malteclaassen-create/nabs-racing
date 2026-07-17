import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { circuitFor } from "../data/circuits.js";

// Live track map. Two modes:
//
//  1. REAL map (preferred): when the session ships map calibration, we draw the
//     server manager's own overhead map.png (proxied at /api/live/map.png) and
//     place each car by its REAL world position (ET53 Pos), projected with the
//     map.ini calibration. These positions are exact, so no "approximate" caveat.
//  2. STYLISED fallback: no calibration -> the shared circuit outline with cars
//     walked along the SVG path by NormalisedSplinePos (indicative, not surveyed).
//
// MOTION: the board only updates every ~700ms (and per-car telemetry can be
// sparser), so a CSS transition made the cars surge-and-stall and turn in
// visible steps. Instead a requestAnimationFrame loop interpolates every car's
// position AND heading between its last two updates (shortest-angle turn), and
// drives the follow-camera from the same interpolated point — smooth steering,
// even speed. Lite graphics / reduced motion snap to the newest data instead.
//
// FOCUS MODE (both variants): clicking a car zooms onto it and follows; the
// +/- controls change how close (to read two cars side by side, zoom in).
// Clicking anywhere else zooms back out.
//
// AC map.pngs are a pale track band on a transparent background: near-invisible on
// a light card, clean on a dark one. So the real map always renders on a fixed
// dark surface, in both themes, like the always-dark hero card.

const ZOOM_DEFAULT = 3;
const ZOOM_MIN = 1.6;
const ZOOM_MAX = 7;

// Top-down open-wheeler, drawn pointing RIGHT (+x) around (0,0) in a roughly
// 22 x 10 box, so `rotate(headingDeg)` aims it along the direction of travel.
// Body in team colour; wheels/wings dark so the silhouette reads at map size.
// (An emoji can't do this: it won't tint per team, won't rotate cleanly, and
// renders differently on every device.)
const CAR = {
  // nose + monocoque + sidepods, one closed path
  body: "M11,0 L8.2,-1.1 L5.5,-1.4 L3.5,-3 L0.5,-3 L-1.5,-1.6 L-6.5,-1.6 L-6.5,1.6 L-1.5,1.6 L0.5,3 L3.5,3 L5.5,1.4 L8.2,1.1 Z",
  frontWing: "M7.6,-4.6 L9.4,-4.6 L9.4,4.6 L7.6,4.6 Z",
  rearWing: "M-9.6,-4.2 L-7.9,-4.2 L-7.9,4.2 L-9.6,4.2 Z",
  wheels: [
    { x: 4.2, y: -4.4 }, // front left
    { x: 4.2, y: 2.4 }, // front right
    { x: -6.8, y: -4.7 }, // rear left
    { x: -6.8, y: 2.7 }, // rear right
  ],
  wheelW: 2.6,
  wheelH: 2,
  // half-length of the drawing, used to convert the old dot radius to a scale
  half: 11,
};

// Shortest-path angle interpolation (so 350° -> 10° turns 20°, not -340°).
function lerpAngle(a, b, f) {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * f;
}

// Where a car is RIGHT NOW between its last two updates. Gliding starts when
// an update lands (from wherever the car was rendered at that moment) and
// takes as long as the gap between the two updates — so an irregular feed
// still reads as one continuous speed.
function interpNow(st, now) {
  const f = Math.min(1, Math.max(0, (now - st.next.t) / (st.dur || 700)));
  return {
    x: st.prev.x + (st.next.x - st.prev.x) * f,
    y: st.prev.y + (st.next.y - st.prev.y) * f,
    h: lerpAngle(st.prev.h, st.next.h, f),
  };
}

// The rAF driver shared by both map variants: feeds car updates into per-car
// interpolation states and writes transforms straight to the DOM every frame
// (12 cars, no React re-render per frame). Also steers the follow-camera.
function useSmoothCars({ dots, focusGuid, zoom, camInfo }) {
  const els = useRef(new Map()); // guid -> outer <g>
  const states = useRef(new Map()); // guid -> { prev, next }
  const camRef = useRef(null);
  const liveRef = useRef({ focusGuid, zoom, camInfo, zoomShown: zoom });
  liveRef.current.focusGuid = focusGuid;
  liveRef.current.zoom = zoom;
  liveRef.current.camInfo = camInfo;

  const register = useCallback((guid) => (el) => {
    if (el) els.current.set(guid, el);
    else els.current.delete(guid);
  }, []);

  // New board data: current rendered point becomes the glide's start.
  useEffect(() => {
    const now = performance.now();
    const seen = new Set();
    for (const d of dots) {
      seen.add(d.guid);
      const st = states.current.get(d.guid);
      const h = d.heading ?? 0;
      if (!st) {
        states.current.set(d.guid, {
          prev: { x: d.x, y: d.y, h, t: now },
          next: { x: d.x, y: d.y, h, t: now },
          lastAt: now,
          dur: 700,
        });
      } else {
        const cur = interpNow(st, now);
        // Glide duration = the actual gap since the previous update, so the
        // car arrives exactly when the next update is due — constant speed
        // even on an irregular feed. (next.t - prev.t is useless here: both
        // are stamped right now.)
        st.dur = Math.min(2000, Math.max(120, now - st.lastAt));
        st.lastAt = now;
        st.prev = { ...cur, t: now };
        st.next = { x: d.x, y: d.y, h: d.heading ?? cur.h, t: now };
      }
    }
    for (const g of [...states.current.keys()]) if (!seen.has(g)) states.current.delete(g);
  }, [dots]);

  useEffect(() => {
    let raf;
    const tick = () => {
      const now = performance.now();
      const { focusGuid: fg, zoom: zTarget, camInfo: ci } = liveRef.current;
      const instant =
        document.documentElement.classList.contains("fx-lite") ||
        (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      let focusPos = null;
      for (const [guid, st] of states.current) {
        const el = els.current.get(guid);
        const p = instant ? { x: st.next.x, y: st.next.y, h: st.next.h } : interpNow(st, now);
        if (el) {
          el.style.transform = `translate(${p.x}px, ${p.y}px)`;
          const car = el.querySelector("[data-car]");
          if (car) car.setAttribute("transform", `rotate(${p.h}) scale(${car.dataset.scale})`);
        }
        if (guid === fg) focusPos = p;
      }
      const cam = camRef.current;
      if (cam && ci) {
        // The zoom level itself eases toward its target, so +/- and entering
        // focus feel like a camera move, not a cut.
        const target = focusPos ? zTarget : 1;
        const z = instant
          ? target
          : (liveRef.current.zoomShown += (target - liveRef.current.zoomShown) * 0.12);
        liveRef.current.zoomShown = z;
        if (focusPos || Math.abs(z - 1) > 0.01) {
          const cx = ci.w / 2;
          const cy = ci.h / 2;
          const fx = focusPos ? focusPos.x : cx;
          const fy = focusPos ? focusPos.y : cy;
          cam.style.transform = `translate(${cx - z * fx}px, ${cy - z * fy}px) scale(${z})`;
        } else {
          cam.style.transform = "none";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return { register, camRef };
}

// One car marker: the top-down F1 silhouette (rotated by the rAF driver), with
// the race number floating upright beside it. Clickable to (un)focus; sized
// down while zoomed so it stays a marker instead of a blob.
function CarDot({ d, r, fs, zoom, focused, isFocusTarget, counterRotate, onFocus, registerRef }) {
  const k = focused ? Math.sqrt(zoom) : 1; // gentle counter-scale under zoom
  const rr = r / k;
  const ff = fs / k;
  const s = (rr * 1.6) / CAR.half; // car length ≈ 3.2 dot radii
  return (
    <g
      ref={registerRef}
      style={{ transform: `translate(${d.x}px, ${d.y}px)`, opacity: d.inPits ? 0.4 : 1, cursor: "pointer" }}
      onClick={(ev) => {
        ev.stopPropagation();
        onFocus(isFocusTarget ? null : d.guid);
      }}
    >
      {/* a quiet halo marks the followed car (rotation-independent) */}
      {isFocusTarget && (
        <circle r={rr * 1.9} fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth={rr * 0.16} />
      )}
      <title>{d.title}</title>
      <g data-car data-scale={s} transform={`rotate(${d.heading ?? 0}) scale(${s})`}>
        {/* generous invisible hit area — the silhouette alone is fiddly to tap */}
        <circle r={CAR.half * 1.2} fill="transparent" stroke="none" />
        {CAR.wheels.map((w, i) => (
          <rect key={i} x={w.x} y={w.y} width={CAR.wheelW} height={CAR.wheelH} rx={0.7} fill="#111827" />
        ))}
        <path d={CAR.frontWing} fill="#1f2937" />
        <path d={CAR.rearWing} fill="#1f2937" />
        <path d={CAR.body} fill={d.color} stroke="rgba(15,23,42,0.85)" strokeWidth={0.5} />
      </g>
      {/* the race number rides above the car, always upright */}
      <g transform={counterRotate ? "rotate(-90)" : undefined}>
        <text
          x="0"
          y={-rr * 1.7}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={ff}
          fontWeight="800"
          fill="#fff"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth={ff * 0.09}
          paintOrder="stroke"
          style={{ pointerEvents: "none" }}
        >
          {d.label}
        </text>
      </g>
    </g>
  );
}

// Direction of travel per car, from how its map position moved between two
// updates. Tiny jitters (a stationary car) keep the last known heading, so
// parked cars don't spin. `store` persists across renders (a ref's Map).
function withHeadings(dots, store, minDist) {
  for (const d of dots) {
    const prev = store.get(d.guid);
    let heading = prev?.heading ?? 0;
    if (prev) {
      const dx = d.x - prev.x;
      const dy = d.y - prev.y;
      if (Math.hypot(dx, dy) >= minDist) heading = (Math.atan2(dy, dx) * 180) / Math.PI;
    }
    d.heading = heading;
    store.set(d.guid, { x: d.x, y: d.y, heading });
  }
  return dots;
}

// Project a world position onto the map.png's intrinsic pixel space. This is the
// server manager's own live-map formula, lifted from its client verbatim:
//   pixel = (world + offset) / scale_factor + padding
// No axis flips — validated against captured on-track telemetry, which lands
// exactly on the drawn band this way (an earlier Y-flip only grazed it by luck).
function projectDot(car, map, matchFn) {
  const pad = map.padding || 0;
  const m = matchFn ? matchFn(car.name) : null;
  const label = car.raceNumber != null ? String(car.raceNumber) : (car.initials || car.name || "").slice(0, 3);
  return {
    guid: car.guid,
    x: (car.pos.x + map.xOffset) / map.scaleFactor + pad,
    y: (car.pos.z + map.zOffset) / map.scaleFactor + pad,
    color: m?.teamColor || "#94a3b8",
    label,
    title: m?.nabsName || car.name,
    inPits: !!car.inPits,
  };
}

// Tall maps lie down: like the server manager's own live map (which rotates
// anything with height/width > 1.07), a portrait circuit turns 90° so the panel
// stays a sensible landscape instead of a skyscraper of empty margin.
const ROTATE_RATIO = 1.07;

function RealTrackMap({ cars, map, matchFn, focusGuid, zoom, onFocus, className = "" }) {
  const W = map.width;
  const H = map.height;
  const rotated = H / W > ROTATE_RATIO;
  // Heading store survives re-renders: real positions carry no direction, so
  // it's derived from each car's movement between updates.
  const headingsRef = useRef(new Map());
  const dots = useMemo(
    () =>
      withHeadings(
        (cars || []).filter((c) => c.pos).map((c) => projectDot(c, map, matchFn)),
        headingsRef.current,
        Math.max(W, H) * 0.002
      ),
    [cars, map, matchFn, W, H]
  );
  const { register, camRef } = useSmoothCars({ dots, focusGuid, zoom, camInfo: { w: W, h: H } });
  // Dot geometry in the map's intrinsic pixel space, so it scales with the image.
  const r = Math.max(W, H) * 0.014;
  const fs = r * 1.05;
  return (
    <div className={`live-map-dark rounded-xl p-2 sm:p-3 ${className}`}>
      {/* Width-driven: the SVG takes its height from the (rotated) aspect ratio,
          so the card hugs the map instead of stretching to a tall empty box.
          The max-height only caps a very wide column. */}
      <svg
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
            <image href={`/api/live/map.png?v=${map.ver || 0}`} width={W} height={H} />
            {dots.map((d) => (
              <CarDot
                key={d.guid}
                d={d}
                r={r}
                fs={fs}
                zoom={zoom}
                focused={!!focusGuid}
                isFocusTarget={d.guid === focusGuid}
                counterRotate={rotated}
                onFocus={onFocus}
                registerRef={register(d.guid)}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

// The stylised circuit outline with cars placed by walking the SVG path.
// Known, accepted approximation: the stored path's start point and winding
// direction aren't guaranteed to match the real start/finish or driving
// direction, so the positions are indicative. Unknown tracks render nothing.
function StylisedTrackMap({ track, cars, matchFn, focusGuid, zoom, onFocus, className = "" }) {
  const circuit = circuitFor(track);
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
      // Direction of travel = the path's forward tangent at the car (the cars
      // walk the path in the spline's direction, so "ahead" is a bit further
      // along it).
      const ahead = pathRef.current.getPointAtLength((s * len + Math.max(0.5, len * 0.004)) % len);
      const heading = (Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * 180) / Math.PI;
      const m = matchFn ? matchFn(car.name) : null;
      const label = car.raceNumber != null ? String(car.raceNumber) : (car.initials || car.name || "").slice(0, 3);
      return {
        guid: car.guid,
        x: pt.x,
        y: pt.y,
        heading,
        color: m?.teamColor || "#94a3b8",
        label,
        title: m?.nabsName || car.name,
        inPits: !!car.inPits,
      };
    });
  }, [cars, len, matchFn]);

  const [, , vwRaw, vhRaw] = (circuit?.box || "0 0 100 100").split(/\s+/).map(Number);
  const vw = vwRaw || 100;
  const vh = vhRaw || 100;
  const { register, camRef } = useSmoothCars({ dots, focusGuid, zoom, camInfo: { w: vw, h: vh } });

  if (!circuit) return null;

  const r = vw * 0.028;
  const fs = vw * 0.032;

  return (
    <svg
      viewBox={circuit.box || "0 0 100 100"}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Live track map, ${dots.length} cars`}
      onClick={() => onFocus(null)}
    >
      <g ref={camRef}>
        {/* the outline itself — quiet, so the cars read as the foreground */}
        <path
          ref={pathRef}
          d={circuit.path}
          fill="none"
          stroke="currentColor"
          strokeWidth={r * 0.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-border"
          vectorEffect="non-scaling-stroke"
          opacity="0.6"
        />
        {dots.map((d) => (
          <CarDot
            key={d.guid}
            d={d}
            r={r}
            fs={fs}
            zoom={zoom}
            focused={!!focusGuid}
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

// Picks the real map when calibration is present, else the stylised outline.
// Owns the focus + zoom state so they survive a map-mode change mid-session.
export default function LiveTrackMap({ track, cars, matchFn, map, className = "" }) {
  const [focusGuid, setFocusGuid] = useState(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  // The followed car left the server -> drop the focus rather than staring at
  // an empty patch of tarmac.
  const focusedCar = focusGuid ? (cars || []).find((c) => c.guid === focusGuid) : null;
  useEffect(() => {
    if (focusGuid && !focusedCar) setFocusGuid(null);
  }, [focusGuid, focusedCar]);

  const real = map && map.width && map.height && map.scaleFactor;
  const focusName = focusedCar ? (matchFn ? matchFn(focusedCar.name)?.nabsName : null) || focusedCar.name : null;
  const zoomStep = (dir) =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, dir > 0 ? z * 1.4 : z / 1.4)));
  const zoomBtn =
    "flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 font-mono text-sm font-bold text-white backdrop-blur transition hover:bg-black/75";
  return (
    <div className="relative">
      {real ? (
        <RealTrackMap
          cars={cars}
          map={map}
          matchFn={matchFn}
          focusGuid={focusGuid}
          zoom={zoom}
          onFocus={setFocusGuid}
          className={className}
        />
      ) : (
        <StylisedTrackMap
          track={track}
          cars={cars}
          matchFn={matchFn}
          focusGuid={focusGuid}
          zoom={zoom}
          onFocus={setFocusGuid}
          className={className}
        />
      )}
      {focusName && (
        <>
          <button
            type="button"
            onClick={() => setFocusGuid(null)}
            className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur transition hover:bg-black/75"
            title="Stop following"
          >
            Following {focusName}
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {/* zoom controls — how close the follow-camera sits */}
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            <button type="button" className={zoomBtn} onClick={() => zoomStep(-1)} title="Zoom out">
              −
            </button>
            <button type="button" className={zoomBtn} onClick={() => zoomStep(1)} title="Zoom in">
              +
            </button>
          </div>
        </>
      )}
    </div>
  );
}
