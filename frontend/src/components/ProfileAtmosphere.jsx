// SVG geometry uses document coordinates, so the atmosphere follows scrolling.
export default function ProfileAtmosphere({ id, width = 1000, height = 700 }) {
  const bands = Math.min(6, Math.max(1, Math.ceil(height / 850)));
  const count = Math.min(36, Math.max(8, bands * 6));
  return <svg className="premium-fx-art fx-atmosphere" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
    <defs><linearGradient id={`${id}-meteor`} gradientUnits="userSpaceOnUse" x1="-215" y1="0" x2="0" y2="0"><stop stopColor="#7998ff" stopOpacity="0" /><stop offset=".72" stopColor="#98cfff" stopOpacity=".6" /><stop offset="1" stopColor="#f2fcff" /></linearGradient></defs>
    {Array.from({ length: count * 4 }, (_, i) => <circle key={`star-${i}`} className="fx-star" cx={((i * .61803398875) % 1) * width} cy={((i * .41421356237 + .07) % 1) * height} r={i % 5 === 0 ? 1.6 : .75} style={{ "--star-cycle": `${3 + i % 7}s`, "--star-phase": `${-i * .73}s` }} />)}
    {Array.from({ length: count }, (_, i) => <g key={i} transform={`translate(${(.08 + ((i * .61803398875) % .82)) * width} ${(i + .5) * height / count}) rotate(${26 + i % 5 * 5})`}>
      <g className="fx-meteor" style={{ "--meteor-cycle": `${7 + i % 6 * 1.37}s`, "--meteor-phase": `${-i * 2.31 - 1}s` }}>
        <g>
          <path className="fx-meteor-tail" stroke={`url(#${id}-meteor)`} d={`M${-110 - i % 4 * 35} 0H0`} />
          <circle className="fx-meteor-head" r="1.8" />
        </g>
      </g>
    </g>)}
  </svg>;
}
