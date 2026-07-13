import { useMemo, useRef, useState, useEffect } from "react";
import { circuitFor } from "../data/circuits.js";

// Live track map. Two modes:
//
//  1. REAL map (preferred): when the session ships map calibration, we draw the
//     server manager's own overhead map.png (proxied at /api/live/map.png) and
//     place each car by its REAL world position (ET53 Pos), projected with the
//     map.ini calibration. These positions are exact, so no "approximate" caveat.
//  2. STYLISED fallback: no calibration -> the shared circuit outline with dots
//     walked along the SVG path by NormalisedSplinePos (indicative, not surveyed).
//
// AC map.pngs are a pale track band on a transparent background: near-invisible on
// a light card, clean on a dark one. So the real map always renders on a fixed
// dark surface, in both themes, like the always-dark hero card.

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
    px: (car.pos.x + map.xOffset) / map.scaleFactor + pad,
    py: (car.pos.z + map.zOffset) / map.scaleFactor + pad,
    color: m?.teamColor || "#94a3b8",
    label,
    inPits: !!car.inPits,
  };
}

// Tall maps lie down: like the server manager's own live map (which rotates
// anything with height/width > 1.07), a portrait circuit turns 90° so the panel
// stays a sensible landscape instead of a skyscraper of empty margin.
const ROTATE_RATIO = 1.07;

function RealTrackMap({ cars, map, matchFn, className = "" }) {
  const W = map.width;
  const H = map.height;
  const rotated = H / W > ROTATE_RATIO;
  const dots = useMemo(
    () => (cars || []).filter((c) => c.pos).map((c) => projectDot(c, map, matchFn)),
    [cars, map, matchFn]
  );
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
      >
        {/* One group carries the rotation, so image and dots turn together. */}
        <g transform={rotated ? `translate(${H} 0) rotate(90)` : undefined}>
          <image href={`/api/live/map.png?v=${map.ver || 0}`} width={W} height={H} />
          {dots.map((d) => (
            <g
              key={d.guid}
              className="live-dot-move"
              style={{ transform: `translate(${d.px}px, ${d.py}px)`, opacity: d.inPits ? 0.4 : 1 }}
            >
              {/* labels counter-rotate so they stay upright on a turned map */}
              <g transform={rotated ? "rotate(-90)" : undefined}>
                <circle r={r} fill={d.color} stroke="rgba(15,23,42,0.85)" strokeWidth={r * 0.16} />
                <text
                  x="0"
                  y="0"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={fs}
                  fontWeight="800"
                  fill="#fff"
                  stroke="rgba(0,0,0,0.55)"
                  strokeWidth={fs * 0.06}
                  paintOrder="stroke"
                  style={{ pointerEvents: "none" }}
                >
                  {d.label}
                </text>
              </g>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

// The stylised circuit outline with dots placed by walking the SVG path.
// Known, accepted approximation: the stored path's start point and winding
// direction aren't guaranteed to match the real start/finish or driving
// direction, so the dots are indicative. Unknown tracks render nothing.
function StylisedTrackMap({ track, cars, matchFn, className = "" }) {
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
      const m = matchFn ? matchFn(car.name) : null;
      const label = car.raceNumber != null ? String(car.raceNumber) : (car.initials || car.name || "").slice(0, 3);
      return { guid: car.guid, x: pt.x, y: pt.y, color: m?.teamColor || "#94a3b8", label, inPits: !!car.inPits };
    });
  }, [cars, len, matchFn]);

  if (!circuit) return null;

  const [, , vw] = (circuit.box || "0 0 100 100").split(/\s+/).map(Number);
  const r = (vw || 100) * 0.028;
  const fs = (vw || 100) * 0.032;

  return (
    <svg
      viewBox={circuit.box || "0 0 100 100"}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Live track map, ${dots.length} cars`}
    >
      {/* the outline itself — quiet, so the dots read as the foreground */}
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
        <g
          key={d.guid}
          className="live-dot-move"
          style={{ transform: `translate(${d.x}px, ${d.y}px)`, opacity: d.inPits ? 0.35 : 1 }}
        >
          <circle r={r} fill={d.color} stroke="var(--c-card)" strokeWidth={r * 0.18} />
          <text
            x="0"
            y="0"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={fs}
            fontWeight="800"
            fill="#fff"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={fs * 0.06}
            paintOrder="stroke"
            style={{ pointerEvents: "none" }}
          >
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// Picks the real map when calibration is present, else the stylised outline.
export default function LiveTrackMap({ track, cars, matchFn, map, className = "" }) {
  if (map && map.width && map.height && map.scaleFactor) {
    return <RealTrackMap cars={cars} map={map} matchFn={matchFn} className={className} />;
  }
  return <StylisedTrackMap track={track} cars={cars} matchFn={matchFn} className={className} />;
}
