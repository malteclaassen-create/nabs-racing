import { useEffect, useId, useRef, useState } from "react";
import { circuitFor } from "../data/circuits.js";
import { uploadedOutlineFor, useTrackOutlines } from "../data/trackOutlines.js";

// Real circuit outline (projected OSM geometry). A circuit without one draws
// the outline an admin uploaded for it (data/trackOutlines.js) instead, and
// renders nothing when there is none either. Each circuit carries its own tight viewBox (`box`), so aspect ratio
// is preserved — size it with the className (e.g. h-12 w-20) and it fits inside.
//
// `animate`: trace the outline once from the start line all the way around
// (uses pathLength="1" + the .circuit-draw keyframes in index.css). Once that
// first lap is drawn, a bright segment keeps looping the circuit forever (the
// .circuit-trace overlay), like a car running laps.
//
// `rotate`: degrees to spin the outline (admin-set per track, so a tall layout
// can lie down and fill a wide panel). The viewBox grows to the rotated
// bounding box, so nothing clips at any angle.
//
// `align`: SVG preserveAspectRatio alignment. Default keeps the drawing
// centered; pass e.g. "xMaxYMax" to pin it to the bottom-right of the box.
export default function CircuitMap({
  track,
  className = "",
  stroke = "currentColor",
  strokeWidth = 2.5,
  style,
  animate = false,
  duration = 2.6,
  traceStroke = "rgba(255,255,255,0.95)",
  rotate = 0,
  align = "xMidYMid",
}) {
  useTrackOutlines();
  const c = circuitFor(track);
  if (!c) {
    const outline = uploadedOutlineFor(track);
    return outline ? (
      <UploadedOutline
        outline={outline}
        className={className}
        style={style}
        stroke={stroke}
        strokeWidth={strokeWidth}
        rotate={rotate}
        align={align}
      />
    ) : null;
  }

  let viewBox = c.box || "0 0 100 100";
  let transform;
  const deg = ((Number(rotate) || 0) % 360 + 360) % 360;
  if (deg) {
    const [x, y, w, h] = viewBox.split(/\s+/).map(Number);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rad = (deg * Math.PI) / 180;
    const rw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const rh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
    viewBox = `${cx - rw / 2} ${cy - rh / 2} ${rw} ${rh}`;
    transform = `rotate(${deg} ${cx} ${cy})`;
  }

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio={`${align} meet`}
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g transform={transform}>
        <path
          d={c.path}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          // non-scaling-stroke keeps a uniform px width, but it breaks pathLength
          // dash normalization — so drop it when we draw the lap.
          {...(animate
            ? { pathLength: 1, className: "circuit-draw", style: { animationDuration: `${duration}s` } }
            : { vectorEffect: "non-scaling-stroke" })}
        />
        {/* Looping "car" segment — only after the first draw lap finishes. */}
        {animate && (
          <path
            d={c.path}
            pathLength={1}
            stroke={traceStroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="circuit-trace"
            // start once the draw lap has completed
            style={{ animationDelay: `${duration}s, ${duration}s` }}
          />
        )}
      </g>
    </svg>
  );
}

// An uploaded outline (data/trackOutlines.js). The picture is the mask of a
// shape painted in the outline's own colour, so it sits on a card like the
// built-in ones do: white on the dark theme, ink on the light one, whatever
// colour it was drawn in. Its line is thickened to `strokeWidth` on screen,
// the same weight the built-in outlines are drawn at here: a downloaded
// drawing often has a hairline, which shrunk into a card all but vanished.
// That needs the drawn size, so the box is measured; until it is, the line
// shows as drawn. No lap animation: there is no path to trace.
function UploadedOutline({ outline, className, style, stroke, strokeWidth, rotate, align }) {
  const ref = useRef(null);
  const id = useId().replace(/:/g, "");
  const [box, setBox] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox((b) => (b && b.width === width && b.height === height ? b : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { url, w, h, line } = outline;
  // Screen pixels per picture pixel, then how much to grow the line on each
  // side (in picture pixels) to reach the weight on screen. Never thinner.
  const scale = box ? Math.min(box.width / w, box.height / h) : 0;
  const grow = scale > 0 ? Math.max(0, (Number(strokeWidth) / scale - line) / 2) : 0;
  const deg = ((Number(rotate) || 0) % 360 + 360) % 360;
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio={`${align} meet`}
      className={className}
      style={{ ...style, ...(deg ? { transform: `rotate(${deg}deg)` } : {}) }}
      aria-hidden="true"
    >
      <defs>
        <filter id={`${id}-f`} x="-5%" y="-5%" width="110%" height="110%">
          <feMorphology operator="dilate" radius={grow.toFixed(2)} />
        </filter>
        <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h} style={{ maskType: "alpha" }}>
          <image href={url} width={w} height={h} filter={grow > 0.05 ? `url(#${id}-f)` : undefined} />
        </mask>
      </defs>
      <rect width={w} height={h} fill={stroke} mask={`url(#${id}-m)`} />
    </svg>
  );
}
