import { useMemo, useRef, useState, useEffect, useCallback } from "react";
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
// AC map.pngs draw the circuit on transparency: dark asphalt with white edges.
// That reads on a dark card as-is; the light theme inverts the image so the
// asphalt comes out pale and the edges black (see .live-map in index.css).

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
  const liveRef = useRef({ focusGuid, zoom, camInfo, zoomShown: 1, cameraX: null, cameraY: null });
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
        st.next = { x: d.x, y: d.y, h: d.heading ?? cur.h, t: now };
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
      let focusPos = null;
      for (const [guid, st] of states.current) {
        const el = els.current.get(guid);
        const p = instant ? { x: st.next.x, y: st.next.y, h: st.next.h } : interpNow(st, now);
        if (el) {
          el.style.transform = `translate(${p.x}px, ${p.y}px)`;
          const car = el.querySelector("[data-car]");
          if (car) car.setAttribute("transform", `rotate(${p.h}) scale(${Number(car.dataset.scale) / Math.sqrt(liveRef.current.zoomShown)})`);
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
        liveRef.current.zoomShown = z;
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

// One car marker: the top-down F1 silhouette (rotated by the rAF driver), with
// the race number floating upright beside it. Clickable to (un)focus; sized
// down while zoomed so it stays a marker instead of a blob.
function CarDot({ d, r, fs, zoom, focused, isFocusTarget, counterRotate, onFocus, registerRef, aerial = false }) {
  const k = focused ? Math.sqrt(zoom) : 1; // gentle counter-scale under zoom
  const rr = r / k;
  const ff = fs / k;
  const s = (r * 1.6) / CAR.half; // rAF scales with the displayed camera zoom
  return (
    <g
      ref={registerRef}
      style={{ transform: `translate(${d.x}px, ${d.y}px)`, opacity: d.inPits ? (aerial ? 0.8 : 0.4) : 1, cursor: "pointer" }}
      onClick={(ev) => {
        ev.stopPropagation();
        onFocus(isFocusTarget ? null : d.guid);
      }}
    >
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
      {/* the race number rides above the car, always upright; the followed
          car shows the driver's name instead — that is the one you zoomed in
          on, and "who is this" beats "which number is this" there */}
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
          {isFocusTarget ? d.title : d.label}
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
    x: map.affine ? map.affine[0] * car.pos.x + map.affine[2] * car.pos.z + map.affine[4] : (car.pos.x + map.xOffset) / map.scaleFactor + pad,
    y: map.affine ? map.affine[1] * car.pos.x + map.affine[3] * car.pos.z + map.affine[5] : (car.pos.z + map.zOffset) / map.scaleFactor + pad,
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

function RealTrackMap({ cars, map, matchFn, focusGuid, zoom, onFocus, server = null, className = "", onImageError, aerial = false, aerialLoaded = false, onAerialLoad, loadAerial = false, aerialMap }) {
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
    <div className={`live-map overflow-hidden rounded-xl ${className}`}>
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
                  <line x1={left[0]} y1={left[1]} x2={right[0]} y2={right[1]} stroke="#111827" strokeWidth={r * 0.5} />
                  <line x1={left[0]} y1={left[1]} x2={right[0]} y2={right[1]} stroke={gate.index === 0 ? "white" : "#ffcf73"} strokeWidth={r * 0.23} />
                  <g transform={`translate(${x} ${y})${rotated ? " rotate(-90)" : ""}`}>
                    <text y={r * 1.7} textAnchor="middle" fill="white" stroke="#111827" strokeWidth={r * 0.22} paintOrder="stroke" fontSize={r * 1.15} fontWeight="700">{label}</text>
                  </g>
                </g>;
              })}
            </g>
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
                aerial={showAerial}
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
function StylisedTrackMap({ track, trackId, cars, matchFn, focusGuid, zoom, onFocus, className = "" }) {
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

  // Car and label size off the box's DIAGONAL, not its width. Off the width,
  // a wide, flat circuit (Most's box is twice as wide as it is tall) got cars
  // twice the size of a tall one's relative to the track around them — the
  // outline read as a few huge cars on a thin thread. The diagonal treats
  // both shapes alike.
  const diag = Math.hypot(vw, vh);
  const r = diag * 0.018;
  const fs = diag * 0.022;

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
          strokeWidth={3.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-faint"
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

// Cockpit readout for the followed car. Board values (700ms tick) paint the
// first numbers; the follow fast-lane (onCarTelemetry) then overwrites them
// with every telemetry message the race server sends — same immediacy as the
// server manager's own live map. Kept as its own component so those frames
// re-render this chip alone, not the whole map.
function CockpitReadout({ car, onCarTelemetry }) {
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
  if (speed == null) return null;
  return (
    <div className="absolute left-2 top-9 flex items-baseline gap-2.5 rounded-lg bg-black/60 px-2.5 py-1.5 font-mono text-white backdrop-blur">
      <span className="text-sm font-bold tabular-nums">
        {speed}
        <span className="ml-1 text-[9px] font-normal uppercase tracking-wider text-white/60">km/h</span>
      </span>
      {gear != null && (
        <span className="text-sm font-bold tabular-nums">
          {gear === 0 ? "R" : gear === 1 ? "N" : gear - 1}
          <span className="ml-1 text-[9px] font-normal uppercase tracking-wider text-white/60">gear</span>
        </span>
      )}
      {rpm != null && (
        <span className="text-sm font-bold tabular-nums">
          {rpm.toLocaleString("en-GB")}
          <span className="ml-1 text-[9px] font-normal uppercase tracking-wider text-white/60">rpm</span>
        </span>
      )}
    </div>
  );
}

// Picks the real map when calibration is present, else the stylised outline.
// Owns the focus + zoom state so they survive a map-mode change mid-session.
// `className` dresses the map itself; `wrapClassName` REPLACES the frame around
// it — the zoom buttons and the focus label hang off this element, so a caller
// that wants the map to fill a box has to say so HERE. It used to be the map
// alone that was told, and this wrapper sat between them with no height of its
// own: the map's `h-full` then had nothing to be a percentage OF (see the TV
// board). Replaced rather than added to, because the default `relative` and a
// caller's `absolute` are the same property and the stylesheet, not the class
// string, decides which of the two wins. Whatever a caller passes has to keep
// this element positioned — the controls inside are absolute against it.
export default function LiveTrackMap({ track, trackId = null, cars, matchFn, map, follow, onCarTelemetry, server = null, className = "", wrapClassName = "" }) {
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
  const focusName = focusedCar ? (matchFn ? matchFn(focusedCar.name)?.nabsName : null) || focusedCar.name : null;
  const zoomStep = (dir) =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, dir > 0 ? z * 1.4 : z / 1.4)));
  const zoomBtn =
    "flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 font-mono text-sm font-bold text-white backdrop-blur transition hover:bg-black/75";
  return (
    <div className={`${wrapClassName || "relative"} ${aerialAvailable ? "flex flex-col" : ""}`}>
      <div className={aerialAvailable ? "relative min-h-0 flex-1" : "contents"}>
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
        />
      )}
      {imageFailed && <p role="status" className="absolute bottom-2 left-2 rounded bg-black/80 px-2 py-1 text-xs text-white">Satellite image unavailable. Showing track map.</p>}
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
          {/* Cockpit readout for the followed car — speed / gear / revs. Only
              an on-track car carries them; a leaver or pitted car simply shows
              no chip instead of stale numbers. */}
          {focusedCar && <CockpitReadout car={focusedCar} onCarTelemetry={onCarTelemetry} />}
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
