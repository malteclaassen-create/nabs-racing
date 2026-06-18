import { circuitFor } from "../data/circuits.js";

// Real circuit outline (projected OSM geometry). Renders nothing for unknown
// tracks. Each circuit carries its own tight viewBox (`box`), so aspect ratio
// is preserved — size it with the className (e.g. h-12 w-20) and it fits inside.
//
// `animate`: trace the outline once from the start line all the way around
// (uses pathLength="1" + the .circuit-draw keyframes in index.css). Once that
// first lap is drawn, a bright segment keeps looping the circuit forever (the
// .circuit-trace overlay), like a car running laps.
export default function CircuitMap({
  track,
  className = "",
  stroke = "currentColor",
  strokeWidth = 2.5,
  style,
  animate = false,
  duration = 2.6,
  traceStroke = "rgba(255,255,255,0.95)",
}) {
  const c = circuitFor(track);
  if (!c) return null;
  return (
    <svg
      viewBox={c.box || "0 0 100 100"}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={style}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
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
    </svg>
  );
}
