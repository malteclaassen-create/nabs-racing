import { useLayoutEffect, useMemo, useRef, useState } from "react";

// Deterministic shapes keep previews stable; independent clocks, paths and
// phases keep the actual lamp from moving as one synchronized group.
function makeLava(seed, width, height, amount) {
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const shape = (radius, stretch) => {
    const points = Array.from({ length: 8 }, (_, i) => {
      const angle = i * Math.PI / 4;
      const r = radius * (.72 + random() * .55);
      return [Math.cos(angle) * r, Math.sin(angle) * r * stretch];
    });
    const fmt = p => p.map(n => n.toFixed(2)).join(" ");
    let d = `M${fmt(points[0])}`;
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + 7) % 8], b = points[i], c = points[(i + 1) % 8], e = points[(i + 2) % 8];
      d += `C${fmt(b.map((n, axis) => n + (c[axis] - a[axis]) / 6))} ${fmt(c.map((n, axis) => n - (e[axis] - b[axis]) / 6))} ${fmt(c)}`;
    }
    return `${d}Z`;
  };
  const columns = width < 600 ? 3 : 6;
  const baseRows = Math.min(14, Math.max(4, Math.ceil(height / 240)));
  const count = Math.max(3, Math.round(columns * baseRows * amount / 50));
  const rows = Math.ceil(count / columns);
  const scale = Math.min(1.25, Math.max(.55, width / 1000));
  return Array.from({ length: count }, (_, i) => {
    const radius = (i % 3 === 0 ? 21 + random() * 17 : 47 + random() * 29) * scale;
    const stretch = .85 + random() * .8;
    const direction = i % 2 ? -1 : 1;
    const travel = Math.min(height * .23, 95 + random() * 110);
    const duration = 22 + random() * 21;
    return {
      x: (i % columns + .3 + random() * .4) * width / columns, y: (Math.floor(i / columns) + .3 + random() * .4) * height / rows,
      palette: i % 3,
      a: shape(radius, stretch), b: shape(radius, stretch * (.65 + random() * .65)), c: shape(radius, stretch),
      style: {
        "--lava-duration": `${duration}s`, "--lava-phase": `${-random() * duration}s`,
        "--lava-morph-duration": `${9 + random() * 12}s`, "--lava-morph-phase": `${-random() * 20}s`,
        "--lava-x1": `${-30 + random() * 60}px`, "--lava-y1": `${-direction * travel * .45}px`,
        "--lava-x2": `${-45 + random() * 90}px`, "--lava-y2": `${direction * travel}px`,
        "--lava-x3": `${-35 + random() * 70}px`, "--lava-y3": `${direction * travel * .3}px`,
        "--lava-turn": `${-22 + random() * 44}deg`,
      },
    };
  });
}

const PALETTES = [
  ["#fff1b3", "#ffac52", "#fa4b52", "#aa2363"],
  ["#ffd8b0", "#ff7d60", "#dd3873", "#7e266f"],
  ["#ffb7d1", "#ec6499", "#ad3989", "#582c78"],
];

const COLOR_PALETTES = {
  ocean: ["#d5fcff", "#67d9f5", "#377bdb", "#353184"],
  amethyst: ["#ffe0fb", "#d799f5", "#9350cd", "#482777"],
  mint: ["#edffb9", "#a0edaf", "#31b6a1", "#1d596f"],
};

export default function ProfileLava({ id, compact = false, amount = 50, color = "default", teamColor }) {
  const surface = useRef(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  useLayoutEffect(() => {
    if (compact) return;
    const measure = () => {
      const { width, height } = surface.current.getBoundingClientRect();
      if (width > 0 && height > 0) setSize(old => old.width === width && old.height === height ? old : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface.current);
    return () => observer.disconnect();
  }, [compact]);
  const density = Number.isFinite(amount) ? Math.max(10, Math.min(100, amount)) : 50;
  const blobs = useMemo(() => makeLava(9127, size.width, size.height, density), [size, density]);
  const team = /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(teamColor || "") ? teamColor : "#638daf";
  const chosen = color === "team" ? [`color-mix(in srgb, ${team} 25%, white)`, `color-mix(in srgb, ${team} 65%, white)`, team, `color-mix(in srgb, ${team} 55%, #151126)`] : COLOR_PALETTES[color];
  const palettes = chosen ? [chosen, chosen, chosen] : PALETTES;
  return <svg ref={surface} className="premium-fx-art fx-lava" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" style={{ "--lava-halo": chosen?.[2] || "#f94766" }}>
    <defs>
      {palettes.map((colors, palette) => <radialGradient key={palette} id={`${id}-lava-${palette}`} cx="32%" cy="24%" r="82%">
        {colors.map((color, i) => <stop key={color} offset={[0, .32, .7, 1][i]} stopColor={color} />)}
      </radialGradient>)}
      <filter id={`${id}-lava-merge`} x="-10%" y="-15%" width="120%" height="130%" colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation="4" />
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6" />
      </filter>
    </defs>
    <g className="fx-lava-pool" filter={`url(#${id}-lava-merge)`}>
      <path className="fx-lava-reservoir" fill={`url(#${id}-lava-0)`} d={`M-70 ${size.height + 5}Q${size.width * .25} ${size.height - 60} ${size.width * .5} ${size.height + 5}T${size.width + 70} ${size.height}V${size.height + 150}H-70Z`} />
      {blobs.map((blob, i) => <g key={i} transform={`translate(${blob.x} ${blob.y})`}>
        <g className="fx-lava-flow" style={blob.style}>
          <path className="fx-lava-blob" fill={`url(#${id}-lava-${blob.palette})`} d={blob.a} style={{ "--lava-shape-a": `path("${blob.a}")`, "--lava-shape-b": `path("${blob.b}")`, "--lava-shape-c": `path("${blob.c}")` }} />
        </g>
      </g>)}
    </g>
  </svg>;
}
